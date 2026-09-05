import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const GDOCS_TOOLS: Tool[] = [
  {
    name: 'list_documents',
    description: 'List Google Docs in the user\'s Drive',
    inputSchema: {
      type: 'object',
      properties: {
        pageSize: {
          type: 'number',
          description: 'Number of documents to return (default: 10, max: 100)',
          minimum: 1,
          maximum: 100,
        },
        pageToken: {
          type: 'string',
          description: 'Token for pagination to get next page of results',
        },
      },
    },
  },
  {
    name: 'get_document',
    description: 'Get a Google Doc including all nested tabs and revisionId (when the caller has edit access). Use tab-local UTF-16 indices for updates.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc to retrieve',
        },
      },
      required: ['documentId'],
    },
  },
  {
    name: 'get_document_text',
    description: 'Get plain text from one tab or all tab bodies in preorder, with revisionId when available. Export fallback is unavailable when tabId is specified.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc to retrieve text from',
        },
        tabId: {
          type: 'string',
          description: 'Optional tab ID from get_document_tabs; omit to read all tab bodies',
        },
      },
      required: ['documentId'],
    },
  },
  {
    name: 'create_document',
    description: 'Create a new Google Doc',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The title of the new document',
        },
        content: {
          type: 'string',
          description: 'Initial content for the document (optional)',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_document',
    description: 'Apply 1-100 text operations in order. Read first and supply requiredRevisionId to reject stale edits. Multi-tab documents require tabId. Indices are UTF-16 offsets within that tab; each operation sees the result of preceding operations. Never retry blindly after a timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc to update',
        },
        tabId: {
          type: 'string',
          description: 'Target tab ID; mandatory for multi-tab documents',
        },
        requiredRevisionId: {
          type: 'string',
          description: 'Revision from your latest read. If omitted for compatibility, only changes after the server read are guarded, not changes since your earlier read.',
        },
        operations: {
          type: 'array',
          description: 'Array of update operations to perform',
          minItems: 1,
          maxItems: 100,
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['insert_text', 'replace_text', 'delete_text', 'insert_paragraph_break'],
                description: 'Type of operation to perform',
              },
              index: {
                type: 'integer',
                minimum: 1,
                description: 'Tab-local UTF-16 index; body text starts at 1. Required except for replace_text.',
              },
              text: {
                type: 'string',
                maxLength: 200000,
                description: 'Text to insert or replacement text',
              },
              oldText: {
                type: 'string',
                minLength: 1,
                maxLength: 200000,
                description: 'Non-empty text to match for replace_text within the selected tab',
              },
              matchCase: {
                type: 'boolean',
                default: true,
                description: 'Case-sensitive replacement matching',
              },
              endIndex: {
                type: 'integer',
                minimum: 1,
                description: 'Exclusive end index for delete_text; defaults to index + 1',
              },
            },
            required: ['type'],
            additionalProperties: false,
            oneOf: [
              { properties: { type: { const: 'insert_text' } }, required: ['index', 'text'] },
              { properties: { type: { const: 'replace_text' } }, required: ['oldText', 'text'] },
              { properties: { type: { const: 'delete_text' } }, required: ['index'] },
              { properties: { type: { const: 'insert_paragraph_break' } }, required: ['index'] },
            ],
          },
        },
      },
      required: ['documentId', 'operations'],
    },
  },
  {
    name: 'search_documents',
    description: 'Search for Google Docs by content or title',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to find documents',
        },
        pageSize: {
          type: 'number',
          description: 'Number of results to return (default: 10, max: 50)',
          minimum: 1,
          maximum: 50,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_document_info',
    description: 'Get metadata about a Google Doc (without full content)',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc to get info about',
        },
      },
      required: ['documentId'],
    },
  },
  {
    name: 'get_document_tabs',
    description: 'List Google Docs tabs, including nested children in preorder, with real tab IDs, hierarchy and revisionId. Legacy body-only responses have a null tabId.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc to analyze',
        },
      },
      required: ['documentId'],
    },
  },

  {
    name: 'get_document_headings',
    description: 'List document headings with heading IDs, tab IDs, UTF-16 indices and revisionId; TITLE is treated as level 1. Filter by tabId to avoid ambiguity.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc to analyze',
        },
        tabId: {
          type: 'string',
          description: 'Optional tab ID; omit to list headings from all tabs',
        },
        includeText: {
          type: 'boolean',
          description: 'Whether to include the heading text content (default: true)',
          default: true,
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum heading level to include (1-6, default: 6)',
          minimum: 1,
          maximum: 6,
          default: 6,
        },
      },
      required: ['documentId'],
    },
  },

  {
    name: 'get_content_under_heading',
    description: 'Read a section until the next heading of equal or higher level within its tab. Provide exactly one of headingId or headingText. Ambiguous matches and headings inside tables are rejected. Returns tab and revision metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc',
        },
        tabId: {
          type: 'string',
          description: 'Optional tab ID to disambiguate repeated headings',
        },
        headingId: {
          type: 'string',
          description: 'Heading ID from get_document_headings; use instead of headingText',
        },
        headingText: {
          type: 'string',
          description: 'The text of the heading to find (exact match or partial)',
        },
        headingLevel: {
          type: 'number',
          description: 'The heading level (1-6) to search for (optional for more precise matching)',
          minimum: 1,
          maximum: 6,
        },
        matchMode: {
          type: 'string',
          enum: ['exact', 'contains', 'starts_with'],
          description: 'How to match the heading text (default: contains)',
          default: 'contains',
        },
      },
      required: ['documentId'],
      oneOf: [
        { required: ['headingId'], not: { required: ['headingText'] } },
        { required: ['headingText'], not: { required: ['headingId'] } },
      ],
    },
  },

];
