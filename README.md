# GDrive MCP Server by Peter Garety

A Model Context Protocol (MCP) server that provides AI assistants with secure access to your Google Docs. Run it locally for personal use or deploy it to Cloudflare Workers for global scale.

## ✨ Key Features

- 🔐 **Service Account Authentication** with Google Workspace
- 📖 **Read Google Docs** content and metadata  
- ✏️ **Create and Update** documents
- 🔍 **Search** through your documents
- 📑 **Tab Support** - work with multi-tab documents
- 📋 **Heading Navigation** - find and modify content under specific headings
- ☁️ **Cloudflare Workers** deployment ready
- 🖥️ **Local stdio** transport for Cursor and Claude Desktop
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

### 🖥️ Local Development (MCP stdio for Cursor or Claude Desktop users)

**Prerequisites**: You must be a Google Workspace admin for your domain.

1. **Clone and Install**
   ```bash
   git clone <your-repo-url>
   cd gdrive-mcp
   npm install
   ```

2. **Setup Google Workspace Service Account**
   - Create a service account in Google Cloud Console
   - Download the service account JSON key
   - Configure domain-wide delegation in Google Admin Console
   - See [detailed setup steps](#google-workspace-setup) below

3. **Setup Environment**
   ```bash
   cp env.example .env
   # Edit .env and add:
   # GOOGLE_SERVICE_ACCOUNT_PATH=/absolute/path/to/service-account.json
   # GOOGLE_USER_EMAIL=your-email@yourdomain.com
   ```

4. **Build and Run**
   ```bash
   npm run build:mcp
   npm run start:mcp
   ```

5. **Configure Cursor Desktop**
   Add to your `~/.cursor/mcp.json`:
   ```json
   {
     "mcpServers": {
       "gdrive": {
         "command": "node",
         "args": ["/absolute/path/to/gdrive-mcp/dist/mcp-server.js"],
         "cwd": "/absolute/path/to/gdrive-mcp"
       }
     }
   }
   ```

### ☁️ Cloudflare Workers Deployment

For shared use or web applications (uses OAuth 2.0):

1. **Setup Cloudflare**
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. **Configure KV Namespaces**
   ```bash
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

## 🔧 Google Workspace Setup

### For Local MCP (Service Account with Domain-wide Delegation)

**Prerequisites**: You must be a Google Workspace admin for your domain.

### 1. Create Project and Enable APIs

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable these APIs:
   - [Google Docs API](https://console.cloud.google.com/apis/library/docs.googleapis.com)
   - [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)

### 2. Create Service Account

1. Go to **IAM & Admin > Service Accounts**
2. Click **Create Service Account**
3. Fill in details:
   - Name: `gdrive-mcp-server`
   - Description: `Service account for Google Docs MCP server`
4. Click **Create and Continue**
5. Skip role assignment (not needed for domain-wide delegation)
6. Click **Done**

### 3. Generate Service Account Key

1. Click on your newly created service account
2. Go to **Keys** tab
3. Click **Add Key > Create new key**
4. Choose **JSON** format
5. Download the JSON file and save it securely (e.g., `service-account.json`)

### 4. Configure Domain-wide Delegation

#### Step A: Note the Client ID (Google Cloud Console)

1. In your service account details, copy the **Client ID**

#### Step B: Authorize Service Account (Google Admin Console)

**Important**: You must be a Google Workspace admin for this step.

1. Go to [Google Admin Console](https://admin.google.com/ac/owl/domainwidedelegation)
2. Click **Add new**
3. Enter the **Client ID** from Step A
4. In **OAuth scopes**, enter **exactly**:
   ```
   https://www.googleapis.com/auth/documents,https://www.googleapis.com/auth/drive
   ```
   ⚠️ **Critical**: No spaces after the comma, exact URLs as shown
5. Click **Authorize**
6. **Wait 5-10 minutes** for changes to propagate

### For Cloudflare Workers (OAuth 2.0)

### 1. Configure OAuth Consent Screen

1. Go to **APIs & Services > OAuth consent screen**
2. Choose **External** user type
3. Fill required fields:
   - App name: "GDrive MCP Server"
   - User support email: your email
   - Developer contact: your email
4. Add scopes:
   - `https://www.googleapis.com/auth/documents`
   - `https://www.googleapis.com/auth/drive`
   - `openid`, `profile`, `email`

### 2. Create OAuth Credentials

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

### Local MCP Setup

Your `.env` file should look like:
```bash
# Service Account with Domain-wide Delegation
GOOGLE_SERVICE_ACCOUNT_PATH=/Users/yourname/gdrive-mcp/service-account.json
GOOGLE_USER_EMAIL=yourname@yourcompany.com

# Local development settings
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

### Basic Operations with Cursor

```
@gdrive List my Google Docs
@gdrive Get document content for document ID: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
@gdrive Create a new document titled "Meeting Notes"
@gdrive Search for documents containing "project"
```

### Advanced Features

```
@gdrive Get headings from document ID: your-doc-id
@gdrive Get content under heading "Project Status" from document ID: your-doc-id  
@gdrive Insert content under heading "Tasks" from document ID: your-doc-id with content "✅ Setup complete"
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

**"Tools not found" in Cursor**
- Verify your `~/.cursor/mcp.json` file is correct
- Check that absolute paths are used in the configuration
- Restart Cursor after making configuration changes
- Test the MCP server manually: `echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}' | npm run start:mcp`

**Build errors**
- Use `npm run build:mcp` for local development (not `npm run build`)
- TypeScript errors in worker files can be ignored for local MCP usage

**KV namespace errors (Cloudflare)**
- Run `wrangler kv:namespace create "TOKEN_STORE"`
- Update `wrangler.toml` with the returned namespace ID

**"unauthorized_client" error with service account**
- Verify domain-wide delegation is configured in Google Admin Console
- Check that OAuth scopes are exactly: `https://www.googleapis.com/auth/documents,https://www.googleapis.com/auth/drive`
- Ensure `GOOGLE_USER_EMAIL` matches your Google Workspace domain
- Wait 5-10 minutes after configuring domain-wide delegation

**"Service account authentication failed"**
- Check that `GOOGLE_SERVICE_ACCOUNT_PATH` points to the correct JSON file
- Verify the service account JSON file is valid
- Ensure you're a Google Workspace admin (domain-wide delegation requires admin access)

### Debug Mode

Enable detailed logging:
```bash
# Set in your .env file
MCP_LOG_LEVEL=DEBUG
```

### View Logs

```bash
# Local MCP server logs appear in the terminal where you run:
npm run start:mcp

# Cloudflare Workers logs
wrangler tail
```

## 🔒 Security Features

- **Service Account Authentication**: Secure authentication with Google Workspace
- **Domain-wide Delegation**: Admin-controlled access to organizational docs
- **Token Management**: Secure handling of authentication tokens
- **Input Validation**: All inputs validated and sanitized
- **Minimal Permissions**: Only requests necessary Google API scopes

## 📊 Performance Features

- **Large Document Handling**: Automatic chunking and streaming for big docs
- **Request Timeouts**: Prevents hanging requests
- **Memory Management**: Size limits and safe processing
- **Error Recovery**: Graceful handling of API failures

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

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