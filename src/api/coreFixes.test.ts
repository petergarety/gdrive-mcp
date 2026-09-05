import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentContent } from '../types/index.js';
import type { DocumentTab, StructuralElement } from './types.js';
import { ApiClient } from './client.js';
import { getDocument, updateDocument } from './documents.js';
import { getDocumentTabs } from './tabs.js';
import { documentTabs, selectWriteTab } from './structure.js';
import { extractTextFromDocument } from './textExtraction.js';
import { extractHeadingsFromDocument, findSection } from './headings.js';
import { transformOperations } from './operations.js';
import { GDOCS_TOOLS } from '../tools/index.js';
import { HANDLERS } from '../handlers/index.js';
import { SCHEMAS } from '../handlers/schemas.js';

function paragraph(startIndex: number, text: string, headingId?: string): StructuralElement {
  return {
    startIndex, endIndex: startIndex + text.length,
    paragraph: {
      elements: [{ textRun: { content: text } }],
      ...(headingId ? { paragraphStyle: { namedStyleType: 'HEADING_1', headingId } } : {}),
    },
  };
}

function tab(id: string, content: StructuralElement[], childTabs: DocumentTab[] = []): DocumentTab {
  return { tabProperties: { tabId: id, title: id }, documentTab: { body: { content } }, childTabs };
}

function fixture(): DocumentContent {
  return {
    documentId: 'test-document', title: 'Test document', revisionId: 'rev-current',
    body: { content: [paragraph(1, 'legacy duplicate\n')] },
    tabs: [
      tab('parent', [paragraph(1, 'parent\n')], [tab('child', [paragraph(1, 'child\n')])]),
      tab('other', [paragraph(1, 'other\n')]),
    ],
  };
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network access in test'));
});

afterEach(() => {
  const calls = vi.mocked(globalThis.fetch).mock.calls.length;
  vi.restoreAllMocks();
  expect(calls).toBe(0);
});

describe('tab traversal and text reads', () => {
  it('traverses child tabs in preorder with real IDs and parent metadata', () => {
    expect(documentTabs(fixture()).map(({ tabId, depth, parentTabId }) => ({ tabId, depth, parentTabId }))).toEqual([
      { tabId: 'parent', depth: 0, parentTabId: undefined },
      { tabId: 'child', depth: 1, parentTabId: 'parent' },
      { tabId: 'other', depth: 0, parentTabId: undefined },
    ]);
  });

  it('does not duplicate the legacy body when tabs are populated', () => {
    expect(extractTextFromDocument(fixture())).toBe('parent\n\nchild\n\nother\n');
  });

  it('reads only the specified nested tab', () => {
    expect(extractTextFromDocument(fixture(), 'child')).toBe('child\n');
  });

  it('fails on an unknown tab rather than returning a different tab', () => {
    expect(() => extractTextFromDocument(fixture(), 'missing')).toThrow('Unknown tabId');
  });

  it('requires explicit selection for multi-tab writes', () => {
    expect(() => selectWriteTab(fixture())).toThrow('tabId is required');
    expect(selectWriteTab(fixture(), 'child').tabId).toBe('child');
  });

  it('does not invent API IDs for legacy body-only responses', () => {
    const legacy = { documentId: 'legacy', title: 'Legacy', body: { content: [paragraph(1, 'text\n')] } };
    expect(documentTabs(legacy)[0].tabId).toBeUndefined();
    expect(extractTextFromDocument(legacy)).toBe('text\n');
  });

  it('rejects malformed tabs instead of silently writing to the first tab', () => {
    expect(() => documentTabs({ ...fixture(), tabs: [{ tabProperties: { title: 'missing id' } }] })).toThrow('tabProperties.tabId');
  });

  it('lists a legacy tab with a null ID and revision metadata', async () => {
    const client = new ApiClient('test-token');
    vi.spyOn(client, 'request').mockResolvedValueOnce({ size: '0' }).mockResolvedValueOnce({
      documentId: 'legacy', title: 'Legacy', revisionId: 'revision', body: { content: [] },
    });
    expect(await getDocumentTabs(client, 'legacy')).toMatchObject({
      revisionId: 'revision', totalTabs: 1, tabs: [{ tabId: null }],
    });
  });
});

describe('heading disambiguation and boundaries', () => {
  function sections(): DocumentContent {
    return {
      documentId: 'sections', title: 'Sections', revisionId: 'rev',
      tabs: [
        tab('first', [paragraph(1, 'Topic\n', 'h-first'), paragraph(7, 'body\n'), paragraph(12, 'Next\n', 'h-next')]),
        tab('second', [paragraph(1, 'Topic\n', 'h-second'), paragraph(7, 'other\n')]),
      ],
    };
  }

  it('exposes IDs and tab-local UTF-16 indices', () => {
    expect(extractHeadingsFromDocument(sections(), { tabId: 'second' })).toMatchObject([
      { id: 'h-second', tabId: 'second', index: 1, endIndex: 7, text: 'Topic' },
    ]);
  });

  it('rejects ambiguous heading text across tabs', () => {
    expect(() => findSection(sections(), { headingText: 'Topic', matchMode: 'exact' })).toThrow('Ambiguous heading');
  });

  it('resolves a unique heading ID and preserves the next heading boundary', () => {
    const result = findSection(sections(), { headingId: 'h-first' });
    expect(result).toMatchObject({ startIndex: 7, boundary: 12, nextHeadingIndex: 12 });
    expect(result?.elements).toEqual([paragraph(7, 'body\n')]);
  });
});

