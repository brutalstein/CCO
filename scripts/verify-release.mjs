#!/usr/bin/env node
// Verifies dist-release/ artifacts produced by package-release.mjs before a tag is pushed
// (25_INSTALLATION_DISTRIBUTION_RELEASE.md section 7 steps 5/12). This checks structural
// integrity (checksums match, plugin manifest/schemas are well-formed JSON, versions agree
// across apps/cli/package.json and plugin/cco/.claude-plugin/plugin.json); it does not run
// `claude plugin validate --strict` (requires the real Claude CLI) or a live npm publish
// dry run, which stay CI-only steps.
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const outDir = path.join(root, 'dist-release');

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function checkSums() {
  const sumsFile = path.join(outDir, 'SHA256SUMS');
  const content = await fs.readFile(sumsFile, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  if (lines.length === 0) throw new Error('SHA256SUMS is empty');
  for (const line of lines) {
    const [expected, file] = line.split(/\s+/);
    const buf = await fs.readFile(path.join(outDir, file));
    const actual = crypto.createHash('sha256').update(buf).digest('hex');
    if (actual !== expected) throw new Error(`checksum mismatch for ${file}: expected ${expected}, got ${actual}`);
  }
  console.log(`SHA256SUMS: ${lines.length} artifact(s) verified`);
}

async function checkVersionsMatch() {
  const cliPkg = await readJson(path.join(root, 'apps', 'cli', 'package.json'));
  const pluginManifest = await readJson(path.join(root, 'plugin', 'cco', '.claude-plugin', 'plugin.json'));
  if (cliPkg.version !== pluginManifest.version) {
    throw new Error(`version mismatch: apps/cli@${cliPkg.version} vs plugin manifest@${pluginManifest.version}`);
  }
  console.log(`CLI/plugin versions match: ${cliPkg.version}`);
}

async function checkSchemasWellFormed() {
  const schemasDir = path.join(root, 'schemas');
  const files = await fs.readdir(schemasDir);
  for (const file of files) {
    await readJson(path.join(schemasDir, file));
  }
  console.log(`schemas/: ${files.length} file(s) parsed as valid JSON`);
}

async function main() {
  await checkVersionsMatch();
  await checkSchemasWellFormed();
  await checkSums();
  console.log('verify-release: all checks passed');
}

main().catch((err) => {
  console.error(`verify-release failed: ${err.message}`);
  process.exitCode = 1;
});
