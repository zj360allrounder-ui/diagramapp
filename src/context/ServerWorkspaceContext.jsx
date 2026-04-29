import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  clientSafeWorkspace,
  readInitialServerWorkspace,
  SERVER_WORKSPACE_STORAGE_KEY,
} from '../lib/serverWorkspace.js';

const ServerWorkspaceContext = createContext(null);

export function ServerWorkspaceProvider({ children }) {
  const [serverWorkspace, setServerWorkspace] = useState(readInitialServerWorkspace);

  useEffect(() => {
    const w = clientSafeWorkspace(serverWorkspace);
    if (!w) return;
    try {
      localStorage.setItem(SERVER_WORKSPACE_STORAGE_KEY, w);
    } catch {
      /* quota or private mode */
    }
  }, [serverWorkspace]);

  const resolvedWorkspace = useMemo(
    () => clientSafeWorkspace(serverWorkspace) || 'default',
    [serverWorkspace]
  );

  const value = useMemo(
    () => ({
      serverWorkspace,
      setServerWorkspace,
      resolvedWorkspace,
    }),
    [serverWorkspace, resolvedWorkspace]
  );

  return <ServerWorkspaceContext.Provider value={value}>{children}</ServerWorkspaceContext.Provider>;
}

export function useServerWorkspace() {
  const ctx = useContext(ServerWorkspaceContext);
  if (!ctx) {
    throw new Error('useServerWorkspace must be used within ServerWorkspaceProvider');
  }
  return ctx;
}
