import { describe, it, expect } from 'vitest';
import { DefaultCapabilityGraphBuilder } from '../src/graph/builder.js';
import { DefaultProfileCompiler } from '../src/profile/compiler.js';
import { defaultConfig } from '../src/config/defaults.js';
import type { InventorySnapshot, RepoFingerprint } from '../src/types.js';
import { minimalFixture } from '@cco/claude-adapter';

// Regression test for a real bug: the auto-extracted domain tag (graph/tags.ts)
// must match the domain tag derived from RepoFingerprint.domains (graph/builder.ts,
// profile/compiler.ts, routing/scoring.ts all compute `domain:${d}`), or repo-affinity
// KEEP decisions never fire for plugins that rely on keyword-based tagging instead of
// explicit tags.
describe('repo-affinity via auto-extracted tags', () => {
  it('B06: builds byte-equivalent graphs regardless of inventory ordering', () => {
    const inventory: InventorySnapshot = {
      schemaVersion: 2,
      id: 'inv_deterministic',
      capturedAt: '2026-01-01T00:00:00.000Z',
      claude: minimalFixture().environment,
      baselineStateHash: 'baseline_deterministic',
      plugins: [
        { canonicalId: 'zeta@x', name: 'zeta', sourceType: 'marketplace', enabled: true },
        { canonicalId: 'alpha@x', name: 'alpha', sourceType: 'marketplace', enabled: true }
      ],
      pluginDetails: {},
      partial: false,
      missingSources: []
    };
    const builder = new DefaultCapabilityGraphBuilder();
    const reversed = { ...inventory, plugins: inventory.plugins.slice().reverse() };
    expect(builder.build(inventory)).toEqual(builder.build(reversed));
  });

  it('keeps a plugin whose auto-extracted domain tag matches the repo fingerprint domain', () => {
    const inventory: InventorySnapshot = {
      schemaVersion: 2,
      id: 'inv_affinity',
      capturedAt: new Date().toISOString(),
      claude: minimalFixture().environment,
      baselineStateHash: 'baseline_affinity',
      plugins: [
        { canonicalId: 'frontend-kit@x', name: 'frontend-kit', sourceType: 'marketplace', enabled: true },
        { canonicalId: 'security-tools@x', name: 'security-tools', sourceType: 'marketplace', enabled: true }
      ],
      pluginDetails: {
        'frontend-kit@x': {
          canonicalId: 'frontend-kit@x',
          components: [],
          alwaysOnTokens: 640,
          tokenSource: 'anthropic_projected',
          dependencies: [],
          riskFlags: []
        },
        'security-tools@x': {
          canonicalId: 'security-tools@x',
          components: [],
          alwaysOnTokens: 1420,
          tokenSource: 'anthropic_projected',
          dependencies: [],
          riskFlags: []
        }
      },
      partial: false,
      missingSources: []
    };

    const repo: RepoFingerprint = {
      schemaVersion: 2,
      id: 'repo_affinity',
      rootHash: 'r',
      git: { isRepo: true, branch: 'main', dirty: false },
      languages: [{ id: 'typescript', weight: 1 }],
      frameworks: ['react'],
      domains: ['frontend-ui'],
      manifests: ['package.json'],
      workspaceKind: 'single-package',
      partial: false,
      fingerprintInputsHash: 'x'
    };

    const graph = new DefaultCapabilityGraphBuilder().build(inventory, repo);
    const profile = new DefaultProfileCompiler().compile({
      inventory,
      graph,
      repo,
      config: defaultConfig(),
      evidence: { records: [] },
      environment: minimalFixture().environment,
      mode: 'safe'
    });

    expect(profile.selected.enabledPluginIds).toContain('frontend-kit@x');
    const kept = profile.decisions.find((d) => d.subjectId === 'frontend-kit@x');
    expect(kept?.reasonCodes).toContain('KEEP_HIGH_REPO_AFFINITY');

    expect(profile.selected.prunedPluginIds).toContain('security-tools@x');
  });
});
