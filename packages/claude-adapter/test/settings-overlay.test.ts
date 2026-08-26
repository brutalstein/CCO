import { describe, it, expect } from 'vitest';
import { validateOverlayMonotonic } from '../src/settings-overlay.js';
import type { PluginInventorySource } from '../src/interface.js';

const baseline: PluginInventorySource[] = [
  { canonicalId: 'a@example', name: 'a', sourceType: 'marketplace', enabled: true },
  { canonicalId: 'b@example', name: 'b', sourceType: 'marketplace', enabled: false }
];

describe('validateOverlayMonotonic', () => {
  it('rejects overlay containing a permissions key', () => {
    const result = validateOverlayMonotonic({ enabledPlugins: {}, permissions: {} } as never, baseline);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes('permissions'))).toBe(true);
  });

  it('rejects unknown canonical plugin id', () => {
    const result = validateOverlayMonotonic({ enabledPlugins: { 'ghost@example': false } }, baseline);
    expect(result.ok).toBe(false);
  });

  it('rejects enabling a baseline-disabled plugin without authorization', () => {
    const result = validateOverlayMonotonic({ enabledPlugins: { 'b@example': true } }, baseline);
    expect(result.ok).toBe(false);
  });

  it('allows enabling a baseline-disabled plugin when explicitly authorized', () => {
    const result = validateOverlayMonotonic({ enabledPlugins: { 'b@example': true } }, baseline, ['b@example']);
    expect(result.ok).toBe(true);
  });

  it('allows pruning a baseline-enabled plugin', () => {
    const result = validateOverlayMonotonic({ enabledPlugins: { 'a@example': false } }, baseline);
    expect(result.ok).toBe(true);
  });
});
