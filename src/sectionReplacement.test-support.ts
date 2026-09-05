import { expect, it, vi, type MockInstance } from 'vitest';
import { ErrorCode, type Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DocumentContent } from './types/index.js';
import type { StructuralElement } from './api/types.js';
import { ApiClient } from './api/client.js';
import { REPLACE_SECTION_TOOL } from './tools/replaceSection.js';

export const sectionArgs = {
  documentId: 'test-document', tabId: 'child', headingId: 'topic', content: 'new',
};

// Reused by both transport suites and the advertised-schema contract tests.
export const invalidSectionArgs: Array<{ label: string; args: Record<string, unknown> }> = [
  { label: 'missing heading selector', args: { documentId: 'test-document', content: 'new' } },
  { label: 'two heading selectors', args: { ...sectionArgs, headingText: 'Topic' } },
  { label: 'empty heading ID', args: { ...sectionArgs, headingId: '' } },
  { label: 'document URL instead of ID', args: { ...sectionArgs, documentId: 'https://example.com/doc' } },
  { label: 'document ID with trailing newline', args: { ...sectionArgs, documentId: 'doc\n' } },
  { label: 'missing content', args: { documentId: 'test-document', headingId: 'topic' } },
  { label: 'null content', args: { ...sectionArgs, content: null } },
  { label: 'oversized content', args: { ...sectionArgs, content: 'x'.repeat(200001) } },
  { label: 'NUL character', args: { ...sectionArgs, content: 'a\u0000b' } },
  { label: 'CR newline', args: { ...sectionArgs, content: 'a\r' } },
  { label: 'private-use character', args: { ...sectionArgs, content: '\uE000' } },
  { label: 'apply without revision', args: { ...sectionArgs, dryRun: false } },
  { label: 'apply with empty revision', args: { ...sectionArgs, dryRun: false, requiredRevisionId: '' } },
  { label: 'string dryRun', args: { ...sectionArgs, dryRun: 'false' } },
  { label: 'null dryRun', args: { ...sectionArgs, dryRun: null } },
  { label: 'null tab ID', args: { ...sectionArgs, tabId: null } },
  { label: 'unsupported heading level', args: { ...sectionArgs, headingLevel: 7 } },
  { label: 'fractional heading level', args: { ...sectionArgs, headingLevel: 1.5 } },
  { label: 'caller-supplied native requests', args: { ...sectionArgs, requests: [{ deleteTab: {} }] } },
];

function paragraph(startIndex: number, text: string, headingId?: string): StructuralElement {
  return {
    startIndex, endIndex: startIndex + text.length,
    paragraph: {
      elements: [{ textRun: { content: text } }],
      ...(headingId ? { paragraphStyle: { namedStyleType: 'HEADING_1', headingId } } : {}),
    },
  };
}

function sectionDocument(content = [paragraph(1, 'Topic\n', 'topic'), paragraph(7, 'old\n'), paragraph(11, 'Next\n', 'next')]): DocumentContent {
  return {
    documentId: sectionArgs.documentId, title: 'Section fixture', revisionId: 'read-revision',
    tabs: [{
      tabProperties: { tabId: 'parent', title: 'Parent' },
      documentTab: { body: { content: [paragraph(1, 'Topic\n', 'parent-topic'), paragraph(7, 'keep this\n')] } },
      childTabs: [{ tabProperties: { tabId: 'child', title: 'Child' }, documentTab: { body: { content } } }],
    }],
  };
}

function mockReads(document = sectionDocument()) {
  // Keep the facade, section planner, and guarded writer real; mock the HTTP boundary only.
  return vi.spyOn(ApiClient.prototype, 'request')
    .mockResolvedValueOnce({ size: '0' })
    .mockResolvedValueOnce(document)
    .mockRejectedValue(new Error('Unexpected extra Google API request'));
}

function parseResult(result: unknown) {
  expect(result).toMatchObject({ content: [{ type: 'text', text: expect.any(String) }] });
  expect(result).not.toHaveProperty('isError', true);
  return JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
}

