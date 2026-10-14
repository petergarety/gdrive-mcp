import { ToolHandler } from './types.js';
import { ListDocumentsArgs } from './schemas.js';
import { jsonResult, toDocumentPage } from './documentSummary.js';

/**
 * Returns JSON: `{ documents, count, nextPageToken? }`. Pass `nextPageToken`
 * back as `pageToken` to get the next page; it is absent on the last page.
 */
export const listDocuments: ToolHandler<ListDocumentsArgs> = async (api, args) => {
  const page = await api.listDocuments(args.pageSize, args.pageToken);
  return jsonResult(toDocumentPage(page.files, page.nextPageToken));
};
