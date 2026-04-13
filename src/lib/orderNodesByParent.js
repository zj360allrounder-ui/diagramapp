/**
 * Parents before children so React Flow sub-flows resolve correctly.
 * @param {import('@xyflow/react').Node[]} nodes
 * @returns {import('@xyflow/react').Node[]}
 */
export function orderNodesParentsFirst(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set();
  const out = [];

  const visiting = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) return;
    const n = byId.get(id);
    if (!n) return;
    if (n.parentId) {
      visiting.add(id);
      visit(n.parentId);
      visiting.delete(id);
    }
    visited.add(id);
    out.push(n);
  }

  for (const n of nodes) visit(n.id);
  return out;
}