interface SectionTransport {
  call(args: Record<string, unknown>): Promise<unknown>;
  list(): Promise<Tool[]>;
  authenticated(): MockInstance;
}

export function registerSectionToolTests(transport: SectionTransport): void {
  it('advertises replace_section and its destructive/preview-first contract', async () => {
    const tools = await transport.list();
    expect(tools).toHaveLength(11);
    expect(tools.find(tool => tool.name === 'replace_section')).toEqual(REPLACE_SECTION_TOOL);
    expect(transport.authenticated()).not.toHaveBeenCalled();
  });

  it.each(invalidSectionArgs)('rejects $label before authentication or Google access', async ({ args }) => {
    const request = vi.spyOn(ApiClient.prototype, 'request');
    await expect(transport.call(args)).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    expect(transport.authenticated()).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('defaults to preview, returns review metadata, and never posts', async () => {
    const request = mockReads();
    const result = parseResult(await transport.call(sectionArgs));
    expect(result).toMatchObject({
      documentId: sectionArgs.documentId, tabId: 'child', dryRun: true, applied: false,
      requiredRevisionId: 'read-revision', before: 'old\n', after: 'new\n',
      startIndex: 7, originalEndIndex: 11,
      heading: { id: 'topic', tabId: 'child', text: 'Topic' },
    });
    expect(result.requests).toHaveLength(5);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('formatting is not preserved')]));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
    expect(transport.authenticated()).toHaveBeenCalledOnce();
  });

  it('supports an exact heading-text preview in the selected nested tab', async () => {
    const request = mockReads();
    const result = parseResult(await transport.call({
      documentId: sectionArgs.documentId, tabId: 'child', headingText: 'topic',
      headingLevel: 1, content: 'new', dryRun: true, requiredRevisionId: 'read-revision',
    }));
    expect(result).toMatchObject({ dryRun: true, applied: false, heading: { id: 'topic', tabId: 'child' } });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('applies one tab-scoped batch with the caller revision and preserves its result', async () => {
    const request = mockReads().mockResolvedValueOnce({
      documentId: sectionArgs.documentId, replies: [{}, {}, {}, {}, {}],
      writeControl: { requiredRevisionId: 'next-revision' },
    });
    const result = parseResult(await transport.call({ ...sectionArgs, dryRun: false, requiredRevisionId: 'read-revision' }));
    expect(result).toMatchObject({
      documentId: sectionArgs.documentId, tabId: 'child', dryRun: false, applied: true,
      operationsCompleted: 5, writeControl: { requiredRevisionId: 'next-revision' },
      message: 'Re-read the document before the next edit.',
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][0]).toBe('https://docs.googleapis.com/v1/documents/test-document:batchUpdate');
    expect(request.mock.calls[2][1]?.method).toBe('POST');
    const range = { startIndex: 7, endIndex: 11, tabId: 'child' };
    expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toEqual({
      writeControl: { requiredRevisionId: 'read-revision' },
      requests: [
        { deleteContentRange: { range: { ...range, endIndex: 10 } } },
        { insertText: { location: { index: 7, tabId: 'child' }, text: 'new' } },
        { deleteParagraphBullets: { range } },
        { updateParagraphStyle: { range, paragraphStyle: { namedStyleType: 'NORMAL_TEXT' }, fields: 'namedStyleType' } },
        { updateTextStyle: { range, textStyle: { bold: false, italic: false, underline: false, strikethrough: false }, fields: 'bold,italic,underline,strikethrough,link' } },
      ],
    });
  });

  it.each([true, false])('rejects a stale caller revision without posting (dryRun=%s)', async dryRun => {
    const request = mockReads();
    await expect(transport.call({ ...sectionArgs, dryRun, requiredRevisionId: 'stale' })).rejects.toMatchObject({
      code: ErrorCode.InternalError, message: expect.stringContaining('Revision conflict'),
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  const failures: Array<{ label: string; document?: () => DocumentContent; args?: Record<string, unknown>; message: string }> = [
    { label: 'no server revision', document: () => ({ ...sectionDocument(), revisionId: undefined }), message: 'No revisionId' },
    { label: 'unselected multi-tab document', args: { documentId: sectionArgs.documentId, headingId: 'topic', content: 'new' }, message: 'tabId is required' },
    { label: 'unknown tab', args: { ...sectionArgs, tabId: 'missing' }, message: 'Unknown tabId' },
    { label: 'missing heading', args: { ...sectionArgs, headingId: 'missing' }, message: 'Heading not found' },
    { label: 'partial heading text', args: { documentId: sectionArgs.documentId, tabId: 'child', headingText: 'Top', content: 'new' }, message: 'Heading not found' },
    { label: 'ambiguous heading text', document: () => sectionDocument([paragraph(1, 'Topic\n', 'a'), paragraph(7, 'Topic\n', 'b')]), args: { documentId: sectionArgs.documentId, tabId: 'child', headingText: 'Topic', content: 'new' }, message: 'Ambiguous heading' },
    { label: 'table in section', document: () => sectionDocument([paragraph(1, 'Topic\n', 'topic'), { startIndex: 7, endIndex: 12, table: { tableRows: [] } }]), message: 'non-text content' },
    { label: 'embedded object', document: () => sectionDocument([paragraph(1, 'Topic\n', 'topic'), { startIndex: 7, endIndex: 9, paragraph: { elements: [{ inlineObjectElement: { inlineObjectId: 'object' } }] } }]), message: 'non-text content' },
    { label: 'positioned object', document: () => {
      const body = paragraph(7, 'old\n');
      body.paragraph!.positionedObjectIds = ['object'];
      return sectionDocument([paragraph(1, 'Topic\n', 'topic'), body]);
    }, message: 'non-text content' },
    { label: 'unresolved suggestion', document: () => {
      const body = paragraph(7, 'old\n');
      body.paragraph!.elements![0].suggestedInsertionIds = ['suggestion'];
      return sectionDocument([paragraph(1, 'Topic\n', 'topic'), body]);
    }, message: 'unresolved suggestions' },
    { label: 'noncontiguous section indices', document: () => sectionDocument([paragraph(1, 'Topic\n', 'topic'), paragraph(8, 'gap\n')]), message: 'not contiguous' },
  ];

  it.each(failures)('refuses $label without writing', async failure => {
    const request = mockReads(failure.document?.());
    await expect(transport.call({
      ...(failure.args ?? sectionArgs), dryRun: false, requiredRevisionId: 'read-revision',
    })).rejects.toMatchObject({ code: ErrorCode.InternalError, message: expect.stringContaining(failure.message) });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('clears existing text but preserves the boundary newline', async () => {
    const request = mockReads();
    const result = parseResult(await transport.call({ ...sectionArgs, content: '' }));
    expect(result.after).toBe('\n');
    expect(result.requests).not.toContainEqual(expect.objectContaining({ insertText: expect.anything() }));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('returns applied=false without posting for an already-empty terminal section', async () => {
    const request = mockReads(sectionDocument([paragraph(1, 'Topic\n', 'topic')]));
    const result = parseResult(await transport.call({ ...sectionArgs, content: '', dryRun: false, requiredRevisionId: 'read-revision' }));
    expect(result).toMatchObject({ dryRun: false, applied: false, operationsCompleted: 0 });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    { label: 'Google revision/write rejection', error: 'Request failed with status 400', message: 'status 400' },
    { label: 'unknown timeout outcome', error: 'Request timeout after 60000ms', message: 'outcome unknown' },
  ])('surfaces $label without retrying or returning success', async ({ error, message }) => {
    const request = mockReads().mockRejectedValueOnce(new Error(error));
    await expect(transport.call({ ...sectionArgs, dryRun: false, requiredRevisionId: 'read-revision' })).rejects.toMatchObject({
      code: ErrorCode.InternalError, message: expect.stringContaining(message),
    });
    expect(request).toHaveBeenCalledTimes(3);
  });
}
