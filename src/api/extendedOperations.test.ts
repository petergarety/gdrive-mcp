import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentContent } from '../types/index.js';
import type { StructuralElement } from './types.js';
import { ApiClient } from './client.js';
import { exportDocument, readLimitedBytes } from './exports.js';
import { transformOperations } from './operations.js';
import { planSectionReplacement, replaceSection } from './sections.js';

function paragraph(startIndex: number, text: string, headingId?: string): StructuralElement {
  return {
    startIndex, endIndex: startIndex + text.length,
    paragraph: {
      elements: [{ textRun: { content: text } }],
      ...(headingId ? { paragraphStyle: { namedStyleType: 'HEADING_1', headingId } } : {}),
    },
  };
}

function document(content: StructuralElement[]): DocumentContent {
  return {
    documentId: 'doc', title: 'Test', revisionId: 'revision',
    tabs: [{ tabProperties: { tabId: 'target' }, documentTab: { body: { content } } }],
  };
}

const args = {
  documentId: 'doc', tabId: 'target', headingId: 'topic',
  content: 'new', requiredRevisionId: 'revision', dryRun: true,
};
const range = (startIndex: number, endIndex: number) => ({ startIndex, endIndex, tabId: 'target' });
const section = () => document([paragraph(1, 'Topic\n', 'topic'), paragraph(7, 'old\n'), paragraph(11, 'Next\n', 'next')]);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('section replacement groundwork', () => {
  it('preserves the boundary newline and scopes all requests to the selected tab', () => {
    const plan = planSectionReplacement(section(), args);
    expect(plan).toMatchObject({ before: 'old\n', after: 'new\n', startIndex: 7, originalEndIndex: 11, requiredRevisionId: 'revision' });
    expect(plan.requests).toEqual([
      { deleteContentRange: { range: range(7, 10) } },
      { insertText: { location: { index: 7, tabId: 'target' }, text: 'new' } },
      { deleteParagraphBullets: { range: range(7, 11) } },
      { updateParagraphStyle: { range: range(7, 11), paragraphStyle: { namedStyleType: 'NORMAL_TEXT' }, fields: 'namedStyleType' } },
      { updateTextStyle: { range: range(7, 11), textStyle: { bold: false, italic: false, underline: false, strikethrough: false }, fields: 'bold,italic,underline,strikethrough,link' } },
    ]);
  });

  it('uses UTF-16 offsets and preserves the final body newline', () => {
    const plan = planSectionReplacement(document([paragraph(1, 'Topic\n', 'topic'), paragraph(7, 'A😀\n')]), { ...args, content: 'B😀\n' });
    expect(plan.after).toBe('B😀\n');
    expect(plan.requests[0]).toEqual({ deleteContentRange: { range: range(7, 10) } });
    expect(plan.requests[1]).toEqual({ insertText: { location: { index: 7, tabId: 'target' }, text: 'B😀' } });
    expect(plan.requests[2]).toEqual({ deleteParagraphBullets: { range: range(7, 11) } });
  });

  it('keeps one newline when clearing an existing section', () => {
    const plan = planSectionReplacement(section(), { ...args, content: '' });
    expect(plan.after).toBe('\n');
    expect(plan.requests).not.toContainEqual(expect.objectContaining({ insertText: expect.anything() }));
    expect(plan.requests[0]).toEqual({ deleteContentRange: { range: range(7, 10) } });
  });

  it('inserts into an empty section before the next heading', () => {
    const plan = planSectionReplacement(document([paragraph(1, 'Topic\n', 'topic'), paragraph(7, 'Next\n', 'next')]), args);
    expect(plan.before).toBe('');
    expect(plan.requests[0]).toEqual({ insertText: { location: { index: 7, tabId: 'target' }, text: 'new\n' } });
  });

  it('splits a terminal heading instead of deleting its mandatory newline', () => {
    const plan = planSectionReplacement(document([paragraph(1, 'Topic\n', 'topic')]), args);
    expect(plan.requests[0]).toEqual({ insertText: { location: { index: 6, tabId: 'target' }, text: '\nnew' } });
    expect(plan.after).toBe('new\n');
    expect(planSectionReplacement(document([paragraph(1, 'Topic\n', 'topic')]), { ...args, content: '' }).requests).toEqual([]);
  });

  it('rejects suggestions, non-text content and non-contiguous indices', () => {
    const suggested = paragraph(7, 'old\n');
    suggested.paragraph!.elements![0].suggestedInsertionIds = ['suggestion'];
    expect(() => planSectionReplacement(document([paragraph(1, 'Topic\n', 'topic'), suggested]), args)).toThrow('unresolved suggestions');
    expect(() => planSectionReplacement(document([paragraph(1, 'Topic\n', 'topic'), { startIndex: 7, endIndex: 12, table: { tableRows: [] } }]), args)).toThrow('non-text content');
    expect(() => planSectionReplacement(document([paragraph(1, 'Topic\n', 'topic'), paragraph(8, 'gap\n')]), args)).toThrow('not contiguous');
  });

  it('rejects stale revisions and requires a caller revision for a real write', () => {
    expect(() => planSectionReplacement(section(), { ...args, requiredRevisionId: 'stale' })).toThrow('Revision conflict');
    expect(() => planSectionReplacement(section(), { ...args, dryRun: false, requiredRevisionId: undefined })).toThrow('mandatory');
  });

  it.each([true, false])('sends no write for preview and a revision guard for apply (dryRun=%s)', async (dryRun) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network access'));
    const client = new ApiClient('test-token');
    const request = vi.spyOn(client, 'request').mockResolvedValueOnce({ size: '0' }).mockResolvedValueOnce(section());
    if (!dryRun) request.mockResolvedValueOnce({ documentId: 'doc', replies: [{}, {}, {}, {}, {}] });
    const result = await replaceSection(client, { ...args, dryRun });
    expect(result).toMatchObject({ dryRun, applied: !dryRun });
    expect(request).toHaveBeenCalledTimes(dryRun ? 2 : 3);
    if (!dryRun) {
      expect(request.mock.calls[2][0]).toBe('https://docs.googleapis.com/v1/documents/doc:batchUpdate');
      expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toEqual({
        requests: planSectionReplacement(section(), args).requests,
        writeControl: { requiredRevisionId: 'revision' },
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('bounded export groundwork', () => {
  it('accepts the exact byte limit', async () => {
    expect(await readLimitedBytes(new Response('abcd'), 4)).toEqual(new TextEncoder().encode('abcd'));
  });

  it('rejects an oversized content-length before reading', async () => {
    await expect(readLimitedBytes(new Response('abcd', { headers: { 'content-length': '4' } }), 3)).rejects.toThrow('exceeds maxBytes');
  });

  it('rejects cumulative streamed overflow even when content-length is missing', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('ab'));
        controller.enqueue(new TextEncoder().encode('cd'));
      },
      cancel,
    });
    await expect(readLimitedBytes(new Response(stream), 3)).rejects.toThrow('exceeds maxBytes');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    { format: 'text' as const, data: 'hello', encoding: 'utf-8', extension: 'txt' },
    { format: 'pdf' as const, data: 'aGVsbG8=', encoding: 'base64', extension: 'pdf' },
  ])('returns complete $format output with encoding metadata', async ({ format, data, encoding, extension }) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('hello'));
    expect(await exportDocument(new ApiClient('test-token'), { documentId: 'doc', format, maxBytes: 5 })).toMatchObject({
      documentId: 'doc', filename: `doc.${extension}`, byteLength: 5, data, encoding,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][0])).toMatch(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/doc\/export\?mimeType=/);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer test-token' } });
  });

  it('fails closed on invalid UTF-8 instead of returning replacement characters', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([0xff])));
    await expect(exportDocument(new ApiClient('test-token'), { documentId: 'doc', format: 'text', maxBytes: 5 })).rejects.toThrow();
  });

  it('reports rate limits without retrying', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 429 }));
    await expect(exportDocument(new ApiClient('test-token'), { documentId: 'doc', format: 'pdf', maxBytes: 5 })).rejects.toThrow('rate limit');
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('formatting operation groundwork', () => {
  it('translates formatting, bullets, tables and images without dropping tab scope', () => {
    const style = { bold: true, link: { url: 'https://example.com' } };
    expect(transformOperations([
      { type: 'format_text', index: 1, endIndex: 5, style },
      { type: 'format_paragraph', index: 1, endIndex: 5, style: { alignment: 'CENTER' } },
      { type: 'create_bullets', index: 1, endIndex: 5 },
      { type: 'delete_bullets', index: 1, endIndex: 5 },
      { type: 'insert_table', index: 1, rows: 2, columns: 3 },
      { type: 'insert_image', index: 1, uri: 'https://example.com/image.png', widthPt: 100, heightPt: 50 },
    ], 'target')).toEqual([
      { updateTextStyle: { range: range(1, 5), textStyle: style, fields: 'bold,link' } },
      { updateParagraphStyle: { range: range(1, 5), paragraphStyle: { alignment: 'CENTER' }, fields: 'alignment' } },
      { createParagraphBullets: { range: range(1, 5), bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' } },
      { deleteParagraphBullets: { range: range(1, 5) } },
      { insertTable: { location: { index: 1, tabId: 'target' }, rows: 2, columns: 3 } },
      { insertInlineImage: { location: { index: 1, tabId: 'target' }, uri: 'https://example.com/image.png', objectSize: { width: { magnitude: 100, unit: 'PT' }, height: { magnitude: 50, unit: 'PT' } } } },
    ]);
  });
});
