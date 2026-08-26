#!/usr/bin/env node
// Packages release artifacts per 25_INSTALLATION_DISTRIBUTION_RELEASE.md section 8:
// cco-<version>.tgz, cco-plugin-<version>.zip, SHA256SUMS. SBOM generation and the
// live `claude plugin validate --strict` / npm publish steps are left to CI, which
// has the tooling (cyclonedx, the Claude CLI, npm registry credentials) this local
// script does not assume is present. Run `npm run build && npm run build:plugin`
// before this script so apps/cli/dist and plugin/cco/bin are up to date.
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const outDir = path.join(root, 'dist-release');

function zipPluginDir(version) {
  const zipPath = path.join(outDir, `cco-plugin-${version}.zip`);
  const pluginDir = path.join(root, 'plugin', 'cco');
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${pluginDir}\*' -DestinationPath '${zipPath}' -Force`
    ]);
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

  console.log(`packaging claude-capability-optimizer ${version}`);
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npmCmd, ['pack', '--pack-destination', outDir], {
    cwd: path.join(root, 'apps', 'cli'),
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  console.log(`packaging cco plugin ${version}`);
  zipPluginDir(version);

  const sums = [];
  for (const file of await fs.readdir(outDir)) {
    if (!file.endsWith('.tgz') && !file.endsWith('.zip')) continue;
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
