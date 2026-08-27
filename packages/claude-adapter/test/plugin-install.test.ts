import { describe, expect, it, vi } from 'vitest';
import type { ProcessLauncher, SpawnSpec } from '@cco/platform';
import { CurrentClaudeAdapter, minimalFixture } from '../src/index.js';

function request() {
  return {
    cwd: process.cwd(),
    env: minimalFixture().environment,
    marketplaceSource: 'brutalstein/cco',
    pluginName: 'cco',
    defaultMarketplaceName: 'cco'
  };
}

describe('official CCO plugin installation flow', () => {
  it('adds the marketplace, installs CCO only, validates strictly, and verifies enablement', async () => {
    let marketplaceAdded = false;
    let installed = false;
    const calls: string[][] = [];
    const launcher: ProcessLauncher = {
      spawnInteractive: vi.fn(),
      async runCapture(spec: SpawnSpec) {
        calls.push(spec.args);
        if (spec.args.join(' ') === 'plugin marketplace list --json') {
          return { code: 0, stdout: JSON.stringify(marketplaceAdded ? [{ name: 'cco', repo: 'brutalstein/cco' }] : []), stderr: '', timedOut: false };
        }
        if (spec.args[0] === 'plugin' && spec.args[1] === 'marketplace' && spec.args[2] === 'add') {
          marketplaceAdded = true;
          return { code: 0, stdout: '', stderr: '', timedOut: false };
        }
        if (spec.args[0] === 'plugin' && spec.args[1] === 'install') {
          installed = true;
          return { code: 0, stdout: '', stderr: '', timedOut: false };
        }
        if (spec.args.join(' ') === 'plugin list --json') {
          return { code: 0, stdout: JSON.stringify(installed ? [{ id: 'cco@cco', name: 'cco', enabled: true, installPath: '/cache/cco' }] : []), stderr: '', timedOut: false };
        }
        if (spec.args[0] === 'plugin' && spec.args[1] === 'validate') {
          return { code: 0, stdout: 'ok', stderr: '', timedOut: false };
        }
        throw new Error(`unexpected command: ${spec.args.join(' ')}`);
      }
    };

    const result = await new CurrentClaudeAdapter(launcher).ensurePluginInstalled(request());
    expect(result).toMatchObject({ ok: true, alreadyInstalled: false, canonicalId: 'cco@cco' });
    expect(calls).toContainEqual(['plugin', 'marketplace', 'add', 'brutalstein/cco']);
    expect(calls).toContainEqual(['plugin', 'install', 'cco@cco', '--scope', 'user', '--yes']);
    expect(calls).toContainEqual(['plugin', 'validate', '/cache/cco', '--strict']);
  });

  it('is idempotent when CCO is already installed', async () => {
    const runCapture = vi.fn(async (spec: SpawnSpec) => {
      if (spec.args.join(' ') === 'plugin list --json') {
        return { code: 0, stdout: JSON.stringify([{ id: 'cco@cco', name: 'cco', enabled: true, installPath: '/cache/cco' }]), stderr: '', timedOut: false };
      }
      if (spec.args.join(' ') === 'plugin validate /cache/cco --strict') return { code: 0, stdout: 'ok', stderr: '', timedOut: false };
      throw new Error(`unexpected mutation: ${spec.args.join(' ')}`);
    });
    const result = await new CurrentClaudeAdapter({ runCapture, spawnInteractive: vi.fn() }).ensurePluginInstalled(request());
    expect(result).toMatchObject({ ok: true, alreadyInstalled: true, canonicalId: 'cco@cco' });
    expect(runCapture).toHaveBeenCalledTimes(2);
  });

  it('enables an existing disabled CCO plugin without touching another plugin', async () => {
    let enabled = false;
    const calls: string[][] = [];
    const runCapture = vi.fn(async (spec: SpawnSpec) => {
      calls.push(spec.args);
      if (spec.args.join(' ') === 'plugin list --json') {
        return {
          code: 0,
          stdout: JSON.stringify([
            { id: 'cco@cco', name: 'cco', enabled, installPath: '/cache/cco' },
            { id: 'other@market', name: 'other', enabled: true }
          ]),
          stderr: '',
          timedOut: false
        };
      }
      if (spec.args.join(' ') === 'plugin enable cco@cco --scope user') {
        enabled = true;
        return { code: 0, stdout: '', stderr: '', timedOut: false };
      }
      if (spec.args.join(' ') === 'plugin validate /cache/cco --strict') return { code: 0, stdout: 'ok', stderr: '', timedOut: false };
      throw new Error(`unexpected command: ${spec.args.join(' ')}`);
    });
    const result = await new CurrentClaudeAdapter({ runCapture, spawnInteractive: vi.fn() }).ensurePluginInstalled(request());
    expect(result).toMatchObject({ ok: true, alreadyInstalled: true, canonicalId: 'cco@cco' });
    expect(calls).toContainEqual(['plugin', 'enable', 'cco@cco', '--scope', 'user']);
    expect(calls.some((args) => args.includes('other@market'))).toBe(false);
  });

  it('surfaces install failures without touching unrelated plugins', async () => {
    const launcher: ProcessLauncher = {
      spawnInteractive: vi.fn(),
      async runCapture(spec: SpawnSpec) {
        if (spec.args.join(' ') === 'plugin list --json' || spec.args.join(' ') === 'plugin marketplace list --json') {
          return { code: 0, stdout: '[]', stderr: '', timedOut: false };
        }
        return { code: 9, stdout: '', stderr: 'managed marketplace policy blocked source', timedOut: false };
      }
    };
    const result = await new CurrentClaudeAdapter(launcher).ensurePluginInstalled(request());
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('managed marketplace policy');
  });
});
