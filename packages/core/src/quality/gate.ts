import type { EvidenceIndex } from '../types.js';
import {
  evaluateEvidenceApplicability,
  type EvidenceApplicabilityContext
} from './evidence.js';

export interface QualityAssessment {
  status: 'proven-noninferior' | 'observational' | 'structural-only' | 'unknown' | 'regressed';
  class: 'A' | 'B' | 'C' | 'D';
  evidenceIds: string[];
  lowerBound?: number;
  tolerance?: number;
}

export interface QualityGate {
  assess(context: EvidenceApplicabilityContext, evidence: EvidenceIndex): QualityAssessment;
}

const PUBLIC_CLAIM_TRIALS = 10;

/** Uses the same exact applicability contract as aggressive profile compilation. */
export class DefaultQualityGate implements QualityGate {
  assess(context: EvidenceApplicabilityContext, evidence: EvidenceIndex): QualityAssessment {
    const matches = evidence.records.filter((record) => evaluateEvidenceApplicability(record, context).eligible);
    if (matches.length === 0) return { status: 'unknown', class: 'D', evidenceIds: [] };

    const best = matches.reduce((a, b) => (a.trials >= b.trials ? a : b));
    return {
      status: 'proven-noninferior',
      class: best.trials >= PUBLIC_CLAIM_TRIALS ? 'A' : 'B',
      evidenceIds: matches.map((record) => record.id),
      lowerBound: best.quality.lowerBound,
      tolerance: best.quality.tolerance
    };
  }
}
