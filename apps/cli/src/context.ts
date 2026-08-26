import { CurrentClaudeAdapter, type ClaudeAdapter } from '@cco/claude-adapter';
import { NodeProcessLauncher, type ProcessLauncher } from '@cco/platform';
import { JsonStateStore, DefaultInventoryService, DefaultRepoAnalyzer, type StateStore, type CCOConfig } from '@cco/core';

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

export async function createContext(cwd: string, json: boolean): Promise<CliContext> {
  const launcher = new NodeProcessLauncher();
  const adapter = new CurrentClaudeAdapter(launcher);
  const store = new JsonStateStore();
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
