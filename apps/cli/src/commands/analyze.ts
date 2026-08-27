import { DefaultCapabilityGraphBuilder, DefaultIntentClassifier, DefaultProfileCompiler, taskFamiliesFromIntent, type OptimizationMode } from '@cco/core';
import { renderAnalyzeReport } from '@cco/report';
import { createContext, printJson } from '../context.js';
import type { ParsedArgs } from '../argv.js';
import { flagBool, flagString } from '../argv.js';

const VALID_MODES = new Set(['observe', 'safe', 'aggressive', 'native']);

/** `cco analyze` (13_CLI_SPEC.md section 5). Dry-run only: never launches Claude or writes settings. */
export async function cmdAnalyze(parsed: ParsedArgs): Promise<number> {
  const json = flagBool(parsed.flags, 'json');
  const ctx = await createContext(process.cwd(), json);
  const modeFlag = flagString(parsed.flags, 'mode') ?? 'safe';
  if (!VALID_MODES.has(modeFlag)) {
    console.error(`invalid --mode: ${modeFlag}`);
    return 2;
  }
  const mode = modeFlag as OptimizationMode;

  const env = await ctx.adapter.probe({ cwd: ctx.cwd });
  const config = await ctx.store.readConfig();
  const inventory = await ctx.inventoryService.loadOrRefresh({ cwd: ctx.cwd });
  const repo = await ctx.repoAnalyzer.fingerprint(ctx.cwd, config.repository);
  const graph = new DefaultCapabilityGraphBuilder().build(inventory, repo);
  const intentText = flagString(parsed.flags, 'intent');
  const intent = intentText ? new DefaultIntentClassifier().classify({ prompt: intentText, repo }) : undefined;
  const taskFamilies = taskFamiliesFromIntent(intent);

  const evidence = { records: await ctx.store.listEvidence() };
  const profile = new DefaultProfileCompiler().compile({ inventory, graph, repo, intent, config, evidence, environment: env, mode, taskFamilies, model: flagString(parsed.flags, 'model') ?? 'default' });

  if (json) {
    printJson(profile, 'analyze');
  } else {
    console.log(renderAnalyzeReport(profile));
  }
  return 0;
}
