import { describe, expect, it } from 'vitest';
import type { DocumentContent } from '../types/index.js';
import type { StructuralElement } from './types.js';
import { MAX_TEXT_LENGTH } from './constants.js';
import { extractTextFromDocument } from './textExtraction.js';

function paragraph(text: string): StructuralElement {
  return { paragraph: { elements: [{ textRun: { content: text } }] } };
}

function document(content: StructuralElement[]): DocumentContent {
  return {
    documentId: 'test-document',
    title: 'Test document',
    revisionId: 'test-revision',
    body: { content },
  };
}

function table(content: StructuralElement[]): StructuralElement {
  return { table: { tableRows: [{ tableCells: [{ content }] }] } };
}

describe('extractTextFromDocument', () => {
  it('returns an empty string for an empty document', () => {
    expect(extractTextFromDocument(document([]))).toBe('');
  });

  it('preserves paragraph and table text in document order', () => {
    const input = document([
      paragraph('Before\n'),
      table([paragraph('Cell\n')]),
      paragraph('After\n'),
    ]);
    expect(extractTextFromDocument(input)).toBe('Before\nCell\nAfter\n');
  });

  it('accepts text exactly at the size limit', () => {
    const text = 'x'.repeat(MAX_TEXT_LENGTH);
    expect(extractTextFromDocument(document([paragraph(text)]))).toBe(text);
  });

  it('rejects a single oversized text run instead of returning an empty success', () => {
    const input = document([paragraph('x'.repeat(MAX_TEXT_LENGTH + 1))]);
    expect(() => extractTextFromDocument(input)).toThrow(
      'Failed to extract text from document: Document text too large to process',
    );
  });

  it('rejects cumulative overflow instead of returning only the prefix', () => {
    const input = document([
      paragraph('prefix\n'),
      paragraph('x'.repeat(MAX_TEXT_LENGTH)),
      paragraph('tail\n'),
    ]);
    expect(() => extractTextFromDocument(input)).toThrow('Document text too large to process');
  });

  it('rejects a final text run that exceeds an already-reached limit', () => {
    const input = document([paragraph('x'.repeat(MAX_TEXT_LENGTH)), paragraph('!')]);
    expect(() => extractTextFromDocument(input)).toThrow('Document text too large to process');
  });

  it('applies the same cumulative limit to text inside table cells', () => {
    const input = document([
      paragraph('prefix'),
      table([paragraph('x'.repeat(MAX_TEXT_LENGTH))]),
    ]);
    expect(() => extractTextFromDocument(input)).toThrow('Document text too large to process');
  });
});
