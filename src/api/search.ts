import { GoogleDocumentInfo } from '../types/index.js';
import { ApiClient } from './client.js';

/**
 * Turns user search text into the body of a Drive query string literal.
 *
 * Drive requires only backslashes and single quotes to be escaped inside a
 * quoted value, so punctuation and non-English text are kept as typed. The
 * text is normalized to Unicode NFC (so decomposed accents like "e" + U+0301
 * match "é"), and runs of whitespace or control characters become one space.
 */
export function toDriveQueryLiteral(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\s\p{Cc}]+/gu, ' ')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

/**
 * Drive API: search docs by name/content.
 * The query is passed to Drive's `fullText contains` with punctuation and
 * non-English characters preserved (see toDriveQueryLiteral). A query with no
 * visible characters is rejected instead of silently matching every document.
 *
 * Pass the `nextPageToken` from a previous call as `pageToken` (with the same
 * query and page size) to get the next page.
 */
export async function searchDocuments(
  client: ApiClient,
  query: string,
  pageSize: number = 10,
  pageToken?: string,
): Promise<{ files: GoogleDocumentInfo[]; nextPageToken?: string }> {
  const literal = toDriveQueryLiteral(query);
  if (!literal) {
    throw new Error('Search query must contain at least one non-whitespace character');
  }
  const params = new URLSearchParams({
    q: `mimeType='application/vnd.google-apps.document' and fullText contains '${literal}'`,
    pageSize: pageSize.toString(),
    fields: 'files(id,name,mimeType,createdTime,modifiedTime,webViewLink,size,parents),nextPageToken',
  });
  if (pageToken) params.set('pageToken', pageToken);

  const url = `https://www.googleapis.com/drive/v3/files?${params}`;
  const response = await client.request<{ files?: GoogleDocumentInfo[]; nextPageToken?: string }>(url);
  return {
    files: response.files ?? [],
    nextPageToken: response.nextPageToken,
  };
}
