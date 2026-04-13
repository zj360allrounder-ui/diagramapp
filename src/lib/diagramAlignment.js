const DEFAULT_W = 168;
const DEFAULT_H = 92;
const TEXT_W = 240;
const TEXT_H = 96;
const GROUP_W = 480;
const GROUP_H = 320;

/**
 * @param {import('@xyflow/react').Node} n
 */
export function getNodeSize(n) {
  if (n.type === 'group') {
    const w = n.style?.width ?? n.width ?? GROUP_W;
    const h = n.style?.height ?? n.height ?? GROUP_H;
    return {
      w: typeof w === 'number' ? w : Number.parseInt(String(w), 10) || GROUP_W,
      h: typeof h === 'number' ? h : Number.parseInt(String(h), 10) || GROUP_H,
    };
  }
  if (n.type === 'text') {
    return {
      w: n.measured?.width ?? n.width ?? TEXT_W,
      h: n.measured?.height ?? n.height ?? TEXT_H,
    };
  }
  return {
    w: n.measured?.width ?? n.width ?? DEFAULT_W,
    h: n.measured?.height ?? n.height ?? DEFAULT_H,
  };
}

/**
 * @param {import('@xyflow/react').Node[]} nodes
 */
function boundsList(nodes) {
  return nodes.map((n) => {
    const { w, h } = getNodeSize(n);
    const x = n.position.x;
    const y = n.position.y;
    return { id: n.id, x, y, w, h, left: x, top: y, right: x + w, bottom: y + h };
  });
}

/**
 * @param {import('@xyflow/react').Node[]} selected
 * @param {'left'|'centerH'|'right'|'top'|'centerV'|'bottom'} mode
 * @returns {Map<string, { x: number, y: number }>}
 */
export function computeAlignedPositions(selected, mode) {
  if (selected.length < 2) return new Map();
  const parentId = selected[0].parentId ?? null;
  if (!selected.every((n) => (n.parentId ?? null) === parentId)) return new Map();

  const b = boundsList(selected);
  const minLeft = Math.min(...b.map((r) => r.left));
  const maxRight = Math.max(...b.map((r) => r.right));
  const minTop = Math.min(...b.map((r) => r.top));
  const maxBottom = Math.max(...b.map((r) => r.bottom));
  const midX = (minLeft + maxRight) / 2;
  const midY = (minTop + maxBottom) / 2;

  const out = new Map();
  for (const r of b) {
    let nx = r.x;
    let ny = r.y;
    if (mode === 'left') nx = minLeft;
    else if (mode === 'right') nx = maxRight - r.w;
    else if (mode === 'centerH') nx = midX - r.w / 2;
    else if (mode === 'top') ny = minTop;
    else if (mode === 'bottom') ny = maxBottom - r.h;
    else if (mode === 'centerV') ny = midY - r.h / 2;
    out.set(r.id, { x: nx, y: ny });
  }
  return out;
}

/**
 * @param {import('@xyflow/react').Node[]} selected
 * @param {'horizontal'|'vertical'} axis
 * @returns {Map<string, { x: number, y: number }>}
 */
export function computeDistributedPositions(selected, axis) {
  if (selected.length < 3) return new Map();
  const parentId = selected[0].parentId ?? null;
  if (!selected.every((n) => (n.parentId ?? null) === parentId)) return new Map();

  const b = boundsList(selected);
  if (axis === 'horizontal') {
    const sorted = [...b].sort((a, c) => a.left - c.left);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = last.right - first.left;
    const totalW = sorted.reduce((s, r) => s + r.w, 0);
    const gap = (span - totalW) / (sorted.length - 1);
    if (gap < 0) return new Map();
    const out = new Map();
    let cursor = first.left;
    for (const r of sorted) {
      out.set(r.id, { x: cursor, y: r.y });
      cursor += r.w + gap;
    }
    return out;
  }
  const sorted = [...b].sort((a, c) => a.top - c.top);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = last.bottom - first.top;
  const totalH = sorted.reduce((s, r) => s + r.h, 0);
  const gap = (span - totalH) / (sorted.length - 1);
  if (gap < 0) return new Map();
  const out = new Map();
  let cursor = first.top;
  for (const r of sorted) {
    out.set(r.id, { x: r.x, y: cursor });
    cursor += r.h + gap;
  }
  return out;
}
