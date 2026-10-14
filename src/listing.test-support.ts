import { expect, it, vi, type MockInstance } from 'vitest';
import { CallToolResultSchema, ErrorCode, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { GoogleDocsAPI } from './utils/google-api.js';
import type { GoogleDocumentInfo } from './types/index.js';

/**
 * Shared contract tests for the JSON responses of list_documents,
 * search_documents and get_document_info. Registered once per transport
 * (HTTP SDK and stdio) so both dispatch paths are held to the same contract.
 */

interface ListingTransport {
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  list(): Promise<Tool[]>;
  authenticated(): MockInstance;
}

/** A complete Drive metadata record, as Google returns for these fields. */
export const fullInfo: GoogleDocumentInfo = {
  id: 'doc-full',
  name: 'Quarterly report — Q3 "draft" 😀',
  mimeType: 'application/vnd.google-apps.document',
  createdTime: '2026-09-01T10:00:00.000Z',
  modifiedTime: '2026-10-12T08:30:00.000Z',
  webViewLink: 'https://docs.google.com/document/d/doc-full/edit',
  size: '2048',
  parents: ['folder-1'],
};

/** Drive often omits size and parents for native Docs. */
export const sparseInfo = {
  id: 'doc-sparse',
  name: 'Notes',
  mimeType: 'application/vnd.google-apps.document',
  createdTime: '2026-09-02T10:00:00.000Z',
  modifiedTime: '2026-09-03T10:00:00.000Z',
  webViewLink: 'https://docs.google.com/document/d/doc-sparse/edit',
} as GoogleDocumentInfo;

/** Fields outside the documented contract must not leak into responses. */
const withExtras = { ...sparseInfo, owners: [{ emailAddress: 'someone@example.com' }], size: null } as unknown as GoogleDocumentInfo;

async function parseJson(transport: ListingTransport, name: string, args: Record<string, unknown>) {
  const result = CallToolResultSchema.parse(await transport.call(name, args));
  expect(result.isError).not.toBe(true);
  expect(result.content).toHaveLength(1);
  const [item] = result.content;
  if (item.type !== 'text') throw new Error(`${name} did not return a text item`);
  return JSON.parse(item.text) as Record<string, unknown>;
}

export function registerListingToolTests(transport: ListingTransport): void {
  it('advertises the JSON response shape and search pagination', async () => {
    const tools = await transport.list();
    const byName = (name: string) => tools.find(tool => tool.name === name)!;
    expect(byName('list_documents').description).toContain('nextPageToken');
    expect(byName('search_documents').description).toContain('nextPageToken');
    expect(byName('search_documents').inputSchema.properties).toHaveProperty('pageToken');
    expect(byName('get_document_info').description).toContain('JSON');
    expect(transport.authenticated()).not.toHaveBeenCalled();
  });

  it('list_documents returns parseable JSON with full metadata and a continuation token', async () => {
    const list = vi.spyOn(GoogleDocsAPI.prototype, 'listDocuments')
      .mockResolvedValue({ files: [fullInfo, sparseInfo], nextPageToken: 'list-page-2' });

    const body = await parseJson(transport, 'list_documents', { pageSize: 2 });

    expect(list).toHaveBeenCalledWith(2, undefined);
    expect(body).toEqual({ documents: [fullInfo, sparseInfo], count: 2, nextPageToken: 'list-page-2' });
  });

  it('list_documents forwards pageToken and omits nextPageToken on the last page', async () => {
    const list = vi.spyOn(GoogleDocsAPI.prototype, 'listDocuments').mockResolvedValue({ files: [sparseInfo] });

    const body = await parseJson(transport, 'list_documents', { pageToken: 'list-page-2' });

    expect(list).toHaveBeenCalledWith(undefined, 'list-page-2');
    expect(body).toEqual({ documents: [sparseInfo], count: 1 });
    expect(body).not.toHaveProperty('nextPageToken');
  });

  it('list_documents keeps the token on an empty page', async () => {
    vi.spyOn(GoogleDocsAPI.prototype, 'listDocuments').mockResolvedValue({ files: [], nextPageToken: 'list-page-3' });
    expect(await parseJson(transport, 'list_documents', {})).toEqual({ documents: [], count: 0, nextPageToken: 'list-page-3' });
  });

  it('search_documents returns JSON with the query, results and a continuation token', async () => {
    const search = vi.spyOn(GoogleDocsAPI.prototype, 'searchDocuments')
      .mockResolvedValue({ files: [fullInfo], nextPageToken: 'search-page-2' });

    const body = await parseJson(transport, 'search_documents', { query: 'Q3 "report"', pageSize: 1 });

    expect(search).toHaveBeenCalledWith('Q3 "report"', 1, undefined);
    expect(body).toEqual({ query: 'Q3 "report"', documents: [fullInfo], count: 1, nextPageToken: 'search-page-2' });
  });

  it('search_documents forwards pageToken for the next page and handles no results', async () => {
    const search = vi.spyOn(GoogleDocsAPI.prototype, 'searchDocuments').mockResolvedValue({ files: [] });

    const body = await parseJson(transport, 'search_documents', { query: 'report', pageSize: 1, pageToken: 'search-page-2' });

    expect(search).toHaveBeenCalledWith('report', 1, 'search-page-2');
    expect(body).toEqual({ query: 'report', documents: [], count: 0 });
  });

  it('get_document_info returns the documented JSON metadata', async () => {
    const info = vi.spyOn(GoogleDocsAPI.prototype, 'getDocumentInfo').mockResolvedValue(fullInfo);

    const body = await parseJson(transport, 'get_document_info', { documentId: fullInfo.id });

    expect(info).toHaveBeenCalledWith(fullInfo.id);
    expect(body).toEqual(fullInfo);
  });

  it('get_document_info omits unset fields and drops undocumented ones', async () => {
    vi.spyOn(GoogleDocsAPI.prototype, 'getDocumentInfo').mockResolvedValue(withExtras);

    const body = await parseJson(transport, 'get_document_info', { documentId: sparseInfo.id });

    expect(body).toEqual(sparseInfo);
    expect(body).not.toHaveProperty('size');
    expect(body).not.toHaveProperty('owners');
  });

  it.each([
    ['list_documents', { pageToken: 7 }],
    ['list_documents', { pageSize: 101 }],
    ['search_documents', { query: '' }],
    ['search_documents', { query: '   ' }],
    ['search_documents', { query: '\n\t' }],
    ['search_documents', { query: 'x', pageToken: 7 }],
    ['search_documents', { query: 'x', pageSize: 0 }],
    ['get_document_info', {}],
  ])('%s rejects invalid arguments %j before authentication', async (name, args) => {
    await expect(transport.call(name, args)).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    expect(transport.authenticated()).not.toHaveBeenCalled();
  });
}
