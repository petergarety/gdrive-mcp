import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { Env, AuthContext } from './types/index.js';
import { GoogleAuth } from './auth/google.js';
import { GoogleDocsAPI } from './utils/google-api.js';
import { GDOCS_TOOLS } from './tools/index.js';

export interface CloudflareEnv extends Env {
  // Cloudflare Workers environment
}

// Transport and Logging utilities
enum TransportType {
  STDIO = 'stdio',
  HTTP = 'http',
  SSE = 'sse'
}

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

interface RequestLog {
  timestamp: string;
  requestId: string;
  userId?: string;
  toolName: string;
  args: any;
  duration?: number;
  status: 'success' | 'error';
  error?: string;
  warnings?: string[];
}

class MCPLogger {
  private static logLevel: LogLevel = LogLevel.INFO;
  private static logs: RequestLog[] = [];
  private static maxLogs = 1000;

  static setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  static generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  static startRequest(requestId: string, toolName: string, args: any, userId?: string): void {
    if (this.logLevel <= LogLevel.INFO) {
      console.log(`[MCP-${requestId}] Tool: ${toolName}, User: ${userId || 'unknown'}`);
      if (this.logLevel <= LogLevel.DEBUG) {
        console.log(`[MCP-${requestId}] Args:`, JSON.stringify(args, null, 2));
      }
    }
  }

  static endRequest(requestId: string, status: 'success' | 'error', duration: number, error?: string, warnings?: string[]): void {
    const level = status === 'error' ? LogLevel.ERROR : LogLevel.INFO;
    
    if (this.logLevel <= level) {
      const statusEmoji = status === 'success' ? '✅' : '❌';
      console.log(`[MCP-${requestId}] ${statusEmoji} ${status.toUpperCase()} (${duration}ms)`);
      
      if (error && this.logLevel <= LogLevel.ERROR) {
        console.error(`[MCP-${requestId}] Error:`, error);
      }
      
      if (warnings && warnings.length > 0 && this.logLevel <= LogLevel.WARN) {
        console.warn(`[MCP-${requestId}] Warnings:`, warnings);
      }
    }

    // Store log entry
    this.addLogEntry({
      timestamp: new Date().toISOString(),
      requestId,
      toolName: '',
      args: {},
      duration,
      status,
      error,
      warnings,
    });
  }

  private static addLogEntry(log: RequestLog): void {
    this.logs.push(log);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift(); // Remove oldest log
    }
  }

  static getLogs(limit = 100): RequestLog[] {
    return this.logs.slice(-limit);
  }

  static getLogStats(): { total: number; errors: number; averageDuration: number } {
    const total = this.logs.length;
    const errors = this.logs.filter(log => log.status === 'error').length;
    const averageDuration = this.logs.reduce((sum, log) => sum + (log.duration || 0), 0) / total;

    return { total, errors, averageDuration };
  }
}

class MCPTransportManager {
  static getTransportFromEnv(): { type: TransportType; port?: number; host?: string } {
    const transportType = (process.env.MCP_TRANSPORT as TransportType) || TransportType.STDIO;
    const port = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT) : 8080;
    const host = process.env.MCP_HOST || 'localhost';

    return { type: transportType, port, host };
  }

  static async createTransport(config: { type: TransportType; port?: number; host?: string }): Promise<any> {
    switch (config.type) {
      case TransportType.STDIO:
        return new StdioServerTransport();
      
      case TransportType.HTTP:
        throw new Error('HTTP transport not yet implemented. Use Cloudflare Workers deployment instead.');
      
      case TransportType.SSE:
        throw new Error('SSE transport not yet implemented. Use Cloudflare Workers deployment instead.');
      
      default:
        return new StdioServerTransport();
    }
  }
}

class GoogleDocsMCPServer {
  private server: Server;
  private googleAuth: GoogleAuth;
  private env: CloudflareEnv;

