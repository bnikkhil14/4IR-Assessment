# 4IR-Assessment
Deploy Guestbook application with Prometheus and Grafana monitoring

## Objective and scope
- Deploy a sample Guestbook web application to a local Kubernetes cluster using Pulumi infrastructure as code (IaC).
- Provide a Redis leader with two replicas, expose the frontend, and install an observability stack comprising Prometheus, Grafana, Redis Exporter, Blackbox Exporter, and a custom Grafana dashboard. Verify readiness, functional behavior, replication, and telemetry.

## Architecture
Windows 11 → Docker Desktop (local Kubernetes) → guestbook namespace: frontend Deployment (3 Pods) → redis-leader Service (1 Pod, writes) + redis-replica Service (2 Pods, reads). redis-exporter publishes Redis metrics. monitoring namespace: kube-prometheus-stack (Prometheus, Grafana, Alertmanager, operator, exporters) plus Blackbox Exporter. A ServiceMonitor discovers Redis metrics and a Probe tests frontend HTTP availability.

Kubernetes Service DNS names: 
- redis-leader.guestbook.svc.cluster.local:6379
- redis-replica.guestbook.svc.cluster.local:6379
- frontend.guestbook.svc.cluster.local:80
- ClusterIP DNS is internal
- port-forwarding provides local browser access.

## Guestbook Application
Local Kubernetes Deployment & Observability | Reproducible Setup and Validation Guide
- Extract the submitted project ZIP, or clone the assessment repository, into a working folder.
- Open the project root (the folder containing Pulumi.yaml, package.json, and index.ts) in VS Code.
- Install the declared npm dependencies
    - use npm ci if a compatible package-lock.json is provided
    - otherwise npm install.
    - `cd C:\Users\<username>\Downloads\4IR-Assessment`
    - npm ci
    - `If there is no package-lock.json, run: npm install`


## Pulumi configuration and deployment
- Check Kubernetes context and select or create the Pulumi dev stack.
    `kubectl config current-context`
    `pulumi stack ls`
    `pulumi stack select dev`
    `pulumi stack init dev`

- Set the Grafana admin password as a Pulumi secret.
    `pulumi config set --secret grafanaPassword <Password>`

- For local passphrase-based secrets, provide a passphrase when prompted; keep it safe. Review Pulumi.yaml and Pulumi.dev.yaml without exposing secrets.
- Review the infrastructure and image versions, then preview and apply.
    `pulumi preview`
    `pulumi up`

## Key application configuration

# Frontend image compatibility
- The original 'registry.k8s.io/guestbook:v3' image failed because it uses an obsolete Docker Schema 1 manifest unsupported by containerd v2.1+. The project was changed to 'gcr.io/google-samples/gb-frontend:v5'
    `docker pull gcr.io/google-samples/gb-frontend:v5`

# Redis leader and replica startup
- The initial Redis replicas started as independent primary instances. The deployment helper was extended with an optional args parameter, and the replica Deployment was configured to follow the leader:

# Frontend Redis host configuration
The frontend page has loaded, but message persistence has not yet been verified. Inspect the actual frontend PHP source/configuration and its environment to confirm which Redis hostnames or variables the v5 image expects. If it expects the classic Guestbook variables, configure GET_HOSTS_FROM=env, REDIS_MASTER_SERVICE_HOST=redis-leader, and REDIS_SLAVE_SERVICE_HOST=redis-replica via the deployment helper’s env parameter. Do not assume these variables are correct without checking the image.
kubectl -n guestbook exec deployment/frontend -- printenv
kubectl -n guestbook exec deployment/frontend -- sh -c "grep -R -n -E 'REDIS_MASTER|REDIS_SLAVE|redis-master|redis-slave|GET_HOSTS_FROM' /var/www/html 2>/dev/null"