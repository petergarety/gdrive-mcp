import { ErrorCode, JSONRPCMessageSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { GoogleDocsAPI } from '../utils/google-api.js';
import { GDOCS_TOOLS } from '../tools/index.js';
import { HANDLERS } from '../handlers/index.js';
import { SCHEMAS, SchemaName } from '../handlers/schemas.js';

/**
 * Stateless, JSON-response-only MCP-over-HTTP handler for Cloudflare Workers.
 *
 * Validate envelopes with the SDK, but dispatch directly through the Web
 * Request/Response API. This endpoint does not offer SSE or session storage.
 * Protocol errors for accepted requests use HTTP 200 so SDK clients can read
 * the JSON-RPC error; malformed messages use HTTP 400 instead.
 *
 * Tool dispatch goes through the shared HANDLERS + SCHEMAS registries —
 * behaviorally identical to the local stdio server in `mcp-server.ts`.
 */

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

type AccessTokenProvider = string | (() => Promise<string>);

function requestId(body: unknown): string | number | null {
  if (typeof body !== 'object' || body === null || !('id' in body)) {
    return null;
  }
  return typeof body.id === 'string' || (typeof body.id === 'number' && Number.isInteger(body.id))
    ? body.id
    : null;
}

function rpcResponse(id: string | number, result: unknown): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id, result }),
    { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
  );
}

function rpcError(id: string | number | null, code: number, message: string, status = 200): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }),
    { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
  );
}

export async function handleMCPRequest(request: Request, accessToken: AccessTokenProvider): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(null, {
      status: 405,
      headers: { Allow: 'POST', ...CORS_HEADERS },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, ErrorCode.ParseError, 'Parse error: invalid JSON', 400);
  }

  const parsed = JSONRPCMessageSchema.safeParse(body);
  if (!parsed.success) {
    return rpcError(
      requestId(body),
      ErrorCode.InvalidRequest,
      'Invalid Request: expected a single MCP JSON-RPC 2.0 message',
      400,
    );
  }

  const message = parsed.data;
  if (!('method' in message) || !('id' in message)) {
    // Accept notifications and client responses without a JSON-RPC reply.
    // No server-initiated requests or notification handlers exist here; in
    // particular, a tools/call notification must not run a document operation.
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  const { method, params, id } = message;

  try {
    switch (method) {
      case 'initialize':
        return rpcResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
            resources: {},
            prompts: {},
            logging: { level: 'info' },
          },
          serverInfo: { name: 'gdrive-mcp-server-worker', version: '1.0.0' },
        });

      case 'ping':
        return rpcResponse(id, {});

      case 'tools/list':
        return rpcResponse(id, { tools: GDOCS_TOOLS });

      case 'prompts/list':
        return rpcResponse(id, { prompts: [] });

      case 'resources/list':
        return rpcResponse(id, { resources: [] });

      case 'tools/call': {
        const result = await callTool(accessToken, params?.name, params?.arguments ?? {});
        return rpcResponse(id, result);
      }

      default:
        return rpcError(id, ErrorCode.MethodNotFound, `Method not found: ${method}`);
    }
  } catch (error) {
    if (error instanceof McpError) {
      return rpcError(id, error.code, error.message);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return rpcError(id, ErrorCode.InternalError, `Internal error: ${message}`);
  }
}

/**
 * Dispatch through the shared HANDLERS registry. Argument validation happens
 * via the matching zod schema in SCHEMAS — keeps the worker and the local
 * MCP server behaviorally identical.
 */
async function callTool(accessToken: AccessTokenProvider, name: unknown, args: unknown) {
  if (typeof name !== 'string' || !name) {
    throw new McpError(ErrorCode.InvalidParams, 'Tool name is required and must be a string');
  }

  if (!Object.hasOwn(HANDLERS, name)) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
  const handler = HANDLERS[name];

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

  // Protocol-only traffic and invalid calls do not need a Google token refresh.
  const token = typeof accessToken === 'function' ? await accessToken() : accessToken;
  const api = new GoogleDocsAPI(token);
  return await handler(api, parseResult.data);
}
