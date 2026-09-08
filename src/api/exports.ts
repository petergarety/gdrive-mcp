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
export const DEFAULT_EXPORT_BYTES = 2 * 1024 * 1024;
export const EXPORT_DOCUMENT_ID_PATTERN = '^[a-zA-Z0-9_-]+(?![\\s\\S])';
export const ExportDocumentSchema = z.object({
  documentId: z.string().regex(new RegExp(EXPORT_DOCUMENT_ID_PATTERN)),
  format: z.enum(['markdown', 'text', 'pdf', 'docx']),
  maxBytes: z.number().int().min(1).max(MAX_EXPORT_BYTES).default(DEFAULT_EXPORT_BYTES),
}).strict();
export type ExportDocumentArgs = z.infer<typeof ExportDocumentSchema>;

/** Stream-bounded, never truncated; deadline remains active until the body finishes. */
export async function readLimitedBytes(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
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

export async function exportDocument(client: ApiClient, raw: z.input<typeof ExportDocumentSchema>) {
  const args = ExportDocumentSchema.parse(raw);
  assertValidDocumentId(args.documentId);
  const format = EXPORT_FORMATS[args.format];
  const params = new URLSearchParams({ mimeType: format.mimeType });
  const url = `https://www.googleapis.com/drive/v3/files/${args.documentId}/export?${params}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
  try {
    // Workers does not support redirect:'error'. Never follow redirects with a bearer token.
    const response = await fetch(url, { signal: controller.signal, redirect: 'manual', headers: { Authorization: `Bearer ${client.token}` } });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new Error('Export rate limit exceeded. Try again later.');
      throw new Error(`Google export failed (HTTP ${response.status}); check permission, format and the 10 MB Drive export limit`);
    }
    const bytes = await readLimitedBytes(response, args.maxBytes);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return {
      documentId: args.documentId, filename: `${args.documentId}.${format.extension}`,
      mimeType: format.mimeType, byteLength: bytes.byteLength,
      sha256: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(''),
      encoding: format.binary ? 'base64' as const : 'utf-8' as const,
      data: format.binary ? bytesToBase64(bytes) : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
      scope: 'Google-native export; no per-tab selection. Multi-tab inclusion/order is not live-verified; do not assume all tabs are included.',
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Export timed out; no partial file returned');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
