import { z } from 'zod';

/**
 * Runtime validation + TypeScript types for every tool's arguments.
 *
 * Schemas mirror the JSON Schemas declared in `src/tools/index.ts` and are
 * the single source of truth for handler argument shapes. To add a new tool:
 *   1. Add the JSON Schema in `tools/index.ts` (what the MCP client sees).
 *   2. Add the matching zod schema below.
 *   3. Register both in their respective indices.
 */

export const ListDocumentsSchema = z.object({
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
});

export const GetDocumentSchema = z.object({
  documentId: z.string().min(1, 'documentId is required'),
});

export const GetDocumentTextSchema = z.object({
  documentId: z.string().min(1, 'documentId is required'),
});

export const CreateDocumentSchema = z.object({
  title: z.string().min(1, 'title is required'),
  content: z.string().optional(),
});

export const UpdateDocumentSchema = z.object({
  documentId: z.string().min(1, 'documentId is required'),
  // Google Docs batchUpdate request payloads — opaque to us, validated by the API.
  operations: z.array(z.record(z.string(), z.unknown())).min(1, 'operations is required'),
});

export const SearchDocumentsSchema = z.object({
  query: z.string().min(1, 'query is required'),
  pageSize: z.number().int().min(1).max(100).optional(),
});

export const GetDocumentInfoSchema = z.object({
  documentId: z.string().min(1, 'documentId is required'),
});

export const GetDocumentTabsSchema = z.object({
  documentId: z.string().min(1, 'documentId is required'),
});

export const GetDocumentHeadingsSchema = z.object({
  documentId: z.string().min(1, 'documentId is required'),
  includeText: z.boolean().optional().default(true),
  maxDepth: z.number().int().min(1).max(6).optional().default(6),
});

export const GetContentUnderHeadingSchema = z.object({
  documentId: z.string().min(1, 'documentId is required'),
  headingText: z.string().min(1, 'headingText is required'),
  headingLevel: z.number().int().min(1).max(6).optional(),
  matchMode: z.enum(['exact', 'contains', 'starts_with']).optional().default('contains'),
});

// Derived TypeScript types — these are what handlers receive.
export type ListDocumentsArgs = z.infer<typeof ListDocumentsSchema>;
export type GetDocumentArgs = z.infer<typeof GetDocumentSchema>;
export type GetDocumentTextArgs = z.infer<typeof GetDocumentTextSchema>;
export type CreateDocumentArgs = z.infer<typeof CreateDocumentSchema>;
export type UpdateDocumentArgs = z.infer<typeof UpdateDocumentSchema>;
export type SearchDocumentsArgs = z.infer<typeof SearchDocumentsSchema>;
export type GetDocumentInfoArgs = z.infer<typeof GetDocumentInfoSchema>;
export type GetDocumentTabsArgs = z.infer<typeof GetDocumentTabsSchema>;
export type GetDocumentHeadingsArgs = z.infer<typeof GetDocumentHeadingsSchema>;
export type GetContentUnderHeadingArgs = z.infer<typeof GetContentUnderHeadingSchema>;

/**
 * Registry mapping MCP tool names to their argument schemas. Used by the
 * dispatcher in `mcp-server.ts` to validate raw `arguments` before calling
 * the handler. Keys must match the tool names in `GDOCS_TOOLS`.
 */
export const SCHEMAS = {
  list_documents: ListDocumentsSchema,
  get_document: GetDocumentSchema,
  get_document_text: GetDocumentTextSchema,
  create_document: CreateDocumentSchema,
  update_document: UpdateDocumentSchema,
  search_documents: SearchDocumentsSchema,
  get_document_info: GetDocumentInfoSchema,
  get_document_tabs: GetDocumentTabsSchema,
  get_document_headings: GetDocumentHeadingsSchema,
  get_content_under_heading: GetContentUnderHeadingSchema,
} as const;

export type SchemaName = keyof typeof SCHEMAS;
