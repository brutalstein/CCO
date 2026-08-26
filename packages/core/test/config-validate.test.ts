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
});
