import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const REPLACE_SECTION_TOOL: Tool = {
  name: 'replace_section',
  description: 'Preview or replace the body under a heading, including subheadings, until the next heading of equal or higher level in the same tab. Preserves the selected heading. Defaults to a read-only preview (dryRun=true); review before/after and warnings, then apply the same edit with dryRun=false and requiredRevisionId from the preview. Multi-tab documents require tabId. Plain-text replacement loses existing formatting. Rejects ambiguous headings, tables/embedded objects in the affected section, and unresolved suggestions in the selected tab. After applying, re-read; never retry blindly after a timeout.',
  annotations: {
    title: 'Replace document section (preview first)',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {
      documentId: {
        type: 'string', pattern: '^[a-zA-Z0-9_-]+$(?![\\s\\S])',
        description: 'Google Doc ID, not a URL.',
      },
      tabId: {
        type: 'string', minLength: 1,
        description: 'Real ID from get_document_tabs. Required for multi-tab documents, including previews. Omit for legacy body-only documents; do not send null.',
      },
      headingId: {
        type: 'string', minLength: 1,
        description: 'Heading ID from get_document_headings. Provide exactly one of headingId or headingText.',
      },
      headingText: {
        type: 'string', minLength: 1,
        description: 'Case-insensitive exact heading text, not a partial match. Prefer headingId when titles repeat.',
      },
      headingLevel: {
        type: 'integer', minimum: 1, maximum: 6,
        description: 'Optional level filter (1-6); TITLE is treated as level 1.',
      },
      content: {
        type: 'string', maxLength: 200000,
        not: { pattern: '[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\uE000-\\uF8FF]' },
        description: 'Replacement plain text (not Markdown), at most 200,000 UTF-16 code units. Use LF newlines; tabs are allowed, CR/control/private-use characters are rejected. Empty text clears the section but an existing section retains one boundary newline.',
      },
      requiredRevisionId: {
        type: 'string', minLength: 1,
        description: 'Revision from a recent read/preview; mandatory when dryRun=false. A supplied stale revision is rejected even for previews.',
      },
      dryRun: {
        type: 'boolean', default: true,
        description: 'Omit or set true to preview without writing. Set false only after reviewing the preview and supplying its requiredRevisionId. Preview completion is a caller responsibility, not a stored approval token.',
      },
    },
    required: ['documentId', 'content'],
    additionalProperties: false,
    oneOf: [
      { required: ['headingId'], not: { required: ['headingText'] } },
      { required: ['headingText'], not: { required: ['headingId'] } },
    ],
    anyOf: [
      { properties: { dryRun: { const: true } } },
      { properties: { dryRun: { const: false } }, required: ['dryRun', 'requiredRevisionId'] },
    ],
  },
};
