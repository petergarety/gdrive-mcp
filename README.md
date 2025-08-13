# GDrive MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides AI assistants with secure access to Google Docs. Deploy it to Cloudflare Workers for global scale or run it locally for personal use.

## ✨ Features

- 🔐 **Secure OAuth2 Authentication** with Google
- 📖 **Read Google Docs** content and metadata  
- ✏️ **Create and Update** documents
- 🔍 **Search** through your documents
- 📑 **Tab Support** - work with multi-tab documents
- 📋 **Heading Navigation** - find and modify content under specific headings
- ☁️ **Cloudflare Workers** deployment ready
- 🖥️ **Local stdio** transport for Claude Desktop
- 🚀 **Fast and Scalable** serverless architecture
- 🛡️ **Type-safe** TypeScript implementation

## 🛠️ Available Tools

| Tool | Description |
|------|-------------|
| `list_documents` | List Google Docs in your Drive |
| `get_document` | Get full document content with formatting |
| `get_document_text` | Get plain text content of a document |
| `create_document` | Create a new Google Doc |
| `update_document` | Update document content |
| `search_documents` | Search documents by content or title |
| `get_document_info` | Get document metadata |
| `get_document_tabs` | List tabs in a document |
| `get_document_headings` | Extract headings (H1-H6) from a document |
| `get_tab_content` | Get content from a specific tab |
| `get_content_under_heading` | Get content under a specific heading |
| `insert_content_under_heading` | Insert text under a specific heading |

## 🚀 Quick Start

Choose your deployment method:

### 🖥️ Local Development (MCP stdio for Claude Desktop)

Perfect for personal use with Claude Desktop:

1. **Clone and Install**
   ```bash
   git clone <your-repo-url>
   cd gdrive-mcp
   npm install
   ```

2. **Setup Environment**
   ```bash
   cp env.example .env
   # Edit .env with your Google OAuth credentials
   ```

