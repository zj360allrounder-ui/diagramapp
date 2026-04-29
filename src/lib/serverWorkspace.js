export const SERVER_WORKSPACE_STORAGE_KEY = 'zarus-diag-studio-server-workspace-v1';

/** Single segment under exportedfiles/<workspace>/ — must match server safeWorkspace */
export function clientSafeWorkspace(name) {
  const raw = String(name ?? '').trim().replace(/[/\\]/g, '');
  const ws = raw === '' ? 'default' : raw;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(ws)) return null;
  return ws;
}

export function readInitialServerWorkspace() {
  try {
    const raw = localStorage.getItem(SERVER_WORKSPACE_STORAGE_KEY);
    return clientSafeWorkspace(raw ?? 'default') || 'default';
  } catch {
    return 'default';
  }
}
