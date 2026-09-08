import { afterEach, beforeEach, describe, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { handleMCPRequest } from './mcpHttp.js';
import { registerExportToolTests } from '../export.test-support.js';

describe('exports through the installed HTTP SDK', () => {
  let client: Client;
  let authenticate: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network access in export test'));
    authenticate = vi.fn().mockResolvedValue('test-token');
    client = new Client({ name: 'export-http-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('https://mcp.test/mcp'), {
      fetch: (input, init) => handleMCPRequest(new Request(input, init), authenticate),
    }));
  });
  afterEach(async () => {
    try { await client?.close(); } finally { vi.restoreAllMocks(); }
  });
  registerExportToolTests({
    call: args => client.callTool({ name: 'export_document', arguments: args }),
    list: async () => (await client.listTools()).tools,
    authenticated: () => authenticate,
  });
});
