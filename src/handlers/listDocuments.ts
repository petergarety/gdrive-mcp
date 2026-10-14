import { ToolHandler } from './types.js';
import { ListDocumentsArgs } from './schemas.js';

export const listDocuments: ToolHandler<ListDocumentsArgs> = async (api, args) => {
  const documents = await api.listDocuments(args.pageSize, args.pageToken);
  let text =
    `Found ${documents.files.length} documents:\n\n` +
    documents.files.map(doc => `• ${doc.name} (${doc.id})`).join('\n');

  // Without the continuation token, callers can never reach later pages.
  if (documents.nextPageToken) {
    text +=
      `\n\nMore documents are available. To get the next page, call list_documents again with ` +
      `pageToken: ${documents.nextPageToken}`;
  }

  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
};
