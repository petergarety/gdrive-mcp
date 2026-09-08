import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './client.js';
import { EXPORT_TIMEOUT_MS } from './constants.js';
import { exportDocument, readLimitedBytes } from './exports.js';
import { invalidExportArgs } from '../export.test-support.js';

beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external access')); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const client = new ApiClient('test-token');
const args = { documentId: 'doc', format: 'text' as const, maxBytes: 100 };

describe('export adapter boundaries', () => {
  it.each(invalidExportArgs)('rejects $label even when called directly', async ({ args: invalid }) => {
    await expect(exportDocument(client, invalid as unknown as typeof args)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['text', 'markdown', 'pdf', 'docx'] as const)('allows empty $format output with correct checksum', async format => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array(0)));
    const result = await exportDocument(client, { ...args, format });
    expect(result).toMatchObject({ data: '', byteLength: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
  });
  it('rejects an absent body instead of inventing an empty file', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null));
    await expect(exportDocument(client, args)).rejects.toThrow('no response body');
  });
  it('round-trips binary data across the base64 conversion chunk boundary', async () => {
    const bytes = Uint8Array.from({ length: 70000 }, (_, i) => i % 256);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(bytes));
    const result = await exportDocument(client, { ...args, format: 'docx', maxBytes: bytes.length });
    expect(Buffer.from(result.data, 'base64')).toEqual(Buffer.from(bytes));
  });
  it('enforces cumulative bytes despite an understated content-length', async () => {
    await expect(readLimitedBytes(new Response('abcd', { headers: { 'content-length': '1' } }), 3)).rejects.toThrow('exceeds maxBytes');
  });
  it('cancels an overflowing stream and releases its lock', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(4)); }, cancel });
    await expect(readLimitedBytes(new Response(body), 3)).rejects.toThrow('no partial file');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
  it('rejects a failed stream without returning a partial file', async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([65])); c.error(new Error('stream failed')); } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(body));
    await expect(exportDocument(client, args)).rejects.toThrow('stream failed');
    expect(body.locked).toBe(false);
  });
  it.each(['headers', 'body'])('keeps the deadline active while waiting for %s', async phase => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      signal = init?.signal as AbortSignal;
      if (phase === 'headers') return await new Promise<Response>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
      return new Response(new ReadableStream<Uint8Array>({ start(c) {
        c.enqueue(new Uint8Array([65]));
        signal!.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')), { once: true });
      } }));
    });
    const pending = expect(exportDocument(client, args)).rejects.toThrow('Export timed out; no partial file returned');
    await vi.advanceTimersByTimeAsync(EXPORT_TIMEOUT_MS);
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('clears the deadline after success and failure', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('ok')).mockResolvedValueOnce(new Response('', { status: 403 }));
    await exportDocument(client, args);
    expect(vi.getTimerCount()).toBe(0);
    await expect(exportDocument(client, args)).rejects.toThrow('403');
    expect(vi.getTimerCount()).toBe(0);
  });
});
