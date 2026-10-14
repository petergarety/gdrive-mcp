import type { GoogleDocumentInfo } from '../types/index.js';
import type { ToolResponse } from './types.js';

/**
 * Drive file metadata as returned by list_documents, search_documents and
 * get_document_info. Only these keys are emitted; unset values are omitted
 * rather than null, matching the other JSON read responses.
 */
export interface DocumentSummary {
  id: string;
  name: string;
  mimeType?: string;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
  parents?: string[];
}

const SUMMARY_KEYS = [
  'mimeType', 'createdTime', 'modifiedTime', 'webViewLink', 'size', 'parents',
] as const satisfies ReadonlyArray<keyof DocumentSummary>;

/** Pick the documented metadata fields, dropping anything unset or unexpected. */
export function toDocumentSummary(info: GoogleDocumentInfo): DocumentSummary {
  const summary: DocumentSummary = { id: info.id, name: info.name };
  const source = info as Partial<Record<(typeof SUMMARY_KEYS)[number], unknown>>;
  for (const key of SUMMARY_KEYS) {
    const value = source[key];
    if (value !== undefined && value !== null) {
      (summary as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return summary;
}

/** A page of documents; `nextPageToken` is present only when more results exist. */
export interface DocumentPage {
  documents: DocumentSummary[];
  count: number;
  nextPageToken?: string;
}

export function toDocumentPage(files: GoogleDocumentInfo[], nextPageToken?: string): DocumentPage {
  const documents = files.map(toDocumentSummary);
  return {
    documents,
    count: documents.length,
    ...(nextPageToken ? { nextPageToken } : {}),
  };
}

/** Standard single-text-item JSON result used by the JSON read tools. */
export function jsonResult(value: unknown): ToolResponse {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}
