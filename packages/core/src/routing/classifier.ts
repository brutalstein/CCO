import { extractTags } from '../graph/tags.js';
import { INTENT_CLASSIFIER_VERSION, SCHEMA_VERSION, type RepoFingerprint, type TaskIntent } from '../types.js';

export interface PromptClassificationInput {
  prompt: string;
  repo?: RepoFingerprint;
}

const STOPWORDS = new Set(['it', 'the', 'a', 'an', 'this', 'that', 'please', 'can', 'you', 'i', 'my', 'to', 'is', 'for']);

function meaningfulWordCount(prompt: string): number {
  const words = prompt.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.filter((w) => !STOPWORDS.has(w)).length;
}

/**
 * Deterministic lexical intent classifier (07_RUNTIME_ROUTER_AND_PLANNER.md sections 4-5).
 * No embeddings, no model call. Very short/ambiguous prompts intentionally get low
 * confidence so the router abstains (acceptance G03).
 */
export interface IntentClassifier {
  classify(input: PromptClassificationInput): TaskIntent;
}

export class DefaultIntentClassifier implements IntentClassifier {
  classify(input: PromptClassificationInput): TaskIntent {
    const tags = extractTags('', input.prompt, 'prompt');
    const operations = tags.filter((t) => t.id.startsWith('operation:')).map((t) => t.id.slice('operation:'.length));
    const domains = tags.filter((t) => t.id.startsWith('domain:')).map((t) => t.id.slice('domain:'.length));
    const languages = tags.filter((t) => t.id.startsWith('lang:')).map((t) => t.id.slice('lang:'.length));
    const artifacts = tags.filter((t) => t.id.startsWith('framework:')).map((t) => t.id.slice('framework:'.length));

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

    const parallelism = /\b(multiple|several|parallel|all files|every file|across)\b/i.test(input.prompt) ? 'high' : 'low';
    const complexity = meaningfulWords > 25 ? 'high' : meaningfulWords > 8 ? 'medium' : 'low';

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
}
