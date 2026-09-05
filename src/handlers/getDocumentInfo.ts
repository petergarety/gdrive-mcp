import { ToolHandler } from './types.js';
import { GetDocumentInfoArgs } from './schemas.js';

export const getDocumentInfo: ToolHandler<GetDocumentInfoArgs> = async (api, args) => {
  const info = await api.getDocumentInfo(args.documentId);
  return {
    content: [
      {
        type: 'text',
        text:
          `Document Info:\n` +
          `Title: ${info.name}\n` +
          `ID: ${info.id}\n` +
          `Created: ${info.createdTime}\n` +
          `Modified: ${info.modifiedTime}\n` +
          `URL: ${info.webViewLink}`,
      },
    ],
  };
};
