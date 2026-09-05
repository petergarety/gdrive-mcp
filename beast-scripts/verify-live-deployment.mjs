// Public production smoke checks. Never follows OAuth redirects or uses credentials.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const baseUrl = 'https://gdrive-mcp-server.pgp-personal.workers.dev';
const deploymentVersion = process.argv[2] || null;
const reportPath = fileURLToPath(new URL('../beast-output/deployment-check/live-report.json', import.meta.url));
const checks = [];

async function check(name, route, options, validate) {
  try {
    const response = await fetch(baseUrl + route, {
      ...options,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    const result = validate(response, text);
    checks.push({ name, route, httpStatus: response.status, ...result });
  } catch (error) {
    checks.push({ name, route, passed: false, error: error instanceof Error ? error.message : String(error) });
  }
}

await check('Modern front page', '/', {}, (response, html) => {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || null;
  const redesigned = html.includes('Your docs.<br><span>Meet your AI.</span>')
    && html.includes('class="connection-card"')
    && html.includes('--accent: #f1d54d;');
  const authLinkPreserved = /href="\/auth" class="auth-button"/.test(html);
  return {
    passed: response.status === 200 && (response.headers.get('content-type') || '').includes('text/html') && redesigned && authLinkPreserved,
    title,
    redesigned,
    authLinkPreserved,
  };
});

await check('Worker health', '/status', {}, (response, text) => {
  const body = JSON.parse(text);
  return {
    passed: response.status === 200 && body.status === 'healthy' && body.server === 'gdrive-mcp-worker',
    status: body.status,
    server: body.server,
    applicationVersion: body.version,
  };
});

await check('Google OAuth redirect', '/auth', {}, (response) => {
  const location = response.headers.get('location');
  const destination = location ? new URL(location) : null;
  const clientId = destination?.searchParams.get('client_id');
  const validClientId = Boolean(clientId && !['undefined', 'null'].includes(clientId));
  const statePresent = Boolean(destination?.searchParams.get('state'));
  const callbackMatches = destination?.searchParams.get('redirect_uri') === baseUrl + '/callback';
  return {
    passed: [302, 303, 307, 308].includes(response.status)
      && destination?.protocol === 'https:'
      && destination?.hostname === 'accounts.google.com'
      && destination?.searchParams.get('response_type') === 'code'
      && validClientId && statePresent && callbackMatches,
    destinationHost: destination?.hostname || null,
    validClientId,
    statePresent,
    callbackMatches,
  };
});

await check('Callback rejects missing OAuth parameters', '/callback', {}, (response, text) => ({
  passed: response.status === 400 && text.includes('Missing authorization code or state'),
}));

await check('MCP endpoint requires authentication', '/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
}, (response) => ({ passed: response.status === 401 }));

const passed = checks.every(item => item.passed === true);
const report = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  deploymentVersion,
  passed,
  passedCount: checks.filter(item => item.passed === true).length,
  totalCount: checks.length,
  scope: 'Public smoke checks only; no completed Google login, authenticated MCP session, or document access.',
  checks,
};
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
for (const item of checks) {
  console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}: HTTP ${item.httpStatus ?? 'unavailable'}`);
}
console.log(`Report: beast-output/deployment-check/live-report.json`);
console.log(`Result: ${report.passedCount}/${report.totalCount} passed`);
if (!passed) process.exitCode = 1;
