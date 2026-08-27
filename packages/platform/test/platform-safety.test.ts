import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicWriteJson, ensureDir, NodeProcessLauncher, readJsonIfExists } from '../src/index.js';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cco-platform-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('platform safety', () => {
  it('K08: creates owner-restricted state directories/files where supported', async () => {
    const root = await tempDir();
    const dir = path.join(root, 'state');
    const file = path.join(dir, 'config.json');
    await ensureDir(dir);
    await atomicWriteJson(file, { ok: true });
    if (process.platform !== 'win32') {
      expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    }
  });

  it('K03: rejects a symbolic-link state file target', async () => {
    const root = await tempDir();
    const outside = path.join(root, 'outside.json');
    const target = path.join(root, 'state.json');
    await fs.writeFile(outside, '{"secret":true}');
    try {
      await fs.symlink(outside, target, 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    await expect(atomicWriteJson(target, { overwritten: true })).rejects.toThrow(/symbolic-link/);
    expect(await readJsonIfExists(target)).toBeNull();
    expect(await fs.readFile(outside, 'utf8')).toBe('{"secret":true}');
  });

  it('removes signal-forwarding listeners after a child exits', async () => {
    const beforeInt = process.listenerCount('SIGINT');
    const beforeTerm = process.listenerCount('SIGTERM');
    const result = await new NodeProcessLauncher().spawnInteractive({
      command: process.execPath,
      args: ['-e', 'process.exit(7)']
    });
    expect(result.code).toBe(7);
    expect(process.listenerCount('SIGINT')).toBe(beforeInt);
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm);
  });
});
