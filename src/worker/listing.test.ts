import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { handleMCPRequest } from './mcpHttp.js';
import { registerListingToolTests } from '../listing.test-support.js';

describe('list/search/info JSON responses through the installed HTTP SDK', () => {
  let client: Client;
  let authenticate: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network access in listing test'));
    authenticate = vi.fn().mockResolvedValue('test-token');
    client = new Client({ name: 'listing-http-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('https://mcp.test/mcp'), {
      fetch: (input, init) => handleMCPRequest(new Request(input, init), authenticate),
    }));
  });
  afterEach(async () => {
    try { await client?.close(); } finally {
      const networkCalls = vi.mocked(globalThis.fetch).mock.calls.length;
      vi.restoreAllMocks();
      expect(networkCalls).toBe(0);
    }
  });
  registerListingToolTests({
    call: (name, args) => client.callTool({ name, arguments: args }),
    list: async () => (await client.listTools()).tools,
    authenticated: () => authenticate,
  });
});
