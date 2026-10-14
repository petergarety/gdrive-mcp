import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './client.js';
import { checkDocumentSize, getDocument, listDocuments } from './documents.js';
import { MAX_DOCUMENT_SIZE } from './constants.js';
import { GoogleDocsAPI } from '../utils/google-api.js';
import { listDocuments as listDocumentsHandler } from '../handlers/listDocuments.js';
import { GDOCS_TOOLS } from '../tools/index.js';
import { SCHEMAS } from '../handlers/schemas.js';

/**
 * Regression tests for read-path defects found while documenting the read
 * responses (October 13, 2026):
 *   1. list_documents never returned Drive's nextPageToken.
 *   2. search_documents advertised a smaller pageSize maximum than it accepted.
 *   3. checkDocumentSize swallowed its own "Document too large" rejection.
 */

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network access in test'));
});

afterEach(() => {
  const calls = vi.mocked(globalThis.fetch).mock.calls.length;
  vi.restoreAllMocks();
  expect(calls).toBe(0);
});

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe('text');
  return result.content[0].text ?? '';
}

describe('list_documents pagination', () => {
  const page = [
    { id: 'doc-1', name: 'First' },
    { id: 'doc-2', name: 'Second' },
  ];

  it('returns the continuation token when Drive reports more results', async () => {
    const api = new GoogleDocsAPI('test-token');
    const list = vi.spyOn(api, 'listDocuments').mockResolvedValue({ files: page, nextPageToken: 'token-page-2' } as never);

    const text = textOf(await listDocumentsHandler(api, { pageSize: 2 }));

    expect(list).toHaveBeenCalledWith(2, undefined);
    expect(text).toContain('Found 2 documents:');
    expect(text).toContain('• First (doc-1)');
    expect(text).toContain('• Second (doc-2)');
    expect(text).toContain('pageToken: token-page-2');
  });

  it('omits the continuation hint on the last page', async () => {
    const api = new GoogleDocsAPI('test-token');
    vi.spyOn(api, 'listDocuments').mockResolvedValue({ files: page } as never);

    const text = textOf(await listDocumentsHandler(api, {}));

    expect(text).toBe('Found 2 documents:\n\n• First (doc-1)\n• Second (doc-2)');
    expect(text).not.toContain('pageToken');
  });

  it('returns the continuation token on an empty page that has more results', async () => {
    // Drive may return zero files with a nextPageToken; the token must still reach the caller.
    const api = new GoogleDocsAPI('test-token');
    vi.spyOn(api, 'listDocuments').mockResolvedValue({ files: [], nextPageToken: 'token-page-2' } as never);

    const text = textOf(await listDocumentsHandler(api, { pageToken: 'token-page-1' }));

    expect(text).toContain('Found 0 documents:');
    expect(text).not.toContain('•');
    expect(text).toContain('pageToken: token-page-2');
  });

  it('passes a caller pageToken through to the handler API call', async () => {
    const api = new GoogleDocsAPI('test-token');
    const list = vi.spyOn(api, 'listDocuments').mockResolvedValue({ files: [] } as never);

    await listDocumentsHandler(api, { pageSize: 5, pageToken: 'token-page-2' });

    expect(list).toHaveBeenCalledWith(5, 'token-page-2');
  });

  it('requests nextPageToken from Drive and forwards pageToken in the URL', async () => {
    const client = new ApiClient('test-token');
    const request = vi.spyOn(client, 'request').mockResolvedValueOnce({ files: page, nextPageToken: 'token-page-3' });

    const result = await listDocuments(client, 2, 'token-page-2');

    const url = new URL(String(request.mock.calls[0][0]));
    expect(url.searchParams.get('pageToken')).toBe('token-page-2');
    expect(url.searchParams.get('pageSize')).toBe('2');
    expect(url.searchParams.get('fields')).toContain('nextPageToken');
    expect(result.nextPageToken).toBe('token-page-3');
  });
});

describe('published and runtime pageSize limits stay aligned', () => {
  it.each(['list_documents', 'search_documents'] as const)('%s', name => {
    const tool = GDOCS_TOOLS.find(t => t.name === name)!;
    const pageSize = (tool.inputSchema.properties as Record<string, { minimum: number; maximum: number; description: string }>).pageSize;
    const base = name === 'search_documents' ? { query: 'report' } : {};
    const schema = SCHEMAS[name];

    expect(schema.safeParse({ ...base, pageSize: pageSize.minimum }).success).toBe(true);
    expect(schema.safeParse({ ...base, pageSize: pageSize.maximum }).success).toBe(true);
    expect(schema.safeParse({ ...base, pageSize: pageSize.minimum - 1 }).success).toBe(false);
    expect(schema.safeParse({ ...base, pageSize: pageSize.maximum + 1 }).success).toBe(false);
    expect(pageSize.description).toContain(`max: ${pageSize.maximum}`);
  });
});

describe('document size pre-check', () => {
  it('rejects a document over the limit before fetching its content', async () => {
    const client = new ApiClient('test-token');
    const request = vi.spyOn(client, 'request').mockResolvedValueOnce({ size: String(MAX_DOCUMENT_SIZE + 1) });

    await expect(getDocument(client, 'large-document')).rejects.toThrow('Document too large');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('accepts a document exactly at the limit', async () => {
    const client = new ApiClient('test-token');
    vi.spyOn(client, 'request').mockResolvedValueOnce({ size: String(MAX_DOCUMENT_SIZE) });

    await expect(checkDocumentSize(client, 'boundary-document')).resolves.toBe(MAX_DOCUMENT_SIZE);
  });

  it('still attempts the read when metadata is unavailable', async () => {
    const client = new ApiClient('test-token');
    const document = { documentId: 'doc', title: 'Doc', body: { content: [] } };
    const request = vi.spyOn(client, 'request')
      .mockRejectedValueOnce(new Error('Request failed with status 403'))
      .mockResolvedValueOnce(document);

    await expect(getDocument(client, 'doc')).resolves.toEqual(document);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['missing', {}],
    ['zero', { size: '0' }],
    ['non-numeric', { size: 'unknown' }],
  ])('treats a %s size as unknown and allows the read', async (_label, metadata) => {
    const client = new ApiClient('test-token');
    vi.spyOn(client, 'request').mockResolvedValueOnce(metadata);

    await expect(checkDocumentSize(client, 'doc')).resolves.toBe(0);
  });
});
