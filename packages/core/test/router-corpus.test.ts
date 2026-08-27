import { describe, it, expect } from 'vitest';
import { DefaultRuntimeRouter, type RouteInput } from '../src/routing/router.js';
import { defaultConfig } from '../src/config/defaults.js';
import type { CapabilityGraph, CapabilityNode } from '../src/types.js';

/**
 * Router qualification corpus (root CLAUDE.md section 8, 33_ACCEPTANCE_TEST_MATRIX.md).
 * A labeled corpus large enough to reveal obvious overfitting: clear tasks, short/ambiguous
 * tasks, multilingual tasks, domain overlaps, generic-named capabilities with rich tag
 * metadata, near-duplicate capabilities, and out-of-profile intent. For a conservative
 * router, precision among non-abstained decisions matters more than coverage: a wrong
 * routing hint is worse than an abstention.
 */

function node(id: string, type: CapabilityNode['type'], owner: string | null, displayName: string, tags: string[], confidence = 0.9): CapabilityNode {
  return {
    id,
    type,
    ownerPluginId: owner,
    displayName,
    descriptionHash: 'h',
    tags: tags.map((t) => ({ id: t, confidence: 0.85, source: 'metadata' })),
    availability: 'baseline_enabled',
    cost: { source: 'unknown' },
    riskFlags: [],
    metadataParseConfidence: confidence,
    semanticCoverage: tags.length > 0 ? 1 : 0,
    semanticClassificationConfidence: tags.length > 0 ? confidence : 0,
    dependencies: [],
    managed: false,
    protected: false,
    baselineEnabled: true
  };
}

// Clean profile: one unambiguous capability per domain, no near-duplicates. Used for the
// 'clear', 'domain-overlap' and 'generic-name' categories so a tie caused by an unrelated
// fixture never masquerades as a router defect.
const cleanNodes: CapabilityNode[] = [
  node('skill:security-tools@x/audit-auth', 'skill', 'plugin:security-tools@x', 'audit-auth', ['domain:security', 'operation:code-review']),
  node('agent:qa-suite@x/write-tests', 'agent', 'plugin:qa-suite@x', 'write-tests', ['domain:testing']),
  node('skill:db-tools@x/migrate', 'skill', 'plugin:db-tools@x', 'migrate', ['domain:database']),
  node('skill:frontend-kit@x/style-review', 'skill', 'plugin:frontend-kit@x', 'style-review', ['domain:frontend-ui']),
  node('skill:backend-kit@x/api-design', 'skill', 'plugin:backend-kit@x', 'api-design', ['domain:backend-api']),
  node('agent:release-bot@x/ship', 'agent', 'plugin:release-bot@x', 'ship', ['operation:deployment', 'domain:infrastructure']),
  node('skill:docs-writer@x/update-readme', 'skill', 'plugin:docs-writer@x', 'update-readme', ['operation:documentation']),
  // Generic display name; only its tag metadata (as if extracted from a rich description)
  // carries the actual domain signal — precision must come from tags, not the name string.
  node('skill:mobile-kit@x/utility-42', 'skill', 'plugin:mobile-kit@x', 'utility-42', ['domain:mobile'])
];

const cleanGraph: CapabilityGraph = {
  schemaVersion: 1,
  inventoryFingerprint: 'inv-clean',
  generatedAt: new Date().toISOString(),
  nodes: cleanNodes,
  edges: [],
  buildAlgorithmVersion: 'graph-1',
  sourceHashes: {}
};
const cleanRuntimeCapabilityIds = new Set(cleanNodes.map((n) => n.id));

// Duplicate-pair profile: two nodes sharing an identical tag set, so a generic prompt in
// that domain can't confidently pick one over the other on tag coverage alone. Isolated from
// the clean profile so this deliberate ambiguity can't leak into unrelated 'clear' assertions.
const duplicatePairNodes: CapabilityNode[] = [
  node('skill:security-tools@x/audit-auth', 'skill', 'plugin:security-tools@x', 'audit-auth', ['domain:security', 'operation:code-review']),
  node('skill:security-tools@x/audit-permissions', 'skill', 'plugin:security-tools@x', 'audit-permissions', ['domain:security', 'operation:code-review'])
];
const duplicatePairGraph: CapabilityGraph = {
  schemaVersion: 1,
  inventoryFingerprint: 'inv-duplicate-pair',
  generatedAt: new Date().toISOString(),
  nodes: duplicatePairNodes,
  edges: [],
  buildAlgorithmVersion: 'graph-1',
  sourceHashes: {}
};
const duplicatePairRuntimeCapabilityIds = new Set(duplicatePairNodes.map((n) => n.id));