  constructor(env: CloudflareEnv) {
    this.env = env;
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
          resources: {},  // We don't support MCP resources
          prompts: {},    // We don't support MCP prompts
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

  /**
   * Simple session management using KV
   */
  private generateSecureToken(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

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

    await this.env.TOKEN_STORE.put(
      `session:${sessionToken}`,
      JSON.stringify(sessionData),
      { expirationTtl: 7 * 24 * 60 * 60 } // 7 days
    );

    return sessionToken;
  }

  async validateSession(sessionToken: string): Promise<string | null> {
    try {
      const stored = await this.env.TOKEN_STORE.get(`session:${sessionToken}`);
      if (!stored) return null;

      const sessionData = JSON.parse(stored);
      if (Date.now() > sessionData.expiresAt) {
        await this.env.TOKEN_STORE.delete(`session:${sessionToken}`);
        return null;
      }

      return sessionData.userId;
    } catch {
      return null;
    }
  }

  async createOAuthState(): Promise<string> {
    const state = this.generateSecureToken();
    await this.env.TOKEN_STORE.put(
      `oauth_state:${state}`,
      JSON.stringify({ createdAt: Date.now() }),
      { expirationTtl: 600 } // 10 minutes
    );
    return state;
  }

  async validateOAuthState(state: string): Promise<boolean> {
    const stored = await this.env.TOKEN_STORE.get(`oauth_state:${state}`);
    if (stored) {
      await this.env.TOKEN_STORE.delete(`oauth_state:${state}`);
      return true;
    }
    return false;
  }

  private setupHandlers(): void {
    // Set log level from environment
    const logLevel = (process.env.MCP_LOG_LEVEL as keyof typeof LogLevel) || 'INFO';
    MCPLogger.setLogLevel(LogLevel[logLevel] || LogLevel.INFO);

    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: GDOCS_TOOLS,
      };
    });

    // Handle tool calls with logging and validation
    this.server.setRequestHandler(CallToolRequestSchema, async (request, context) => {
      const requestId = MCPLogger.generateRequestId();
      const startTime = Date.now();
      const { name, arguments: args } = request.params;
      
      // Input validation
      if (!name || typeof name !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'Tool name is required and must be a string');
      }

      // Get auth context
      const authContext = context as any;
      const userId = authContext?.userId;
      
      // Start logging
      MCPLogger.startRequest(requestId, name, args, userId);
      
      if (!userId) {
        const error = 'Authentication required. Please authenticate with Google first via /auth endpoint.';
        MCPLogger.endRequest(requestId, 'error', Date.now() - startTime, error);
        throw new McpError(ErrorCode.InvalidRequest, error);
      }

      // Get valid access token for this user
      const accessToken = await this.googleAuth.getValidAccessToken(userId);
      if (!accessToken) {
        const error = 'Google authentication expired. Please re-authenticate via /auth endpoint.';
        MCPLogger.endRequest(requestId, 'error', Date.now() - startTime, error);
        throw new McpError(ErrorCode.InvalidRequest, error);
      }

      const googleAPI = new GoogleDocsAPI(accessToken);

      try {
        let result;
        let warnings: string[] = [];

        switch (name) {
          case 'list_documents':
            result = await this.handleListDocuments(googleAPI, args);
            break;
          
          case 'get_document':
            result = await this.handleGetDocument(googleAPI, args);
            break;
          
          case 'get_document_text':
            result = await this.handleGetDocumentText(googleAPI, args);
            warnings = result.warnings || [];
            break;
          
          case 'create_document':
            result = await this.handleCreateDocument(googleAPI, args);
            break;
          
          case 'update_document':
            result = await this.handleUpdateDocument(googleAPI, args);
            break;
          
          case 'search_documents':
            result = await this.handleSearchDocuments(googleAPI, args);
            break;
          
          case 'get_document_info':
            result = await this.handleGetDocumentInfo(googleAPI, args);
            break;
          
          case 'get_document_tabs':
            result = await this.handleGetDocumentTabs(googleAPI, args);
            break;

          case 'get_document_headings':
            result = await this.handleGetDocumentHeadings(googleAPI, args);
            warnings = result.warnings || [];
            break;

          case 'get_tab_content':
            result = await this.handleGetTabContent(googleAPI, args);
            break;
          
          case 'get_content_under_heading':
            result = await this.handleGetContentUnderHeading(googleAPI, args);
            break;

          case 'insert_content_under_heading':
            result = await this.handleInsertContentUnderHeading(googleAPI, args);
            break;
          
          default:
            const error = `Unknown tool: ${name}`;
            MCPLogger.endRequest(requestId, 'error', Date.now() - startTime, error);
            throw new McpError(ErrorCode.MethodNotFound, error);
        }

        // Success logging
        MCPLogger.endRequest(requestId, 'success', Date.now() - startTime, undefined, warnings);
        return result;

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        MCPLogger.endRequest(requestId, 'error', Date.now() - startTime, errorMessage);
        
        // Re-throw MCP errors as-is, wrap others
        if (error instanceof McpError) {
          throw error;
        } else {
          throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${errorMessage}`);
        }
      }
    });
  }

  private async handleListDocuments(api: GoogleDocsAPI, args: any) {
    const { pageSize = 10, pageToken } = args;
    const result = await api.listDocuments(pageSize, pageToken);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            documents: result.files,
            nextPageToken: result.nextPageToken,
            totalCount: result.files.length,
          }, null, 2),
        },
      ],
    };
  }

  private async handleGetDocument(api: GoogleDocsAPI, args: any) {
    const { documentId } = args;
    const document = await api.getDocument(documentId);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(document, null, 2),
        },
      ],
    };
  }

  private async handleGetDocumentText(api: GoogleDocsAPI, args: any) {
    const { documentId } = args;
    
    // Use safe document retrieval with enhanced API
    const result = await api.getDocumentSafe(documentId);
    
    if (result.useFallback) {
      // Use export for large documents
      const text = await api.exportLargeDocumentAsText(documentId);
      return {
        content: [
          {
            type: 'text',
            text: `Document: ${result.metadata.name}\n\n${text}`,
          },
        ],
        warnings: result.warnings,
      };
    }
    
    const text = api.extractTextFromDocument(result.document!);
    return {
      content: [
        {
          type: 'text',
          text: `Document: ${result.document!.title}\n\nContent:\n${text}`,
        },
      ],
      warnings: result.warnings,
    };
  }

  private async handleCreateDocument(api: GoogleDocsAPI, args: any) {
    const { title, content } = args;
    const document = await api.createDocument({ title, content });
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            documentId: document.documentId,
            title: document.title,
            webViewLink: `https://docs.google.com/document/d/${document.documentId}/edit`,
            message: 'Document created successfully',
          }, null, 2),
        },
      ],
    };
  }

  private async handleUpdateDocument(api: GoogleDocsAPI, args: any) {
    const { documentId, operations } = args;
    
    // Convert operations to Google Docs API format
    const requests = operations.map((op: any) => {
      switch (op.type) {
        case 'insert_text':
          return {
            insertText: {
              location: { index: op.index },
              text: op.text,
            },
          };
        case 'replace_text':
          return {
            replaceAllText: {
              containsText: {
                text: op.text,
                matchCase: false,
              },
              replaceText: op.replacementText || '',
            },
          };
        case 'delete_text':
          return {
            deleteContentRange: {
              range: {
                startIndex: op.index,
                endIndex: op.endIndex,
              },
            },
          };
        case 'insert_paragraph_break':
          return {
            insertText: {
              location: { index: op.index },
              text: '\n',
            },
          };
        default:
          throw new Error(`Unknown operation type: ${op.type}`);
      }
    });

    const result = await api.updateDocument({ documentId, requests });
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            documentId,
            operations: operations.length,
            message: 'Document updated successfully',
            result,
          }, null, 2),
        },
      ],
    };
  }

  private async handleSearchDocuments(api: GoogleDocsAPI, args: any) {
    const { query, pageSize = 10 } = args;
    const documents = await api.searchDocuments(query, pageSize);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query,
            results: documents,
            totalCount: documents.length,
          }, null, 2),
        },
      ],
    };
  }

  private async handleGetDocumentInfo(api: GoogleDocsAPI, args: any) {
    const { documentId } = args;
    const info = await api.getDocumentInfo(documentId);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(info, null, 2),
        },
      ],
    };
  }

  private async handleGetDocumentTabs(api: GoogleDocsAPI, args: any) {
    const { documentId } = args;
    const tabsInfo = await api.getDocumentTabs(documentId);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            documentId,
            totalTabs: tabsInfo.totalTabs,
            tabs: tabsInfo.tabs,
            message: `Found ${tabsInfo.totalTabs} tab(s) in document`,
          }, null, 2),
        },
      ],
    };
  }

  private async handleGetDocumentHeadings(api: GoogleDocsAPI, args: any) {
    const { documentId, includeText = true, maxDepth = 6 } = args;
    
    // Use safe document retrieval
    const result = await api.getDocumentSafe(documentId);
    
    if (result.useFallback) {
      return {
        content: [
          {
            type: 'text',
            text: 'Document too large for heading extraction. Please use smaller documents or contact support.',
          },
        ],
        warnings: result.warnings,
      };
    }
    
    const headings = api.extractHeadingsFromDocument(result.document!, {
      includeText,
      maxDepth,
    });
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            documentId,
            totalHeadings: headings.length,
            headings: headings.map(h => ({
              level: h.level,
              text: h.text,
              style: `H${h.level}`,
              index: h.index,
            })),
            structure: this.buildHeadingStructure(headings),
          }, null, 2),
        },
      ],
      warnings: result.warnings,
    };
  }

  private async handleGetTabContent(api: GoogleDocsAPI, args: any) {
    const { documentId, tabId, textOnly = true } = args;
    const tabContent = await api.getTabContent(documentId, tabId, textOnly);
    
    return {
      content: [
        {
          type: 'text',
          text: textOnly 
            ? `Tab: ${tabContent.tabInfo.title}\n\nContent:\n${tabContent.textContent}`
            : JSON.stringify(tabContent, null, 2),
        },
      ],
    };
  }

  private async handleGetContentUnderHeading(api: GoogleDocsAPI, args: any) {
    const { documentId, headingText, headingLevel, matchMode = 'contains' } = args;
    
    const result = await api.getContentUnderHeading(documentId, {
      headingText,
      headingLevel,
      matchMode,
    });
    
    if (!result.found) {
      return {
        content: [
          {
            type: 'text',
            text: `Heading "${headingText}" not found in document.`,
          },
        ],
      };
    }
    
    return {
      content: [
        {
          type: 'text',
          text: `Found content under "${result.heading!.text}" (H${result.heading!.level}):\n\n${result.content}`,
        },
      ],
    };
  }

  private async handleInsertContentUnderHeading(api: GoogleDocsAPI, args: any) {
    const { documentId, headingText, content, headingLevel, insertMode = 'append', addNewLine = true } = args;
    
    const result = await api.insertContentUnderHeading(documentId, {
      headingText,
      content,
      headingLevel,
      insertMode,
      addNewLine,
    });
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: result.success,
            operation: result.operation,
            heading: result.heading,
            insertionPoint: result.insertionIndex,
            message: `Successfully ${insertMode}ed content under heading`,
          }, null, 2),
        },
      ],
    };
  }

  /**
   * Build hierarchical heading structure
   */
  private buildHeadingStructure(headings: Array<{ level: number; text: string; index: number }>): any {
    const structure: any = { children: [] };
    const stack: any[] = [structure];
    
    for (const heading of headings) {
      const node = {
        level: heading.level,
        text: heading.text,
        index: heading.index,
        children: [],
      };
      
      // Find the right parent based on heading level
      while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) {
        stack.pop();
      }
      
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    }
    
    return structure.children;
  }

  async run(): Promise<void> {
    const transportConfig = MCPTransportManager.getTransportFromEnv();
    console.log(`Starting MCP server with ${transportConfig.type} transport`);
    
    const transport = await MCPTransportManager.createTransport(transportConfig);
    await this.server.connect(transport);
    
    console.log(`MCP server running on ${transportConfig.type} transport`);
    if (transportConfig.type !== TransportType.STDIO) {
      console.log(`Server accessible at ${transportConfig.host}:${transportConfig.port}`);
    }
  }
}

