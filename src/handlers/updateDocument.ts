import { ToolHandler } from './types.js';
import { UpdateDocumentArgs } from './schemas.js';

export const updateDocument: ToolHandler<UpdateDocumentArgs> = async (api, args) => {
  const result = await api.updateDocument({
    documentId: args.documentId,
    tabId: args.tabId,
    requiredRevisionId: args.requiredRevisionId,
    requests: args.operations,
  });
  return {
    content: [
      {
        type: 'text',
        text: `Document updated successfully. ${result.replies?.length || 0} operations completed. Re-read before the next edit.` +
          (args.requiredRevisionId ? '' : '\nNo caller revision was supplied: the write was guarded only against changes after the server read. Supply requiredRevisionId from your read to detect earlier changes.'),
      },
    ],
  };
};
