import { ToolHandler } from './types.js';
import { GetDocumentHeadingsArgs } from './schemas.js';

export const getDocumentHeadings: ToolHandler<GetDocumentHeadingsArgs> = async (api, args) => {
  const document = await api.getDocument(args.documentId);
  const headings = api.extractHeadingsFromDocument(document, {
    includeText: args.includeText,
    maxDepth: args.maxDepth,
  });

  return {
    content: [
      {
        type: 'text',
        text:
          `Document Headings:\n\n` +
          headings.map((h) => `${'  '.repeat(h.level - 1)}${h.level}. ${h.text}`).join('\n'),
      },
    ],
  };
};
