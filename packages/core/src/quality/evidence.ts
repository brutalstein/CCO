import {
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_STATISTICS_METHOD,
  type EvidenceRecord,
  type TaskIntent
} from '../types.js';

export interface EvidenceApplicabilityContext {
  capabilityIds: string[];
  taskFamilies: string[];
  claudeVersionFamily: string;
  model: string;
  optimizerVersion: string;
  graphVersion: string;
  classifierVersion: string;
  candidateProfileId: string;
  candidateSemanticsHash: string;
  baselineProfileId: string;
  minimumTrials: number;
  tolerancePolicy: string;
  tolerance: number;
}

export interface EvidenceApplicabilityResult {
  eligible: boolean;
  reasons: string[];
}

function sameSet(a: string[], b: string[]): boolean {
  return [...new Set(a)].sort().join('\0') === [...new Set(b)].sort().join('\0');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function hasCurrentShape(record: EvidenceRecord): boolean {
  const applicability = record.applicability;
  const statistics = record.statistics;
  const qualification = record.qualification;
  return record.schemaVersion === EVIDENCE_SCHEMA_VERSION &&
    typeof record.id === 'string' && typeof record.suiteId === 'string' && typeof record.createdAt === 'string' &&
    !!record.quality && typeof record.quality === 'object' &&
    typeof record.quality.nonInferior === 'boolean' && Number.isFinite(record.quality.tolerance) &&
    !!applicability && typeof applicability === 'object' &&
    isStringArray(applicability.capabilityIds) && isStringArray(applicability.taskFamilies) &&
    typeof applicability.claudeVersionFamily === 'string' && typeof applicability.model === 'string' &&
    typeof applicability.optimizerVersion === 'string' && typeof applicability.graphVersion === 'string' &&
    typeof applicability.classifierVersion === 'string' && typeof applicability.candidateProfileId === 'string' &&
    typeof applicability.candidateSemanticsHash === 'string' &&
    !!statistics && typeof statistics === 'object' && typeof statistics.method === 'string' &&
    typeof statistics.tolerancePolicy === 'string' && typeof statistics.deterministicRegression === 'boolean' &&
    !!qualification && typeof qualification === 'object' &&
    ['smoke', 'exploratory', 'public-claim'].includes(qualification.grade) &&
    ['active', 'quarantined'].includes(record.status) && isStringArray(record.taskFamily) && typeof record.claudeVersionFamily === 'string' &&
    typeof record.model === 'string' && typeof record.candidateProfileHash === 'string' &&
    typeof record.baselineProfileHash === 'string' && Number.isInteger(record.trials) && record.trials >= 0;
}

export function taskFamiliesFromIntent(intent: TaskIntent | undefined): string[] {
  if (!intent) return [];
  return [...new Set([...intent.operations, ...intent.domains, ...intent.languages, ...intent.artifacts])].sort();
}

/** A single fail-closed authorization boundary for every persisted evidence consumer. */
export function evaluateEvidenceApplicability(
  record: EvidenceRecord,
  context: EvidenceApplicabilityContext
): EvidenceApplicabilityResult {
  const reasons: string[] = [];

  if (!hasCurrentShape(record)) {
    reasons.push('LEGACY_OR_INCOMPLETE_SCHEMA');
    return { eligible: false, reasons };
  }
  const applicability = record.applicability!;
  const statistics = record.statistics!;
  const qualification = record.qualification!;
  if (statistics.method !== EVIDENCE_STATISTICS_METHOD) reasons.push('STATISTICS_METHOD_MISMATCH');
  if (applicability.optimizerVersion !== context.optimizerVersion) reasons.push('OPTIMIZER_VERSION_MISMATCH');
  if (applicability.graphVersion !== context.graphVersion) reasons.push('GRAPH_VERSION_MISMATCH');
  if (applicability.classifierVersion !== context.classifierVersion) reasons.push('CLASSIFIER_VERSION_MISMATCH');
  if (applicability.claudeVersionFamily !== context.claudeVersionFamily) reasons.push('CLAUDE_FAMILY_MISMATCH');
  if (applicability.model !== context.model) reasons.push('MODEL_MISMATCH');
  if (!sameSet(applicability.taskFamilies, context.taskFamilies)) reasons.push('TASK_FAMILY_MISMATCH');
  if (!sameSet(applicability.capabilityIds, context.capabilityIds)) reasons.push('CAPABILITY_SET_MISMATCH');
  if (applicability.candidateProfileId !== context.candidateProfileId) reasons.push('CANDIDATE_PROFILE_MISMATCH');
  if (applicability.candidateSemanticsHash !== context.candidateSemanticsHash) reasons.push('CANDIDATE_SEMANTICS_MISMATCH');
  if (record.baselineProfileHash !== context.baselineProfileId) reasons.push('BASELINE_PROFILE_MISMATCH');
  if (
    record.candidateProfileHash !== applicability.candidateProfileId ||
    record.claudeVersionFamily !== applicability.claudeVersionFamily ||
    record.model !== applicability.model ||
    !sameSet(record.taskFamily, applicability.taskFamilies)
  ) reasons.push('RECORD_METADATA_INCONSISTENT');
  if (record.status !== 'active') reasons.push('EVIDENCE_NOT_ACTIVE');
  if (qualification.grade === 'smoke') reasons.push('SMOKE_GRADE');
  if (record.trials < context.minimumTrials) reasons.push('INSUFFICIENT_TRIALS');
  if (!record.quality.nonInferior) reasons.push('NOT_NONINFERIOR');
  if (statistics.deterministicRegression || record.quality.deterministicRegression === true) reasons.push('DETERMINISTIC_REGRESSION');
  if (statistics.tolerancePolicy !== context.tolerancePolicy || record.quality.tolerance !== context.tolerance) reasons.push('TOLERANCE_POLICY_MISMATCH');

  return { eligible: reasons.length === 0, reasons };
}
