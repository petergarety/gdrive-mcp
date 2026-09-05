import { ToolHandler } from './types.js';
import { GetDocumentArgs } from './schemas.js';

export const getDocument: ToolHandler<GetDocumentArgs> = async (api, args) => {
  const document = await api.getDocument(args.documentId);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(document, null, 2),
      },
    ],
  };
};
