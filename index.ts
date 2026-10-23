import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';

const config = new pulumi.Config();
const grafanaPassword = config.requireSecret('grafanaPassword');
const namespace = new k8s.core.v1.Namespace('guestbook-ns', {metadata:{name:'guestbook'}});
const ns = {namespace:namespace.metadata.name};
const monitoring = new k8s.core.v1.Namespace('monitoring-ns', {metadata:{name:'monitoring'}});
const monitorNs = monitoring.metadata.name;

function deployment(
  name: string,
  image: string,
  replicas: number,
  labels: Record<string, string>,
  ports: number[],
  env: any[] = [],
  args: string[] = []
) {
  return new k8s.apps.v1.Deployment(name, {
    metadata: { ...ns, name },
    spec: {
      replicas,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          containers: [{
            name,
            image,
            ports: ports.map(containerPort => ({ containerPort })),
            env,
            ...(args.length > 0 ? { args } : {}),
            resources: {
              requests: { cpu: '50m', memory: '64Mi' },
              limits: { cpu: '500m', memory: '256Mi' }
            }
          }]
        }
      }
    }
  }, { dependsOn: [namespace] });
}
function service(
  name:string, 
  labels:Record<string,string>, 
  port:number, 
  targetPort:number, 
  type:'ClusterIP'|'NodePort'='ClusterIP') {
    return new k8s.core.v1.Service(name,
      {metadata:{...ns,name},
      spec:{
        type,
        selector:labels,
        ports:[{name:'http',port,targetPort}]
      }
    },{dependsOn:[namespace]});
}

const leaderLabels = {app:'redis',role:'leader'};
deployment('redis-leader','redis:7.2-alpine',1,leaderLabels,[6379]);
service('redis-leader',leaderLabels,6379,6379);

const replicaLabels = { app: 'redis', role: 'replica' };
deployment('redis-replica','redis:7.2-alpine',2,replicaLabels,[6379],[],['--replicaof', 'redis-leader', '6379']);
service('redis-replica', replicaLabels, 6379, 6379);

const frontendLabels = {app:'guestbook',tier:'frontend'};
deployment('frontend','gcr.io/google-samples/gb-frontend:v5',3,frontendLabels,[80]);
service('frontend',frontendLabels,80,80,'NodePort');

// kube-prometheus-stack installs Prometheus Operator, Grafana, node-exporter and kube-state-metrics.
const stack = new k8s.helm.v3.Release('observability', {
  name:'observability',chart:'kube-prometheus-stack',version:'65.8.1',
  repositoryOpts:{repo:'https://prometheus-community.github.io/helm-charts'},
  namespace:monitorNs,createNamespace:false,
  values:{
    grafana:{adminUser:'admin',adminPassword:grafanaPassword,service:{type:'NodePort',nodePort:32000},
      sidecar:{dashboards:{enabled:true,searchNamespace:'ALL'}}},
    prometheus:{prometheusSpec:{serviceMonitorSelectorNilUsesHelmValues:false,
      probeSelectorNilUsesHelmValues:false,serviceMonitorNamespaceSelector:{},probeNamespaceSelector:{}}}
  }
},{dependsOn:[monitoring]});

const redisExporterLabels={app:'redis-exporter'};
new k8s.apps.v1.Deployment('redis-exporter', {metadata:{...ns,name:'redis-exporter'},spec:{replicas:1,selector:{matchLabels:redisExporterLabels},template:{metadata:{labels:redisExporterLabels},spec:{containers:[{name:'exporter',image:'oliver006/redis_exporter:v1.66.0',env:[{name:'REDIS_ADDR',value:'redis://redis-leader.guestbook.svc.cluster.local:6379'}],ports:[{name:'metrics',containerPort:9121}]}]}}}}, {dependsOn:[namespace]});
new k8s.core.v1.Service('redis-exporter-svc',{metadata:{...ns,name:'redis-exporter',labels:redisExporterLabels},spec:{selector:redisExporterLabels,ports:[{name:'metrics',port:9121,targetPort:'metrics'}]}},{dependsOn:[namespace]});
new k8s.apiextensions.CustomResource('redis-monitor',{apiVersion:'monitoring.coreos.com/v1',kind:'ServiceMonitor',metadata:{...ns,name:'redis-monitor'},spec:{selector:{matchLabels:redisExporterLabels},namespaceSelector:{matchNames:['guestbook']},endpoints:[{port:'metrics',interval:'30s'}]}},{dependsOn:[stack]});

const blackbox = new k8s.helm.v3.Release('blackbox',{name:'blackbox',chart:'prometheus-blackbox-exporter',version:'9.0.1',repositoryOpts:{repo:'https://prometheus-community.github.io/helm-charts'},namespace:monitorNs,values:{serviceMonitor:{enabled:false}}},{dependsOn:[stack]});
new k8s.apiextensions.CustomResource('guestbook-http-probe',{apiVersion:'monitoring.coreos.com/v1',kind:'Probe',metadata:{...ns,name:'guestbook-http-probe'},spec:{jobName:'guestbook-frontend',interval:'30s',module:'http_2xx',prober:{url:'blackbox-prometheus-blackbox-exporter.monitoring.svc.cluster.local:9115'},targets:{staticConfig:{static:['http://frontend.guestbook.svc.cluster.local/']}}}},{dependsOn:[blackbox,stack]});

const dashboard = new k8s.core.v1.ConfigMap('guestbook-dashboard',{metadata:{...ns,name:'guestbook-dashboard',labels:{grafana_dashboard:'1'}},data:{'guestbook.json':JSON.stringify({uid:'guestbook-sre',title:'Guestbook SRE Overview',schemaVersion:39,version:1,refresh:'30s',time:{from:'now-1h',to:'now'},panels:[
{type:'stat',title:'Frontend HTTP availability',id:1,gridPos:{x:0,y:0,w:12,h:8},targets:[{expr:'probe_success{job="guestbook-frontend"}',refId:'A'}]},
{type:'timeseries',title:'Frontend HTTP probe duration (seconds)',id:2,gridPos:{x:12,y:0,w:12,h:8},targets:[{expr:'probe_duration_seconds{job="guestbook-frontend"}',refId:'A'}]},
{type:'stat',title:'Redis exporter health',id:3,gridPos:{x:0,y:8,w:12,h:8},targets:[{expr:'redis_up',refId:'A'}]},
{type:'timeseries',title:'Redis connected clients',id:4,gridPos:{x:12,y:8,w:12,h:8},targets:[{expr:'redis_connected_clients',refId:'A'}]}
]})}},{dependsOn:[stack]});

export const guestbookService = 'frontend.guestbook.svc.cluster.local:80';
export const grafanaAccessUrl = 'http://localhost:32000 (on a local Kubernetes node with NodePort routing; otherwise use port-forward)';
export const grafanaPortForward = 'kubectl -n monitoring port-forward svc/observability-grafana 3000:80';
export const grafanaLocalUrl = 'http://localhost:3000';
export const grafanaAdminUsername = 'admin';
export const grafanaAdminPassword = pulumi.secret(grafanaPassword);
export const prometheusPortForward = 'kubectl -n monitoring port-forward svc/observability-kube-prometheus-prometheus 9090:9090';
