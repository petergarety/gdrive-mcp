// Local deployment gate: compiles, bundles with --dry-run, and exercises workerd using
// synthetic KV data. Never deploys, loads project credentials, or calls Google.
// Run: node beast-scripts/check-deployment.mjs
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Miniflare } from 'miniflare';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { EmptyResultSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'beast-output/deployment-check');
const logs = join(root, 'beast-runs/deployment-check');
for (const directory of [output, logs, join(output, 'isolated-home')]) {
  mkdirSync(directory, { recursive: true });
}
const sourceConfig = readFileSync(join(root, 'wrangler.toml'), 'utf8');
const compatibilityDate = sourceConfig.match(/^compatibility_date\s*=\s*"([^"]+)"/m)?.[1];
const flagsLiteral = sourceConfig.match(/^compatibility_flags\s*=\s*(\[[^\n]*\])/m)?.[1];
assert(compatibilityDate && flagsLiteral, 'Cannot read runtime settings from wrangler.toml');
const compatibilityFlags = JSON.parse(flagsLiteral);
const bindings = {
  GOOGLE_CLIENT_ID: 'local-test-client',
  GOOGLE_CLIENT_SECRET: 'local-test-secret-not-a-real-credential',
  GOOGLE_REDIRECT_URI: 'https://local.test/callback',
  MCP_LOG_LEVEL: 'ERROR',
  NODE_ENV: 'test',
};
const configPath = join(output, 'wrangler.local-check.json');
writeFileSync(configPath, JSON.stringify({
  name: 'gdrive-mcp-local-deployment-check',
  main: './dist/worker-server.js',
  compatibility_date: compatibilityDate,
  compatibility_flags: compatibilityFlags,
  send_metrics: false,
  vars: bindings,
  kv_namespaces: ['TOKEN_STORE', 'CACHE'].map((binding) => ({ binding, id: '0'.repeat(32) })),
}, null, 2) + '\n');

