import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { EmptyResultSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { DocumentContent } from '../types/index.js';
import { MAX_TEXT_LENGTH } from '../api/constants.js';
import { GoogleDocsAPI } from '../utils/google-api.js';
import { handleMCPRequest } from './mcpHttp.js';

function rpcRequest(body: unknown): Request {
  return new Request('https://mcp.test/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function toolRequest(name: string, args: Record<string, unknown> = {}): Request {
  return rpcRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  });
}

const document: DocumentContent = {
  documentId: 'test-document',
  title: 'Test document',
  revisionId: 'test-revision',
  body: { content: [] },
};

describe('HTTP tool dispatch regressions', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network access in test'));
  });

  afterEach(() => {
    const networkCalls = vi.mocked(globalThis.fetch).mock.calls.length;
    vi.restoreAllMocks();
    expect(networkCalls).toBe(0);
  });

  it.each(['missing_tool', 'constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'])(
    'rejects unregistered tool %s with MethodNotFound',
    async (name) => {
      const response = await handleMCPRequest(toolRequest(name), 'test-token');
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');
      const body = await response.json();
      expect(body).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        error: { code: ErrorCode.MethodNotFound, message: expect.stringContaining(`Unknown tool: ${name}`) },
      });
      expect(body).not.toHaveProperty('result');
    },
  );

  it('still validates arguments for registered tools', async () => {
    const response = await handleMCPRequest(toolRequest('get_document'), 'test-token');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ error: { code: ErrorCode.InvalidParams } });
  });

  it('still executes a registered tool with valid arguments', async () => {
    const getDocument = vi.spyOn(GoogleDocsAPI.prototype, 'getDocument').mockResolvedValue(document);
    const response = await handleMCPRequest(
      toolRequest('get_document', { documentId: document.documentId }),
      'test-token',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: 1,
      result: { content: [{ type: 'text', text: expect.stringContaining(document.title) }] },
    });
    expect(getDocument).toHaveBeenCalledWith(document.documentId);
  });

  it('reports oversized extraction as an error instead of a partial successful tool result', async () => {
    vi.spyOn(GoogleDocsAPI.prototype, 'getDocumentSafe').mockResolvedValue({
      useFallback: false,
      metadata: {
        id: document.documentId,
        name: document.title,
        mimeType: 'application/vnd.google-apps.document',
        createdTime: '',
        modifiedTime: '',
        webViewLink: '',
      },
      document: {
        ...document,
        body: {
          content: [
            { paragraph: { elements: [{ textRun: { content: 'prefix\n' } }] } },
            { paragraph: { elements: [{ textRun: { content: 'x'.repeat(MAX_TEXT_LENGTH) } }] } },
          ],
        },
      },
    });
    const response = await handleMCPRequest(
      toolRequest('get_document_text', { documentId: document.documentId }),
      'test-token',
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        code: ErrorCode.InternalError,
        message: expect.stringContaining('Document text too large to process'),
      },
    });
    expect(body).not.toHaveProperty('result');
  });
});

