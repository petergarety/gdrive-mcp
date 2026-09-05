import { describe, expect, it } from 'vitest';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { ReplaceSectionSchema, SCHEMAS } from '../handlers/schemas.js';
import { invalidSectionArgs, sectionArgs } from '../sectionReplacement.test-support.js';
import { REPLACE_SECTION_TOOL } from './replaceSection.js';

const validate = new AjvJsonSchemaValidator().getValidator(REPLACE_SECTION_TOOL.inputSchema);

describe('replace_section published and runtime schemas', () => {
  it('reuses the API schema and defaults safely to a preview', () => {
    expect(SCHEMAS.replace_section).toBe(ReplaceSectionSchema);
    expect(ReplaceSectionSchema.parse(sectionArgs)).toEqual({ ...sectionArgs, dryRun: true });
  });

  it.each(invalidSectionArgs)('both reject $label', ({ args }) => {
    expect(validate(args).valid).toBe(false);
    expect(ReplaceSectionSchema.safeParse(args).success).toBe(false);
  });

  it.each([
    { label: 'implicit preview', args: sectionArgs },
    { label: 'explicit preview', args: { ...sectionArgs, dryRun: true } },
    { label: 'preview with revision', args: { ...sectionArgs, requiredRevisionId: 'revision' } },
    { label: 'guarded apply', args: { ...sectionArgs, dryRun: false, requiredRevisionId: 'revision' } },
    { label: 'clear section', args: { ...sectionArgs, content: '' } },
    { label: 'LF and tabs', args: { ...sectionArgs, content: 'a\nb\t😀\n' } },
    { label: 'exact length limit', args: { ...sectionArgs, content: 'x'.repeat(200000) } },
    { label: 'heading text without tab', args: { documentId: 'doc', headingText: 'Topic', headingLevel: 1, content: 'new' } },
  ])('both accept $label', ({ args }) => {
    expect(validate(args).valid).toBe(true);
    expect(ReplaceSectionSchema.safeParse(args).success).toBe(true);
  });

  it('enforces the documented UTF-16 limit even where JSON Schema counts code points', () => {
    const args = { ...sectionArgs, content: '😀'.repeat(100001) };
    expect(validate(args).valid).toBe(true);
    expect(ReplaceSectionSchema.safeParse(args).success).toBe(false);
  });
});
