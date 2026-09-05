import type { DocumentContent } from '../types/index.js';
import { ApiClient } from './client.js';
import { getDocument } from './documents.js';
import { extractTextFromElements } from './textExtraction.js';
import { selectTabs } from './structure.js';
import type { Heading, StructuralElement } from './types.js';

export interface HeadingOptions {
  headingText?: string;
  headingId?: string;
  headingLevel?: number;
  matchMode?: 'exact' | 'contains' | 'starts_with';
  tabId?: string;
}

export function extractHeadingsFromDocument(
  document: DocumentContent,
  options: { includeText?: boolean; maxDepth?: number; tabId?: string } = {},
): Heading[] {
  const headings: Heading[] = [];
  for (const tab of selectTabs(document, options.tabId)) {
    const visit = (elements: StructuralElement[], inTable = false, depth = 0): void => {
      if (depth > 20) throw new Error('Document structure too deeply nested');
      for (const element of elements) {
        const style = element.paragraph?.paragraphStyle;
        const match = /^HEADING_([1-6])$/.exec(style?.namedStyleType ?? '');
        const level = style?.namedStyleType === 'TITLE' ? 1 : Number(match?.[1] ?? 0);
        if (level && level <= (options.maxDepth ?? 6)) {
          if (!Number.isInteger(element.startIndex)) throw new Error('Heading has no valid character index');
          headings.push({
            level, text: options.includeText === false ? '' : (element.paragraph?.elements ?? []).map(el => el.textRun?.content ?? '').join('').trim(),
            index: element.startIndex!, endIndex: element.endIndex, id: style?.headingId,
            tabId: tab.tabId, tabTitle: tab.title, inTable,
          });
        }
        for (const row of element.table?.tableRows ?? []) {
          for (const cell of row.tableCells ?? []) visit(cell.content ?? [], true, depth + 1);
        }
      }
    };
    visit(tab.content);
  }
  return headings;
}

export function findSection(document: DocumentContent, options: HeadingOptions) {
  if (!options.headingText && !options.headingId) throw new Error('Provide headingText or headingId');
  const headings = extractHeadingsFromDocument(document, { tabId: options.tabId });
  const search = options.headingText?.toLowerCase();
  const matches = headings.filter(h => {
    if (options.headingLevel && h.level !== options.headingLevel) return false;
    if (options.headingId) return h.id === options.headingId;
    const text = h.text.toLowerCase();
    if (options.matchMode === 'exact') return text === search;
    if (options.matchMode === 'starts_with') return text.startsWith(search!);
    return text.includes(search!);
  });
  if (matches.length > 1) throw new Error('Ambiguous heading. Use tabId and a unique headingId from get_document_headings.');
  if (!matches.length) return undefined;
  const heading = matches[0];
  if (heading.inTable) throw new Error('Heading-based sections inside table cells are not supported');
  if (!Number.isInteger(heading.endIndex)) throw new Error('Heading has no valid endIndex');
  const tab = selectTabs(document, heading.tabId)[0];
  const next = headings.find(h => h.tabId === heading.tabId && !h.inTable && h.index > heading.index && h.level <= heading.level);
  const boundary = next?.index ?? tab.content.at(-1)?.endIndex;
  if (!Number.isInteger(boundary)) throw new Error('Cannot determine section boundary');
  const elements = tab.content.filter(el => (el.startIndex ?? 0) >= heading.endIndex! && (el.startIndex ?? 0) < boundary!);
  return { heading, tab, startIndex: heading.endIndex!, boundary: boundary!, nextHeadingIndex: next?.index, elements };
}

export async function getContentUnderHeading(client: ApiClient, documentId: string, options: HeadingOptions) {
  const document = await getDocument(client, documentId);
  const section = findSection(document, options);
  const metadata = { documentId, revisionId: document.revisionId };
  if (!section) return { ...metadata, found: false, content: '' };
  return {
    ...metadata, found: true, heading: section.heading,
    content: extractTextFromElements(section.elements), contentElements: section.elements,
    startIndex: section.startIndex, endIndex: section.boundary, nextHeadingIndex: section.nextHeadingIndex,
  };
}
