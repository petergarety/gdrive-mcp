import { DocumentContent } from '../types/index.js';
import { ApiClient } from './client.js';
import { getDocumentSafe } from './documents.js';
import { extractTextFromElements } from './textExtraction.js';
import {
  Heading,
  NamedStyleType,
  Paragraph,
  StructuralElement,
} from './types.js';

/**
 * Map a Google Docs named style type to a heading level (1-6),
 * or 0 if the style is not a heading.
 */
function namedStyleToLevel(styleType: NamedStyleType | undefined): number {
  switch (styleType) {
    case 'TITLE':
    case 'HEADING_1':
      return 1;
    case 'HEADING_2':
      return 2;
    case 'HEADING_3':
      return 3;
    case 'HEADING_4':
      return 4;
    case 'HEADING_5':
      return 5;
    case 'HEADING_6':
      return 6;
    default:
      return 0;
  }
}

/**
 * If `paragraph` is a heading within `maxDepth`, return its Heading record.
 * Returns null otherwise. Consolidates the triple-duplicated logic that
 * previously lived in body/table/tabs scanning.
 */
function paragraphToHeading(
  paragraph: Paragraph,
  index: number,
  options: { includeText: boolean; maxDepth: number },
): Heading | null {
  const style = paragraph.paragraphStyle;
  const level = namedStyleToLevel(style?.namedStyleType);
  if (level === 0 || level > options.maxDepth) return null;

  let text = '';
  if (options.includeText && paragraph.elements) {
    text = paragraph.elements
      .map((el) => el.textRun?.content ?? '')
      .join('')
      .trim();
  }

  return {
    level,
    text,
    index,
    id: style?.headingId,
  };
}

/**
 * Walk a flat content array and collect headings. Recurses one level into
 * tables to catch headings nested in table cells.
 */
function collectHeadingsFromContent(
  content: StructuralElement[] | undefined,
  options: { includeText: boolean; maxDepth: number; useArrayIndex?: boolean },
  out: Heading[],
): void {
  if (!content) return;

  content.forEach((element, arrayIndex) => {
    const charIndex = options.useArrayIndex ? arrayIndex : element.startIndex ?? 0;

    if (element.paragraph) {
      const heading = paragraphToHeading(element.paragraph, charIndex, options);
      if (heading) out.push(heading);
      return;
    }

    if (element.table) {
      element.table.tableRows?.forEach((row) => {
        row.tableCells?.forEach((cell) => {
          collectHeadingsFromContent(cell.content, options, out);
        });
      });
    }
  });
}

/**
 * Walk a document and pull out all headings up to `maxDepth`.
 */
export function extractHeadingsFromDocument(
  document: DocumentContent,
  options: { includeText?: boolean; maxDepth?: number } = {},
): Heading[] {
  const includeText = options.includeText ?? true;
  const maxDepth = options.maxDepth ?? 6;
  const headings: Heading[] = [];

  collectHeadingsFromContent(
    document.body?.content as StructuralElement[] | undefined,
    { includeText, maxDepth },
    headings,
  );

  document.tabs?.forEach((tab: any) => {
    collectHeadingsFromContent(
      tab.documentTab?.body?.content as StructuralElement[] | undefined,
      { includeText, maxDepth, useArrayIndex: true },
      headings,
    );
  });

  return headings;
}

/**
 * Filter content elements that overlap the [startCharIndex, endCharIndex) range.
 */
function extractContentBetweenIndices(
  document: DocumentContent,
  startCharIndex: number,
  endCharIndex?: number,
): StructuralElement[] {
  const elements: StructuralElement[] = [];
  document.body?.content?.forEach((element: any) => {
    const elementStart = element.startIndex ?? 0;
    const elementEnd = element.endIndex ?? elementStart;
    const isAfterStart = elementEnd > startCharIndex;
    const isBeforeEnd = endCharIndex === undefined || elementStart < endCharIndex;
    if (isAfterStart && isBeforeEnd) elements.push(element);
  });
  return elements;
}

/**
 * Find a heading by text/level/match-mode and return the content that lives
 * between it and the next heading of the same or higher level.
 */
export async function getContentUnderHeading(
  client: ApiClient,
  documentId: string,
  options: {
    headingText: string;
    headingLevel?: number;
    matchMode?: 'exact' | 'contains' | 'starts_with';
  },
): Promise<{
  found: boolean;
  heading?: Heading;
  content: string;
  contentElements?: StructuralElement[];
  nextHeadingIndex?: number;
}> {
  const { headingText, headingLevel, matchMode = 'contains' } = options;

  const result = await getDocumentSafe(client, documentId);
  if (result.useFallback) {
    throw new Error('Document too large for heading-based operations');
  }

  const document = result.document!;
  const headings = extractHeadingsFromDocument(document, { includeText: true });

  const search = headingText.toLowerCase();
  const targetHeading = headings.find((h) => {
    if (headingLevel && h.level !== headingLevel) return false;
    const ht = h.text.toLowerCase();
    switch (matchMode) {
      case 'exact':
        return ht === search;
      case 'starts_with':
        return ht.startsWith(search);
      case 'contains':
      default:
        return ht.includes(search);
    }
  });

  if (!targetHeading) {
    return { found: false, content: '' };
  }

  const nextHeading = headings.find(
    (h) => h.index > targetHeading.index && h.level <= targetHeading.level,
  );

  const startIndex = targetHeading.index + 1;
  const endIndex = nextHeading ? nextHeading.index : undefined;

  const contentElements = extractContentBetweenIndices(document, startIndex, endIndex);
  const content = extractTextFromElements(contentElements);

  return {
    found: true,
    heading: targetHeading,
    content: content.trim(),
    contentElements,
    nextHeadingIndex: nextHeading?.index,
  };
}
