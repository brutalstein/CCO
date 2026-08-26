#!/usr/bin/env node
import { parseArgv } from './argv.js';
import { cmdInit } from './commands/init.js';
import { cmdDoctor } from './commands/doctor.js';
import { cmdInventory } from './commands/inventory.js';
import { cmdAnalyze } from './commands/analyze.js';
import { cmdRun } from './commands/run.js';
import { cmdTask } from './commands/task.js';
import { cmdExplain } from './commands/explain.js';
import { cmdProfile } from './commands/profile.js';
import { cmdAudit } from './commands/audit.js';
import { cmdBenchmark } from './commands/benchmark.js';
import { cmdTune } from './commands/tune.js';
import { cmdRate } from './commands/rate.js';
import { cmdConfig } from './commands/config.js';
import { cmdData } from './commands/data.js';
import { runHook } from './commands/hook.js';

const HELP = `cco - Claude Capability Optimizer

Usage: cco <command> [options]

Commands:
  init        initialize CCO
  doctor      compatibility/environment check
  inventory   show installed/enabled capabilities
  analyze     dry-run profile compilation
  run         launch Claude with an optimized session profile
  task        compile an intent-aware profile then launch Claude
  explain     show reasons behind a profile/route decision
  profile     manage named CCO profiles
  audit       security/risk inspection of extension metadata
  benchmark   baseline-vs-optimized benchmark harness
  tune        local calibration suggestions from evidence
  rate        rate the last route decision
  config      read/write CCO config
  data        stats/export/prune/reset CCO local state

Global flags: --json --quiet --verbose --no-color --state-dir <dir>
`;

async function main(): Promise<number> {
  const parsed = parseArgv(process.argv.slice(2));
  const command = parsed.command;

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  switch (command) {
    case 'init':
      return cmdInit(parsed);
    case 'doctor':
      return cmdDoctor(parsed);
    case 'inventory':
      return cmdInventory(parsed);
    case 'analyze':
      return cmdAnalyze(parsed);
    case 'run':
      return cmdRun(parsed);
    case 'task':
      return cmdTask(parsed);
    case 'explain':
      return cmdExplain(parsed);
    case 'profile':
      return cmdProfile(parsed);
    case 'audit':
      return cmdAudit(parsed);
    case 'benchmark':
      return cmdBenchmark(parsed);
    case 'tune':
      return cmdTune(parsed);
    case 'rate':
      return cmdRate(parsed);
    case 'config':
      return cmdConfig(parsed);
    case 'data':
      return cmdData(parsed);
    case '__hook':
      return runHook(parsed);
    default:
      process.stderr.write(`cco: unknown command '${command}'\n`);
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`cco: unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
