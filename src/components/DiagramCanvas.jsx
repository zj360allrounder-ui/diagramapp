import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { DEFAULT_ICON_KEY, resolveIcon } from '../lib/iconRegistry.js';
import { layoutWithDagre } from '../lib/layoutGraph.js';
import { orderNodesParentsFirst } from '../lib/orderNodesByParent.js';
import { computeAlignedPositions, computeDistributedPositions } from '../lib/diagramAlignment.js';
import { duplicateSelection } from '../lib/diagramDuplicate.js';
import { DIAGRAM_TEMPLATES } from '../lib/diagramTemplates.js';
import { pickGroupForDrop, getAbsolutePosition } from '../lib/diagramGeometry.js';
import { TEXT_NOTE_TAGS } from '../lib/textNoteTags.js';
import { filterNodesByQuery, metaFieldsForExport, metaFieldsFromImport } from '../lib/nodeSearch.js';
import { nodeMenuLabel, wouldCreateParentCycle } from '../lib/diagramParentUtils.js';
import ParentHierarchyPicker from './ParentHierarchyPicker.jsx';
import HeaderDiagramServerToolbar from './HeaderDiagramServerToolbar.jsx';
import { DiagramActionsContext } from '../context/DiagramActionsContext.jsx';
import { useHeaderToolbarHost } from '../context/HeaderToolbarHostContext.jsx';
import { useServerWorkspace } from '../context/ServerWorkspaceContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { clientSafeWorkspace } from '../lib/serverWorkspace.js';
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

/** Browser localStorage key for crash recovery (not a substitute for server save). */
const DRAFT_STORAGE_KEY = 'zarus-diag-studio-local-draft-v1';
const LEGACY_DRAFT_STORAGE_KEY = 'jarus-diagram-local-draft-v1';
const AUTOSAVE_DEBOUNCE_MS = 1200;
/** Written into each local draft; pre-fills Save as / Load after a refresh. */
const AUTOSAVE_DIAGRAM_NAME = 'autosave';

/** Synthetic edge ids: removing them clears `data.parentNodeId` on the child node. */
const PARENT_EDGE_PREFIX = 'parent-link-';

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

/**
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 * @param {{ omitServiceParentHierarchy?: boolean }} [options] If true, service (icon) nodes omit `parentNodeId` in JSON / server files.
 */
