import { memo, useCallback, useEffect, useState } from 'react';
import { Handle, Position, useStore } from '@xyflow/react';
import { resolveIcon } from '../lib/iconRegistry.js';
import { useDiagramActions } from '../context/DiagramActionsContext.jsx';
import ParentHierarchyPicker from './ParentHierarchyPicker.jsx';

function ServiceNode({ id, data, selected }) {
  const actions = useDiagramActions();
  const nodes = useStore((s) => s.nodes);
  const spec = resolveIcon(data.iconKey);
  const fill = `#${spec.hex}`;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label ?? '');

  const parentUiOpen = actions?.serviceParentUiNodeId === id;

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

  const onIconDoubleClick = useCallback(
    (e) => {
      e.stopPropagation();
      actions?.toggleServiceParentUi?.(id);
    },
    [actions, id]
  );

  const onParentChange = useCallback(
    (parentId) => {
      actions?.setParentForNode?.(id, parentId);
    },
    [actions, id]
  );

  /** One handle per side; `ConnectionMode.Loose` on the canvas allows source↔source links. */
  const h = 'service-node__handle';
  return (
    <div className={`service-node ${selected ? 'service-node--selected' : ''}`}>
      <Handle
        className={`${h} ${h}--at-top`}
        type="source"
        position={Position.Top}
        id="pt-top"
        isConnectable
      />
      <Handle
        className={`${h} ${h}--at-right`}
        type="source"
        position={Position.Right}
        id="pt-right"
        isConnectable
      />
      <Handle
        className={`${h} ${h}--at-bottom`}
        type="source"
        position={Position.Bottom}
        id="pt-bottom"
        isConnectable
      />
      <Handle
        className={`${h} ${h}--at-left`}
        type="source"
        position={Position.Left}
        id="pt-left"
        isConnectable
      />
      <div className="service-node__body">
        <div
          className="service-node__icon-wrap nodrag nopan"
          style={{ background: fill }}
          onDoubleClick={onIconDoubleClick}
          title="Double-click to show or hide Parent (hierarchy)"
        >
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
          <div
            className="service-node__label nodrag nopan"
            onDoubleClick={startEdit}
            title="Double-click to rename"
          >
            {data.label}
          </div>
        )}
        {parentUiOpen ? (
          <div className="service-node__parent nodrag nopan" onDoubleClick={(e) => e.stopPropagation()}>
            <span className="service-node__parent-label">Parent</span>
            <ParentHierarchyPicker
              nodes={nodes}
              childId={id}
              value={data.parentNodeId}
              onChange={onParentChange}
              variant="on-node"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default memo(ServiceNode);
