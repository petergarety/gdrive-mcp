import { ApiClient } from './client.js';
import { EXPORT_TIMEOUT_MS, MAX_TEXT_LENGTH } from './constants.js';

/**
 * Drive API: export a doc as plain text.
 * Bypasses the JSON client to stream the raw text body, with a long timeout
 * and a hard size cap on the result.
 */
export async function exportLargeDocumentAsText(
  client: ApiClient,
  documentId: string,
): Promise<string> {
  const url = `https://www.googleapis.com/drive/v3/files/${documentId}/export?mimeType=text/plain`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${client.token}` },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Export failed with status ${response.status}`);
    }

    const text = await response.text();

    if (text.length > MAX_TEXT_LENGTH) {
      return text.substring(0, MAX_TEXT_LENGTH) + '\n\n[Text truncated due to size limits]';
    }

    return text;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Export timeout - document too large');
    }
    throw error;
  }
}
