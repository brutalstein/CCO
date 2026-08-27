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

  it('rejects optimization.semanticClassificationConfidenceMin outside [0, 1]', () => {
    const { ok, config, errors } = validateConfig({ optimization: { semanticClassificationConfidenceMin: -0.1 } });
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('semanticClassificationConfidenceMin'))).toBe(true);
    expect(config.optimization.semanticClassificationConfidenceMin).toBe(0.8);
  });

  it('migrates the legacy metadataConfidenceMin key to the semantic floor', () => {
    const { ok, config } = validateConfig({ optimization: { metadataConfidenceMin: 0.9 } });
    expect(ok).toBe(true);
    expect(config.optimization.semanticClassificationConfidenceMin).toBe(0.9);
  });

  it('rejects a zero semantic coverage floor that would equate unknown with irrelevant', () => {
    const { ok, config, errors } = validateConfig({ optimization: { semanticCoverageMin: 0 } });
    expect(ok).toBe(false);
    expect(errors.some((error) => error.includes('semanticCoverageMin'))).toBe(true);
    expect(config.optimization.semanticCoverageMin).toBe(0.5);
  });

  it('applies bounded repository scan limits', () => {
    const { ok, config } = validateConfig({ repository: { maxTrackedFiles: 10, maxManifestBytes: 20, maxTotalParsedBytes: 30 } });
    expect(ok).toBe(true);
    expect(config.repository).toEqual({ maxTrackedFiles: 10, maxManifestBytes: 20, maxTotalParsedBytes: 30 });
  });

  it('accepts but drops the legacy no-op deepScan key', () => {
    const { ok, config } = validateConfig({ repository: { deepScan: true } });
    expect(ok).toBe(true);
    expect(config.repository).not.toHaveProperty('deepScan');
  });
});
