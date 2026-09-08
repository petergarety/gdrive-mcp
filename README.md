# GDrive MCP by Peter Garety

A Model Context Protocol (MCP) server that provides AI assistants with secure access to your Google Docs. Run it locally for personal use or deploy it to Cloudflare Workers for global scale.

Project status and remaining work: [Roadmap](docs/ROADMAP.md). Guides: [Preview and apply a section edit](docs/SECTION_EDITING.md), [Rich formatting](docs/RICH_FORMATTING.md), and [Export and save files](docs/EXPORTS.md).

## ✨ Key Features

- 📖 **Read Google Docs** content and metadata  
- ✏️ **Create and Update** documents
- **Rich formatting** — character/paragraph styles, lists, tables, and inline images (local source; not deployed)
- **Export files** — Markdown, text, PDF, and DOCX as MCP embedded resources with an offline saving helper (local source; not deployed)
- 🔍 **Search** through your documents
- 📑 **Tab Detection** - identify tabs in multi-tab documents
- 📋 **Heading Extraction** - extract document structure (H1-H6)
- 📄 **Content Retrieval** - get content under specific headings
- 🔐 **Dual Authentication** - Service Account (local) + OAuth (cloud)
- ☁️ **Cloudflare Workers** deployment ready
- 🖥️ **Local stdio** transport for Cursor and Claude Desktop
- 🚀 **Fast and Scalable** serverless architecture
- 🛡️ **Type-safe** TypeScript implementation

## 🛠️ Available Tools

| Tool | Description |
|------|-------------|
| `list_documents` | List Google Docs in your Drive 
| `get_document` | Get full document content with formatting
| `get_document_text` | Get plain text content of a document
| `create_document` | Create a new Google Doc 
| `update_document` | Update text, character/paragraph styles, lists, tables, and inline images (expanded contract integrated locally; see status below) |
| `search_documents` | Search documents by content or title
| `get_document_info` | Get document metadata
| `get_document_tabs` | List tabs in a document
| `get_document_headings` | Extract headings (H1-H6) from a document
| `get_content_under_heading` | Get content under a specific heading
| `replace_section` | Preview or apply a revision-checked, tab-scoped plain-text section replacement |
| `export_document` | Export Markdown/text/PDF/DOCX as file metadata plus an embedded resource; see the saving guide (local source; not deployed) |

`replace_section` was deployed from commit `bd49a12` on September 5, 2026. It defaults to preview; applying requires `dryRun: false` and a recent `requiredRevisionId`. Replacement includes subheadings and does not preserve formatting. Read the [section editing guide](docs/SECTION_EDITING.md) before use. Public deployment checks passed, but authenticated Google document validation remains outstanding.

The expanded `update_document` formatting contract is integrated and locally tested in the September 8, 2026 formatting/export source segment; see Git history for its exact commit. It is not pushed, deployed, or live-validated. Before this segment, Git inspection found formatting still uncommitted on top of `bd49a12`; the earlier claim of a completed separate formatting commit was incorrect. It writes immediately and rejects `dryRun`; supply the revision from your read and select a tab for multi-tab documents. The [rich formatting guide](docs/RICH_FORMATTING.md) covers operation examples, UTF-16 indices, limits, and the remaining live-validation checklist.

`export_document` is integrated locally as tool 12. It returns versioned JSON file metadata and one embedded text/blob resource with a SHA-256 checksum, not a browser URL. The [export guide](docs/EXPORTS.md) documents the complete contract and [`beast-scripts/save-export.mjs`](beast-scripts/save-export.mjs) for validated, non-overwriting file saves. The default export limit is 2 MiB; there is no per-tab selection or verified all-tabs guarantee. Export integration is included in this local source segment, but remains unpushed, undeployed, and not live-validated. Production remains the recorded 11-tool section release; committing or testing local source does not deploy it.

## 🚀 Quick Start

Choose your deployment method - these are **two completely separate approaches**:

### 🖥️ Local MCP Server (Personal Google Workspace)

**Use this if**: You're a Google Workspace admin and want local stdio transport.
**Prerequisites**: Google Workspace admin access for domain-wide delegation.

1. **Clone and Install**
   ```bash
   git clone https://github.com/petergarety/gdrive-mcp.git
   cd gdrive-mcp
   npm install
   ```

