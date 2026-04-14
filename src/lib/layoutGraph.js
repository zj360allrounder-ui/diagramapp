import dagre from '@dagrejs/dagre';

const DEFAULT_W = 216;
const DEFAULT_H = 76;
const TEXT_W = 240;
const TEXT_H = 96;
const GROUP_W = 480;
const GROUP_H = 320;

/**
 * Top-level services/text only — groups and nodes inside swimlanes keep their positions.
 * @param {import('@xyflow/react').Node} node
 */
function isLayoutable(node) {
  if (node.type === 'group') return false;
  if (node.parentId) return false;
  return true;
}

function nodeSize(node) {
  if (node.type === 'group') {
    const w = node.style?.width ?? node.width ?? GROUP_W;
    const h = node.style?.height ?? node.height ?? GROUP_H;
    return {
      w: typeof w === 'number' ? w : Number.parseInt(String(w), 10) || GROUP_W,
      h: typeof h === 'number' ? h : Number.parseInt(String(h), 10) || GROUP_H,
    };
  }
  if (node.type === 'text') {
    return { w: node.measured?.width ?? TEXT_W, h: node.measured?.height ?? TEXT_H };
  }
  return { w: node.measured?.width ?? DEFAULT_W, h: node.measured?.height ?? DEFAULT_H };
}

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
    if (!isLayoutable(node)) continue;
    const { w, h } = nodeSize(node);
    g.setNode(node.id, { width: w, height: h });
  }

  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }

  dagre.layout(g);

  return nodes.map((node) => {
    if (!isLayoutable(node)) return node;
    const n = g.node(node.id);
    if (n === undefined) return node;
    const { w, h } = nodeSize(node);
    return {
      ...node,
      position: { x: n.x - w / 2, y: n.y - h / 2 },
    };
  });
}
