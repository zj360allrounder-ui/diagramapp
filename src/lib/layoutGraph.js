import dagre from '@dagrejs/dagre';

const DEFAULT_W = 168;
const DEFAULT_H = 92;

/**
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 * @param {'TB'|'BT'|'LR'|'RL'} direction
 * @returns {import('@xyflow/react').Node[]}
 */
export function layoutWithDagre(nodes, edges, direction = 'TB') {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 56,
    ranksep: 80,
    marginx: 32,
    marginy: 32,
  });

  for (const node of nodes) {
    const w = node.measured?.width ?? DEFAULT_W;
    const h = node.measured?.height ?? DEFAULT_H;
    g.setNode(node.id, { width: w, height: h });
  }

  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const n = g.node(node.id);
    if (n === undefined) return node;
    const w = node.measured?.width ?? DEFAULT_W;
    const h = node.measured?.height ?? DEFAULT_H;
    return {
      ...node,
      position: { x: n.x - w / 2, y: n.y - h / 2 },
    };
  });
}