// Out-of-profile profile: the only strong match for the prompt ("compliance-scanner") was
// pruned this session (not runtime-available); one unrelated, weakly-matching capability is
// still available so the router has a real (but clearly worse) in-profile option to compare
// against, exactly like a real pruned session profile would.
const outOfProfileNodes: CapabilityNode[] = [
  node('skill:compliance-suite@x/compliance-scanner', 'skill', 'plugin:compliance-suite@x', 'compliance-scanner', ['domain:security', 'operation:code-review']),
  node('skill:db-tools@x/migrate', 'skill', 'plugin:db-tools@x', 'migrate', ['domain:database'])
];
const outOfProfileGraph: CapabilityGraph = {
  schemaVersion: 1,
  inventoryFingerprint: 'inv-out-of-profile',
  generatedAt: new Date().toISOString(),
  nodes: outOfProfileNodes,
  edges: [],
  buildAlgorithmVersion: 'graph-1',
  sourceHashes: {}
};
// compliance-scanner was pruned this session; only migrate is runtime-available.
const outOfProfileRuntimeCapabilityIds = new Set(['skill:db-tools@x/migrate']);

function baseInput(prompt: string, graph: CapabilityGraph, runtimeCapabilityIds: Set<string>): RouteInput {
  return {
    prompt,
    cwd: '/repo',
    sessionId: 'corpus-session',
    profileId: 'profile_corpus',
    profileValid: true,
    graph,
    runtimeCapabilityIds,
    evidence: { records: [] },
    config: defaultConfig(),
    agentTeamsEnabled: false
  };
}

type Category = 'clear' | 'short-ambiguous' | 'multilingual' | 'domain-overlap' | 'generic-name' | 'near-duplicate' | 'out-of-profile';

interface CorpusCase {
  id: string;
  category: Category;
  prompt: string;
  /** Which simulated installed-capability profile this case is routed against. */
  profile: 'clean' | 'duplicate-pair' | 'out-of-profile';
  /** For 'clear'/'generic-name': the single acceptable inject target. */
  expectInjectOneOf?: string[];
  /** Categories that must never inject (abstain only). */
  mustAbstain?: boolean;
  /** Required reasonCode when mustAbstain is set, if the category has one specific expectation. */
  expectReasonCode?: string;
}

