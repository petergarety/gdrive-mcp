import { ToolHandler } from './types.js';
import { GetDocumentTextArgs } from './schemas.js';

export const getDocumentText: ToolHandler<GetDocumentTextArgs> = async (api, args) => {
  const result = await api.getDocumentSafe(args.documentId);
  if (result.useFallback) {
    if (args.tabId) {
      throw new Error('Cannot export a selected tab as a fallback. No text returned; try get_document again.');
    }
    // Use export for large documents
    const text = await api.exportLargeDocumentAsText(args.documentId);
    return {
      content: [
        {
          type: 'text',
          text: `Document: ${result.metadata.name}\n\n${text}`,
        },
      ],
    };
  }

  const text = result.document ? api.extractTextFromDocument(result.document, args.tabId) : '';
  return {
    content: [
      {
        type: 'text',
        text: `Document: ${result.metadata.name}\nRevision: ${result.document?.revisionId ?? 'unavailable'}\nTab: ${args.tabId ?? 'all (preorder)'}\n\n${text}`,
      },
    ],
  };
};
