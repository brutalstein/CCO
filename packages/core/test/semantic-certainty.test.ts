import { describe, expect, it } from 'vitest';
import { minimalFixture } from '@cco/claude-adapter';
import { defaultConfig } from '../src/config/defaults.js';
import { DefaultCapabilityGraphBuilder } from '../src/graph/builder.js';
import { DefaultProfileCompiler } from '../src/profile/compiler.js';
import type { InventorySnapshot, RepoFingerprint } from '../src/types.js';

const repo: RepoFingerprint = {
  schemaVersion: 2,
  id: 'repo_backend',
  rootHash: 'root',
  git: { isRepo: true, branch: 'main', dirty: false },
  languages: [{ id: 'rust', weight: 1 }],
  frameworks: ['cargo'],
  domains: ['backend-api'],
  manifests: ['Cargo.toml'],
  workspaceKind: 'single-package',
  partial: false,
  fingerprintInputsHash: 'inputs'
};

function inventory(
  description: string,
  options: { name?: string; alwaysOnTokens?: number; components?: Array<{ type: string; id: string; name: string }> } = {}
): InventorySnapshot {
  const canonicalId = 'superpowers@local';
  return {
    schemaVersion: 2,
    id: 'inventory_semantics',
    capturedAt: '2026-08-27T00:00:00.000Z',
    claude: minimalFixture().environment,
    baselineStateHash: 'baseline_semantics',
    plugins: [{ canonicalId, name: options.name ?? 'superpowers', sourceType: 'marketplace', enabled: true }],
    pluginDetails: {
      [canonicalId]: {
        alwaysOnTokens: options.alwaysOnTokens,
        source: options.alwaysOnTokens === undefined ? 'unknown' : 'anthropic_projected',
        description,
        dependencies: [],
        riskFlags: [],
        components: options.components ?? []
      }
    },
    partial: false,
    missingSources: []
  };
}

function compile(snapshot: InventorySnapshot) {
  const graph = new DefaultCapabilityGraphBuilder().build(snapshot, repo);
  const profile = new DefaultProfileCompiler().compile({
    inventory: snapshot,
    graph,
    repo,
    config: defaultConfig(),
    evidence: { records: [] },
    environment: snapshot.claude,
    mode: 'safe'
  });
  return { graph, profile };
}

describe('semantic certainty across the real graph builder and compiler', () => {
  it('keeps readable metadata whose meaning is outside the taxonomy', () => {
    const { graph, profile } = compile(inventory('An engineering assistant for powerful workflows'));
    const plugin = graph.nodes.find((node) => node.type === 'plugin')!;

    expect(plugin.tags).toEqual([]);
    expect(plugin.metadataParseConfidence).toBeGreaterThan(0.9);
    expect(plugin.semanticCoverage).toBe(0);
    expect(plugin.semanticClassificationConfidence).toBe(0);
    expect(profile.selected.prunedPluginIds).toEqual([]);
    expect(profile.decisions[0]?.reasonCodes).toContain('KEEP_UNCERTAIN');
  });

  it('classifies a generic name from a rich recognized description', () => {
    const { graph } = compile(inventory('Reviews React frontend UI components and CSS'));
    const plugin = graph.nodes.find((node) => node.type === 'plugin')!;

    expect(plugin.tags.map((tag) => tag.id)).toContain('domain:frontend-ui');
    expect(plugin.semanticCoverage).toBe(0.5);
    expect(plugin.semanticClassificationConfidence).toBeGreaterThan(0.8);
  });

  it('may prune a semantically understood frontend plugin in a backend-only repo', () => {
    const { profile } = compile(inventory('React frontend UI and CSS component assistant'));

    expect(profile.selected.prunedPluginIds).toEqual(['superpowers@local']);
  });

  it('does not infer semantic knowledge from a known projected token cost', () => {
    const { profile } = compile(inventory('An engineering assistant for powerful workflows', { alwaysOnTokens: 50_000 }));

    expect(profile.selected.prunedPluginIds).toEqual([]);
    expect(profile.decisions[0]?.reasonCodes).toContain('KEEP_UNCERTAIN');
  });

  it('uses meaningful child component metadata in the plugin semantic envelope', () => {
    const { graph, profile } = compile(
      inventory('An engineering assistant for powerful workflows', {
        components: [{ type: 'skill', id: 'ui-review', name: 'React frontend UI component review' }]
      })
    );
    const child = graph.nodes.find((node) => node.ownerPluginId !== null)!;

    expect(child.tags.map((tag) => tag.id)).toContain('domain:frontend-ui');
    expect(profile.selected.prunedPluginIds).toEqual(['superpowers@local']);
  });

  it('keeps a broad plugin when only a small fraction of child semantics is understood', () => {
    const { profile } = compile(
      inventory('An engineering assistant for powerful workflows', {
        components: [
          { type: 'skill', id: 'ui-review', name: 'React frontend UI component review' },
          { type: 'skill', id: 'novel-one', name: 'quasar orchestration' },
          { type: 'agent', id: 'novel-two', name: 'latent concierge' }
        ]
      })
    );

    expect(profile.selected.prunedPluginIds).toEqual([]);
    expect(profile.decisions[0]?.reasonCodes).toContain('KEEP_UNCERTAIN');
  });

  it('is deterministic for identical semantic inputs', () => {
    const a = compile(inventory('React frontend UI and CSS component assistant'));
    const b = compile(inventory('React frontend UI and CSS component assistant'));

    expect(a.graph).toEqual(b.graph);
    expect(a.profile.id).toBe(b.profile.id);
    expect(a.profile.selected).toEqual(b.profile.selected);
  });
});
