import { GoogleDocumentInfo, DocumentContent, DocUpdateRequest, DocCreateRequest } from '../types/index.js';

export class GoogleDocsAPI {
  private accessToken: string;
  
  // Configuration constants
  private static readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private static readonly MAX_DOCUMENT_SIZE = 50 * 1024 * 1024; // 50MB
  private static readonly MAX_TEXT_LENGTH = 10 * 1024 * 1024; // 10MB text
  private static readonly MAX_PROCESSING_TIME = 60000; // 60 seconds for text extraction
  private static readonly CHUNK_SIZE = 1000; // Process in chunks for large docs

  constructor(accessToken: string) {
    if (!accessToken || !accessToken.startsWith('ya29.')) {
      throw new Error('Invalid access token format');
    }
    this.accessToken = accessToken;
  }

  /**
   * Make request with timeout and retry logic
   */
  private async makeRequest(url: string, options: RequestInit = {}, timeout = GoogleDocsAPI.DEFAULT_TIMEOUT): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        }
        
        // Don't expose detailed API errors to users
        const safeError = response.status >= 500 
          ? 'Google API temporarily unavailable' 
          : `Request failed with status ${response.status}`;
        throw new Error(safeError);
      }

      // Check content length before parsing
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > GoogleDocsAPI.MAX_DOCUMENT_SIZE) {
        throw new Error('Document too large to process');
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      
      throw error;
    }
  }

  /**
   * Check document size before fetching full content
   */
  private async checkDocumentSize(documentId: string): Promise<number> {
    try {
      const info = await this.getDocumentInfo(documentId);
      const size = info.size ? parseInt(info.size) : 0;
      
      if (size > GoogleDocsAPI.MAX_DOCUMENT_SIZE) {
        throw new Error(`Document too large: ${Math.round(size / 1024 / 1024)}MB (max: ${GoogleDocsAPI.MAX_DOCUMENT_SIZE / 1024 / 1024}MB)`);
      }
      
      return size;
    } catch (error) {
      // If we can't get size info, proceed with caution
      console.warn('Could not check document size:', error);
      return 0;
    }
  }

  /**
   * List Google Docs in user's Drive
   */
  async listDocuments(pageSize: number = 10, pageToken?: string): Promise<{
    files: GoogleDocumentInfo[];
    nextPageToken?: string;
  }> {
    const params = new URLSearchParams({
      q: "mimeType='application/vnd.google-apps.document'",
      pageSize: pageSize.toString(),
      fields: 'files(id,name,mimeType,createdTime,modifiedTime,webViewLink,size,parents),nextPageToken',
    });

    if (pageToken) {
      params.append('pageToken', pageToken);
    }

    const url = `https://www.googleapis.com/drive/v3/files?${params}`;
    const response = await this.makeRequest(url);

    return {
      files: response.files || [],
      nextPageToken: response.nextPageToken,
    };
  }

  /**
   * Get a specific document's content with size validation
   */
  async getDocument(documentId: string): Promise<DocumentContent> {
    if (!documentId || !/^[a-zA-Z0-9_-]+$/.test(documentId)) {
      throw new Error('Invalid document ID format');
    }
    
    // Check document size first
    await this.checkDocumentSize(documentId);
    
    const url = `https://docs.googleapis.com/v1/documents/${documentId}`;
    return this.makeRequest(url, {}, 45000); // Longer timeout for large documents
  }

  /**
   * Get document metadata from Drive API
   */
  async getDocumentInfo(documentId: string): Promise<GoogleDocumentInfo> {
    const url = `https://www.googleapis.com/drive/v3/files/${documentId}?fields=id,name,mimeType,createdTime,modifiedTime,webViewLink,size,parents`;
    return this.makeRequest(url);
  }

  /**
   * Create a new Google Doc
   */
  async createDocument(request: DocCreateRequest): Promise<DocumentContent> {
    // First create the document
    const createUrl = 'https://docs.googleapis.com/v1/documents';
    const document = await this.makeRequest(createUrl, {
      method: 'POST',
      body: JSON.stringify({
        title: request.title,
      }),
    });

    // If content is provided, add it to the document
    if (request.content) {
      await this.updateDocument({
        documentId: document.documentId,
        requests: [
          {
            insertText: {
              location: {
                index: 1,
              },
              text: request.content,
            },
          },
        ],
      });

      // Return updated document
      return this.getDocument(document.documentId);
    }

    return document;
  }

  /**
   * Update a Google Doc with improved error handling
   */
  async updateDocument(request: DocUpdateRequest): Promise<any> {
    const url = `https://docs.googleapis.com/v1/documents/${request.documentId}:batchUpdate`;
    
    // Transform MCP operations to Google Docs API format
    const transformedRequests = request.requests.map((operation: any) => {
      // Handle both MCP format (with type) and direct Google Docs API format
      if (operation.insertText || operation.deleteContentRange || operation.replaceAllText) {
        // Already in Google Docs API format, pass through
        return operation;
      }
      
      // Handle MCP format operations
      const operationType = operation.type;
      if (!operationType) {
        console.error('Operation missing type:', operation);
        throw new Error(`Operation missing type field. Received: ${JSON.stringify(operation)}`);
      }
      
      switch (operationType) {
        case 'insert_text':
          return {
            insertText: {
              location: {
                index: operation.index
              },
              text: operation.text
            }
          };
        case 'delete_text':
          return {
            deleteContentRange: {
              range: {
                startIndex: operation.index,
                endIndex: operation.endIndex || operation.index + 1
              }
            }
          };
        case 'replace_text':
          return {
            replaceAllText: {
              replaceText: operation.text,
              containsText: {
                text: operation.oldText || '',
                matchCase: true
              }
            }
          };
        case 'insert_paragraph_break':
          return {
            insertText: {
              location: {
                index: operation.index
              },
              text: '\n'
            }
          };
        default:
          throw new Error(`Unsupported operation type: ${operationType}`);
      }
    });

    // Use longer timeout for write operations and add retry logic
    try {
      return await this.makeRequest(url, {
        method: 'POST',
        body: JSON.stringify({
          requests: transformedRequests,
        }),
      }, 60000); // 60 second timeout for writes
    } catch (error) {
      // If it's a timeout, provide a more helpful error message
      if (error instanceof Error && error.message.includes('timeout')) {
        throw new Error('Document update timed out - try with smaller content or simpler operations');
      }
      throw error;
    }
  }

  /**
   * Export document as plain text
   */
  async exportDocumentAsText(documentId: string): Promise<string> {
    const url = `https://www.googleapis.com/drive/v3/files/${documentId}/export?mimeType=text/plain`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to export document: ${response.status}`);
    }

    return response.text();
  }
  
  /**
   * Search for documents by name or content
   */
  async searchDocuments(query: string, pageSize: number = 10): Promise<GoogleDocumentInfo[]> {
    // Escape single quotes and limit special characters
    const escapedQuery = query.replace(/'/g, "\\'").replace(/[^a-zA-Z0-9\s]/g, ' ');
    const searchQuery = `mimeType='application/vnd.google-apps.document' and fullText contains '${escapedQuery}'`;
    
    // Or better yet, use Drive API's native search parameters
    const params = new URLSearchParams({
      q: `mimeType='application/vnd.google-apps.document'`,
      pageSize: pageSize.toString(),
      fields: 'files(id,name,mimeType,createdTime,modifiedTime,webViewLink,size,parents)',
    });
    
    // Add search term as separate parameter if API supports it
    if (query.trim()) {
      params.append('q', `${params.get('q')} and fullText contains '${escapedQuery}'`);
    }

    const url = `https://www.googleapis.com/drive/v3/files?${params}`;
    const response = await this.makeRequest(url);

    return response.files || [];
  }

  /**
   * Extract plain text content from document body with memory management
   */
  extractTextFromDocument(document: DocumentContent): string {
    const startTime = Date.now();
    const textChunks: string[] = [];
    let totalLength = 0;
    const maxDepth = 10; // Prevent stack overflow
    let processedElements = 0;
    
    const extractFromElement = (element: any, depth = 0): void => {
      // Safety checks
      if (depth > maxDepth) return;
      if (Date.now() - startTime > GoogleDocsAPI.MAX_PROCESSING_TIME) {
        throw new Error('Document processing timeout - document too complex');
      }
      if (totalLength > GoogleDocsAPI.MAX_TEXT_LENGTH) {
        throw new Error('Document text too large to process');
      }
      
      processedElements++;
      
      // Process in chunks to prevent memory issues
      if (processedElements % GoogleDocsAPI.CHUNK_SIZE === 0) {
        // Yield control to prevent blocking
        setTimeout(() => {}, 0);
      }
      
      if (element.textRun?.content) {
        const content = element.textRun.content;
        totalLength += content.length;
        
        if (totalLength <= GoogleDocsAPI.MAX_TEXT_LENGTH) {
          textChunks.push(content);
        }
      } else if (element.paragraph?.elements) {
        element.paragraph.elements.forEach((el: any) => 
          extractFromElement(el, depth + 1)
        );
      } else if (element.table) {
        element.table.tableRows?.forEach((row: any) => {
          row.tableCells?.forEach((cell: any) => {
            cell.content?.forEach((cellElement: any) => {
              extractFromElement(cellElement, depth + 1);
            });
          });
        });
      }
    };

    try {
      if (document.body?.content) {
        document.body.content.forEach(extractFromElement);
      }
      
      // Join chunks efficiently
      return textChunks.join('');
    } catch (error) {
      console.warn('Text extraction error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error('Failed to extract text from document: ' + message);
    }
  }

  /**
   * Extract text with streaming support for very large documents
   */
  async extractTextFromDocumentStreaming(document: DocumentContent): Promise<AsyncIterable<string>> {
    const maxDepth = 10;
    let processedElements = 0;
    
    async function* processElement(element: any, depth = 0): AsyncIterable<string> {
      if (depth > maxDepth) return;
      
      processedElements++;
      
      // Yield control every CHUNK_SIZE elements
      if (processedElements % GoogleDocsAPI.CHUNK_SIZE === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      if (element.textRun?.content) {
        yield element.textRun.content;
      } else if (element.paragraph?.elements) {
        for (const el of element.paragraph.elements) {
          yield* processElement(el, depth + 1);
        }
      } else if (element.table) {
        for (const row of element.table.tableRows || []) {
          for (const cell of row.tableCells || []) {
            for (const cellElement of cell.content || []) {
              yield* processElement(cellElement, depth + 1);
            }
          }
        }
      }
    }

    async function* streamText(): AsyncIterable<string> {
      if (document.body?.content) {
        for (const element of document.body.content) {
          yield* processElement(element);
        }
      }
    }

    return streamText();
  }

  /**
   * Get document with size warnings and fallback options
   */
  async getDocumentSafe(documentId: string): Promise<{
    document?: DocumentContent;
    metadata: GoogleDocumentInfo;
    warnings: string[];
    useFallback: boolean;
  }> {
    const warnings: string[] = [];
    let useFallback = false;
    
    try {
      // Get metadata first
      const metadata = await this.getDocumentInfo(documentId);
      const size = metadata.size ? parseInt(metadata.size) : 0;
      
      // Add size warnings
      if (size > 10 * 1024 * 1024) { // 10MB
        warnings.push('Large document detected - processing may be slow');
      }
      
      if (size > GoogleDocsAPI.MAX_DOCUMENT_SIZE) {
        warnings.push(`Document too large (${Math.round(size / 1024 / 1024)}MB) - use export instead`);
        useFallback = true;
        return { metadata, warnings, useFallback };
      }
      
      // Try to get full document
      const document = await this.getDocument(documentId);
      
      return { document, metadata, warnings, useFallback: false };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      warnings.push(`Failed to load document: ${errorMessage}`);
      
      // Try to get metadata only
      try {
        const metadata = await this.getDocumentInfo(documentId);
        return { metadata, warnings, useFallback: true };
      } catch (metadataError) {
        const metaErrorMessage = metadataError instanceof Error ? metadataError.message : 'Unknown error';
        throw new Error(`Cannot access document: ${metaErrorMessage}`);
      }
    }
  }

  /**
   * Export large document as text with progress feedback
   */
  async exportLargeDocumentAsText(documentId: string): Promise<string> {
    const url = `https://www.googleapis.com/drive/v3/files/${documentId}/export?mimeType=text/plain`;
    
    // Use longer timeout for exports
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minutes
    
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Export failed with status ${response.status}`);
      }

      const text = await response.text();
      
      if (text.length > GoogleDocsAPI.MAX_TEXT_LENGTH) {
        return text.substring(0, GoogleDocsAPI.MAX_TEXT_LENGTH) + '\n\n[Text truncated due to size limits]';
      }
      
      return text;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Export timeout - document too large');
      }
      
      throw error;
    }
  }

  /**
   * Get document tabs information
   */
  async getDocumentTabs(documentId: string): Promise<{
    totalTabs: number;
    tabs: Array<{
      tabId: string;
      title: string;
      index: number;
    }>;
  }> {
    if (!documentId || !/^[a-zA-Z0-9_-]+$/.test(documentId)) {
      throw new Error('Invalid document ID format');
    }
    
    const url = `https://docs.googleapis.com/v1/documents/${documentId}?includeTabsContent=true`;
    const document = await this.makeRequest(url);
    
    // Extract tabs information from document structure
    const tabs = [];
    let tabIndex = 0;
    
    // Google Docs API returns tabs in the document structure
    if (document.tabs && Array.isArray(document.tabs)) {
      for (const tab of document.tabs) {
        tabs.push({
          tabId: tab.tabId || `tab_${tabIndex}`,
          title: tab.tabProperties?.title || tab.title || `Tab ${tabIndex + 1}`,
          index: tabIndex,
        });
        tabIndex++;
      }
    } else {
      // Single tab document (legacy format)
      tabs.push({
        tabId: 'main',
        title: document.title || 'Main Document',
        index: 0,
      });
    }
    
    return {
      totalTabs: tabs.length,
      tabs,
    };
  }

  /**
   * Extract headings from document structure
   */
  extractHeadingsFromDocument(document: DocumentContent, options: {
    includeText?: boolean;
    maxDepth?: number;
  } = {}): Array<{
    level: number;
    text: string;
    index: number;
    id?: string;
  }> {
    const { includeText = true, maxDepth = 6 } = options;
    const headings: Array<{ level: number; text: string; index: number; id?: string }> = [];
    
    // Process main body content - iterate through all elements directly
    if (document.body?.content) {
      document.body.content.forEach((element: any) => {
        // Check if this element is a paragraph
        if (element.paragraph) {
          const paragraph = element.paragraph;
          const style = paragraph.paragraphStyle;
          
          // Check if this is a heading based on named styles
          if (style && style.namedStyleType) {
            const styleType = style.namedStyleType;
            let headingLevel = 0;
            
            // Map Google Docs heading styles to levels
            switch (styleType) {
              case 'TITLE': headingLevel = 1; break; // Treat TITLE as H1
              case 'HEADING_1': headingLevel = 1; break;
              case 'HEADING_2': headingLevel = 2; break;
              case 'HEADING_3': headingLevel = 3; break;
              case 'HEADING_4': headingLevel = 4; break;
              case 'HEADING_5': headingLevel = 5; break;
              case 'HEADING_6': headingLevel = 6; break;
            }
            
            if (headingLevel > 0 && headingLevel <= maxDepth) {
              let headingText = '';
              
              if (includeText && paragraph.elements) {
                headingText = paragraph.elements
                  .map((el: any) => el.textRun?.content || '')
                  .join('')
                  .trim();
              }
              
              headings.push({
                level: headingLevel,
                text: headingText,
                index: element.startIndex || 0, // Use character position from Google Docs API
                id: style.headingId || undefined,
              });
            }
          }
        } else if (element.table) {
          // Process table cells for headings
          element.table.tableRows?.forEach((row: any) => {
            row.tableCells?.forEach((cell: any) => {
              cell.content?.forEach((cellElement: any) => {
                if (cellElement.paragraph) {
                  const paragraph = cellElement.paragraph;
                  const style = paragraph.paragraphStyle;
                  
                  if (style && style.namedStyleType) {
                    const styleType = style.namedStyleType;
                    let headingLevel = 0;
                    
                    switch (styleType) {
                      case 'TITLE': headingLevel = 1; break;
                      case 'HEADING_1': headingLevel = 1; break;
                      case 'HEADING_2': headingLevel = 2; break;
                      case 'HEADING_3': headingLevel = 3; break;
                      case 'HEADING_4': headingLevel = 4; break;
                      case 'HEADING_5': headingLevel = 5; break;
                      case 'HEADING_6': headingLevel = 6; break;
                    }
                    
                    if (headingLevel > 0 && headingLevel <= maxDepth) {
                      let headingText = '';
                      
                      if (includeText && paragraph.elements) {
                        headingText = paragraph.elements
                          .map((el: any) => el.textRun?.content || '')
                          .join('')
                          .trim();
                      }
                      
                      headings.push({
                        level: headingLevel,
                        text: headingText,
                        index: element.startIndex || 0, // Use character position from Google Docs API
                        id: style.headingId || undefined,
                      });
                    }
                  }
                }
              });
            });
          });
        }
        // Skip other element types (sectionBreak, etc.) and continue
      });
    }
    
    // Also process tabs if they exist
    if (document.tabs) {
      document.tabs.forEach((tab: any) => {
        if (tab.documentTab?.body?.content) {
          tab.documentTab.body.content.forEach((element: any, index: number) => {
            if (element.paragraph) {
              const paragraph = element.paragraph;
              const style = paragraph.paragraphStyle;
              
              if (style && style.namedStyleType) {
                const styleType = style.namedStyleType;
                let headingLevel = 0;
                
                switch (styleType) {
                  case 'TITLE': headingLevel = 1; break;
                  case 'HEADING_1': headingLevel = 1; break;
                  case 'HEADING_2': headingLevel = 2; break;
                  case 'HEADING_3': headingLevel = 3; break;
                  case 'HEADING_4': headingLevel = 4; break;
                  case 'HEADING_5': headingLevel = 5; break;
                  case 'HEADING_6': headingLevel = 6; break;
                }
                
                if (headingLevel > 0 && headingLevel <= maxDepth) {
                  let headingText = '';
                  
                  if (includeText && paragraph.elements) {
                    headingText = paragraph.elements
                      .map((el: any) => el.textRun?.content || '')
                      .join('')
                      .trim();
                  }
                  
                  headings.push({
                    level: headingLevel,
                    text: headingText,
                    index: index, // Use array index position
                    id: style.headingId || undefined,
                  });
                }
              }
            }
          });
        }
      });
    }
    
    return headings;
  }

/**
 * Find heading and get content under it
 */
async getContentUnderHeading(documentId: string, options: {
  headingText: string;
  headingLevel?: number;
  matchMode?: 'exact' | 'contains' | 'starts_with';
}): Promise<{
  found: boolean;
  heading?: { level: number; text: string; index: number };
  content: string;
  contentElements?: any[];
  nextHeadingIndex?: number;
}> {
  const { headingText, headingLevel, matchMode = 'contains' } = options;
  
  // Get document safely
  const result = await this.getDocumentSafe(documentId);
  if (result.useFallback) {
    throw new Error('Document too large for heading-based operations');
  }

  const document = result.document!;
  const headings = this.extractHeadingsFromDocument(document, { includeText: true });
  
  // Find the target heading
  const targetHeading = headings.find(h => {
    if (headingLevel && h.level !== headingLevel) return false;
    
    const headingTextLower = h.text.toLowerCase();
    const searchTextLower = headingText.toLowerCase();
    
    switch (matchMode) {
      case 'exact':
        return headingTextLower === searchTextLower;
      case 'starts_with':
        return headingTextLower.startsWith(searchTextLower);
      case 'contains':
      default:
        return headingTextLower.includes(searchTextLower);
    }
  });

  if (!targetHeading) {
    return { found: false, content: '' };
  }

  // Find the next heading of same or higher level
  const nextHeading = headings.find(h => 
    h.index > targetHeading.index && h.level <= targetHeading.level
  );

  // Extract content between the heading and next heading
  const startIndex = targetHeading.index + 1;
  const endIndex = nextHeading ? nextHeading.index : undefined;
  
  const contentElements = this.extractContentBetweenIndices(document, startIndex, endIndex);
  const content = this.extractTextFromElements(contentElements);

  return {
    found: true,
    heading: targetHeading,
    content: content.trim(),
    contentElements,
    nextHeadingIndex: nextHeading?.index,
  };
}


/**
 * Helper: Extract content between specific character positions
 */
private extractContentBetweenIndices(document: DocumentContent, startCharIndex: number, endCharIndex?: number): any[] {
  const elements: any[] = [];
  
  if (document.body?.content) {
    document.body.content.forEach((element: any) => {
      const elementStart = element.startIndex || 0;
      const elementEnd = element.endIndex || elementStart;
      
      // Check if element overlaps with our target range
      const isAfterStart = elementEnd > startCharIndex;
      const isBeforeEnd = endCharIndex === undefined || elementStart < endCharIndex;
      
      if (isAfterStart && isBeforeEnd) {
        elements.push(element);
      }
    });
  }

  return elements;
}

/**
 * Helper: Extract text from specific elements
 */
private extractTextFromElements(elements: any[]): string {
  let text = '';
  
  for (const element of elements) {
    if (element.paragraph?.elements) {
      element.paragraph.elements.forEach((el: any) => {
        if (el.textRun?.content) {
          text += el.textRun.content;
        }
      });
    }
  }
  
  return text;
}

/**
 * Helper: Find element by character index
 */
private findElementByCharIndex(document: DocumentContent, charIndex: number): any {
  if (document.body?.content) {
    for (const element of document.body.content) {
      const start = element.startIndex || 0;
      const end = element.endIndex || start;
      
      if (charIndex >= start && charIndex < end) {
        return element;
      }
    }
  }
  return null;
}

/**
 * Helper: Get document end index (actual character position)
 */
private async getDocumentEndIndex(documentId: string): Promise<number> {
  const document = await this.getDocument(documentId);
  let maxIndex = 1; // Documents start at index 1
  
  // Find the highest endIndex in the document
  if (document.body?.content) {
    for (const element of document.body.content) {
      if (element.endIndex && element.endIndex > maxIndex) {
        maxIndex = element.endIndex;
      }
    }
  }
  
  return maxIndex;
}

/**
 * Simple text insertion at document end (for testing)
 */
async insertTextAtEnd(documentId: string, text: string): Promise<any> {
  const endIndex = await this.getDocumentEndIndex(documentId);
  
  return this.updateDocument({
    documentId,
    requests: [
      {
        type: 'insert_text',
        index: endIndex,
        text: `\n\n${text}\n`
      }
    ]
  });
}
}
