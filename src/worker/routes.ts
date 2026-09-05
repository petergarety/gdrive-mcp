import { Env } from '../types/index.js';
import { GoogleAuth } from '../auth/google.js';
import { getWelcomePage, getSuccessPage } from '../utils/html-templates.js';
import { generateUserId } from './crypto.js';
import {
  createOAuthState,
  validateOAuthState,
  createUserSession,
  getUserDataByApiKey,
} from './session.js';
import { ensureValidGoogleToken } from './tokenRefresh.js';
import { handleMCPRequest } from './mcpHttp.js';

/**
 * HTTP route dispatch for the Cloudflare Worker entry point. Each route is a
 * small async function; the default `fetch` export composes them.
 *
 * Routes:
 *   GET  /         - welcome page
 *   GET  /status   - liveness probe
 *   GET  /auth     - initiate Google OAuth (redirect)
 *   GET  /callback - OAuth callback, issues API key
 *   POST /mcp      - MCP-over-HTTP JSON-RPC endpoint (Bearer auth)
 */

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleAuth(env: Env): Promise<Response> {
  const state = await createOAuthState(env);
  const googleAuth = new GoogleAuth(env);
  return Response.redirect(googleAuth.getAuthorizationUrl(state));
}

async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return new Response('Missing authorization code or state', { status: 400 });
  }
  if (!(await validateOAuthState(env, state))) {
    return new Response('Invalid OAuth state', { status: 400 });
  }

  try {
    const googleAuth = new GoogleAuth(env);
    const userId = generateUserId();
    const result = await googleAuth.completeOAuthFlow(code, userId);
    const apiKey = await createUserSession(env, userId, result);

    const workerUrl = url.origin;
    return new Response(getSuccessPage(apiKey, workerUrl), {
      headers: {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('[worker] OAuth error:', error);
    const message = error instanceof Error ? error.message : 'Authentication failed';
    return jsonError(message, 500);
  }
}

async function handleMCP(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const apiKey = authHeader.slice(7);
  const userData = await getUserDataByApiKey(env, apiKey);
  if (!userData) {
    return new Response('Invalid API key', { status: 401 });
  }

  // Keep API-key authentication mandatory, but defer Google token refresh
  // until a validated tool call actually needs to access a document.
  return await handleMCPRequest(request, () => ensureValidGoogleToken(env, userData));
}

function handleStatus(): Response {
  return new Response(
    JSON.stringify({
      status: 'healthy',
      server: 'gdrive-mcp-worker',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

function handleRoot(): Response {
  return new Response(getWelcomePage(), {
    headers: { 'Content-Type': 'text/html' },
  });
}

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  try {
    switch (url.pathname) {
      case '/auth':
        return await handleAuth(env);
      case '/callback':
        return await handleCallback(request, env);
      case '/mcp':
        return await handleMCP(request, env);
      case '/status':
        return handleStatus();
      default:
        return handleRoot();
    }
  } catch (error) {
    console.error('[worker] Request handling error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
