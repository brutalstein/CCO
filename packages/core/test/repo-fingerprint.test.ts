import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { DefaultRepoAnalyzer, DEFAULT_REPO_SCAN_OPTIONS } from '../src/index.js';
import type { ProcessLauncher } from '@cco/platform';

const dirs: string[] = [];
const nonGit: ProcessLauncher = {
  async runCapture() { return { code: 1, stdout: '', stderr: '', timedOut: false }; },
  async spawnInteractive() { return { code: 0, signal: null }; }
};

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cco-repo-fixture-'));
  dirs.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('repository fingerprint acceptance', () => {
  it('C01/C04: identifies React and preserves monorepo signals', async () => {
    const root = await fixture({
      'package.json': JSON.stringify({ workspaces: ['apps/*'], dependencies: { react: '1.0.0' } }),
      'apps/web/package.json': JSON.stringify({ dependencies: { vite: '1.0.0' } }),
      'apps/web/src/App.tsx': 'export {}'
    });
    const result = await new DefaultRepoAnalyzer(nonGit).fingerprint(root);
    expect(result.frameworks).toEqual(expect.arrayContaining(['npm-workspaces', 'react', 'vite']));
    expect(result.domains).toContain('frontend-ui');
    expect(result.workspaceKind).toBe('monorepo');
  });

  it('C02/C03: distinguishes Rust backend and ROS2/CMake fixtures', async () => {
    const rust = await fixture({ 'Cargo.toml': '[package]\nname="api"', 'src/main.rs': 'fn main() {}' });
    const ros = await fixture({ 'package.xml': '<package/>', 'CMakeLists.txt': 'project(robot)', 'src/node.cpp': '' });
    const analyzer = new DefaultRepoAnalyzer(nonGit);
    const rustResult = await analyzer.fingerprint(rust);
    const rosResult = await analyzer.fingerprint(ros);
    expect(rustResult.frameworks).toContain('cargo');
    expect(rustResult.domains).toContain('backend-api');
    expect(rustResult.domains).not.toContain('frontend-ui');
    expect(rosResult.frameworks).toEqual(expect.arrayContaining(['ros2', 'cmake']));
  });

  it('C05/C06: excludes secret-like and vendor/build inputs', async () => {
    const root = await fixture({
      '.env': 'SECRET=react',
      'vendor/package.json': JSON.stringify({ dependencies: { react: '1.0.0' } }),
      'dist/package.json': JSON.stringify({ dependencies: { next: '1.0.0' } }),
      'src/main.ts': ''
    });
    const result = await new DefaultRepoAnalyzer(nonGit).fingerprint(root);
    expect(result.manifests).toEqual([]);
    expect(result.frameworks).toEqual([]);
  });

  it('C07/C08: marks a capped scan partial and exports no absolute path or source body', async () => {
    const root = await fixture({ 'a.ts': 'secret body', 'b.ts': '', 'c.ts': '' });
    const result = await new DefaultRepoAnalyzer(nonGit).fingerprint(root, { ...DEFAULT_REPO_SCAN_OPTIONS, maxTrackedFiles: 2 });
    const serialized = JSON.stringify(result);
    expect(result.partial).toBe(true);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain('secret body');
  });

  it('detects Terraform from bounded manifest names', async () => {
    const root = await fixture({ 'infra/main.tf': 'resource "x" "y" {}' });
    const result = await new DefaultRepoAnalyzer(nonGit).fingerprint(root);
    expect(result.frameworks).toContain('terraform');
    expect(result.domains).toContain('infrastructure');
  });
});
