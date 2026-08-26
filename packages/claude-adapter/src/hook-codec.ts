import type { HookEvent, HookInput } from './interface.js';

/**
 * Hook input/output codec (15_HOOK_CONTRACTS.md, 04_CLAUDE_CODE_INTEGRATION.md section 8).
 * Tolerant to unknown/missing fields; never throws (hooks must fail open).
 */
export function normalizeHookInput(event: HookEvent, raw: unknown): HookInput {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    event,
    sessionId: typeof r.session_id === 'string' ? r.session_id : typeof r.sessionId === 'string' ? r.sessionId : '',
    cwd: typeof r.cwd === 'string' ? r.cwd : process.cwd(),
    transcriptPath: typeof r.transcript_path === 'string' ? r.transcript_path : undefined,
    permissionMode: typeof r.permission_mode === 'string' ? r.permission_mode : undefined,
    source: typeof r.source === 'string' ? r.source : undefined,
    prompt: typeof r.prompt === 'string' ? r.prompt : undefined
  };
}

// Matches control characters other than tab (U+0009) and newline (U+000A).
const CONTROL_CHARS = new RegExp('[\u0000-\u0008\u000B-\u001F\u007F]', 'g');

/**
 * Context injection sanitizer (15_HOOK_CONTRACTS.md section 6). Strips control characters,
 * caps length and never lets raw third-party text pass through verbatim.
 */
export function sanitizeContextText(text: string, maxChars = 1200): string {
  const stripped = text.replace(CONTROL_CHARS, '');
  return stripped.length > maxChars ? stripped.slice(0, maxChars) : stripped;
}

export function encodeHookContext(event: HookEvent, text: string): unknown {
  return {
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: sanitizeContextText(text)
    }
  };
}
