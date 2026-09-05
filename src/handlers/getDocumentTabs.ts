import { ToolHandler } from './types.js';
import { GetDocumentTabsArgs } from './schemas.js';

export const getDocumentTabs: ToolHandler<GetDocumentTabsArgs> = async (api, args) => {
  const result = await api.getDocumentTabs(args.documentId);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
};
