import type { ToolHandler } from './types.js';
import type { ReplaceSectionArgs } from './schemas.js';

/** Return the preview/apply result intact; never turn a failed write into success. */
export const replaceSection: ToolHandler<ReplaceSectionArgs> = async (api, args) => {
  const result = await api.replaceSection(args);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
};
