import { ToolHandler } from './types.js';
import { UpdateDocumentArgs } from './schemas.js';

export const updateDocument: ToolHandler<UpdateDocumentArgs> = async (api, args) => {
  const result = await api.updateDocument({
    documentId: args.documentId,
    requests: args.operations,
  });
  return {
    content: [
      {
        type: 'text',
        text: `Document updated successfully. ${result.replies?.length || 0} operations completed.`,
      },
    ],
  };
};
