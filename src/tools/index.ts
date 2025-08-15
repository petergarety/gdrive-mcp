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
    description: 'Get the full content of a specific Google Doc',
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
    description: 'Get the plain text content of a Google Doc',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc to retrieve text from',
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
    description: 'Update a Google Doc with new content',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc to update',
        },
        operations: {
          type: 'array',
          description: 'Array of update operations to perform',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['insert_text', 'replace_text', 'delete_text', 'insert_paragraph_break'],
                description: 'Type of operation to perform',
              },
              index: {
                type: 'number',
                description: 'Position in document to perform operation (0-based)',
              },
              text: {
                type: 'string',
                description: 'Text to insert or replacement text',
              },
              endIndex: {
                type: 'number',
                description: 'End position for replace/delete operations',
              },
            },
            required: ['type', 'index'],
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
    description: 'Get information about tabs (sheets) in a Google Doc',
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
    description: 'Extract document structure by listing all headings (H1, H2, H3, H4, H5, H6)',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc to analyze',
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
    description: 'Get all content that appears under a specific heading until the next heading of same or higher level',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc',
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
      required: ['documentId', 'headingText'],
    },
  },

];
