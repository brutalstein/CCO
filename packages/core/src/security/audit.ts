import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { PluginInventorySource } from '@cco/claude-adapter';

export interface StaticAuditFinding {
  pluginId: string;
  indicator: string;
  provenance: 'claude-metadata' | 'bounded-static-scan';
  relativePath?: string;
}

export interface DeepAuditOptions {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_DEEP_AUDIT_OPTIONS: DeepAuditOptions = {
  maxFiles: 250,
  maxFileBytes: 128 * 1024,
  maxTotalBytes: 1024 * 1024
};

const STATIC_FILES = new Set(['hooks.json', 'plugin.json', 'package.json', '.mcp.json', '.lsp.json', 'monitors.json', 'SKILL.md']);
const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.sh', '.ps1', '.cmd', '.bat', '.py']);
const SKIP_DIRS = new Set(['.git', 'node_modules']);

function add(findings: StaticAuditFinding[], pluginId: string, indicator: string, relativePath: string): void {
  if (!findings.some((finding) => finding.indicator === indicator && finding.relativePath === relativePath)) {
    findings.push({ pluginId, indicator, provenance: 'bounded-static-scan', relativePath });
  }
}

/** Bounded static inspection of a Claude-owned plugin cache. Never executes extension code. */
export async function deepAuditPlugin(
  plugin: PluginInventorySource,
  options: DeepAuditOptions = DEFAULT_DEEP_AUDIT_OPTIONS
): Promise<StaticAuditFinding[]> {
  if (!plugin.installPath) return [];
  const root = path.resolve(plugin.installPath);
  const rootStat = await fs.lstat(root).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) return [];

  const findings: StaticAuditFinding[] = [];
  const stack = [root];
  let inspectedFiles = 0;
  let inspectedBytes = 0;

  while (stack.length > 0 && inspectedFiles < options.maxFiles && inspectedBytes < options.maxTotalBytes) {
    const dir = stack.pop() as string;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (inspectedFiles >= options.maxFiles || inspectedBytes >= options.maxTotalBytes) break;
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (entry.isSymbolicLink()) {
        add(findings, plugin.canonicalId, 'symlink boundary skipped', relative);
        continue;
      }
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile() || (!STATIC_FILES.has(entry.name) && !SCRIPT_EXTENSIONS.has(path.extname(entry.name)))) continue;

      const stat = await fs.stat(full).catch(() => null);
      if (!stat || stat.size > options.maxFileBytes) continue;
      const remaining = options.maxTotalBytes - inspectedBytes;
      if (stat.size > remaining) break;
      const text = await fs.readFile(full, 'utf8').catch(() => '');
      inspectedFiles += 1;
      inspectedBytes += Buffer.byteLength(text);

      if (entry.name === 'hooks.json' || /\/hooks\//i.test('/' + relative)) {
        add(findings, plugin.canonicalId, 'executable hook present', relative);
      }
      if (entry.name === 'monitors.json' || /\/monitors\//i.test('/' + relative)) {
        add(findings, plugin.canonicalId, 'monitor/background executable present', relative);
      }
      if (/"type"\s*:\s*"http"|\b(?:curl|wget|Invoke-WebRequest)\b|https?:\/\//i.test(text)) {
        add(findings, plugin.canonicalId, 'network-capable static reference', relative);
      }
      if ((entry.name === '.mcp.json' || entry.name === 'plugin.json') && /"env"\s*:/.test(text) && /(?:token|secret|password|api[_-]?key|authorization)/i.test(text)) {
        add(findings, plugin.canonicalId, 'MCP environment references credential-shaped keys', relative);
      }
      if (entry.name === 'SKILL.md' && /allowed-tools\s*:.*(?:Bash|PowerShell).*\*/i.test(text)) {
        add(findings, plugin.canonicalId, 'broad shell tool grant in skill', relative);
      }
      if (SCRIPT_EXTENSIONS.has(path.extname(entry.name)) && /\b(?:exec|execFile|spawn|child_process|Start-Process|sh\s+-c)\b/i.test(text)) {
        add(findings, plugin.canonicalId, 'script contains subprocess launch surface', relative);
      }
    }
  }

  if (stack.length > 0) add(findings, plugin.canonicalId, 'deep audit cap reached; result is partial', '.');
  return findings;
}
