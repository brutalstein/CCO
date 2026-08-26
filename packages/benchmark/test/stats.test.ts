import { describe, it, expect } from 'vitest';
import { evaluateNonInferiority } from '../src/stats.js';
import type { TrialResult } from '../src/types.js';

function trial(arm: string, success: boolean, failures: string[] = []): TrialResult {
  return { arm, trialIndex: 0, success, deterministicFailures: failures, wallMs: 10, usage: {}, infrastructureFailure: false, rawArtifactPath: null };
}

describe('evaluateNonInferiority', () => {
  it('passes when candidate matches baseline success rate exactly', () => {
    const baseline = Array.from({ length: 10 }, () => trial('baseline', true));
    const candidate = Array.from({ length: 10 }, () => trial('candidate', true));
    const result = evaluateNonInferiority(baseline, candidate, 0.05);
    expect(result.nonInferior).toBe(true);
  });

  it('J03: a deterministic candidate failure absent from baseline blocks promotion', () => {
    const baseline = Array.from({ length: 5 }, () => trial('baseline', true));
    const candidate = [trial('candidate', false, ['npm-test']), ...Array.from({ length: 4 }, () => trial('candidate', true))];
    const result = evaluateNonInferiority(baseline, candidate, 0.05);
    expect(result.deterministicRegression).toBe(true);
    expect(result.nonInferior).toBe(false);
  });

  it('fails when candidate success rate is far below baseline', () => {
    const baseline = Array.from({ length: 10 }, () => trial('baseline', true));
    const candidate = Array.from({ length: 10 }, (_, i) => trial('candidate', i < 3));
    const result = evaluateNonInferiority(baseline, candidate, 0.05);
    expect(result.nonInferior).toBe(false);
  });
});
