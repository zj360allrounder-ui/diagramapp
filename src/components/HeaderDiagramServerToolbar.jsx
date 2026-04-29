import { memo, useMemo } from 'react';
import { useServerWorkspace } from '../context/ServerWorkspaceContext.jsx';
import { clientSafeWorkspace } from '../lib/serverWorkspace.js';

const NEW_WS = '__new__';

function HeaderDiagramServerToolbar({
  serverStem,
  setServerStem,
  loadStem,
  setLoadStem,
  serverFiles,
  serverWorkspaces,
  serverBusy,
  serverMsg,
  onSave,
  onLoad,
  onRefresh,
}) {
  const { serverWorkspace, setServerWorkspace } = useServerWorkspace();

  const resolvedWs = clientSafeWorkspace(serverWorkspace) || 'default';

  const workspaceOptions = useMemo(() => {
    const s = new Set(serverWorkspaces);
    s.add(resolvedWs);
    return [...s].sort((a, b) => {
      if (a === 'default') return -1;
      if (b === 'default') return 1;
      return a.localeCompare(b);
    });
  }, [serverWorkspaces, resolvedWs]);

  const onWorkspaceChange = (e) => {
    const v = e.target.value;
    if (v === NEW_WS) {
      const raw = window.prompt(
        'New workspace folder name (letters, numbers, dot, dash, underscore; max 64):',
        'my-team'
      );
      if (raw == null || !String(raw).trim()) {
        e.target.value = resolvedWs;
        return;
      }
      const nw = clientSafeWorkspace(raw.trim());
      if (!nw) {
        alert('Invalid workspace name.');
        e.target.value = resolvedWs;
        return;
      }
      setServerWorkspace(nw);
      void onRefresh?.();
      return;
    }
    setServerWorkspace(v);
  };

  return (
    <div className="header-srv">
      <div className="header-srv__row">
        <label className="header-srv__group header-srv__group--workspace">
          <span className="header-srv__label">Workspace</span>
          <select
            key={`ws-${workspaceOptions.join('|')}`}
            className="header-srv__select header-srv__select--workspace"
            value={resolvedWs}
            onChange={onWorkspaceChange}
            onFocus={() => {
              void onRefresh?.();
            }}
            disabled={serverBusy}
            aria-label="Workspace folder on server"
          >
            {workspaceOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
            <option value={NEW_WS}>+ New workspace…</option>
          </select>
        </label>
        <label className="header-srv__group">
          <span className="header-srv__label">Save as</span>
          <input
            type="text"
            className="header-srv__input"
            value={serverStem}
            onChange={(e) => setServerStem(e.target.value)}
            placeholder="my-diagram"
            disabled={serverBusy}
            spellCheck={false}
            aria-label="Save diagram as"
          />
        </label>
        <button
          type="button"
          className="header-srv__btn header-srv__btn--accent"
          onClick={onSave}
          disabled={serverBusy}
        >
          Save
        </button>
        <span className="header-srv__sep" aria-hidden />
        <label className="header-srv__group header-srv__group--load">
          <span className="header-srv__label">Load</span>
          <select
            className="header-srv__select"
            value={
              loadStem && serverFiles.some((f) => f.stem === loadStem)
                ? loadStem
                : ''
            }
            onChange={(e) => setLoadStem(e.target.value)}
            onFocus={() => {
              void onRefresh?.();
            }}
            disabled={serverBusy}
            aria-label="Diagram to load from server for this workspace"
          >
            <option value="">
              {serverFiles.length === 0 ? 'No diagrams — click ↻' : 'Select diagram…'}
            </option>
            {serverFiles.map((f) => (
              <option key={f.stem} value={f.stem} title={new Date(f.mtime).toLocaleString()}>
                {f.stem}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="header-srv__btn"
          onClick={onLoad}
          disabled={serverBusy}
        >
          Load
        </button>
        <button
          type="button"
          className="header-srv__btn header-srv__btn--ghost"
          onClick={() => void onRefresh?.()}
          disabled={serverBusy}
          title="Refresh workspace and diagram lists"
          aria-label="Refresh workspace and diagram lists"
        >
          <span className="header-srv__refresh-icon" aria-hidden>
            ↻
          </span>
        </button>
      </div>
      {serverMsg ? (
        <p className="header-srv__msg" role="status">
          {serverMsg}
        </p>
      ) : null}
    </div>
  );
}

export default memo(HeaderDiagramServerToolbar);
