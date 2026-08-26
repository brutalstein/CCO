import type { EvidenceIndex } from '../types.js';

export type CandidateFingerprint = string;
export type TaskFamilyKey = string[];

export interface QualityAssessment {
  status: 'proven-noninferior' | 'observational' | 'structural-only' | 'unknown' | 'regressed';
  class: 'A' | 'B' | 'C' | 'D';
  evidenceIds: string[];
  lowerBound?: number;
  tolerance?: number;
}

export interface QualityGate {
  assess(candidate: CandidateFingerprint, task: TaskFamilyKey, evidence: EvidenceIndex): QualityAssessment;
}

const PUBLIC_CLAIM_TRIALS = 10;

/**
 * Conservative non-inferiority gate (09_QUALITY_MODEL_AND_EVALS.md, 08_OPTIMIZATION_ENGINE.md
 * section 11). Absent evidence is `unknown`, never treated as safe-to-optimize (ADR-014).
 */
export class DefaultQualityGate implements QualityGate {
  assess(candidate: CandidateFingerprint, task: TaskFamilyKey, evidence: EvidenceIndex): QualityAssessment {
    const matches = evidence.records.filter(
      (r) => (r.candidateProfileHash === candidate || r.baselineProfileHash === candidate) && r.taskFamily.some((f) => task.includes(f))
    );
    if (matches.length === 0) {
      return { status: 'unknown', class: 'D', evidenceIds: [] };
    }

    const regressed = matches.find((r) => r.status === 'quarantined' || !r.quality.nonInferior);
    if (regressed) {
      return { status: 'regressed', class: 'D', evidenceIds: [regressed.id], lowerBound: regressed.quality.lowerBound, tolerance: regressed.quality.tolerance };
    }

    const best = matches.reduce((a, b) => (a.trials >= b.trials ? a : b));
    const cls = best.trials >= PUBLIC_CLAIM_TRIALS ? 'A' : 'B';
    return {
      status: 'proven-noninferior',
      class: cls,
      evidenceIds: matches.map((m) => m.id),
      lowerBound: best.quality.lowerBound,
      tolerance: best.quality.tolerance
    };
  }
}
