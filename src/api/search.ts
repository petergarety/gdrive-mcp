import { GoogleDocumentInfo } from '../types/index.js';
import { ApiClient } from './client.js';

/**
 * Drive API: search docs by name/content.
 * Escapes single quotes and strips special chars from the query.
 */
export async function searchDocuments(
  client: ApiClient,
  query: string,
  pageSize: number = 10,
): Promise<GoogleDocumentInfo[]> {
  const escapedQuery = query.replace(/'/g, "\\'").replace(/[^a-zA-Z0-9\s]/g, ' ');
  const params = new URLSearchParams({
    q: `mimeType='application/vnd.google-apps.document'`,
    pageSize: pageSize.toString(),
    fields: 'files(id,name,mimeType,createdTime,modifiedTime,webViewLink,size,parents)',
  });

  if (query.trim()) {
    // Use set() — append() would add a SECOND q parameter and Drive API would receive duplicate q= values.
    params.set('q', `${params.get('q')} and fullText contains '${escapedQuery}'`);
  }

  const url = `https://www.googleapis.com/drive/v3/files?${params}`;
  const response = await client.request<{ files?: GoogleDocumentInfo[] }>(url);
  return response.files ?? [];
}
