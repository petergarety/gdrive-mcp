import { ToolHandler } from './types.js';
import { SearchDocumentsArgs } from './schemas.js';
import { jsonResult, toDocumentPage } from './documentSummary.js';

/**
 * Returns JSON: `{ query, documents, count, nextPageToken? }`. To get the next
 * page, call again with the same query and pageSize plus `pageToken`.
 */
export const searchDocuments: ToolHandler<SearchDocumentsArgs> = async (api, args) => {
  const page = await api.searchDocuments(args.query, args.pageSize, args.pageToken);
  return jsonResult({ query: args.query, ...toDocumentPage(page.files, page.nextPageToken) });
};
