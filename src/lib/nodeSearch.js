/**
 * @param {import('@xyflow/react').Node} n
 */
export function getNodeSearchHaystack(n) {
  const d = n.data ?? {};
  const parts = [n.id];
  if (n.type === 'text') {
    parts.push(d.text);
  } else {
    parts.push(d.label, d.subtitle);
  }
  parts.push(d.owner, d.repoUrl, d.env);
  return parts
    .filter((p) => p != null && String(p).trim() !== '')
    .join(' ')
    .toLowerCase();
}

/**
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {string} query
 */
export function filterNodesByQuery(nodes, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return nodes.filter((n) => getNodeSearchHaystack(n).includes(q));
}

/** Persist only non-empty metadata strings. */
export function metaFieldsForExport(data) {
  if (!data) return {};
  const out = {};
  const o = typeof data.owner === 'string' ? data.owner.trim() : '';
  const r = typeof data.repoUrl === 'string' ? data.repoUrl.trim() : '';
  const e = typeof data.env === 'string' ? data.env.trim() : '';
  if (o) out.owner = o;
  if (r) out.repoUrl = r;
  if (e) out.env = e;
  return out;
}

/** @param {Record<string, unknown> | undefined} raw */
export function metaFieldsFromImport(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  if (raw.owner != null && String(raw.owner).trim()) out.owner = String(raw.owner).trim();
  if (raw.repoUrl != null && String(raw.repoUrl).trim()) out.repoUrl = String(raw.repoUrl).trim();
  if (raw.env != null && String(raw.env).trim()) out.env = String(raw.env).trim();
  return out;
}
