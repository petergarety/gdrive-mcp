import { ApiClient } from './client.js';
import { DocumentTab } from './types.js';
import { DOCUMENT_ID_PATTERN } from './constants.js';

export interface TabInfo {
  tabId: string;
  title: string;
  index: number;
}

/**
 * Docs API: list tabs for a document.
 * Returns a single synthetic "main" tab for legacy single-tab docs.
 */
export async function getDocumentTabs(
  client: ApiClient,
  documentId: string,
): Promise<{ totalTabs: number; tabs: TabInfo[] }> {
  if (!documentId || !DOCUMENT_ID_PATTERN.test(documentId)) {
    throw new Error('Invalid document ID format');
  }

  const url = `https://docs.googleapis.com/v1/documents/${documentId}?includeTabsContent=true`;
  const document = await client.request<{ title?: string; tabs?: DocumentTab[] }>(url);

  const tabs: TabInfo[] = [];

  if (document.tabs && Array.isArray(document.tabs)) {
    document.tabs.forEach((tab, index) => {
      tabs.push({
        tabId: tab.tabId ?? `tab_${index}`,
        title: tab.tabProperties?.title ?? tab.title ?? `Tab ${index + 1}`,
        index,
      });
    });
  } else {
    tabs.push({
      tabId: 'main',
      title: document.title ?? 'Main Document',
      index: 0,
    });
  }

  return { totalTabs: tabs.length, tabs };
}
