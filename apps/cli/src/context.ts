import { CurrentClaudeAdapter, type ClaudeAdapter } from '@cco/claude-adapter';
import { NodeProcessLauncher, type ProcessLauncher } from '@cco/platform';
import { JsonStateStore, DefaultInventoryService, DefaultRepoAnalyzer, type StateStore, type CCOConfig } from '@cco/core';
import path from 'node:path';

/** Shared command context: one adapter/launcher/store per CLI invocation. */
export interface CliContext {
  adapter: ClaudeAdapter;
  launcher: ProcessLauncher;
  store: StateStore;
  inventoryService: DefaultInventoryService;
  repoAnalyzer: DefaultRepoAnalyzer;
  cwd: string;
  json: boolean;
}

export function stateRootFromArgv(argv: string[], cwd: string): string | undefined {
  const index = argv.indexOf('--state-dir');
  const equals = argv.find((arg) => arg.startsWith('--state-dir='));
  const value = index >= 0 ? argv[index + 1] : equals?.slice('--state-dir='.length);
  return value ? path.resolve(cwd, value) : undefined;
}

export async function createContext(cwd: string, json: boolean, argv = process.argv.slice(2)): Promise<CliContext> {
  const launcher = new NodeProcessLauncher();
  const adapter = new CurrentClaudeAdapter(launcher);
  const store = new JsonStateStore(stateRootFromArgv(argv, cwd));
  return {
    adapter,
    launcher,
    store,
    inventoryService: new DefaultInventoryService(adapter, store),
    repoAnalyzer: new DefaultRepoAnalyzer(launcher),
    cwd,
    json
  };
}

export async function loadConfig(store: StateStore): Promise<CCOConfig> {
  return store.readConfig();
}

export function printJson(data: unknown, command: string, ok = true, warnings: string[] = [], errors: string[] = []): void {
  process.stdout.write(JSON.stringify({ schemaVersion: 1, command, ok, data, warnings, errors }, null, 2) + '\n');
}
