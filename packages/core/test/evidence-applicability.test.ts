import { describe, expect, it } from 'vitest';
import { evaluateEvidenceApplicability, taskFamiliesFromIntent, type EvidenceApplicabilityContext } from '../src/quality/evidence.js';
import {
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_STATISTICS_METHOD,
  GRAPH_ALGORITHM_VERSION,
  INTENT_CLASSIFIER_VERSION,
  OPTIMIZER_MODEL_VERSION,
  type EvidenceRecord
} from '../src/types.js';

const context: EvidenceApplicabilityContext = {
  capabilityIds: ['tool@x'],
  taskFamilies: ['utility-edit'],
  claudeVersionFamily: '2.1-current',
  model: 'sonnet',
  optimizerVersion: OPTIMIZER_MODEL_VERSION,
  graphVersion: GRAPH_ALGORITHM_VERSION,
  classifierVersion: INTENT_CLASSIFIER_VERSION,
  candidateProfileId: 'profile_exact',
  candidateSemanticsHash: 'semantics_exact',
  baselineProfileId: 'native',
  minimumTrials: 3,
  tolerancePolicy: 'pre-registered-exact-v1',
  tolerance: 0
};

function record(): EvidenceRecord {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    id: 'evidence_exact',
    suiteId: 'free-form-name-is-not-authority',
    taskFamily: ['utility-edit'],
    claudeVersionFamily: '2.1-current',
    model: 'sonnet',
    baselineProfileHash: 'native',
    candidateProfileHash: 'profile_exact',
    trials: 3,
    quality: { baselineSuccess: 1, candidateSuccess: 1, difference: 0, lowerBound: 0, tolerance: 0, nonInferior: true, deterministicRegression: false },
    cost: {},
    createdAt: '2026-08-27T00:00:00.000Z',
    status: 'active',
    applicability: {
      capabilityIds: ['tool@x'],
      taskFamilies: ['utility-edit'],
      claudeVersionFamily: '2.1-current',
      model: 'sonnet',
      optimizerVersion: OPTIMIZER_MODEL_VERSION,
      graphVersion: GRAPH_ALGORITHM_VERSION,
      classifierVersion: INTENT_CLASSIFIER_VERSION,
      candidateProfileId: 'profile_exact',
      candidateSemanticsHash: 'semantics_exact'
    },
    statistics: { method: EVIDENCE_STATISTICS_METHOD, tolerancePolicy: 'pre-registered-exact-v1', deterministicRegression: false },
    qualification: { grade: 'exploratory' }
  };
}

describe('strict evidence applicability', () => {
  it('derives one deterministic task scope for CLI and analysis consumers', () => {
    expect(taskFamiliesFromIntent({
      schemaVersion: 2,
      operations: ['debug'],
      domains: ['backend-api'],
      languages: ['typescript'],
      artifacts: ['vite'],
      complexity: 'medium',
      parallelism: 'low',
      confidence: 0.9,
      classifierVersion: INTENT_CLASSIFIER_VERSION
    })).toEqual(['backend-api', 'debug', 'typescript', 'vite']);
  });

  it('accepts an exact compatible qualified record', () => {
    expect(evaluateEvidenceApplicability(record(), context)).toEqual({ eligible: true, reasons: [] });
  });

  it.each([
    ['legacy schema', (r: EvidenceRecord) => { r.schemaVersion = 1; }, 'LEGACY_OR_INCOMPLETE_SCHEMA'],
    ['statistics method', (r: EvidenceRecord) => { r.statistics!.method = 'other'; }, 'STATISTICS_METHOD_MISMATCH'],
    ['optimizer', (r: EvidenceRecord) => { r.applicability!.optimizerVersion = 'optimizer-old'; }, 'OPTIMIZER_VERSION_MISMATCH'],
    ['graph', (r: EvidenceRecord) => { r.applicability!.graphVersion = 'graph-old'; }, 'GRAPH_VERSION_MISMATCH'],
    ['classifier', (r: EvidenceRecord) => { r.applicability!.classifierVersion = 'intent-old'; }, 'CLASSIFIER_VERSION_MISMATCH'],
    ['Claude family', (r: EvidenceRecord) => { r.applicability!.claudeVersionFamily = '3.x'; }, 'CLAUDE_FAMILY_MISMATCH'],
    ['model', (r: EvidenceRecord) => { r.applicability!.model = 'opus'; }, 'MODEL_MISMATCH'],
    ['task family', (r: EvidenceRecord) => { r.applicability!.taskFamilies = ['other']; }, 'TASK_FAMILY_MISMATCH'],
    ['capability', (r: EvidenceRecord) => { r.applicability!.capabilityIds = ['other@x']; }, 'CAPABILITY_SET_MISMATCH'],
    ['profile', (r: EvidenceRecord) => { r.applicability!.candidateProfileId = 'other'; }, 'CANDIDATE_PROFILE_MISMATCH'],
    ['semantics', (r: EvidenceRecord) => { r.applicability!.candidateSemanticsHash = 'other'; }, 'CANDIDATE_SEMANTICS_MISMATCH'],
    ['baseline', (r: EvidenceRecord) => { r.baselineProfileHash = 'other'; }, 'BASELINE_PROFILE_MISMATCH'],
    ['duplicated metadata', (r: EvidenceRecord) => { r.taskFamily = ['other']; }, 'RECORD_METADATA_INCONSISTENT'],
    ['quarantine', (r: EvidenceRecord) => { r.status = 'quarantined'; }, 'EVIDENCE_NOT_ACTIVE'],
    ['smoke grade', (r: EvidenceRecord) => { r.qualification!.grade = 'smoke'; }, 'SMOKE_GRADE'],
    ['trial floor', (r: EvidenceRecord) => { r.trials = 2; }, 'INSUFFICIENT_TRIALS'],
    ['regression', (r: EvidenceRecord) => { r.statistics!.deterministicRegression = true; }, 'DETERMINISTIC_REGRESSION'],
    ['tolerance policy', (r: EvidenceRecord) => { r.statistics!.tolerancePolicy = 'other'; }, 'TOLERANCE_POLICY_MISMATCH']
  ])('rejects a %s mismatch with an explanation', (_name, mutate, reason) => {
    const value = record();
    mutate(value);
    const result = evaluateEvidenceApplicability(value, context);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain(reason);
  });

  it('keeps legacy evidence readable but promotion-ineligible', () => {
    const legacy = record();
    legacy.schemaVersion = 1;
    delete legacy.applicability;
    delete legacy.statistics;
    delete legacy.qualification;
    expect(legacy.id).toBe('evidence_exact');
    expect(evaluateEvidenceApplicability(legacy, context).eligible).toBe(false);
  });

  it('fails closed without throwing for malformed persisted v2 JSON', () => {
    const malformed = { schemaVersion: 2, id: 'evidence_malformed', applicability: {} } as EvidenceRecord;
    expect(() => evaluateEvidenceApplicability(malformed, context)).not.toThrow();
    expect(evaluateEvidenceApplicability(malformed, context)).toEqual({ eligible: false, reasons: ['LEGACY_OR_INCOMPLETE_SCHEMA'] });
  });
});
