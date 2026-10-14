import { ToolHandler } from './types.js';
import { GetDocumentInfoArgs } from './schemas.js';
import { jsonResult, toDocumentSummary } from './documentSummary.js';

/** Returns JSON Drive metadata for one document (no content). */
export const getDocumentInfo: ToolHandler<GetDocumentInfoArgs> = async (api, args) => {
  const info = await api.getDocumentInfo(args.documentId);
  return jsonResult(toDocumentSummary(info));
};
