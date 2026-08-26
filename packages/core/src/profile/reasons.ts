import type { ProfileReasonCode } from '../types.js';

/** Human renderer for machine reason codes (06_SESSION_PROFILE_COMPILER.md section 15). */
const REASON_TEXT: Record<ProfileReasonCode, string> = {
  KEEP_MANAGED: 'retained because managed policy requires it',
  KEEP_USER_PIN: 'retained because the user pinned it never-disable',
  KEEP_DEPENDENCY: 'retained because a selected capability depends on it',
  KEEP_HIGH_REPO_AFFINITY: 'retained: high affinity with this repository',
  KEEP_HIGH_TASK_AFFINITY: 'retained: high affinity with the requested task',
  KEEP_UNIQUE_CAPABILITY: 'retained: provides a unique relevant capability',
  KEEP_UNCERTAIN: 'retained: relevance or cost metadata is uncertain',
  KEEP_QUALITY_EVIDENCE: 'retained: benchmark evidence supports keeping it',
  KEEP_PROTECTED: 'retained: marked protected/opaque by the user',
  PRUNE_STRUCTURAL_IRRELEVANCE: 'pruned for this session: no repository/task affinity and no dependency',
  PRUNE_NONINFERIOR_REDUNDANT: 'pruned for this session: redundant capability with non-inferiority evidence',
  PRUNE_EXPLICIT_PROFILE: 'pruned: excluded by the selected named profile',
  BLOCKED_BY_MANAGED_POLICY: 'requested change blocked by managed Claude policy'
};

export function explainReasonCodes(codes: ProfileReasonCode[]): string {
  return codes.map((c) => REASON_TEXT[c]).join('; ');
}
