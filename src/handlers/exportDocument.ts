import type { ToolHandler } from './types.js';
import type { ExportDocumentArgs } from '../api/exports.js';

/** Payload occurs once, inside a standard embedded resource; metadata is JSON text. */
export const exportDocument: ToolHandler<ExportDocumentArgs> = async (api, args) => {
  const result = await api.exportDocument(args);
  const { data, ...file } = result;
  // Opaque snapshot identifier, not a URL to fetch or a persistent resources/read entry.
  const resourceUri = `gdrive-export:///${crypto.randomUUID()}/${file.filename}`;
  return {
    content: [
      { type: 'text', text: JSON.stringify({
        schemaVersion: 1, delivery: 'embedded-resource', format: args.format, ...file, resourceUri,
      }) },
      { type: 'resource', resource: {
        uri: resourceUri, mimeType: file.mimeType,
        ...(file.encoding === 'utf-8' ? { text: data } : { blob: data }),
      } },
    ],
  };
};
