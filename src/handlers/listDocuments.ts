import { ToolHandler } from './types.js';
import { ListDocumentsArgs } from './schemas.js';

export const listDocuments: ToolHandler<ListDocumentsArgs> = async (api, args) => {
  const documents = await api.listDocuments(args.pageSize, args.pageToken);
  return {
    content: [
      {
        type: 'text',
        text:
          `Found ${documents.files.length} documents:\n\n` +
          documents.files.map((doc: any) => `• ${doc.name} (${doc.id})`).join('\n'),
      },
    ],
  };
};
