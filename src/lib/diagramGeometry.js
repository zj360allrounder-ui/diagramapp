import { getNodeSize } from './diagramAlignment.js';

/**
 * @param {string} nodeId
 * @param {Map<string, import('@xyflow/react').Node>} nodeMap
 */
export function getAbsolutePosition(nodeId, nodeMap) {
  const n = nodeMap.get(nodeId);
  if (!n) return { x: 0, y: 0 };
  if (!n.parentId) return { x: n.position.x, y: n.position.y };
  const p = getAbsolutePosition(n.parentId, nodeMap);
  return { x: p.x + n.position.x, y: p.y + n.position.y };
}

/**
 * @param {import('@xyflow/react').Node} n
 * @param {Map<string, import('@xyflow/react').Node>} nodeMap
 * @param {{ x: number, y: number }} flowPoint
 */
export function flowPointInsideNode(n, nodeMap, flowPoint) {
  const abs = getAbsolutePosition(n.id, nodeMap);
  const { w, h } = getNodeSize(n);
  return (
    flowPoint.x >= abs.x &&
    flowPoint.x <= abs.x + w &&
    flowPoint.y >= abs.y &&
    flowPoint.y <= abs.y + h
  );
}

/**
 * Smallest-area group under the cursor wins (inner swimlane).
 * @param {import('@xyflow/react').Node[]} intersecting
 * @param {Map<string, import('@xyflow/react').Node>} nodeMap
 * @param {{ x: number, y: number }} flowPoint
 */
export function pickGroupForDrop(intersecting, nodeMap, flowPoint) {
  const groups = intersecting.filter((n) => n.type === 'group');
  const inside = groups.filter((g) => flowPointInsideNode(g, nodeMap, flowPoint));
  inside.sort((a, b) => {
    const { w: aw, h: ah } = getNodeSize(a);
    const { w: bw, h: bh } = getNodeSize(b);
    return aw * ah - bw * bh;
  });
  return inside[0] ?? null;
}
