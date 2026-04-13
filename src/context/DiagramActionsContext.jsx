import { createContext, useContext } from 'react';

/** @type {React.Context<{ renameNodeById: (id: string, label: string) => void } | null>} */
export const DiagramActionsContext = createContext(null);

export function useDiagramActions() {
  return useContext(DiagramActionsContext);
}
