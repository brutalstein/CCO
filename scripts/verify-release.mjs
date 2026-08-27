#!/usr/bin/env node
// Verifies dist-release/ artifacts produced by package-release.mjs before a tag is pushed
// (25_INSTALLATION_DISTRIBUTION_RELEASE.md section 7 steps 5/12). This checks structural
// integrity (checksums match, plugin manifest/schemas are well-formed JSON, versions agree
// across apps/cli/package.json and plugin/cco/.claude-plugin/plugin.json) and that the CLI
// tarball actually installs and runs standalone in an isolated directory outside the
// monorepo — a real npm-pack-then-install found a genuine defect (unpublished @cco/*
// workspace deps in package.json) that every prior structural-only check missed. It does
// not run `claude plugin validate --strict` (requires the real Claude CLI) or a live npm
// publish dry run, which stay CI-only steps.
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

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

async function checkTarballInstalls() {
  const files = await fs.readdir(outDir);
  const tarball = files.find((f) => f.endsWith('.tgz'));
  if (!tarball) throw new Error('no .tgz artifact found in dist-release/');
  const tarballPath = path.join(outDir, tarball);

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const useShell = process.platform === 'win32';
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cco-release-verify-'));
  try {
    execFileSync(npmCmd, ['init', '-y'], { cwd: workDir, stdio: 'ignore', shell: useShell });
    execFileSync(npmCmd, ['install', tarballPath], { cwd: workDir, stdio: 'inherit', shell: useShell });
    const binPath = path.join(workDir, 'node_modules', '.bin', process.platform === 'win32' ? 'cco.cmd' : 'cco');
    const helpOutput = execFileSync(binPath, ['--help'], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (!helpOutput.includes('Claude Capability Optimizer')) {
      throw new Error('installed cco --help output did not match expected banner');
    }
    console.log('tarball install: cco --help ran successfully from an isolated install');
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

async function main() {
  await checkVersionsMatch();
  await checkSchemasWellFormed();
  await checkSums();
  await checkTarballInstalls();
  console.log('verify-release: all checks passed');
}

main().catch((err) => {
  console.error(`verify-release failed: ${err.message}`);
  process.exitCode = 1;
});
