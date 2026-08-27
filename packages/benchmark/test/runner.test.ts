import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClaudeAdapter, minimalFixture } from '@cco/claude-adapter';
import type { ProcessLauncher } from '@cco/platform';
import { DefaultBenchmarkRunner, type BenchmarkSuite } from '../src/index.js';

const dirs: string[] = [];

async function setup(): Promise<{ fixture: string; artifacts: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cco-runner-'));
  dirs.push(root);
  const fixture = path.join(root, 'fixture');
  const artifacts = path.join(root, 'artifacts');
  await fs.mkdir(fixture);
  await fs.writeFile(path.join(fixture, 'PROMPT.md'), 'make the fixture pass');
  return { fixture, artifacts };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function suite(fixture: string, trials: number): BenchmarkSuite {
  return {
    schemaVersion: 1,
    id: 'runner-fixture-v1',
    taskFamily: ['test'],
    fixture: { type: 'local', path: fixture },
    promptFile: 'PROMPT.md',
    claude: { maxTurns: 2, maxBudgetUsd: 0.01 },
    checks: [{ type: 'file-assertion', rule: 'exists:PROMPT.md' }],
    trials
  };
}

function runner(): DefaultBenchmarkRunner {
  const fixture = minimalFixture();
  const launcher: ProcessLauncher = {
    async spawnInteractive() { return { code: 0, signal: null }; },
    async runCapture() {
      return {
        code: 0,
        stdout: JSON.stringify({ type: 'result', result: 'ok', usage: { input_tokens: 2, output_tokens: 3 }, total_cost_usd: 0.001 }) + '\n',
        stderr: '',
        timedOut: false
      };
    }
  };
  return new DefaultBenchmarkRunner(new FakeClaudeAdapter(fixture), launcher, fixture.environment);
}

describe('benchmark qualification', () => {
  it('J01/J04/J06/J10: records isolated alternating order, usage, artifacts, and preregistered tolerance', async () => {
    const { fixture, artifacts } = await setup();
    const run = await runner().runSuite(suite(fixture, 2), [{ label: 'baseline', settingsFile: null }, { label: 'candidate', settingsFile: 'candidate.json' }], 0.05, { artifactRoot: artifacts });
    expect(run.trialOrder).toEqual(['baseline:0', 'candidate:0', 'candidate:1', 'baseline:1']);
    expect(run.arms[0].usageTotals).toMatchObject({ inputTokens: 4, outputTokens: 6, costUsd: 0.002 });
    expect(run.qualification).toMatchObject({ grade: 'smoke', eligibleForOptimization: false, preregisteredTolerance: 0.05 });
    await expect(fs.stat(path.join(artifacts, run.runId, 'trials', 'baseline-0.jsonl'))).resolves.toBeDefined();
  });

  it('grades an exploratory sample without promoting statistically insufficient perfect results', async () => {
    const { fixture } = await setup();
    const run = await runner().runSuite(suite(fixture, 3), [{ label: 'baseline', settingsFile: null }, { label: 'candidate', settingsFile: null }], 0.05);
    expect(run.qualification).toMatchObject({ grade: 'exploratory', eligibleForOptimization: false, eligibleForPublicClaim: false });
  });

  it('J05: unsupported validators are infrastructure failures and never promote', async () => {
    const { fixture } = await setup();
    const badSuite = suite(fixture, 3);
    badSuite.checks = [{ type: 'file-assertion', rule: 'arbitrary:PROMPT.md' }];
    const run = await runner().runSuite(badSuite, [{ label: 'baseline', settingsFile: null }, { label: 'candidate', settingsFile: null }], 0.05);
    expect(run.arms.every((arm) => arm.infrastructureFailures === 3)).toBe(true);
    expect(run.qualification.eligibleForOptimization).toBe(false);
  });
});
