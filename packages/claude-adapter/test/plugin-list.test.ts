import { describe, it, expect } from 'vitest';
import { parsePluginListJson } from '../src/plugin-list.js';
import { parsePluginDetailsJson } from '../src/plugin-details.js';

describe('parsePluginListJson', () => {
  it('parses a well-formed array', () => {
    const out = parsePluginListJson(JSON.stringify([{ id: 'a@x', name: 'a', enabled: true, source: 'marketplace' }]));
    expect(out).toHaveLength(1);
    expect(out[0].canonicalId).toBe('a@x');
  });

  it('returns empty array on malformed JSON without throwing', () => {
    expect(parsePluginListJson('{not json')).toEqual([]);
  });

  it('ignores entries missing a canonical id', () => {
    const out = parsePluginListJson(JSON.stringify([{ name: 'no-id' }]));
    expect(out).toEqual([]);
  });

  it('tolerates unknown extra fields', () => {
    const out = parsePluginListJson(JSON.stringify([{ id: 'a@x', name: 'a', enabled: true, futureField: 42 }]));
    expect(out[0].canonicalId).toBe('a@x');
  });
});

describe('parsePluginDetailsJson', () => {
  it('marks cost unknown when alwaysOnTokens is absent', () => {
    const out = parsePluginDetailsJson('a@x', JSON.stringify({ components: [] }));
    expect(out?.tokenSource).toBe('unknown');
  });

  it('preserves anthropic_projected provenance when present', () => {
    const out = parsePluginDetailsJson('a@x', JSON.stringify({ alwaysOnTokens: 120, components: [] }));
    expect(out?.tokenSource).toBe('anthropic_projected');
    expect(out?.alwaysOnTokens).toBe(120);
  });

  it('returns null (never zero) on malformed JSON', () => {
    expect(parsePluginDetailsJson('a@x', 'not json')).toBeNull();
  });
});
