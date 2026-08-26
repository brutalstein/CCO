import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';

/**
 * Disposable per-trial workspace (20_BENCHMARK_HARNESS.md section 3). Every trial gets a
 * fresh copy so baseline and candidate never share or sequentially mutate one working tree.
 */
export async function createIsolatedCopy(fixturePath: string): Promise<string> {
  const dest = path.join(os.tmpdir(), 'cco-bench-' + crypto.randomBytes(8).toString('hex'));
  await fs.cp(fixturePath, dest, { recursive: true });
  return dest;
}

export async function cleanupIsolatedCopy(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}
