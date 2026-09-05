import { describe, expect, it } from 'vitest';
import { getSuccessPage, getWelcomePage } from './html-templates.js';

describe('html-templates', () => {
  describe('getSuccessPage HTML escaping', () => {
    it('escapes a benign API key as-is', () => {
      const html = getSuccessPage('abc123', 'https://example.com');
      expect(html).toContain('abc123');
      expect(html).toContain('https://example.com/mcp');
    });

    it('escapes < and > in apiKey so a tag cannot be injected', () => {
      const xss = '<script>alert(1)</script>';
      const html = getSuccessPage(xss, 'https://example.com');
      // The raw payload must NOT appear unescaped
      expect(html).not.toContain('<script>alert(1)</script>');
      // The escaped form must appear
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('escapes double quotes in apiKey so attribute breakouts fail', () => {
      const payload = 'a"onmouseover="alert(1)';
      const html = getSuccessPage(payload, 'https://example.com');
      expect(html).not.toContain('a"onmouseover="alert(1)');
      expect(html).toContain('a&quot;onmouseover=&quot;alert(1)');
    });

    it('escapes single quotes in apiKey', () => {
      const payload = "a'b";
      const html = getSuccessPage(payload, 'https://example.com');
      expect(html).not.toContain("a'b");
      expect(html).toContain('a&#39;b');
    });

    it('escapes ampersands so entity injection is neutralised', () => {
      const html = getSuccessPage('a&b', 'https://example.com');
      expect(html).toContain('a&amp;b');
      // Make sure we did not accidentally produce double-escaped entities
      expect(html).not.toContain('a&amp;amp;b');
    });

    it('escapes the JSON-encoded MCP config in the <pre> block', () => {
      // The workerUrl flows into the JSON we render inside a <pre>.
      // Drive an XSS attempt through it and confirm it is escaped.
      const url = 'https://x.com"</pre><script>alert(1)</script>';
      const html = getSuccessPage('safekey', url);
      expect(html).not.toContain('</pre><script>alert(1)</script>');
      expect(html).toContain('&lt;/pre&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });

  describe('getWelcomePage', () => {
    it('returns an HTML document', () => {
      const html = getWelcomePage();
      expect(html).toMatch(/^<!DOCTYPE html>/);
      expect(html).toContain('GDrive MCP');
      expect(html).toContain('href="/auth"');
    });

    it('keeps a single Google connection link on the existing auth route', () => {
      const html = getWelcomePage();
      expect(html.match(/href="\/auth"/g)).toHaveLength(1);
      expect(html).toMatch(/<a href="\/auth" class="auth-button">Connect with Google/);
      expect(html).not.toContain('<form');
    });

    it('provides accessible navigation, page landmarks, and one primary heading', () => {
      const html = getWelcomePage();
      expect(html).toContain('href="#main">Skip to content</a>');
      expect(html).toContain('<main id="main" class="shell" tabindex="-1">');
      expect(html).toContain('aria-label="Main navigation"');
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html).toContain('id="how-it-works"');
      expect(html).toContain('prefers-reduced-motion: reduce');
      expect(html).toContain(':focus-visible');
    });

    it('renders without client-side scripts or remote fonts and styles', () => {
      const html = getWelcomePage();
      expect(html).not.toMatch(/<script\b/i);
      expect(html).not.toMatch(/<link\b[^>]*rel="stylesheet"/i);
      expect(html).not.toMatch(/@import|fonts\.googleapis\.com/i);
      expect(html).toContain('name="viewport"');
    });

    it('protects external links opened in a new tab', () => {
      const links = getWelcomePage().match(/<a\b[^>]*target="_blank"[^>]*>/g) ?? [];
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link).toContain('rel="noopener noreferrer"');
      }
    });
  });
});
