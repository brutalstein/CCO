import { describe, expect, it } from 'vitest';
import { renderAnalyzeReport } from '../src/index.js';
import type { CompiledProfile } from '@cco/core';

describe('renderAnalyzeReport', () => {
  it('makes native fallback reasons visible in human-readable output', () => {
    const profile = {
      mode: 'native',
      baseline: { enabledPluginIds: ['a@x'] },
      selected: { enabledPluginIds: ['a@x'], prunedPluginIds: [] },
      costProjection: { alwaysOnBefore: 10, alwaysOnAfter: 10, unknownBefore: 0, unknownAfter: 0 },
      quality: { status: 'native-fallback', evidenceIds: [] },
      fallbackReasons: ['PARTIAL_INVENTORY'],
      decisions: []
    } as CompiledProfile;

    expect(renderAnalyzeReport(profile)).toContain('Native fallback: PARTIAL_INVENTORY');
  });
});
