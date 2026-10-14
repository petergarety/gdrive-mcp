import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './client.js';
import { searchDocuments } from './search.js';
import { toDocumentPage, toDocumentSummary } from '../handlers/documentSummary.js';
import type { GoogleDocumentInfo } from '../types/index.js';

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network access in test'));
});

afterEach(() => {
  const calls = vi.mocked(globalThis.fetch).mock.calls.length;
  vi.restoreAllMocks();
  expect(calls).toBe(0);
});

describe('searchDocuments Drive request', () => {
  it('requests nextPageToken, forwards pageToken once, and returns the token', async () => {
    const client = new ApiClient('test-token');
    const request = vi.spyOn(client, 'request').mockResolvedValueOnce({
      files: [{ id: 'doc-1', name: 'First' }], nextPageToken: 'search-page-3',
    });

    const result = await searchDocuments(client, 'report', 5, 'search-page-2');

    const url = new URL(String(request.mock.calls[0][0]));
    expect(url.searchParams.getAll('pageToken')).toEqual(['search-page-2']);
    expect(url.searchParams.get('pageSize')).toBe('5');
    expect(url.searchParams.get('fields')).toContain('nextPageToken');
    expect(url.searchParams.getAll('q')).toEqual([
      "mimeType='application/vnd.google-apps.document' and fullText contains 'report'",
    ]);
    expect(result).toEqual({ files: [{ id: 'doc-1', name: 'First' }], nextPageToken: 'search-page-3' });
  });

  it('omits pageToken from the request on the first page and handles missing files', async () => {
    const client = new ApiClient('test-token');
    const request = vi.spyOn(client, 'request').mockResolvedValueOnce({});

    const result = await searchDocuments(client, 'report');

    const url = new URL(String(request.mock.calls[0][0]));
    expect(url.searchParams.has('pageToken')).toBe(false);
    expect(url.searchParams.get('pageSize')).toBe('10');
    expect(result).toEqual({ files: [], nextPageToken: undefined });
  });
});

describe('document summary helpers', () => {
  it('keeps id and name, omits unset fields, and drops undocumented keys', () => {
    const info = {
      id: 'doc', name: 'Doc', mimeType: 'application/vnd.google-apps.document',
      size: undefined, parents: null, owners: ['someone'],
    } as unknown as GoogleDocumentInfo;
    expect(toDocumentSummary(info)).toEqual({ id: 'doc', name: 'Doc', mimeType: 'application/vnd.google-apps.document' });
  });

  it('builds a page with count and an optional continuation token', () => {
    const files = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] as GoogleDocumentInfo[];
    expect(toDocumentPage(files, 'next')).toEqual({ documents: files, count: 2, nextPageToken: 'next' });
    expect(toDocumentPage(files)).not.toHaveProperty('nextPageToken');
    expect(toDocumentPage([], '')).toEqual({ documents: [], count: 0 });
  });
});
