import { validateOverlayMonotonic, type ValidatedOverlay } from '@cco/claude-adapter';
import { canonicalHash } from '@cco/platform';
import { CCO_VERSION, GRAPH_ALGORITHM_VERSION, INTENT_CLASSIFIER_VERSION, OPTIMIZER_MODEL_VERSION, SCHEMA_VERSION, type CapabilityGraph, type CompiledProfile, type InventorySnapshot } from '../types.js';

export interface ValidationIssue {
  code: string;
  message: string;
}

/**
 * Correctness oracle run before every Claude launch (06_SESSION_PROFILE_COMPILER.md section 17,
 * 11_SECURITY_PRIVACY_THREAT_MODEL.md section 8). Any issue here forces native/observe fallback.
 */
export interface SafetyValidator {
  validateProfile(profile: CompiledProfile, baseline: InventorySnapshot): ValidationIssue[];
  validateOverlay(overlay: ValidatedOverlay, baseline: InventorySnapshot): ValidationIssue[];
}

function major(version: string): string {
  return version.split('.')[0] ?? '';
}

export function profileIntegrityHash(profile: CompiledProfile): string {
  return canonicalHash({ ...profile, integrityHash: undefined, id: undefined, createdAt: undefined });
}

export function validateProfileIntegrity(profile: CompiledProfile, runtimeVersion = CCO_VERSION): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (profile.schemaVersion !== SCHEMA_VERSION) {
    issues.push({ code: 'PROFILE_SCHEMA_MISMATCH', message: 'profile schema is incompatible with this runtime' });
  }
  if (!profile.ccoVersion || major(profile.ccoVersion) !== major(runtimeVersion)) {
    issues.push({ code: 'CCO_VERSION_MISMATCH', message: 'CLI/plugin major versions do not match' });
  }
  if (profile.algorithmVersions?.optimizer !== OPTIMIZER_MODEL_VERSION || profile.algorithmVersions?.graph !== GRAPH_ALGORITHM_VERSION || profile.algorithmVersions?.classifier !== INTENT_CLASSIFIER_VERSION) {
    issues.push({ code: 'PROFILE_ALGORITHM_MISMATCH', message: 'profile algorithm versions are incompatible with this runtime' });
  }
  if (profile.integrityHash !== profileIntegrityHash(profile)) {
    issues.push({ code: 'PROFILE_INTEGRITY', message: 'profile integrity hash is invalid' });
  }
  return issues;
}

/** Hook-safe validation that needs no mutable inventory or Claude process. */
export function validateHookArtifacts(
  profile: CompiledProfile,
  graph: CapabilityGraph | null,
  runtimeVersion = CCO_VERSION
): ValidationIssue[] {
  const issues = validateProfileIntegrity(profile, runtimeVersion);
  if (!graph) {
    issues.push({ code: 'GRAPH_MISSING', message: 'profile graph is missing' });
    return issues;
  }
  if (
    graph.schemaVersion !== SCHEMA_VERSION ||
    graph.buildAlgorithmVersion !== GRAPH_ALGORITHM_VERSION ||
    graph.inventoryFingerprint !== profile.inventoryId ||
    graph.sourceHashes.repo !== profile.repoFingerprintId
  ) {
    issues.push({ code: 'GRAPH_STALE', message: 'profile and capability graph fingerprints do not match' });
  }
  const graphIds = new Set(graph.nodes.map((node) => node.id));
  if (profile.runtimeCapabilityIds.some((id) => !graphIds.has(id))) {
    issues.push({ code: 'RUNTIME_CAPABILITY_MISSING', message: 'profile references a capability absent from its graph' });
  }
  return issues;
}

export class DefaultSafetyValidator implements SafetyValidator {
  validateProfile(profile: CompiledProfile, baseline: InventorySnapshot): ValidationIssue[] {
    const issues: ValidationIssue[] = validateProfileIntegrity(profile);
    const baselineEnabled = new Set(baseline.plugins.filter((p) => p.enabled).map((p) => p.canonicalId));

    for (const id of profile.selected.enabledPluginIds) {
      if (!baselineEnabled.has(id)) {
        issues.push({ code: 'UNAUTHORIZED_ENABLEMENT', message: `selected plugin ${id} was not baseline-enabled` });
      }
    }

    const accountedFor = new Set([...profile.selected.enabledPluginIds, ...profile.selected.prunedPluginIds]);
    for (const id of baselineEnabled) {
      if (!accountedFor.has(id)) {
        issues.push({ code: 'INCOMPLETE_CLOSURE', message: `baseline plugin ${id} has no selection decision` });
      }
    }

    for (const id of profile.selected.prunedPluginIds) {
      const decision = profile.decisions.find((d) => d.subjectId === id);
      if (!decision || decision.reasonCodes.length === 0) {
        issues.push({ code: 'UNEXPLAINED_PRUNE', message: `pruned plugin ${id} has no reason code` });
      }
    }

    if ('permissions' in (profile.overlay as Record<string, unknown>)) {
      issues.push({ code: 'PERMISSIONS_IN_OVERLAY', message: 'compiled profile overlay must never contain permissions' });
    }

    return issues;
  }

  validateOverlay(overlay: ValidatedOverlay, baseline: InventorySnapshot): ValidationIssue[] {
    const result = validateOverlayMonotonic(overlay.json, baseline.plugins);
    return result.issues.map((message) => ({ code: 'OVERLAY_MONOTONICITY', message }));
  }
}
