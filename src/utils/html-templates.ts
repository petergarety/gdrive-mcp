/**
 * HTML templates for the GDrive MCP Worker web interface
 */

/**
 * Escape a string for safe interpolation into HTML text/attribute context.
 * Defense-in-depth: current call sites pass server-controlled values
 * (hex API keys, configured worker URL), but this guards against any future
 * call site passing user-controlled input.
 */
function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getWelcomePage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Connect your Google Docs to your AI workflow. Search, read, create, and edit documents through Model Context Protocol.">
    <meta name="theme-color" content="#f7f7f2">
    <title>GDrive MCP — Your docs. Meet your AI.</title>
    <style>
        :root {
            color-scheme: light;
            --canvas: #f7f7f2;
            --surface: #ffffff;
            --ink: #20251f;
            --muted: #61665e;
            --line: #dddfd5;
            --accent: #f1d54d;
            --accent-hover: #e7c83a;
        }
        * { box-sizing: border-box; }
        body, h1, h2, h3, p { margin: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: var(--canvas);
            color: var(--ink);
            min-height: 100vh;
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
        }
        a { color: inherit; }
        a:focus-visible {
            outline: 3px solid #526938;
            outline-offset: 5px;
        }
        svg { display: block; flex-shrink: 0; }
        ::selection { background: var(--accent); color: var(--ink); }
        .shell { width: min(1120px, calc(100% - 64px)); margin-inline: auto; }
        .skip-link {
            position: absolute;
            top: 12px;
            left: 16px;
            z-index: 2;
            padding: 10px 16px;
            background: var(--ink);
            color: white;
            transform: translateY(-160%);
        }
        .skip-link:focus { transform: translateY(0); }
        .site-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 24px;
            min-height: 96px;
            border-bottom: 1px solid var(--line);
        }
        .brand {
            display: inline-flex;
            align-items: center;
            gap: 12px;
            font-size: 17px;
            font-weight: 700;
            letter-spacing: -0.6px;
            text-decoration: none;
        }
        .brand-mark, .connection-mark {
            display: grid;
            place-items: center;
            background: var(--ink);
            color: var(--accent);
            border-radius: 12px;
        }
        .brand-mark { width: 38px; height: 38px; }
        .header-links { display: flex; align-items: center; gap: 28px; }
        .header-links a {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            min-height: 44px;
            color: var(--muted);
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
        }
        .header-links a:hover, .site-footer a:hover { color: var(--ink); text-decoration: underline; }
        .hero {
            display: grid;
            grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
            align-items: center;
            gap: 76px;
            padding-block: 72px;
        }
        .eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 9px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 1.6px;
            text-transform: uppercase;
        }
        .eyebrow::before {
            content: '';
            width: 8px;
            height: 8px;
            border-radius: 2px;
            background: var(--accent);
            box-shadow: 0 0 0 4px #efeee1;
        }
        h1 {
            margin-block: 25px 24px;
            font-size: clamp(48px, 5.8vw, 76px);
            font-weight: 650;
            letter-spacing: -0.065em;
            line-height: 1.05;
        }
        h1 span { color: #6a735c; }
        .hero-description { max-width: 430px; font-size: 17px; color: var(--muted); line-height: 1.8; }
        .capabilities {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin: 28px 0 0;
            padding: 0;
            list-style: none;
        }
        .capabilities li {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            padding: 6px 11px;
            border: 1px solid var(--line);
            border-radius: 7px;
            color: #4f5748;
            font-size: 12px;
            font-weight: 500;
        }
        .compatibility { margin-top: 22px; font-size: 12px; color: var(--muted); }
        .connection-wrap { position: relative; min-width: 0; isolation: isolate; }
        .connection-wrap::before {
            content: '';
            position: absolute;
            inset: -24px -20px;
            z-index: -1;
            background: radial-gradient(ellipse, #eee6ad 0%, transparent 70%);
        }
        .connection-card {
            padding: 32px;
            border: 1px solid #e3e5db;
            border-radius: 24px;
            background: var(--surface);
            box-shadow: 0 4px 8px #20251f03, 0 24px 60px -24px #20251f26;
        }
        .card-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
        .connection-mark { width: 44px; height: 44px; background: #f8f2d3; color: #746111; }
        .card-kicker { font-size: 11px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; }
        .card-subtitle { margin-top: 1px; font-size: 12px; color: var(--muted); }
        .connection-card h2 { font-size: 26px; line-height: 1.25; font-weight: 650; letter-spacing: -1px; }
        .card-description { margin-top: 12px; font-size: 14px; color: var(--muted); line-height: 1.75; }
        .connection-path {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-block: 25px;
            padding: 16px 12px;
            border: 1px solid #e9ebe3;
            border-radius: 12px;
            background: #fafbf7;
        }
        .endpoint { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; white-space: nowrap; }
        .endpoint svg { color: #65724f; }
        .bridge { display: flex; align-items: center; flex: 1; min-width: 28px; gap: 5px; }
        .bridge::before, .bridge::after { content: ''; flex: 1; border-top: 1px dashed #b8bead; }
        .bridge span { font: 10px ui-monospace, SFMono-Regular, Consolas, monospace; color: var(--muted); }
        .auth-button {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            min-height: 54px;
            padding: 14px 20px;
            border: 1px solid transparent;
            border-radius: 10px;
            background: var(--accent);
            color: var(--ink);
            font-size: 14px;
            font-weight: 650;
            text-decoration: none;
            text-align: center;
            transition: background 160ms ease, transform 160ms ease, box-shadow 160ms ease;
        }
        .auth-button:hover { background: var(--accent-hover); transform: translateY(-1px); box-shadow: 0 6px 18px #c0a52c26; }
        .auth-button:active { transform: translateY(0); }
        .auth-note { display: flex; align-items: flex-start; gap: 7px; margin-top: 15px; font-size: 11px; color: var(--muted); }
        .auth-note svg { margin-top: 2px; }
        .setup { border-top: 1px solid var(--line); padding-block: 30px 38px; scroll-margin-top: 24px; }
        .setup-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin-bottom: 24px; }
        .setup h2 { font-size: 20px; font-weight: 600; letter-spacing: -0.6px; }
        .setup-heading > p { font-size: 12px; color: var(--muted); }
        .steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 30px; margin: 0; padding: 0; list-style: none; }
        .steps li { display: flex; align-items: flex-start; gap: 13px; }
        .step-number {
            flex-shrink: 0;
            display: grid;
            place-items: center;
            width: 28px;
            height: 28px;
            border: 1px solid #d6d9ca;
            border-radius: 50%;
            font: 11px ui-monospace, SFMono-Regular, Consolas, monospace;
            color: #576049;
        }
        .steps h3 { margin-bottom: 5px; font-size: 13px; font-weight: 650; }
        .steps p { color: var(--muted); font-size: 12px; line-height: 1.7; }
        .site-footer {
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 10px 24px;
            padding-block: 22px;
            border-top: 1px solid var(--line);
            color: var(--muted);
            font-size: 11px;
        }
        .site-footer a { text-underline-offset: 3px; }
        @media (max-width: 1000px) {
            .hero { gap: 36px; }
            .connection-card { padding: 26px; }
            .connection-path { gap: 7px; padding-inline: 10px; }
            .endpoint { font-size: 11px; }
        }
        @media (max-width: 760px) {
            .shell { width: min(540px, calc(100% - 40px)); }
            .site-header { min-height: 80px; gap: 16px; }
            .header-links { gap: 18px; }
            .header-links a { font-size: 12px; }
            .hero { grid-template-columns: minmax(0, 1fr); gap: 36px; padding-block: 44px; }
            h1 { font-size: clamp(48px, 10vw, 64px); margin-block: 22px; }
            .hero-description { font-size: 16px; }
            .connection-wrap::before { inset: -16px; }
            .connection-card { padding: 28px; border-radius: 20px; }
            .endpoint { font-size: 12px; }
            .setup-heading { display: block; }
            .setup-heading > p { margin-top: 6px; }
            .steps { grid-template-columns: minmax(0, 1fr); gap: 24px; }
            .steps h3 { font-size: 14px; }
            .steps p { font-size: 13px; }
        }
        @media (max-width: 380px) {
            .shell { width: calc(100% - 32px); }
            .brand { gap: 8px; font-size: 15px; }
            .brand-mark { width: 32px; height: 32px; border-radius: 9px; }
            .header-links { gap: 12px; }
            .header-links a { font-size: 11px; }
            .header-links svg { display: none; }
            .connection-card { padding: 22px; }
            .endpoint { font-size: 11px; gap: 5px; }
            .eyebrow { font-size: 10px; letter-spacing: 1.1px; }
        }
        @media (prefers-reduced-motion: reduce) {
            .auth-button { transition: none; }
            .auth-button:hover, .auth-button:active { transform: none; }
        }
    </style>
</head>
<body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header shell">
        <a class="brand" href="/" aria-label="GDrive MCP home">
            <span class="brand-mark">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>
            </span>
            GDrive MCP
        </a>
        <nav class="header-links" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="https://github.com/petergarety/gdrive-mcp" target="_blank" rel="noopener noreferrer">GitHub <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7 17 17 7M7 7h10v10"/></svg></a>
        </nav>
    </header>
    <main id="main" class="shell" tabindex="-1">
        <section class="hero" aria-labelledby="hero-title">
            <div class="hero-copy">
                <p class="eyebrow">Less switching. More creating.</p>
                <h1 id="hero-title">Your docs.<br><span>Meet your AI.</span></h1>
                <p class="hero-description">Bring your Google Docs into your AI workflow. Find the right document, explore an idea, or make an edit&mdash;without breaking your flow.</p>
                <ul class="capabilities" aria-label="Document capabilities">
                    <li><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>Search</li>
                    <li><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4ZM12 6v15"/></svg>Read</li>
                    <li><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg>Create &amp; edit</li>
                </ul>
                <p class="compatibility">Built on Model Context Protocol (MCP).</p>
            </div>
            <div class="connection-wrap">
                <section class="connection-card" aria-labelledby="connect-title">
                    <div class="card-heading">
                        <span class="connection-mark"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0) scale(.92)"/></svg></span>
                        <div><p class="card-kicker">Your workspace, connected</p><p class="card-subtitle">Google Docs + your AI assistant</p></div>
                    </div>
                    <h2 id="connect-title">Bring your docs along.</h2>
                    <p class="card-description">Connect your Google account to get the configuration for your MCP-compatible assistant.</p>
                    <div class="connection-path" aria-hidden="true">
                        <span class="endpoint"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>Google Docs</span>
                        <span class="bridge"><span>MCP</span></span>
                        <span class="endpoint"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/></svg>Your AI</span>
                    </div>
                    <a href="/auth" class="auth-button">Connect with Google <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></a>
                    <p class="auth-note"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-5"/></svg>You&rsquo;ll continue to Google to review access.</p>
                </section>
            </div>
        </section>
        <section class="setup" id="how-it-works" aria-labelledby="setup-title">
            <div class="setup-heading"><h2 id="setup-title">A simple setup. Then you&rsquo;re in flow.</h2><p>From your account to your first prompt.</p></div>
            <ol class="steps">
                <li><span class="step-number" aria-hidden="true">01</span><div><h3>Connect your account</h3><p>Sign in with Google and review the requested document permissions.</p></div></li>
                <li><span class="step-number" aria-hidden="true">02</span><div><h3>Add your configuration</h3><p>Copy your connection details into your MCP-compatible AI assistant.</p></div></li>
                <li><span class="step-number" aria-hidden="true">03</span><div><h3>Start with a document</h3><p>Ask your assistant to find, read, create, or update your Google Docs.</p></div></li>
            </ol>
        </section>
    </main>
    <footer class="site-footer shell">
        <p>Built by <a href="https://github.com/petergarety" target="_blank" rel="noopener noreferrer">Peter Garety</a>.</p>
        <p>Your documents. A more connected workflow.</p>
    </footer>
</body>
</html>`;
}

export function getSuccessPage(apiKey: string, workerUrl: string): string {
  const mcpConfig = {
    "gdriveCF": {
      "url": `${workerUrl}/mcp`,
      "headers": {
        "Authorization": `Bearer ${apiKey}`
      }
    }
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GDrive MCP - Success!</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
            min-height: 100vh;
            padding: 2rem;
            color: #333;
        }
        
        .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            padding: 3rem;
            max-width: 800px;
            margin: 0 auto;
        }
        
        .success-header {
            text-align: center;
            margin-bottom: 2rem;
        }
        
        .success-icon {
            font-size: 4rem;
            margin-bottom: 1rem;
        }
        
        h1 {
            color: #2d3748;
            margin-bottom: 1rem;
            font-size: 2.25rem;
            font-weight: 700;
        }
        
        .subtitle {
            color: #4a5568;
            margin-bottom: 2rem;
            font-size: 1.125rem;
            line-height: 1.6;
        }
        
        .config-section {
            background: #f7fafc;
            border-radius: 8px;
            padding: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .config-section h3 {
            color: #2d3748;
            margin-bottom: 1rem;
            font-size: 1.25rem;
        }
        
        .code-block {
            background: #2d3748;
            color: #e2e8f0;
            border-radius: 8px;
            padding: 1.5rem;
            margin: 1rem 0;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.875rem;
            line-height: 1.5;
            overflow-x: auto;
            position: relative;
        }
        
        .copy-button {
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: #4a5568;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 0.5rem 1rem;
            font-size: 0.75rem;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .copy-button:hover {
            background: #2d3748;
        }
        
        .copy-button.copied {
            background: #38a169;
        }
        
        .api-key {
            background: #fed7d7;
            border: 1px solid #fc8181;
            border-radius: 8px;
            padding: 1rem;
            margin: 1rem 0;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.875rem;
            word-break: break-all;
        }
        
        .instructions {
            background: #e6fffa;
            border-left: 4px solid #38a169;
            padding: 1rem;
            margin: 1rem 0;
        }
        
        .instructions h4 {
            color: #2d3748;
            margin-bottom: 0.5rem;
        }
        
        .instructions ol {
            color: #4a5568;
            padding-left: 1.5rem;
        }
        
        .instructions li {
            margin-bottom: 0.5rem;
        }
        
        .warning {
            background: #fef5e7;
            border: 1px solid #f6ad55;
            border-radius: 8px;
            padding: 1rem;
            margin: 1rem 0;
            color: #744210;
        }
        
        .warning strong {
            color: #c05621;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-header">
            <div class="success-icon">🎉</div>
            <h1>Congratulations!</h1>
            <p class="subtitle">You have successfully authenticated your Google account. Please copy the configuration below to integrate your MCP with Cursor or Claude.</p>
        </div>
        
        <div class="config-section">
            <h3>Your API Key</h3>
            <div class="api-key">${escapeHtml(apiKey)}</div>
            <div class="warning">
                <strong>Important:</strong> Keep this API key secure! It provides access to your Google Docs.
            </div>
        </div>
        
        <div class="config-section">
            <h3>MCP Configuration for Cursor</h3>
            <p>Add this to your <code>~/.cursor/mcp.json</code> file:</p>
            <div class="code-block">
                <button class="copy-button" onclick="copyToClipboard('mcp-config')">Copy</button>
                <pre id="mcp-config">${escapeHtml(JSON.stringify(mcpConfig, null, 2))}</pre>
            </div>
        </div>
        
        <div class="instructions">
            <h4>Setup Instructions:</h4>
            <ol>
                <li>Open your <code>~/.cursor/mcp.json</code> file (create it if it doesn't exist)</li>
                <li>Copy the configuration above and paste it into the file</li>
                <li>Save the file and restart Cursor</li>
                <li>The Google Docs tools should now be available in Cursor's MCP panel</li>
            </ol>
        </div>
        
        <div class="config-section">
            <h3>Available Tools</h3>
            <ul>
                <li>📄 <strong>List Documents</strong> - Browse your Google Docs</li>
                <li>📖 <strong>Get Document</strong> - Read document content</li>
                <li>✏️ <strong>Update Document</strong> - Edit document content</li>
                <li>🔍 <strong>Search Documents</strong> - Find documents by content</li>
                <li>📝 <strong>Create Document</strong> - Create new documents</li>
                <li>🏷️ <strong>Get Document Headings</strong> - Extract document structure</li>
                <li>📑 <strong>Get Content Under Heading</strong> - Extract specific sections</li>
                <li>➕ <strong>Insert Content Under Heading</strong> - Add content to sections</li>
            </ul>
        </div>
    </div>
    
    <script>
        function copyToClipboard(elementId) {
            const element = document.getElementById(elementId);
            const text = element.textContent;
            
            navigator.clipboard.writeText(text).then(function() {
                const button = element.parentElement.querySelector('.copy-button');
                const originalText = button.textContent;
                button.textContent = 'Copied!';
                button.classList.add('copied');
                
                setTimeout(function() {
                    button.textContent = originalText;
                    button.classList.remove('copied');
                }, 2000);
            });
        }
    </script>
</body>
</html>`;
}
