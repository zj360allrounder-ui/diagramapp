/**
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {string} nodeId
 * @param {string} newParentId
 */
export function wouldCreateParentCycle(nodes, nodeId, newParentId) {
  if (!newParentId || newParentId === nodeId) return true;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let cur = newParentId;
  const seen = new Set();
  while (cur) {
    if (cur === nodeId) return true;
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = byId.get(cur)?.data?.parentNodeId;
  }
  return false;
}

/** @param {import('@xyflow/react').Node} n */
export function nodeMenuLabel(n) {
  if (n.type === 'text') {
    const t = (n.data?.text ?? '').trim().split(/\n/)[0] || 'Text note';
    return t.length > 40 ? `${t.slice(0, 37)}…` : t;
  }
  if (n.type === 'group') return n.data?.label ?? 'Swimlane';
  const title = n.data?.label ?? 'Service';
  const sub = typeof n.data?.subtitle === 'string' ? n.data.subtitle.trim() : '';
  if (!sub) return title;
  const both = `${title} (${sub})`;
  return both.length > 48 ? `${both.slice(0, 45)}…` : both;
}

/** Eligible hierarchy parents for a non-group child (excludes swimlanes and cycles). */
export function parentHierarchyCandidates(nodes, childId) {
  return nodes
    .filter((n) => n.id !== childId)
    .filter((n) => n.type !== 'group')
    .filter((n) => !wouldCreateParentCycle(nodes, childId, n.id));
}

/** @param {import('@xyflow/react').Node} n */
export function matchesParentSearch(n, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const label = nodeMenuLabel(n).toLowerCase();
  const id = String(n.id).toLowerCase();
  return label.includes(q) || id.includes(q);
}
