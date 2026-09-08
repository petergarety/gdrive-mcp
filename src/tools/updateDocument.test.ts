import { describe, expect, it } from 'vitest';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { UpdateDocumentSchema, SCHEMAS } from '../handlers/schemas.js';
import { UpdateDocumentSchema as AdapterSchema, OperationSchema, transformOperations, NAMED_STYLE_TYPES, ALIGNMENTS } from '../api/operations.js';
import { formattingArgs, updateTarget, invalidFormattingArgs, runtimeOnlyInvalidArgs, operationCases } from '../formatting.test-support.js';
import { CANONICAL_OPERATION_SCHEMAS, LEGACY_OPERATION_SCHEMAS, UPDATE_DOCUMENT_TOOL } from './updateDocument.js';

const validate = new AjvJsonSchemaValidator().getValidator(UPDATE_DOCUMENT_TOOL.inputSchema);

describe('update_document published and runtime contracts', () => {
  it('shares runtime validation with the API adapter and keeps revisions optional for compatibility', () => {
    expect(UpdateDocumentSchema).toBe(AdapterSchema);
    expect(SCHEMAS.update_document).toBe(AdapterSchema);
    expect(UpdateDocumentSchema.safeParse({ documentId: 'doc', operations: formattingArgs.operations }).success).toBe(true);
    expect(UPDATE_DOCUMENT_TOOL.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
  });

  it('publishes exactly the ten typed operations implemented by the adapter plus three legacy text shapes', () => {
    const names = CANONICAL_OPERATION_SCHEMAS.map(schema => (schema.properties as { type: { const: string } }).type.const).sort();
    const fixtureNames = [...new Set(operationCases.map(c => c.operation.type).filter((name): name is string => typeof name === 'string'))].sort();
    expect(names).toEqual(fixtureNames);
    expect(names).toHaveLength(10);
    expect(LEGACY_OPERATION_SCHEMAS).toHaveLength(3);
  });

  it.each(invalidFormattingArgs)('both reject $label', ({ args }) => {
    expect(validate(args).valid).toBe(false);
    expect(UpdateDocumentSchema.safeParse(args).success).toBe(false);
  });

  it.each(runtimeOnlyInvalidArgs)('server rejects documented cross-field/UTF-16 constraint: $label', ({ args }) => {
    expect(validate(args).valid).toBe(true);
    expect(UpdateDocumentSchema.safeParse(args).success).toBe(false);
  });

  it.each(operationCases)('both accept and translate $label', ({ operation, expected }) => {
    const args = { ...updateTarget, operations: [operation] };
    expect(validate(args).valid).toBe(true);
    const parsed = UpdateDocumentSchema.parse(args);
    expect(transformOperations(parsed.operations, parsed.tabId)).toEqual([expected]);
    // Strict per-variant properties must reject extras, not merely strip them.
    const withExtra = { ...args, operations: [{ ...operation, arbitrary: true }] };
    expect(validate(withExtra).valid).toBe(false);
    expect(UpdateDocumentSchema.safeParse(withExtra).success).toBe(false);
  });

  it.each(NAMED_STYLE_TYPES)('accepts named paragraph style %s', namedStyleType => {
    const op = { type: 'format_paragraph', index: 1, endIndex: 5, style: { namedStyleType } };
    expect(validate({ ...updateTarget, operations: [op] }).valid).toBe(true);
    expect(OperationSchema.safeParse(op).success).toBe(true);
    expect(transformOperations([op], 'child')).toEqual([{ updateParagraphStyle: {
      range: { startIndex: 1, endIndex: 5, tabId: 'child' }, paragraphStyle: { namedStyleType }, fields: 'namedStyleType',
    } }]);
  });

  it.each(ALIGNMENTS)('accepts paragraph alignment %s', alignment => {
    const op = { type: 'format_paragraph', index: 1, endIndex: 5, style: { alignment } };
    expect(validate({ ...updateTarget, operations: [op] }).valid).toBe(true);
    expect(OperationSchema.safeParse(op).success).toBe(true);
  });

  it.each([
    { label: '100 operations', operations: Array.from({ length: 100 }, () => operationCases[7].operation) },
    { label: 'exact text limit', operations: [{ type: 'insert_text', index: 1, text: 'x'.repeat(200000) }] },
    { label: 'exact Unicode UTF-16 limit', operations: [{ type: 'insert_text', index: 1, text: '😀'.repeat(100000) }] },
    { label: 'table limits', operations: [{ type: 'insert_table', index: 1, rows: 50, columns: 20 }] },
    { label: 'dimension limits', operations: [{ type: 'insert_image', index: 1, uri: 'https://example.com/a.png', widthPt: 2000, heightPt: 0.5 }] },
    { label: 'font limits', operations: [{ type: 'format_text', index: 1, endIndex: 5, style: { fontSize: { magnitude: 400, unit: 'PT' }, weightedFontFamily: { fontFamily: 'x'.repeat(100) } } }] },
    { label: 'LF and tabs', operations: [{ type: 'insert_text', index: 1, text: 'a\nb\t😀' }] },
  ])('both accept $label', ({ operations }) => {
    const args = { ...updateTarget, operations };
    expect(validate(args).valid).toBe(true);
    expect(UpdateDocumentSchema.safeParse(args).success).toBe(true);
  });
});
