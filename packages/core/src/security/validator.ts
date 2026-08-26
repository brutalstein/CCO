import { validateOverlayMonotonic, type ValidatedOverlay } from '@cco/claude-adapter';
import type { CompiledProfile, InventorySnapshot } from '../types.js';

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

export class DefaultSafetyValidator implements SafetyValidator {
  validateProfile(profile: CompiledProfile, baseline: InventorySnapshot): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
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
