import { createHash } from 'node:crypto';
import { expect, it, vi, type MockInstance } from 'vitest';
import { CallToolResultSchema, ErrorCode, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { EXPORT_FORMATS, MAX_EXPORT_BYTES } from './api/exports.js';
import { EXPORT_DOCUMENT_TOOL } from './tools/exportDocument.js';

export const exportArgs = { documentId: 'export-fixture', format: 'text' };
export const invalidExportArgs: Array<{ label: string; args: Record<string, unknown> }> = [
  { label: 'missing ID', args: { format: 'text' } },
  { label: 'missing format', args: { documentId: 'doc' } },
  ...[
    ['empty ID', { documentId: '' }], ['document URL', { documentId: 'https://example.com/doc' }],
    ['trailing newline', { documentId: 'doc\n' }], ['path traversal', { documentId: '../doc' }],
    ['Unicode ID', { documentId: 'dóc' }], ['null ID', { documentId: null }],
    ['invalid format', { format: 'html' }], ['uppercase format', { format: 'PDF' }],
    ['null format', { format: null }], ['zero limit', { maxBytes: 0 }],
    ['negative limit', { maxBytes: -1 }], ['fractional limit', { maxBytes: 1.5 }],
    ['string limit', { maxBytes: '100' }], ['null limit', { maxBytes: null }],
    ['too large limit', { maxBytes: MAX_EXPORT_BYTES + 1 }],
    ['unsupported tab', { tabId: 'child' }], ['unsupported filename', { filename: 'output.pdf' }],
    ['unsupported revision', { requiredRevisionId: 'revision' }], ['unsupported URL', { url: 'https://example.com' }],
  ].map(([label, changes]) => ({ label: label as string, args: { ...exportArgs, ...changes as object } })),
];
export const exportCases = Object.entries(EXPORT_FORMATS).map(([format, info]) => ({
  format: format as keyof typeof EXPORT_FORMATS, ...info,
  // Synthetic transport bytes, NOT evidence of valid Google PDF/DOCX documents.
  bytes: info.binary ? new Uint8Array([0, 255, 80, 75, 3, 4, 128, 10]) : new TextEncoder().encode('\uFEFF# Café 😀\r\n\u0000'),
}));
interface ExportTransport {
  call(args: Record<string, unknown>): Promise<unknown>;
  list(): Promise<Tool[]>;
  authenticated(): MockInstance;
}
export function registerExportToolTests(transport: ExportTransport): void {
  it('discovers the twelfth read-only tool without token acquisition', async () => {
    const tools = await transport.list();
    expect(tools).toHaveLength(12);
    expect(tools.find(tool => tool.name === 'export_document')).toEqual(EXPORT_DOCUMENT_TOOL);
    expect(transport.authenticated()).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each(invalidExportArgs)('rejects $label before acquiring a token or exporting', async ({ args }) => {
    await expect(transport.call(args)).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    expect(transport.authenticated()).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each(exportCases)('round-trips exact $format bytes with one SDK-valid resource', async ({ format, mimeType, extension, binary, bytes }) => {
    const fetch = vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(bytes));
    const result = CallToolResultSchema.parse(await transport.call({ ...exportArgs, format, maxBytes: bytes.length }));
    expect(result.isError).not.toBe(true);
    expect(result.content).toHaveLength(2);
    const summary = result.content[0];
    if (summary.type !== 'text') throw new Error('Missing metadata');
    const metadata = JSON.parse(summary.text);
    expect(metadata).toMatchObject({ schemaVersion: 1, delivery: 'embedded-resource', format,
      documentId: exportArgs.documentId, filename: `${exportArgs.documentId}.${extension}`,
      mimeType, encoding: binary ? 'base64' : 'utf-8', byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      scope: expect.stringContaining('not live-verified'),
    });
    expect(metadata).not.toHaveProperty('data');
    expect(metadata).not.toHaveProperty('downloadUrl');
    const resource = result.content[1];
    if (resource.type !== 'resource') throw new Error('Missing resource');
    expect(resource.resource.uri).toBe(metadata.resourceUri);
    expect(resource.resource.mimeType).toBe(mimeType);
    expect(metadata.resourceUri).toMatch(/^gdrive-export:\/\/\/[a-f0-9-]+\//);
    const payload = resource.resource;
    const saved = 'blob' in payload ? Buffer.from(payload.blob, 'base64') : Buffer.from(payload.text, 'utf8');
    expect(saved).toEqual(Buffer.from(bytes));
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe(`https://www.googleapis.com/drive/v3/files/export-fixture/export?${new URLSearchParams({ mimeType })}`);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual', headers: { Authorization: 'Bearer test-token' } });
    expect(transport.authenticated()).toHaveBeenCalledOnce();
  });
  it.each([301, 302, 303, 307, 308])('rejects HTTP %s without following the redirect', async status => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('redirect-body', {
      status, headers: { location: 'https://untrusted.test/token-sink' },
    }));
    await expect(transport.call(exportArgs)).rejects.toMatchObject({ code: ErrorCode.InternalError, message: expect.stringContaining(`HTTP ${status}`) });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(globalThis.fetch).mock.calls[0][1]?.redirect).toBe('manual');
  });
  it.each([401, 403, 404, 429, 500])('surfaces HTTP %s without partial content, retry, or upstream body leakage', async status => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('PRIVATE_BODY', { status }));
    await expect(transport.call(exportArgs)).rejects.toMatchObject({ code: ErrorCode.InternalError, message: expect.not.stringContaining('PRIVATE_BODY') });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });
  it.each(['content-length', 'streamed'])('rejects %s overflow with no resource', async mode => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('abcd', mode === 'content-length' ? { headers: { 'content-length': '4' } } : undefined));
    await expect(transport.call({ ...exportArgs, maxBytes: 3 })).rejects.toMatchObject({ code: ErrorCode.InternalError, message: expect.stringContaining('no partial file') });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });
  it('enforces the 2 MiB default when maxBytes is omitted', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('x', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } }));
    await expect(transport.call(exportArgs)).rejects.toMatchObject({ code: ErrorCode.InternalError, message: expect.stringContaining('exceeds maxBytes') });
  });
  it('refuses malformed UTF-8 with no replacement-character file', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(new Uint8Array([255])));
    await expect(transport.call(exportArgs)).rejects.toMatchObject({ code: ErrorCode.InternalError });
  });
  it('uses different snapshot URIs on repeated exports without claiming persistence', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () => new Response('abc'));
    const first = CallToolResultSchema.parse(await transport.call(exportArgs));
    const second = CallToolResultSchema.parse(await transport.call(exportArgs));
    expect(first.content[1]).not.toEqual(second.content[1]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
}
