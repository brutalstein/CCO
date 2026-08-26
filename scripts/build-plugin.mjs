#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

async function main() {
  await esbuild.build({
    entryPoints: [path.join(root, 'scripts', 'plugin-hook-entry.mjs')],
    outfile: path.join(root, 'plugin', 'cco', 'bin', 'cco-hook.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    legalComments: 'none'
  });
  console.log('built plugin/cco/bin/cco-hook.mjs');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
