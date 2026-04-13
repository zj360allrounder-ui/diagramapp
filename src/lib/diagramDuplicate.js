const OFFSET = 48;

/**
 * Duplicate selected nodes: each selected subtree root (not under another selected node) is cloned
 * with descendants. Remaps `data.parentNodeId` when the parent is also cloned.
 *
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 * @param {() => string} nextId
 * @returns {{ clones: import('@xyflow/react').Node[], newEdges: import('@xyflow/react').Edge[] } | null}
 */
export function duplicateSelection(nodes, edges, nextId) {
  const selectedIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
  if (selectedIds.size === 0) return null;

  const roots = nodes.filter(
    (n) => n.selected && (!n.parentId || !selectedIds.has(n.parentId))
  );

  const toClone = new Set();
  for (const r of roots) {
    const queue = [r.id];
    while (queue.length) {
      const id = queue.shift();
      if (!selectedIds.has(id) || toClone.has(id)) continue;
      toClone.add(id);
      for (const n of nodes) {
        if (n.parentId === id && selectedIds.has(n.id)) queue.push(n.id);
      }
    }
  }

  const idMap = new Map();
  for (const id of toClone) idMap.set(id, nextId());

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const clones = [];

  for (const oldId of toClone) {
    const n = nodeById.get(oldId);
    const newId = idMap.get(oldId);
    const newParentId =
      n.parentId && toClone.has(n.parentId) ? idMap.get(n.parentId) : n.parentId;
    let data = { ...n.data };
    if (data.parentNodeId && idMap.has(data.parentNodeId)) {
      data = { ...data, parentNodeId: idMap.get(data.parentNodeId) };
    }
    clones.push({
      ...n,
      id: newId,
      selected: true,
      parentId: newParentId,
      position: { x: n.position.x + OFFSET, y: n.position.y + OFFSET },
      data,
    });
  }

  const newEdges = [];
  for (const e of edges) {
    if (!toClone.has(e.source) || !toClone.has(e.target)) continue;
    newEdges.push({
      ...e,
      id: `e-${idMap.get(e.source)}-${idMap.get(e.target)}-${nextId()}`,
      source: idMap.get(e.source),
      target: idMap.get(e.target),
    });
  }

  return { clones, newEdges };
}
