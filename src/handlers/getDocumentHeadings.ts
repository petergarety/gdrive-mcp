import { ToolHandler } from './types.js';
import { GetDocumentHeadingsArgs } from './schemas.js';

export const getDocumentHeadings: ToolHandler<GetDocumentHeadingsArgs> = async (api, args) => {
  const document = await api.getDocument(args.documentId);
  const headings = api.extractHeadingsFromDocument(document, {
    tabId: args.tabId,
    includeText: args.includeText,
    maxDepth: args.maxDepth,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          documentId: args.documentId,
          revisionId: document.revisionId,
          headings,
        }, null, 2),
      },
    ],
  };
};
