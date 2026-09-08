import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { handleMCPRequest } from './mcpHttp.js';
import { registerFormattingToolTests } from '../formatting.test-support.js';

describe('rich formatting through the installed HTTP SDK', () => {
  let client: Client;
  let authenticate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network access in test'));
    authenticate = vi.fn().mockResolvedValue('test-token');
    client = new Client({ name: 'formatting-http-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('https://mcp.test/mcp'), {
      fetch: (input, init) => handleMCPRequest(new Request(input, init), authenticate),
    });
    await client.connect(transport);
  });

  afterEach(async () => {
    try {
      await client?.close();
    } finally {
      const calls = vi.mocked(globalThis.fetch).mock.calls.length;
      vi.restoreAllMocks();
      expect(calls).toBe(0);
    }
  });

  registerFormattingToolTests({
    call: args => client.callTool({ name: 'update_document', arguments: args }),
    list: async () => (await client.listTools()).tools,
    authenticated: () => authenticate,
  });
});
