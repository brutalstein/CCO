#!/usr/bin/env node
// Reproducible demo of the session profile compiler, built entirely from committed
// fixtures/production code paths (FakeClaudeAdapter + the real DefaultRepoAnalyzer,
// DefaultCapabilityGraphBuilder, DefaultProfileCompiler) - no live Claude call, no
// fabricated numbers. Run: node scripts/demo-savings.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { FakeClaudeAdapter, minimalFixture } from '@cco/claude-adapter';
import { NodeProcessLauncher } from '@cco/platform';
import {
  DefaultInventoryService,
  DefaultRepoAnalyzer,
  DefaultCapabilityGraphBuilder,
  DefaultProfileCompiler,
  defaultConfig,
  JsonStateStore
} from '@cco/core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

async function main() {
  const inventoryFixture = JSON.parse(
    await fs.readFile(path.join(root, 'fixtures', 'plugin-inventories', 'two-plugins.json'), 'utf8')
  );

  const fixture = minimalFixture({
    plugins: inventoryFixture.plugins.map((p) => ({
      canonicalId: p.id,
      name: p.name,
      version: p.version,
      sourceType: p.source,
      enabled: p.enabled,
      managed: p.managed
    })),
    details: {
      'security-tools@example': {
        canonicalId: 'security-tools@example',
        components: [{ type: 'skill', id: 'skill:plugin:security-tools/review-auth', name: 'review-auth' }],
        alwaysOnTokens: 1420,
        tokenSource: 'anthropic_projected',
        dependencies: [],
        riskFlags: []
      },
      'frontend-kit@example': {
        canonicalId: 'frontend-kit@example',
        components: [{ type: 'skill', id: 'skill:plugin:frontend-kit/component-scaffold', name: 'component-scaffold' }],
        alwaysOnTokens: 640,
        tokenSource: 'anthropic_projected',
        dependencies: [],
        riskFlags: []
      }
    }
  });

  const adapter = new FakeClaudeAdapter(fixture);
  const store = new JsonStateStore(path.join(root, '.demo-state'));
  const inventoryService = new DefaultInventoryService(adapter, store);
  const repoAnalyzer = new DefaultRepoAnalyzer(new NodeProcessLauncher());

  const repoPath = path.join(root, 'fixtures', 'repositories', 'typescript-react');
  const env = await adapter.probe({ cwd: repoPath });
  const inventory = await inventoryService.loadOrRefresh({ cwd: repoPath, forceRefresh: true });
  const repo = await repoAnalyzer.fingerprint(repoPath);
  const graph = new DefaultCapabilityGraphBuilder().build(inventory, repo);
  const config = defaultConfig();

  const profile = new DefaultProfileCompiler().compile({
    inventory,
    graph,
    repo,
    intent: undefined,
    config,
    evidence: { records: [] },
    environment: env,
    mode: 'safe'
  });

  const before = profile.costProjection.alwaysOnBefore;
  const after = profile.costProjection.alwaysOnAfter;
  const reduction = before > 0 ? Math.round((1 - after / before) * 100) : 0;

  console.log(`repo: ${repoPath.replace(root, '.')}  (languages: ${repo.languages.map((l) => l.id).join(', ')}; frameworks: ${repo.frameworks.join(', ')})`);
  console.log(`always-on tokens before: ${before}`);
  console.log(`always-on tokens after:  ${after}  (-${reduction}%)`);
  console.log('');
  for (const d of profile.decisions) {
    console.log(`${d.action.toUpperCase().padEnd(6)} ${d.subjectId.padEnd(28)} ${d.reasonCodes.join(',')}  -  ${d.explanation}`);
  }

  await fs.rm(path.join(root, '.demo-state'), { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
