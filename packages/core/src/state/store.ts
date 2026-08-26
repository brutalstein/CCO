import path from 'node:path';
import { promises as fs } from 'node:fs';
import { resolvePlatformPaths, atomicWriteJson, readJsonIfExists, appendJsonl, ensureDir, canonicalHash, type PlatformPaths } from '@cco/platform';
import { validateConfig } from '../config/validate.js';
import { defaultConfig } from '../config/defaults.js';
import type { CCOConfig, TelemetryEvent } from '../types.js';

export type SnapshotKind = 'inventory' | 'graph' | 'profile' | 'evidence';

/**
 * Deterministic graph snapshot id, shared by the launcher (which stores the graph) and the
 * hook runtimes (CLI + plugin bundle), which re-derive it from the profile's own
 * inventoryId/repoFingerprintId fields instead of needing a new reserved env var
 * (24_CONFIGURATION_REFERENCE.md section 10 keeps the env var list fixed).
 */
export function graphSnapshotId(inventoryId: string, repoFingerprintId: string): string {
  return 'graph_' + canonicalHash({ inventoryId, repoFingerprintId });
}

export interface RetentionPolicy {
  eventRetentionDays: number;
}

export interface CleanupReport {
  removedFiles: string[];
}

export interface StateStore {
  readConfig(): Promise<CCOConfig>;
  writeConfig(config: CCOConfig): Promise<void>;
  getSnapshot<T>(kind: SnapshotKind, id: string): Promise<T | null>;
  putSnapshot<T extends { id: string }>(kind: SnapshotKind, value: T): Promise<string>;
  appendEvent(event: TelemetryEvent): Promise<void>;
  cleanup(policy: RetentionPolicy): Promise<CleanupReport>;
  paths: PlatformPaths;
}

const KIND_DIR: Record<SnapshotKind, keyof PlatformPaths> = {
  inventory: 'inventoriesDir',
  graph: 'graphsDir',
  profile: 'profilesDir',
  evidence: 'evidenceDir'
};

/**
 * JSON-file / JSONL state store (03_SYSTEM_ARCHITECTURE.md section 3.11, ADR-010).
 * No database dependency; every write is atomic.
 */
export class JsonStateStore implements StateStore {
  paths: PlatformPaths;

  constructor(overrideRoot?: string) {
    this.paths = resolvePlatformPaths(overrideRoot);
  }

  private configPath(): string {
    return path.join(this.paths.configDir, 'config.json');
  }

  async readConfig(): Promise<CCOConfig> {
    const raw = await readJsonIfExists<unknown>(this.configPath());
    if (raw === null) return defaultConfig();
    const { config } = validateConfig(raw);
    return config;
  }

  async writeConfig(config: CCOConfig): Promise<void> {
    const { ok, errors, config: validated } = validateConfig(config);
    if (!ok) throw new Error(`invalid config: ${errors.join('; ')}`);
    await atomicWriteJson(this.configPath(), validated);
  }

  async getSnapshot<T>(kind: SnapshotKind, id: string): Promise<T | null> {
    const dir = this.paths[KIND_DIR[kind]];
    return readJsonIfExists<T>(path.join(dir, `${id}.json`));
  }

  async putSnapshot<T extends { id: string }>(kind: SnapshotKind, value: T): Promise<string> {
    const dir = this.paths[KIND_DIR[kind]];
    await atomicWriteJson(path.join(dir, `${value.id}.json`), value);
    return value.id;
  }

  async appendEvent(event: TelemetryEvent): Promise<void> {
    const day = event.timestamp.slice(0, 10);
    await appendJsonl(path.join(this.paths.eventsDir, `${day}.jsonl`), event);
  }

  async cleanup(policy: RetentionPolicy): Promise<CleanupReport> {
    const removed: string[] = [];
    await ensureDir(this.paths.eventsDir);
    const files = await fs.readdir(this.paths.eventsDir).catch(() => [] as string[]);
    const cutoff = Date.now() - policy.eventRetentionDays * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const match = file.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (!match) continue;
      const fileDate = new Date(match[1]).getTime();
      if (fileDate < cutoff) {
        await fs.unlink(path.join(this.paths.eventsDir, file)).catch(() => undefined);
        removed.push(file);
      }
    }
    await this.cleanupStaleTmp(removed);
    return { removedFiles: removed };
  }

  private async cleanupStaleTmp(removed: string[]): Promise<void> {
    const files = await fs.readdir(this.paths.tmpDir).catch(() => [] as string[]);
    const staleMs = 24 * 60 * 60 * 1000;
    for (const file of files) {
      const full = path.join(this.paths.tmpDir, file);
      const stat = await fs.stat(full).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > staleMs) {
        await fs.unlink(full).catch(() => undefined);
        removed.push(file);
      }
    }
  }
}
