import { z } from 'zod';

export const NAMED_STYLE_TYPES = ['NORMAL_TEXT', 'TITLE', 'SUBTITLE', 'HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4', 'HEADING_5', 'HEADING_6'] as const;
export const ALIGNMENTS = ['START', 'CENTER', 'END', 'JUSTIFIED'] as const;
export const BULLET_PRESETS = ['BULLET_DISC_CIRCLE_SQUARE', 'NUMBERED_DECIMAL_ALPHA_ROMAN'] as const;
export const DOCUMENT_ID_SOURCE = '^[a-zA-Z0-9_-]+$(?![\\s\\S])';
export const UNSUPPORTED_TEXT_SOURCE = '[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\uE000-\\uF8FF]';
export const HTTP_URL_SOURCE = '^[hH][tT][tT][pP][sS]?://[^\\s]+$(?![\\s\\S])';
const unsupportedText = new RegExp(UNSUPPORTED_TEXT_SOURCE);
const httpUrl = new RegExp(HTTP_URL_SOURCE);
export const MAX_INDEX = Number.MAX_SAFE_INTEGER - 1; // Leave room for default one-unit deletion.
const index = z.number().int().min(1).max(MAX_INDEX);
const text = z.string().max(200000).refine(s => !unsupportedText.test(s), 'Unsupported control/private-use characters');
const nonEmptyText = text.refine(s => s.length > 0, 'Text must not be empty');
const range = { index, endIndex: index };
const nonEmptyRange = <T extends { index: number; endIndex: number }>(v: T) => v.endIndex > v.index;
const url = z.string().url().max(2048).regex(httpUrl, 'Use an HTTP(S) URL without whitespace');
export const TextStyleSchema = z.object({
  bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(), link: z.object({ url }).strict().optional(),
  fontSize: z.object({ magnitude: z.number().positive().max(400), unit: z.literal('PT') }).strict().optional(),
  weightedFontFamily: z.object({ fontFamily: z.string().min(1).max(100) }).strict().optional(),
}).strict().refine(s => Object.keys(s).length > 0, 'Provide at least one style');
export const ParagraphStyleSchema = z.object({
  namedStyleType: z.enum(NAMED_STYLE_TYPES).optional(),
  alignment: z.enum(ALIGNMENTS).optional(),
}).strict().refine(s => Object.keys(s).length > 0, 'Provide at least one style');
export const OperationSchema = z.union([
  z.object({ type: z.literal('insert_text'), index, text: nonEmptyText }).strict(),
  z.object({ type: z.literal('insert_paragraph_break'), index }).strict(),
  z.object({ type: z.literal('delete_text'), index, endIndex: index.optional() }).strict().refine(v => v.endIndex === undefined || v.endIndex > v.index, 'endIndex must exceed index'),
  z.object({ type: z.literal('replace_text'), oldText: nonEmptyText, text, matchCase: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('format_text'), ...range, style: TextStyleSchema }).strict().refine(nonEmptyRange, 'endIndex must exceed index'),
  z.object({ type: z.literal('format_paragraph'), ...range, style: ParagraphStyleSchema }).strict().refine(nonEmptyRange, 'endIndex must exceed index'),
  z.object({ type: z.literal('create_bullets'), ...range, preset: z.enum(BULLET_PRESETS).default('BULLET_DISC_CIRCLE_SQUARE') }).strict().refine(nonEmptyRange, 'endIndex must exceed index'),
  z.object({ type: z.literal('delete_bullets'), ...range }).strict().refine(nonEmptyRange, 'endIndex must exceed index'),
  z.object({ type: z.literal('insert_table'), index, rows: z.number().int().min(1).max(50), columns: z.number().int().min(1).max(20) }).strict(),
  z.object({ type: z.literal('insert_image'), index, uri: url, widthPt: z.number().positive().max(2000).optional(), heightPt: z.number().positive().max(2000).optional() }).strict(),
]);
export type Operation = z.infer<typeof OperationSchema>;

/** Legacy native text payloads only; no arbitrary passthrough or caller-controlled tab overrides. */
const location = z.object({ index, tabId: z.string().min(1).optional() }).strict();
const nativeRange = z.object({ startIndex: index, endIndex: index, tabId: z.string().min(1).optional() }).strict()
  .refine(v => v.endIndex > v.startIndex, 'endIndex must exceed startIndex');
