import type { DocumentContent } from '../types/index.js';
import type { DocumentTab, StructuralElement } from './types.js';

export interface TabContent {
  tabId?: string;
  title: string;
  index: number;
  depth: number;
  parentTabId?: string;
  content: StructuralElement[];
}

/** Preorder traversal matches the Docs UI; never synthesize an API tab ID. */
export function documentTabs(document: DocumentContent): TabContent[] {
  const result: TabContent[] = [];
  const visit = (tabs: DocumentTab[], depth: number, parentTabId?: string): void => {
    if (depth > 20) throw new Error('Tab hierarchy exceeds supported depth');
    for (const [index, tab] of tabs.entries()) {
      const props = tab.tabProperties;
      if (!props?.tabId) throw new Error('Google returned a tab without tabProperties.tabId');
      result.push({
        tabId: props.tabId, title: props.title ?? 'Untitled tab',
        index: props.index ?? index, depth, parentTabId,
        content: tab.documentTab?.body?.content ?? [],
      });
      visit(tab.childTabs ?? [], depth + 1, props.tabId);
    }
  };
  if (document.tabs?.length) visit(document.tabs, 0);
  else result.push({ title: document.title, index: 0, depth: 0, content: document.body?.content ?? [] });
  return result;
}

export function selectTabs(document: DocumentContent, tabId?: string): TabContent[] {
  const tabs = documentTabs(document);
  if (tabId === undefined) return tabs;
  const selected = tabs.find(tab => tab.tabId === tabId);
  if (!selected) throw new Error('Unknown tabId. Read get_document_tabs for valid IDs.');
  return [selected];
}

export function selectWriteTab(document: DocumentContent, tabId?: string): TabContent {
  const tabs = selectTabs(document, tabId);
  if (tabs.length !== 1) throw new Error('tabId is required for writes to a multi-tab document');
  return tabs[0];
}

/** A revision is mandatory internally even when an older caller omits it. */
export function requireRevision(document: DocumentContent, expected?: string): string {
  if (!document.revisionId) throw new Error('No revisionId returned; refusing an unguarded write');
  if (expected !== undefined && expected !== document.revisionId) {
    throw new Error('Revision conflict: document changed. Read it again and review the edit; nothing was written.');
  }
  return document.revisionId;
}

export function hasSuggestions(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSuggestions);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => {
    const populated = child != null && (typeof child !== 'object' || Object.keys(child).length > 0);
    return (key.startsWith('suggested') && populated) || hasSuggestions(child);
  });
}