function serializeDiagram(nodes, edges, options = {}) {
  const omitServiceParent = options.omitServiceParentHierarchy === true;
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
          data: { label: data?.label ?? 'Region', ...metaFieldsForExport(data) },
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
            ...metaFieldsForExport(data),
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
          ...(Object.prototype.hasOwnProperty.call(data ?? {}, 'subtitle')
            ? { subtitle: typeof data?.subtitle === 'string' ? data.subtitle : '' }
            : {}),
          ...(!omitServiceParent && data?.parentNodeId ? { parentNodeId: data.parentNodeId } : {}),
          ...metaFieldsForExport(data),
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
        data: { label: n.data?.label ?? 'Region', ...metaFieldsFromImport(n.data) },
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
          ...metaFieldsFromImport(n.data),
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
        ...(Object.prototype.hasOwnProperty.call(n.data ?? {}, 'subtitle')
          ? { subtitle: typeof n.data?.subtitle === 'string' ? n.data.subtitle : '' }
          : {}),
        ...(n.data?.parentNodeId ? { parentNodeId: String(n.data.parentNodeId) } : {}),
        ...metaFieldsFromImport(n.data),
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
  const { mount: headerToolbarMount } = useHeaderToolbarHost();
  const edgePalette = useMemo(() => getEdgePalette(theme), [theme]);
  const exportCanvasBg = theme === 'light' ? '#e2e8f0' : '#0c0e12';

  const containerRef = useRef(null);
  const importInputRef = useRef(null);
  const checkpointRef = useRef(JSON.stringify(serializeDiagram([], [])));
  const dirtyRef = useRef(false);
  const recoveryCheckedRef = useRef(false);
  const { screenToFlowPosition, fitView, getIntersectingNodes, getNodes } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState([]);
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const nodesEdgesAutosaveRef = useRef({ nodes, edges });
  useEffect(() => {
    nodesEdgesAutosaveRef.current = { nodes, edges };
  }, [nodes, edges]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [snapGridEnabled, setSnapGridEnabled] = useState(false);
  /** Service node: show on-canvas Parent combobox after double-click icon (toggle). */
  const [serviceParentUiNodeId, setServiceParentUiNodeId] = useState(null);
  const [findQuery, setFindQuery] = useState('');

  const [serverFiles, setServerFiles] = useState([]);
  const [serverWorkspaces, setServerWorkspaces] = useState(['default']);
  const { serverWorkspace, setServerWorkspace } = useServerWorkspace();
  const workspaceAutosaveRef = useRef(serverWorkspace);
  useEffect(() => {
    workspaceAutosaveRef.current = serverWorkspace;
  }, [serverWorkspace]);
  /** After first list sync, debounce refetches while the workspace field is edited. */
  const workspaceListSyncCountRef = useRef(0);
  const [serverStem, setServerStem] = useState('my-diagram');
  const [loadStem, setLoadStem] = useState('');
  const [serverMsg, setServerMsg] = useState('');
  const [serverBusy, setServerBusy] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [dirty, setDirty] = useState(false);
  /** After auto-restore from localStorage; dismissible notice (restore already applied). */
  const [autosaveRestoreNotice, setAutosaveRestoreNotice] = useState(null);
  const [autosaveLocalEnabled, setAutosaveLocalEnabled] = useState(true);
  const [lastLocalSaveAt, setLastLocalSaveAt] = useState(null);

  const commitCheckpoint = useCallback((nodesArr, edgesArr) => {
    checkpointRef.current = JSON.stringify(serializeDiagram(nodesArr, edgesArr));
    setDirty(false);
    dirtyRef.current = false;
  }, []);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    const sig = JSON.stringify(serializeDiagram(nodes, edges));
    const isDirty = sig !== checkpointRef.current;
    setDirty(isDirty);
    dirtyRef.current = isDirty;
  }, [nodes, edges]);

  const flushDraftToStorage = useCallback(() => {
    if (!autosaveLocalEnabled) return;
    try {
      const { nodes: n, edges: ed } = nodesEdgesAutosaveRef.current;
      const ws = clientSafeWorkspace(workspaceAutosaveRef.current) || 'default';
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          name: AUTOSAVE_DIAGRAM_NAME,
          workspace: ws,
          diagram: serializeDiagram(n, ed),
        })
      );
      setLastLocalSaveAt(Date.now());
    } catch {
      /* quota or private mode */
    }
  }, [autosaveLocalEnabled]);

  useEffect(() => {
    if (!autosaveLocalEnabled) return;
    const t = window.setTimeout(() => {
      try {
        const ws = clientSafeWorkspace(serverWorkspace) || 'default';
        localStorage.setItem(
          DRAFT_STORAGE_KEY,
          JSON.stringify({
            savedAt: Date.now(),
            name: AUTOSAVE_DIAGRAM_NAME,
            workspace: ws,
            diagram: serializeDiagram(nodes, edges),
          })
        );
        setLastLocalSaveAt(Date.now());
      } catch {
        /* quota or private mode */
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [nodes, edges, serverWorkspace, autosaveLocalEnabled]);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      flushDraftToStorage();
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flushDraftToStorage]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushDraftToStorage();
    };
    const onPageHide = () => flushDraftToStorage();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flushDraftToStorage]);

  const applyDiagramData = useCallback(
    (data) => {
      const { nextNodes, nextEdges } = diagramDataToFlowState(data, theme);
      const ordered = orderNodesParentsFirst(nextNodes);
      setNodes(ordered);
      setEdges(nextEdges);
      syncIdSeqFromNodes(ordered);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      commitCheckpoint(ordered, nextEdges);
    },
    [setNodes, setEdges, theme, commitCheckpoint]
  );

  useEffect(() => {
    if (recoveryCheckedRef.current) return;
    recoveryCheckedRef.current = true;
    try {
      let raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      let fromLegacyDraft = false;
      if (!raw) {
        raw = localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY);
        fromLegacyDraft = true;
      }
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const diagram = parsed?.diagram;
      if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return;
      if (diagram.nodes.length === 0 && diagram.edges.length === 0) return;
      const name =
        typeof parsed.name === 'string' && parsed.name.trim()
          ? parsed.name.trim()
          : AUTOSAVE_DIAGRAM_NAME;
      const draftWs =
        typeof parsed.workspace === 'string' && parsed.workspace.trim()
          ? clientSafeWorkspace(parsed.workspace.trim())
          : null;
      if (draftWs) {
        setServerWorkspace(draftWs);
      }
      applyDiagramData(diagram);
      setServerStem(name);
      setLoadStem(name);
      setAutosaveRestoreNotice({
        savedAt: Number(parsed.savedAt) || Date.now(),
        name,
        ...(draftWs ? { workspace: draftWs } : {}),
      });
      if (fromLegacyDraft) {
        try {
          localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }, [applyDiagramData, setServerWorkspace]);

  const dismissAutosaveNotice = useCallback(() => setAutosaveRestoreNotice(null), []);

  const discardAutosavedDiagram = useCallback(() => {
    setAutosaveRestoreNotice(null);
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    idSeq = 0;
    commitCheckpoint([], []);
    setServerStem('my-diagram');
    setLoadStem('');
  }, [setNodes, setEdges, commitCheckpoint]);

  const clearCanvas = useCallback(() => {
    if (dirtyRef.current) {
      const ok = window.confirm(
        'Discard unsaved changes? This clears the canvas and removes the local draft snapshot.'
      );
      if (!ok) return;
    }
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    idSeq = 0;
    commitCheckpoint([], []);
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [setNodes, setEdges, commitCheckpoint]);

  const findMatches = useMemo(
    () => filterNodesByQuery(nodes, findQuery).slice(0, 14),
    [nodes, findQuery]
  );

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

  const updateSelectedSubtitle = useCallback(
    (value) => {
      if (!selectedNodeId) return;
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedNodeId || n.type !== 'service') return n;
          const spec = resolveIcon(n.data?.iconKey ?? DEFAULT_ICON_KEY);
          const defaultLine = spec.title;
          const t = String(value ?? '').trim();
          const nextData = { ...n.data };
          if (t === '') {
            nextData.subtitle = '';
          } else if (t === defaultLine) {
            delete nextData.subtitle;
          } else {
            nextData.subtitle = t;
          }
          return { ...n, data: nextData };
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

  const updateSelectedMeta = useCallback(
    (field, value) => {
      if (!selectedNodeId) return;
      const v = String(value).trim();
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedNodeId) return n;
          const nextData = { ...n.data };
          if (v) nextData[field] = v;
          else delete nextData[field];
          return { ...n, data: nextData };
        })
      );
    },
    [selectedNodeId, setNodes]
  );

  const focusNodeById = useCallback(
    (id) => {
      setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
      setSelectedNodeId(id);
      setSelectedEdgeId(null);
      setFindQuery('');
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          fitView({ nodes: [{ id }], padding: 0.5, duration: 420, maxZoom: 1.35 }).catch(() => {});
        }, 80);
      });
    },
    [setNodes, fitView]
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

  const setParentForNode = useCallback(
    (childNodeId, parentId) => {
      const child = nodes.find((x) => x.id === childNodeId);
      if (!child || child.type === 'group') return;
      const next = (parentId || '').trim() || undefined;
      if (next && wouldCreateParentCycle(nodes, childNodeId, next)) return;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === childNodeId ? { ...n, data: { ...n.data, parentNodeId: next } } : n
        )
      );
    },
    [nodes, setNodes]
  );

  const setSelectedParent = useCallback(
    (parentId) => {
      if (!selectedNodeId) return;
      setParentForNode(selectedNodeId, parentId);
    },
    [selectedNodeId, setParentForNode]
  );

  const toggleServiceParentUi = useCallback((nodeId) => {
    setSelectedEdgeId(null);
    setSelectedNodeId(nodeId);
    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === nodeId })));
    setServiceParentUiNodeId((prev) => (prev === nodeId ? null : nodeId));
  }, [setNodes]);

  useEffect(() => {
    if (!serviceParentUiNodeId) return;
    if (selectedNodeId !== serviceParentUiNodeId) {
      setServiceParentUiNodeId(null);
    }
  }, [selectedNodeId, serviceParentUiNodeId]);

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

  const setServiceNodeSubtitleById = useCallback(
    (nodeId, raw) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId || n.type !== 'service') return n;
          const spec = resolveIcon(n.data?.iconKey ?? DEFAULT_ICON_KEY);
          const defaultLine = spec.title;
          const t = String(raw ?? '').trim();
          const nextData = { ...n.data };
          if (t === '') {
            nextData.subtitle = '';
          } else if (t === defaultLine) {
            delete nextData.subtitle;
          } else {
            nextData.subtitle = t;
          }
          return { ...n, data: nextData };
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
    () => ({
      renameNodeById,
      setServiceNodeSubtitleById,
      setParentForNode,
      toggleServiceParentUi,
      serviceParentUiNodeId,
      applyTemplate,
      insertSwimlane,
    }),
    [
      renameNodeById,
      setServiceNodeSubtitleById,
      setParentForNode,
      toggleServiceParentUi,
      serviceParentUiNodeId,
      applyTemplate,
      insertSwimlane,
    ]
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
    const json = JSON.stringify(
      serializeDiagram(nodes, edges, { omitServiceParentHierarchy: true }),
      null,
      2
    );
    downloadBlob(new Blob([json], { type: 'application/json' }), 'diagram.json');
    commitCheckpoint(nodes, edges);
  };

  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (dirtyRef.current) {
      const ok = window.confirm(
        'Replace the canvas with this file? Unsaved changes since your last JSON export, server save, or import will be lost.'
      );
      if (!ok) return;
    }
    try {
      const text = await file.text();
      const data = parseDiagramJson(text);
      applyDiagramData(data);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not import diagram.');
    }
  };

  const refreshWorkspaces = useCallback(async () => {
    try {
      const r = await fetch('/api/workspaces', { cache: 'no-store' });
      if (!r.ok) throw new Error('Could not list workspaces');
      const raw = await r.text();
      if (!raw?.trim()) throw new Error('empty body');
      const list = JSON.parse(raw);
      if (!Array.isArray(list) || !list.length) {
        setServerWorkspaces(['default']);
        return;
      }
      const normalized = [
        ...new Set(list.filter((x) => typeof x === 'string' && String(x).trim())),
      ].sort((a, b) => {
        if (a === 'default') return -1;
        if (b === 'default') return 1;
        return a.localeCompare(b);
      });
      if (!normalized.includes('default')) normalized.unshift('default');
      setServerWorkspaces(normalized);
    } catch {
      setServerWorkspaces((prev) =>
        Array.isArray(prev) && prev.length > 0 ? prev : ['default']
      );
    }
  }, []);

  const refreshServerFiles = useCallback(async () => {
    const ws = clientSafeWorkspace(serverWorkspace);
    if (!ws) {
      setServerFiles([]);
      setServerMsg('Invalid workspace — pick another workspace and refresh.');
      return;
    }
    try {
      const r = await fetch(`/api/diagrams?workspace=${encodeURIComponent(ws)}`, {
        cache: 'no-store',
      });
      if (!r.ok) throw new Error('Could not list saved diagrams');
      const raw = await r.text();
      if (!raw?.trim()) throw new Error('empty body');
      const rows = JSON.parse(raw);
      if (!Array.isArray(rows)) throw new Error('invalid list');
      setServerFiles(rows);
      setServerMsg((m) => (m.startsWith('Server unavailable') ? '' : m));
    } catch {
      setServerFiles([]);
      setServerMsg('Server unavailable — run npm run dev:all or npm start, then refresh.');
    }
  }, [serverWorkspace]);

  const refreshAllServerLists = useCallback(async () => {
    await refreshWorkspaces();
    await refreshServerFiles();
  }, [refreshWorkspaces, refreshServerFiles]);

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  useEffect(() => {
    const ws = clientSafeWorkspace(serverWorkspace);
    if (!ws) {
      setServerFiles([]);
      setServerMsg('Invalid workspace — pick another workspace.');
      return undefined;
    }
    const isFirstListSync = workspaceListSyncCountRef.current === 0;
    workspaceListSyncCountRef.current += 1;
    const delayMs = isFirstListSync ? 0 : 400;
    const t = setTimeout(() => {
      void refreshServerFiles();
    }, delayMs);
    return () => clearTimeout(t);
  }, [serverWorkspace, refreshServerFiles]);

  useEffect(() => {
    setLoadStem('');
  }, [serverWorkspace]);

  const saveDiagramToServer = async () => {
    const ws = clientSafeWorkspace(serverWorkspace);
    if (!ws) {
      alert(
        'Invalid workspace: use letters, numbers, dot, dash, underscore (max 64 chars). Leave empty for default.'
      );
      return;
    }
    const stem = clientSafeStem(serverStem);
    if (!stem) {
      alert('Use a valid name: start with a letter or number; only letters, numbers, . _ -');
      return;
    }
    const payload = (withReplace) => ({
      name: stem,
      workspace: ws,
      diagram: serializeDiagram(nodes, edges, { omitServiceParentHierarchy: true }),
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
          `Server file "${stem}.txt" in workspace "${ws}" already exists.\n\nReplace it? The current file will be backed up first.\n\nOK — replace with backup\nCancel — do not save`
        );
        if (!ok) {
          setServerMsg(`Save cancelled — ${ws}/${stem}.txt was not changed.`);
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
      const savedPath = j.path
        ? String(j.path).replace(/^exportedfiles\//, '')
        : `${ws}/${stem}.txt`;
      const backupShown = j.backupPath
        ? String(j.backupPath).replace(/^exportedfiles\//, '')
        : '';
      setServerMsg(
        backupShown ? `Saved ${savedPath} (previous copy: ${backupShown})` : `Saved ${savedPath}`
      );
      commitCheckpoint(nodes, edges);
      await refreshAllServerLists();
      setLoadStem(stem);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setServerBusy(false);
    }
  };

  const loadDiagramFromServer = async () => {
    const ws = clientSafeWorkspace(serverWorkspace);
    if (!ws) {
      alert(
        'Invalid workspace: use letters, numbers, dot, dash, underscore (max 64 chars). Leave empty for default.'
      );
      return;
    }
    const stem = clientSafeStem(loadStem);
    if (!stem) {
      alert('Pick a saved file or enter a valid name.');
      return;
    }
    if (dirtyRef.current) {
      const ok = window.confirm(
        'Replace the canvas with the file from the server? Unsaved changes since your last checkpoint will be lost.'
      );
      if (!ok) return;
    }
    setServerBusy(true);
    try {
      const r = await fetch(
        `/api/diagrams/${encodeURIComponent(stem)}?workspace=${encodeURIComponent(ws)}`
      );
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
      setServerMsg(`Loaded ${ws}/${stem}.txt from server`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setServerBusy(false);
    }
  };

  return (
    <DiagramActionsContext.Provider value={diagramActions}>
      {headerToolbarMount
        ? createPortal(
            <HeaderDiagramServerToolbar
              serverStem={serverStem}
              setServerStem={setServerStem}
              loadStem={loadStem}
              setLoadStem={setLoadStem}
              serverFiles={serverFiles}
              serverWorkspaces={serverWorkspaces}
              serverBusy={serverBusy}
              serverMsg={serverMsg}
              onSave={saveDiagramToServer}
              onLoad={loadDiagramFromServer}
              onRefresh={refreshAllServerLists}
            />,
            headerToolbarMount
          )
        : null}
      <div className="diagram-workspace">
        {autosaveRestoreNotice ? (
          <div className="diagram-draft-banner diagram-draft-banner--notice" role="status">
            <p className="diagram-draft-banner__text">
              Restored browser autosave <strong>{autosaveRestoreNotice.name}</strong>
              {autosaveRestoreNotice.workspace ? (
                <>
                  {' · workspace '}
                  <strong>{autosaveRestoreNotice.workspace}</strong>
                </>
              ) : null}
              {' · '}
              <time dateTime={new Date(autosaveRestoreNotice.savedAt).toISOString()}>
                {new Date(autosaveRestoreNotice.savedAt).toLocaleString()}
              </time>
            </p>
            <div className="diagram-draft-banner__actions">
              <button
                type="button"
                className="diagram-draft-banner__btn diagram-draft-banner__btn--ghost"
                onClick={discardAutosavedDiagram}
              >
                Clear & remove draft
              </button>
              <button type="button" className="diagram-draft-banner__btn" onClick={dismissAutosaveNotice}>
                OK
              </button>
            </div>
          </div>
        ) : null}
        <div className="diagram-workspace__main">
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
            zoomOnDoubleClick={false}
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
            title={inspectorOpen ? 'Hide side panel (more room for the canvas)' : 'Show Selection panel'}
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
          <div className="diagram-find-node">
            <h4 className="diagram-inspector__subheading">Find node</h4>
            <label className="diagram-inspector__field diagram-find-node__search">
              <span>Search</span>
              <input
                type="search"
                className="nodrag"
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                placeholder="Title, subtitle, id, owner, repo, env…"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {findMatches.length > 0 ? (
              <ul className="diagram-find-node__hits">
                {findMatches.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className="diagram-find-node__hit"
                      onClick={() => focusNodeById(n.id)}
                    >
                      <span className="diagram-find-node__hit-type">{n.type}</span>
                      <span className="diagram-find-node__hit-label">{nodeMenuLabel(n)}</span>
                      <span className="diagram-find-node__hit-id">{n.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : findQuery.trim() ? (
              <p className="diagram-find-node__empty">No matches.</p>
            ) : null}
          </div>
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
                    <span>Title</span>
                    <input
                      type="text"
                      value={selectedNode.data.label ?? ''}
                      onChange={(e) => updateSelectedLabel(e.target.value)}
                      placeholder="e.g. User Management"
                    />
                  </label>
                  <label className="diagram-inspector__field">
                    <span>Subtitle</span>
                    <input
                      type="text"
                      value={
                        Object.prototype.hasOwnProperty.call(selectedNode.data ?? {}, 'subtitle')
                          ? typeof selectedNode.data.subtitle === 'string'
                            ? selectedNode.data.subtitle
                            : ''
                          : resolveIcon(selectedNode.data.iconKey ?? DEFAULT_ICON_KEY).title
                      }
                      onChange={(e) => updateSelectedSubtitle(e.target.value)}
                      placeholder={resolveIcon(selectedNode.data.iconKey ?? DEFAULT_ICON_KEY).title}
                    />
                  </label>
                  <p className="diagram-inspector__hint">
                    Leave empty to hide the subtitle row. Match the placeholder text to use the icon&apos;s default name
                    again. Double-click <strong>title</strong> or the subtitle area on the canvas to edit inline.
                    Double-click the <strong>icon</strong> for Parent (hierarchy).
                  </p>
                </>
              )}
              <h4 className="diagram-inspector__subheading">Inventory</h4>
              <label className="diagram-inspector__field">
                <span>Owner</span>
                <input
                  type="text"
                  className="nodrag"
                  value={selectedNode.data.owner ?? ''}
                  onChange={(e) => updateSelectedMeta('owner', e.target.value)}
                  placeholder="Team or person"
                />
              </label>
              <label className="diagram-inspector__field">
                <span>Repo / link</span>
                <input
                  type="text"
                  className="nodrag"
                  value={selectedNode.data.repoUrl ?? ''}
                  onChange={(e) => updateSelectedMeta('repoUrl', e.target.value)}
                  placeholder="https://github.com/org/repo"
                />
              </label>
              <label className="diagram-inspector__field">
                <span>Environment</span>
                <input
                  type="text"
                  className="nodrag"
                  value={selectedNode.data.env ?? ''}
                  onChange={(e) => updateSelectedMeta('env', e.target.value)}
                  placeholder="e.g. prod, staging"
                />
              </label>
              <p className="diagram-inspector__hint">
                Optional fields for inventory and search. Saved with JSON / server. Clear a field to remove it.
              </p>
              {selectedNode.type !== 'group' ? (
                <>
                  <label className="diagram-inspector__field">
                    <span>Parent (hierarchy)</span>
                    <ParentHierarchyPicker
                      nodes={nodes}
                      childId={selectedNode.id}
                      value={selectedNode.data.parentNodeId}
                      onChange={setSelectedParent}
                      variant="default"
                    />
                  </label>
                  <p className="diagram-inspector__hint">
                    Open the list to search by <strong>name</strong> or <strong>id</strong> inside the dropdown.
                    Draws an arrow from parent (bottom) to this node (top). Swimlanes use the frame, not this list.
                    JSON / server save omit <code>parentNodeId</code> on icon nodes only.
                  </p>
                </>
              ) : null}
            </>
          ) : selectedEdge ? (
            String(selectedEdge.id).startsWith(PARENT_EDGE_PREFIX) ? (
              <p className="diagram-inspector__hint">
                This is the automatic <strong>parent</strong> link. Change it from the node’s parent control on
                the canvas or in <strong>Parent (hierarchy)</strong> here, or select this edge and press Delete to
                clear the parent.
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

          <div className="diagram-local-draft">
            <h3 className="diagram-local-draft__title">Local draft</h3>
            <p className="diagram-local-draft__intro">
              Each snapshot is tagged <code>{AUTOSAVE_DIAGRAM_NAME}</code> (~
              {Math.round(AUTOSAVE_DEBOUNCE_MS / 1000)}s after you change the graph) and includes the current{' '}
              <strong>Workspace</strong> from the header. Refreshing the page restores both automatically.
            </p>
            <label className="diagram-inspector__field diagram-local-draft__row">
              <span>Autosave draft locally</span>
              <input
                type="checkbox"
                className="nodrag"
                checked={autosaveLocalEnabled}
                onChange={(e) => setAutosaveLocalEnabled(e.target.checked)}
              />
            </label>
            <p className="diagram-local-draft__status" aria-live="polite">
              {dirty ? (
                <span className="diagram-local-draft__dirty">Unsaved changes (vs last export / save / import)</span>
              ) : (
                <span className="diagram-local-draft__clean">No pending changes since last checkpoint.</span>
              )}
              {lastLocalSaveAt ? (
                <span className="diagram-local-draft__time">
                  Last browser snapshot: {new Date(lastLocalSaveAt).toLocaleTimeString()}
                </span>
              ) : null}
            </p>
          </div>

          <div className="diagram-inspector__help">
            <h4>Tips</h4>
            <ul>
              <li>{'Drag from a node handle to another node\u2019s handle to connect (any side).'}</li>
              <li>
                <strong>Parent (hierarchy)</strong>: double-click a service <strong>icon</strong> on the canvas to
                show the parent control (search inside its dropdown). The side panel uses the same pattern. Or drop
                an icon onto another node for a quick parent link.
              </li>
              <li>
                <strong>Layout</strong> arranges the graph automatically (Dagre, top → bottom).
              </li>
              <li>
                <strong>Double-click</strong> the service <strong>label</strong> to rename (Enter saves, Esc
                cancels); <strong>Text note</strong> nodes use a multi-line editor (Esc cancels).
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
                <strong>Find node</strong> searches label, id, owner, repo, and environment; click a result to
                select and zoom. Use <strong>Inventory</strong> on a selected node for owner, repo link, and env.
              </li>
              <li>
                <strong>Templates</strong> and <strong>+ Swimlane</strong> live in the library panel; JSON export
                includes swimlanes, note tags, and inventory fields.
              </li>
              <li>JSON export includes layout and icons for round-trip editing.</li>
              <li>
                Local autosave reloads after a refresh (banner shows <strong>{AUTOSAVE_DIAGRAM_NAME}</strong> and
                pre-fills Save as). Closing the tab with pending edits can still show a browser warning.{' '}
                <strong>Clear</strong>, <strong>Import</strong>, and <strong>Load</strong> (header) confirm when
                you would lose changes.
              </li>
              <li>
                For server save/load, run <code>npm run dev:all</code> (Vite + API) or <code>npm start</code> after
                build. Use the header: <strong>Workspace</strong> dropdown (folders on disk; <strong>+ New
                workspace…</strong> to add one), then <strong>Save</strong> / <strong>Load</strong>. ↻ refreshes both
                lists.
              </li>
            </ul>
          </div>
        </aside>
        </div>
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
