import { ToolHandler } from './types.js';
import { GetContentUnderHeadingArgs } from './schemas.js';

export const getContentUnderHeading: ToolHandler<GetContentUnderHeadingArgs> = async (api, args) => {
  const result = await api.getContentUnderHeading(args.documentId, {
    headingText: args.headingText,
    headingLevel: args.headingLevel,
    matchMode: args.matchMode,
  });

  return {
    content: [
      {
        type: 'text',
        text: result.found
          ? `Content under heading "${args.headingText}":\n\n${result.content}`
          : `Heading "${args.headingText}" not found in document`,
      },
    ],
  };
};
