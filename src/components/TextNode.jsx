import { memo, useCallback, useEffect, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useDiagramActions } from '../context/DiagramActionsContext.jsx';

function TextNode({ id, data, selected }) {
  const actions = useDiagramActions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.text ?? '');

  useEffect(() => {
    if (!editing) setDraft(data.text ?? '');
  }, [data.text, editing]);

  const commit = useCallback(() => {
    actions?.renameNodeById(id, draft);
    setEditing(false);
  }, [actions, id, draft]);

  const cancel = useCallback(() => {
    setDraft(data.text ?? '');
    setEditing(false);
  }, [data.text]);

  const startEdit = useCallback((e) => {
    e.stopPropagation();
    setDraft(data.text ?? '');
    setEditing(true);
  }, [data.text]);

  const h = 'service-node__handle';
  const tag = data.noteTag && data.noteTag !== 'default' ? data.noteTag : null;
  return (
    <div
      className={`text-node text-node--tag-${tag ?? 'default'} ${selected ? 'text-node--selected' : ''}`}
    >
      {tag ? (
        <span className="text-node__badge">
          {tag === 'wip' ? 'WIP' : tag === 'risk' ? 'Risk' : tag === 'question' ? 'Q' : tag}
        </span>
      ) : null}
      <Handle className={`${h} ${h}--at-top`} type="source" position={Position.Top} id="pt-top" isConnectable />
      <Handle className={`${h} ${h}--at-right`} type="source" position={Position.Right} id="pt-right" isConnectable />
      <Handle className={`${h} ${h}--at-bottom`} type="source" position={Position.Bottom} id="pt-bottom" isConnectable />
      <Handle className={`${h} ${h}--at-left`} type="source" position={Position.Left} id="pt-left" isConnectable />
      <div className="text-node__body" onDoubleClick={startEdit} title="Double-click to edit text">
        {editing ? (
          <textarea
            className="text-node__input nodrag"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            autoFocus
            rows={4}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className={`text-node__content${data.text?.trim() ? '' : ' text-node__content--placeholder'}`}
          >
            {data.text?.trim() ? data.text : 'Double-click to type…'}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(TextNode);
