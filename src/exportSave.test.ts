import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { exportDocument } from './handlers/exportDocument.js';
import { GoogleDocsAPI } from './utils/google-api.js';
import { exportCases } from './export.test-support.js';

let helper: {
  decodeExportResult(input: unknown): { metadata: Record<string, unknown>; bytes: Buffer };
  saveExportResult(input: unknown, directory: string): { path: string; byteLength: number };
  readExportJson(path: string): unknown;
};
const helperPath = resolve('beast-scripts/save-export.mjs');
let directory: string;
beforeAll(async () => { helper = await import(pathToFileURL(helperPath).href); });
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'gdrive-export-save-test-'));
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network access'));
});
afterEach(() => { vi.restoreAllMocks(); rmSync(directory, { recursive: true, force: true }); });
async function fixture(format: 'text' | 'markdown' | 'pdf' | 'docx' = 'pdf') {
  const data = exportCases.find(item => item.format === format)!;
  vi.mocked(fetch).mockResolvedValueOnce(new Response(data.bytes));
  return await exportDocument(new GoogleDocsAPI('test-token'), { documentId: 'export-fixture', format, maxBytes: 100 });
}

describe('offline file delivery helper', () => {
  it.each(exportCases)('saves actual handler $format output byte-for-byte with private file permissions', async ({ format, bytes, extension }) => {
    const result = await fixture(format);
    const saved = helper.saveExportResult(result, directory);
    expect(saved.path).toBe(join(realpathSync(directory), `export-fixture.${extension}`));
    expect(readFileSync(saved.path)).toEqual(Buffer.from(bytes));
    expect(saved.byteLength).toBe(bytes.length);
    if (process.platform !== 'win32') expect(statSync(saved.path).mode & 0o777).toBe(0o600);
    expect(readdirSync(directory)).toEqual([`export-fixture.${extension}`]);
  });
  it('accepts the complete HTTP JSON-RPC envelope', async () => {
    const result = await fixture();
    expect(helper.decodeExportResult({ jsonrpc: '2.0', id: 1, result }).bytes).toEqual(Buffer.from(exportCases[2].bytes));
  });
  it('refuses to overwrite an existing file and cleans its temporary file', async () => {
    const result = await fixture();
    const target = join(directory, 'export-fixture.pdf');
    writeFileSync(target, 'ORIGINAL');
    expect(() => helper.saveExportResult(result, directory)).toThrow();
    expect(readFileSync(target, 'utf8')).toBe('ORIGINAL');
    expect(readdirSync(directory)).toEqual(['export-fixture.pdf']);
  });
  it('refuses to follow an existing destination symlink', async () => {
    const result = await fixture();
    const target = join(directory, 'target');
    writeFileSync(target, 'ORIGINAL');
    symlinkSync(target, join(directory, 'export-fixture.pdf'));
    expect(() => helper.saveExportResult(result, directory)).toThrow();
    expect(readFileSync(target, 'utf8')).toBe('ORIGINAL');
    expect(readdirSync(directory).sort()).toEqual(['export-fixture.pdf', 'target']);
  });
  it.each([
    { label: 'path traversal', changes: { filename: '../escape.pdf' } },
    { label: 'absolute path', changes: { filename: '/tmp/escape.pdf' } },
    { label: 'Windows path', changes: { filename: 'C:\\escape.pdf' } },
    { label: 'trailing LF in ID', changes: { documentId: 'doc\n', filename: 'doc\n.pdf' } },
    { label: 'reserved Windows filename', changes: { documentId: 'CON', filename: 'CON.pdf' } },
    { label: 'wrong MIME', changes: { mimeType: 'text/html' } },
    { label: 'wrong encoding', changes: { encoding: 'utf-8' } },
    { label: 'unknown contract', changes: { schemaVersion: 2 } },
    { label: 'unknown format', changes: { format: 'constructor' } },
    { label: 'byte count mismatch', changes: { byteLength: 0 } },
    { label: 'negative count', changes: { byteLength: -1 } },
    { label: 'too large count', changes: { byteLength: 10485761 } },
    { label: 'checksum mismatch', changes: { sha256: '0'.repeat(64) } },
    { label: 'untrusted URL', changes: { resourceUri: 'https://example.com/doc.pdf' } },
  ])('rejects $label before writing', async ({ changes }) => {
    const result = await fixture();
    const summary = result.content[0];
    if (summary.type !== 'text') throw new Error('Missing summary');
    summary.text = JSON.stringify({ ...JSON.parse(summary.text), ...changes });
    expect(() => helper.saveExportResult(result, directory)).toThrow('Invalid export');
    expect(readdirSync(directory)).toEqual([]);
  });
  it.each(['noncanonical base64', 'changed bytes', 'wrong URI', 'both text and blob', 'missing blob'])('rejects %s', async mode => {
    const result = await fixture();
    const block = result.content[1];
    if (block.type !== 'resource') throw new Error('Missing resource');
    const resource = block.resource as Record<string, unknown>;
    if (mode === 'noncanonical base64') resource.blob = String(resource.blob) + '\n';
    if (mode === 'changed bytes') resource.blob = 'QUFBQUFBQUE=';
    if (mode === 'wrong URI') resource.uri = 'gdrive-export:///wrong';
    if (mode === 'both text and blob') resource.text = '';
    if (mode === 'missing blob') delete resource.blob;
    expect(() => helper.saveExportResult(result, directory)).toThrow('Invalid export');
    expect(readdirSync(directory)).toEqual([]);
  });
  it.each([null, [], { error: {} }, { isError: true }, { content: [] }, { jsonrpc: '2.0', id: 1, error: { code: -32603 } }])('rejects malformed/error envelopes: %j', input => {
    expect(() => helper.saveExportResult(input, directory)).toThrow('Invalid export');
    expect(readdirSync(directory)).toEqual([]);
  });
  it('requires an existing explicit output directory', async () => {
    const result = await fixture();
    expect(() => helper.saveExportResult(result, '')).toThrow('explicit output');
    expect(() => helper.saveExportResult(result, join(directory, 'missing'))).toThrow();
    expect(readdirSync(directory)).toEqual([]);
  });
  it('runs the documented CLI on an SDK result and refuses a second save', async () => {
    const result = await fixture('markdown');
    const input = join(directory, 'response.json');
    writeFileSync(input, JSON.stringify(result));
    const run = () => spawnSync(process.execPath, [helperPath, input, directory], { encoding: 'utf8', timeout: 10000 });
    const first = run();
    expect(first.status).toBe(0);
    expect(first.stderr).toBe('');
    expect(first.stdout).toContain('Saved');
    expect(readFileSync(join(directory, 'export-fixture.md'))).toEqual(Buffer.from(exportCases[0].bytes));
    expect(run().status).toBe(1);
  });
  it('rejects malformed JSON and invalid UTF-8 response files', () => {
    const input = join(directory, 'bad.json');
    writeFileSync(input, '{');
    expect(() => helper.readExportJson(input)).toThrow();
    writeFileSync(input, new Uint8Array([255]));
    expect(() => helper.readExportJson(input)).toThrow();
  });
});