describe('MCP HTTP transport regressions', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network access in test'));
  });

  afterEach(() => {
    const networkCalls = vi.mocked(globalThis.fetch).mock.calls.length;
    vi.restoreAllMocks();
    expect(networkCalls).toBe(0);
  });

  it.each(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    'rejects unsupported HTTP %s before parsing or refreshing tokens',
    async (method) => {
      const request = new Request('https://mcp.test/mcp', { method });
      const parse = vi.spyOn(request, 'json');
      const token = vi.fn().mockRejectedValue(new Error('Token refresh must not run'));
      const response = await handleMCPRequest(request, token);
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('POST');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(await response.text()).toBe('');
      expect(parse).not.toHaveBeenCalled();
      expect(token).not.toHaveBeenCalled();
    },
  );

  it.each(['', '{', 'undefined'])('rejects invalid JSON %j with a parse error', async (body) => {
    const response = await handleMCPRequest(new Request('https://mcp.test/mcp', {
      method: 'POST', body,
    }), 'test-token');
    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0', id: null, error: { code: ErrorCode.ParseError },
    });
  });

  it.each([
    { label: 'null', body: null, id: null },
    { label: 'number', body: 42, id: null },
    { label: 'boolean', body: true, id: null },
    { label: 'string', body: 'ping', id: null },
    { label: 'empty batch', body: [], id: null },
    { label: 'batch', body: [{ jsonrpc: '2.0', id: 1, method: 'ping' }], id: null },
    { label: 'empty object', body: {}, id: null },
    { label: 'wrong version', body: { jsonrpc: '1.0', id: 0, method: 'ping' }, id: 0 },
    { label: 'missing method', body: { jsonrpc: '2.0', id: 'test' }, id: 'test' },
    { label: 'non-string method', body: { jsonrpc: '2.0', id: 1, method: 1 }, id: 1 },
    { label: 'null ID', body: { jsonrpc: '2.0', id: null, method: 'ping' }, id: null },
    { label: 'boolean ID', body: { jsonrpc: '2.0', id: false, method: 'ping' }, id: null },
    { label: 'object ID', body: { jsonrpc: '2.0', id: {}, method: 'ping' }, id: null },
    { label: 'fractional ID', body: { jsonrpc: '2.0', id: 1.5, method: 'ping' }, id: null },
    { label: 'null params', body: { jsonrpc: '2.0', id: 1, method: 'ping', params: null }, id: 1 },
    { label: 'array params', body: { jsonrpc: '2.0', id: 1, method: 'ping', params: [] }, id: 1 },
    { label: 'scalar params', body: { jsonrpc: '2.0', id: 1, method: 'ping', params: 1 }, id: 1 },
    { label: 'malformed notification', body: { jsonrpc: '2.0', method: 'notifications/initialized', params: null }, id: null },
    { label: 'ambiguous response', body: { jsonrpc: '2.0', id: 1, result: {}, error: { code: -32601, message: 'Unknown' } }, id: 1 },
  ])('rejects $label as Invalid Request without crashing', async ({ body, id }) => {
    const token = vi.fn().mockRejectedValue(new Error('Token refresh must not run'));
    const response = await handleMCPRequest(rpcRequest(body), token);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0', id, error: { code: ErrorCode.InvalidRequest },
    });
    expect(token).not.toHaveBeenCalled();
  });

  it.each([0, 1, -1, 'health', ''])('answers ping preserving request ID %j', async (id) => {
    const token = vi.fn().mockRejectedValue(new Error('Token refresh must not run'));
    const response = await handleMCPRequest(rpcRequest({ jsonrpc: '2.0', id, method: 'ping' }), token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id, result: {} });
    expect(token).not.toHaveBeenCalled();
  });

  it.each([
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
    { jsonrpc: '2.0', method: 'notifications/unknown' },
    { jsonrpc: '2.0', method: 'ping' },
    { jsonrpc: '2.0', method: 'tools/call', params: { name: 'create_document', arguments: { title: 'Must not be created' } } },
    { jsonrpc: '2.0', id: 1, result: {} },
    { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Unknown method' } },
  ])('acknowledges a notification or client response %j without dispatching tools', async (body) => {
    const token = vi.fn().mockRejectedValue(new Error('Token refresh must not run'));
    const response = await handleMCPRequest(rpcRequest(body), token);
    expect(response.status).toBe(202);
    expect(response.body).toBeNull();
    expect(await response.text()).toBe('');
    expect(response.headers.get('Content-Type')).toBeNull();
    expect(token).not.toHaveBeenCalled();
  });

  it('does not mistake a notification method with an ID for a notification', async () => {
    const response = await handleMCPRequest(rpcRequest({
      jsonrpc: '2.0', id: 0, method: 'notifications/initialized',
    }), 'test-token');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 0, error: { code: ErrorCode.MethodNotFound } });
  });

  it('resolves the Google token only for a validated tool call', async () => {
    const token = vi.fn().mockResolvedValue('refreshed-test-token');
    const getDocument = vi.spyOn(GoogleDocsAPI.prototype, 'getDocument').mockResolvedValue(document);
    const response = await handleMCPRequest(
      toolRequest('get_document', { documentId: document.documentId }), token,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty('result.content');
    expect(token).toHaveBeenCalledOnce();
    expect(getDocument).toHaveBeenCalledWith(document.documentId);
  });

  it('reports token-provider failures as JSON-RPC InternalError over HTTP 200', async () => {
    const token = vi.fn().mockRejectedValue(new Error('Synthetic token refresh failure'));
    const getDocument = vi.spyOn(GoogleDocsAPI.prototype, 'getDocument');
    const response = await handleMCPRequest(
      toolRequest('get_document', { documentId: document.documentId }), token,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: 1, error: { code: ErrorCode.InternalError, message: expect.stringContaining('Synthetic token refresh failure') },
    });
    expect(token).toHaveBeenCalledOnce();
    expect(getDocument).not.toHaveBeenCalled();
  });

  it('delivers protocol errors to the installed Streamable HTTP SDK, not transport errors', async () => {
    const token = vi.fn().mockRejectedValue(new Error('Synthetic token refresh failure'));
    const client = new Client({ name: 'http-regression-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('https://mcp.test/mcp'), {
      fetch: (input, init) => handleMCPRequest(new Request(input, init), token),
    });
    const errors: Error[] = [];
    client.onerror = (error) => errors.push(error);
    try {
      await client.connect(transport, { timeout: 1000 });
      expect((await client.listTools()).tools).toHaveLength(10);
      expect(await client.ping()).toEqual({});
      for (const name of ['missing_tool', 'constructor', '__proto__']) {
        await expect(client.callTool({ name, arguments: {} })).rejects.toMatchObject({
          code: ErrorCode.MethodNotFound,
        });
      }
      await expect(client.callTool({ name: 'get_document', arguments: {} })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
      });
      await expect(client.request({ method: 'missing/method' }, EmptyResultSchema)).rejects.toMatchObject({
        code: ErrorCode.MethodNotFound,
      });
      expect(token).not.toHaveBeenCalled();
      await expect(client.callTool({
        name: 'get_document', arguments: { documentId: document.documentId },
      })).rejects.toSatisfy((error: unknown) => error instanceof McpError && error.code === ErrorCode.InternalError);
      expect(token).toHaveBeenCalledOnce();
      // A failed tool call must not tear down the connection.
      expect(await client.ping()).toEqual({});
      expect(errors).toEqual([]);
    } finally {
      await client.close();
    }
  });
});
