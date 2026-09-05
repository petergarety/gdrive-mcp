import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config as loadEnv } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { GoogleDocsAPI } from './utils/google-api.js';

const fixture = vi.hoisted(() => ({ envPath: '' }));

// Exercise real dotenv logging without reading the developer's .env or changing
// process.env. Only redirect the input path and environment destination.
vi.mock('dotenv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dotenv')>();
  return {
    ...actual,
    config: vi.fn((options: Parameters<typeof actual.config>[0]) =>
      actual.config({ ...options, path: fixture.envPath, processEnv: {} }),
    ),
  };
});

let fixtureDir: string;
let startupWrites: unknown[][];
let GoogleDocsMCPServer: typeof import('./mcp-server.js').GoogleDocsMCPServer;

beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'gdrive-mcp-regression-'));
  fixture.envPath = join(fixtureDir, 'example.env');
  writeFileSync(fixture.envPath, 'MCP_REGRESSION_FIXTURE=loaded\n');
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  try {
    ({ GoogleDocsMCPServer } = await import('./mcp-server.js'));
    startupWrites = [...stdout.mock.calls];
  } finally {
    stdout.mockRestore();
  }
});

afterAll(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

describe('stdio environment loading', () => {
  it('requests quiet dotenv loading and writes nothing to stdout', () => {
    expect(loadEnv).toHaveBeenCalledWith(expect.objectContaining({ quiet: true }));
    expect(vi.mocked(loadEnv).mock.results[0].value.parsed).toEqual({ MCP_REGRESSION_FIXTURE: 'loaded' });
    expect(startupWrites).toEqual([]);
  });
});

describe('stdio tool dispatch regressions', () => {
  let client: Client;
  let sdkServer: Server;
  let authenticate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network access in test'));
    const app = new GoogleDocsMCPServer();
    // Use the production request handlers over an in-memory SDK transport.
    // Stub only authentication; never read credentials or contact Google.
    const internals = app as unknown as { server: Server; getAccessToken(): Promise<string> };
    authenticate = vi.spyOn(internals, 'getAccessToken').mockResolvedValue('test-token');
    sdkServer = internals.server;
    client = new Client({ name: 'regression-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await sdkServer.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    try {
      await client?.close();
      await sdkServer?.close();
    } finally {
      const networkCalls = vi.mocked(globalThis.fetch).mock.calls.length;
      vi.restoreAllMocks();
      expect(networkCalls).toBe(0);
    }
  });

  it.each(['missing_tool', 'constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'])(
    'rejects unregistered tool %s before authentication',
    async (name) => {
      await expect(client.callTool({ name, arguments: {} })).rejects.toMatchObject({
        code: ErrorCode.MethodNotFound,
        message: expect.stringContaining(`Unknown tool: ${name}`),
      });
      expect(authenticate).not.toHaveBeenCalled();
    },
  );

  it('still validates arguments for registered tools before authentication', async () => {
    await expect(client.callTool({ name: 'get_document', arguments: {} })).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('returns the full tabbed document and revision through stdio', async () => {
    const tabbed = {
      documentId: 'test-document', title: 'Test document', revisionId: 'read-revision',
      tabs: [{
        tabProperties: { tabId: 'parent', title: 'Parent' },
        documentTab: { body: { content: [] } },
        childTabs: [{
          tabProperties: { tabId: 'child', title: 'Child' },
          documentTab: { body: { content: [{ startIndex: 1, endIndex: 7, paragraph: { elements: [{ textRun: { content: 'child\n' } }] } }] } },
        }],
      }],
    };
    vi.spyOn(GoogleDocsAPI.prototype, 'getDocument').mockResolvedValue(tabbed);
    const result = await client.callTool({ name: 'get_document', arguments: { documentId: tabbed.documentId } });
    expect(result).toMatchObject({ content: [{ type: 'text', text: JSON.stringify(tabbed, null, 2) }] });
  });

  it.each([
    [{ tabId: 'parent', title: 'Parent', index: 0, depth: 0 }, { tabId: 'child', title: 'Child', index: 0, depth: 1, parentTabId: 'parent' }],
    [{ tabId: null, title: 'Legacy', index: 0, depth: 0 }],
  ])('returns complete tab metadata through stdio: %j', async (...tabs) => {
    const listing = {
      documentId: 'test-document', revisionId: 'read-revision', totalTabs: tabs.length, tabs,
    };
    vi.spyOn(GoogleDocsAPI.prototype, 'getDocumentTabs').mockResolvedValue(listing);
    const result = await client.callTool({ name: 'get_document_tabs', arguments: { documentId: listing.documentId } });
    expect(result).toMatchObject({ content: [{ type: 'text', text: JSON.stringify(listing, null, 2) }] });
  });

  it('preserves tab and caller revision through stdio validation and dispatch', async () => {
    const update = vi.spyOn(GoogleDocsAPI.prototype, 'updateDocument').mockResolvedValue({ documentId: 'test-document', replies: [{}] });
    const operations = [{ type: 'insert_text', index: 1, text: 'hello' }];
    const result = await client.callTool({
      name: 'update_document',
      arguments: { documentId: 'test-document', tabId: 'child', requiredRevisionId: 'read-revision', operations },
    });
    expect(result).toMatchObject({ content: [{ type: 'text', text: expect.stringContaining('Document updated successfully') }] });
    expect(update).toHaveBeenCalledWith({
      documentId: 'test-document', tabId: 'child', requiredRevisionId: 'read-revision', requests: operations,
    });
    expect(authenticate).toHaveBeenCalledOnce();
  });

  it('still authenticates and executes registered tools with valid arguments', async () => {
    const getDocument = vi.spyOn(GoogleDocsAPI.prototype, 'getDocument').mockResolvedValue({
      documentId: 'test-document',
      title: 'Test document',
      revisionId: 'test-revision',
      body: { content: [] },
    });
    const result = await client.callTool({
      name: 'get_document',
      arguments: { documentId: 'test-document' },
    });
    expect(result).toMatchObject({
      content: [{ type: 'text', text: expect.stringContaining('Test document') }],
    });
    expect(authenticate).toHaveBeenCalledOnce();
    expect(getDocument).toHaveBeenCalledWith('test-document');
  });
});
