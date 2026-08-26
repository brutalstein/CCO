/**
 * Secret redaction (32_ALGORITHMS_PSEUDOCODE.md section 11, 19_OBSERVABILITY_ANALYTICS.md section 7).
 * Applied before any value is written to telemetry/logs.
 */

const SECRET_KEY_RE = /token|secret|password|authorization|cookie|apikey|api_key/i;

const CREDENTIAL_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9_-]{10,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /[a-zA-Z0-9._-]*[Aa]uth[a-zA-Z0-9._-]*=[^\s&]+/g
];

const MAX_ERROR_STRING_LENGTH = 2000;

export function redactValue(value: string): string {
  let text = value;
  for (const pattern of CREDENTIAL_PATTERNS) {
    text = text.replace(pattern, '[REDACTED]');
  }
  return capLength(text, MAX_ERROR_STRING_LENGTH);
}

export function capLength(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...[truncated]' : text;
}

/** Redacts an object recursively: known-secret key names become "[REDACTED]" regardless of value. */
export function redactObject<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactValue(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactObject(v)) as unknown as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_RE.test(key) ? '[REDACTED]' : redactObject(v);
    }
    return out as unknown as T;
  }
  return value;
}
