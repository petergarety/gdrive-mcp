import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './client.js';
import { createDocument, updateDocument } from './documents.js';
import { formattingArgs, formattingDocument, invalidFormattingArgs, runtimeOnlyInvalidArgs } from '../formatting.test-support.js';

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network access in test'));
});
afterEach(() => {
  const calls = vi.mocked(globalThis.fetch).mock.calls.length;
  vi.restoreAllMocks();
  expect(calls).toBe(0);
});

describe('formatting adapter defense in depth', () => {
  // Extra MCP-envelope fields are rejected by dispatch. The API's request shape
  // is intentionally different (requests, not operations); test its own fields.
  const invalidAdapterArgs = [...invalidFormattingArgs, ...runtimeOnlyInvalidArgs].filter(({ label }) =>
    label !== 'unsupported preview flag' && label !== 'top-level native requests',
  );
  it.each(invalidAdapterArgs)('rejects $label before even reading from Google', async ({ args }) => {
    const client = new ApiClient('test-token');
    const request = vi.spyOn(client, 'request');
    await expect(updateDocument(client, {
      documentId: args.documentId as string, tabId: args.tabId as string | undefined,
      requiredRevisionId: args.requiredRevisionId as string | undefined,
      requests: args.operations as Array<Record<string, unknown>>,
    })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('retains create_document initial-content compatibility after earlier validation', async () => {
    const client = new ApiClient('test-token');
    const document = formattingDocument();
    document.tabs = [document.tabs![0].childTabs![0]];
    const request = vi.spyOn(client, 'request')
      .mockResolvedValueOnce({ documentId: document.documentId, title: document.title })
      .mockResolvedValueOnce({ size: '0' }).mockResolvedValueOnce(document)
      .mockResolvedValueOnce({ documentId: document.documentId, replies: [{}] })
      .mockResolvedValueOnce({ size: '0' }).mockResolvedValueOnce(document);
    expect(await createDocument(client, { title: document.title, content: 'initial' })).toEqual(document);
    expect(request).toHaveBeenCalledTimes(6);
    expect(JSON.parse(String(request.mock.calls[3][1]?.body))).toEqual({
      requests: [{ insertText: { location: { index: 1, tabId: 'child' }, text: 'initial' } }],
      writeControl: { requiredRevisionId: 'read-revision' },
    });
  });

  it('does not write if the document-content read fails', async () => {
    const client = new ApiClient('test-token');
    const request = vi.spyOn(client, 'request').mockResolvedValueOnce({ size: '0' }).mockRejectedValueOnce(new Error('Read failed'));
    await expect(updateDocument(client, { ...formattingArgs, requests: formattingArgs.operations })).rejects.toThrow('Read failed');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
