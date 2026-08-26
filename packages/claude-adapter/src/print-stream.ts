/**
 * Parser for Claude print-mode stream-json output (04_CLAUDE_CODE_INTEGRATION.md section 10,
 * 20_BENCHMARK_HARNESS.md section 5). Unknown line shapes are kept as `other` rather than
 * dropped or crashing the benchmark run.
 */

export interface PrintStreamUsage {
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface PrintStreamSummary {
  finalText: string;
  usage: PrintStreamUsage;
  toolCallCount: number;
  events: unknown[];
}

export function parseStreamJsonLines(raw: string): PrintStreamSummary {
  const events: unknown[] = [];
  let finalText = '';
  let toolCallCount = 0;
  const usage: PrintStreamUsage = {};

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    events.push(obj);
    const e = obj as Record<string, unknown>;
    if (e.type === 'tool_use' || e.type === 'tool_call') toolCallCount += 1;
    if (typeof e.result === 'string') finalText = e.result;
    if (e.type === 'result' && typeof (e as { result?: unknown }).result === 'string') {
      finalText = (e as { result: string }).result;
    }
    const u = e.usage as Record<string, unknown> | undefined;
    if (u) {
      if (typeof u.input_tokens === 'number') usage.inputTokens = u.input_tokens;
      if (typeof u.cache_read_input_tokens === 'number') usage.cacheReadTokens = u.cache_read_input_tokens;
      if (typeof u.cache_creation_input_tokens === 'number') usage.cacheWriteTokens = u.cache_creation_input_tokens;
      if (typeof u.output_tokens === 'number') usage.outputTokens = u.output_tokens;
    }
    if (typeof e.total_cost_usd === 'number') usage.costUsd = e.total_cost_usd;
  }

  return { finalText, usage, toolCallCount, events };
}

export function parseJsonOutput(raw: string): PrintStreamSummary {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const usage: PrintStreamUsage = {};
    const u = obj.usage as Record<string, unknown> | undefined;
    if (u) {
      if (typeof u.input_tokens === 'number') usage.inputTokens = u.input_tokens;
      if (typeof u.output_tokens === 'number') usage.outputTokens = u.output_tokens;
    }
    if (typeof obj.total_cost_usd === 'number') usage.costUsd = obj.total_cost_usd;
    return {
      finalText: typeof obj.result === 'string' ? obj.result : '',
      usage,
      toolCallCount: 0,
      events: [obj]
    };
  } catch {
    return { finalText: '', usage: {}, toolCallCount: 0, events: [] };
  }
}
