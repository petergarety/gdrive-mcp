import { z } from 'zod';
import type { DocumentContent } from '../types/index.js';
import type { StructuralElement } from './types.js';
import { ApiClient } from './client.js';
import { getDocument, guardedBatchUpdate } from './documents.js';
import { findSection } from './headings.js';
import { hasSuggestions, requireRevision, selectWriteTab } from './structure.js';

export const ReplaceSectionSchema = z.object({
  documentId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  tabId: z.string().min(1).optional(),
  headingId: z.string().min(1).optional(),
  headingText: z.string().min(1).optional(),
  headingLevel: z.number().int().min(1).max(6).optional(),
  // eslint-disable-next-line no-control-regex -- Intentionally reject unsupported control characters in Docs text.
  content: z.string().max(200000).refine(s => !/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\uE000-\uF8FF]/.test(s), 'Use LF newlines; unsupported control/private-use characters'),
  requiredRevisionId: z.string().min(1).optional(),
  dryRun: z.boolean().default(true),
}).strict().refine(v => Boolean(v.headingId) !== Boolean(v.headingText), 'Provide exactly one of headingId or headingText')
  .refine(v => v.dryRun || Boolean(v.requiredRevisionId), 'requiredRevisionId from a recent read/preview is mandatory when dryRun=false');
export type ReplaceSectionArgs = z.infer<typeof ReplaceSectionSchema>;

function plainParagraph(element: StructuralElement): string {
  const paragraph = element.paragraph;
  if (!paragraph || element.table || element.tableOfContents || paragraph.positionedObjectIds?.length ||
      !paragraph.elements?.length || paragraph.elements.some(run => !run.textRun || typeof run.textRun.content !== 'string')) {
    throw new Error('Section contains non-text content (table, embedded object, or unsupported structure); nothing was written');
  }
  const text = paragraph.elements.map(run => run.textRun!.content!).join('');
  if (!text.endsWith('\n') || element.endIndex! - element.startIndex! !== text.length) {
    throw new Error('Cannot safely map section text to UTF-16 indices');
  }
  return text;
}

/** Pure planner; does not write. Keep the last paragraph newline as a structural anchor. */
export function planSectionReplacement(document: DocumentContent, raw: ReplaceSectionArgs) {
  const args = ReplaceSectionSchema.parse(raw);
  const revisionId = requireRevision(document, args.requiredRevisionId);
  const tab = selectWriteTab(document, args.tabId);
  if (hasSuggestions(tab.content)) throw new Error('Selected tab has unresolved suggestions; resolve them before section replacement');
  const section = findSection(document, { ...args, tabId: tab.tabId, matchMode: 'exact' });
  if (!section) throw new Error('Heading not found; nothing was written');
  const headingElement = tab.content.find(el => el.startIndex === section.heading.index);
  if (!headingElement) throw new Error('Heading is not a top-level paragraph');
  plainParagraph(headingElement);
  let cursor = section.startIndex;
  const oldContent = section.elements.map(element => {
    if (element.startIndex !== cursor) throw new Error('Section indices are not contiguous');
    const text = plainParagraph(element);
    cursor = element.endIndex!;
    return text;
  }).join('');
  if (cursor !== section.boundary) throw new Error('Section boundary is not a paragraph boundary');
  if (oldContent.length > 200000) throw new Error('Section exceeds the 200,000-character editing limit');

  const requests: Array<Record<string, unknown>> = [];
  const scoped = (startIndex: number, endIndex: number) => ({ startIndex, endIndex, ...(tab.tabId ? { tabId: tab.tabId } : {}) });
  const insert = (index: number, text: string) => {
    if (text) requests.push({ insertText: { location: { index, ...(tab.tabId ? { tabId: tab.tabId } : {}) }, text } });
  };
  let startIndex = section.startIndex;
  const core = args.content.endsWith('\n') ? args.content.slice(0, -1) : args.content;
  let afterContent = '';
  let styleEnd = startIndex;
  if (section.elements.length) {
    const deleteEnd = section.boundary - 1;
    if (deleteEnd > startIndex) requests.push({ deleteContentRange: { range: scoped(startIndex, deleteEnd) } });
    insert(startIndex, core);
    afterContent = core + '\n';
    styleEnd = startIndex + afterContent.length;
  } else if (args.content) {
    if (section.nextHeadingIndex !== undefined) {
      afterContent = core + '\n';
      insert(startIndex, afterContent);
    } else {
      // Last heading owns the mandatory body newline: split it, don't delete it.
      insert(startIndex - 1, '\n' + core);
      afterContent = core + '\n';
    }
    styleEnd = startIndex + afterContent.length;
  }
  if (styleEnd > startIndex) {
    const range = scoped(startIndex, styleEnd);
    requests.push(
      { deleteParagraphBullets: { range } },
      { updateParagraphStyle: { range, paragraphStyle: { namedStyleType: 'NORMAL_TEXT' }, fields: 'namedStyleType' } },
      { updateTextStyle: { range, textStyle: { bold: false, italic: false, underline: false, strikethrough: false }, fields: 'bold,italic,underline,strikethrough,link' } },
    );
  }
  return {
    documentId: args.documentId, tabId: tab.tabId, requiredRevisionId: revisionId,
    heading: section.heading, before: oldContent, after: afterContent,
    startIndex, originalEndIndex: section.boundary, requests,
    warnings: ['Replaces the entire section including subheadings with plain paragraphs; existing formatting is not preserved.', 'An existing section keeps one boundary newline, even when content is empty.'],
  };
}

export async function replaceSection(client: ApiClient, raw: ReplaceSectionArgs) {
  const args = ReplaceSectionSchema.parse(raw);
  const document = await getDocument(client, args.documentId);
  const plan = planSectionReplacement(document, args);
  if (args.dryRun) return { ...plan, dryRun: true, applied: false };
  const result = await guardedBatchUpdate(client, args.documentId, plan.requests, plan.requiredRevisionId);
  return { documentId: args.documentId, tabId: plan.tabId, dryRun: false, applied: plan.requests.length > 0, operationsCompleted: result.replies.length, writeControl: result.writeControl, message: 'Re-read the document before the next edit.' };
}
