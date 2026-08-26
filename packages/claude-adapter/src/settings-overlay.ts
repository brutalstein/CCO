import type { OverlayInput, PluginInventorySource, ValidatedOverlay, ValidationResult } from './interface.js';

/**
 * Delta-only overlay builder (06_SESSION_PROFILE_COMPILER.md section 13,
 * 04_CLAUDE_CODE_INTEGRATION.md section 4). Only keys that differ from baseline are emitted.
 */
export function buildOverlayJson(input: OverlayInput): ValidatedOverlay['json'] {
  const json: ValidatedOverlay['json'] = {};
  if (Object.keys(input.enabledPluginDelta).length > 0) {
    json.enabledPlugins = { ...input.enabledPluginDelta };
  }
  if (Object.keys(input.env).length > 0) {
    json.env = { ...input.env };
  }
  return json;
}

/**
 * Monotonicity / safety validator (11_SECURITY_PRIVACY_THREAT_MODEL.md section 8,
 * 32_ALGORITHMS_PSEUDOCODE.md section 10). This is a hard release-blocking invariant:
 * the overlay can never grant more capability or permission than baseline without
 * explicit user authorization, and it can never touch `permissions`.
 */
export function validateOverlayMonotonic(
  overlayJson: ValidatedOverlay['json'],
  baseline: PluginInventorySource[],
  authorizedEnableIds: string[] = []
): ValidationResult {
  const issues: string[] = [];

  if ('permissions' in overlayJson) {
    issues.push('overlay must not contain a permissions key');
  }

  const baselineById = new Map(baseline.map((p) => [p.canonicalId, p]));
  const authorized = new Set(authorizedEnableIds);

  for (const [pluginId, nextState] of Object.entries(overlayJson.enabledPlugins ?? {})) {
    const base = baselineById.get(pluginId);
    if (!base) {
      issues.push(`unknown canonical plugin id in overlay: ${pluginId}`);
      continue;
    }
    if (base.enabled === false && nextState === true && !authorized.has(pluginId)) {
      issues.push(`overlay would enable baseline-disabled plugin without authorization: ${pluginId}`);
    }
  }

  return { ok: issues.length === 0, issues };
}
