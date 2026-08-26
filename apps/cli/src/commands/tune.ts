import path from 'node:path';
import { promises as fs } from 'node:fs';
import { readJsonIfExists } from '@cco/platform';
import type { EvidenceRecord } from '@cco/core';
import { createContext, printJson } from '../context.js';
import type { ParsedArgs } from '../argv.js';
import { flagBool, flagString } from '../argv.js';

async function loadAllEvidence(evidenceDir: string): Promise<EvidenceRecord[]> {
  const files = await fs.readdir(evidenceDir, { recursive: true } as never).catch(() => [] as string[]);
  const out: EvidenceRecord[] = [];
  for (const f of files as unknown as string[]) {
    if (!f.toString().endsWith('.json')) continue;
    const rec = await readJsonIfExists<EvidenceRecord>(path.join(evidenceDir, f.toString()));
    if (rec && 'quality' in rec) out.push(rec);
  }
  return out;
}

/** `cco tune` (13_CLI_SPEC.md section 12, 08_OPTIMIZATION_ENGINE.md section 15). Bounded, explainable, dry-run by default. */
export async function cmdTune(parsed: ParsedArgs): Promise<number> {
  const json = flagBool(parsed.flags, 'json');
  const apply = flagBool(parsed.flags, 'apply');
  const suiteFilter = flagString(parsed.flags, 'from-suite');
  const ctx = await createContext(process.cwd(), json);

  const evidence = (await loadAllEvidence(ctx.store.paths.evidenceDir)).filter((e) => !suiteFilter || e.suiteId === suiteFilter);
  const config = await ctx.store.readConfig();

  const active = evidence.filter((e) => e.status === 'active' && e.quality.nonInferior);
  const suggestion =
    active.length >= 3 && config.routing.confidenceThreshold > 0.6
      ? { key: 'routing.confidenceThreshold', from: config.routing.confidenceThreshold, to: Math.max(0.6, Math.round((config.routing.confidenceThreshold - 0.02) * 100) / 100) }
      : null;

  if (!suggestion) {
    if (json) printJson({ suggestion: null, evidenceCount: evidence.length }, 'tune');
    else console.log(`no calibration suggestion (need >=3 active non-inferior evidence records; found ${active.length})`);
    return 0;
  }

  if (apply) {
    config.routing.confidenceThreshold = suggestion.to;
    await ctx.store.writeConfig(config);
  }

  if (json) printJson({ suggestion, applied: apply }, 'tune');
  else console.log(`${apply ? 'applied' : 'suggested'}: ${suggestion.key} ${suggestion.from} -> ${suggestion.to}`);
  return 0;
}
