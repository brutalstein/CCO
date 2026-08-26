import crypto from 'node:crypto';
import { canonicalHash } from '@cco/platform';
import { redactObject } from '../security/redact.js';
import { SCHEMA_VERSION, type TelemetryEvent } from '../types.js';

const CCO_VERSION = '1.0.0';
const EVENT_VERSION = 1;

export function projectIdFromRoot(root: string): string {
  return 'project_' + canonicalHash(root);
}

export function sessionIdHash(sessionId: string, salt = 'cco-local-salt'): string {
  return crypto.createHash('sha256').update(salt + ':' + sessionId).digest('hex').slice(0, 32);
}

/**
 * Builds a redacted telemetry envelope (12_DATA_MODEL_AND_SCHEMAS.md section 9,
 * 19_OBSERVABILITY_ANALYTICS.md section 7). Raw prompts/session IDs never enter payload.
 */
export function buildEvent(
  type: string,
  claudeVersion: string | null,
  projectId: string,
  sessionId: string,
  payload: Record<string, unknown>
): TelemetryEvent {
  return {
    schemaVersion: SCHEMA_VERSION,
    eventVersion: EVENT_VERSION,
    timestamp: new Date().toISOString(),
    type,
    ccoVersion: CCO_VERSION,
    claudeVersion,
    projectId,
    sessionIdHash: sessionIdHash(sessionId),
    payload: redactObject(payload)
  };
}