3. **Configure Google Cloud** (see [detailed steps](#google-cloud-setup))
   - Enable Google Docs and Drive APIs
   - Create OAuth 2.0 credentials
   - Set redirect URI to `http://localhost:8787/callback`

4. **Build and Run**
   ```bash
   npm run build
   npm run dev:mcp
   ```

5. **Configure Claude Desktop**
   ```json
   {
     "mcpServers": {
       "gdrive": {
         "command": "node",
         "args": ["dist/index.js"],
         "cwd": "/path/to/your/gdrive-mcp",
         "env": {
           "NODE_ENV": "development"
         }
       }
     }
   }
   ```

### ☁️ Cloudflare Workers Deployment

Perfect for shared use or web applications:

1. **Setup Cloudflare**
   ```bash
   # Install Wrangler CLI
   npm install -g wrangler
   
   # Login to Cloudflare
   wrangler login
   ```

2. **Configure KV Namespaces**
   ```bash
   # Create KV namespaces for token storage
   wrangler kv:namespace create "TOKEN_STORE"
   wrangler kv:namespace create "TOKEN_STORE" --preview
   wrangler kv:namespace create "CACHE"
   wrangler kv:namespace create "CACHE" --preview
   
   # Update wrangler.toml with the returned IDs
   ```

3. **Set Secrets**
   ```bash
   wrangler secret put GOOGLE_CLIENT_ID
   wrangler secret put GOOGLE_CLIENT_SECRET
   ```

4. **Deploy**
   ```bash
   npm run build
   wrangler deploy
   ```

5. **Update OAuth Settings**
   - Go to Google Cloud Console
   - Update redirect URI to: `https://your-worker.workers.dev/callback`

## 🔧 Google Cloud Setup

### 1. Create Project and Enable APIs

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable these APIs:
   - [Google Docs API](https://console.cloud.google.com/apis/library/docs.googleapis.com)
   - [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)

### 2. Configure OAuth Consent Screen

1. Go to **APIs & Services > OAuth consent screen**
2. Choose **External** user type
3. Fill required fields:
   - App name: "GDrive MCP Server"
   - User support email: your email
   - Developer contact: your email
4. Add scopes:
   - `https://www.googleapis.com/auth/documents`
   - `https://www.googleapis.com/auth/drive.readonly`
   - `openid`, `profile`, `email`

### 3. Create OAuth Credentials

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth 2.0 Client IDs**
3. Application type: **Web application**
4. Name: "Google Docs MCP Server"
5. Authorized redirect URIs:
   - Local: `http://localhost:8787/callback`
   - Production: `https://your-worker.workers.dev/callback`

## 📋 Configuration

### Environment Variables

| Variable | Description | Local | Cloudflare |
|----------|-------------|-------|------------|
| `GOOGLE_CLIENT_ID` | OAuth client ID | `.env` file | `wrangler secret` |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret | `.env` file | `wrangler secret` |
| `GOOGLE_REDIRECT_URI` | OAuth redirect URI | `.env` file | `wrangler.toml` |
| `MCP_LOG_LEVEL` | Logging level | `.env` file | `wrangler.toml` |

### Local Development Setup

Your `.env` file should look like:
```bash
GOOGLE_CLIENT_ID=your-actual-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-actual-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8787/callback
MCP_LOG_LEVEL=DEBUG
NODE_ENV=development
```

### Cloudflare Workers Setup

Update `wrangler.toml` with your KV namespace IDs:
```toml
name = "your-gdrive-mcp-server"

[vars]
MCP_LOG_LEVEL = "INFO"
GOOGLE_REDIRECT_URI = "https://your-worker.workers.dev/callback"

[[kv_namespaces]]
binding = "TOKEN_STORE"
id = "your-token-kv-namespace-id"
preview_id = "your-preview-token-kv-namespace-id"
```

## 🎯 Usage Examples

### Basic Document Operations

```typescript
// List documents
await mcpClient.callTool("list_documents", { pageSize: 10 });

// Read document content
await mcpClient.callTool("get_document_text", { 
  documentId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms" 
});

// Create new document
await mcpClient.callTool("create_document", {
  title: "My New Document",
  content: "Hello, world!"
});
```

### Advanced Features

```typescript
// Work with document tabs
await mcpClient.callTool("get_document_tabs", {
  documentId: "your-doc-id"
});

// Extract headings for navigation
await mcpClient.callTool("get_document_headings", {
  documentId: "your-doc-id",
  includeText: true,
  maxDepth: 3
});

// Add content under a specific heading
await mcpClient.callTool("insert_content_under_heading", {
  documentId: "your-doc-id",
  headingText: "Project Status",
  content: "✅ Task completed successfully",
  insertMode: "append"
});
```

## 🔐 Authentication Flow

### Local stdio (Claude Desktop)
1. MCP server starts with your `.env` credentials
2. Server authenticates with Google using OAuth2
3. Tokens stored locally in memory
4. Claude communicates via stdin/stdout

### Cloudflare Workers (Web)
1. User visits `/auth` endpoint
2. Redirected to Google OAuth
3. User grants permissions
4. Tokens stored securely in Cloudflare KV
5. Session token provided for future requests

## 🌐 API Endpoints (Cloudflare Workers)

| Endpoint | Method | Description |
|----------|---------|-------------|
| `/` | GET | Server info and available endpoints |
| `/auth` | GET | Initiate OAuth flow |
| `/callback` | GET | OAuth callback handler |
| `/mcp` | POST | MCP protocol endpoint (requires auth) |
| `/status` | GET | Health check |
| `/logs` | GET | Request logs (requires auth) |

## 🛠️ Development Commands

```bash
# Local development
npm run dev              # Cloudflare Workers dev server
npm run dev:mcp          # MCP stdio server for Claude Desktop

# Building and deployment
npm run build            # Compile TypeScript
npm run deploy           # Deploy to Cloudflare Workers
npm run deploy:dev       # Deploy to dev environment

# Utilities
npm run types            # Generate TypeScript types
npm run lint             # Run ESLint
npm run test             # Run tests
```

## 🐛 Troubleshooting

### Common Issues

**"OAuth Error: redirect_uri_mismatch"**
- Ensure redirect URI in Google Console exactly matches your setup
- Local: `http://localhost:8787/callback`
- Production: `https://your-worker.workers.dev/callback`

**"Authentication required" in MCP calls**
- For Cloudflare Workers: Complete OAuth flow via `/auth` endpoint first
- For local stdio: Check your `.env` file has correct credentials

**"API Error: insufficient permissions"**
- Verify Google Docs API and Drive API are enabled
- Check OAuth consent screen has correct scopes

**KV namespace errors (Cloudflare)**
- Run `wrangler kv:namespace create "TOKEN_STORE"`
- Update `wrangler.toml` with the returned namespace ID

**stdio transport error**
- This happens in Cloudflare Workers environment
- Use `npm run dev` for Workers, `npm run dev:mcp` for stdio

### Debug Mode

Enable detailed logging:
```bash
# Local development
MCP_LOG_LEVEL=DEBUG npm run dev:mcp

# Cloudflare Workers
# Set MCP_LOG_LEVEL="DEBUG" in wrangler.toml
```

### View Logs

```bash
# Cloudflare Workers logs
wrangler tail

# Local development logs
# Output appears in terminal where you ran npm run dev:mcp
```

## 🔒 Security Features

- **OAuth2 Flow**: Secure authentication with Google
- **Token Management**: Access tokens stored securely (KV for Workers, memory for local)
- **HTTPS Only**: All communication over encrypted connections  
- **Minimal Permissions**: Only requests necessary Google API scopes
- **Session Management**: Secure session handling with expiration
- **Request Logging**: Comprehensive audit trail
- **Input Validation**: All inputs validated and sanitized

## 📊 Performance Features

- **Large Document Handling**: Automatic chunking and streaming for big docs
- **Request Timeouts**: Prevents hanging requests
- **Memory Management**: Size limits and safe processing
- **Caching**: Optional KV caching for improved performance
- **Error Recovery**: Graceful handling of API failures

## 🤝 Contributing

1. Create a feature branch: `git checkout -b feature-name`
2. Make changes and add tests
3. Run linting: `npm run lint`
4. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🔗 Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP SDK](https://github.com/modelcontextprotocol/sdk)
- [Claude Desktop](https://claude.ai/desktop)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Google Docs API](https://developers.google.com/docs/api)

## 💡 Use Cases

- **Documentation Management**: AI-powered document creation and updates
- **Content Analysis**: Extract insights from document collections
- **Automated Reporting**: Generate reports directly in Google Docs
- **Research Assistant**: AI help with document research and organization
- **Project Management**: Update project docs with status and progress
- **Meeting Notes**: AI-assisted note-taking and document updates