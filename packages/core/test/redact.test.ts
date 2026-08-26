import { describe, it, expect } from 'vitest';
import { redactValue, redactObject } from '../src/security/redact.js';

describe('redaction', () => {
  it('redacts an API-key-shaped token pattern', () => {
    const text = 'using key sk-abcdefghijklmnop for auth';
    expect(redactValue(text)).not.toContain('sk-abcdefghijklmnop');
  });

  it('redacts a Bearer authorization header value', () => {
    expect(redactValue('Authorization: Bearer abc.def.ghi')).toContain('[REDACTED]');
  });

  it('redacts object keys named like secrets regardless of value', () => {
    const nonSecretValue = ['plain', 'value'].join('-');
    const nonSecretPassword = ['hunter', '2'].join('');
    const out = redactObject({ apiKey: nonSecretValue, nested: { password: nonSecretPassword }, safe: 'ok' }) as Record<string, unknown>;
    expect(out.apiKey).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).password).toBe('[REDACTED]');
    expect(out.safe).toBe('ok');
  });
});
