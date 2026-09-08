// Offline export client: no credentials, network calls, or execution of document content.
// Usage: node beast-scripts/save-export.mjs RESPONSE.json EXISTING_OUTPUT_DIRECTORY
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fstatSync, fsyncSync, linkSync, openSync, readSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024 * 1024; // Allows worst-case JSON escaping of text.
const formats = {
  markdown: ['md', 'text/markdown', 'utf-8'],
  text: ['txt', 'text/plain', 'utf-8'],
  pdf: ['pdf', 'application/pdf', 'base64'],
  docx: ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'base64'],
};
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireThat(condition, message) {
  if (!condition) throw new Error(`Invalid export: ${message}`);
}

/** Accept the complete tools/call result, or its successful JSON-RPC envelope. */
export function decodeExportResult(input) {
  requireThat(record(input), 'expected an object');
  requireThat(!Object.hasOwn(input, 'error'), 'error response');
  const result = Object.hasOwn(input, 'jsonrpc') ? input.result : input;
  if (Object.hasOwn(input, 'jsonrpc')) requireThat(input.jsonrpc === '2.0', 'unsupported JSON-RPC version');
  requireThat(record(result) && (result.isError === undefined || result.isError === false), 'failed tool result');
  requireThat(Array.isArray(result.content) && result.content.length === 2, 'expected metadata and exactly one resource');
  const [summary, block] = result.content;
  requireThat(summary?.type === 'text' && typeof summary.text === 'string', 'missing metadata');
  requireThat(summary.text.length <= 16384, 'metadata too large');
  let metadata;
  try { metadata = JSON.parse(summary.text); } catch { throw new Error('Invalid export: malformed metadata JSON'); }
  requireThat(record(metadata) && metadata.schemaVersion === 1 && metadata.delivery === 'embedded-resource', 'unknown contract');
  requireThat(typeof metadata.format === 'string' && Object.hasOwn(formats, metadata.format), 'unsupported format');
  const [extension, mimeType, encoding] = formats[metadata.format];
  requireThat(typeof metadata.documentId === 'string' && /^[a-zA-Z0-9_-]+(?![\s\S])/.test(metadata.documentId), 'invalid document ID');
  requireThat(metadata.filename === `${metadata.documentId}.${extension}`, 'unsafe or mismatched filename');
  // Windows device basenames are unsafe even with an extension.
  requireThat(!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(metadata.documentId), 'reserved filename');
  requireThat(metadata.mimeType === mimeType && metadata.encoding === encoding, 'format/MIME/encoding mismatch');
  requireThat(Number.isSafeInteger(metadata.byteLength) && metadata.byteLength >= 0 && metadata.byteLength <= MAX_BYTES, 'invalid byte length');
  requireThat(typeof metadata.sha256 === 'string' && /^[a-f0-9]{64}(?![\s\S])/.test(metadata.sha256), 'invalid checksum');
  const resource = block?.resource;
  requireThat(block?.type === 'resource' && record(resource), 'missing embedded resource');
  requireThat(typeof metadata.resourceUri === 'string' && metadata.resourceUri.startsWith('gdrive-export:///'), 'invalid resource URI');
  const snapshot = metadata.resourceUri.slice('gdrive-export:///'.length);
  const separator = snapshot.indexOf('/');
  requireThat(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/.test(snapshot.slice(0, separator)) && snapshot.slice(separator + 1) === metadata.filename, 'invalid snapshot identifier');
  requireThat(resource.uri === metadata.resourceUri && resource.mimeType === mimeType, 'resource metadata mismatch');
  let bytes;
  if (encoding === 'utf-8') {
    requireThat(typeof resource.text === 'string' && !Object.hasOwn(resource, 'blob'), 'expected text only');
    requireThat(resource.text.length <= MAX_BYTES, 'text too large');
    bytes = Buffer.from(resource.text, 'utf8');
    requireThat(bytes.toString('utf8') === resource.text, 'invalid Unicode');
  } else {
    requireThat(typeof resource.blob === 'string' && !Object.hasOwn(resource, 'text'), 'expected blob only');
    requireThat(resource.blob.length <= 4 * Math.ceil(MAX_BYTES / 3), 'blob too large');
    bytes = Buffer.from(resource.blob, 'base64');
    requireThat(bytes.toString('base64') === resource.blob, 'non-canonical base64');
  }
  requireThat(bytes.length === metadata.byteLength, 'byte length mismatch');
  requireThat(createHash('sha256').update(bytes).digest('hex') === metadata.sha256, 'checksum mismatch');
  return { metadata, bytes };
}

/** Validate first, write privately, then atomically publish without overwriting. */
export function saveExportResult(input, outputDirectory) {
  const { metadata, bytes } = decodeExportResult(input);
  if (typeof outputDirectory !== 'string' || !outputDirectory) throw new Error('An explicit output directory is required');
  const directory = realpathSync(outputDirectory);
  if (!statSync(directory).isDirectory()) throw new Error('Output path is not a directory');
  const target = join(directory, metadata.filename);
  const temporary = join(directory, `.gdrive-export-${randomUUID()}.tmp`);
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    // A hard link fails if target exists, including a dangling symlink. No overwrite fallback.
    linkSync(temporary, target);
  } finally {
    unlinkSync(temporary);
  }
  return { path: target, byteLength: bytes.length, sha256: metadata.sha256 };
}

export function readExportJson(path) {
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_JSON_BYTES) throw new Error('Response must be a regular JSON file of at most 64 MiB');
    const chunks = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(65536, MAX_JSON_BYTES + 1 - total));
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (!count) break;
      total += count;
      if (total > MAX_JSON_BYTES) throw new Error('Response exceeds 64 MiB');
      chunks.push(chunk.subarray(0, count));
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { closeSync(fd); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node beast-scripts/save-export.mjs RESPONSE.json EXISTING_OUTPUT_DIRECTORY');
    const saved = saveExportResult(readExportJson(process.argv[2]), process.argv[3]);
    console.log(`Saved ${saved.path} (${saved.byteLength} bytes; SHA-256 ${saved.sha256})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Export save failed');
    process.exitCode = 1;
  }
}
