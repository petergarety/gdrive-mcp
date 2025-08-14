#!/usr/bin/env node

// Load environment variables first
import 'dotenv/config';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { GoogleDocsAPI } from './utils/google-api.js';
import { GDOCS_TOOLS } from './tools/index.js';

/**
 * Pure MCP Server for Local Development (stdio transport)
 */
export class GoogleDocsMCPServer {
  private server: Server;
  private accessToken: string | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'gdrive-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {
            listChanged: false,  // Our tools are static
          },
          resources: {},  // We don't support MCP resources yet
          prompts: {},    // We don't support MCP prompts yet
          logging: {
            level: 'info',
          },
        },
      }
    );

    this.setupHandlers();
  }

  // Instead of pretending OAuth works, let's be honest:
    private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    // Service Account with domain-wide delegation (ONLY method for local MCP)
    const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
    const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

    if (serviceAccountPath || serviceAccountKey) {
      this.accessToken = await this.getServiceAccountToken(serviceAccountPath, serviceAccountKey);
      if (this.accessToken) return this.accessToken;
    }

    throw new Error(
      'Service Account authentication required for local MCP.\n\n' +
      'Required environment variables:\n' +
      'GOOGLE_SERVICE_ACCOUNT_PATH=/path/to/service-account.json\n' +
      'GOOGLE_USER_EMAIL=your-email@gmail.com\n\n' +
      'OR:\n' +
      'GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}\n' +
      'GOOGLE_USER_EMAIL=your-email@gmail.com\n\n' +
      'You must also set up domain-wide delegation in Google Admin Console.'
    );
  }

  private async getServiceAccountToken(path?: string, keyJson?: string): Promise<string | null> {
    try {
      let credentials;
      
      if (path) {
        // Read from file
        const fs = await import('fs/promises');
        const credentialsJson = await fs.readFile(path, 'utf8');
        credentials = JSON.parse(credentialsJson);
      } else if (keyJson) {
        // Parse from environment variable
        credentials = JSON.parse(keyJson);
      } else {
        return null;
      }

      // Use JWT for service account with domain-wide delegation
      const { JWT } = await import('google-auth-library');
      
      const userEmail = process.env.GOOGLE_USER_EMAIL;
      
      const jwtClient = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: [
          'https://www.googleapis.com/auth/documents',
          'https://www.googleapis.com/auth/drive',
        ],
        subject: userEmail, // This enables domain-wide delegation impersonation
      });

      const tokenResponse = await jwtClient.getAccessToken();
      
      return tokenResponse.token || null;
    } catch (error) {
      console.error('Service account authentication failed:', error);
      return null;
    }
  }



  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: GDOCS_TOOLS,
      };
    });

    // List available resources (empty - we don't support resources yet)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [],
      };
    });

    // List available prompts (empty - we don't support prompts yet)
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: [],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      // Input validation
      if (!name || typeof name !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'Tool name is required and must be a string');
      }

      try {
        // Get access token
        const accessToken = await this.getAccessToken();
        const googleAPI = new GoogleDocsAPI(accessToken);

        // Route to appropriate handler
        switch (name) {
          case 'list_documents':
            return await this.handleListDocuments(googleAPI, args);
          
          case 'get_document':
            return await this.handleGetDocument(googleAPI, args);
          
          case 'get_document_text':
            return await this.handleGetDocumentText(googleAPI, args);
          
          case 'create_document':
            return await this.handleCreateDocument(googleAPI, args);
          
          case 'update_document':
            return await this.handleUpdateDocument(googleAPI, args);
          
          case 'search_documents':
            return await this.handleSearchDocuments(googleAPI, args);
          
          case 'get_document_info':
            return await this.handleGetDocumentInfo(googleAPI, args);
          
          case 'get_document_tabs':
            return await this.handleGetDocumentTabs(googleAPI, args);

          case 'get_document_headings':
            return await this.handleGetDocumentHeadings(googleAPI, args);

          case 'get_tab_content':
            return await this.handleGetTabContent(googleAPI, args);
          
          case 'get_content_under_heading':
            return await this.handleGetContentUnderHeading(googleAPI, args);

          case 'insert_content_under_heading':
            return await this.handleInsertContentUnderHeading(googleAPI, args);
          
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${message}`);
      }
    });
  }

  // Tool handlers (simplified versions - we'll copy from existing implementation)
  private async handleListDocuments(api: GoogleDocsAPI, args: any) {
    const documents = await api.listDocuments(args.pageSize, args.pageToken);
    return {
      content: [
        {
          type: 'text',
          text: `Found ${documents.files.length} documents:\n\n` +
                documents.files.map((doc: any) => `• ${doc.name} (${doc.id})`).join('\n')
        }
      ]
    };
  }

  private async handleGetDocument(api: GoogleDocsAPI, args: any) {
    if (!args.documentId) {
      throw new McpError(ErrorCode.InvalidParams, 'documentId is required');
    }
    
    const document = await api.getDocument(args.documentId);
    return {
      content: [
        {
          type: 'text',
          text: `Document: ${document.title}\n\nContent:\n${JSON.stringify(document.body, null, 2)}`
        }
      ]
    };
  }

  private async handleGetDocumentText(api: GoogleDocsAPI, args: any) {
    if (!args.documentId) {
      throw new McpError(ErrorCode.InvalidParams, 'documentId is required');
    }
    
    const result = await api.getDocumentSafe(args.documentId);
    if (result.useFallback) {
      // Use export for large documents
      const text = await api.exportLargeDocumentAsText(args.documentId);
      return {
        content: [
          {
            type: 'text',
            text: `Document: ${result.metadata.name}\n\n${text}`
          }
        ]
      };
    }
    
    const text = result.document ? api.extractTextFromDocument(result.document) : '';
    return {
      content: [
        {
          type: 'text',
          text: `Document: ${result.metadata.name}\n\n${text}`
        }
      ]
    };
  }

  private async handleCreateDocument(api: GoogleDocsAPI, args: any) {
    if (!args.title) {
      throw new McpError(ErrorCode.InvalidParams, 'title is required');
    }
    
    const request = { 
      title: args.title,
      content: args.content 
    };
    const document = await api.createDocument(request);
    
    // Get document info for the web link
    const info = await api.getDocumentInfo(document.documentId);
    
    return {
      content: [
        {
          type: 'text',
          text: `Created document: ${document.title}\nID: ${document.documentId}\nURL: ${info.webViewLink}`
        }
      ]
    };
  }

  private async handleUpdateDocument(api: GoogleDocsAPI, args: any) {
    if (!args.documentId || !args.operations) {
      throw new McpError(ErrorCode.InvalidParams, 'documentId and operations are required');
    }
    
    const request = {
      documentId: args.documentId,
      requests: args.operations
    };
    const result = await api.updateDocument(request);
    return {
      content: [
        {
          type: 'text',
          text: `Document updated successfully. ${result.replies?.length || 0} operations completed.`
        }
      ]
    };
  }

  private async handleSearchDocuments(api: GoogleDocsAPI, args: any) {
    if (!args.query) {
      throw new McpError(ErrorCode.InvalidParams, 'query is required');
    }
    
    const results = await api.searchDocuments(args.query, args.pageSize);
    return {
      content: [
        {
          type: 'text',
          text: `Found ${results.length} documents matching "${args.query}":\n\n` +
                results.map((doc: any) => `• ${doc.name} (${doc.id})`).join('\n')
        }
      ]
    };
  }

  private async handleGetDocumentInfo(api: GoogleDocsAPI, args: any) {
    if (!args.documentId) {
      throw new McpError(ErrorCode.InvalidParams, 'documentId is required');
    }
    
    const info = await api.getDocumentInfo(args.documentId);
    return {
      content: [
        {
          type: 'text',
          text: `Document Info:\n` +
                `Title: ${info.name}\n` +
                `ID: ${info.id}\n` +
                `Created: ${info.createdTime}\n` +
                `Modified: ${info.modifiedTime}\n` +
                `URL: ${info.webViewLink}`
        }
      ]
    };
  }

  private async handleGetDocumentTabs(api: GoogleDocsAPI, args: any) {
    if (!args.documentId) {
      throw new McpError(ErrorCode.InvalidParams, 'documentId is required');
    }
    
    const result = await api.getDocumentTabs(args.documentId);
    return {
      content: [
        {
          type: 'text',
          text: `Document Tabs (${result.totalTabs}):\n\n` +
                result.tabs.map((tab: any) => `• ${tab.title} (${tab.tabId})`).join('\n')
        }
      ]
    };
  }

  private async handleGetDocumentHeadings(api: GoogleDocsAPI, args: any) {
    if (!args.documentId) {
      throw new McpError(ErrorCode.InvalidParams, 'documentId is required');
    }
    
    const document = await api.getDocument(args.documentId);
    const headings = api.extractHeadingsFromDocument(document, {
      includeText: args.includeText !== false,
      maxDepth: args.maxDepth || 6
    });
    
    return {
      content: [
        {
          type: 'text',
          text: `Document Headings:\n\n` +
                headings.map(h => `${'  '.repeat(h.level - 1)}${h.level}. ${h.text}`).join('\n')
        }
      ]
    };
  }

  private async handleGetTabContent(api: GoogleDocsAPI, args: any) {
    if (!args.documentId || !args.tabId) {
      throw new McpError(ErrorCode.InvalidParams, 'documentId and tabId are required');
    }
    
    const result = await api.getTabContent(args.documentId, args.tabId, args.textOnly !== false);
    return {
      content: [
        {
          type: 'text',
          text: `Tab: ${result.tabInfo.title}\n\n${result.textContent || 'No text content available'}`
        }
      ]
    };
  }

  private async handleGetContentUnderHeading(api: GoogleDocsAPI, args: any) {
    if (!args.documentId || !args.headingText) {
      throw new McpError(ErrorCode.InvalidParams, 'documentId and headingText are required');
    }
    
    const result = await api.getContentUnderHeading(args.documentId, {
      headingText: args.headingText,
      headingLevel: args.headingLevel,
      matchMode: args.matchMode || 'contains'
    });
    
    return {
      content: [
        {
          type: 'text',
          text: result.found 
            ? `Content under heading "${args.headingText}":\n\n${result.content}`
            : `Heading "${args.headingText}" not found in document`
        }
      ]
    };
  }

  private async handleInsertContentUnderHeading(api: GoogleDocsAPI, args: any) {
    if (!args.documentId || !args.headingText || !args.content) {
      throw new McpError(ErrorCode.InvalidParams, 'documentId, headingText, and content are required');
    }
    
    const result = await api.insertContentUnderHeading(args.documentId, {
      headingText: args.headingText,
      content: args.content,
      headingLevel: args.headingLevel,
      insertMode: args.insertMode || 'append',
      addNewLine: args.addNewLine !== false
    });
    
    return {
      content: [
        {
          type: 'text',
          text: `Content inserted successfully: ${result.operation}`
        }
      ]
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    // Use stderr for logging to avoid contaminating stdio
    console.error('MCP server running on stdio transport');
  }
}

// Auto-start if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new GoogleDocsMCPServer();
  server.run().catch((error) => {
    console.error('MCP server error:', error);
    process.exit(1);
  });
}
