import { createContext, useContext } from 'react';

/**
 * @typedef {Object} DiagramActions
 * @property {(id: string, label: string) => void} renameNodeById
 * @property {(templateId: string) => void} [applyTemplate]
 * @property {() => void} [insertSwimlane]
 */
/** @type {React.Context<DiagramActions | null>} */
export const DiagramActionsContext = createContext(null);

export function useDiagramActions() {
  return useContext(DiagramActionsContext);
}
