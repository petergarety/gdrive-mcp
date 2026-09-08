import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { DEFAULT_EXPORT_BYTES, EXPORT_DOCUMENT_ID_PATTERN, MAX_EXPORT_BYTES } from '../api/exports.js';

export const EXPORT_DOCUMENT_TOOL: Tool = {
  name: 'export_document',
  description: 'Export a Google Doc as markdown, text, pdf, or docx. Returns JSON file metadata and one embedded MCP resource (text or base64 blob), not a browser URL. Save with the documented client helper. Read-only; no per-tab selection or guarantee about multi-tab inclusion. Default limit 2 MiB; overflow returns no partial file.',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      documentId: { type: 'string', pattern: EXPORT_DOCUMENT_ID_PATTERN, description: 'Google document ID, not a URL.' },
      format: { type: 'string', enum: ['markdown', 'text', 'pdf', 'docx'] },
      maxBytes: {
        type: 'integer', minimum: 1, maximum: MAX_EXPORT_BYTES, default: DEFAULT_EXPORT_BYTES,
        description: 'Limit on exported bytes before JSON/base64 encoding. Google also enforces its own 10 MB export limit.',
      },
    },
    required: ['documentId', 'format'],
    additionalProperties: false,
  },
};
