import { memo, useCallback, useEffect, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { resolveIcon } from '../lib/iconRegistry.js';
import { useDiagramActions } from '../context/DiagramActionsContext.jsx';

function ServiceNode({ id, data, selected }) {
  const actions = useDiagramActions();
  const spec = resolveIcon(data.iconKey);
  const fill = `#${spec.hex}`;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label ?? '');

  useEffect(() => {
    if (!editing) setDraft(data.label ?? '');
  }, [data.label, editing]);

  const commit = useCallback(() => {
    const next = draft.trim() || 'Untitled';
    actions?.renameNodeById(id, next);
    setEditing(false);
  }, [actions, id, draft]);

  const cancel = useCallback(() => {
    setDraft(data.label ?? '');
    setEditing(false);
  }, [data.label]);

  const startEdit = useCallback(
    (e) => {
      e.stopPropagation();
      setDraft(data.label ?? '');
      setEditing(true);
    },
    [data.label]
  );

  return (
    <div className={`service-node ${selected ? 'service-node--selected' : ''}`}>
      <Handle
        className="service-node__handle service-node__handle--target"
        type="target"
        position={Position.Top}
        isConnectable
      />
      <div className="service-node__body" onDoubleClick={startEdit} title="Double-click to rename">
        <div className="service-node__icon-wrap" style={{ background: fill }}>
          {spec.kind === 'url' ? (
            <img className="service-node__icon-img" src={spec.url} alt="" draggable={false} />
          ) : (
            <svg className="service-node__icon-svg" viewBox="0 0 24 24" aria-hidden>
              <path fill="#fff" d={spec.path} />
            </svg>
          )}
        </div>
        {editing ? (
          <input
            className="service-node__input nodrag"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="service-node__label">{data.label}</div>
        )}
      </div>
      <Handle
        className="service-node__handle service-node__handle--source"
        type="source"
        position={Position.Bottom}
        isConnectable
      />
    </div>
  );
}

export default memo(ServiceNode);