const CORPUS: CorpusCase[] = [
  // --- clear tasks: one unambiguous domain match, no competing capability ---
  { id: 'clear-security-auth', category: 'clear', profile: 'clean', prompt: 'please review the authentication code for security vulnerabilities', expectInjectOneOf: ['skill:security-tools@x/audit-auth'] },
  { id: 'clear-testing', category: 'clear', profile: 'clean', prompt: 'write unit tests for the payment module with good coverage', expectInjectOneOf: ['agent:qa-suite@x/write-tests'] },
  { id: 'clear-database', category: 'clear', profile: 'clean', prompt: 'create a database migration to add a new column to the schema', expectInjectOneOf: ['skill:db-tools@x/migrate'] },
  { id: 'clear-frontend', category: 'clear', profile: 'clean', prompt: 'improve the css styling and component layout of the settings page', expectInjectOneOf: ['skill:frontend-kit@x/style-review'] },
  { id: 'clear-backend', category: 'clear', profile: 'clean', prompt: 'design a rest api endpoint for the backend server', expectInjectOneOf: ['skill:backend-kit@x/api-design'] },
  { id: 'clear-deployment', category: 'clear', profile: 'clean', prompt: 'deploy the release to production infrastructure', expectInjectOneOf: ['agent:release-bot@x/ship'] },
  { id: 'clear-docs', category: 'clear', profile: 'clean', prompt: 'update the readme documentation for this project', expectInjectOneOf: ['skill:docs-writer@x/update-readme'] },

  // --- short / ambiguous: too little signal, must abstain ---
  { id: 'short-fix-it', category: 'short-ambiguous', profile: 'clean', prompt: 'fix it', mustAbstain: true },
  { id: 'short-help', category: 'short-ambiguous', profile: 'clean', prompt: 'help', mustAbstain: true },
  { id: 'short-ok-thanks', category: 'short-ambiguous', profile: 'clean', prompt: 'ok thanks', mustAbstain: true },
  { id: 'short-do-this', category: 'short-ambiguous', profile: 'clean', prompt: 'can you do this for me', mustAbstain: true },

  // --- multilingual: classifier is an English keyword dictionary by design (graph/tags.ts) so
  // non-English prompts correctly abstain rather than mis-classify; this documents the real,
  // current limitation instead of implying multilingual routing support that doesn't exist.
  { id: 'multilingual-tr', category: 'multilingual', profile: 'clean', prompt: 'kimlik dogrulama kodunu guvenlik aciklari icin incele', mustAbstain: true, expectReasonCode: 'LOW_INTENT_CONFIDENCE' },
  { id: 'multilingual-es', category: 'multilingual', profile: 'clean', prompt: 'revisa el codigo de autenticacion en busca de vulnerabilidades de seguridad', mustAbstain: true, expectReasonCode: 'LOW_INTENT_CONFIDENCE' },
  { id: 'multilingual-de', category: 'multilingual', profile: 'clean', prompt: 'bitte überprüfe den authentifizierungscode auf sicherheitsluecken', mustAbstain: true, expectReasonCode: 'LOW_INTENT_CONFIDENCE' },

  // --- domain overlap: prompt legitimately touches more than one domain; a plausible inject
  // (to any node whose tags actually match) or an honest abstain both count as acceptable —
  // asserting one exact winner here would encode a fragile, unverifiable assumption.
  { id: 'overlap-db-security-deploy', category: 'domain-overlap', profile: 'clean', prompt: 'review the database migration script for security issues before we deploy it' },
  { id: 'overlap-frontend-testing', category: 'domain-overlap', profile: 'clean', prompt: 'write tests for the new react component styling' },

  // --- generic capability name, tag-driven decision: the winning node's own name has zero
  // lexical overlap with the prompt, so it can only win on tag coverage, never on name match.
  { id: 'generic-name-mobile', category: 'generic-name', profile: 'clean', prompt: 'add support for ios and android in the mobile app', expectInjectOneOf: ['skill:mobile-kit@x/utility-42'] },

  // --- near-duplicate capabilities: two nodes share an identical tag set, so a generic prompt
  // in that domain must not confidently pick one over the other.
  { id: 'near-dup-generic-security', category: 'near-duplicate', profile: 'duplicate-pair', prompt: 'review this code for security problems', mustAbstain: true, expectReasonCode: 'AMBIGUOUS' },

  // --- out-of-profile: the best lexical/tag match for this prompt was pruned this session
  // (not in runtimeCapabilityIds) — the router must abstain rather than hint at an
  // unavailable capability.
  { id: 'out-of-profile-compliance', category: 'out-of-profile', profile: 'out-of-profile', prompt: 'run a compliance scan and code review for security sign-off', mustAbstain: true, expectReasonCode: 'OUT_OF_PROFILE_INTENT' }
];

function graphFor(profile: CorpusCase['profile']): { graph: CapabilityGraph; runtimeCapabilityIds: Set<string> } {
  if (profile === 'clean') return { graph: cleanGraph, runtimeCapabilityIds: cleanRuntimeCapabilityIds };
  if (profile === 'duplicate-pair') return { graph: duplicatePairGraph, runtimeCapabilityIds: duplicatePairRuntimeCapabilityIds };
  return { graph: outOfProfileGraph, runtimeCapabilityIds: outOfProfileRuntimeCapabilityIds };
}

interface CorpusReport {
  total: number;
  injected: number;
  correctInjections: number;
  incorrectInjections: number;
  abstentions: number;
  outOfProfileAbstentions: number;
  precisionAmongInjected: number;
  coverageRate: number;
}

