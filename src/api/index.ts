/**
 * Barrel export for the Google Docs API modules.
 * Prefer importing from here in new code.
 */
export { ApiClient } from './client.js';
export {
  listDocuments,
  getDocument,
  getDocumentInfo,
  createDocument,
  updateDocument,
  getDocumentSafe,
  checkDocumentSize,
} from './documents.js';
export type { BatchUpdateResponse } from './documents.js';
export { searchDocuments } from './search.js';
export { extractTextFromDocument, extractTextFromElements } from './textExtraction.js';
export { exportLargeDocumentAsText } from './largeDoc.js';
export { getDocumentTabs, type TabInfo } from './tabs.js';
export { extractHeadingsFromDocument, getContentUnderHeading } from './headings.js';
export type {
  Heading,
  NamedStyleType,
  Paragraph,
  ParagraphElement,
  ParagraphStyle,
  StructuralElement,
  Table,
  TableCell,
  TableRow,
  TextRun,
  DocumentTab,
} from './types.js';
export * from './constants.js';
