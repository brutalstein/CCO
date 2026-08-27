#!/usr/bin/env node
// Bundles the cco CLI into one self-contained file so `npm pack` on apps/cli
// produces an artifact installable outside the monorepo. Without this, the
// packed package.json depends on unpublished @cco/* workspace packages and
// npm install fails with 404 (root CLAUDE.md section 4). Same technique as
// scripts/build-plugin.mjs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

async function main() {
  await esbuild.build({
    entryPoints: [path.join(root, 'apps', 'cli', 'src', 'main.ts')],
    outfile: path.join(root, 'apps', 'cli', 'dist', 'bundle.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    legalComments: 'none'
  });
  console.log('built apps/cli/dist/bundle.js');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