2. **Setup Google Workspace Service Account**
   - Create a service account in Google Cloud Console
   - Download the service account JSON key
   - Configure domain-wide delegation in Google Admin Console
   - See [detailed setup steps](#-google-workspace-setup) below

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

### ☁️ Cloudflare Workers (Web-based OAuth)

**Use this if**: You want web-based authentication that works with any Google account.
**Benefits**: No Workspace admin required, works with personal Gmail, scalable.

1. **Setup Cloudflare**
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. **Create KV Namespaces**
   ```bash
   npx wrangler kv namespace create "TOKEN_STORE"
   npx wrangler kv namespace create "CACHE"
   # Update wrangler.toml with the returned namespace IDs
   ```

3. **Configure wrangler.toml**
   ```bash
   cp wrangler.toml.example wrangler.toml
   # Edit wrangler.toml and update:
   # - Replace "your-gdrive-mcp-server" with your desired worker name
   # - Update GOOGLE_REDIRECT_URI placeholder
   # - Add the KV namespace IDs from step 2
   ```   

4. **Generate TypeScript Types**
   ```bash
   npx wrangler types
   ```
   This creates `worker-configuration.d.ts` with proper TypeScript types for your Cloudflare environment.

5. **Initial Deploy (to get worker URL)**
   ```bash
   npm run build
   npx wrangler deploy
   ```
   Note the worker URL (e.g., `https://gdrive-mcp-server.your-subdomain.workers.dev`)

6. **Update Configuration**
   - Update `GOOGLE_REDIRECT_URI` in `wrangler.toml` with your actual worker URL
   - Configure Google OAuth in Cloud Console with the real callback URL (see [OAuth setup instructions](#for-cloudflare-workers-oauth-20))

7. **Set OAuth Secrets**
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

8. **Final Deploy**
   ```bash
   npm run build
   npx wrangler deploy
   ```

9. **Get Your API Key**
   Visit `https://your-worker-url/` to authenticate and get your API key for MCP clients.

10. **Add to MCP Client Configuration**
   Add the following to your `~/.cursor/mcp.json` file:
   ```json
   {
     "mcpServers": {
       "gdriveCF": {
         "url": "https://your-worker-url/mcp",
         "headers": {
           "Authorization": "Bearer YOUR_API_KEY_FROM_STEP_9"
         }
       }
     }
   }
   ```
   Replace:
   - `your-worker-url` with your actual worker URL
   - `YOUR_API_KEY_FROM_STEP_9` with the API key from the previous step.
   
   Restart Cursor and you can now use `@gdriveCF` commands!

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
   - `https://www.googleapis.com/auth/drive.readonly`
   - `openid`, `profile`, `email`

These are the scopes requested by the Worker code. Local service-account authorization above separately requests `documents` + `drive`. Export integration makes no OAuth scope change or token migration; existing granted scopes and file permissions still require validation.

### 2. Create OAuth Credentials

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth 2.0 Client IDs**
3. Application type: **Web application**
4. Name: "GDrive MCP Server"
5. Authorized redirect URIs:
   - `https://your-worker.workers.dev/callback` (replace with your actual worker URL)


## 🔐 Authentication Flow

### Local MCP Server
1. **Service Account**: Uses JSON key file for authentication
2. **Domain-wide Delegation**: Impersonates your Google Workspace user
3. **Direct API Access**: No OAuth needed, direct API calls  
4. **Stdio Transport**: Communicates with Cursor or Claude via stdin/stdout

### Cloudflare Workers  
1. **Web OAuth**: User authenticates via `/auth` endpoint once
2. **Token Storage**: Access/refresh tokens stored in Cloudflare KV
3. **API Key**: Long-lived API key for MCP client authentication
4. **Auto Refresh**: Worker automatically refreshes Google tokens
5. **HTTPS Transport**: MCP client connects via HTTPS with API key

## 🐛 Troubleshooting

### Common Issues

**"OAuth Error: redirect_uri_mismatch"**
- Ensure redirect URI in Google Console exactly matches your worker URL
- Example: `https://gdrive-mcp-server.your-subdomain.workers.dev/callback`

**"Tools not found" in Cursor**
- Verify your `~/.cursor/mcp.json` file is correct
- Check that absolute paths are used in the configuration
- Restart Cursor after making configuration changes
- Test the MCP server manually: `echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}' | npm run start:mcp`

**Build errors**
- Use `npm run build:mcp` for local development (not `npm run build`)

**"Unauthorized_client" error with service account**
- Verify domain-wide delegation is configured in Google Admin Console
- Check that OAuth scopes are exactly: `https://www.googleapis.com/auth/documents,https://www.googleapis.com/auth/drive`
- Ensure `GOOGLE_USER_EMAIL` matches your Google Workspace domain
- Wait 5-10 minutes after configuring domain-wide delegation

**"Service account authentication failed"**
- Check that `GOOGLE_SERVICE_ACCOUNT_PATH` points to the correct JSON file
- Verify the service account JSON file is valid
- Ensure you're a Google Workspace admin (domain-wide delegation requires admin access)

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

## 💡 Use Cases

- **Documentation Management**: AI-powered document creation and updates
- **Content Analysis**: Extract insights from document collections
- **Automated Reporting**: Generate reports directly in Google Docs
- **Research Assistant**: AI help with document research and organization
- **Project Management**: Update project docs with status and progress
- **Meeting Notes**: AI-assisted note-taking and document updates

## 🔗 Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP SDK](https://github.com/modelcontextprotocol/sdk)
- [Claude Desktop](https://claude.ai/desktop)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Google Docs API](https://developers.google.com/docs/api)

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.