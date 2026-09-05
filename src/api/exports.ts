import { z } from 'zod';
import { ApiClient } from './client.js';
import { assertValidDocumentId } from './documents.js';
import { EXPORT_TIMEOUT_MS } from './constants.js';

export const EXPORT_FORMATS = {
  markdown: { mimeType: 'text/markdown', extension: 'md', binary: false },
  text: { mimeType: 'text/plain', extension: 'txt', binary: false },
  pdf: { mimeType: 'application/pdf', extension: 'pdf', binary: true },
  docx: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx', binary: true },
} as const;
export const MAX_EXPORT_BYTES = 10 * 1024 * 1024;
export const ExportDocumentSchema = z.object({
  documentId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  format: z.enum(['markdown', 'text', 'pdf', 'docx']),
  maxBytes: z.number().int().min(1).max(MAX_EXPORT_BYTES).default(2 * 1024 * 1024),
}).strict();
export type ExportDocumentArgs = z.infer<typeof ExportDocumentSchema>;

/** Stream-bounded, never truncated; deadline remains active until the body finishes. */
export async function readLimitedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length'));
  if (length > maxBytes) {
    await response.body?.cancel();
    throw new Error('Export exceeds maxBytes; no partial file returned');
  }
  if (!response.body) throw new Error('Export returned no response body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Export exceeds maxBytes; no partial file returned');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  return btoa(parts.join(''));
}

export async function exportDocument(client: ApiClient, raw: ExportDocumentArgs) {
  const args = ExportDocumentSchema.parse(raw);
  assertValidDocumentId(args.documentId);
  const format = EXPORT_FORMATS[args.format];
  const params = new URLSearchParams({ mimeType: format.mimeType });
  const url = `https://www.googleapis.com/drive/v3/files/${args.documentId}/export?${params}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error', headers: { Authorization: `Bearer ${client.token}` } });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new Error('Export rate limit exceeded. Try again later.');
      throw new Error(`Google export failed (HTTP ${response.status}); check permission, format and the 10 MB Drive export limit`);
    }
    const bytes = await readLimitedBytes(response, args.maxBytes);
    return {
      documentId: args.documentId, filename: `${args.documentId}.${format.extension}`,
      mimeType: format.mimeType, byteLength: bytes.byteLength,
      encoding: format.binary ? 'base64' as const : 'utf-8' as const,
      data: format.binary ? bytesToBase64(bytes) : new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      scope: 'Google-native document export; per-tab export is not supported by this tool.',
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Export timed out; no partial file returned');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
