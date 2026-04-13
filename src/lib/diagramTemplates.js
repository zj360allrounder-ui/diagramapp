/**
 * Starter graphs: return nodes/edges using caller-supplied ids (for unique n-* sequence).
 * Positions are relative; caller may offset the whole set.
 *
 * @param {() => string} nextId
 * @returns {{ nodes: import('@xyflow/react').Node[], edges: import('@xyflow/react').Edge[] }}
 */

function edge(id, source, target, label) {
  return {
    id,
    source,
    target,
    sourceHandle: 'pt-bottom',
    targetHandle: 'pt-top',
    type: 'smoothstep',
    label,
  };
}

export function templateThreeTierWeb(nextId) {
  const alb = nextId();
  const app = nextId();
  const db = nextId();
  return {
    nodes: [
      {
        id: alb,
        type: 'service',
        position: { x: 200, y: 40 },
        data: { label: 'Load balancer', iconKey: 'awsnet_alb' },
      },
      {
        id: app,
        type: 'service',
        position: { x: 200, y: 180 },
        data: { label: 'App tier', iconKey: 'amazonec2' },
      },
      {
        id: db,
        type: 'service',
        position: { x: 200, y: 320 },
        data: { label: 'Database', iconKey: 'amazonrds' },
      },
    ],
    edges: [
      edge(`e-${alb}-${app}`, alb, app, 'HTTPS'),
      edge(`e-${app}-${db}`, app, db, 'SQL'),
    ],
  };
}

export function templateEventDriven(nextId) {
  const api = nextId();
  const bus = nextId();
  const worker = nextId();
  const store = nextId();
  return {
    nodes: [
      {
        id: api,
        type: 'service',
        position: { x: 80, y: 120 },
        data: { label: 'API / producer', iconKey: 'amazonapigateway' },
      },
      {
        id: bus,
        type: 'service',
        position: { x: 320, y: 120 },
        data: { label: 'Event bus', iconKey: 'kafka' },
      },
      {
        id: worker,
        type: 'service',
        position: { x: 560, y: 40 },
        data: { label: 'Consumer', iconKey: 'amazonec2' },
      },
      {
        id: store,
        type: 'service',
        position: { x: 560, y: 200 },
        data: { label: 'Data store', iconKey: 'amazons3' },
      },
    ],
    edges: [
      edge(`e-${api}-${bus}`, api, bus, 'publish'),
      edge(`e-${bus}-${worker}`, bus, worker, 'subscribe'),
      edge(`e-${worker}-${store}`, worker, store, 'write'),
    ],
  };
}

export function templateK8sCluster(nextId) {
  const cluster = nextId();
  const ing = nextId();
  const svc = nextId();
  const dep = nextId();
  return {
    nodes: [
      {
        id: cluster,
        type: 'service',
        position: { x: 240, y: 40 },
        data: { label: 'Kubernetes', iconKey: 'kubernetes' },
      },
      {
        id: ing,
        type: 'service',
        position: { x: 120, y: 200 },
        data: { label: 'Ingress', iconKey: 'k8s_ingress' },
      },
      {
        id: svc,
        type: 'service',
        position: { x: 320, y: 200 },
        data: { label: 'Service', iconKey: 'k8s_svc' },
      },
      {
        id: dep,
        type: 'service',
        position: { x: 520, y: 200 },
        data: { label: 'Deployment', iconKey: 'k8s_deploy' },
      },
    ],
    edges: [
      edge(`e-${cluster}-${ing}`, cluster, ing, ''),
      edge(`e-${ing}-${svc}`, ing, svc, ''),
      edge(`e-${svc}-${dep}`, svc, dep, ''),
    ],
  };
}

export const DIAGRAM_TEMPLATES = [
  { id: '3tier', label: '3-tier web', build: templateThreeTierWeb },
  { id: 'events', label: 'Event-driven', build: templateEventDriven },
  { id: 'k8s', label: 'K8s cluster', build: templateK8sCluster },
];
