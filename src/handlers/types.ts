import { GoogleDocsAPI } from '../utils/google-api.js';

export interface ToolResponseContent {
  type: 'text';
  text: string;
}

/**
 * Response shape returned by every tool handler.
 *
 * The `[key: string]: unknown` index signature is required to satisfy the MCP
 * SDK's `ServerResult` type, which carries an optional `_meta` field.
 */
export interface ToolResponse {
  content: ToolResponseContent[];
  [key: string]: unknown;
}

/**
 * Signature shared by every tool handler. Receives a ready `GoogleDocsAPI`
 * client and the validated `args` object (already parsed through the tool's
 * zod schema by the dispatcher in `mcp-server.ts`).
 *
 * Generic parameter `TArgs` defaults to `unknown` so handlers without a
 * schema yet are still safe — but every handler should specify its derived
 * argument type, e.g. `ToolHandler<GetDocumentArgs>`.
 */
export type ToolHandler<TArgs = unknown> = (
  api: GoogleDocsAPI,
  args: TArgs
) => Promise<ToolResponse>;