// Cloudflare Workers handler
export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);
    const server = new GoogleDocsMCPServer(env);
    
    try {
      if (url.pathname === '/auth') {
        // OAuth initiation with state parameter
        const state = await server.createOAuthState();
        const googleAuth = new GoogleAuth(env);
        const authUrl = googleAuth.getAuthorizationUrl(state);
        
        return Response.redirect(authUrl);
      }
      
      if (url.pathname === '/callback') {
        // OAuth callback with proper token storage
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        
        if (!code || !state) {
          return new Response('Missing authorization code or state', { status: 400 });
        }
        
        // Validate state parameter
        if (!await server.validateOAuthState(state)) {
          return new Response('Invalid OAuth state', { status: 400 });
        }
        
        try {
          const googleAuth = new GoogleAuth(env);
          const userId = server.generateUserId();
          const result = await googleAuth.completeOAuthFlow(code, userId);
          
          // Create session token
          const sessionToken = await server.createSession(userId);
          
          return new Response(JSON.stringify({
            message: 'Authentication successful',
            sessionToken,
            user: {
              id: result.user_info.id,
              email: result.user_info.email,
              name: result.user_info.name,
            },
          }), {
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
        // Simple MCP endpoint for testing
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
          return new Response('Unauthorized', { status: 401 });
        }
        
        const sessionToken = authHeader.slice(7);
        const userId = await server.validateSession(sessionToken);
        
        if (!userId) {
          return new Response('Invalid session', { status: 401 });
        }
        
        return new Response(JSON.stringify({
          message: 'MCP endpoint authenticated',
          userId,
          tools: GDOCS_TOOLS.map(tool => tool.name),
        }), {
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      if (url.pathname === '/status') {
        // Health check endpoint
        return new Response(JSON.stringify({
          status: 'ok',
          service: 'Google Docs MCP Server',
          version: '1.0.0',
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/logs') {
        // Logs endpoint (requires authentication)
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
          return new Response('Unauthorized', { status: 401 });
        }
        
        const sessionToken = authHeader.slice(7);
        const userId = await server.validateSession(sessionToken);
        
        if (!userId) {
          return new Response('Invalid session', { status: 401 });
        }
        
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const logs = MCPLogger.getLogs(limit);
        const stats = MCPLogger.getLogStats();
        
        return new Response(JSON.stringify({
          stats,
          logs,
          timestamp: new Date().toISOString(),
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Default response with helpful information
      return new Response(JSON.stringify({
        service: 'Google Docs MCP Server',
        version: '1.0.0',
        endpoints: {
          '/auth': 'Start OAuth flow',
          '/callback': 'OAuth callback',
          '/mcp': 'MCP endpoint (requires authentication)',
          '/status': 'Health check',
          '/logs': 'View request logs (requires authentication)',
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

// For local Node.js development with stdio (not Cloudflare Workers)
if (typeof process !== 'undefined' && 
    typeof process.stdin !== 'undefined' && 
    process.stdin && 
    typeof process.stdin.on === 'function' &&
    process.env.NODE_ENV !== 'production' &&
    !process.env.CF_PAGES && 
    !process.env.WORKER_ENV) {
  
  // For local development, you'll need to provide environment variables
  const localEnv: CloudflareEnv = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8787/callback',
    TOKEN_STORE: {
      // Mock KV namespace for local development
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    } as any,
  };
  
  if (!localEnv.GOOGLE_CLIENT_ID || !localEnv.GOOGLE_CLIENT_SECRET) {
    console.warn('Warning: Google OAuth credentials not provided for local development');
    console.warn('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables');
    console.warn('For MCP stdio transport, run: npm run dev:mcp');
  } else {
    console.log('Starting MCP server with stdio transport...');
    const server = new GoogleDocsMCPServer(localEnv);
    server.run().catch(console.error);
  }
}
