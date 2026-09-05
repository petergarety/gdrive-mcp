import { ToolHandler } from './types.js';
import { CreateDocumentArgs } from './schemas.js';

export const createDocument: ToolHandler<CreateDocumentArgs> = async (api, args) => {
  const document = await api.createDocument({
    title: args.title,
    content: args.content,
  });

  // Get document info for the web link
  const info = await api.getDocumentInfo(document.documentId);

  return {
    content: [
      {
        type: 'text',
        text: `Created document: ${document.title}\nID: ${document.documentId}\nURL: ${info.webViewLink}`,
      },
    ],
  };
};
