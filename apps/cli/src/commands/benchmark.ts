import path from 'node:path';
import { promises as fs } from 'node:fs';
import { atomicWriteJson, readJsonIfExists } from '@cco/platform';
import { DefaultBenchmarkRunner, type BenchmarkArm, type BenchmarkRun, type BenchmarkSuite } from '@cco/benchmark';
import { DefaultCapabilityGraphBuilder, DefaultProfileCompiler, type EvidenceRecord, type OptimizationMode } from '@cco/core';
import { createContext, printJson } from '../context.js';
import type { ParsedArgs } from '../argv.js';
import { flagBool, flagString } from '../argv.js';

function runsDir(evidenceDir: string, suiteId: string): string {
  return path.join(evidenceDir, suiteId);
}

async function loadSuite(idOrPath: string, cwd: string): Promise<BenchmarkSuite | null> {
  const candidates = [idOrPath, path.join(cwd, 'benchmarks', 'suites', `${idOrPath}.json`)];
  for (const c of candidates) {
    const suite = await readJsonIfExists<BenchmarkSuite>(c);
    if (suite) return suite;
  }
  return null;
}

/** `cco benchmark run` (13_CLI_SPEC.md section 11, 20_BENCHMARK_HARNESS.md). Isolated worktree/copy trials only. */
async function runSubcommand(parsed: ParsedArgs): Promise<number> {
  const json = flagBool(parsed.flags, 'json');
  const suiteRef = parsed.args[1];
  if (!suiteRef) { console.error('usage: cco benchmark run <suite>'); return 2; }
  const ctx = await createContext(process.cwd(), json);

  const suite = await loadSuite(suiteRef, ctx.cwd);
  if (!suite) { console.error(`suite not found: ${suiteRef}`); return 1; }

  const trials = flagString(parsed.flags, 'trials');
  if (trials) suite.trials = Number(trials);

  const env = await ctx.adapter.probe({ cwd: ctx.cwd });
  const config = await ctx.store.readConfig();
  const candidateMode = (flagString(parsed.flags, 'candidate') ?? 'safe') as OptimizationMode;

  const inventory = await ctx.inventoryService.loadOrRefresh({ cwd: ctx.cwd });
  const repo = await ctx.repoAnalyzer.fingerprint(ctx.cwd);
  const graph = new DefaultCapabilityGraphBuilder().build(inventory, repo);
  const candidateProfile = new DefaultProfileCompiler().compile({ inventory, graph, repo, config, evidence: { records: [] }, environment: env, mode: candidateMode });

  const candidateOverlay = await ctx.adapter.buildSettingsOverlay({ enabledPluginDelta: candidateProfile.overlay.enabledPlugins, env: {} }, path.join(ctx.store.paths.tmpDir, `bench-${suite.id}.json`));
  await atomicWriteJson(candidateOverlay.filePath as string, candidateOverlay.json);

  const arms: BenchmarkArm[] = [
    { label: 'baseline', settingsFile: null },
    { label: 'candidate', settingsFile: candidateOverlay.filePath }
  ];

  const runner = new DefaultBenchmarkRunner(ctx.adapter, ctx.launcher, env);
  const run = await runner.runSuite(suite, arms, config.optimization.quality.defaultTolerance);

  await fs.mkdir(runsDir(ctx.store.paths.evidenceDir, suite.id), { recursive: true });
  await atomicWriteJson(path.join(runsDir(ctx.store.paths.evidenceDir, suite.id), `${run.runId}.json`), run);

  if (run.verdict) {
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
      cost: {},
      createdAt: run.createdAt,
      status: run.verdict.nonInferior ? 'active' : 'quarantined'
    };
    await ctx.store.putSnapshot('evidence', record);
  }

  if (json) printJson(run, 'benchmark-run');
  else {
    for (const arm of run.arms) console.log(`${arm.arm}: ${arm.trials} trials, success rate ${(arm.successRate * 100).toFixed(0)}%, infra failures ${arm.infrastructureFailures}`);
    if (run.verdict) console.log(`non-inferior: ${run.verdict.nonInferior} (lower bound ${run.verdict.lowerBound.toFixed(3)}, tolerance ${run.verdict.tolerance})`);
  }
  return 0;
}

async function findRun(evidenceDir: string, runId: string): Promise<BenchmarkRun | null> {
  const suites = await fs.readdir(evidenceDir).catch(() => [] as string[]);
  for (const suiteId of suites) {
    const run = await readJsonIfExists<BenchmarkRun>(path.join(evidenceDir, suiteId, `${runId}.json`));
    if (run) return run;
  }
  return null;
}

/** `cco benchmark` dispatcher (13_CLI_SPEC.md section 11). */
export async function cmdBenchmark(parsed: ParsedArgs): Promise<number> {
  const sub = parsed.args[0];
  if (sub === 'run') return runSubcommand(parsed);

  const json = flagBool(parsed.flags, 'json');
  const ctx = await createContext(process.cwd(), json);

  if (sub === 'list') {
    const suites = await fs.readdir(ctx.store.paths.evidenceDir).catch(() => [] as string[]);
    const out: string[] = [];
    for (const suiteId of suites) {
      const runs = await fs.readdir(path.join(ctx.store.paths.evidenceDir, suiteId)).catch(() => [] as string[]);
      for (const r of runs) out.push(`${suiteId}/${r.replace(/\.json$/, '')}`);
    }
    if (json) printJson(out, 'benchmark-list');
    else console.log(out.length ? out.join('\n') : '(no benchmark runs yet)');
    return 0;
  }

  if (sub === 'show') {
    const run = await findRun(ctx.store.paths.evidenceDir, parsed.args[1] ?? '');
    if (!run) { console.error('run not found'); return 1; }
    if (json) printJson(run, 'benchmark-show');
    else console.log(JSON.stringify(run, null, 2));
    return 0;
  }

  if (sub === 'compare') {
    const a = await findRun(ctx.store.paths.evidenceDir, parsed.args[1] ?? '');
    const b = await findRun(ctx.store.paths.evidenceDir, parsed.args[2] ?? '');
    if (!a || !b) { console.error('one or both runs not found'); return 1; }
    const out = { a: a.verdict, b: b.verdict };
    if (json) printJson(out, 'benchmark-compare');
    else console.log(JSON.stringify(out, null, 2));
    return 0;
  }

  if (sub === 'export') {
    const run = await findRun(ctx.store.paths.evidenceDir, parsed.args[1] ?? '');
    const out = flagString(parsed.flags, 'out');
    if (!run || !out) { console.error('usage: cco benchmark export <run-id> --out <dir>'); return 2; }
    await fs.mkdir(out, { recursive: true });
    await atomicWriteJson(path.join(out, 'summary.json'), run);
    console.log(`exported to ${out}`);
    return 0;
  }

  console.error('usage: cco benchmark <run|list|show|compare|export>');
  return 2;
}
