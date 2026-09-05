import { Env } from './types/index.js';
import { route } from './worker/routes.js';

/**
 * Cloudflare Workers entry point.
 *
 * Implementation is split across `src/worker/`:
 *   - crypto.ts        - secure random ID/token generation
 *   - session.ts       - sessions, OAuth state, API key lifecycle
 *   - tokenRefresh.ts  - Google access-token refresh with expiry buffer
 *   - mcpHttp.ts       - MCP-over-HTTP JSON-RPC handler
 *   - routes.ts        - HTTP route dispatch
 *
 * Tool handlers and zod schemas are shared with the local stdio server
 * (`mcp-server.ts`) via `src/handlers/` — single source of truth.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return route(request, env);
  },
};
