import { GoogleDocumentInfo, DocumentContent, DocCreateRequest, DocUpdateRequest } from '../types/index.js';
import { ApiClient } from './client.js';
import {
  DOCUMENT_ID_PATTERN,
  MAX_DOCUMENT_SIZE,
  READ_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
} from './constants.js';

function assertValidDocumentId(documentId: string): void {
  if (!documentId || !DOCUMENT_ID_PATTERN.test(documentId)) {
    throw new Error('Invalid document ID format');
  }
}

/**
 * Drive API: list user's Google Docs.
 */
export async function listDocuments(
  client: ApiClient,
  pageSize: number = 10,
  pageToken?: string,
): Promise<{ files: GoogleDocumentInfo[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.document'",
    pageSize: pageSize.toString(),
    fields:
      'files(id,name,mimeType,createdTime,modifiedTime,webViewLink,size,parents),nextPageToken',
  });
  if (pageToken) params.append('pageToken', pageToken);

  const url = `https://www.googleapis.com/drive/v3/files?${params}`;
  const response = await client.request<{
    files?: GoogleDocumentInfo[];
    nextPageToken?: string;
  }>(url);

  return {
    files: response.files ?? [],
    nextPageToken: response.nextPageToken,
  };
}

/**
 * Drive API: metadata for a single doc.
 */
export async function getDocumentInfo(
  client: ApiClient,
  documentId: string,
): Promise<GoogleDocumentInfo> {
  const url = `https://www.googleapis.com/drive/v3/files/${documentId}?fields=id,name,mimeType,createdTime,modifiedTime,webViewLink,size,parents`;
  return client.request<GoogleDocumentInfo>(url);
}

/**
 * Check document size via metadata before fetching full content.
 * Returns size in bytes (0 if metadata unavailable).
 */
export async function checkDocumentSize(
  client: ApiClient,
  documentId: string,
): Promise<number> {
  try {
    const info = await getDocumentInfo(client, documentId);
    const size = info.size ? parseInt(info.size) : 0;
    if (size > MAX_DOCUMENT_SIZE) {
      throw new Error(
        `Document too large: ${Math.round(size / 1024 / 1024)}MB (max: ${MAX_DOCUMENT_SIZE / 1024 / 1024}MB)`,
      );
    }
    return size;
  } catch (error) {
    if (process.env.MCP_DEBUG) {
      console.error('[mcp][documents] could not check document size:', error);
    }
    return 0;
  }
}

/**
 * Docs API: get document content. Validates ID and pre-checks size.
 */
export async function getDocument(
  client: ApiClient,
  documentId: string,
): Promise<DocumentContent> {
  assertValidDocumentId(documentId);
  await checkDocumentSize(client, documentId);
  const url = `https://docs.googleapis.com/v1/documents/${documentId}`;
  return client.request<DocumentContent>(url, {}, READ_TIMEOUT_MS);
}

/**
 * Docs API: create a new document, optionally seeding it with content.
 */
export async function createDocument(
  client: ApiClient,
  request: DocCreateRequest,
): Promise<DocumentContent> {
  const document = await client.request<DocumentContent & { documentId: string }>(
    'https://docs.googleapis.com/v1/documents',
    {
      method: 'POST',
      body: JSON.stringify({ title: request.title }),
    },
  );

  if (request.content) {
    await updateDocument(client, {
      documentId: document.documentId,
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: request.content,
          },
        },
      ],
    } as DocUpdateRequest);
    return getDocument(client, document.documentId);
  }

  return document;
}

/**
 * Response shape for `documents.batchUpdate`.
 * `replies` mirrors the input `requests` array order; some entries can be `{}`.
 */
export interface BatchUpdateResponse {
  documentId: string;
  replies: Array<Record<string, unknown>>;
  writeControl?: Record<string, unknown>;
}

/**
 * Docs API: batchUpdate. Translates MCP-style operations into Google's
 * native request shapes, then submits with a write-friendly timeout.
 */
export async function updateDocument(
  client: ApiClient,
  request: DocUpdateRequest,
): Promise<BatchUpdateResponse> {
  const url = `https://docs.googleapis.com/v1/documents/${request.documentId}:batchUpdate`;

  const transformedRequests = request.requests.map((operation: any) => {
    // Already in Google Docs API format.
    if (operation.insertText || operation.deleteContentRange || operation.replaceAllText) {
      return operation;
    }

    const operationType = operation.type;
    if (!operationType) {
      console.error('Operation missing type:', operation);
      throw new Error(`Operation missing type field. Received: ${JSON.stringify(operation)}`);
    }

    switch (operationType) {
      case 'insert_text':
        return {
          insertText: {
            location: { index: operation.index },
            text: operation.text,
          },
        };
      case 'delete_text':
        return {
          deleteContentRange: {
            range: {
              startIndex: operation.index,
              endIndex: operation.endIndex ?? operation.index + 1,
            },
          },
        };
      case 'replace_text':
        return {
          replaceAllText: {
            replaceText: operation.text,
            containsText: {
              text: operation.oldText ?? '',
              matchCase: true,
            },
          },
        };
      case 'insert_paragraph_break':
        return {
          insertText: {
            location: { index: operation.index },
            text: '\n',
          },
        };
      default:
        throw new Error(`Unsupported operation type: ${operationType}`);
    }
  });

  try {
    return await client.request<BatchUpdateResponse>(
      url,
      {
        method: 'POST',
        body: JSON.stringify({ requests: transformedRequests }),
      },
      WRITE_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('timeout')) {
      throw new Error('Document update timed out - try with smaller content or simpler operations');
    }
    throw error;
  }
}

/**
 * Get document with metadata, size warnings, and fallback signal for
 * documents too large to load via the Docs API.
 */
export async function getDocumentSafe(
  client: ApiClient,
  documentId: string,
): Promise<{
  document?: DocumentContent;
  metadata: GoogleDocumentInfo;
  warnings: string[];
  useFallback: boolean;
}> {
  const warnings: string[] = [];

  try {
    const metadata = await getDocumentInfo(client, documentId);
    const size = metadata.size ? parseInt(metadata.size) : 0;

    if (size > 10 * 1024 * 1024) {
      warnings.push('Large document detected - processing may be slow');
    }

    if (size > MAX_DOCUMENT_SIZE) {
      warnings.push(
        `Document too large (${Math.round(size / 1024 / 1024)}MB) - use export instead`,
      );
      return { metadata, warnings, useFallback: true };
    }

    const document = await getDocument(client, documentId);
    return { document, metadata, warnings, useFallback: false };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    warnings.push(`Failed to load document: ${errorMessage}`);

    try {
      const metadata = await getDocumentInfo(client, documentId);
      return { metadata, warnings, useFallback: true };
    } catch (metadataError) {
      const metaErrorMessage =
        metadataError instanceof Error ? metadataError.message : 'Unknown error';
      throw new Error(`Cannot access document: ${metaErrorMessage}`);
    }
  }
}
