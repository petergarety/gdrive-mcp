import { DocumentContent } from '../types/index.js';
import { ParagraphElement, StructuralElement, TableCell, TableRow } from './types.js';
import { MAX_PROCESSING_TIME_MS, MAX_TEXT_LENGTH } from './constants.js';

/**
 * Extract plain text from a Google Docs document.
 *
 * Walks the document's structural elements, paragraphs, and table cells.
 * Throws if extraction exceeds time or size limits so callers never mistake
 * a truncated result for the complete document.
 */
export function extractTextFromDocument(document: DocumentContent): string {
  const startTime = Date.now();
  let totalLength = 0;
  const textChunks: string[] = [];
  const maxDepth = 10;

  const extractFromElement = (element: StructuralElement | ParagraphElement, depth = 0): void => {
    if (Date.now() - startTime > MAX_PROCESSING_TIME_MS) {
      throw new Error('Text extraction timeout - document too complex');
    }
    if (depth > maxDepth) return;

    if ('textRun' in element && element.textRun?.content) {
      const content = element.textRun.content;
      if (content.length > MAX_TEXT_LENGTH - totalLength) {
        throw new Error('Document text too large to process');
      }
      totalLength += content.length;
      textChunks.push(content);
      return;
    }

    if ('paragraph' in element && element.paragraph?.elements) {
      element.paragraph.elements.forEach((el) => extractFromElement(el, depth + 1));
      return;
    }

    if ('table' in element && element.table) {
      element.table.tableRows?.forEach((row: TableRow) => {
        row.tableCells?.forEach((cell: TableCell) => {
          cell.content?.forEach((cellEl: StructuralElement) =>
            extractFromElement(cellEl, depth + 1),
          );
        });
      });
    }
  };

  try {
    document.body?.content?.forEach((el) => extractFromElement(el as StructuralElement));
    return textChunks.join('');
  } catch (error) {
    if (process.env.MCP_DEBUG) {
      console.error('[mcp][textExtraction] error:', error);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error('Failed to extract text from document: ' + message);
  }
}

/**
 * Extract text from a flat array of structural elements (already filtered).
 * Used by heading-content extraction.
 */
export function extractTextFromElements(elements: StructuralElement[]): string {
  let text = '';
  for (const element of elements) {
    element.paragraph?.elements?.forEach((el) => {
      if (el.textRun?.content) text += el.textRun.content;
    });
  }
  return text;
}
