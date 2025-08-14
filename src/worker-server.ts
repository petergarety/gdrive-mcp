import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { Env } from './types/index.js';
import { GoogleAuth } from './auth/google.js';
import { GoogleDocsAPI } from './utils/google-api.js';
import { GDOCS_TOOLS } from './tools/index.js';

/**
 * Cloudflare Workers HTTPS MCP Server
 * Provides web-based OAuth authentication and HTTPS MCP transport
 */
export class WorkerMCPServer {
  private server: Server;
  private googleAuth: GoogleAuth;
  private env: Env;

  constructor(env: Env) {
    this.env = env;
    this.server = new Server(
      {
        name: 'gdrive-mcp-server-worker',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {
            listChanged: false,
          },
          resources: {},
          prompts: {},
          logging: {
            level: 'info',
          },
          experimental: {
            authentication: true,
            sessionManagement: true,
            largeDocumentHandling: true,
            headingBasedOperations: true,
            tabSupport: true,
          },
        },
      }
    );

    this.googleAuth = new GoogleAuth(env);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: GDOCS_TOOLS,
      };
    });

    // Handle tool calls with authentication
    this.server.setRequestHandler(CallToolRequestSchema, async (request, context) => {
      const { name, arguments: args } = request.params;
      
      if (!name || typeof name !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'Tool name is required and must be a string');
      }

      // Get auth context from request headers or session
      const authContext = context as any;
      const userId = authContext?.userId;
      
      if (!userId) {
        throw new McpError(ErrorCode.InvalidRequest, 
          'Authentication required. Please authenticate via /auth endpoint first.');
      }

      // Get valid access token for this user
      const accessToken = await this.googleAuth.getValidAccessToken(userId);
      if (!accessToken) {
        throw new McpError(ErrorCode.InvalidRequest, 
          'Google authentication expired. Please re-authenticate via /auth endpoint.');
      }

      const googleAPI = new GoogleDocsAPI(accessToken);

      try {
        // Route to appropriate handler (same as MCP server)
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

  // Session management
  generateUserId(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async createSession(userId: string): Promise<string> {
    const sessionToken = this.generateSecureToken();
    const sessionData = {
      userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
    };
    
    await this.env.TOKEN_STORE.put(`session:${sessionToken}`, JSON.stringify(sessionData), {
      expirationTtl: 7 * 24 * 60 * 60, // 7 days
    });
    
    return sessionToken;
  }

  async validateSession(sessionToken: string): Promise<string | null> {
    const sessionData = await this.env.TOKEN_STORE.get(`session:${sessionToken}`);
    if (!sessionData) return null;

    try {
      const session = JSON.parse(sessionData);
      if (session.expiresAt < Date.now()) {
        await this.env.TOKEN_STORE.delete(`session:${sessionToken}`);
        return null;
      }
      return session.userId;
    } catch {
      return null;
    }
  }

  async createOAuthState(): Promise<string> {
    const state = this.generateSecureToken();
    await this.env.CACHE.put(`oauth_state:${state}`, 'valid', {
      expirationTtl: 600, // 10 minutes
    });
    return state;
  }

  async validateOAuthState(state: string): Promise<boolean> {
    const stored = await this.env.CACHE.get(`oauth_state:${state}`);
    if (stored) {
      await this.env.CACHE.delete(`oauth_state:${state}`);
      return true;
    }
    return false;
  }

  private generateSecureToken(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  private generateApiKey(): string {
    const array = new Uint8Array(64); // Longer key for API keys
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async createUserSession(userId: string, oauthResult: any): Promise<string> {
    const apiKey = this.generateSecureToken(); // Use existing method
    const userData = {
      userId,
      apiKey,
      accessToken: oauthResult.access_token,
      refreshToken: oauthResult.refresh_token,
      expiresAt: Date.now() + (3600 * 1000), // 1 hour default
      userInfo: oauthResult.user_info
    };
    
    await this.env.TOKEN_STORE.put(`api:${apiKey}`, JSON.stringify(userData));
    return apiKey;
  }

  async getUserDataByApiKey(apiKey: string): Promise<any | null> {
    const data = await this.env.TOKEN_STORE.get(`api:${apiKey}`);
    return data ? JSON.parse(data) : null;
  }

  async ensureValidGoogleToken(userData: any): Promise<string> {
    if (userData.expiresAt > Date.now()) {
      return userData.accessToken;
    }
    // TODO: Implement token refresh
    return userData.accessToken;
  }

  async handleMCPRequest(request: Request, accessToken: string): Promise<Response> {
    try {
      const body = await request.json() as any;
      
      // Handle MCP JSON-RPC requests
      if (body.jsonrpc === '2.0') {
        const { method, params, id } = body;
        
        let result;
        
        switch (method) {
          case 'initialize':
            result = {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {
                  listChanged: false,
                },
                resources: {},
                prompts: {},
                logging: {
                  level: 'info',
                },
              },
              serverInfo: {
                name: 'gdrive-mcp-server-worker',
                version: '1.0.0',
              },
            };
            break;
            
          case 'tools/list':
            result = {
              tools: GDOCS_TOOLS,
            };
            break;
            
          case 'prompts/list':
            result = {
              prompts: [], // No prompts for this server
            };
            break;
            
          case 'resources/list':
            result = {
              resources: [], // No resources for this server
            };
            break;
            
          case 'tools/call':
            const googleAPI = new GoogleDocsAPI(accessToken);
            result = await this.callTool(googleAPI, params.name, params.arguments || {});
            break;
            
          case 'notifications/initialized':
            // Client has completed initialization - no response needed for notifications
            return new Response('', { 
              status: 204,
              headers: { 'Access-Control-Allow-Origin': '*' }
            });
            
          default:
            throw new Error(`Unknown method: ${method}`);
        }
        
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id,
          result,
        }), {
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      
      throw new Error('Invalid MCP request format');
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: `Internal error: ${message}`,
        },
      }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  }

  private async callTool(api: GoogleDocsAPI, name: string, args: any) {
    switch (name) {
      case 'list_documents':
        return await this.handleListDocuments(api, args);
      case 'get_document':
        return await this.handleGetDocument(api, args);
      case 'get_document_text':
        return await this.handleGetDocumentText(api, args);
      case 'create_document':
        return await this.handleCreateDocument(api, args);
      case 'update_document':
        return await this.handleUpdateDocument(api, args);
      case 'search_documents':
        return await this.handleSearchDocuments(api, args);
      case 'get_document_info':
        return await this.handleGetDocumentInfo(api, args);
      case 'get_document_tabs':
        return await this.handleGetDocumentTabs(api, args);
      case 'get_document_headings':
        return await this.handleGetDocumentHeadings(api, args);
      case 'get_tab_content':
        return await this.handleGetTabContent(api, args);
      case 'get_content_under_heading':
        return await this.handleGetContentUnderHeading(api, args);
      case 'insert_content_under_heading':
        return await this.handleInsertContentUnderHeading(api, args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // Tool handlers (same as MCP server - we can extract these to a shared module later)
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
    
    const request = { title: args.title, content: args.content };
    const document = await api.createDocument(request);
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
    
    const request = { documentId: args.documentId, requests: args.operations };
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
}

// Cloudflare Workers fetch handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const server = new WorkerMCPServer(env);
    
    try {
      if (url.pathname === '/auth') {
        // OAuth initiation
        const state = await server.createOAuthState();
        const googleAuth = new GoogleAuth(env);
        const authUrl = googleAuth.getAuthorizationUrl(state);
        
        return Response.redirect(authUrl);
      }
      
      if (url.pathname === '/callback') {
        // OAuth callback
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        
        if (!code || !state) {
          return new Response('Missing authorization code or state', { status: 400 });
        }
        
        if (!await server.validateOAuthState(state)) {
          return new Response('Invalid OAuth state', { status: 400 });
        }
        
        try {
          const googleAuth = new GoogleAuth(env);
          const userId = server.generateUserId();
          const result = await googleAuth.completeOAuthFlow(code, userId);
          const apiKey = await server.createUserSession(userId, result);

          return new Response(JSON.stringify({
            message: 'Authentication successful! Use this API key in your MCP client:',
            apiKey: apiKey,
            instructions: 'Add this to your MCP client configuration'
          }), {
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        } catch (error) {
          console.error('OAuth error:', error);
          const message = error instanceof Error ? error.message : 'Authentication failed';
          return new Response(JSON.stringify({ error: message }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      
      if (url.pathname === '/mcp') {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
          return new Response('Unauthorized', { status: 401 });
        }
        
        const apiKey = authHeader.slice(7);
        const userData = await server.getUserDataByApiKey(apiKey);
        
        if (!userData) {
          return new Response('Invalid API key', { status: 401 });
        }
        
        // Ensure valid Google access token (refresh if needed)
        const validToken = await server.ensureValidGoogleToken(userData);
        
        // Handle MCP protocol request
        return await server.handleMCPRequest(request, validToken);
      }
      
      if (url.pathname === '/status') {
        return new Response(JSON.stringify({
          status: 'healthy',
          server: 'gdrive-mcp-worker',
          version: '1.0.0',
          timestamp: new Date().toISOString(),
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Default response
      return new Response(JSON.stringify({
        service: 'Google Docs MCP Worker',
        version: '1.0.0',
        endpoints: {
          '/auth': 'Start OAuth flow',
          '/callback': 'OAuth callback',
          '/mcp': 'MCP endpoint (requires authentication)',
          '/status': 'Health check',
        },
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
      
    } catch (error) {
      console.error('Request handling error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
