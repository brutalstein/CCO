import { describe, it, expect } from 'vitest';
import { validateConfig } from '../src/config/validate.js';

describe('validateConfig', () => {
  it('accepts an empty config and fills defaults', () => {
    const { ok, config } = validateConfig({});
    expect(ok).toBe(true);
    expect(config.mode).toBe('safe');
  });

  it('rejects unknown top-level keys', () => {
    const { ok, errors } = validateConfig({ notAThing: true });
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('notAThing'))).toBe(true);
  });

  it('rejects remoteTelemetry=true (no backend ships with CCO)', () => {
    const { ok, errors } = validateConfig({ privacy: { remoteTelemetry: true } });
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('remoteTelemetry'))).toBe(true);
  });

  it('rejects routing.confidenceThreshold outside safe range', () => {
    const { ok } = validateConfig({ routing: { confidenceThreshold: 0.1 } });
    expect(ok).toBe(false);
  });

  it('rejects optimization.safePruneAffinityMax outside [0, 1] (would widen unsafe pruning)', () => {
    const { ok, config, errors } = validateConfig({ optimization: { safePruneAffinityMax: 1.5 } });
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('safePruneAffinityMax'))).toBe(true);
    expect(config.optimization.safePruneAffinityMax).toBe(0.08);
  });

  it('rejects optimization.metadataConfidenceMin outside [0, 1]', () => {
    const { ok, config, errors } = validateConfig({ optimization: { metadataConfidenceMin: -0.1 } });
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('metadataConfidenceMin'))).toBe(true);
    expect(config.optimization.metadataConfidenceMin).toBe(0.8);
  });
});