function runCorpus(): { report: CorpusReport; failures: string[] } {
  const router = new DefaultRuntimeRouter();
  const failures: string[] = [];
  let injected = 0;
  let correctInjections = 0;
  let incorrectInjections = 0;
  let abstentions = 0;
  let outOfProfileAbstentions = 0;

  for (const c of CORPUS) {
    const { graph, runtimeCapabilityIds } = graphFor(c.profile);
    const { decision } = router.route(baseInput(c.prompt, graph, runtimeCapabilityIds));

    if (decision.reasonCode === 'OUT_OF_PROFILE_INTENT') outOfProfileAbstentions += 1;

    if (decision.action === 'inject') {
      injected += 1;
      const acceptable = c.expectInjectOneOf;
      if (c.mustAbstain) {
        incorrectInjections += 1;
        failures.push(`${c.id}: expected abstain, got inject (${decision.capabilityIds.join(',')})`);
      } else if (acceptable && !decision.capabilityIds.some((id) => acceptable.includes(id))) {
        incorrectInjections += 1;
        failures.push(`${c.id}: expected inject one of [${acceptable.join(', ')}], got [${decision.capabilityIds.join(', ')}]`);
      } else {
        correctInjections += 1;
      }
    } else {
      abstentions += 1;
      if (c.expectInjectOneOf && c.category === 'clear') {
        failures.push(`${c.id}: expected inject one of [${c.expectInjectOneOf.join(', ')}], got abstain (${decision.reasonCode})`);
      }
      if (c.expectReasonCode && decision.reasonCode !== c.expectReasonCode) {
        failures.push(`${c.id}: expected abstain reasonCode ${c.expectReasonCode}, got ${decision.reasonCode}`);
      }
    }
  }

  const report: CorpusReport = {
    total: CORPUS.length,
    injected,
    correctInjections,
    incorrectInjections,
    abstentions,
    outOfProfileAbstentions,
    precisionAmongInjected: injected > 0 ? correctInjections / injected : 1,
    coverageRate: injected / CORPUS.length
  };

  return { report, failures };
}

// Release target (root CLAUDE.md section 8): a conservative router must clear very high
// precision among non-abstained decisions. Below this, either fix the router or lower the
// product claim — do not loosen this test to hide a regression.
const MIN_PRECISION_AMONG_INJECTED = 0.95;

describe('Router qualification corpus', () => {
  it(`clears >= ${MIN_PRECISION_AMONG_INJECTED * 100}% precision among injected decisions, zero incorrect injections`, () => {
    const { report, failures } = runCorpus();
    if (failures.length > 0) {
      console.error('Router corpus failures:\n' + failures.join('\n'));
    }
    console.log('Router qualification corpus report:', JSON.stringify(report, null, 2));

    expect(report.incorrectInjections, failures.join('\n')).toBe(0);
    expect(report.precisionAmongInjected).toBeGreaterThanOrEqual(MIN_PRECISION_AMONG_INJECTED);
    expect(report.outOfProfileAbstentions).toBeGreaterThanOrEqual(1);
  });

  it('every clear-category prompt injects its single expected capability', () => {
    const router = new DefaultRuntimeRouter();
    for (const c of CORPUS.filter((x) => x.category === 'clear')) {
      const { graph, runtimeCapabilityIds } = graphFor(c.profile);
      const { decision } = router.route(baseInput(c.prompt, graph, runtimeCapabilityIds));
      expect(decision.action, `${c.id}: ${JSON.stringify(decision)}`).toBe('inject');
      expect(decision.capabilityIds.some((id) => c.expectInjectOneOf!.includes(id)), `${c.id}: got ${decision.capabilityIds}`).toBe(true);
    }
  });

  it('every multilingual prompt abstains (no embeddings/translation — documented limitation, not silent mis-routing)', () => {
    const router = new DefaultRuntimeRouter();
    for (const c of CORPUS.filter((x) => x.category === 'multilingual')) {
      const { graph, runtimeCapabilityIds } = graphFor(c.profile);
      const { decision } = router.route(baseInput(c.prompt, graph, runtimeCapabilityIds));
      expect(decision.action, c.id).toBe('abstain');
    }
  });

  it('the pruned out-of-profile capability is never hinted at', () => {
    const router = new DefaultRuntimeRouter();
    const target = CORPUS.find((c) => c.id === 'out-of-profile-compliance')!;
    const { graph, runtimeCapabilityIds } = graphFor(target.profile);
    const { decision } = router.route(baseInput(target.prompt, graph, runtimeCapabilityIds));
    expect(decision.action).toBe('abstain');
    expect(decision.capabilityIds).toEqual([]);
  });
});
