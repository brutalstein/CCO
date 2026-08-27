import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { minimalFixture, FakeClaudeAdapter } from '@cco/claude-adapter';
import { JsonStateStore, type InventorySnapshot, type RepoFingerprint } from '@cco/core';
import type { CliContext } from '../src/context.js';
import { stateRootFromArgv } from '../src/context.js';
import { conflictingSettingsArg, isRecursiveClaudeBinary, modelFromClaudeArgs, runLaunch } from '../src/process-launch.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function conflictContext(spawnInteractive = vi.fn(async () => ({ code: 17, signal: null }))): CliContext {
  const fixture = minimalFixture({
    environment: { ...minimalFixture().environment, resolvedBinaryPath: 'claude' }
  });
  return {
    adapter: new FakeClaudeAdapter(fixture),
    launcher: { spawnInteractive, runCapture: vi.fn() },
    store: {} as CliContext['store'],
    inventoryService: {} as CliContext['inventoryService'],
    repoAnalyzer: {} as CliContext['repoAnalyzer'],
    cwd: process.cwd(),
    json: false
  };
}

describe('launch safety', () => {
  it('E09: recognizes both settings argument forms', () => {
    expect(conflictingSettingsArg(['--settings', 'user.json'])).toBe('--settings');
    expect(conflictingSettingsArg(['--settings={"x":1}'])).toBe('--settings={"x":1}');
    expect(conflictingSettingsArg(['--model', 'opus'])).toBeNull();
  });

  it('binds evidence scope to the actual Claude model argument', () => {
    expect(modelFromClaudeArgs(['--model', 'opus'])).toBe('opus');
    expect(modelFromClaudeArgs(['--model=sonnet'])).toBe('sonnet');
    expect(modelFromClaudeArgs([])).toBe('default');
  });

  it('E09: native fallback preserves user Claude arguments exactly', async () => {
    const spawn = vi.fn(async () => ({ code: 17, signal: null }));
    const ctx = conflictContext(spawn);
    const args = ['--model', 'opus', '--settings', 'user settings.json', '--permission-mode', 'manual'];
    const result = await runLaunch(ctx, { mode: 'safe', strict: false, claudeArgs: args });
    expect(result).toMatchObject({ exitCode: 17, usedNativeFallback: true });
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ args }));
  });

  it('E09: strict mode rejects a settings conflict without spawning', async () => {
    const spawn = vi.fn(async () => ({ code: 0, signal: null }));
    const result = await runLaunch(conflictContext(spawn), { mode: 'safe', strict: true, claudeArgs: ['--settings=x'] });
    expect(result.exitCode).toBe(3);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('E10: detects direct CCO recursion targets', () => {
    expect(isRecursiveClaudeBinary('cco')).toBe(true);
    expect(isRecursiveClaudeBinary('C:\\tools\\cco.cmd')).toBe(true);
    expect(isRecursiveClaudeBinary('claude')).toBe(false);
  });

  it('A08: unsupported settings overlays use exact-argument native fallback', async () => {
    const spawn = vi.fn(async () => ({ code: 19, signal: null }));
    const ctx = conflictContext(spawn);
    const fixture = minimalFixture();
    ctx.adapter = new FakeClaudeAdapter({
      ...fixture,
      environment: { ...fixture.environment, features: { ...fixture.environment.features, settingsOverlay: false } }
    });
    const args = ['--model', 'sonnet', '--permission-mode', 'plan'];
    const result = await runLaunch(ctx, { mode: 'safe', strict: false, claudeArgs: args });
    expect(result).toMatchObject({ exitCode: 19, usedNativeFallback: true });
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ args }));
  });

  it('honors the advertised global --state-dir override', () => {
    expect(stateRootFromArgv(['doctor', '--state-dir', './tmp state'], 'C:\\repo')).toBe(path.resolve('C:\\repo', './tmp state'));
    expect(stateRootFromArgv(['doctor', '--state-dir=./tmp'], '/repo')).toBe(path.resolve('/repo', './tmp'));
  });

  it('E01-E06/E08: uses one ephemeral overlay, preserves args/settings, and propagates exit code', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cco-launch-'));
    dirs.push(base);
    const root = path.join(base, 'state ü with spaces');
    const settingsPath = path.join(base, 'claude-settings.json');
    const settingsBytes = '{"permissions":{"allow":["Read"]}}\n';
    await fs.writeFile(settingsPath, settingsBytes);

    const fixture = minimalFixture();
    const inventory: InventorySnapshot = {
      schemaVersion: 2,
      id: 'inv_launch',
      capturedAt: '2026-01-01T00:00:00.000Z',
      claude: fixture.environment,
      baselineStateHash: 'baseline_launch',
      plugins: [],
      pluginDetails: {},
      partial: false,
      missingSources: []
    };
    const repo: RepoFingerprint = {
      schemaVersion: 2,
      id: 'repo_launch',
      rootHash: 'root',
      git: { isRepo: true, branch: 'main', dirty: false },
      languages: [], frameworks: [], domains: [], manifests: [],
      workspaceKind: 'single-package', partial: false, fingerprintInputsHash: 'inputs'
    };
    let overlayPath = '';
    const args = ['--model', 'opus', '--permission-mode', 'plan', '--append-system-prompt', 'ü path'];
    const spawnInteractive = vi.fn(async (spec: { args: string[]; env?: NodeJS.ProcessEnv }) => {
      expect(spec.args.slice(0, args.length)).toEqual(args);
      expect(spec.args.at(-2)).toBe('--settings');
      overlayPath = spec.args.at(-1) as string;
      expect(JSON.parse(await fs.readFile(overlayPath, 'utf8'))).toEqual({});
      expect(spec.env).toMatchObject({ CCO_ACTIVE: '1', CCO_STATE_DIR: path.join(root, 'state') });
      return { code: 23, signal: null };
    });
    const store = new JsonStateStore(root);
    const ctx: CliContext = {
      adapter: new FakeClaudeAdapter(fixture),
      launcher: { spawnInteractive, runCapture: vi.fn() },
      store,
      inventoryService: { loadOrRefresh: vi.fn(async () => inventory) } as unknown as CliContext['inventoryService'],
      repoAnalyzer: { fingerprint: vi.fn(async () => repo) } as unknown as CliContext['repoAnalyzer'],
      cwd: base,
      json: false
    };

    const result = await runLaunch(ctx, { mode: 'safe', strict: true, claudeArgs: args });
    expect(result.exitCode).toBe(23);
    expect(await fs.readFile(settingsPath, 'utf8')).toBe(settingsBytes);
    await expect(fs.stat(overlayPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails open without creating an overlay when compiler inputs are partial', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cco-launch-partial-'));
    dirs.push(base);
    const fixture = minimalFixture();
    const inventory: InventorySnapshot = {
      schemaVersion: 2,
      id: 'inv_partial',
      capturedAt: '2026-08-27T00:00:00.000Z',
      claude: fixture.environment,
      baselineStateHash: 'baseline_partial',
      plugins: [{ canonicalId: 'unknown@x', name: 'unknown', sourceType: 'marketplace', enabled: true }],
      pluginDetails: {},
      partial: true,
      missingSources: ['unknown@x']
    };
    const repo: RepoFingerprint = {
      schemaVersion: 2,
      id: 'repo_partial_launch',
      rootHash: 'root',
      git: { isRepo: false, branch: null, dirty: false },
      languages: [], frameworks: [], domains: [], manifests: [],
      workspaceKind: 'single-package', partial: false, fingerprintInputsHash: 'inputs'
    };
    const spawnInteractive = vi.fn(async () => ({ code: 0, signal: null }));
    const ctx: CliContext = {
      adapter: new FakeClaudeAdapter(fixture),
      launcher: { spawnInteractive, runCapture: vi.fn() },
      store: new JsonStateStore(path.join(base, 'state')),
      inventoryService: { loadOrRefresh: vi.fn(async () => inventory) } as unknown as CliContext['inventoryService'],
      repoAnalyzer: { fingerprint: vi.fn(async () => repo) } as unknown as CliContext['repoAnalyzer'],
      cwd: base,
      json: false
    };

    const result = await runLaunch(ctx, { mode: 'safe', strict: true, claudeArgs: [] });
    expect(result).toMatchObject({ exitCode: 3, usedNativeFallback: true });
    expect(result.reasons).toContain('PARTIAL_INVENTORY');
    expect(spawnInteractive).not.toHaveBeenCalled();
  });
});
