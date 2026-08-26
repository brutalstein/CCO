const EXT_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp',
  '.swift': 'swift',
  '.kt': 'kotlin', '.kts': 'kotlin',
  '.css': 'css', '.scss': 'css',
  '.html': 'html'
};

export interface LanguageWeight {
  id: string;
  weight: number;
}

/** Language proportions from a bounded tracked-file-extension histogram (18_REPOSITORY_ANALYSIS.md section 5). */
export function languagesFromExtensions(files: string[]): LanguageWeight[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const file of files) {
    const idx = file.lastIndexOf('.');
    if (idx < 0) continue;
    const ext = file.slice(idx).toLowerCase();
    const lang = EXT_LANG[ext];
    if (!lang) continue;
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return [];
  return [...counts.entries()]
    .map(([id, count]) => ({ id, weight: Math.round((count / total) * 1000) / 1000 }))
    .sort((a, b) => b.weight - a.weight);
}
