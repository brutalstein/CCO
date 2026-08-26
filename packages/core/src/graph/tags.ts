import type { CapabilityTag } from '../types.js';

/**
 * Deterministic keyword -> tag dictionary (05_CAPABILITY_MODEL.md section 7,
 * 32_ALGORITHMS_PSEUDOCODE.md section 3). No embeddings; exact/alias matches only.
 */
const DICTIONARY: Array<{ tag: string; keywords: string[] }> = [
  { tag: 'lang:typescript', keywords: ['typescript', 'tsx', 'ts '] },
  { tag: 'lang:javascript', keywords: ['javascript', 'jsx', 'node.js', 'nodejs'] },
  { tag: 'lang:python', keywords: ['python', 'django', 'flask', 'fastapi', 'pytest'] },
  { tag: 'lang:rust', keywords: ['rust', 'cargo'] },
  { tag: 'lang:go', keywords: ['golang', ' go '] },
  { tag: 'framework:react', keywords: ['react', 'jsx', 'tsx'] },
  { tag: 'framework:vite', keywords: ['vite'] },
  { tag: 'framework:nextjs', keywords: ['next.js', 'nextjs'] },
  { tag: 'domain:security', keywords: ['security', 'auth', 'vulnerability', 'threat', 'owasp'] },
  { tag: 'domain:testing', keywords: ['test', 'testing', 'tdd', 'coverage'] },
  { tag: 'domain:database', keywords: ['database', 'sql', 'postgres', 'mysql', 'schema', 'migration'] },
  { tag: 'domain:frontend', keywords: ['frontend', 'ui', 'design', 'css', 'component'] },
  { tag: 'domain:mobile', keywords: ['ios', 'android', 'mobile', 'swift', 'kotlin'] },
  { tag: 'domain:infrastructure', keywords: ['kubernetes', 'docker', 'terraform', 'deploy', 'ci/cd', 'infrastructure'] },
  { tag: 'operation:code-review', keywords: ['review', 'code review'] },
  { tag: 'operation:git', keywords: ['git', 'commit', 'branch', 'pull request'] },
  { tag: 'operation:debug', keywords: ['debug', 'bug', 'fix'] },
  { tag: 'operation:deployment', keywords: ['deploy', 'release', 'publish'] },
  { tag: 'operation:documentation', keywords: ['docs', 'documentation', 'readme'] }
];

export function extractTags(name: string, description: string, source: string): CapabilityTag[] {
  const text = ` ${name.toLowerCase()} ${description.toLowerCase()} `;
  const out: CapabilityTag[] = [];
  for (const entry of DICTIONARY) {
    const hit = entry.keywords.some((k) => text.includes(k.toLowerCase()));
    if (hit) out.push({ id: entry.tag, confidence: 0.85, source });
  }
  return dedupe(out);
}

function dedupe(tags: CapabilityTag[]): CapabilityTag[] {
  const seen = new Map<string, CapabilityTag>();
  for (const t of tags) {
    const existing = seen.get(t.id);
    if (!existing || existing.confidence < t.confidence) seen.set(t.id, t);
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}
