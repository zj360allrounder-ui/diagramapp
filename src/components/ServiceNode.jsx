import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Handle, Position, useReactFlow, useStore } from '@xyflow/react';
import { resolveIcon } from '../lib/iconRegistry.js';
import { useDiagramActions } from '../context/DiagramActionsContext.jsx';
import ParentHierarchyPicker from './ParentHierarchyPicker.jsx';

const ICON_LONG_PRESS_MS = 320;
const ICON_LONG_PRESS_MOVE_CANCEL_PX = 6;

/** No `subtitle` key → show registry title; `subtitle: ''` → hide row; non-empty → custom. */
function subtitlePresentation(data, registryTitle) {
  const hasKey = data != null && Object.prototype.hasOwnProperty.call(data, 'subtitle');
  if (!hasKey || data.subtitle === undefined) {
    return {
      showRow: true,
      displayText: registryTitle,
      isImplicitDefault: true,
      editSeed: registryTitle,
    };
  }
  const s = typeof data.subtitle === 'string' ? data.subtitle : '';
  if (s.trim() === '') {
    return { showRow: false, displayText: '', isImplicitDefault: false, editSeed: '' };
  }
  return {
    showRow: true,
    displayText: s.trim(),
    isImplicitDefault: false,
    editSeed: s.trim(),
  };
}

