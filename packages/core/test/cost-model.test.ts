import { describe, expect, it } from 'vitest';
import { DefaultCostModel } from '../src/cost/model.js';
import type { CompiledProfile } from '../src/types.js';

const profile = {
  costProjection: { alwaysOnBefore: 100, alwaysOnAfter: 80, unknownBefore: 1, unknownAfter: 1 }
} as CompiledProfile;

describe('Tool Search cache-risk accounting', () => {
  it('H02: prefix-loaded fallback has higher disruption than deferred search', () => {
    const model = new DefaultCostModel();
    expect(model.profileCost({ profile, mcpTopologyChanged: true, toolSearchStatus: 'deferred-supported' }).cacheDisruptionClass).toBe('deferred_tool_change');
    expect(model.profileCost({ profile, mcpTopologyChanged: true, toolSearchStatus: 'prefix-loaded-or-search-disabled' }).cacheDisruptionClass).toBe('tool_prefix_change');
  });

  it('uses conservative unknown accounting when provider behavior is not known', () => {
    expect(new DefaultCostModel().profileCost({ profile, mcpTopologyChanged: true, toolSearchStatus: 'unknown' }).cacheDisruptionClass).toBe('unknown');
  });
});
