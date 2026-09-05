#!/usr/bin/env node

// Load environment variables from .env next to the built script (not cwd)
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

const scriptDir = resolve(new URL(import.meta.url).pathname, '../..');
const envResult = loadEnv({ path: resolve(scriptDir, '.env'), quiet: true });
if (envResult.error && process.env.MCP_DEBUG) {
  console.error('[mcp] Failed to load .env file:', envResult.error.message);
}

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
import { HANDLERS } from './handlers/index.js';
import { SCHEMAS, SchemaName } from './handlers/schemas.js';

/** Debug-gated stderr logger. Enable with MCP_DEBUG=1. */
const debugEnabled = !!process.env.MCP_DEBUG;
const log = {
  debug: (...args: unknown[]) => {
    if (debugEnabled) console.error('[mcp]', ...args);
  },
  info: (...args: unknown[]) => console.error('[mcp]', ...args),
  error: (...args: unknown[]) => console.error('[mcp][error]', ...args),
};

/**
 * Pure MCP Server for Local Development (stdio transport).
 *
 * Boot, transport, auth, and request routing live here. Per-tool business
 * logic lives in `src/handlers/` and is dispatched through the HANDLERS
 * registry — see `src/handlers/index.ts`.
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
            listChanged: false,
          },
          resources: {},
          prompts: {},
          logging: {
            level: 'info',
          },
        },
      }
    );

    this.setupHandlers();
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;

    const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
    const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

    if (!serviceAccountPath && !serviceAccountKey) {
      throw new McpError(
        ErrorCode.InternalError,
        'No authentication configured. Set GOOGLE_SERVICE_ACCOUNT_PATH or GOOGLE_SERVICE_ACCOUNT_KEY.'
      );
    }

    try {
      // Try to get service account token with timeout
      const tokenPromise = this.getServiceAccountToken(serviceAccountPath, serviceAccountKey);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Authentication timeout after 10 seconds')), 10000)
      );

      this.accessToken = await Promise.race([tokenPromise, timeoutPromise]);
      if (this.accessToken) return this.accessToken;

      throw new McpError(
        ErrorCode.InternalError,
        'Failed to obtain access token from service account'
      );
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
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
      log.error('Service account authentication failed:', error);
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

    // Handle tool calls — dispatch through the HANDLERS registry.
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Input validation
      if (!name || typeof name !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'Tool name is required and must be a string');
      }

      if (!Object.hasOwn(HANDLERS, name)) {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
      const handler = HANDLERS[name];

      // Runtime-validate arguments against the tool's zod schema.
      const schema = SCHEMAS[name as SchemaName];
      const parseResult = schema.safeParse(args ?? {});
      if (!parseResult.success) {
        const detail = parseResult.error.issues
          .map((issue) => {
            const path = issue.path.length ? issue.path.join('.') : '(root)';
            return `${path}: ${issue.message}`;
          })
          .join('; ');
        throw new McpError(ErrorCode.InvalidParams, `Invalid arguments for ${name}: ${detail}`);
      }

      try {
        const accessToken = await this.getAccessToken();
        const googleAPI = new GoogleDocsAPI(accessToken);
        return await handler(googleAPI, parseResult.data);
      } catch (error) {
        // Surface McpError as-is so the client sees the correct error code.
        if (error instanceof McpError) throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${message}`);
      }
    });
  }

  async run(): Promise<void> {
    // Fail fast: validate auth before accepting any requests.
    try {
      await this.getAccessToken();
      log.debug('Auth check passed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Startup auth check failed:', message);
      throw error;
    }

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    const shutdown = async (signal: string) => {
      log.info(`Received ${signal}, shutting down`);
      try { await this.server.close(); } catch { /* ignore */ }
      process.exit(0);
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));

    log.info('MCP server running on stdio transport');
  }
}

// Auto-start if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new GoogleDocsMCPServer();
  server.run().catch((error) => {
    log.error('MCP server error:', error);
    process.exit(1);
  });
}