function ServiceNode({ id, data, selected }) {
  const actions = useDiagramActions();
  const { getNode, setNodes, screenToFlowPosition } = useReactFlow();
  const nodes = useStore((s) => s.nodes);
  const spec = resolveIcon(data.iconKey);
  const fill = `#${spec.hex}`;

  const registrySubtitle = spec.title;
  const sub = subtitlePresentation(data, registrySubtitle);

  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [iconDragging, setIconDragging] = useState(false);

  const iconWrapRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const iconPointerRef = useRef(null);
  const iconDragActiveRef = useRef(false);
  const suppressIconClickRef = useRef(false);

  const parentUiOpen = actions?.serviceParentUiNodeId === id;

  const clearIconLongPress = useCallback(() => {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const endIconDrag = useCallback(() => {
    clearIconLongPress();
    iconDragActiveRef.current = false;
    iconPointerRef.current = null;
    setIconDragging(false);
  }, [clearIconLongPress]);

  useEffect(() => () => clearIconLongPress(), [clearIconLongPress]);

  useEffect(() => {
    if (editing === 'title') {
      setDraft(data.label ?? '');
    } else if (editing === 'subtitle') {
      setDraft(sub.editSeed);
    }
  }, [editing, data.label, sub.editSeed]);

  const commitTitle = useCallback(() => {
    const next = draft.trim() || 'Untitled';
    actions?.renameNodeById(id, next);
    setEditing(null);
  }, [actions, id, draft]);

  const commitSubtitle = useCallback(() => {
    actions?.setServiceNodeSubtitleById?.(id, draft);
    setEditing(null);
  }, [actions, id, draft]);

  const cancel = useCallback(() => {
    setEditing(null);
  }, []);

  const startEditTitle = useCallback((e) => {
    e.stopPropagation();
    setDraft(data.label ?? '');
    setEditing('title');
  }, [data.label]);

  const startEditSubtitle = useCallback(
    (e) => {
      e.stopPropagation();
      setDraft(sub.editSeed);
      setEditing('subtitle');
    },
    [sub.editSeed]
  );

  const onIconDoubleClick = useCallback(
    (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (suppressIconClickRef.current) {
        suppressIconClickRef.current = false;
        return;
      }
      actions?.toggleServiceParentUi?.(id);
    },
    [actions, id]
  );

  const onIconPointerDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      const node = getNode(id);
      if (!node) return;

      clearIconLongPress();
      iconDragActiveRef.current = false;
      iconPointerRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        originX: node.position.x,
        originY: node.position.y,
      };

      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        const info = iconPointerRef.current;
        if (!info) return;
        iconDragActiveRef.current = true;
        setIconDragging(true);
        setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
        try {
          iconWrapRef.current?.setPointerCapture(info.pointerId);
        } catch {
          /* ignore */
        }
      }, ICON_LONG_PRESS_MS);
    },
    [clearIconLongPress, getNode, id, setNodes]
  );

  const onIconPointerMove = useCallback(
    (e) => {
      const info = iconPointerRef.current;
      if (!info) return;

      if (!iconDragActiveRef.current) {
        const dx = e.clientX - info.startClientX;
        const dy = e.clientY - info.startClientY;
        if (dx * dx + dy * dy > ICON_LONG_PRESS_MOVE_CANCEL_PX * ICON_LONG_PRESS_MOVE_CANCEL_PX) {
          clearIconLongPress();
        }
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      const start = screenToFlowPosition({ x: info.startClientX, y: info.startClientY });
      const curr = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const nextX = info.originX + (curr.x - start.x);
      const nextY = info.originY + (curr.y - start.y);
      if (nextX !== info.originX || nextY !== info.originY) {
        suppressIconClickRef.current = true;
      }
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, position: { x: nextX, y: nextY } } : n))
      );
    },
    [clearIconLongPress, id, screenToFlowPosition, setNodes]
  );

  const onIconPointerUp = useCallback(
    (e) => {
      const wasDragging = iconDragActiveRef.current;
      if (wasDragging) {
        e.preventDefault();
        e.stopPropagation();
        try {
          iconWrapRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      } else {
        // Allow a real double-click; only suppress after an actual long-press drag.
        suppressIconClickRef.current = false;
      }
      endIconDrag();
    },
    [endIconDrag]
  );

  const onIconPointerCancel = useCallback(() => {
    endIconDrag();
    suppressIconClickRef.current = false;
  }, [endIconDrag]);

  const onParentChange = useCallback(
    (parentId) => {
      actions?.setParentForNode?.(id, parentId);
    },
    [actions, id]
  );

  const onKeyTitle = useCallback(
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTitle();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    },
    [commitTitle, cancel]
  );

  const onKeySubtitle = useCallback(
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitSubtitle();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    },
    [commitSubtitle, cancel]
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
        <div className="service-node__row">
          <div
            ref={iconWrapRef}
            className={`service-node__icon-wrap nodrag nopan${iconDragging ? ' service-node__icon-wrap--dragging' : ''}`}
            style={{ background: fill }}
            onPointerDown={onIconPointerDown}
            onPointerMove={onIconPointerMove}
            onPointerUp={onIconPointerUp}
            onPointerCancel={onIconPointerCancel}
            onDoubleClick={onIconDoubleClick}
            title="Hold to drag · Double-click for Parent"
          >
            {spec.kind === 'url' ? (
              <img className="service-node__icon-img" src={spec.url} alt="" draggable={false} />
            ) : (
              <svg className="service-node__icon-svg" viewBox="0 0 24 24" aria-hidden>
                <path fill="#fff" d={spec.path} />
              </svg>
            )}
          </div>
          <div className="service-node__text-col">
            {editing === 'title' ? (
              <input
                className="service-node__input service-node__input--title nodrag"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={onKeyTitle}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                aria-label="Node title"
              />
            ) : (
              <div
                className="service-node__title nodrag nopan"
                onDoubleClick={startEditTitle}
                title="Double-click to edit title"
              >
                {data.label ?? 'Untitled'}
              </div>
            )}
            {editing === 'subtitle' ? (
              <input
                className="service-node__input service-node__input--subtitle nodrag"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitSubtitle}
                onKeyDown={onKeySubtitle}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                aria-label="Node subtitle"
              />
            ) : sub.showRow ? (
              <div
                className={`service-node__subtitle nodrag nopan${sub.isImplicitDefault ? ' service-node__subtitle--default' : ''}`}
                onDoubleClick={startEditSubtitle}
                title="Double-click to edit subtitle"
              >
                {sub.displayText}
              </div>
            ) : (
              <div
                className="service-node__subtitle-hit nodrag nopan"
                onDoubleClick={startEditSubtitle}
                title="Double-click to add subtitle"
              />
            )}
          </div>
        </div>
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
