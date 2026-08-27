#!/usr/bin/env node
// Verifies dist-release/ artifacts produced by package-release.mjs before a tag is pushed
// (25_INSTALLATION_DISTRIBUTION_RELEASE.md section 7 steps 5/12). This checks structural
// integrity (checksums match, plugin manifest/schemas are well-formed JSON, versions agree
// across apps/cli/package.json and plugin/cco/.claude-plugin/plugin.json) and that the CLI
// tarball actually installs and runs standalone in an isolated directory outside the
// monorepo — a real npm-pack-then-install found a genuine defect (unpublished @cco/*
// workspace deps in package.json) that every prior structural-only check missed. It does
// not run `claude plugin validate --strict` (requires the real Claude CLI) or a live npm
// publish dry run; those remain explicit environment/owner gates.
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const outDir = path.join(root, 'dist-release');

function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('unable to locate npm-cli.js next to the active Node runtime');
  return found;
}

function runNpm(args, options = {}) {
  return execFileSync(process.execPath, [npmCliPath(), ...args], options);
}

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

function archiveEntries(filePath) {
  const command = filePath.endsWith('.zip') && process.platform !== 'win32'
    ? ['unzip', ['-Z1', filePath]]
    : [process.platform === 'win32' ? 'tar.exe' : 'tar', ['-tf', filePath]];
  return execFileSync(command[0], command[1], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
}

async function checkArtifactContents() {
  const files = await fs.readdir(outDir);
  const pluginZip = files.find((file) => file.endsWith('.zip'));
  const cliTarball = files.find((file) => file.endsWith('.tgz'));
  if (!pluginZip || !cliTarball) throw new Error('CLI tarball or plugin ZIP missing');

  const pluginEntries = archiveEntries(path.join(outDir, pluginZip)).map((entry) => entry.replace(/^\.\//, ''));
  for (const required of ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'bin/cco-hook.mjs']) {
    if (!pluginEntries.some((entry) => entry === required)) throw new Error(`plugin ZIP missing ${required}`);
  }
  if (pluginEntries.some((entry) => /(^|\/)(?:node_modules|test|fixtures)(\/|$)|\.env|\.map$/i.test(entry))) {
    throw new Error('plugin ZIP contains developer-only or sensitive junk');
  }

  const cliEntries = archiveEntries(path.join(outDir, cliTarball));
  if (!cliEntries.includes('package/dist/bundle.js') || !cliEntries.includes('package/package.json')) {
    throw new Error('CLI tarball is missing executable bundle or package metadata');
  }
  if (cliEntries.some((entry) => /(?:^|\/)(?:src|test|fixtures)(?:\/|$)|\.map$/i.test(entry))) {
    throw new Error('CLI tarball contains developer-only source/test content');
  }
  console.log(`artifact contents: ${cliEntries.length} CLI entries, ${pluginEntries.length} plugin entries verified`);
}

async function checkSbom() {
  const sbom = await readJson(path.join(outDir, 'SBOM.spdx.json'));
  if (sbom.spdxVersion !== 'SPDX-2.3' || !Array.isArray(sbom.packages) || sbom.packages.length === 0) {
    throw new Error('SPDX SBOM is malformed or empty');
  }
  console.log(`SBOM: ${sbom.packages.length} package(s) recorded`);
}

async function checkTarballInstalls() {
  const files = await fs.readdir(outDir);
  const tarball = files.find((f) => f.endsWith('.tgz'));
  if (!tarball) throw new Error('no .tgz artifact found in dist-release/');
  const tarballPath = path.join(outDir, tarball);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cco-release-verify-'));
  try {
    runNpm(['init', '-y'], { cwd: workDir, stdio: 'ignore' });
    runNpm(['install', tarballPath], { cwd: workDir, stdio: 'inherit' });
    const installedPackage = await readJson(path.join(workDir, 'node_modules', 'claude-capability-optimizer', 'package.json'));
    if (installedPackage.bin?.cco !== 'dist/bundle.js') throw new Error('installed package does not expose cco -> dist/bundle.js');
    const binPath = path.join(workDir, 'node_modules', 'claude-capability-optimizer', 'dist', 'bundle.js');
    const helpOutput = execFileSync(process.execPath, [binPath, '--help'], { encoding: 'utf8' });
    if (!helpOutput.includes('Claude Capability Optimizer')) {
      throw new Error('installed cco --help output did not match expected banner');
    }
    for (const command of ['doctor', 'inventory', 'analyze', 'audit']) {
      const result = spawnSync(process.execPath, [binPath, command, '--json', '--state-dir', path.join(workDir, 'cco state')], {
        cwd: workDir,
        encoding: 'utf8'
      });
      if (command === 'doctor' ? ![0, 1].includes(result.status ?? -1) : result.status !== 0) {
        throw new Error(`installed cco ${command} exited ${result.status}: ${result.stderr}`);
      }
      const envelope = JSON.parse(result.stdout);
      if (envelope.command !== command) throw new Error(`installed cco ${command} returned an invalid JSON envelope`);
    }
    console.log('tarball install: help/doctor/inventory/analyze/audit ran from an isolated install');
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

async function main() {
  await checkVersionsMatch();
  await checkSchemasWellFormed();
  await checkArtifactContents();
  await checkSbom();
  await checkSums();
  await checkTarballInstalls();
  console.log('verify-release: all checks passed');
}

main().catch((err) => {
  console.error(`verify-release failed: ${err.message}`);
  process.exitCode = 1;
});
