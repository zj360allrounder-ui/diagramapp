import { createContext, useContext, useMemo, useState } from 'react';

const HeaderToolbarHostContext = createContext(null);

export function HeaderToolbarHostProvider({ children }) {
  const [mount, setMount] = useState(null);
  const value = useMemo(() => ({ mount, setMount }), [mount]);
  return <HeaderToolbarHostContext.Provider value={value}>{children}</HeaderToolbarHostContext.Provider>;
}

export function useHeaderToolbarHost() {
  const ctx = useContext(HeaderToolbarHostContext);
  if (!ctx) {
    throw new Error('useHeaderToolbarHost must be used within HeaderToolbarHostProvider');
  }
  return ctx;
}
