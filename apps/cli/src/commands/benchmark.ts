import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { atomicWriteJson, readJsonIfExists } from '@cco/platform';
import { DefaultBenchmarkRunner, type BenchmarkArm, type BenchmarkRun, type BenchmarkSuite } from '@cco/benchmark';
import { CCO_VERSION, DefaultCapabilityGraphBuilder, DefaultProfileCompiler, DefaultSafetyValidator, type CompiledProfile, type EvidenceRecord, type InventorySnapshot, type OptimizationMode } from '@cco/core';
import type { ClaudeEnvironment } from '@cco/claude-adapter';
import { createContext, printJson } from '../context.js';
import type { ParsedArgs } from '../argv.js';
import { flagBool, flagString } from '../argv.js';

interface LoadedSuite {
  suite: BenchmarkSuite;
  trusted: boolean;
}

interface LocatedRun {
  run: BenchmarkRun;
  dir: string | null;
}

function runsDir(evidenceDir: string, suiteId: string): string {
  return path.join(evidenceDir, suiteId);
}

async function loadSuite(idOrPath: string, cwd: string): Promise<LoadedSuite | null> {
  const builtInRoot = path.resolve(cwd, 'benchmarks', 'suites');
  const candidates = [idOrPath, path.join(builtInRoot, `${idOrPath}.json`)];
  for (const candidate of candidates) {
    const resolved = path.resolve(cwd, candidate);
    const suite = await readJsonIfExists<BenchmarkSuite>(resolved);
    if (!suite) continue;
    const relative = path.relative(builtInRoot, resolved);
    return { suite, trusted: relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) };
  }
  return null;
}

function positiveNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

async function writeArtifactBundle(
  root: string,
  run: BenchmarkRun,
  suite: BenchmarkSuite,
  environment: ClaudeEnvironment,
  inventory: InventorySnapshot,
  profile: CompiledProfile,
  commit: string
): Promise<void> {
  const dir = path.join(root, run.runId);
  await fs.mkdir(path.join(dir, 'checks'), { recursive: true });
  await atomicWriteJson(path.join(dir, 'manifest.json'), {
    schemaVersion: 1,
    suiteId: suite.id,
    runId: run.runId,
    evidenceGrade: run.qualification.grade,
    rawSummary: 'summary.json',
    sourceCommit: commit
  });
  await atomicWriteJson(path.join(dir, 'environment.json'), {
    os: process.platform,
    osRelease: os.release(),
    architecture: process.arch,
    nodeVersion: process.version,
    ccoVersion: CCO_VERSION,
    commit,
    claudeVersion: environment.version,
    model: suite.claude.model ?? 'default',
    toolSearchStatus: environment.toolSearchStatus,
    presentClaudeEnvironmentVariables: Object.keys(process.env).filter((key) => /^(?:CLAUDE|ANTHROPIC)_/i.test(key)).sort(),
    installedPlugins: inventory.plugins.map(({ canonicalId, version, enabled, managed }) => ({ canonicalId, version, enabled, managed: !!managed }))
  });
  await atomicWriteJson(path.join(dir, 'baseline-profile.json'), { type: 'native', settingsFile: null });
  await atomicWriteJson(path.join(dir, 'candidate-profile.json'), profile);
  for (const trial of run.trials) {
    await atomicWriteJson(path.join(dir, 'checks', `${trial.arm}-${trial.trialIndex}.json`), {
      success: trial.success,
      deterministicFailures: trial.deterministicFailures,
      infrastructureFailure: trial.infrastructureFailure
    });
  }
  await atomicWriteJson(path.join(dir, 'summary.json'), run);
  const report = [
    `# Benchmark ${run.runId}`,
    '',
    `- Suite: ${suite.id}`,
    `- Evidence grade: ${run.qualification.grade}`,
    `- Eligible for optimization: ${run.qualification.eligibleForOptimization}`,
    `- Eligible for public claim: ${run.qualification.eligibleForPublicClaim}`,
    `- Pre-registered tolerance: ${run.qualification.preregisteredTolerance}`,
    '',
    run.qualification.grade === 'smoke' ? 'This artifact verifies harness integration only; it is not proof of general non-inferiority.' : 'See summary.json and trials/ for machine-readable evidence.'
  ].join('\n');
  await fs.writeFile(path.join(dir, 'REPORT.md'), report + '\n', { mode: 0o600 });
}

