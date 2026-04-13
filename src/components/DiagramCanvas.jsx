import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  MarkerType,
  ConnectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toPng, toSvg } from 'html-to-image';
import ServiceNode from './ServiceNode.jsx';
import TextNode from './TextNode.jsx';
import GroupNode from './GroupNode.jsx';
import IconPalette, { DND_TYPE } from './IconPalette.jsx';
import { DEFAULT_ICON_KEY } from '../lib/iconRegistry.js';
import { layoutWithDagre } from '../lib/layoutGraph.js';
import { orderNodesParentsFirst } from '../lib/orderNodesByParent.js';
import { computeAlignedPositions, computeDistributedPositions } from '../lib/diagramAlignment.js';
import { duplicateSelection } from '../lib/diagramDuplicate.js';
import { DIAGRAM_TEMPLATES } from '../lib/diagramTemplates.js';
import { pickGroupForDrop, getAbsolutePosition } from '../lib/diagramGeometry.js';
import { TEXT_NOTE_TAGS } from '../lib/textNoteTags.js';
import { DiagramActionsContext } from '../context/DiagramActionsContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import './diagram.css';

/** Minimum export size (UHD 4K) so raster output stays sharp when zoomed in viewers. */
const EXPORT_MIN_WIDTH = 3840;
const EXPORT_MIN_HEIGHT = 2160;
/** Avoid runaway memory on pathological sizes; 48× still reaches 4K from an ~80px-wide panel. */
const EXPORT_MAX_PIXEL_RATIO = 48;

function getEdgePalette(theme) {
  const isLight = theme === 'light';
  const stroke = isLight ? '#475569' : '#64748b';
  return {
    stroke,
    /* Inline dash clears RF’s `.animated` dashed CSS when that class is present */
    style: { stroke, strokeWidth: 2, strokeDasharray: 'none' },
    markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
    labelStyle: { fill: isLight ? '#1e293b' : '#e2e8f0', fontSize: 11, fontWeight: 500 },
    labelBgStyle: { fill: isLight ? '#ffffff' : '#1a1f2e', fillOpacity: 0.95 },
    labelBgPadding: [4, 8],
    labelBgBorderRadius: 6,
  };
}

const nodeTypes = { service: ServiceNode, text: TextNode, group: GroupNode };

const SNAP = 20;

/** Synthetic edge ids: removing them clears `data.parentNodeId` on the child node. */
const PARENT_EDGE_PREFIX = 'parent-link-';

