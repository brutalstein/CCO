import { canonicalHash } from '@cco/platform';
import type { ClaudeAdapter, ClaudeEnvironment } from '@cco/claude-adapter';
import type { StateStore } from '../state/store.js';
import { SCHEMA_VERSION, type InventorySnapshot } from '../types.js';

export interface InventoryFingerprintInput {
  claudeVersion: string | null;
  cwd: string;
}

export interface InventoryRequest {
  cwd: string;
  claudeBinaryHint?: string;
  forceRefresh?: boolean;
}

/**
 * Read-only inventory builder (FR-002, 32_ALGORITHMS_PSEUDOCODE.md section 1).
 * Never executes third-party extension code; on any Claude-facing failure it returns
 * a partial snapshot rather than throwing, so callers can fall back to native mode.
 */
export interface InventoryService {
  fingerprint(input: InventoryFingerprintInput): Promise<string>;
  loadOrRefresh(request: InventoryRequest): Promise<InventorySnapshot>;
}

const DETAILS_CONCURRENCY = 4;

export class DefaultInventoryService implements InventoryService {
  constructor(
    private readonly adapter: ClaudeAdapter,
    private readonly store: StateStore
  ) {}

  async fingerprint(input: InventoryFingerprintInput): Promise<string> {
    return `inv_${canonicalHash({ version: input.claudeVersion, cwd: input.cwd })}`;
  }

  async loadOrRefresh(request: InventoryRequest): Promise<InventorySnapshot> {
    const env: ClaudeEnvironment = await this.adapter.probe({ claudeBinaryHint: request.claudeBinaryHint, cwd: request.cwd });
    const fp = await this.fingerprint({ claudeVersion: env.version, cwd: request.cwd });

    if (!request.forceRefresh) {
      const cached = await this.store.getSnapshot<InventorySnapshot>('inventory', fp);
      if (cached) return cached;
    }

    if (!env.found) {
      return this.emptySnapshot(fp, env, ['claude binary not found']);
    }

    const plugins = await this.adapter.listPlugins({ cwd: request.cwd, env });
    const missingSources: string[] = [];
    const pluginDetails: InventorySnapshot['pluginDetails'] = {};

    for (let i = 0; i < plugins.length; i += DETAILS_CONCURRENCY) {
      const batch = plugins.slice(i, i + DETAILS_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (p) => {
          try {
            return await this.adapter.pluginDetails(p.canonicalId, { cwd: request.cwd, env });
          } catch {
            return null;
          }
        })
      );
      results.forEach((detail, idx) => {
        const id = batch[idx].canonicalId;
        if (detail) {
          pluginDetails[id] = {
            alwaysOnTokens: detail.alwaysOnTokens,
            source: detail.tokenSource,
            description: detail.description,
            dependencies: detail.dependencies,
            riskFlags: detail.riskFlags,
            components: detail.components
          };
        } else {
          missingSources.push(id);
        }
      });
    }

    const snapshot: InventorySnapshot = {
      schemaVersion: SCHEMA_VERSION,
      id: fp,
      capturedAt: new Date().toISOString(),
      claude: env,
      plugins,
      pluginDetails,
      partial: missingSources.length > 0 || plugins.length === 0,
      missingSources
    };

    await this.store.putSnapshot('inventory', snapshot);
    return snapshot;
  }

  private emptySnapshot(fp: string, env: ClaudeEnvironment, missing: string[]): InventorySnapshot {
    return {
      schemaVersion: SCHEMA_VERSION,
      id: fp,
      capturedAt: new Date().toISOString(),
      claude: env,
      plugins: [],
      pluginDetails: {},
      partial: true,
      missingSources: missing
    };
  }
}