// Only a minimal environment is forwarded; real Cloudflare/Google credentials
// and the user's Wrangler home directory are deliberately not used.
const env = {
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  HOME: join(output, 'isolated-home'),
  XDG_CONFIG_HOME: join(output, 'isolated-home'),
  TMPDIR: process.env.TMPDIR ?? '/tmp',
  CI: 'true',
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_LOG_PATH: join(logs, 'wrangler.log'),
  NO_COLOR: '1',
};
const compileResult = spawnSync(process.execPath, [
  join(root, 'node_modules/typescript/bin/tsc'),
  '--outDir', join(output, 'dist'), '--noEmitOnError',
], { cwd: root, env, encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
writeFileSync(join(logs, 'compile.log'), (compileResult.stdout ?? '') + (compileResult.stderr ?? ''));
// Never validate an old bundle when the current sources do not compile.
const bundleResult = compileResult.status === 0 ? spawnSync(process.execPath, [
  join(root, 'node_modules/wrangler/bin/wrangler.js'),
  'deploy', '--dry-run', '--config', configPath,
  '--outdir', join(output, 'bundle'),
], { cwd: output, env, encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 })
  : { status: null, signal: null, error: new Error('Skipped: TypeScript compilation failed') };
writeFileSync(join(logs, 'bundle.log'), (bundleResult.stdout ?? '') + (bundleResult.stderr ?? ''));
const checks = [];
checks.push({ name: 'TypeScript compilation', passed: compileResult.status === 0,
  detail: compileResult.error?.message ?? `exit=${compileResult.status}; signal=${compileResult.signal}` });
checks.push({ name: 'Wrangler dry-run bundle', passed: bundleResult.status === 0,
  detail: bundleResult.error?.message ?? `exit=${bundleResult.status}; signal=${bundleResult.signal}` });
let outboundCalls = 0;
let mf;
async function check(name, action) {
  try {
    const detail = await action();
    checks.push({ name, passed: true, detail: detail ?? 'OK' });
  } catch (error) {
    checks.push({ name, passed: false, detail: String(error?.message ?? error) });
  }
}
const bearer = {
  Authorization: 'Bearer local-check-key',
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};
async function request(path, options) {
  const response = await mf.dispatchFetch(`https://local.test${path}`, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, headers: response.headers, body, text };
}
async function rpc(method, id = 1, params, headers = bearer) {
  return request('/mcp', { method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', method, id, ...(params === undefined ? {} : { params }) }) });
}
try {
  if (bundleResult.status === 0) {
    mf = new Miniflare({
      modules: true,
      scriptPath: join(output, 'bundle/worker-server.js'),
      compatibilityDate,
      compatibilityFlags,
      bindings,
      kvNamespaces: ['TOKEN_STORE', 'CACHE'],
      kvPersist: false,
      outboundService: () => {
        outboundCalls++;
        return new Response('External network disabled by deployment check', { status: 503 });
      },
    });
    const store = await mf.getKVNamespace('TOKEN_STORE');
    await store.put('api:local-check-key', JSON.stringify({
      userId: 'local-test-user', apiKey: 'local-check-key',
      accessToken: 'local-google-token-not-real', expiresAt: Date.now() + 3600000,
    }));
    await store.put('api:expired-check-key', JSON.stringify({
      userId: 'expired-test-user', apiKey: 'expired-check-key',
      accessToken: 'expired-google-token-not-real', expiresAt: Date.now() - 3600000,
    }));
    const expiredBearer = { ...bearer, Authorization: 'Bearer expired-check-key' };
    await check('Worker health endpoint', async () => {
      const r = await request('/status');
      assert.equal(r.status, 200); assert.equal(r.body.status, 'healthy');
    });
    await check('Missing bearer token rejected', async () => {
      assert.equal((await request('/mcp', { method: 'POST', body: '{}' })).status, 401);
    });
    await check('Unauthenticated GET and notifications still rejected', async () => {
      assert.equal((await request('/mcp', { method: 'GET' })).status, 401);
      assert.equal((await request('/mcp', { method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })).status, 401);
    });
    await check('Unknown API key rejected', async () => {
      assert.equal((await request('/mcp', { method: 'POST',
        headers: { ...bearer, Authorization: 'Bearer invalid-test-key' }, body: '{}' })).status, 401);
    });
    await check('Accepted notification receives HTTP 202 with no body', async () => {
      const r = await request('/mcp', { method: 'POST', headers: bearer,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
      assert.equal(r.status, 202, `Expected HTTP 202; received ${r.status}: ${r.text}`);
      assert.equal(r.text, '');
    });
    await check('Unsupported MCP GET returns HTTP 405', async () => {
      const r = await request('/mcp', { method: 'GET', headers: bearer });
      assert.equal(r.status, 405, `Expected HTTP 405; received ${r.status}: ${r.text}`);
      assert.equal(r.headers.get('Allow'), 'POST');
      assert.equal(r.text, '');
    });
    await check('Null JSON envelope returns JSON-RPC Invalid Request', async () => {
      const r = await request('/mcp', { method: 'POST', headers: bearer, body: 'null' });
      assert.equal(r.status, 400);
      assert.equal(r.body?.error?.code, -32600, `Expected error code -32600; received ${r.status}: ${r.text}`);
      assert.equal(r.body.id, null);
    });
    await check('Malformed JSON returns HTTP 400 / ParseError', async () => {
      const r = await request('/mcp', { method: 'POST', headers: bearer, body: '{' });
      assert.equal(r.status, 400);
      assert.equal(r.body?.error?.code, ErrorCode.ParseError);
      assert.equal(r.body.id, null);
    });
    await check('Primitive, batch, and invalid envelopes are rejected without crashing', async () => {
      for (const body of [true, 1, 'ping', [], {}, { jsonrpc: '2.0', id: null, method: 'ping' },
        { jsonrpc: '2.0', id: 1, method: 'ping', params: [] }]) {
        const r = await request('/mcp', { method: 'POST', headers: bearer, body: JSON.stringify(body) });
        assert.equal(r.status, 400, r.text);
        assert.equal(r.body?.error?.code, ErrorCode.InvalidRequest);
      }
    });
    await check('MCP ping returns a successful response', async () => {
      const r = await rpc('ping');
      assert.equal(r.status, 200, `Expected HTTP 200; received ${r.status}: ${r.text}`);
      assert.deepEqual(r.body.result, {});
    });
    await check('Expired Google credentials do not break protocol-only requests', async () => {
      const get = await request('/mcp', { method: 'GET', headers: expiredBearer });
      assert.equal(get.status, 405);
      assert.equal(get.headers.get('Allow'), 'POST');
      for (const method of ['ping', 'tools/list', 'prompts/list', 'resources/list']) {
        const r = await rpc(method, 0, undefined, expiredBearer);
        assert.equal(r.status, 200, r.text);
        assert.equal(r.body.id, 0);
        assert('result' in r.body);
      }
      const initialized = await request('/mcp', { method: 'POST', headers: expiredBearer,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
      assert.equal(initialized.status, 202);
      assert.equal(initialized.text, '');
    });
    await check('Invalid tool calls preserve protocol errors before token refresh', async () => {
      for (const [params, code] of [
        [{ name: 'constructor', arguments: {} }, ErrorCode.MethodNotFound],
        [{ name: 'get_document', arguments: {} }, ErrorCode.InvalidParams],
      ]) {
        const r = await rpc('tools/call', 'invalid-tool', params, expiredBearer);
        assert.equal(r.status, 200, r.text);
        assert.equal(r.body.id, 'invalid-tool');
        assert.equal(r.body.error.code, code);
      }
    });
    await check('Token refresh failures become JSON-RPC errors, not transport failures', async () => {
      const r = await rpc('tools/call', 1,
        { name: 'get_document', arguments: { documentId: 'local-document-not-real' } }, expiredBearer);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.body.error.code, ErrorCode.InternalError);
      assert.match(r.body.error.message, /re-authenticate/);
      assert(!('result' in r.body));
    });
    await check('Notifications and client responses have no body or document side effects', async () => {
      for (const body of [
        { jsonrpc: '2.0', method: 'notifications/unknown' },
        { jsonrpc: '2.0', method: 'tools/call', params: { name: 'create_document', arguments: { title: 'Must not exist' } } },
        { jsonrpc: '2.0', id: 1, result: {} },
      ]) {
        const r = await request('/mcp', { method: 'POST', headers: bearer, body: JSON.stringify(body) });
        assert.equal(r.status, 202, r.text);
        assert.equal(r.text, '');
        assert.equal(r.headers.get('Content-Type'), null);
      }
    });
    const client = new Client({ name: 'local-deployment-check', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('https://local.test/mcp'), {
      requestInit: { headers: { Authorization: 'Bearer local-check-key' } },
      fetch: (input, init) => mf.dispatchFetch(String(input), init),
    });
    const sdkErrors = [];
    client.onerror = (error) => sdkErrors.push(String(error.message));
    try {
      await check('Installed MCP SDK connects and lists tools over HTTP', async () => {
        await client.connect(transport, { timeout: 5000 });
        const tools = await client.listTools();
        assert.equal(tools.tools.length, 10);
        return `${tools.tools.length} tools listed`;
      });
      await check('SDK receives MethodNotFound for inherited tool key', async () => {
        await assert.rejects(() => client.callTool({ name: 'constructor', arguments: {} }),
          (error) => error instanceof McpError && error.code === ErrorCode.MethodNotFound,
          'Expected JSON-RPC MethodNotFound (-32601), not an HTTP transport error');
      });
      await check('SDK receives MethodNotFound for an unknown tool and method', async () => {
        await assert.rejects(() => client.callTool({ name: 'missing_tool', arguments: {} }),
          (error) => error instanceof McpError && error.code === ErrorCode.MethodNotFound);
        await assert.rejects(() => client.request({ method: 'missing/method' }, EmptyResultSchema),
          (error) => error instanceof McpError && error.code === ErrorCode.MethodNotFound);
      });
      await check('SDK receives InvalidParams for malformed tool arguments', async () => {
        await assert.rejects(() => client.callTool({ name: 'get_document', arguments: {} }),
          (error) => error instanceof McpError && error.code === ErrorCode.InvalidParams);
      });
      await check('SDK ping still works after protocol errors', async () => {
        assert.deepEqual(await client.ping(), {});
      });
      await check('No SDK transport errors', async () => {
        assert.deepEqual(sdkErrors, []);
      });
    } finally {
      await client.close();
      writeFileSync(join(logs, 'sdk-errors.json'), JSON.stringify(sdkErrors, null, 2) + '\n');
    }
  }
} catch (error) {
  checks.push({ name: 'Local runtime harness', passed: false, detail: String(error?.stack ?? error) });
} finally {
  await mf?.dispose();
  checks.push({ name: 'No external Worker requests', passed: outboundCalls === 0, detail: `${outboundCalls} attempted` });
  const report = {
    createdAt: new Date().toISOString(),
    scope: 'Local build/bundle and synthetic workerd checks only. No deployment or live credentials.',
    compatibilityDate, compatibilityFlags, checks,
    unverified: ['Live OAuth and refresh', 'Real KV bindings and secrets', 'Google Docs read/write/export', 'Production client connection'],
    references: [
      'https://developers.cloudflare.com/workers/wrangler/bundling/',
      'https://modelcontextprotocol.io/specification/2025-06-18/basic/transports',
      'https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/ping',
    ],
  };
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`);
  console.log('Report: beast-output/deployment-check/report.json');
  process.exitCode = checks.some((c) => !c.passed) ? 1 : 0;
}
