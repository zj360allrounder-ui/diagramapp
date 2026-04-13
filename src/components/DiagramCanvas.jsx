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
import IconPalette, { DND_TYPE } from './IconPalette.jsx';
import { DEFAULT_ICON_KEY } from '../lib/iconRegistry.js';
import { layoutWithDagre } from '../lib/layoutGraph.js';
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
    style: { stroke, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
    labelStyle: { fill: isLight ? '#1e293b' : '#e2e8f0', fontSize: 11, fontWeight: 500 },
    labelBgStyle: { fill: isLight ? '#ffffff' : '#1a1f2e', fillOpacity: 0.95 },
    labelBgPadding: [4, 8],
    labelBgBorderRadius: 6,
  };
}

const nodeTypes = { service: ServiceNode };

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
    version: 1,
    nodes: nodes.map(({ id, type, position, data }) => ({
      id,
      type: type || 'service',
      position,
      data: {
        label: data?.label ?? 'Service',
        iconKey: data?.iconKey ?? DEFAULT_ICON_KEY,
      },
    })),
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
  const nextNodes = data.nodes.map((n) => ({
    id: String(n.id),
    type: n.type || 'service',
    position: n.position || { x: 0, y: 0 },
    data: {
      label: n.data?.label ?? 'Service',
      iconKey: n.data?.iconKey ?? DEFAULT_ICON_KEY,
    },
  }));
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
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId);

  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'smoothstep',
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
        style: { ...(e.style || {}), stroke: edgePalette.stroke, strokeWidth: e.style?.strokeWidth ?? 2 },
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
      const id = nextId();
      setNodes((nds) =>
        nds.concat({
          id,
          type: 'service',
          position,
          data: {
            label: item.label || 'Service',
            iconKey: item.iconKey || DEFAULT_ICON_KEY,
          },
        })
      );
    },
    [screenToFlowPosition, setNodes]
  );

  const updateSelectedLabel = useCallback(
    (label) => {
      if (!selectedNodeId) return;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === selectedNodeId ? { ...n, data: { ...n.data, label } } : n
        )
      );
    },
    [selectedNodeId, setNodes]
  );

  const updateSelectedEdgeLabel = useCallback(
    (label) => {
      if (!selectedEdgeId) return;
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
    setNodes((nds) => layoutWithDagre(nds, edges, 'TB'));
    window.setTimeout(() => {
      fitView({ padding: 0.2, duration: 280 });
    }, 120);
  }, [edges, setNodes, fitView]);

  const clearCanvas = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    idSeq = 0;
  }, [setNodes, setEdges]);

  const renameNodeById = useCallback(
    (nodeId, label) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, label } } : n))
      );
    },
    [setNodes]
  );

  const diagramActions = useMemo(() => ({ renameNodeById }), [renameNodeById]);

  const downloadBlob = (blob, filename) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportFilter = (node) => {
    if (!(node instanceof HTMLElement)) return true;
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
      setNodes(nextNodes);
      setEdges(nextEdges);
      syncIdSeqFromNodes(nextNodes);
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
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            nodeTypes={nodeTypes}
            colorMode={theme === 'dark' ? 'dark' : 'light'}
            connectionMode={ConnectionMode.Loose}
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
          ) : selectedEdge ? (
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
          ) : (
            <p className="diagram-inspector__empty">
              Select a single node or edge to edit its label.
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
                <strong>Layout</strong> arranges the graph automatically (Dagre, top → bottom).
              </li>
              <li>
                <strong>Double-click</strong> a node to rename it inline (Enter saves, Esc cancels).
              </li>
              <li>
                <strong>PNG 4K</strong> exports at least UHD resolution so zoomed screenshots stay sharp.
              </li>
              <li>Click an edge to add a dependency / API name label.</li>
              <li>Shift-click to multi-select; Backspace deletes selection.</li>
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
