import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  ALIGNMENTS, BULLET_PRESETS, DOCUMENT_ID_SOURCE, HTTP_URL_SOURCE,
  MAX_INDEX, NAMED_STYLE_TYPES, UNSUPPORTED_TEXT_SOURCE,
} from '../api/operations.js';

type Schema = Record<string, unknown>;
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: 'object', properties, required, additionalProperties: false,
});
const index: Schema = { type: 'integer', minimum: 1, maximum: MAX_INDEX, description: 'Tab-local UTF-16 offset; body text begins at 1.' };
const endIndex: Schema = { ...index, description: 'Exclusive end; must exceed index. The server validates this cross-field constraint.' };
const id: Schema = { type: 'string', minLength: 1 };
const text: Schema = {
  type: 'string', maxLength: 200000, not: { pattern: UNSUPPORTED_TEXT_SOURCE },
  description: 'At most 200,000 UTF-16 code units (server-enforced). LF and tabs allowed; CR/control/private-use characters rejected.',
};
const nonEmptyText: Schema = { ...text, minLength: 1 };
const url: Schema = { type: 'string', format: 'uri', pattern: HTTP_URL_SOURCE, maxLength: 2048 };
const textStyle: Schema = {
  ...object({
    bold: { type: 'boolean' }, italic: { type: 'boolean' }, underline: { type: 'boolean' },
    strikethrough: { type: 'boolean' }, link: object({ url }),
    fontSize: object({ magnitude: { type: 'number', exclusiveMinimum: 0, maximum: 400 }, unit: { const: 'PT', type: 'string' } }),
    weightedFontFamily: object({ fontFamily: { type: 'string', minLength: 1, maxLength: 100 } }),
  }, []),
  minProperties: 1,
  description: 'Only supplied style fields change. Use false to disable boolean styles. Null values, arbitrary masks, link removal, and unlisted styles are unsupported.',
};
const paragraphStyle: Schema = {
  ...object({
    namedStyleType: { type: 'string', enum: [...NAMED_STYLE_TYPES] },
    alignment: { type: 'string', enum: [...ALIGNMENTS] },
  }, []),
  minProperties: 1,
};
const operation = (type: string, properties: Record<string, Schema>, required: string[], description: string): Schema => ({
  ...object({ type: { type: 'string', const: type }, ...properties }, ['type', ...required]), description,
});

export const CANONICAL_OPERATION_SCHEMAS = [
  operation('insert_text', { index, text: nonEmptyText }, ['index', 'text'], 'Insert non-empty plain text; no Markdown conversion.'),
  operation('insert_paragraph_break', { index }, ['index'], 'Insert one LF newline.'),
  operation('delete_text', { index, endIndex }, ['index'], 'Delete [index, endIndex); endIndex defaults to index + 1 UTF-16 unit. Do not split surrogate pairs or delete structural newlines.'),
  operation('replace_text', { oldText: nonEmptyText, text, matchCase: { type: 'boolean', default: true } }, ['oldText', 'text'], 'Replace literal occurrences within the selected tab. Replacement may be empty; regular expressions are unsupported.'),
  operation('format_text', { index, endIndex, style: textStyle }, ['index', 'endIndex', 'style'], 'Change character formatting in the range; the server derives the field mask from the supplied style keys.'),
  operation('format_paragraph', { index, endIndex, style: paragraphStyle }, ['index', 'endIndex', 'style'], 'Apply heading/named style or alignment to paragraphs overlapping the range; not only the selected characters.'),
  operation('create_bullets', { index, endIndex, preset: { type: 'string', enum: [...BULLET_PRESETS], default: BULLET_PRESETS[0] } }, ['index', 'endIndex'], 'Create bullets or numbering for overlapping paragraphs. Leading tabs determine nesting and are removed, potentially shifting later indices; re-read before later edits.'),
  operation('delete_bullets', { index, endIndex }, ['index', 'endIndex'], 'Remove bullets/numbering from overlapping paragraphs; this does not promise to remove indentation.'),
  operation('insert_table', { index, rows: { type: 'integer', minimum: 1, maximum: 50 }, columns: { type: 'integer', minimum: 1, maximum: 20 } }, ['index', 'rows', 'columns'], 'Insert an empty table at a valid paragraph location. A newline precedes the table; re-read cell indices before inserting content.'),
  operation('insert_image', { index, uri: url, widthPt: { type: 'number', exclusiveMinimum: 0, maximum: 2000 }, heightPt: { type: 'number', exclusiveMinimum: 0, maximum: 2000 } }, ['index', 'uri'], 'Insert an inline image fetched by Google from an HTTP(S) URL accessible to Google without your credentials. Do not use private/sensitive URLs. Dimensions are optional points; this is not an upload tool.'),
];

const location = object({ index, tabId: id }, ['index']);
const nativeRange = object({ startIndex: index, endIndex, tabId: id }, ['startIndex', 'endIndex']);
const legacy = (properties: Record<string, Schema>): Schema => ({
  ...object(properties),
  description: 'Legacy text-only compatibility. Prefer the typed operations above. Any supplied tab ID must match the selected tab; checked by the server. No arbitrary native requests.',
});
export const LEGACY_OPERATION_SCHEMAS = [
  legacy({ insertText: object({ location, text: nonEmptyText }) }),
  legacy({ deleteContentRange: object({ range: nativeRange }) }),
  legacy({ replaceAllText: object({
    replaceText: text,
    containsText: object({ text: nonEmptyText, matchCase: { type: 'boolean', default: true } }, ['text']),
    tabsCriteria: object({ tabIds: { type: 'array', items: id, minItems: 1, maxItems: 1 } }),
  }, ['replaceText', 'containsText']) }),
];

export const UPDATE_DOCUMENT_TOOL: Tool = {
  name: 'update_document',
  description: 'Apply 1-100 ordered text, style, heading, list, table, or inline-image operations to one tab. Writes immediately: no preview/dryRun mode. Read first, review the batch, and supply requiredRevisionId; mandatory tabId for multi-tab documents. UTF-16 offsets refer to each preceding operation result, not the original snapshot. Field masks are server-controlled. Use separate read/edit cycles after structural changes. Re-read after success or timeout; never retry blindly. Section-replacement structure/suggestion restrictions do not apply here.',
  annotations: { title: 'Update document text and formatting', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      documentId: { type: 'string', pattern: DOCUMENT_ID_SOURCE, description: 'Google Doc ID, not a URL.' },
      tabId: { ...id, description: 'Real tab ID from get_document_tabs. Required for multi-tab documents; omit for legacy body-only documents, never null.' },
      requiredRevisionId: { ...id, description: 'Revision from your read. Optional only for compatibility: when omitted, the write is guarded against changes after the server read, not your earlier read.' },
      operations: {
        type: 'array', minItems: 1, maxItems: 100,
        description: 'Ordered operations for one guarded batch. Unknown fields are rejected; endIndex must exceed index. UTF-16 lengths and tab-ID equality are checked by the server beyond JSON Schema validation.',
        items: { oneOf: [...CANONICAL_OPERATION_SCHEMAS, ...LEGACY_OPERATION_SCHEMAS] },
      },
    },
    required: ['documentId', 'operations'], additionalProperties: false,
  },
};
