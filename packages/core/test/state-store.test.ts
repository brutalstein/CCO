import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonStateStore } from '../src/state/store.js';
import type { EvidenceRecord } from '../src/types.js';

function makeRecord(id: string): EvidenceRecord {
  return {
    schemaVersion: 1,
    id,
    suiteId: 'suite-x',
    taskFamily: ['utility-edit'],
    claudeVersionFamily: '2.1-current',
    model: 'default',
    baselineProfileHash: 'native',
    candidateProfileHash: 'profile_abc',
    trials: 2,
    quality: { baselineSuccess: 1, candidateSuccess: 1, difference: 0, lowerBound: -0.01, tolerance: 0, nonInferior: true },
    cost: {},
    createdAt: new Date().toISOString(),
    status: 'active'
  };
}

describe('JsonStateStore.listEvidence', () => {
  let dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) await fs.rm(d, { recursive: true, force: true });
    dirs = [];
  });

  async function tempStore(): Promise<JsonStateStore> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cco-store-test-'));
    dirs.push(root);
    return new JsonStateStore(root);
  }

  it('returns an empty array when no evidence has ever been written', async () => {
    const store = await tempStore();
    expect(await store.listEvidence()).toEqual([]);
  });

  it('returns records written via putSnapshot', async () => {
    const store = await tempStore();
    await store.putSnapshot('evidence', makeRecord('evidence_1'));
    await store.putSnapshot('evidence', makeRecord('evidence_2'));
    const records = await store.listEvidence();
    expect(records.map((r) => r.id).sort()).toEqual(['evidence_1', 'evidence_2']);
  });

  it('ignores per-suite BenchmarkRun subdirectories that also live under evidenceDir', async () => {
    const store = await tempStore();
    await store.putSnapshot('evidence', makeRecord('evidence_1'));
    const suiteDir = path.join(store.paths.evidenceDir, 'suite-x');
    await fs.mkdir(suiteDir, { recursive: true });
    await fs.writeFile(path.join(suiteDir, 'run_deadbeef.json'), JSON.stringify({ suiteId: 'suite-x', runId: 'run_deadbeef' }));

    const records = await store.listEvidence();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('evidence_1');
  });
});
