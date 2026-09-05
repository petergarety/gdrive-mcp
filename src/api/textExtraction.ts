import type { DocumentContent } from '../types/index.js';
import type { StructuralElement } from './types.js';
import { MAX_PROCESSING_TIME_MS, MAX_TEXT_LENGTH } from './constants.js';
import { selectTabs } from './structure.js';

/** Read all selected tabs in preorder, never silently truncate or duplicate legacy body content. */
export function extractTextFromDocument(document: DocumentContent, tabId?: string): string {
  const startTime = Date.now();
  let totalLength = 0;
  const chunks: string[] = [];
  const append = (text: string): void => {
    if (text.length > MAX_TEXT_LENGTH - totalLength) throw new Error('Document text too large to process');
    totalLength += text.length;
    chunks.push(text);
  };
  const visit = (elements: StructuralElement[], depth = 0): void => {
    if (depth > 20) throw new Error('Document structure too deeply nested');
    for (const element of elements) {
      if (Date.now() - startTime > MAX_PROCESSING_TIME_MS) throw new Error('Text extraction timeout - document too complex');
      for (const run of element.paragraph?.elements ?? []) append(run.textRun?.content ?? '');
      for (const row of element.table?.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) visit(cell.content ?? [], depth + 1);
      }
      if (element.tableOfContents) visit(element.tableOfContents.content ?? [], depth + 1);
    }
  };
  try {
    const tabs = selectTabs(document, tabId);
    tabs.forEach((tab, index) => {
      if (index > 0) append('\n');
      visit(tab.content);
    });
    return chunks.join('');
  } catch (error) {
    throw new Error('Failed to extract text from document: ' + (error instanceof Error ? error.message : 'Unknown error'));
  }
}

export function extractTextFromElements(elements: StructuralElement[]): string {
  return extractTextFromDocument({ documentId: '', title: '', body: { content: elements } });
}
