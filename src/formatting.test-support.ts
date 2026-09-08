import { expect, it, vi, type MockInstance } from 'vitest';
import { ErrorCode, type Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DocumentContent } from './types/index.js';
import { ApiClient } from './api/client.js';
import { UPDATE_DOCUMENT_TOOL } from './tools/updateDocument.js';

export const updateTarget = { documentId: 'test-document', tabId: 'child', requiredRevisionId: 'read-revision' };
const range = { startIndex: 1, endIndex: 5, tabId: 'child' };
const location = { index: 1, tabId: 'child' };
const style = {
  bold: true, italic: false, underline: true, strikethrough: false,
  link: { url: 'https://example.com/page' }, fontSize: { magnitude: 12, unit: 'PT' },
  weightedFontFamily: { fontFamily: 'Arial' },
};
export const operationCases: Array<{ label: string; operation: Record<string, unknown>; expected: Record<string, unknown> }> = [
  { label: 'insert Unicode text', operation: { type: 'insert_text', index: 1, text: 'A😀\n' }, expected: { insertText: { location, text: 'A😀\n' } } },
  { label: 'insert paragraph break', operation: { type: 'insert_paragraph_break', index: 1 }, expected: { insertText: { location, text: '\n' } } },
  { label: 'delete range', operation: { type: 'delete_text', index: 1, endIndex: 5 }, expected: { deleteContentRange: { range } } },
  { label: 'delete one UTF-16 unit', operation: { type: 'delete_text', index: 1 }, expected: { deleteContentRange: { range: { ...range, endIndex: 2 } } } },
  { label: 'replace case-sensitive by default', operation: { type: 'replace_text', oldText: 'old', text: '' }, expected: { replaceAllText: { containsText: { text: 'old', matchCase: true }, replaceText: '', tabsCriteria: { tabIds: ['child'] } } } },
  { label: 'replace case-insensitive', operation: { type: 'replace_text', oldText: 'old', text: 'new', matchCase: false }, expected: { replaceAllText: { containsText: { text: 'old', matchCase: false }, replaceText: 'new', tabsCriteria: { tabIds: ['child'] } } } },
  { label: 'all text style fields', operation: { type: 'format_text', index: 1, endIndex: 5, style }, expected: { updateTextStyle: { range, textStyle: style, fields: 'bold,italic,underline,strikethrough,link,fontSize,weightedFontFamily' } } },
  { label: 'disable a boolean style without resetting others', operation: { type: 'format_text', index: 1, endIndex: 5, style: { bold: false } }, expected: { updateTextStyle: { range, textStyle: { bold: false }, fields: 'bold' } } },
  { label: 'heading and alignment', operation: { type: 'format_paragraph', index: 1, endIndex: 5, style: { namedStyleType: 'HEADING_2', alignment: 'CENTER' } }, expected: { updateParagraphStyle: { range, paragraphStyle: { namedStyleType: 'HEADING_2', alignment: 'CENTER' }, fields: 'namedStyleType,alignment' } } },
  { label: 'default bullets', operation: { type: 'create_bullets', index: 1, endIndex: 5 }, expected: { createParagraphBullets: { range, bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' } } },
  { label: 'Google numbered preset', operation: { type: 'create_bullets', index: 1, endIndex: 5, preset: 'NUMBERED_DECIMAL_ALPHA_ROMAN' }, expected: { createParagraphBullets: { range, bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN' } } },
  { label: 'remove bullets', operation: { type: 'delete_bullets', index: 1, endIndex: 5 }, expected: { deleteParagraphBullets: { range } } },
  { label: 'insert table', operation: { type: 'insert_table', index: 1, rows: 2, columns: 3 }, expected: { insertTable: { location, rows: 2, columns: 3 } } },
  { label: 'image without dimensions', operation: { type: 'insert_image', index: 1, uri: 'https://example.com/image.png' }, expected: { insertInlineImage: { location, uri: 'https://example.com/image.png' } } },
  { label: 'image width only', operation: { type: 'insert_image', index: 1, uri: 'https://example.com/image.png', widthPt: 100 }, expected: { insertInlineImage: { location, uri: 'https://example.com/image.png', objectSize: { width: { magnitude: 100, unit: 'PT' } } } } },
  { label: 'image height only', operation: { type: 'insert_image', index: 1, uri: 'https://example.com/image.png', heightPt: 50 }, expected: { insertInlineImage: { location, uri: 'https://example.com/image.png', objectSize: { height: { magnitude: 50, unit: 'PT' } } } } },
  { label: 'image both dimensions', operation: { type: 'insert_image', index: 1, uri: 'https://example.com/image.png', widthPt: 100, heightPt: 50 }, expected: { insertInlineImage: { location, uri: 'https://example.com/image.png', objectSize: { width: { magnitude: 100, unit: 'PT' }, height: { magnitude: 50, unit: 'PT' } } } } },
  { label: 'legacy insert text', operation: { insertText: { location: { index: 1 }, text: 'ok' } }, expected: { insertText: { location, text: 'ok' } } },
  { label: 'legacy delete text with matching tab', operation: { deleteContentRange: { range } }, expected: { deleteContentRange: { range } } },
  { label: 'legacy literal replacement', operation: { replaceAllText: { replaceText: 'ok', containsText: { text: 'old', matchCase: false }, tabsCriteria: { tabIds: ['child'] } } }, expected: { replaceAllText: { replaceText: 'ok', containsText: { text: 'old', matchCase: false }, tabsCriteria: { tabIds: ['child'] } } } },
];

export const formattingArgs = { ...updateTarget, operations: [operationCases[7].operation] };
const invalidOperations: Array<[string, unknown]> = [
  ['null operation', null], ['string operation', 'format_text'], ['empty operation', {}],
  ['unknown operation', { type: 'delete_tab', tabId: 'child' }],
  ['missing insert text', { type: 'insert_text', index: 1 }],
  ['empty insert text', { type: 'insert_text', index: 1, text: '' }],
  ['NUL text', { type: 'insert_text', index: 1, text: '\u0000' }],
  ['CR text', { type: 'insert_text', index: 1, text: 'a\r\n' }],
  ['private-use text', { type: 'insert_text', index: 1, text: '\uE000' }],
  ['oversized text', { type: 'insert_text', index: 1, text: 'x'.repeat(200001) }],
  ['empty search', { type: 'replace_text', oldText: '', text: 'x' }],
  ['unsupported regex search', { type: 'replace_text', oldText: 'x', text: 'y', searchByRegex: true }],
  ['missing style', { type: 'format_text', index: 1, endIndex: 5 }],
  ['missing range end', { type: 'format_text', index: 1, style: { bold: true } }],
  ['empty style', { type: 'format_text', index: 1, endIndex: 5, style: {} }],
  ['string boolean style', { type: 'format_text', index: 1, endIndex: 5, style: { bold: 'true' } }],
  ['unknown text style', { type: 'format_text', index: 1, endIndex: 5, style: { color: 'red' } }],
  ['null link reset', { type: 'format_text', index: 1, endIndex: 5, style: { link: null } }],
  ['script link', { type: 'format_text', index: 1, endIndex: 5, style: { link: { url: 'javascript:alert(1)' } } }],
  ['malformed URL', { type: 'insert_image', index: 1, uri: 'https://' }],
  ['URL whitespace', { type: 'insert_image', index: 1, uri: 'https://example.com/\n' }],
  ['data URI', { type: 'insert_image', index: 1, uri: 'data:image/png;base64,AAAA' }],
  ['oversized URL', { type: 'insert_image', index: 1, uri: 'https://example.com/' + 'x'.repeat(2048) }],
  ['unknown nested link key', { type: 'format_text', index: 1, endIndex: 5, style: { link: { url: 'https://example.com', tabId: 'other' } } }],
  ['pixel font size', { type: 'format_text', index: 1, endIndex: 5, style: { fontSize: { magnitude: 12, unit: 'PX' } } }],
  ['zero font size', { type: 'format_text', index: 1, endIndex: 5, style: { fontSize: { magnitude: 0, unit: 'PT' } } }],
  ['oversized font size', { type: 'format_text', index: 1, endIndex: 5, style: { fontSize: { magnitude: 401, unit: 'PT' } } }],
  ['empty font family', { type: 'format_text', index: 1, endIndex: 5, style: { weightedFontFamily: { fontFamily: '' } } }],
  ['unsupported weight', { type: 'format_text', index: 1, endIndex: 5, style: { weightedFontFamily: { fontFamily: 'Arial', weight: 500 } } }],
  ['empty paragraph style', { type: 'format_paragraph', index: 1, endIndex: 5, style: {} }],
  ['unsupported heading', { type: 'format_paragraph', index: 1, endIndex: 5, style: { namedStyleType: 'HEADING_7' } }],
  ['unsupported alignment', { type: 'format_paragraph', index: 1, endIndex: 5, style: { alignment: 'LEFT' } }],
  ['old invalid numbered preset', { type: 'create_bullets', index: 1, endIndex: 5, preset: 'NUMBERED_DIGIT_ALPHA_ROMAN' }],
  ['zero rows', { type: 'insert_table', index: 1, rows: 0, columns: 1 }],
  ['too many rows', { type: 'insert_table', index: 1, rows: 51, columns: 1 }],
  ['too many columns', { type: 'insert_table', index: 1, rows: 1, columns: 21 }],
  ['fractional rows', { type: 'insert_table', index: 1, rows: 1.5, columns: 1 }],
  ['negative image width', { type: 'insert_image', index: 1, uri: 'https://example.com/a.png', widthPt: -1 }],
  ['zero image height', { type: 'insert_image', index: 1, uri: 'https://example.com/a.png', heightPt: 0 }],
  ['oversized image width', { type: 'insert_image', index: 1, uri: 'https://example.com/a.png', widthPt: 2001 }],
  ['zero index', { type: 'delete_bullets', index: 0, endIndex: 5 }],
  ['fractional index', { type: 'delete_bullets', index: 1.5, endIndex: 5 }],
  ['unsafe index', { type: 'delete_text', index: Number.MAX_SAFE_INTEGER + 1 }],
  ['caller field mask', { type: 'format_text', index: 1, endIndex: 5, style: { bold: true }, fields: '*' }],
  ['operation tab override', { type: 'insert_text', index: 1, text: 'x', tabId: 'other' }],
  ['irrelevant property', { type: 'delete_bullets', index: 1, endIndex: 5, text: 'x' }],
  ['native formatting bypass', { updateTextStyle: { range, textStyle: { bold: true }, fields: '*' } }],
  ['legacy empty insert', { insertText: { location, text: '' } }],
  ['legacy segment override', { insertText: { location: { ...location, segmentId: 'header' }, text: 'x' } }],
  ['legacy multiple tabs', { replaceAllText: { containsText: { text: 'x' }, replaceText: 'y', tabsCriteria: { tabIds: ['child', 'parent'] } } }],
  ['legacy mixed native request', { insertText: { location, text: 'x' }, deleteTab: { tabId: 'parent' } }],
];
export const invalidFormattingArgs: Array<{ label: string; args: Record<string, unknown> }> = [
  ...invalidOperations.map(([label, operation]) => ({ label, args: { ...updateTarget, operations: [operation] } })),
  ...[
    ['missing operations', { ...updateTarget }],
    ['empty operations', { ...updateTarget, operations: [] }],
    ['too many operations', { ...updateTarget, operations: Array.from({ length: 101 }, () => operationCases[7].operation) }],
    ['document URL', { ...formattingArgs, documentId: 'https://example.com/doc' }],
    ['document trailing LF', { ...formattingArgs, documentId: 'doc\n' }],
    ['empty tab ID', { ...formattingArgs, tabId: '' }],
    ['null revision', { ...formattingArgs, requiredRevisionId: null }],
    ['empty revision', { ...formattingArgs, requiredRevisionId: '' }],
    ['unsupported preview flag', { ...formattingArgs, dryRun: true }],
    ['top-level native requests', { ...formattingArgs, requests: [] }],
    ['invalid operation after valid operation', { ...updateTarget, operations: [operationCases[7].operation, { type: 'delete_tab' }] }],
  ].map(([label, args]) => ({ label: label as string, args: args as Record<string, unknown> })),
];
// JSON Schema cannot express these cross-field/UTF-16 constraints portably.
export const runtimeOnlyInvalidArgs = [
  ...['format_text', 'format_paragraph', 'create_bullets', 'delete_bullets', 'delete_text'].map(type => ({
    label: `empty ${type} range`, args: { ...updateTarget, operations: [{ type, index: 5, endIndex: 5, ...(type === 'format_text' ? { style: { bold: true } } : type === 'format_paragraph' ? { style: { alignment: 'CENTER' } } : {}) }] },
  })),
  { label: 'reversed range', args: { ...updateTarget, operations: [{ type: 'delete_text', index: 5, endIndex: 1 }] } },
  { label: 'legacy empty range', args: { ...updateTarget, operations: [{ deleteContentRange: { range: { startIndex: 5, endIndex: 5 } } }] } },
  { label: 'mismatched legacy insert tab', args: { ...updateTarget, operations: [{ insertText: { location: { index: 1, tabId: 'parent' }, text: 'x' } }] } },
  { label: 'mismatched legacy delete tab', args: { ...updateTarget, operations: [{ deleteContentRange: { range: { ...range, tabId: 'parent' } } }] } },
  { label: 'mismatched legacy replace tab', args: { ...updateTarget, operations: [{ replaceAllText: { containsText: { text: 'x' }, replaceText: 'y', tabsCriteria: { tabIds: ['parent'] } } }] } },
  { label: 'UTF-16 overflow', args: { ...updateTarget, operations: [{ type: 'insert_text', index: 1, text: '😀'.repeat(100001) }] } },
];

export function formattingDocument(): DocumentContent {
  const content = [{ startIndex: 1, endIndex: 13, paragraph: { elements: [{ textRun: { content: 'A😀 old text\n' } }] } }];
  return {
    documentId: updateTarget.documentId, title: 'Formatting fixture', revisionId: updateTarget.requiredRevisionId,
    tabs: [{ tabProperties: { tabId: 'parent' }, documentTab: { body: { content } }, childTabs: [
      { tabProperties: { tabId: 'child' }, documentTab: { body: { content } } },
    ] }],
  };
}
export function mockFormattingReads(document = formattingDocument()) {
  return vi.spyOn(ApiClient.prototype, 'request')
    .mockResolvedValueOnce({ size: '0' }).mockResolvedValueOnce(document)
    .mockRejectedValue(new Error('Unexpected extra Google API request'));
}
function assertWrite(request: ReturnType<typeof mockFormattingReads>, requests: Record<string, unknown>[]) {
  expect(request).toHaveBeenCalledTimes(3);
  expect(request.mock.calls[1][0]).toBe('https://docs.googleapis.com/v1/documents/test-document?includeTabsContent=true');
  expect(request.mock.calls[2][0]).toBe('https://docs.googleapis.com/v1/documents/test-document:batchUpdate');
  expect(request.mock.calls[2][1]?.method).toBe('POST');
  expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toEqual({ requests, writeControl: { requiredRevisionId: updateTarget.requiredRevisionId } });
}
interface FormattingTransport {
  call(args: Record<string, unknown>): Promise<unknown>;
  list(): Promise<Tool[]>;
  authenticated(): MockInstance;
}
export function registerFormattingToolTests(transport: FormattingTransport): void {
  it('discovers the expanded update tool alongside exports without authenticating', async () => {
    const tools = await transport.list();
    expect(tools).toHaveLength(12);
    expect(tools.find(tool => tool.name === 'update_document')).toEqual(UPDATE_DOCUMENT_TOOL);
    expect(transport.authenticated()).not.toHaveBeenCalled();
  });
  it.each([...invalidFormattingArgs, ...runtimeOnlyInvalidArgs])('rejects $label before token acquisition or Google access', async ({ args }) => {
    const request = vi.spyOn(ApiClient.prototype, 'request');
    await expect(transport.call(args)).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    expect(request).not.toHaveBeenCalled();
    expect(transport.authenticated()).not.toHaveBeenCalled();
  });
  it.each(operationCases)('sends $label as an exact tab-scoped guarded payload', async ({ operation, expected }) => {
    const request = mockFormattingReads().mockResolvedValueOnce({ documentId: updateTarget.documentId, replies: [{}] });
    const result = await transport.call({ ...updateTarget, operations: [operation] });
    assertWrite(request, [expected]);
    expect(result).toMatchObject({ content: [{ type: 'text', text: 'Document updated successfully. 1 operations completed. Re-read before the next edit.' }] });
    expect(transport.authenticated()).toHaveBeenCalledOnce();
  });
  it('preserves ordered post-insertion UTF-16 indices within one batch', async () => {
    const request = mockFormattingReads().mockResolvedValueOnce({ documentId: updateTarget.documentId, replies: [{}, {}] });
    await transport.call({ ...updateTarget, operations: [
      { type: 'insert_text', index: 1, text: '😀' },
      { type: 'format_text', index: 3, endIndex: 4, style: { italic: true } },
    ] });
    assertWrite(request, [
      { insertText: { location, text: '😀' } },
      { updateTextStyle: { range: { startIndex: 3, endIndex: 4, tabId: 'child' }, textStyle: { italic: true }, fields: 'italic' } },
    ]);
  });
  it('guards callers that omit a revision and returns the compatibility warning', async () => {
    const request = mockFormattingReads().mockResolvedValueOnce({ documentId: updateTarget.documentId, replies: [{}] });
    const result = await transport.call({ documentId: updateTarget.documentId, tabId: 'child', operations: formattingArgs.operations });
    assertWrite(request, [operationCases[7].expected]);
    expect(result).toMatchObject({ content: [{ text: expect.stringContaining('No caller revision was supplied') }] });
  });
  it.each([
    { label: 'stale revision', document: formattingDocument, args: { ...formattingArgs, requiredRevisionId: 'stale' }, message: 'Revision conflict' },
    { label: 'missing server revision', document: () => ({ ...formattingDocument(), revisionId: undefined }), args: formattingArgs, message: 'No revisionId' },
    { label: 'unselected multi-tab document', document: formattingDocument, args: { documentId: updateTarget.documentId, operations: formattingArgs.operations }, message: 'tabId is required' },
    { label: 'unknown tab', document: formattingDocument, args: { ...formattingArgs, tabId: 'missing' }, message: 'Unknown tabId' },
  ])('refuses $label after reading but before posting', async ({ document, args, message }) => {
    const request = mockFormattingReads(document());
    await expect(transport.call(args)).rejects.toMatchObject({ code: ErrorCode.InternalError, message: expect.stringContaining(message) });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([
    { label: 'Google batch rejection', error: 'Request failed with status 400', message: 'status 400' },
    { label: 'permission error', error: 'Request failed with status 403', message: 'status 403' },
    { label: 'timeout', error: 'Request timeout after 60000ms', message: 'outcome unknown' },
  ])('surfaces $label without retrying or reporting success', async ({ error, message }) => {
    const request = mockFormattingReads().mockRejectedValueOnce(new Error(error));
    await expect(transport.call(formattingArgs)).rejects.toMatchObject({ code: ErrorCode.InternalError, message: expect.stringContaining(message) });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('automatically scopes an omitted tab to the single actual tab', async () => {
    const document = formattingDocument();
    document.tabs = [document.tabs![0].childTabs![0]];
    const request = mockFormattingReads(document).mockResolvedValueOnce({ documentId: updateTarget.documentId, replies: [{}] });
    await transport.call({ documentId: updateTarget.documentId, operations: formattingArgs.operations });
    assertWrite(request, [operationCases[7].expected]);
  });
  it('does not invent a tab ID for a legacy body-only document', async () => {
    const document = { documentId: updateTarget.documentId, title: 'Legacy', revisionId: updateTarget.requiredRevisionId, body: { content: [] } };
    const request = mockFormattingReads(document).mockResolvedValueOnce({ documentId: updateTarget.documentId, replies: [{}] });
    await transport.call({ documentId: updateTarget.documentId, operations: formattingArgs.operations });
    assertWrite(request, [{ updateTextStyle: { range: { startIndex: 1, endIndex: 5 }, textStyle: { bold: false }, fields: 'bold' } }]);
  });
  it('checks a legacy embedded tab against the server-selected single tab', async () => {
    const document = formattingDocument();
    document.tabs = [document.tabs![0].childTabs![0]];
    const request = mockFormattingReads(document);
    await expect(transport.call({ documentId: updateTarget.documentId, operations: [{ insertText: { location: { index: 1, tabId: 'parent' }, text: 'x' } }] })).rejects.toMatchObject({ code: ErrorCode.InternalError, message: expect.stringContaining('Operation tab differs') });
    expect(request).toHaveBeenCalledTimes(2);
  });
}