/** `cco benchmark run`: trusted built-ins or explicitly trusted external suites, always isolated. */
async function runSubcommand(parsed: ParsedArgs): Promise<number> {
  const json = flagBool(parsed.flags, 'json');
  const suiteRef = parsed.args[1];
  if (!suiteRef) { console.error('usage: cco benchmark run <suite>'); return 2; }
  const ctx = await createContext(process.cwd(), json);
  const loaded = await loadSuite(suiteRef, ctx.cwd);
  if (!loaded) { console.error(`suite not found: ${suiteRef}`); return 1; }
  const suite = structuredClone(loaded.suite);
  if (!/^[a-z0-9][a-z0-9._-]{0,100}$/i.test(suite.id)) { console.error('suite id contains unsafe path characters'); return 2; }
  if (!loaded.trusted && suite.checks.some((check) => check.type === 'command') && !flagBool(parsed.flags, 'trust-suite')) {
    console.error('external suite contains validator commands; re-run with --trust-suite only after reviewing it');
    return 2;
  }

  const trialsRaw = flagString(parsed.flags, 'trials');
  if (trialsRaw !== undefined) {
    const trials = positiveNumber(trialsRaw);
    if (!trials || !Number.isInteger(trials)) { console.error('--trials must be a positive integer'); return 2; }
    suite.trials = trials;
  }
  const budgetRaw = flagString(parsed.flags, 'max-budget-usd');
  if (budgetRaw !== undefined) {
    const budget = positiveNumber(budgetRaw);
    if (!budget) { console.error('--max-budget-usd must be a positive number'); return 2; }
    suite.claude.maxBudgetUsd = budget;
  }

  const env = await ctx.adapter.probe({ cwd: ctx.cwd });
  const config = await ctx.store.readConfig();
  const candidateMode = (flagString(parsed.flags, 'candidate') ?? 'safe') as OptimizationMode;
  if (!['safe', 'aggressive', 'observe', 'native'].includes(candidateMode)) { console.error('invalid --candidate mode'); return 2; }
  const inventory = await ctx.inventoryService.loadOrRefresh({ cwd: ctx.cwd });
  const repo = await ctx.repoAnalyzer.fingerprint(ctx.cwd);
  const graph = new DefaultCapabilityGraphBuilder().build(inventory, repo);
  const evidence = { records: await ctx.store.listEvidence() };
  const candidateProfile = new DefaultProfileCompiler().compile({ inventory, graph, repo, config, evidence, environment: env, mode: candidateMode });
  const validator = new DefaultSafetyValidator();
  const profileIssues = validator.validateProfile(candidateProfile, inventory);
  if (profileIssues.length > 0) {
    console.error(`candidate profile failed safety validation: ${profileIssues.map((issue) => issue.message).join('; ')}`);
    return 1;
  }

  const overlayPath = path.join(ctx.store.paths.tmpDir, `bench-${crypto.randomBytes(8).toString('hex')}.json`);
  const candidateOverlay = await ctx.adapter.buildSettingsOverlay({ enabledPluginDelta: candidateProfile.overlay.enabledPlugins, env: {} }, overlayPath);
  const overlayIssues = validator.validateOverlay(candidateOverlay, inventory);
  if (overlayIssues.length > 0) {
    console.error(`candidate overlay failed safety validation: ${overlayIssues.map((issue) => issue.message).join('; ')}`);
    return 1;
  }
  await atomicWriteJson(overlayPath, candidateOverlay.json);

  try {
    const arms: BenchmarkArm[] = [
      { label: 'baseline', settingsFile: null },
      { label: 'candidate', settingsFile: overlayPath }
    ];
    const root = runsDir(ctx.store.paths.evidenceDir, suite.id);
    const runner = new DefaultBenchmarkRunner(ctx.adapter, ctx.launcher, env);
    const run = await runner.runSuite(suite, arms, config.optimization.quality.defaultTolerance, {
      minExploratoryTrialsPerArm: config.optimization.quality.minExploratoryTrialsPerArm,
      publicClaimTrialsPerArm: config.optimization.quality.publicClaimTrialsPerArm,
      artifactRoot: config.benchmark.saveRawStreams ? root : undefined
    });
    const commitResult = await ctx.launcher.runCapture({ command: 'git', args: ['rev-parse', 'HEAD'], cwd: ctx.cwd }, 4000).catch(() => null);
    await writeArtifactBundle(root, run, suite, env, inventory, candidateProfile, commitResult?.code === 0 ? commitResult.stdout.trim() : 'unknown');

    if (run.verdict && (run.qualification.eligibleForOptimization || !run.verdict.nonInferior)) {
      const record: EvidenceRecord = {
        schemaVersion: 1,
        id: 'evidence_' + run.runId,
        suiteId: suite.id,
        taskFamily: suite.taskFamily,
        claudeVersionFamily: env.versionFamily,
        model: suite.claude.model ?? 'default',
        baselineProfileHash: 'native',
        candidateProfileHash: candidateProfile.id,
        trials: suite.trials,
        quality: run.verdict,
        cost: Object.fromEntries(run.arms.map((arm) => [arm.arm, arm.usageTotals])),
        createdAt: run.createdAt,
        status: run.qualification.eligibleForOptimization ? 'active' : 'quarantined'
      };
      await ctx.store.putSnapshot('evidence', record);
    }

    if (json) printJson(run, 'benchmark-run');
    else {
      for (const arm of run.arms) console.log(`${arm.arm}: ${arm.trials} trials, success rate ${(arm.successRate * 100).toFixed(0)}%, infra failures ${arm.infrastructureFailures}`);
      console.log(`evidence grade: ${run.qualification.grade}; optimization eligible: ${run.qualification.eligibleForOptimization}`);
      if (run.verdict) console.log(`statistical result: ${run.verdict.nonInferior} (lower bound ${run.verdict.lowerBound.toFixed(3)}, tolerance ${run.verdict.tolerance})`);
    }
    return 0;
  } finally {
    await fs.unlink(overlayPath).catch(() => undefined);
  }
}

