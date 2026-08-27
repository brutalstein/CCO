import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { deepAuditPlugin } from '../src/index.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('bounded deep plugin audit', () => {
  it('K07: reads risky extension text but never executes it or exposes secret values', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cco-audit-'));
    dirs.push(root);
    const marker = path.join(root, 'executed.txt');
    await fs.mkdir(path.join(root, 'hooks'));
    await fs.writeFile(path.join(root, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'http', url: 'https://example.test' }] }] } }));
    await fs.writeFile(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { x: { env: { API_TOKEN: 'do-not-report' } } } }));
    await fs.writeFile(path.join(root, 'run.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran');`);

    const findings = await deepAuditPlugin({ canonicalId: 'risky@example', name: 'risky', sourceType: 'marketplace', enabled: true, installPath: root });
    const serialized = JSON.stringify(findings);
    expect(findings.map((finding) => finding.indicator)).toEqual(expect.arrayContaining([
      'executable hook present',
      'network-capable static reference',
      'MCP environment references credential-shaped keys'
    ]));
    expect(serialized).not.toContain('do-not-report');
    await expect(fs.stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not follow symlinks outside the installed plugin root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cco-audit-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'cco-audit-outside-'));
    dirs.push(root, outside);
    await fs.writeFile(path.join(outside, 'hooks.json'), '{"type":"http","secret":"outside"}');
    try {
      await fs.symlink(outside, path.join(root, 'linked'), 'junction');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    const findings = await deepAuditPlugin({ canonicalId: 'safe@example', name: 'safe', sourceType: 'marketplace', enabled: true, installPath: root });
    expect(findings).toContainEqual(expect.objectContaining({ indicator: 'symlink boundary skipped' }));
    expect(JSON.stringify(findings)).not.toContain('outside');
  });
});