export const LegacyOperationSchema = z.union([
    z.object({ insertText: z.object({ location, text: nonEmptyText }).strict() }).strict(),
    z.object({ deleteContentRange: z.object({ range: nativeRange }).strict() }).strict(),
    z.object({ replaceAllText: z.object({ replaceText: text, containsText: z.object({ text: nonEmptyText, matchCase: z.boolean().optional() }).strict(), tabsCriteria: z.object({ tabIds: z.array(z.string().min(1)).length(1) }).strict().optional() }).strict() }).strict(),
]);
export const OperationInputSchema = z.union([OperationSchema, LegacyOperationSchema]);

/** Shared by both MCP dispatchers and the API adapter, before any Google access. */
export const UpdateDocumentSchema = z.object({
  documentId: z.string().regex(new RegExp(DOCUMENT_ID_SOURCE), 'Use a document ID, not a URL'),
  tabId: z.string().min(1).optional(),
  requiredRevisionId: z.string().min(1).optional(),
  operations: z.array(OperationInputSchema).min(1).max(100),
}).strict().superRefine((args, ctx) => {
  // With an omitted tab, the single-tab ID can only be established after reading.
  // Explicit mismatches can and should be rejected before authentication.
  if (args.tabId === undefined) return;
  args.operations.forEach((op, i) => {
    const id = 'insertText' in op ? op.insertText.location.tabId
      : 'deleteContentRange' in op ? op.deleteContentRange.range.tabId
      : 'replaceAllText' in op ? op.replaceAllText.tabsCriteria?.tabIds[0] : undefined;
    if (id !== undefined && id !== args.tabId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['operations', i], message: 'Operation tab differs from selected tab' });
    }
  });
});

function normalizeLegacy(input: Record<string, unknown>, tabId?: string): unknown {
  if ('type' in input) return input;
  const legacy = LegacyOperationSchema.parse(input);
  const checkTab = (id?: string) => { if (id !== undefined && id !== tabId) throw new Error('Operation tab differs from selected tab'); };
  if ('insertText' in legacy) {
    checkTab(legacy.insertText.location.tabId);
    return { type: 'insert_text', index: legacy.insertText.location.index, text: legacy.insertText.text };
  }
  if ('deleteContentRange' in legacy) {
    checkTab(legacy.deleteContentRange.range.tabId);
    return { type: 'delete_text', index: legacy.deleteContentRange.range.startIndex, endIndex: legacy.deleteContentRange.range.endIndex };
  }
  checkTab(legacy.replaceAllText.tabsCriteria?.tabIds[0]);
  return { type: 'replace_text', oldText: legacy.replaceAllText.containsText.text, text: legacy.replaceAllText.replaceText, matchCase: legacy.replaceAllText.containsText.matchCase };
}

export function transformOperations(inputs: Array<Record<string, unknown>>, tabId?: string): Array<Record<string, unknown>> {
  if (!inputs.length || inputs.length > 100) throw new Error('Provide 1–100 operations');
  return inputs.map(input => {
    const op = OperationSchema.parse(normalizeLegacy(input, tabId));
    const location = 'index' in op ? { index: op.index, ...(tabId ? { tabId } : {}) } : undefined;
    const endIndex = op.type === 'delete_text'
      ? op.endIndex ?? op.index + 1
      : 'endIndex' in op ? op.endIndex : undefined;
    const range = 'index' in op ? { startIndex: op.index, endIndex, ...(tabId ? { tabId } : {}) } : undefined;
    switch (op.type) {
      case 'insert_text': return { insertText: { location, text: op.text } };
      case 'insert_paragraph_break': return { insertText: { location, text: '\n' } };
      case 'delete_text': return { deleteContentRange: { range } };
      case 'replace_text': return { replaceAllText: { containsText: { text: op.oldText, matchCase: op.matchCase ?? true }, replaceText: op.text, ...(tabId ? { tabsCriteria: { tabIds: [tabId] } } : {}) } };
      case 'format_text': return { updateTextStyle: { range, textStyle: op.style, fields: Object.keys(op.style).join(',') } };
      case 'format_paragraph': return { updateParagraphStyle: { range, paragraphStyle: op.style, fields: Object.keys(op.style).join(',') } };
      case 'create_bullets': return { createParagraphBullets: { range, bulletPreset: op.preset } };
      case 'delete_bullets': return { deleteParagraphBullets: { range } };
      case 'insert_table': return { insertTable: { location, rows: op.rows, columns: op.columns } };
      case 'insert_image': return { insertInlineImage: { location, uri: op.uri, ...((op.widthPt || op.heightPt) ? { objectSize: { ...(op.widthPt ? { width: { magnitude: op.widthPt, unit: 'PT' } } : {}), ...(op.heightPt ? { height: { magnitude: op.heightPt, unit: 'PT' } } : {}) } } : {}) } };
    }
  });
}
