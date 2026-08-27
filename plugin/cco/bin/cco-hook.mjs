#!/usr/bin/env node

// scripts/plugin-hook-entry.mjs
import path4 from "node:path";

// packages/platform/dist/paths.js
import os from "node:os";
import path from "node:path";
function baseDir() {
  const home = os.homedir();
  if (process.platform === "win32") {
    return process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support");
  }
  return process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
}
function resolvePlatformPaths(overrideRoot) {
  const root = overrideRoot ?? path.join(baseDir(), "cco");
  const stateDir = path.join(root, "state");
  return {
    configDir: path.join(root, "config"),
    stateDir,
    tmpDir: path.join(stateDir, "tmp"),
    inventoriesDir: path.join(stateDir, "inventories"),
    graphsDir: path.join(stateDir, "graphs"),
    profilesDir: path.join(stateDir, "profiles"),
    evidenceDir: path.join(stateDir, "evidence"),
    eventsDir: path.join(stateDir, "events"),
    cacheDir: path.join(stateDir, "cache", "plugin-details")
  };
}

// packages/platform/dist/atomic-files.js
import { promises as fs } from "node:fs";
import path2 from "node:path";
import crypto from "node:crypto";
async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 448 });
  const stat = await fs.lstat(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error(`refusing unsafe state directory: ${dir}`);
  await fs.chmod(dir, 448).catch(() => void 0);
}
async function assertNotSymlink(filePath) {
  const stat = await fs.lstat(filePath).catch((error) => {
    if (error.code === "ENOENT")
      return null;
    throw error;
  });
  if (stat?.isSymbolicLink())
    throw new Error(`refusing symbolic-link file target: ${filePath}`);
}
async function atomicWriteFile(filePath, content) {
  await ensureDir(path2.dirname(filePath));
  await assertNotSymlink(filePath);
  const tmp = path2.join(path2.dirname(filePath), `.${path2.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  await fs.writeFile(tmp, content, { mode: 384 });
  await fs.rename(tmp, filePath);
  await fs.chmod(filePath, 384).catch(() => void 0);
}
async function atomicWriteJson(filePath, value) {
  await atomicWriteFile(filePath, JSON.stringify(value, null, 2) + "\n");
}
async function readJsonIfExists(filePath) {
  try {
    await assertNotSymlink(filePath);
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function appendJsonl(filePath, value) {
  await ensureDir(path2.dirname(filePath));
  await assertNotSymlink(filePath);
  await fs.appendFile(filePath, JSON.stringify(value) + "\n", { mode: 384 });
  await fs.chmod(filePath, 384).catch(() => void 0);
}
function canonicalHash(value) {
  const json = canonicalStringify(value);
  return crypto.createHash("sha256").update(json).digest("hex");
}
function canonicalStringify(value) {
  return JSON.stringify(sortKeysDeep(value));
}
function sortKeysDeep(value) {
  if (Array.isArray(value))
    return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}

// packages/claude-adapter/dist/hook-codec.js
function normalizeHookInput(event, raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    event,
    sessionId: typeof r.session_id === "string" ? r.session_id : typeof r.sessionId === "string" ? r.sessionId : "",
    cwd: typeof r.cwd === "string" ? r.cwd : process.cwd(),
    transcriptPath: typeof r.transcript_path === "string" ? r.transcript_path : void 0,
    permissionMode: typeof r.permission_mode === "string" ? r.permission_mode : void 0,
    source: typeof r.source === "string" ? r.source : void 0,
    prompt: typeof r.prompt === "string" ? r.prompt : void 0
  };
}
var CONTROL_CHARS = new RegExp("[\0-\b\v-\x7F]", "g");
function sanitizeContextText(text, maxChars = 1200) {
  const stripped = text.replace(CONTROL_CHARS, "");
  return stripped.length > maxChars ? stripped.slice(0, maxChars) : stripped;
}
function encodeHookContext(event, text) {
  return {
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: sanitizeContextText(text)
    }
  };
}

// packages/core/dist/types.js
var SCHEMA_VERSION = 1;
var CCO_VERSION = "1.0.0";
var INTENT_CLASSIFIER_VERSION = "intent-1";

// packages/core/dist/config/defaults.js
function defaultConfig() {
  return {
    schemaVersion: SCHEMA_VERSION,
    mode: "safe",
    profile: { strategy: "auto", defaultName: null, neverDisable: [], protected: [] },
    routing: {
      enabled: true,
      confidenceThreshold: 0.78,
      ambiguityMargin: 0.12,
      maxInjectedTokens: 220,
      hardDeadlineMs: 100,
      tieBreaker: "none"
    },
    optimization: {
      safePruneAffinityMax: 0.08,
      metadataConfidenceMin: 0.8,
      quality: {
        mode: "non-inferiority",
        defaultTolerance: 0,
        minExploratoryTrialsPerArm: 3,
        publicClaimTrialsPerArm: 10
      },
      modelOptimization: false,
      preferStableProfile: true
    },
    repository: { maxTrackedFiles: 5e4, maxManifestBytes: 262144, maxTotalParsedBytes: 4194304, deepScan: false },
    privacy: {
      storeRawPrompts: false,
      storeTranscriptContent: false,
      storePromptHash: true,
      remoteTelemetry: false,
      eventRetentionDays: 30
    },
    benchmark: { defaultTrials: 3, isolation: "copy", saveRawStreams: true },
    experimental: { agentTeams: false, llmRoutingTieBreaker: false }
  };
}

// packages/core/dist/config/validate.js
var KNOWN_TOP_KEYS = /* @__PURE__ */ new Set([
  "schemaVersion",
  "mode",
  "profile",
  "routing",
  "optimization",
  "repository",
  "privacy",
  "benchmark",
  "experimental"
]);
function validateConfig(input) {
  const errors = [];
  const base = defaultConfig();
  if (input === null || typeof input !== "object") {
    return { ok: true, config: base, errors: [] };
  }
  const obj = input;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_TOP_KEYS.has(key))
      errors.push(`unknown config key: ${key}`);
  }
  const merged = structuredClone(base);
  if (typeof obj.mode === "string" && ["observe", "safe", "aggressive", "native"].includes(obj.mode)) {
    merged.mode = obj.mode;
  } else if (obj.mode !== void 0) {
    errors.push("mode must be one of observe|safe|aggressive|native");
  }
  const routing = obj.routing;
  if (routing) {
    if (routing.confidenceThreshold !== void 0) {
      if (routing.confidenceThreshold < 0.5 || routing.confidenceThreshold > 0.99) {
        errors.push("routing.confidenceThreshold out of safe range [0.5, 0.99]");
      } else
        merged.routing.confidenceThreshold = routing.confidenceThreshold;
    }
    if (routing.ambiguityMargin !== void 0) {
      if (routing.ambiguityMargin < 0.01 || routing.ambiguityMargin > 0.5) {
        errors.push("routing.ambiguityMargin out of safe range [0.01, 0.5]");
      } else
        merged.routing.ambiguityMargin = routing.ambiguityMargin;
    }
    if (routing.maxInjectedTokens !== void 0) {
      if (routing.maxInjectedTokens < 0 || routing.maxInjectedTokens > 220) {
        errors.push("routing.maxInjectedTokens out of safe range [0, 220]");
      } else
        merged.routing.maxInjectedTokens = routing.maxInjectedTokens;
    }
    if (routing.enabled !== void 0)
      merged.routing.enabled = Boolean(routing.enabled);
    if (routing.tieBreaker !== void 0) {
      if (routing.tieBreaker !== "none" && routing.tieBreaker !== "claude") {
        errors.push("routing.tieBreaker must be none|claude");
      } else
        merged.routing.tieBreaker = routing.tieBreaker;
    }
  }
  const profile = obj.profile;
  if (profile) {
    if (Array.isArray(profile.neverDisable))
      merged.profile.neverDisable = profile.neverDisable.filter((x) => typeof x === "string");
    if (Array.isArray(profile.protected))
      merged.profile.protected = profile.protected.filter((x) => typeof x === "string");
    if (typeof profile.defaultName === "string")
      merged.profile.defaultName = profile.defaultName;
  }
  const privacy = obj.privacy;
  if (privacy) {
    if (privacy.remoteTelemetry === true) {
      errors.push("privacy.remoteTelemetry cannot be enabled: no remote backend ships with CCO (11_SECURITY section 12)");
    }
    if (privacy.storeRawPrompts !== void 0)
      merged.privacy.storeRawPrompts = Boolean(privacy.storeRawPrompts);
    if (privacy.storeTranscriptContent !== void 0)
      merged.privacy.storeTranscriptContent = Boolean(privacy.storeTranscriptContent);
    if (privacy.eventRetentionDays !== void 0)
      merged.privacy.eventRetentionDays = privacy.eventRetentionDays;
  }
  const experimental = obj.experimental;
  if (experimental) {
    if (experimental.agentTeams !== void 0)
      merged.experimental.agentTeams = Boolean(experimental.agentTeams);
    if (experimental.llmRoutingTieBreaker !== void 0)
      merged.experimental.llmRoutingTieBreaker = Boolean(experimental.llmRoutingTieBreaker);
  }
  const optimization = obj.optimization;
  if (optimization) {
    if (optimization.modelOptimization !== void 0)
      merged.optimization.modelOptimization = Boolean(optimization.modelOptimization);
    if (optimization.safePruneAffinityMax !== void 0) {
      if (optimization.safePruneAffinityMax < 0 || optimization.safePruneAffinityMax > 1) {
        errors.push("optimization.safePruneAffinityMax out of safe range [0, 1]");
      } else
        merged.optimization.safePruneAffinityMax = optimization.safePruneAffinityMax;
    }
    if (optimization.metadataConfidenceMin !== void 0) {
      if (optimization.metadataConfidenceMin < 0 || optimization.metadataConfidenceMin > 1) {
        errors.push("optimization.metadataConfidenceMin out of safe range [0, 1]");
      } else
        merged.optimization.metadataConfidenceMin = optimization.metadataConfidenceMin;
    }
  }
  return { ok: errors.length === 0, config: merged, errors };
}

// packages/core/dist/security/redact.js
var SECRET_KEY_RE = /token|secret|password|authorization|cookie|apikey|api_key/i;
var CREDENTIAL_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{10,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /[a-zA-Z0-9._-]*[Aa]uth[a-zA-Z0-9._-]*=[^\s&]+/g
];
var MAX_ERROR_STRING_LENGTH = 2e3;
function redactValue(value) {
  let text = value;
  for (const pattern of CREDENTIAL_PATTERNS) {
    text = text.replace(pattern, "[REDACTED]");
  }
  return capLength(text, MAX_ERROR_STRING_LENGTH);
}
function capLength(text, max) {
  return text.length > max ? text.slice(0, max) + "...[truncated]" : text;
}
function redactObject(value) {
  if (value === null || value === void 0)
    return value;
  if (typeof value === "string")
    return redactValue(value);
  if (Array.isArray(value))
    return value.map((v) => redactObject(v));
  if (typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SECRET_KEY_RE.test(key) ? "[REDACTED]" : redactObject(v);
    }
    return out;
  }
  return value;
}

// packages/core/dist/security/validator.js
function major(version) {
  return version.split(".")[0] ?? "";
}
function profileIntegrityHash(profile) {
  return canonicalHash({ ...profile, integrityHash: void 0, id: void 0, createdAt: void 0 });
}
function validateProfileIntegrity(profile, runtimeVersion = CCO_VERSION) {
  const issues = [];
  if (profile.schemaVersion !== SCHEMA_VERSION) {
    issues.push({ code: "PROFILE_SCHEMA_MISMATCH", message: "profile schema is incompatible with this runtime" });
  }
  if (!profile.ccoVersion || major(profile.ccoVersion) !== major(runtimeVersion)) {
    issues.push({ code: "CCO_VERSION_MISMATCH", message: "CLI/plugin major versions do not match" });
  }
  if (profile.integrityHash !== profileIntegrityHash(profile)) {
    issues.push({ code: "PROFILE_INTEGRITY", message: "profile integrity hash is invalid" });
  }
  return issues;
}
function validateHookArtifacts(profile, graph, runtimeVersion = CCO_VERSION) {
  const issues = validateProfileIntegrity(profile, runtimeVersion);
  if (!graph) {
    issues.push({ code: "GRAPH_MISSING", message: "profile graph is missing" });
    return issues;
  }
  if (graph.schemaVersion !== SCHEMA_VERSION || graph.inventoryFingerprint !== profile.inventoryId || graph.sourceHashes.repo !== profile.repoFingerprintId) {
    issues.push({ code: "GRAPH_STALE", message: "profile and capability graph fingerprints do not match" });
  }
  const graphIds = new Set(graph.nodes.map((node) => node.id));
  if (profile.runtimeCapabilityIds.some((id) => !graphIds.has(id))) {
    issues.push({ code: "RUNTIME_CAPABILITY_MISSING", message: "profile references a capability absent from its graph" });
  }
  return issues;
}

// packages/core/dist/security/audit.js
var DEFAULT_DEEP_AUDIT_OPTIONS = {
  maxFiles: 250,
  maxFileBytes: 128 * 1024,
  maxTotalBytes: 1024 * 1024
};

// packages/core/dist/state/store.js
import path3 from "node:path";
import { promises as fs2 } from "node:fs";
function graphSnapshotId(inventoryId, repoFingerprintId) {
  return "graph_" + canonicalHash({ inventoryId, repoFingerprintId });
}
var KIND_DIR = {
  inventory: "inventoriesDir",
  graph: "graphsDir",
  profile: "profilesDir",
  evidence: "evidenceDir"
};
var SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,199}$/;
function assertSnapshotId(id) {
  if (!SNAPSHOT_ID.test(id))
    throw new Error("invalid snapshot id");
}
var JsonStateStore = class {
  paths;
  constructor(overrideRoot) {
    this.paths = resolvePlatformPaths(overrideRoot);
  }
  configPath() {
    return path3.join(this.paths.configDir, "config.json");
  }
  async readConfig() {
    const raw = await readJsonIfExists(this.configPath());
    if (raw === null)
      return defaultConfig();
    const { config } = validateConfig(raw);
    return config;
  }
  async writeConfig(config) {
    const { ok, errors, config: validated } = validateConfig(config);
    if (!ok)
      throw new Error(`invalid config: ${errors.join("; ")}`);
    await atomicWriteJson(this.configPath(), validated);
  }
  async getSnapshot(kind, id) {
    assertSnapshotId(id);
    const dir = this.paths[KIND_DIR[kind]];
    return readJsonIfExists(path3.join(dir, `${id}.json`));
  }
  async putSnapshot(kind, value) {
    assertSnapshotId(value.id);
    const dir = this.paths[KIND_DIR[kind]];
    await atomicWriteJson(path3.join(dir, `${value.id}.json`), value);
    return value.id;
  }
  /**
   * All persisted evidence records (06_SESSION_PROFILE_COMPILER.md aggressive-mode gate,
   * 09_QUALITY_MODEL_AND_EVALS.md). `evidenceDir` also holds per-suite subdirectories of raw
   * `BenchmarkRun` JSON (apps/cli benchmark command) — only top-level files are records.
   */
  async listEvidence() {
    const dir = this.paths.evidenceDir;
    const entries = await fs2.readdir(dir, { withFileTypes: true }).catch(() => []);
    const records = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json"))
        continue;
      const record = await readJsonIfExists(path3.join(dir, entry.name));
      if (record)
        records.push(record);
    }
    return records;
  }
  async appendEvent(event) {
    const day = event.timestamp.slice(0, 10);
    await appendJsonl(path3.join(this.paths.eventsDir, `${day}.jsonl`), event);
  }
  async cleanup(policy) {
    const removed = [];
    await ensureDir(this.paths.eventsDir);
    const files = await fs2.readdir(this.paths.eventsDir).catch(() => []);
    const cutoff = Date.now() - policy.eventRetentionDays * 24 * 60 * 60 * 1e3;
    for (const file of files) {
      const match = file.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (!match)
        continue;
      const fileDate = new Date(match[1]).getTime();
      if (fileDate < cutoff) {
        await fs2.unlink(path3.join(this.paths.eventsDir, file)).catch(() => void 0);
        removed.push(file);
      }
    }
    await this.cleanupStaleTmp(removed);
    return { removedFiles: removed };
  }
  async cleanupStaleTmp(removed) {
    const files = await fs2.readdir(this.paths.tmpDir).catch(() => []);
    const staleMs = 24 * 60 * 60 * 1e3;
    for (const file of files) {
      const full = path3.join(this.paths.tmpDir, file);
      const stat = await fs2.stat(full).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > staleMs) {
        await fs2.unlink(full).catch(() => void 0);
        removed.push(file);
      }
    }
  }
};

// packages/core/dist/graph/tags.js
var DICTIONARY = [
  { tag: "lang:typescript", keywords: ["typescript", "tsx", "ts"] },
  { tag: "lang:javascript", keywords: ["javascript", "jsx", "node.js", "nodejs"] },
  { tag: "lang:python", keywords: ["python", "django", "flask", "fastapi", "pytest"] },
  { tag: "lang:rust", keywords: ["rust", "cargo"] },
  { tag: "lang:go", keywords: ["golang", "go"] },
  { tag: "framework:react", keywords: ["react", "jsx", "tsx"] },
  { tag: "framework:vite", keywords: ["vite"] },
  { tag: "framework:nextjs", keywords: ["next.js", "nextjs"] },
  { tag: "domain:security", keywords: ["security", "auth", "vulnerability", "threat", "owasp"] },
  { tag: "domain:testing", keywords: ["test", "testing", "tdd", "coverage"] },
  { tag: "domain:database", keywords: ["database", "sql", "postgres", "mysql", "schema", "migration"] },
  // 'frontend-ui'/'backend-api' match RepoFingerprint.domains verbatim (repo/fingerprint.ts)
  // so an auto-tagged plugin's domain actually lines up with repo-derived affinity tags
  // (graph/builder.ts, profile/compiler.ts, routing/scoring.ts all do `domain:${repo.domains}`).
  // 'design' deliberately excluded: too generic ("design a database schema", "design an API")
  // to be a reliable frontend-only signal even with whole-word matching.
  { tag: "domain:frontend-ui", keywords: ["frontend", "ui", "css", "component"] },
  { tag: "domain:backend-api", keywords: ["backend", "api", "server", "express", "fastify", "rest api"] },
  { tag: "domain:mobile", keywords: ["ios", "android", "mobile", "swift", "kotlin"] },
  { tag: "domain:infrastructure", keywords: ["kubernetes", "docker", "terraform", "deploy", "ci/cd", "infrastructure"] },
  { tag: "operation:code-review", keywords: ["review", "code review"] },
  { tag: "operation:git", keywords: ["git", "commit", "branch", "pull request"] },
  { tag: "operation:debug", keywords: ["debug", "bug", "fix"] },
  { tag: "operation:deployment", keywords: ["deploy", "release", "publish"] },
  { tag: "operation:documentation", keywords: ["docs", "documentation", "readme"] }
];
function isWordChar(ch) {
  return ch !== void 0 && /[a-z0-9]/.test(ch);
}
function hasWholeWordMatch(text, keyword) {
  let from = 0;
  for (; ; ) {
    const idx = text.indexOf(keyword, from);
    if (idx === -1)
      return false;
    if (!isWordChar(text[idx - 1]) && !isWordChar(text[idx + keyword.length]))
      return true;
    from = idx + 1;
  }
}
function extractTags(name, description, source) {
  const text = ` ${name.toLowerCase()} ${description.toLowerCase()} `;
  const out = [];
  for (const entry of DICTIONARY) {
    const hit = entry.keywords.some((k) => hasWholeWordMatch(text, k.toLowerCase()));
    if (hit)
      out.push({ id: entry.tag, confidence: 0.85, source });
  }
  return dedupe(out);
}
function dedupe(tags) {
  const seen = /* @__PURE__ */ new Map();
  for (const t of tags) {
    const existing = seen.get(t.id);
    if (!existing || existing.confidence < t.confidence)
      seen.set(t.id, t);
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// packages/core/dist/routing/classifier.js
var STOPWORDS = /* @__PURE__ */ new Set(["it", "the", "a", "an", "this", "that", "please", "can", "you", "i", "my", "to", "is", "for"]);
function meaningfulWordCount(prompt) {
  const words = prompt.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.filter((w) => !STOPWORDS.has(w)).length;
}
var DefaultIntentClassifier = class {
  classify(input) {
    const tags = extractTags("", input.prompt, "prompt");
    const operations = tags.filter((t) => t.id.startsWith("operation:")).map((t) => t.id.slice("operation:".length));
    const domains = tags.filter((t) => t.id.startsWith("domain:")).map((t) => t.id.slice("domain:".length));
    const languages = tags.filter((t) => t.id.startsWith("lang:")).map((t) => t.id.slice("lang:".length));
    const artifacts = tags.filter((t) => t.id.startsWith("framework:")).map((t) => t.id.slice("framework:".length));
    const meaningfulWords = meaningfulWordCount(input.prompt);
    const specific = domains.length > 0 || languages.length > 0 || operations.length > 1;
    let confidence = 0;
    if (meaningfulWords <= 1) {
      confidence = 0.25;
    } else if (tags.length === 0) {
      confidence = 0.2;
    } else {
      confidence = Math.min(0.5 + tags.length * 0.12 + (specific ? 0.15 : 0), 0.97);
    }
    const parallelism = /\b(multiple|several|parallel|all files|every file|across)\b/i.test(input.prompt) ? "high" : "low";
    const complexity = meaningfulWords > 25 ? "high" : meaningfulWords > 8 ? "medium" : "low";
    return {
      schemaVersion: SCHEMA_VERSION,
      operations,
      domains,
      languages,
      artifacts,
      complexity,
      parallelism,
      confidence,
      classifierVersion: INTENT_CLASSIFIER_VERSION
    };
  }
};

// packages/core/dist/routing/scoring.js
function taskTagIds(intent) {
  return /* @__PURE__ */ new Set([
    ...intent.operations.map((o) => "operation:" + o),
    ...intent.domains.map((d) => "domain:" + d),
    ...intent.languages.map((l) => "lang:" + l)
  ]);
}
function repoTagIds(repo) {
  if (!repo)
    return /* @__PURE__ */ new Set();
  return /* @__PURE__ */ new Set([...repo.languages.map((l) => "lang:" + l.id), ...repo.frameworks.map((f) => "framework:" + f), ...repo.domains.map((d) => "domain:" + d)]);
}
function tokenOverlap(a, b) {
  const ta = new Set(a.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const tb = new Set(b.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  if (ta.size === 0 || tb.size === 0)
    return 0;
  let inter = 0;
  for (const t of ta)
    if (tb.has(t))
      inter += 1;
  return inter / Math.max(ta.size, tb.size);
}
function scoreCapability(node, intent, repo, evidence, graph) {
  const taskTags = taskTagIds(intent);
  const repoTags = repoTagIds(repo);
  const nodeText = node.displayName + " " + node.tags.map((t) => t.id).join(" ");
  const intentText = [...intent.operations, ...intent.domains, ...intent.languages].join(" ");
  const lexicalMatch = tokenOverlap(nodeText, intentText);
  const tagHits = node.tags.filter((t) => taskTags.has(t.id));
  const coverage = taskTags.size > 0 ? tagHits.length / taskTags.size : 0;
  const repoAffinity = node.tags.some((t) => repoTags.has(t.id)) ? Math.max(...node.tags.filter((t) => repoTags.has(t.id)).map((t) => t.confidence), 0) : 0;
  const evidencePrior = evidence.records.some((r) => r.status === "active" && r.taskFamily.some((f) => intent.operations.includes(f))) ? 0.6 : 0.3;
  const specificity = node.type === "plugin" ? 0.3 : 0.7;
  const availabilityConfidence = node.metadataConfidence;
  const redundancyPenalty = graph.edges.some((e) => e.type === "redundant_with" && (e.from === node.id || e.to === node.id)) ? 0.05 : 0;
  const experimentalPenalty = node.riskFlags.includes("experimental") ? 0.1 : 0;
  const score = 0.35 * lexicalMatch + 0.2 * coverage + 0.15 * repoAffinity + 0.15 * evidencePrior + 0.1 * specificity + 0.05 * availabilityConfidence - redundancyPenalty - experimentalPenalty;
  return { node, score, coverage };
}
function rankCapabilities(nodes, intent, repo, evidence, graph) {
  return nodes.map((node) => scoreCapability(node, intent, repo, evidence, graph)).sort((a, b) => b.score - a.score);
}

// packages/core/dist/planning/planner.js
var NATIVE_COVERAGE_FLOOR = 0.5;
var DefaultPlanner = class {
  candidates(intent, runtime, repo, evidence, agentTeamsEnabled) {
    const nodes = runtime.graph.nodes.filter((n) => runtime.runtimeCapabilityIds.has(n.id) && n.type !== "plugin");
    const ranked = rankCapabilities(nodes, intent, repo, evidence, runtime.graph);
    const plans = [
      {
        type: "native",
        capabilityIds: [],
        expectedQualityClass: "B",
        coverageEstimate: NATIVE_COVERAGE_FLOOR,
        expectedEffectiveCost: 0,
        mainContextRelief: 0,
        experimental: false,
        reasons: ["always-available baseline"]
      }
    ];
    const topSkillOrAgent = ranked.find((r) => r.node.type === "skill" || r.node.type === "agent");
    if (topSkillOrAgent && topSkillOrAgent.score > 0.3) {
      plans.push(this.singleOrPair(topSkillOrAgent, ranked, intent));
    }
    const topWorkflow = ranked.find((r) => r.node.type === "workflow");
    if (topWorkflow && topWorkflow.score > 0.3 && intent.parallelism !== "low") {
      plans.push({
        type: "workflow",
        capabilityIds: [topWorkflow.node.id],
        expectedQualityClass: "C",
        coverageEstimate: topWorkflow.coverage,
        expectedEffectiveCost: 0.3,
        mainContextRelief: 0.2,
        experimental: false,
        reasons: ["native workflow matches structured/parallel intent"]
      });
    }
    if (agentTeamsEnabled && intent.parallelism === "high" && intent.complexity === "high") {
      const agents = ranked.filter((r) => r.node.type === "agent").slice(0, 3);
      if (agents.length >= 2) {
        plans.push({
          type: "agent-team",
          capabilityIds: agents.map((a) => a.node.id),
          expectedQualityClass: "C",
          coverageEstimate: agents[0].coverage,
          expectedEffectiveCost: 0.7,
          mainContextRelief: 0.1,
          experimental: true,
          reasons: ["experimental teams enabled and prompt implies independent parallel work"]
        });
      }
    }
    return plans;
  }
  singleOrPair(top, ranked, intent) {
    const skill = top.node.type === "skill" ? top : ranked.find((r) => r.node.type === "skill");
    const agent = top.node.type === "agent" ? top : ranked.find((r) => r.node.type === "agent");
    if (skill && agent && skill.node.id !== agent.node.id) {
      return {
        type: "skill-agent",
        capabilityIds: [skill.node.id, agent.node.id],
        expectedQualityClass: "B",
        coverageEstimate: Math.max(skill.coverage, agent.coverage),
        expectedEffectiveCost: 0.4,
        mainContextRelief: intent.complexity === "high" ? 0.3 : 0.1,
        experimental: false,
        reasons: ["skill provides procedure, specialized agent bounds implementation"]
      };
    }
    return {
      type: "single-skill",
      capabilityIds: [top.node.id],
      expectedQualityClass: "B",
      coverageEstimate: top.coverage,
      expectedEffectiveCost: 0.15,
      mainContextRelief: 0,
      experimental: false,
      reasons: ["dominant relevance match"]
    };
  }
};

// packages/core/dist/optimization/pareto.js
function paretoFilter(candidates) {
  return candidates.filter((a) => !candidates.some((b) => b !== a && dominates(b.dims, a.dims)));
}
function dominates(b, a) {
  const noWorse = b.quality >= a.quality && b.coverage >= a.coverage && b.cost <= a.cost && b.latency <= a.latency;
  const strictlyBetter = b.quality > a.quality || b.coverage > a.coverage || b.cost < a.cost || b.latency < a.latency;
  return noWorse && strictlyBetter;
}

// packages/core/dist/optimization/optimizer.js
var QUALITY_RANK = { A: 3, B: 2, C: 1, D: 0 };
var DefaultOptimizer = class {
  selectProfile(candidates, _ctx) {
    return candidates.slice().sort((a, b) => QUALITY_RANK[b.qualityClass] - QUALITY_RANK[a.qualityClass] || a.costEstimate - b.costEstimate)[0];
  }
  selectPlan(candidates, ctx) {
    const native = candidates.find((c) => c.type === "native");
    const feasible = candidates.filter((c) => c.expectedQualityClass !== "D" && (!c.experimental || ctx.agentTeamsEnabled));
    if (feasible.length === 0)
      return native ?? candidates[0];
    const wrapped = feasible.map((plan) => ({
      item: plan,
      dims: {
        quality: QUALITY_RANK[plan.expectedQualityClass],
        coverage: plan.coverageEstimate,
        cost: plan.expectedEffectiveCost,
        latency: plan.expectedEffectiveCost
      }
    }));
    const survivors = paretoFilter(wrapped);
    survivors.sort((a, b) => {
      if (b.dims.quality !== a.dims.quality)
        return b.dims.quality - a.dims.quality;
      if (b.dims.coverage !== a.dims.coverage)
        return b.dims.coverage - a.dims.coverage;
      if (a.dims.cost !== b.dims.cost)
        return a.dims.cost - b.dims.cost;
      if (a.item.type === "native")
        return -1;
      if (b.item.type === "native")
        return 1;
      return 0;
    });
    return survivors[0]?.item ?? native ?? candidates[0];
  }
};

// packages/core/dist/routing/router.js
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function sessionIdHash(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++)
    h = Math.imul(31, h) + id.charCodeAt(i) | 0;
  return "h" + (h >>> 0).toString(16);
}
var AMBIGUITY_ABSTAIN_SCORE = 0.28;
var DefaultRuntimeRouter = class {
  route(input) {
    const start = (input.nowMs ?? Date.now)();
    const deadline = start + input.config.routing.hardDeadlineMs;
    const classifier = new DefaultIntentClassifier();
    if (!input.profileValid)
      return this.abstain(input, "STALE_PROFILE", 0);
    if (!input.config.routing.enabled)
      return this.abstain(input, "ROUTING_DISABLED", 0);
    const intent = classifier.classify({ prompt: input.prompt, repo: input.repo });
    if (intent.confidence < 0.3)
      return this.abstain(input, "LOW_INTENT_CONFIDENCE", intent.confidence, intent);
    const runtimeNodes = input.graph.nodes.filter((n) => input.runtimeCapabilityIds.has(n.id) && n.type !== "plugin");
    const rankedAvailable = rankCapabilities(runtimeNodes, intent, input.repo, input.evidence, input.graph);
    if ((input.nowMs ?? Date.now)() > deadline)
      return this.abstain(input, "DEADLINE", intent.confidence, intent);
    const top = rankedAvailable[0];
    const second = rankedAvailable[1];
    const threshold = input.config.routing.confidenceThreshold * AMBIGUITY_ABSTAIN_SCORE * 2;
    if (!top || top.score < threshold) {
      const allNodes = input.graph.nodes.filter((n) => n.type !== "plugin");
      const rankedAll = rankCapabilities(allNodes, intent, input.repo, input.evidence, input.graph);
      const globalTop = rankedAll[0];
      if (globalTop && globalTop.score >= threshold && !input.runtimeCapabilityIds.has(globalTop.node.id)) {
        return this.abstain(input, "OUT_OF_PROFILE_INTENT", intent.confidence, intent);
      }
      return this.abstain(input, "LOW_SCORE", intent.confidence, intent);
    }
    if (second && top.score - second.score < input.config.routing.ambiguityMargin) {
      return this.abstain(input, "AMBIGUOUS", intent.confidence, intent);
    }
    const runtime = { graph: input.graph, runtimeCapabilityIds: input.runtimeCapabilityIds };
    const plans = new DefaultPlanner().candidates(intent, runtime, input.repo, input.evidence, input.agentTeamsEnabled);
    const selected = new DefaultOptimizer().selectPlan(plans, { agentTeamsEnabled: input.agentTeamsEnabled });
    if ((input.nowMs ?? Date.now)() > deadline)
      return this.abstain(input, "DEADLINE", intent.confidence, intent);
    if (selected.type === "native")
      return this.abstain(input, "NATIVE_BEST", intent.confidence, intent);
    const text = this.compactRouteText(selected, intent);
    if (estimateTokens(text) > input.config.routing.maxInjectedTokens) {
      return this.abstain(input, "CONTEXT_BUDGET", intent.confidence, intent);
    }
    if ((input.nowMs ?? Date.now)() > deadline)
      return this.abstain(input, "DEADLINE", intent.confidence, intent);
    const decision = {
      schemaVersion: SCHEMA_VERSION,
      sessionIdHash: sessionIdHash(input.sessionId),
      profileId: input.profileId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      intent: { operations: intent.operations, confidence: intent.confidence },
      action: "inject",
      planType: selected.type,
      capabilityIds: selected.capabilityIds,
      confidence: top.score,
      reasonCode: "HIGH_MARGIN_MATCH",
      injectedEstimatedTokens: estimateTokens(text),
      wallMs: (input.nowMs ?? Date.now)() - start
    };
    return { decision, hintText: text };
  }
  abstain(input, reasonCode, confidence, intent) {
    const decision = {
      schemaVersion: SCHEMA_VERSION,
      sessionIdHash: sessionIdHash(input.sessionId),
      profileId: input.profileId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      intent: { operations: intent?.operations ?? [], confidence },
      action: "abstain",
      planType: "native",
      capabilityIds: [],
      confidence,
      reasonCode,
      injectedEstimatedTokens: 0,
      wallMs: 0
    };
    return { decision, hintText: null };
  }
  compactRouteText(selected, intent) {
    const task = [...intent.operations, ...intent.domains].join("+") || "general";
    const names = selected.capabilityIds.map((id) => id.split("/").pop() ?? id).join(", ");
    return `CCO route (confidence ${intent.confidence.toFixed(2)}): task=${task}. Prefer ${names}. Keep native tool selection; do not use unavailable capabilities.`;
  }
};

// packages/core/dist/telemetry/events.js
import crypto2 from "node:crypto";
var EVENT_VERSION = 1;
function projectIdFromRoot(root) {
  return "project_" + canonicalHash(root);
}
function sessionIdHash2(sessionId, salt = "cco-local-salt") {
  return crypto2.createHash("sha256").update(salt + ":" + sessionId).digest("hex").slice(0, 32);
}
function buildEvent(type, claudeVersion, projectId, sessionId, payload) {
  return {
    schemaVersion: SCHEMA_VERSION,
    eventVersion: EVENT_VERSION,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    type,
    ccoVersion: CCO_VERSION,
    claudeVersion,
    projectId,
    sessionIdHash: sessionIdHash2(sessionId),
    payload: redactObject(payload)
  };
}

// packages/core/dist/hooks/handler.js
function sessionStartDigest(input) {
  if (!input.profile)
    return null;
  const pruned = input.profile.selected.prunedPluginIds.length;
  return `CCO profile ${input.profile.mode}:auto active${pruned > 0 ? ` (${pruned} capability set pruned this session)` : ""}. Runtime routing may suggest only capabilities available in this profile; native Claude behavior remains the fallback.`;
}
function userPromptSubmitRoute(input, prompt, cwd, sessionId) {
  if (!input.profile || !input.graph)
    return { hintText: null, reasonCode: "STALE_PROFILE" };
  const result = new DefaultRuntimeRouter().route({
    prompt,
    cwd,
    sessionId,
    profileId: input.profile.id,
    profileValid: true,
    graph: input.graph,
    runtimeCapabilityIds: new Set(input.profile.runtimeCapabilityIds),
    repo: input.repo,
    evidence: input.evidence,
    config: input.config,
    agentTeamsEnabled: input.agentTeamsEnabled
  });
  return { hintText: result.hintText, reasonCode: result.decision.reasonCode };
}

// scripts/plugin-hook-entry.mjs
var EVENT_MAP = {
  "session-start": "SessionStart",
  "user-prompt-submit": "UserPromptSubmit",
  "session-end": "SessionEnd"
};
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
async function loadHookConfig(store) {
  const override = process.env.CCO_CONFIG_PATH;
  if (!override) return store.readConfig();
  const raw = await readJsonIfExists(override);
  if (raw === null) return defaultConfig();
  return validateConfig(raw).config;
}
async function main() {
  const startedAt = Date.now();
  const event = EVENT_MAP[process.argv[2] ?? ""];
  if (!event) return 0;
  if (process.env.CCO_ACTIVE !== "1") return 0;
  let raw;
  try {
    raw = await readStdin();
  } catch {
    return 0;
  }
  try {
    const hookInput = normalizeHookInput(event, JSON.parse(raw));
    const stateDirEnv = process.env.CCO_STATE_DIR;
    const profilePathEnv = process.env.CCO_PROFILE_PATH;
    if (!stateDirEnv || !profilePathEnv) return 0;
    const root = path4.dirname(stateDirEnv);
    const store = new JsonStateStore(root);
    const config = await loadHookConfig(store);
    const profile = await readJsonIfExists(profilePathEnv);
    if (!profile) return 0;
    const graph = await store.getSnapshot(
      "graph",
      graphSnapshotId(profile.inventoryId, profile.repoFingerprintId)
    );
    const deadlineMs = Math.min(config.routing.hardDeadlineMs, 100);
    if (validateHookArtifacts(profile, graph).length > 0 || Date.now() - startedAt >= deadlineMs) return 0;
    const claudeVersion = null;
    const projectId = projectIdFromRoot(hookInput.cwd);
    const evidence = { records: await store.listEvidence() };
    if (event === "SessionStart") {
      if (hookInput.source && hookInput.source !== "startup" && hookInput.source !== "resume") return 0;
      const digest = sessionStartDigest({
        profile,
        graph,
        config,
        evidence,
        agentTeamsEnabled: config.experimental.agentTeams
      });
      await store.appendEvent(
        buildEvent("session_start", claudeVersion, projectId, hookInput.sessionId, { profileId: profile.id })
      );
      if (digest && Date.now() - startedAt < deadlineMs) process.stdout.write(JSON.stringify(encodeHookContext("SessionStart", digest)) + "\n");
      return 0;
    }
    if (event === "UserPromptSubmit") {
      if (!graph || !config.routing.enabled) return 0;
      const prompt = hookInput.prompt ?? "";
      const { hintText, reasonCode } = userPromptSubmitRoute(
        { profile, graph, config, evidence, agentTeamsEnabled: config.experimental.agentTeams },
        prompt,
        hookInput.cwd,
        hookInput.sessionId
      );
      await store.appendEvent(
        buildEvent("route", claudeVersion, projectId, hookInput.sessionId, {
          profileId: profile.id,
          reasonCode,
          injected: hintText !== null
        })
      );
      if (hintText && Date.now() - startedAt < deadlineMs) process.stdout.write(JSON.stringify(encodeHookContext("UserPromptSubmit", hintText)) + "\n");
      return 0;
    }
    if (event === "SessionEnd") {
      await store.appendEvent(
        buildEvent("session_end", claudeVersion, projectId, hookInput.sessionId, { profileId: profile.id })
      );
      return 0;
    }
    return 0;
  } catch {
    return 0;
  }
}
main().then((code) => {
  process.exitCode = code;
});