describe('validated operation translation', () => {
  it('scopes insert, delete and replace operations to the selected tab', () => {
    expect(transformOperations([
      { type: 'insert_text', index: 1, text: 'hello' },
      { type: 'delete_text', index: 6, endIndex: 7 },
      { type: 'replace_text', oldText: 'hello', text: 'hi' },
    ], 'child')).toEqual([
      { insertText: { location: { index: 1, tabId: 'child' }, text: 'hello' } },
      { deleteContentRange: { range: { startIndex: 6, endIndex: 7, tabId: 'child' } } },
      { replaceAllText: { containsText: { text: 'hello', matchCase: true }, replaceText: 'hi', tabsCriteria: { tabIds: ['child'] } } },
    ]);
  });

  it('accepts legacy text payloads without allowing tab overrides', () => {
    expect(transformOperations([{ insertText: { location: { index: 1 }, text: 'ok' } }], 'child')).toEqual([
      { insertText: { location: { index: 1, tabId: 'child' }, text: 'ok' } },
    ]);
    expect(() => transformOperations([{ insertText: { location: { index: 1, tabId: 'other' }, text: 'bad' } }], 'child')).toThrow('Operation tab differs');
  });

  it.each([
    { type: 'insert_text', index: 1, text: '' },
    { type: 'insert_text', index: 0, text: 'bad' },
    { type: 'insert_text', index: 1, text: '\u0000' },
    { type: 'replace_text', oldText: '', text: 'bad' },
    { type: 'delete_text', index: 2, endIndex: 1 },
    { deleteTab: { tabId: 'child' } },
  ])('rejects invalid or unsupported operations: %j', operation => {
    expect(() => transformOperations([operation], 'child')).toThrow();
  });

  it('enforces the operation count limit', () => {
    expect(() => transformOperations([])).toThrow('1–100');
    expect(() => transformOperations(Array.from({ length: 101 }, () => ({ type: 'insert_paragraph_break', index: 1 })))).toThrow('1–100');
  });
});

describe('revision-guarded Google API writes', () => {
  const edit = { documentId: 'test-document', tabId: 'child', requiredRevisionId: 'rev-current', requests: [{ type: 'insert_text', index: 1, text: 'hi' }] };

  function mockReads(document = fixture()) {
    const client = new ApiClient('test-token');
    const request = vi.spyOn(client, 'request').mockResolvedValueOnce({ size: '0' }).mockResolvedValueOnce(document);
    return { client, request };
  }

  it('requests all tab content without forcing an editor-only suggestions view', async () => {
    const { client, request } = mockReads();
    await getDocument(client, edit.documentId);
    expect(request.mock.calls[1][0]).toBe('https://docs.googleapis.com/v1/documents/test-document?includeTabsContent=true');
  });

  it('sends the selected tab and required revision in the actual write payload', async () => {
    const { client, request } = mockReads();
    request.mockResolvedValueOnce({ documentId: edit.documentId, replies: [{}] });
    await updateDocument(client, edit);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][0]).toMatch(/:batchUpdate$/);
    expect(request.mock.calls[2][1]?.method).toBe('POST');
    expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toEqual({
      requests: [{ insertText: { location: { index: 1, tabId: 'child' }, text: 'hi' } }],
      writeControl: { requiredRevisionId: 'rev-current' },
    });
  });

  it('rejects stale caller revisions before any write', async () => {
    const { client, request } = mockReads();
    await expect(updateDocument(client, { ...edit, requiredRevisionId: 'rev-old' })).rejects.toThrow('Revision conflict');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('refuses a write if Google supplies no revision', async () => {
    const { client, request } = mockReads({ ...fixture(), revisionId: undefined });
    await expect(updateDocument(client, edit)).rejects.toThrow('No revisionId');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('rejects an unselected multi-tab write before any POST', async () => {
    const { client, request } = mockReads();
    await expect(updateDocument(client, { ...edit, tabId: undefined })).rejects.toThrow('tabId is required');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('guards legacy callers with the server-read revision', async () => {
    const { client, request } = mockReads();
    request.mockResolvedValueOnce({ documentId: edit.documentId, replies: [{}] });
    await updateDocument(client, { ...edit, requiredRevisionId: undefined });
    expect(JSON.parse(String(request.mock.calls[2][1]?.body)).writeControl).toEqual({ requiredRevisionId: 'rev-current' });
  });

  it('does not retry a write rejected by Google after the initial read', async () => {
    const { client, request } = mockReads();
    request.mockRejectedValueOnce(new Error('Request failed with status 400'));
    await expect(updateDocument(client, edit)).rejects.toThrow('status 400');
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('reports an unknown outcome after a timeout without retrying', async () => {
    const { client, request } = mockReads();
    request.mockRejectedValueOnce(new Error('Request timeout after 60000ms'));
    await expect(updateDocument(client, edit)).rejects.toThrow('outcome unknown');
    expect(request).toHaveBeenCalledTimes(3);
  });
});

describe('core release tool registry', () => {
  it('keeps the tool, validation and handler registries aligned', () => {
    const names = GDOCS_TOOLS.map(tool => tool.name).sort();
    expect(names).toEqual(Object.keys(HANDLERS).sort());
    expect(names).toEqual(Object.keys(SCHEMAS).sort());
    expect(names).toHaveLength(10);
    expect(names).not.toContain('replace_section');
    expect(names).not.toContain('export_document');
  });

  it('advertises tab selection and caller revision on update_document', () => {
    const schema = GDOCS_TOOLS.find(tool => tool.name === 'update_document')!.inputSchema;
    expect(schema.properties).toHaveProperty('tabId');
    expect(schema.properties).toHaveProperty('requiredRevisionId');
    expect(SCHEMAS.update_document.parse({ documentId: 'doc', tabId: 'child', requiredRevisionId: 'rev', operations: [{ type: 'insert_text', index: 1, text: 'x' }] })).toMatchObject({ tabId: 'child', requiredRevisionId: 'rev' });
  });
});
