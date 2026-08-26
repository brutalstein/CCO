import type { CapabilityTag } from '../types.js';

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

function cosine(a: string, b: string): number {
  const tfA = termFrequency(tokenize(a));
  const tfB = termFrequency(tokenize(b));
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [term, freq] of tfA) {
    normA += freq * freq;
    const other = tfB.get(term);
    if (other) dot += freq * other;
  }
  for (const freq of tfB.values()) normB += freq * freq;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function weightedJaccard(a: CapabilityTag[], b: CapabilityTag[]): number {
  const mapA = new Map(a.map((t) => [t.id, t.confidence]));
  const mapB = new Map(b.map((t) => [t.id, t.confidence]));
  const ids = new Set([...mapA.keys(), ...mapB.keys()]);
  let inter = 0;
  let union = 0;
  for (const id of ids) {
    const va = mapA.get(id) ?? 0;
    const vb = mapB.get(id) ?? 0;
    inter += Math.min(va, vb);
    union += Math.max(va, vb);
  }
  return union === 0 ? 0 : inter / union;
}

function operationOverlap(a: CapabilityTag[], b: CapabilityTag[]): number {
  const opsA = a.filter((t) => t.id.startsWith('operation:'));
  const opsB = b.filter((t) => t.id.startsWith('operation:'));
  return weightedJaccard(opsA, opsB);
}

export interface SimilarityInput {
  name: string;
  description: string;
  tags: CapabilityTag[];
  ownerPluginId: string | null;
}

export interface SimilarityResult {
  score: number;
  intraPlugin: boolean;
}

/** Lexical/tag redundancy similarity (32_ALGORITHMS_PSEUDOCODE.md section 4). Diagnostic only. */
export function similarity(a: SimilarityInput, b: SimilarityInput): SimilarityResult {
  const score = 0.45 * cosine(`${a.name} ${a.description}`, `${b.name} ${b.description}`) + 0.35 * weightedJaccard(a.tags, b.tags) + 0.2 * operationOverlap(a.tags, b.tags);
  return { score, intraPlugin: a.ownerPluginId !== null && a.ownerPluginId === b.ownerPluginId };
}

export const REDUNDANCY_THRESHOLD = 0.55;
