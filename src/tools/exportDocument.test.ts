import { describe, expect, it } from 'vitest';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { DEFAULT_EXPORT_BYTES, ExportDocumentSchema, MAX_EXPORT_BYTES } from '../api/exports.js';
import { SCHEMAS } from '../handlers/schemas.js';
import { exportCases, invalidExportArgs } from '../export.test-support.js';
import { EXPORT_DOCUMENT_TOOL } from './exportDocument.js';

const validate = new AjvJsonSchemaValidator().getValidator(EXPORT_DOCUMENT_TOOL.inputSchema);

describe('export_document public and runtime contracts', () => {
  it('shares the adapter schema and defaults without coercion', () => {
    expect(SCHEMAS.export_document).toBe(ExportDocumentSchema);
    expect(ExportDocumentSchema.parse({ documentId: 'doc', format: 'pdf' })).toEqual({ documentId: 'doc', format: 'pdf', maxBytes: DEFAULT_EXPORT_BYTES });
  });
  it.each(invalidExportArgs)('both reject $label', ({ args }) => {
    expect(validate(args).valid).toBe(false);
    expect(ExportDocumentSchema.safeParse(args).success).toBe(false);
  });
  it.each(exportCases)('both accept $format with default/min/max limits', ({ format }) => {
    for (const limit of [{}, { maxBytes: 1 }, { maxBytes: MAX_EXPORT_BYTES }]) {
      const args = { documentId: 'Doc_123-test', format, ...limit };
      expect(validate(args).valid).toBe(true);
      expect(ExportDocumentSchema.safeParse(args).success).toBe(true);
    }
  });
});