async function findRun(evidenceDir: string, runId: string): Promise<LocatedRun | null> {
  const suites = await fs.readdir(evidenceDir, { withFileTypes: true }).catch(() => []);
  for (const suite of suites) {
    if (!suite.isDirectory()) continue;
    const dir = path.join(evidenceDir, suite.name, runId);
    const modern = await readJsonIfExists<BenchmarkRun>(path.join(dir, 'summary.json'));
    if (modern) return { run: modern, dir };
    const legacy = await readJsonIfExists<BenchmarkRun>(path.join(evidenceDir, suite.name, `${runId}.json`));
    if (legacy) return { run: legacy, dir: null };
  }
  return null;
}

/** `cco benchmark` dispatcher. */
export async function cmdBenchmark(parsed: ParsedArgs): Promise<number> {
  const sub = parsed.args[0];
  if (sub === 'run') return runSubcommand(parsed);
  const json = flagBool(parsed.flags, 'json');
  const ctx = await createContext(process.cwd(), json);

  if (sub === 'list') {
    const suites = await fs.readdir(ctx.store.paths.evidenceDir, { withFileTypes: true }).catch(() => []);
    const out: string[] = [];
    for (const suite of suites) {
      if (!suite.isDirectory()) continue;
      const entries = await fs.readdir(path.join(ctx.store.paths.evidenceDir, suite.name), { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.isDirectory()) out.push(`${suite.name}/${entry.name}`);
        else if (entry.name.endsWith('.json')) out.push(`${suite.name}/${entry.name.replace(/\.json$/, '')}`);
      }
    }
    if (json) printJson(out, 'benchmark-list');
    else console.log(out.length ? out.join('\n') : '(no benchmark runs yet)');
    return 0;
  }

  if (sub === 'show') {
    const found = await findRun(ctx.store.paths.evidenceDir, parsed.args[1] ?? '');
    if (!found) { console.error('run not found'); return 1; }
    if (json) printJson(found.run, 'benchmark-show');
    else console.log(JSON.stringify(found.run, null, 2));
    return 0;
  }

  if (sub === 'compare') {
    const a = await findRun(ctx.store.paths.evidenceDir, parsed.args[1] ?? '');
    const b = await findRun(ctx.store.paths.evidenceDir, parsed.args[2] ?? '');
    if (!a || !b) { console.error('one or both runs not found'); return 1; }
    const out = { a: { verdict: a.run.verdict, qualification: a.run.qualification }, b: { verdict: b.run.verdict, qualification: b.run.qualification } };
    if (json) printJson(out, 'benchmark-compare');
    else console.log(JSON.stringify(out, null, 2));
    return 0;
  }

  if (sub === 'export') {
    const found = await findRun(ctx.store.paths.evidenceDir, parsed.args[1] ?? '');
    const out = flagString(parsed.flags, 'out');
    if (!found || !out) { console.error('usage: cco benchmark export <run-id> --out <dir>'); return 2; }
    await fs.mkdir(out, { recursive: true });
    if (found.dir) await fs.cp(found.dir, out, { recursive: true });
    else await atomicWriteJson(path.join(out, 'summary.json'), found.run);
    console.log(`exported to ${out}`);
    return 0;
  }

  console.error('usage: cco benchmark <run|list|show|compare|export>');
  return 2;
}
