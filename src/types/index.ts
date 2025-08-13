export interface Env {
  // Google OAuth credentials
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  
  // KV Namespaces
  TOKEN_STORE: KVNamespace;  // For storing OAuth tokens
  CACHE?: KVNamespace;       // For general caching
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
  body: {
    content: any[];
  };
  revisionId: string;
  tabs?: Array<{
    tabId: string;
    title?: string;
    documentTab?: any;
    [key: string]: any;
  }>;
}

export interface AuthContext {
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
}

export interface DocUpdateRequest {
  documentId: string;
  requests: any[];
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
