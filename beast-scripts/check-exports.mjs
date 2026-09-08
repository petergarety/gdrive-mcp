// Local-only release evidence. Never deploys, pushes, commits, or accesses live Google files.
// Run from any directory: node beast-scripts/check-exports.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'beast-output/export-check');
const logs = join(root, 'beast-runs/export-check');
for (const path of [output, logs]) mkdirSync(path, { recursive: true });
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: output,
  TMPDIR: process.env.TMPDIR ?? '/tmp', CI: 'true', NO_COLOR: '1', NODE_ENV: 'test' };
const checks = [];
function run(name, executable, args, allowCleanNoIndexDiff = false) {
  const result = spawnSync(executable, args, { cwd: root, env, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(join(logs, `${name}.log`), (result.stdout ?? '') + (result.stderr ?? ''));
  // --no-index implies --exit-code: a clean newly added file can return 1.
  // Accept that only for explicit whitespace checks with no diagnostic output.
  const cleanDiff = allowCleanNoIndexDiff && result.status === 1 && !result.stdout && !result.stderr;
  const passed = (result.status === 0 || cleanDiff) && !result.error && !result.signal;
  checks.push({ name, passed, exitCode: result.status, signal: result.signal, error: result.error?.message });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  return result;
}
run('tests', process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--reporter=json', `--outputFile=${join(output, 'tests.json')}`]);
run('typescript-production', process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit']);
run('typescript-tests', process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.test.json']);
run('lint', process.execPath, [join(root, 'node_modules/eslint/bin/eslint.js'), 'src']);
run('tracked-whitespace', 'git', ['diff', '--check']);
const newFiles = [
  'src/tools/exportDocument.ts', 'src/tools/exportDocument.test.ts', 'src/handlers/exportDocument.ts',
  'src/export.test-support.ts', 'src/exportSave.test.ts', 'src/api/exports.test.ts', 'src/worker/exports.test.ts',
  'beast-scripts/save-export.mjs', 'beast-scripts/check-exports.mjs', 'docs/EXPORTS.md', 'docs/RICH_FORMATTING.md',
];
for (const file of newFiles) run(`whitespace-${file.replaceAll('/', '-')}`, 'git', ['diff', '--no-index', '--check', '/dev/null', file], true);
const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
const files = [...newFiles, 'src/api/exports.ts', 'src/handlers/types.ts', 'src/handlers/index.ts',
  'src/handlers/schemas.ts', 'src/tools/index.ts', 'src/mcp-server.test.ts', 'src/formatting.test-support.ts',
  'src/sectionReplacement.test-support.ts', 'src/api/coreFixes.test.ts', 'src/worker/mcpHttp.test.ts',
  'src/api/extendedOperations.test.ts', 'beast-scripts/check-deployment.mjs', 'README.md', 'docs/ROADMAP.md'];
let tests;
if (checks[0].passed) {
  const results = JSON.parse(readFileSync(join(output, 'tests.json'), 'utf8'));
  tests = { passed: results.numPassedTests, failed: results.numFailedTests, total: results.numTotalTests,
    files: results.testResults.length, success: results.success };
}
const report = { createdAt: new Date().toISOString(), head,
  scope: 'Local formatting/export source checks. No live credentials, Google access, commit/push or deployment performed by this script.',
  checks, tests, fileHashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')])),
  unverified: ['Live exports and multi-tab behavior', 'Production client UI', 'Deployment', 'Approved final release diff'],
};
writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ tests, report: 'beast-output/export-check/report.json' }));
process.exitCode = checks.some(check => !check.passed) ? 1 : 0;
