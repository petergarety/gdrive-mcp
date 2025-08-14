/**
 * HTML templates for the GDrive MCP Worker web interface
 */

export function getWelcomePage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GDrive MCP - Authentication</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #333;
        }
        
        .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            padding: 3rem;
            text-align: center;
            max-width: 650px;
            width: 90%;
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
        
        .auth-button {
            background: linear-gradient(135deg, #4285f4 0%, #34a853 100%);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 1rem 2rem;
            font-size: 1.125rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-block;
            box-shadow: 0 4px 15px rgba(66, 133, 244, 0.3);
        }
        
        .auth-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(66, 133, 244, 0.4);
        }
        
        .feature-list {
            margin-top: 2rem;
            text-align: left;
            background: #f7fafc;
            border-radius: 8px;
            padding: 1.5rem;
        }
        
        .feature-list h3 {
            color: #2d3748;
            margin-bottom: 1rem;
            font-size: 1.125rem;
        }
        
        .feature-list ul {
            list-style: none;
            space-y: 0.5rem;
        }
        
        .feature-list li {
            color: #4a5568;
            margin-bottom: 0.5rem;
            padding-left: 1.5rem;
            position: relative;
        }
        
        .feature-list li::before {
            content: "✓";
            color: #34a853;
            font-weight: bold;
            position: absolute;
            left: 0;
        }
        
        .author {
            margin-top: 2rem;
            color: #718096;
            font-size: 0.875rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>GDrive MCP by Peter Garety</h1>
        <p class="subtitle">Please click the button below to authenticate your Google account.</p>
        
        <a href="/auth" class="auth-button">
            🔐 Authenticate with Google
        </a>
        
        <div class="feature-list">
            <h3>What you'll get:</h3>
            <ul>
                <li>Secure access to your Google Docs</li>
                <li>AI-powered document editing via Cursor or Claude</li>
                <li>Read, write, and search capabilities</li>
                <li>Privacy-focused token management</li>
            </ul>
        </div>
        
        <div class="author">
            Developed by <a href="https://github.com/petergarety" target="_blank">Peter Garety</a>.
        </div>
    </div>
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
            <div class="api-key">${apiKey}</div>
            <div class="warning">
                <strong>Important:</strong> Keep this API key secure! It provides access to your Google Docs.
            </div>
        </div>
        
        <div class="config-section">
            <h3>MCP Configuration for Cursor</h3>
            <p>Add this to your <code>~/.cursor/mcp.json</code> file:</p>
            <div class="code-block">
                <button class="copy-button" onclick="copyToClipboard('mcp-config')">Copy</button>
                <pre id="mcp-config">${JSON.stringify(mcpConfig, null, 2)}</pre>
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
