import { ToolHandler } from './types.js';
import { GetContentUnderHeadingArgs } from './schemas.js';

export const getContentUnderHeading: ToolHandler<GetContentUnderHeadingArgs> = async (api, args) => {
  const result = await api.getContentUnderHeading(args.documentId, {
    tabId: args.tabId,
    headingId: args.headingId,
    headingText: args.headingText,
    headingLevel: args.headingLevel,
    matchMode: args.matchMode,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
};
