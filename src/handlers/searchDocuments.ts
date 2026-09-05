import { ToolHandler } from './types.js';
import { SearchDocumentsArgs } from './schemas.js';

export const searchDocuments: ToolHandler<SearchDocumentsArgs> = async (api, args) => {
  const results = await api.searchDocuments(args.query, args.pageSize);
  return {
    content: [
      {
        type: 'text',
        text:
          `Found ${results.length} documents matching "${args.query}":\n\n` +
          results.map((doc: any) => `• ${doc.name} (${doc.id})`).join('\n'),
      },
    ],
  };
};
