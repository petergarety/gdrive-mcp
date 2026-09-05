import { ApiClient } from './client.js';
import { getDocument } from './documents.js';
import { documentTabs, type TabContent } from './structure.js';

export type TabInfo = Omit<TabContent, 'content' | 'tabId'> & {
  tabId: string | null;
};

/** Legacy body-only responses have no API tab ID; expose null rather than inventing one. */
export async function getDocumentTabs(client: ApiClient, documentId: string) {
  const document = await getDocument(client, documentId);
  const tabs: TabInfo[] = documentTabs(document).map(({ content: _content, ...tab }) => ({
    ...tab, tabId: tab.tabId ?? null,
  }));
  return { documentId, revisionId: document.revisionId, totalTabs: tabs.length, tabs };
}
