#!/usr/bin/env node
// Packages release artifacts per 25_INSTALLATION_DISTRIBUTION_RELEASE.md section 8:
// cco-<version>.tgz, cco-plugin-<version>.zip, SPDX SBOM, changelog, and SHA256SUMS.
// Live `claude plugin validate --strict` and publication remain explicit external
// gates. Run `npm run build && npm run build:plugin`
// before this script so plugin/cco/bin is up to date; this script builds the CLI's
// own bundle itself since npm pack depends on apps/cli/dist/bundle.js existing
// (apps/cli/package.json ships no @cco/* dependencies — they must be inlined).
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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

function zipPluginDir(version) {
  const zipPath = path.join(outDir, `cco-plugin-${version}.zip`);
  const pluginDir = path.join(root, 'plugin', 'cco');
  if (process.platform === 'win32') {
    // Compress-Archive silently omits hidden `.claude-plugin/`; bsdtar includes it.
    execFileSync('tar.exe', ['-a', '-c', '-f', zipPath, '-C', pluginDir, '.']);
  } else {
    execFileSync('zip', ['-r', zipPath, '.'], { cwd: pluginDir });
  }
  return zipPath;
}

async function main() {
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const pkgJson = JSON.parse(await fs.readFile(path.join(root, 'apps', 'cli', 'package.json'), 'utf8'));
  const version = pkgJson.version;

  console.log('building self-contained CLI bundle');
  runNpm(['run', 'build:cli'], { cwd: root, stdio: 'inherit' });

  console.log(`packaging claude-capability-optimizer ${version}`);
  const packedName = runNpm(['pack', '--pack-destination', outDir, '--json'], {
    cwd: path.join(root, 'apps', 'cli'),
    encoding: 'utf8'
  });
  const packed = JSON.parse(packedName)[0].filename;
  await fs.rename(path.join(outDir, packed), path.join(outDir, `cco-${version}.tgz`));

  console.log(`packaging cco plugin ${version}`);
  zipPluginDir(version);

  console.log('generating SPDX SBOM');
  const sbom = runNpm(['sbom', '--sbom-format', 'spdx', '--package-lock-only'], {
    cwd: root,
    encoding: 'utf8'
  });
  await fs.writeFile(path.join(outDir, 'SBOM.spdx.json'), sbom, 'utf8');

  const changelog = await fs.readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  await fs.writeFile(path.join(outDir, `CHANGELOG-${version}.md`), changelog, 'utf8');

  const sums = [];
  for (const file of await fs.readdir(outDir)) {
    if (!file.endsWith('.tgz') && !file.endsWith('.zip') && file !== 'SBOM.spdx.json' && !file.startsWith('CHANGELOG-')) continue;
    const buf = await fs.readFile(path.join(outDir, file));
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    sums.push(`${hash}  ${file}`);
  }
  await fs.writeFile(path.join(outDir, 'SHA256SUMS'), sums.join('\n') + '\n', 'utf8');
  console.log(`wrote SHA256SUMS for ${sums.length} artifact(s) to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
