import { ToolHandler } from './types.js';
import { listDocuments } from './listDocuments.js';
import { getDocument } from './getDocument.js';
import { getDocumentText } from './getDocumentText.js';
import { createDocument } from './createDocument.js';
import { updateDocument } from './updateDocument.js';
import { searchDocuments } from './searchDocuments.js';
import { getDocumentInfo } from './getDocumentInfo.js';
import { getDocumentTabs } from './getDocumentTabs.js';
import { getDocumentHeadings } from './getDocumentHeadings.js';
import { getContentUnderHeading } from './getContentUnderHeading.js';

/**
 * Registry mapping MCP tool names (as declared in GDOCS_TOOLS) to their
 * handler implementations. Adding a new tool: drop a file in this directory,
 * export the handler, then register it here AND register a zod schema in
 * `schemas.ts` with the matching key.
 *
 * Erased to `ToolHandler<any>` at the boundary because each handler has its
 * own narrowed argument type — the dispatcher validates per-call against the
 * matching zod schema before invocation, so the runtime contract holds.
 */
export const HANDLERS: Record<string, ToolHandler<any>> = {
  list_documents: listDocuments,
  get_document: getDocument,
  get_document_text: getDocumentText,
  create_document: createDocument,
  update_document: updateDocument,
  search_documents: searchDocuments,
  get_document_info: getDocumentInfo,
  get_document_tabs: getDocumentTabs,
  get_document_headings: getDocumentHeadings,
  get_content_under_heading: getContentUnderHeading,
};

export type { ToolHandler, ToolResponse } from './types.js';
