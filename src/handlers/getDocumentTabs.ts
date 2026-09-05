import { ToolHandler } from './types.js';
import { GetDocumentTabsArgs } from './schemas.js';

export const getDocumentTabs: ToolHandler<GetDocumentTabsArgs> = async (api, args) => {
  const result = await api.getDocumentTabs(args.documentId);
  return {
    content: [
      {
        type: 'text',
        text:
          `Document Tabs (${result.totalTabs}):\n\n` +
          result.tabs.map((tab: any) => `• ${tab.title} (${tab.tabId})`).join('\n'),
      },
    ],
  };
};