function wouldCreateParentCycle(nodes, nodeId, newParentId) {
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

function nodeMenuLabel(n) {
  if (n.type === 'text') {
    const t = (n.data?.text ?? '').trim().split(/\n/)[0] || 'Text note';
    return t.length > 40 ? `${t.slice(0, 37)}…` : t;
  }
  if (n.type === 'group') return n.data?.label ?? 'Swimlane';
  return n.data?.label ?? 'Service';
}

function buildParentEdges(nodes, edgePalette, manualEdges) {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const manualKey = new Set(manualEdges.map((e) => `${e.source}\t${e.target}`));
  const out = [];
  for (const n of nodes) {
    const pid = n.data?.parentNodeId;
    if (!pid || pid === n.id || !nodeIds.has(pid)) continue;
    const pNode = nodes.find((x) => x.id === pid);
    if (pNode?.type === 'group' || n.type === 'group') continue;
    if (manualKey.has(`${pid}\t${n.id}`)) continue;
    out.push({
      id: `${PARENT_EDGE_PREFIX}${n.id}`,
      source: pid,
      target: n.id,
      sourceHandle: 'pt-bottom',
      targetHandle: 'pt-top',
      type: 'smoothstep',
      animated: false,
      style: { ...edgePalette.style, strokeDasharray: 'none' },
      markerEnd: edgePalette.markerEnd,
      labelStyle: edgePalette.labelStyle,
      labelBgStyle: edgePalette.labelBgStyle,
      labelBgPadding: edgePalette.labelBgPadding,
      labelBgBorderRadius: edgePalette.labelBgBorderRadius,
    });
  }
  return out;
}

let idSeq = 0;
function nextId() {
  return `n-${++idSeq}`;
}

function syncIdSeqFromNodes(nodes) {
  let max = 0;
  for (const n of nodes) {
    const m = String(n.id).match(/^n-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  idSeq = max;
}

function serializeDiagram(nodes, edges) {
  return {
    version: 2,
    nodes: nodes.map((node) => {
      const { id, type, position, data, parentId, extent, style, width, height } = node;
      const t = type || 'service';
      const baseExtra = {
        ...(parentId ? { parentId } : {}),
        ...(extent === 'parent' ? { extent: 'parent' } : {}),
      };
      if (t === 'group') {
        return {
          id,
          type: 'group',
          position,
          data: { label: data?.label ?? 'Region' },
          style: {
            width: style?.width ?? width ?? 480,
            height: style?.height ?? height ?? 320,
          },
          dragHandle: '.group-node__header',
          ...baseExtra,
        };
      }
      if (t === 'text') {
        return {
          id,
          type: 'text',
          position,
          data: {
            text: data?.text ?? '',
            ...(data?.noteTag && data.noteTag !== 'default' ? { noteTag: data.noteTag } : {}),
            ...(data?.parentNodeId ? { parentNodeId: data.parentNodeId } : {}),
          },
          ...baseExtra,
        };
      }
      return {
        id,
        type: 'service',
        position,
        data: {
          label: data?.label ?? 'Service',
          iconKey: data?.iconKey ?? DEFAULT_ICON_KEY,
          ...(data?.parentNodeId ? { parentNodeId: data.parentNodeId } : {}),
        },
        ...baseExtra,
      };
    }),
    edges: edges.map(
      ({ id, source, target, sourceHandle, targetHandle, type, label, style, labelStyle, labelBgStyle }) => ({
        id,
        source,
        target,
        sourceHandle,
        targetHandle,
        type: type || 'smoothstep',
        label,
        style,
        labelStyle,
        labelBgStyle,
      })
    ),
  };
}

function parseDiagramJson(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error('Invalid diagram file: expected nodes and edges arrays.');
  }
  return data;
}

function clientSafeStem(name) {
  const base = String(name ?? '')
    .trim()
    .replace(/[/\\]/g, '')
    .replace(/\.(txt|json)$/i, '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(base)) return null;
  return base;
}

/** Old two-handle-per-side ids → unified per-side `pt-*` ids (see ServiceNode). */
const LEGACY_HANDLE_TO_POINT = {
  't-top': 'pt-top',
  't-right': 'pt-right',
  't-bottom': 'pt-bottom',
  't-left': 'pt-left',
  's-top': 'pt-top',
  's-right': 'pt-right',
  's-bottom': 'pt-bottom',
  's-left': 'pt-left',
};

function migrateEdgeHandles(edge) {
  const src = edge.sourceHandle;
  const tgt = edge.targetHandle;
  const sourceHandle =
    src == null || src === ''
      ? 'pt-bottom'
      : LEGACY_HANDLE_TO_POINT[src] ?? src;
  const targetHandle =
    tgt == null || tgt === ''
      ? 'pt-top'
      : LEGACY_HANDLE_TO_POINT[tgt] ?? tgt;
  return { ...edge, sourceHandle, targetHandle };
}

function diagramDataToFlowState(data, theme) {
  const ep = getEdgePalette(theme);
  const nextNodes = data.nodes.map((n) => {
    const t = n.type || 'service';
    const parentExtra = n.parentId
      ? {
          parentId: String(n.parentId),
          ...(n.extent === 'parent' ? { extent: 'parent' } : {}),
        }
      : {};
    if (t === 'group') {
      const sw = n.style?.width ?? n.width ?? 480;
      const sh = n.style?.height ?? n.height ?? 320;
      const width = typeof sw === 'number' ? sw : Number.parseInt(String(sw), 10) || 480;
      const height = typeof sh === 'number' ? sh : Number.parseInt(String(sh), 10) || 320;
      return {
        id: String(n.id),
        type: 'group',
        position: n.position || { x: 0, y: 0 },
        data: { label: n.data?.label ?? 'Region' },
        style: { width, height },
        zIndex: 0,
        dragHandle: '.group-node__header',
        ...parentExtra,
      };
    }
    if (t === 'text') {
      return {
        id: String(n.id),
        type: 'text',
        position: n.position || { x: 0, y: 0 },
        data: {
          text: n.data?.text ?? n.data?.label ?? 'Double-click to edit',
          ...(n.data?.noteTag ? { noteTag: n.data.noteTag } : {}),
          ...(n.data?.parentNodeId ? { parentNodeId: String(n.data.parentNodeId) } : {}),
        },
        ...parentExtra,
      };
    }
    return {
      id: String(n.id),
      type: 'service',
      position: n.position || { x: 0, y: 0 },
      data: {
        label: n.data?.label ?? 'Service',
        iconKey: n.data?.iconKey ?? DEFAULT_ICON_KEY,
        ...(n.data?.parentNodeId ? { parentNodeId: String(n.data.parentNodeId) } : {}),
      },
      ...parentExtra,
    };
  });
  const nextEdges = data.edges.map((ed, i) =>
    migrateEdgeHandles({
      ...ed,
      id: ed.id != null ? String(ed.id) : `e-${Date.now()}-${i}`,
      type: ed.type || 'smoothstep',
      style: ep.style,
      markerEnd: ep.markerEnd,
      labelStyle: ep.labelStyle,
      labelBgStyle: ep.labelBgStyle,
      labelBgPadding: ep.labelBgPadding,
      labelBgBorderRadius: ep.labelBgBorderRadius,
    })
  );
  return { nextNodes, nextEdges };
}

function FlowWorkspace() {
  const { theme } = useTheme();
  const edgePalette = useMemo(() => getEdgePalette(theme), [theme]);
  const exportCanvasBg = theme === 'light' ? '#e2e8f0' : '#0c0e12';

  const containerRef = useRef(null);
  const importInputRef = useRef(null);
  const { screenToFlowPosition, fitView, getIntersectingNodes, getNodes } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState([]);
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [snapGridEnabled, setSnapGridEnabled] = useState(false);

  const edgesWithParents = useMemo(
    () => [...edges, ...buildParentEdges(nodes, edgePalette, edges)],
    [nodes, edges, edgePalette]
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId) return undefined;
    const manual = edges.find((e) => e.id === selectedEdgeId);
    if (manual) return manual;
    if (String(selectedEdgeId).startsWith(PARENT_EDGE_PREFIX)) {
      return edgesWithParents.find((e) => e.id === selectedEdgeId);
    }
    return undefined;
  }, [edges, edgesWithParents, selectedEdgeId]);

  const onEdgesChange = useCallback(
    (changes) => {
      const parentRemovals = [];
      const rest = [];
      for (const c of changes) {
        if (c.type === 'remove' && String(c.id).startsWith(PARENT_EDGE_PREFIX)) {
          parentRemovals.push(c);
        } else {
          rest.push(c);
        }
      }
      for (const c of parentRemovals) {
        const childId = String(c.id).slice(PARENT_EDGE_PREFIX.length);
        setNodes((nds) =>
          nds.map((n) =>
            n.id === childId ? { ...n, data: { ...n.data, parentNodeId: undefined } } : n
          )
        );
      }
      if (rest.length) onEdgesChangeBase(rest);
    },
    [onEdgesChangeBase, setNodes]
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'smoothstep',
      animated: false,
      style: edgePalette.style,
      markerEnd: edgePalette.markerEnd,
      labelStyle: edgePalette.labelStyle,
      labelBgStyle: edgePalette.labelBgStyle,
      labelBgPadding: edgePalette.labelBgPadding,
      labelBgBorderRadius: edgePalette.labelBgBorderRadius,
    }),
    [edgePalette]
  );

  useEffect(() => {
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        animated: false,
        style: {
          ...(e.style || {}),
          stroke: edgePalette.stroke,
          strokeWidth: e.style?.strokeWidth ?? 2,
          strokeDasharray: 'none',
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgePalette.stroke },
        labelStyle: { ...edgePalette.labelStyle, ...e.labelStyle, fill: edgePalette.labelStyle.fill },
        labelBgStyle: {
          ...edgePalette.labelBgStyle,
          ...e.labelBgStyle,
          fill: edgePalette.labelBgStyle.fill,
          fillOpacity: edgePalette.labelBgStyle.fillOpacity,
        },
      }))
    );
  }, [theme, edgePalette, setEdges]);

  const onConnect = useCallback(
    (params) =>
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: 'smoothstep',
            style: edgePalette.style,
            markerEnd: edgePalette.markerEnd,
            labelStyle: edgePalette.labelStyle,
            labelBgStyle: edgePalette.labelBgStyle,
            labelBgPadding: edgePalette.labelBgPadding,
            labelBgBorderRadius: edgePalette.labelBgBorderRadius,
          },
          eds
        )
      ),
    [setEdges, edgePalette]
  );

  const onSelectionChange = useCallback(({ nodes: sel, edges: selE }) => {
    setSelectedNodeId(sel.length === 1 ? sel[0].id : null);
    setSelectedEdgeId(selE.length === 1 ? selE[0].id : null);
  }, []);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(DND_TYPE);
      if (!raw) return;
      let item;
      try {
        item = JSON.parse(raw);
      } catch {
        return;
      }
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const currentNodes = getNodes();
      const hitRect = { x: position.x - 8, y: position.y - 8, width: 16, height: 16 };
      const under = getIntersectingNodes(hitRect, true, currentNodes);
      const nodeMap = new Map(currentNodes.map((n) => [n.id, n]));
      const swimlane = pickGroupForDrop(under, nodeMap, position);
      const hierarchyParent = [...under]
        .reverse()
        .find((n) => (n.type === 'service' || n.type === 'text') && n.id !== swimlane?.id);
      const id = nextId();

      let newNode;
      if (item.nodeType === 'text') {
        newNode = {
          id,
          type: 'text',
          position: swimlane
            ? {
                x: position.x - getAbsolutePosition(swimlane.id, nodeMap).x,
                y: position.y - getAbsolutePosition(swimlane.id, nodeMap).y,
              }
            : position,
          data: {
            text: 'Type your note…',
            ...(item.noteTag ? { noteTag: item.noteTag } : {}),
            ...(!swimlane && hierarchyParent ? { parentNodeId: hierarchyParent.id } : {}),
          },
          ...(swimlane ? { parentId: swimlane.id, extent: 'parent' } : {}),
        };
      } else {
        newNode = {
          id,
          type: 'service',
          position: swimlane
            ? {
                x: position.x - getAbsolutePosition(swimlane.id, nodeMap).x,
                y: position.y - getAbsolutePosition(swimlane.id, nodeMap).y,
              }
            : position,
          data: {
            label: item.label || 'Service',
            iconKey: item.iconKey || DEFAULT_ICON_KEY,
            ...(!swimlane && hierarchyParent ? { parentNodeId: hierarchyParent.id } : {}),
          },
          ...(swimlane ? { parentId: swimlane.id, extent: 'parent' } : {}),
        };
      }

      setNodes((nds) => orderNodesParentsFirst(nds.concat(newNode)));
    },
    [screenToFlowPosition, setNodes, getNodes, getIntersectingNodes]
  );

  const updateSelectedLabel = useCallback(
    (value) => {
      if (!selectedNodeId) return;
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedNodeId) return n;
          if (n.type === 'text') {
            return { ...n, data: { ...n.data, text: value } };
          }
          return { ...n, data: { ...n.data, label: value } };
        })
      );
    },
    [selectedNodeId, setNodes]
  );

  const updateSelectedNoteTag = useCallback(
    (tag) => {
      if (!selectedNodeId) return;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === selectedNodeId && n.type === 'text'
            ? {
                ...n,
                data: {
                  ...n.data,
                  ...(tag && tag !== 'default' ? { noteTag: tag } : { noteTag: undefined }),
                },
              }
            : n
        )
      );
    },
    [selectedNodeId, setNodes]
  );

  const updateGroupDimensions = useCallback(
    (dim, raw) => {
      if (!selectedNodeId) return;
      const num = Number.parseInt(String(raw), 10);
      if (!Number.isFinite(num) || num < 160) return;
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedNodeId || n.type !== 'group') return n;
          const style = { ...(n.style || {}), [dim]: num };
          return { ...n, style };
        })
      );
    },
    [selectedNodeId, setNodes]
  );

  const setSelectedParent = useCallback(
    (parentId) => {
      if (!selectedNodeId) return;
      const sel = nodes.find((x) => x.id === selectedNodeId);
      if (sel?.type === 'group') return;
      const next = parentId || undefined;
      if (next && wouldCreateParentCycle(nodes, selectedNodeId, next)) return;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === selectedNodeId ? { ...n, data: { ...n.data, parentNodeId: next } } : n
        )
      );
    },
    [selectedNodeId, nodes, setNodes]
  );

  const updateSelectedEdgeLabel = useCallback(
    (label) => {
      if (!selectedEdgeId || String(selectedEdgeId).startsWith(PARENT_EDGE_PREFIX)) return;
      const trimmed = label.trim();
      setEdges((eds) =>
        eds.map((e) =>
          e.id === selectedEdgeId
            ? {
                ...e,
                label: trimmed || undefined,
                labelStyle: edgePalette.labelStyle,
                labelBgStyle: edgePalette.labelBgStyle,
                labelBgPadding: edgePalette.labelBgPadding,
                labelBgBorderRadius: edgePalette.labelBgBorderRadius,
              }
            : e
        )
      );
    },
    [selectedEdgeId, setEdges, edgePalette]
  );

  const runAutoLayout = useCallback(() => {
    setNodes((nds) => layoutWithDagre(nds, edgesWithParents, 'TB'));
    window.setTimeout(() => {
      fitView({ padding: 0.2, duration: 280 });
    }, 120);
  }, [edgesWithParents, setNodes, fitView]);

  const clearCanvas = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    idSeq = 0;
  }, [setNodes, setEdges]);

  const renameNodeById = useCallback(
    (nodeId, value) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          if (n.type === 'text') {
            return { ...n, data: { ...n.data, text: value } };
          }
          return { ...n, data: { ...n.data, label: value } };
        })
      );
    },
    [setNodes]
  );

  const applyTemplate = useCallback(
    (templateId) => {
      const t = DIAGRAM_TEMPLATES.find((x) => x.id === templateId);
      if (!t) return;
      const built = t.build(nextId);
      const rect = containerRef.current?.getBoundingClientRect();
      const origin = rect
        ? screenToFlowPosition({ x: rect.left + 100, y: rect.top + 100 })
        : { x: 80, y: 80 };
      const minx = Math.min(...built.nodes.map((n) => n.position.x));
      const miny = Math.min(...built.nodes.map((n) => n.position.y));
      const shifted = built.nodes.map((n) => ({
        ...n,
        position: { x: n.position.x - minx + origin.x, y: n.position.y - miny + origin.y },
      }));
      const newEdges = built.edges.map((e) => ({
        ...e,
        type: 'smoothstep',
        animated: false,
        style: edgePalette.style,
        markerEnd: edgePalette.markerEnd,
        labelStyle: edgePalette.labelStyle,
        labelBgStyle: edgePalette.labelBgStyle,
        labelBgPadding: edgePalette.labelBgPadding,
        labelBgBorderRadius: edgePalette.labelBgBorderRadius,
      }));
      setNodes((nds) => {
        const merged = orderNodesParentsFirst([...nds, ...shifted]);
        syncIdSeqFromNodes(merged);
        return merged;
      });
      setEdges((eds) => [...eds, ...newEdges]);
      window.setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 80);
    },
    [screenToFlowPosition, setNodes, setEdges, edgePalette, fitView]
  );

  const insertSwimlane = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const center = screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    const w = 520;
    const h = 360;
    const swim = {
      id: nextId(),
      type: 'group',
      position: { x: center.x - w / 2, y: center.y - h / 2 },
      data: { label: 'Swimlane' },
      style: { width: w, height: h },
      zIndex: 0,
      dragHandle: '.group-node__header',
    };
    setNodes((nds) => {
      const merged = orderNodesParentsFirst([...nds, swim]);
      syncIdSeqFromNodes(merged);
      return merged;
    });
  }, [screenToFlowPosition, setNodes]);

  const applyAlign = useCallback(
    (mode) => {
      const sel = getNodes().filter((n) => n.selected);
      const map = computeAlignedPositions(sel, mode);
      if (map.size === 0) return;
      setNodes((nds) =>
        nds.map((n) => {
          const p = map.get(n.id);
          return p ? { ...n, position: { x: p.x, y: p.y } } : n;
        })
      );
    },
    [getNodes, setNodes]
  );

  const applyDistribute = useCallback(
    (axis) => {
      const sel = getNodes().filter((n) => n.selected);
      const map = computeDistributedPositions(sel, axis);
      if (map.size === 0) return;
      setNodes((nds) =>
        nds.map((n) => {
          const p = map.get(n.id);
          return p ? { ...n, position: { x: p.x, y: p.y } } : n;
        })
      );
    },
    [getNodes, setNodes]
  );

  const duplicateSelected = useCallback(() => {
    const nds = getNodes();
    const dup = duplicateSelection(nds, edgesRef.current, nextId);
    if (!dup) return;
    const cleared = nds.map((n) => ({ ...n, selected: false }));
    const merged = orderNodesParentsFirst([...cleared, ...dup.clones]);
    syncIdSeqFromNodes(merged);
    setNodes(merged);
    setEdges((eds) => [...eds, ...dup.newEdges]);
  }, [getNodes, setNodes, setEdges]);

  const onNodeDragStop = useCallback(
    (_e, node) => {
      if (!snapGridEnabled) return;
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== node.id) return n;
          return {
            ...n,
            position: {
              x: Math.round(n.position.x / SNAP) * SNAP,
              y: Math.round(n.position.y / SNAP) * SNAP,
            },
          };
        })
      );
    },
    [snapGridEnabled, setNodes]
  );

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const sel = getNodes().filter((n) => n.selected);
      if (sel.length === 0) return;
      e.preventDefault();
      const step = e.shiftKey ? 8 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      setNodes((nds) =>
        nds.map((n) =>
          n.selected ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n
        )
      );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [getNodes, setNodes, duplicateSelected]);

  const diagramActions = useMemo(
    () => ({ renameNodeById, applyTemplate, insertSwimlane }),
    [renameNodeById, applyTemplate, insertSwimlane]
  );

  const downloadBlob = (blob, filename) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportFilter = (node) => {
    if (!(node instanceof HTMLElement)) return true;
    /* Hide per-side connection handles (the 4 dots) on service/text nodes in PNG/SVG. */
    if (node.closest('.react-flow__handle')) return false;
    const cls = node.classList;
    if (cls.contains('react-flow__controls')) return false;
    if (cls.contains('react-flow__minimap')) return false;
    if (cls.contains('react-flow__panel')) return false;
    if (cls.contains('diagram-floating-toolbar')) return false;
    return true;
  };

  const getFlowRoot = () => containerRef.current?.querySelector('.react-flow');

  const getExportPixelRatio = (el) => {
    const rect = el.getBoundingClientRect();
    const w = Math.max(rect.width, 1);
    const h = Math.max(rect.height, 1);
    const need = Math.max(EXPORT_MIN_WIDTH / w, EXPORT_MIN_HEIGHT / h, 1);
    return Math.min(need, EXPORT_MAX_PIXEL_RATIO);
  };

  const exportPng = async () => {
    const el = getFlowRoot();
    if (!el) return;
    const pixelRatio = getExportPixelRatio(el);
    const dataUrl = await toPng(el, {
      cacheBust: true,
      backgroundColor: exportCanvasBg,
      pixelRatio,
      filter: exportFilter,
    });
    const res = await fetch(dataUrl);
    downloadBlob(await res.blob(), 'diagram.png');
  };

  const exportSvg = async () => {
    const el = getFlowRoot();
    if (!el) return;
    const dataUrl = await toSvg(el, {
      cacheBust: true,
      backgroundColor: exportCanvasBg,
      filter: exportFilter,
    });
    const res = await fetch(dataUrl);
    downloadBlob(await res.blob(), 'diagram.svg');
  };

  const exportJson = () => {
    const json = JSON.stringify(serializeDiagram(nodes, edges), null, 2);
    downloadBlob(new Blob([json], { type: 'application/json' }), 'diagram.json');
  };

  const applyDiagramData = useCallback(
    (data) => {
      const { nextNodes, nextEdges } = diagramDataToFlowState(data, theme);
      const ordered = orderNodesParentsFirst(nextNodes);
      setNodes(ordered);
      setEdges(nextEdges);
      syncIdSeqFromNodes(ordered);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    },
    [setNodes, setEdges, theme]
  );

  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const data = parseDiagramJson(text);
      applyDiagramData(data);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not import diagram.');
    }
  };

  const [serverFiles, setServerFiles] = useState([]);
  const [serverStem, setServerStem] = useState('my-diagram');
  const [loadStem, setLoadStem] = useState('');
  const [serverMsg, setServerMsg] = useState('');
  const [serverBusy, setServerBusy] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const refreshServerFiles = useCallback(async () => {
    try {
      const r = await fetch('/api/diagrams');
      if (!r.ok) throw new Error('Could not list saved diagrams');
      setServerFiles(await r.json());
      setServerMsg((m) => (m.startsWith('Server unavailable') ? '' : m));
    } catch {
      setServerFiles([]);
      setServerMsg('Server unavailable — run npm run dev:all or npm start, then refresh.');
    }
  }, []);

  useEffect(() => {
    refreshServerFiles();
  }, [refreshServerFiles]);

  const saveDiagramToServer = async () => {
    const stem = clientSafeStem(serverStem);
    if (!stem) {
      alert('Use a valid name: start with a letter or number; only letters, numbers, . _ -');
      return;
    }
    const payload = (withReplace) => ({
      name: stem,
      diagram: serializeDiagram(nodes, edges),
      ...(withReplace ? { replace: true } : {}),
    });
    setServerBusy(true);
    try {
      let r = await fetch('/api/diagrams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(false)),
      });
      let j = await r.json().catch(() => ({}));
      if (r.status === 409 && j.exists) {
        const ok = window.confirm(
          `exportedfiles/${stem}.txt already exists.\n\nReplace it? The current file will be copied to exportedfiles/.backups/ first.\n\nOK — replace with backup\nCancel — do not save`
        );
        if (!ok) {
          setServerMsg(`Save cancelled — ${stem}.txt was not changed.`);
          return;
        }
        r = await fetch('/api/diagrams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload(true)),
        });
        j = await r.json().catch(() => ({}));
      }
      if (!r.ok) throw new Error(j.error || r.statusText);
      const savedPath = `exportedfiles/${stem}.txt`;
      setServerMsg(
        j.backupPath ? `Saved ${savedPath} (previous copy: ${j.backupPath})` : `Saved ${savedPath}`
      );
      await refreshServerFiles();
      setLoadStem(stem);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setServerBusy(false);
    }
  };

  const loadDiagramFromServer = async () => {
    const stem = clientSafeStem(loadStem);
    if (!stem) {
      alert('Pick a saved file or enter a valid name.');
      return;
    }
    setServerBusy(true);
    try {
      const r = await fetch(`/api/diagrams/${encodeURIComponent(stem)}`);
      const text = await r.text();
      if (!r.ok) {
        let msg = text;
        try {
          msg = JSON.parse(text).error || msg;
        } catch {
          /* plain text */
        }
        throw new Error(msg);
      }
      const data = parseDiagramJson(text);
      applyDiagramData(data);
      setServerMsg(`Loaded exportedfiles/${stem}.txt`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setServerBusy(false);
    }
  };

  return (
    <DiagramActionsContext.Provider value={diagramActions}>
      <div className="diagram-workspace">
        <IconPalette />
        <div
          className="diagram-flow-wrap"
          ref={containerRef}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edgesWithParents}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            onSelectionChange={onSelectionChange}
            nodeTypes={nodeTypes}
            colorMode={theme === 'dark' ? 'dark' : 'light'}
            connectionMode={ConnectionMode.Loose}
            snapToGrid={snapGridEnabled}
            snapGrid={[SNAP, SNAP]}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            defaultEdgeOptions={defaultEdgeOptions}
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={['Backspace', 'Delete']}
            selectionKeyCode="Shift"
            multiSelectionKeyCode="Shift"
          >
            <Controls className="diagram-controls" />
            <MiniMap
              className="diagram-minimap"
              nodeStrokeWidth={2}
              zoomable
              pannable
            />
          </ReactFlow>
          <div className="diagram-floating-toolbar">
            <label className="diagram-toolbar__snap">
              <input
                type="checkbox"
                checked={snapGridEnabled}
                onChange={(e) => setSnapGridEnabled(e.target.checked)}
              />
              Snap 20
            </label>
            <span className="diagram-toolbar__sep" aria-hidden />
            <button type="button" onClick={() => applyAlign('left')} title="Align left (2+ nodes, same parent)">
              ◀
            </button>
            <button type="button" onClick={() => applyAlign('centerH')} title="Align center H">
              ↔
            </button>
            <button type="button" onClick={() => applyAlign('right')} title="Align right">
              ▶
            </button>
            <button type="button" onClick={() => applyAlign('top')} title="Align top">
              ▲
            </button>
            <button type="button" onClick={() => applyAlign('centerV')} title="Align center V">
              ↕
            </button>
            <button type="button" onClick={() => applyAlign('bottom')} title="Align bottom">
              ▼
            </button>
            <button
              type="button"
              onClick={() => applyDistribute('horizontal')}
              title="Distribute horizontally (3+ nodes)"
            >
              ═
            </button>
            <button
              type="button"
              onClick={() => applyDistribute('vertical')}
              title="Distribute vertically (3+ nodes)"
            >
              ‖
            </button>
            <span className="diagram-toolbar__sep" aria-hidden />
            <button
              type="button"
              onClick={duplicateSelected}
              title="Duplicate selection (⌘D / Ctrl+D)"
            >
              Dup
            </button>
            <span className="diagram-toolbar__sep" aria-hidden />
            <button type="button" onClick={runAutoLayout} title="Hierarchical layout (top → bottom)">
              Layout
            </button>
            <button
              type="button"
              onClick={exportPng}
              title={`PNG raster at least ${EXPORT_MIN_WIDTH}×${EXPORT_MIN_HEIGHT} px (pixel ratio capped at ${EXPORT_MAX_PIXEL_RATIO}× for very small canvases)`}
            >
              PNG 4K
            </button>
            <button
              type="button"
              onClick={exportSvg}
              title="Vector SVG; scales cleanly in design tools (use PNG 4K for fixed high-res raster)"
            >
              SVG
            </button>
            <button type="button" onClick={exportJson}>
              JSON
            </button>
            <button type="button" onClick={() => importInputRef.current?.click()}>
              Import
            </button>
            <button type="button" className="diagram-toolbar__danger" onClick={clearCanvas}>
              Clear
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json,text/plain,.txt"
              hidden
              onChange={onImportFile}
            />
          </div>
        </div>
        <div
          className={`diagram-inspector-shell${inspectorOpen ? '' : ' diagram-inspector-shell--collapsed'}`}
        >
          <button
            type="button"
            id="diagram-inspector-toggle"
            className="diagram-inspector-toggle"
            onClick={() => setInspectorOpen((o) => !o)}
            title={inspectorOpen ? 'Hide side panel (more room for the canvas)' : 'Show Selection & exportedfiles'}
            aria-expanded={inspectorOpen}
            aria-controls="diagram-inspector-panel"
          >
            <span className="diagram-inspector-toggle__chevron" aria-hidden>
              {inspectorOpen ? '‹' : '›'}
            </span>
            <span className="diagram-inspector-toggle__label">Selection</span>
          </button>
          <aside className="diagram-inspector" id="diagram-inspector-panel">
          <h3>Selection</h3>
          {selectedNode ? (
            <>
              {selectedNode.type === 'group' ? (
                <>
                  <label className="diagram-inspector__field">
                    <span>Swimlane title</span>
                    <input
                      type="text"
                      value={selectedNode.data.label ?? ''}
                      onChange={(e) => updateSelectedLabel(e.target.value)}
                    />
                  </label>
                  <label className="diagram-inspector__field">
                    <span>Width (px)</span>
                    <input
                      type="number"
                      min={160}
                      className="nodrag"
                      value={
                        typeof selectedNode.style?.width === 'number'
                          ? selectedNode.style.width
                          : Number.parseInt(String(selectedNode.style?.width ?? 480), 10) || 480
                      }
                      onChange={(e) => updateGroupDimensions('width', e.target.value)}
                    />
                  </label>
                  <label className="diagram-inspector__field">
                    <span>Height (px)</span>
                    <input
                      type="number"
                      min={160}
                      className="nodrag"
                      value={
                        typeof selectedNode.style?.height === 'number'
                          ? selectedNode.style.height
                          : Number.parseInt(String(selectedNode.style?.height ?? 320), 10) || 320
                      }
                      onChange={(e) => updateGroupDimensions('height', e.target.value)}
                    />
                  </label>
                  <p className="diagram-inspector__hint">
                    Drag services or notes <strong>into</strong> this frame to keep them grouped. Layout skips
                    swimlane contents.
                  </p>
                </>
              ) : selectedNode.type === 'text' ? (
                <>
                  <label className="diagram-inspector__field">
                    <span>Text</span>
                    <textarea
                      className="diagram-inspector__textarea nodrag"
                      rows={8}
                      value={selectedNode.data.text ?? ''}
                      onChange={(e) => updateSelectedLabel(e.target.value)}
                      placeholder="Multi-line note on the diagram…"
                    />
                  </label>
                  <label className="diagram-inspector__field">
                    <span>Note tag</span>
                    <select
                      className="nodrag"
                      value={selectedNode.data.noteTag ?? 'default'}
                      onChange={(e) => updateSelectedNoteTag(e.target.value)}
                    >
                      {TEXT_NOTE_TAGS.map((tag) => (
                        <option key={tag.id} value={tag.id}>
                          {tag.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="diagram-inspector__hint">
                    Double-click the box on the canvas to edit inline. Tags add a colored callout style.
                  </p>
                </>
              ) : (
                <>
                  <label className="diagram-inspector__field">
                    <span>Node label</span>
                    <input
                      type="text"
                      value={selectedNode.data.label ?? ''}
                      onChange={(e) => updateSelectedLabel(e.target.value)}
                    />
                  </label>
                  <p className="diagram-inspector__hint">
                    Or double-click the node on the canvas. Icon is fixed unless you replace the node from the
                    library.
                  </p>
                </>
              )}
              {selectedNode.type !== 'group' ? (
                <>
                  <label className="diagram-inspector__field">
                    <span>Parent (hierarchy)</span>
                    <select
                      className="nodrag"
                      value={selectedNode.data.parentNodeId ?? ''}
                      onChange={(e) => setSelectedParent(e.target.value)}
                    >
                      <option value="">None</option>
                      {nodes
                        .filter((n) => n.id !== selectedNode.id)
                        .filter((n) => n.type !== 'group')
                        .filter((n) => !wouldCreateParentCycle(nodes, selectedNode.id, n.id))
                        .map((n) => (
                          <option key={n.id} value={n.id}>
                            {nodeMenuLabel(n)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className="diagram-inspector__hint">
                    Draws an arrow from parent (bottom) to this node (top). Drop icons onto a swimlane to place
                    them inside the frame.
                  </p>
                </>
              ) : null}
            </>
          ) : selectedEdge ? (
            String(selectedEdge.id).startsWith(PARENT_EDGE_PREFIX) ? (
              <p className="diagram-inspector__hint">
                This is the automatic <strong>parent</strong> link. Change it under the child node’s{' '}
                <strong>Parent</strong> field, or select this edge and press Delete to clear the parent.
              </p>
            ) : (
              <>
                <label className="diagram-inspector__field">
                  <span>Edge label (e.g. API name)</span>
                  <input
                    type="text"
                    value={selectedEdge.label ?? ''}
                    placeholder="HTTPS / gRPC / topic name…"
                    onChange={(e) => updateSelectedEdgeLabel(e.target.value)}
                  />
                </label>
                <p className="diagram-inspector__hint">
                  Appears on the connector. Leave empty to hide the label.
                </p>
              </>
            )
          ) : (
            <p className="diagram-inspector__empty">
              Select a single node or edge to edit its label or text.
            </p>
          )}

          <div className="diagram-server-store">
            <h3 className="diagram-server-store__title">exportedfiles</h3>
            <p className="diagram-server-store__intro">
              Diagrams are stored as <code>.txt</code> files (JSON) under <code>exportedfiles/</code> on the
              machine running the server.
            </p>
            <label className="diagram-inspector__field">
              <span>Save as</span>
              <input
                type="text"
                value={serverStem}
                onChange={(e) => setServerStem(e.target.value)}
                placeholder="my-diagram"
                disabled={serverBusy}
              />
            </label>
            <button
              type="button"
              className="diagram-server-store__btn"
              onClick={saveDiagramToServer}
              disabled={serverBusy}
            >
              Save to folder
            </button>
            <label className="diagram-inspector__field diagram-server-store__load">
              <span>Load saved</span>
              <input
                type="text"
                list="diagram-saved-list"
                value={loadStem}
                onChange={(e) => setLoadStem(e.target.value)}
                placeholder="name or pick from list"
                disabled={serverBusy}
              />
              <datalist id="diagram-saved-list">
                {serverFiles.map((f) => (
                  <option key={f.stem} value={f.stem} />
                ))}
              </datalist>
            </label>
            <div className="diagram-server-store__row">
              <button
                type="button"
                className="diagram-server-store__btn"
                onClick={loadDiagramFromServer}
                disabled={serverBusy}
              >
                Load from folder
              </button>
              <button
                type="button"
                className="diagram-server-store__btn diagram-server-store__btn--ghost"
                onClick={refreshServerFiles}
                disabled={serverBusy}
                title="Refresh list from server"
              >
                Refresh
              </button>
            </div>
            {serverMsg ? <p className="diagram-server-store__msg">{serverMsg}</p> : null}
          </div>

          <div className="diagram-inspector__help">
            <h4>Tips</h4>
            <ul>
              <li>{'Drag from a node handle to another node\u2019s handle to connect (any side).'}</li>
              <li>
                Use <strong>Parent</strong> on a selected node (or drop an icon onto another) for a hierarchy
                line without drawing it by hand.
              </li>
              <li>
                <strong>Layout</strong> arranges the graph automatically (Dagre, top → bottom).
              </li>
              <li>
                <strong>Double-click</strong> a service node to rename it (Enter saves, Esc cancels);{' '}
                <strong>Text note</strong> nodes use a multi-line editor (Esc cancels).
              </li>
              <li>
                <strong>PNG 4K</strong> exports at least UHD resolution so zoomed screenshots stay sharp.
              </li>
              <li>Click an edge to add a dependency / API name label.</li>
              <li>Shift-click to multi-select; Backspace deletes selection.</li>
              <li>
                <strong>Snap 20</strong> snaps nodes to a grid after drag. Align / distribute tools need 2+ or 3+
                selected nodes in the <strong>same parent</strong> (canvas or same swimlane). Arrow keys nudge
                (Shift = 8px). <strong>⌘D / Ctrl+D</strong> duplicates selection.
              </li>
              <li>
                <strong>Templates</strong> and <strong>+ Swimlane</strong> live in the library panel; JSON export
                is version 2 for swimlanes and note tags.
              </li>
              <li>JSON export includes layout and icons for round-trip editing.</li>
              <li>
                For server save/load, run <code>npm run dev:all</code> (Vite + API) or{' '}
                <code>npm start</code> after build.
              </li>
            </ul>
          </div>
        </aside>
        </div>
      </div>
    </DiagramActionsContext.Provider>
  );
}

export default function DiagramCanvas() {
  return (
    <ReactFlowProvider>
      <FlowWorkspace />
    </ReactFlowProvider>
  );
}
