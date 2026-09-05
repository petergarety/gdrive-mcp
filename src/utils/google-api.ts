import { GoogleDocumentInfo, DocumentContent, DocCreateRequest, DocUpdateRequest } from '../types/index.js';
import { ApiClient } from '../api/client.js';
import {
  listDocuments,
  getDocument,
  getDocumentInfo,
  createDocument,
  updateDocument,
  getDocumentSafe,
  checkDocumentSize,
} from '../api/documents.js';
import { searchDocuments } from '../api/search.js';
import { extractTextFromDocument } from '../api/textExtraction.js';
import { exportLargeDocumentAsText } from '../api/largeDoc.js';
import { getDocumentTabs } from '../api/tabs.js';
import {
  extractHeadingsFromDocument,
  getContentUnderHeading,
} from '../api/headings.js';

/**
 * Thin facade over the per-concern modules in `src/api/`.
 *
 * Existed historically as a single 867-line god class; now it just routes
 * calls to focused modules so handlers don't need to change. New code should
 * prefer importing from `src/api/` directly.
 */
export class GoogleDocsAPI {
  private readonly client: ApiClient;

  constructor(accessToken: string) {
    this.client = new ApiClient(accessToken);
  }

  // --- Drive listing & search ---

  listDocuments(pageSize?: number, pageToken?: string) {
    return listDocuments(this.client, pageSize, pageToken);
  }

  searchDocuments(query: string, pageSize?: number) {
    return searchDocuments(this.client, query, pageSize);
  }

  // --- Document CRUD ---

  getDocument(documentId: string) {
    return getDocument(this.client, documentId);
  }

  getDocumentInfo(documentId: string) {
    return getDocumentInfo(this.client, documentId);
  }

  createDocument(request: DocCreateRequest) {
    return createDocument(this.client, request);
  }

  updateDocument(request: DocUpdateRequest) {
    return updateDocument(this.client, request);
  }

  getDocumentSafe(documentId: string) {
    return getDocumentSafe(this.client, documentId);
  }

  checkDocumentSize(documentId: string) {
    return checkDocumentSize(this.client, documentId);
  }

  // --- Large doc export ---

  exportLargeDocumentAsText(documentId: string) {
    return exportLargeDocumentAsText(this.client, documentId);
  }

  // --- Tabs ---

  getDocumentTabs(documentId: string) {
    return getDocumentTabs(this.client, documentId);
  }

  // --- Text & heading extraction ---

  extractTextFromDocument(document: DocumentContent): string {
    return extractTextFromDocument(document);
  }

  extractHeadingsFromDocument(
    document: DocumentContent,
    options?: { includeText?: boolean; maxDepth?: number },
  ) {
    return extractHeadingsFromDocument(document, options);
  }

  getContentUnderHeading(
    documentId: string,
    options: {
      headingText: string;
      headingLevel?: number;
      matchMode?: 'exact' | 'contains' | 'starts_with';
    },
  ) {
    return getContentUnderHeading(this.client, documentId, options);
  }
}

// Re-export the unused GoogleDocumentInfo shape so legacy callers still resolve it.
export type { GoogleDocumentInfo };
