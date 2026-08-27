import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClaudeAdapter, minimalFixture, type FakeClaudeFixture, type PluginDetailsSource } from '@cco/claude-adapter';
import { DefaultInventoryService, normalizePluginBaselineState, pluginBaselineStateHash } from '../src/inventory/service.js';
import { JsonStateStore } from '../src/state/store.js';

const detail: PluginDetailsSource = {
  canonicalId: 'a@x',
  description: 'backend API server',
  components: [],
  tokenSource: 'unknown',
  dependencies: [],
  riskFlags: []
};

class MutableAdapter extends FakeClaudeAdapter {
  detailsCalls = 0;
  constructor(readonly mutable: FakeClaudeFixture) {
    super(mutable);
  }

  override async pluginDetails(id: string, ctx: Parameters<FakeClaudeAdapter['pluginDetails']>[1]) {
    this.detailsCalls++;
    return super.pluginDetails(id, ctx);
  }
}

describe('inventory live baseline cache identity', () => {
  const roots: string[] = [];

  afterEach(async () => {
    for (const root of roots) await fs.rm(root, { recursive: true, force: true });
    roots.length = 0;
  });

  async function setup() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cco-inventory-'));
    roots.push(root);
    const fixture = minimalFixture({
      plugins: [{ canonicalId: 'a@x', name: 'a', version: '1.0.0', sourceType: 'marketplace', enabled: true, managed: false }],
      details: { 'a@x': detail }
    });
    const adapter = new MutableAdapter(fixture);
    return { fixture, adapter, store: new JsonStateStore(root) };
  }

  it('canonicalizes ordering without changing state identity', () => {
    const a = { canonicalId: 'a@x', name: 'a', sourceType: 'marketplace', enabled: true };
    const b = { canonicalId: 'b@x', name: 'b', sourceType: 'local', enabled: false, managed: true };
    expect(normalizePluginBaselineState([a, b])).toEqual(normalizePluginBaselineState([b, a]));
    expect(pluginBaselineStateHash([a, b])).toBe(pluginBaselineStateHash([b, a]));
  });

  it.each([
    ['install', (fixture: FakeClaudeFixture) => fixture.plugins.push({ canonicalId: 'b@x', name: 'b', sourceType: 'local', enabled: true })],
    ['uninstall', (fixture: FakeClaudeFixture) => fixture.plugins.splice(0, 1)],
    ['enabled', (fixture: FakeClaudeFixture) => { fixture.plugins[0].enabled = false; }],
    ['version', (fixture: FakeClaudeFixture) => { fixture.plugins[0].version = '2.0.0'; }],
    ['managed', (fixture: FakeClaudeFixture) => { fixture.plugins[0].managed = true; }],
    ['source', (fixture: FakeClaudeFixture) => { fixture.plugins[0].sourceType = 'local'; }],
    ['install path', (fixture: FakeClaudeFixture) => { fixture.plugins[0].installPath = 'C:/different-marketplace/a'; }]
  ])('invalidates cached details after a %s change', async (_name, mutate) => {
    const { fixture, adapter, store } = await setup();
    const service = new DefaultInventoryService(adapter, store);
    const before = await service.loadOrRefresh({ cwd: 'project' });
    mutate(fixture);
    const after = await service.loadOrRefresh({ cwd: 'project' });

    expect(after.id).not.toBe(before.id);
  });

  it('reuses expensive details when normalized live state is unchanged', async () => {
    const { adapter, store } = await setup();
    const service = new DefaultInventoryService(adapter, store);
    const first = await service.loadOrRefresh({ cwd: 'project' });
    const calls = adapter.detailsCalls;
    const second = await service.loadOrRefresh({ cwd: 'project' });

    expect(second.id).toBe(first.id);
    expect(adapter.detailsCalls).toBe(calls);
  });

  it('returns a partial snapshot instead of trusting cache when list probing fails', async () => {
    const { fixture, adapter, store } = await setup();
    const service = new DefaultInventoryService(adapter, store);
    await service.loadOrRefresh({ cwd: 'project' });
    fixture.plugins = [];
    const result = await service.loadOrRefresh({ cwd: 'project' });

    expect(result.partial).toBe(true);
    expect(result.plugins).toEqual([]);
  });

  it('does not trust a legacy cache entry without a baseline state hash', async () => {
    const { adapter, store } = await setup();
    const service = new DefaultInventoryService(adapter, store);
    const currentHash = pluginBaselineStateHash(adapter.mutable.plugins);
    const id = await service.fingerprint({ claudeVersion: adapter.mutable.environment.version, cwd: 'project', baselineStateHash: currentHash });
    await store.putSnapshot('inventory', {
      id,
      schemaVersion: 1,
      capturedAt: '2020-01-01T00:00:00.000Z',
      claude: adapter.mutable.environment,
      plugins: adapter.mutable.plugins,
      pluginDetails: {},
      partial: false,
      missingSources: []
    });

    const result = await service.loadOrRefresh({ cwd: 'project' });
    expect(adapter.detailsCalls).toBe(1);
    expect(result.baselineStateHash).toBe(currentHash);
  });

  it('emits a schema-v2 baseline identity when Claude is unavailable', async () => {
    const { fixture, adapter, store } = await setup();
    fixture.environment = {
      ...fixture.environment,
      found: false,
      resolvedBinaryPath: null,
      version: null,
      versionFamily: 'unsupported',
      errors: ['claude binary not found']
    };

    const result = await new DefaultInventoryService(adapter, store).loadOrRefresh({ cwd: 'project' });

    expect(result.schemaVersion).toBe(2);
    expect(result.baselineStateHash).toBe('unavailable');
    expect(result.partial).toBe(true);
  });
});
