import { createContext, useContext } from 'react';

/**
 * @typedef {Object} DiagramActions
 * @property {(id: string, label: string) => void} renameNodeById
 * @property {(id: string, subtitle: string) => void} [setServiceNodeSubtitleById]
 * @property {(childId: string, parentId: string) => void} [setParentForNode]
 * @property {string | null} [serviceParentUiNodeId]
 * @property {(nodeId: string) => void} [toggleServiceParentUi]
 * @property {(templateId: string) => void} [applyTemplate]
 * @property {() => void} [insertSwimlane]
 */
/** @type {React.Context<DiagramActions | null>} */
export const DiagramActionsContext = createContext(null);

export function useDiagramActions() {
  return useContext(DiagramActionsContext);
}
