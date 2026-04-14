import { useEffect, useMemo, useRef, useState } from 'react';
import {
  matchesParentSearch,
  nodeMenuLabel,
  parentHierarchyCandidates,
} from '../lib/diagramParentUtils.js';

/**
 * Hierarchy parent as a combobox: closed row shows the current parent; open shows search + list (no separate search when closed).
 * @param {{
 *   nodes: import('@xyflow/react').Node[];
 *   childId: string;
 *   value: string | undefined;
 *   onChange: (parentId: string) => void;
 *   className?: string;
 *   variant?: 'default' | 'on-node';
 * }} props
 */
export default function ParentHierarchyPicker({
  nodes,
  childId,
  value,
  onChange,
  className = '',
  variant = 'default',
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown, true);
    return () => document.removeEventListener('mousedown', onDocMouseDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const candidates = useMemo(() => {
    const filtered = parentHierarchyCandidates(nodes, childId).filter((n) => matchesParentSearch(n, q));
    if (!value) return filtered;
    const cur = nodes.find((n) => n.id === value);
    if (!cur || filtered.some((n) => n.id === value)) return filtered;
    return [cur, ...filtered];
  }, [nodes, childId, q, value]);

  const currentNode = value ? nodes.find((n) => n.id === value) : null;
  const triggerLabel = currentNode
    ? `${nodeMenuLabel(currentNode)} (${currentNode.id})`
    : 'None';

  const pick = (parentId) => {
    onChange(parentId);
    setOpen(false);
  };

  const mod = `diagram-parent-combobox diagram-parent-combobox--${variant} ${className}`.trim();

  return (
    <div ref={rootRef} className={mod}>
      <button
        type="button"
        className="diagram-parent-combobox__trigger nodrag"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span className="diagram-parent-combobox__trigger-text">{triggerLabel}</span>
        <span className="diagram-parent-combobox__chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div
          className="diagram-parent-combobox__menu nodrag nopan"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="search"
            className="diagram-parent-combobox__search nodrag"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or id…"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <ul className="diagram-parent-combobox__list" role="listbox">
            <li>
              <button type="button" className="diagram-parent-combobox__option" onClick={() => pick('')}>
                <span className="diagram-parent-combobox__option-muted">None</span>
              </button>
            </li>
            {value && !nodes.some((n) => n.id === value) ? (
              <li>
                <button type="button" className="diagram-parent-combobox__option" disabled>
                  Missing: {value}
                </button>
              </li>
            ) : null}
            {candidates.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className="diagram-parent-combobox__option"
                  onClick={() => pick(n.id)}
                >
                  {nodeMenuLabel(n)} <span className="diagram-parent-combobox__option-id">({n.id})</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
