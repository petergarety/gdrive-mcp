import { ToolHandler } from './types.js';
import { GetDocumentTextArgs } from './schemas.js';

export const getDocumentText: ToolHandler<GetDocumentTextArgs> = async (api, args) => {
  const result = await api.getDocumentSafe(args.documentId);
  if (result.useFallback) {
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

  const text = result.document ? api.extractTextFromDocument(result.document) : '';
  return {
    content: [
      {
        type: 'text',
        text: `Document: ${result.metadata.name}\n\n${text}`,
      },
    ],
  };
};
