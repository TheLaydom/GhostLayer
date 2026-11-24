import type { LocalFinding } from '@ghostlayer/core';

export type LocalAiAvailability =
  | 'ready'
  | 'downloadable'
  | 'downloading'
  | 'unavailable';

export type LocalAiSpan = LocalFinding & { source: 'local-ai' };

export interface LocalAiScanResult {
  status: LocalAiAvailability;
  engine: 'firebase-only-on-device' | 'chrome-language-model' | 'none';
  spans: LocalAiSpan[];
  reason?: string;
  latencyMs: number;
}

export interface OnDeviceRunner {
  readonly engine: 'firebase-only-on-device' | 'chrome-language-model';
  checkAvailability(): Promise<{ status: LocalAiAvailability; reason?: string }>;
  prompt(systemPrompt: string, userPrompt: string): Promise<string>;
}

const CONTEXTUAL_TYPES = new Set<LocalFinding['type']>([
  'PERSON',
  'ORGANIZATION',
  'ADDRESS',
  'CONFIDENTIAL',
]);

const SYSTEM_PROMPT = `You are an on-device privacy entity extractor.
Extract ONLY contextual sensitive entities appearing VERBATIM in the input text.
Allowed types: PERSON, ORGANIZATION, ADDRESS, CONFIDENTIAL.
Return ONLY valid JSON: {"entities":[{"text":"exact substring","type":"PERSON"}]}.
If none exist, return {"entities":[]}. Never invent text not present in the input.`;

function parseJsonEntities(raw: string): Array<{ text: string; type: string }> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Invalid on-device response.');
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { entities?: unknown };
  if (!Array.isArray(parsed.entities) || parsed.entities.length > 100) {
    throw new Error('Invalid on-device response.');
  }
  return parsed.entities.map((item) => {
    if (!item || typeof item.text !== 'string' || typeof item.type !== 'string') {
      throw new Error('Invalid on-device entity.');
    }
    return { text: item.text, type: item.type };
  });
}

/**
 * Anchors entities returned by Gemini Nano back to exact character offsets
 * in the original prompt. Hallucinated or mangled strings are safely ignored.
 */
function anchorEntities(
  sourceText: string,
  entities: Array<{ text: string; type: string }>,
): LocalAiSpan[] {
  const spans: LocalAiSpan[] = [];
  for (const item of entities) {
    const type = item.type.trim().toUpperCase() as LocalFinding['type'];
    if (!CONTEXTUAL_TYPES.has(type)) continue;
    const snippet = item.text.trim();
    if (snippet.length < 2 || /^\[[A-Z_]+_\d+\]$/.test(snippet)) continue;

    let from = 0;
    while (from < sourceText.length) {
      const idx = sourceText.indexOf(snippet, from);
      if (idx === -1) break;
      spans.push({
        type,
        start: idx,
        end: idx + snippet.length,
        original: snippet,
        confidence: 0.85,
        source: 'local-ai',
      });
      from = idx + snippet.length;
    }
  }
  return spans;
}

interface ChromeLanguageModelApi {
  availability?: () => Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
  create: (options?: { systemPrompt?: string }) => Promise<{
    prompt: (input: string) => Promise<string>;
    destroy?: () => void;
  }>;
}

function getChromeLanguageModel(): ChromeLanguageModelApi | null {
  const g = globalThis as unknown as {
    LanguageModel?: ChromeLanguageModelApi;
    ai?: { languageModel?: ChromeLanguageModelApi };
  };
  if (g.LanguageModel && typeof g.LanguageModel.create === 'function') {
    return g.LanguageModel;
  }
  if (g.ai?.languageModel && typeof g.ai.languageModel.create === 'function') {
    return g.ai.languageModel;
  }
  return null;
}

/**
 * Direct Chrome Built-in AI (`LanguageModel` / Gemini Nano) runner.
 * Strictly local; zero network egress.
 */
export class ChromeLanguageModelRunner implements OnDeviceRunner {
  readonly engine = 'chrome-language-model' as const;

  async checkAvailability(): Promise<{ status: LocalAiAvailability; reason?: string }> {
    const api = getChromeLanguageModel();
    if (!api) {
      return {
        status: 'unavailable',
        reason:
          'Chrome built-in LanguageModel API (Gemini Nano) is not available in this browser. Enable Chrome Prompt API flags or use a supported Chrome desktop build.',
      };
    }

    if (typeof api.availability === 'function') {
      try {
        const state = await api.availability();
        if (state === 'available') return { status: 'ready' };
        if (state === 'downloadable') {
          return {
            status: 'downloadable',
            reason:
              'Gemini Nano is supported and will download on your first local scan click.',
          };
        }
        if (state === 'downloading') {
          return {
            status: 'downloading',
            reason: 'Gemini Nano model is currently downloading in Chrome.',
          };
        }
        return {
          status: 'unavailable',
          reason: 'This device or Chrome profile reports Gemini Nano as unavailable.',
        };
      } catch (err) {
        return {
          status: 'unavailable',
          reason:
            err instanceof Error
              ? err.message
              : 'Failed to check Chrome LanguageModel availability.',
        };
      }
    }

    return { status: 'ready' };
  }

  async prompt(systemPrompt: string, userPrompt: string): Promise<string> {
    const api = getChromeLanguageModel();
    if (!api) throw new Error('Chrome LanguageModel API is unavailable.');
    const session = await api.create({ systemPrompt });
    try {
      return await session.prompt(userPrompt);
    } finally {
      session.destroy?.();
    }
  }
}

export class LocalContextualScanner {
  constructor(private readonly runner: OnDeviceRunner | null) {}

  async checkStatus(): Promise<{
    status: LocalAiAvailability;
    engine: LocalAiScanResult['engine'];
    reason?: string;
  }> {
    if (!this.runner) {
      return {
        status: 'unavailable',
        engine: 'none',
        reason: 'No on-device AI runtime available.',
      };
    }
    const res = await this.runner.checkAvailability();
    return { status: res.status, engine: this.runner.engine, reason: res.reason };
  }

  async scan(text: string): Promise<LocalAiScanResult> {
    const started = performance.now();
    if (!text.trim()) {
      return {
        status: 'ready',
        engine: this.runner ? this.runner.engine : 'none',
        spans: [],
        latencyMs: 0,
      };
    }

    const status = await this.checkStatus();
    if ((status.status !== 'ready' && status.status !== 'downloadable') || !this.runner) {
      return {
        status: status.status,
        engine: status.engine,
        spans: [],
        reason: status.reason,
        latencyMs: Math.round(performance.now() - started),
      };
    }

    try {
      const output = await this.runner.prompt(
        SYSTEM_PROMPT,
        `Input text:\n"""\n${text}\n"""`,
      );
      const entities = parseJsonEntities(output);
      return {
        status: 'ready',
        engine: this.runner.engine,
        spans: anchorEntities(text, entities),
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (err) {
      return {
        status: 'unavailable',
        engine: this.runner.engine,
        spans: [],
        reason:
          err instanceof Error
            ? `On-device scan failed: ${err.message}`
            : 'On-device scan failed.',
        latencyMs: Math.round(performance.now() - started),
      };
    }
  }
}
