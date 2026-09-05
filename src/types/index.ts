import type { DocumentTab, StructuralElement } from '../api/types.js';

export interface Env {
  // Google OAuth credentials
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  
  // MCP Configuration
  MCP_LOG_LEVEL: string;
  NODE_ENV: string;
  
  // KV Namespaces
  TOKEN_STORE: KVNamespace;  // For storing OAuth tokens
  CACHE: KVNamespace;        // For general caching
}

export interface GoogleDocumentInfo {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink: string;
  size?: string;
  parents?: string[];
}

export interface DocumentContent {
  documentId: string;
  title: string;
  body?: {
    content: StructuralElement[];
  };
  revisionId?: string;
  tabs?: DocumentTab[];
}

export interface AuthContext {
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
}

export interface DocUpdateRequest {
  documentId: string;
  requests: Array<Record<string, unknown>>;
  tabId?: string;
  requiredRevisionId?: string;
}

export interface DocCreateRequest {
  title: string;
  content?: string;
}

export interface SessionData {
  userId: string;
  createdAt: number;
  expiresAt: number;
  userInfo?: {
    id: string;
    email: string;
    name: string;
    picture?: string;
  };
}

export interface MCPAuthContext {
  userId: string;
  sessionToken: string;
}
