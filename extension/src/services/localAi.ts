export type LocalAiAvailability =
  | 'ready'
  | 'downloadable'
  | 'downloading'
  | 'unavailable';

export type ContextualCategoryType =
  | 'PERSON'
  | 'ORGANIZATION'
  | 'ADDRESS'
  | 'CONFIDENTIAL';

export type LocalEngineKind =
  | 'firebase-only-on-device'
  | 'chrome-language-model'
  | 'local-heuristic'
  | 'none';

export interface LocalAiSpan {
  type: ContextualCategoryType;
  start: number;
  end: number;
  original: string;
  confidence: number;
  source: 'local-ai';
}

export interface LocalAiScanResult {
  status: LocalAiAvailability;
  engine: LocalEngineKind;
  browserName?: string;
  spans: LocalAiSpan[];
  reason?: string;
  latencyMs: number;
}

export interface OnDeviceRunner {
  readonly engine: 'firebase-only-on-device' | 'chrome-language-model';
  checkAvailability(): Promise<{ status: LocalAiAvailability; reason?: string }>;
  initialize?(): Promise<void>;
  prompt(systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<string>;
}

const CONTEXTUAL_TYPES = new Set<ContextualCategoryType>([
  'PERSON',
  'ORGANIZATION',
  'ADDRESS',
  'CONFIDENTIAL',
]);

const SYSTEM_PROMPT = `Extract sensitive contextual entities appearing VERBATIM in the text.
Types: PERSON (human names), ORGANIZATION (company/client names), ADDRESS (street/home addresses), CONFIDENTIAL (private project codenames, salaries, medical info).
Return JSON: {"entities":[{"text":"exact substring","type":"PERSON"}]}.
Return {"entities":[]} if none.`;

export const ENTITY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          type: {
            type: 'string',
            enum: ['PERSON', 'ORGANIZATION', 'ADDRESS', 'CONFIDENTIAL'],
          },
        },
        required: ['text', 'type'],
        additionalProperties: false,
      },
    },
  },
  required: ['entities'],
  additionalProperties: false,
} as const;

type ParseEntitiesResult =
  | { ok: true; entities: Array<{ text: string; type: string }> }
  | { ok: false; error: string };

function parseJsonEntities(raw: string): ParseEntitiesResult {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return { ok: false, error: 'On-device model output did not contain a JSON object.' };
  }

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { entities?: unknown };
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entities)) {
      return {
        ok: false,
        error: 'On-device model JSON output is missing the required "entities" array.',
      };
    }

    const validEntities: Array<{ text: string; type: string }> = [];
    for (const item of parsed.entities) {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof (item as { text?: unknown }).text !== 'string' ||
        typeof (item as { type?: unknown }).type !== 'string'
      ) {
        return {
          ok: false,
          error: 'On-device model returned an invalid entity record.',
        };
      }
      validEntities.push({
        text: (item as { text: string }).text,
        type: (item as { type: string }).type,
      });
    }

    return { ok: true, entities: validEntities };
  } catch {
    return { ok: false, error: 'On-device model output was malformed JSON.' };
  }
}

function anchorEntities(
  sourceText: string,
  entities: Array<{ text: string; type: string }>,
): LocalAiSpan[] {
  const spans: LocalAiSpan[] = [];
  for (const item of entities) {
    const type = item.type.trim().toUpperCase() as ContextualCategoryType;
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

/**
 * Detects whether the extension is running in Brave, Edge, or Chrome.
 */
export async function detectBrowserName(): Promise<'Brave' | 'Edge' | 'Chrome' | 'Browser'> {
  const nav = globalThis.navigator as
    | (Navigator & { brave?: { isBrave?: () => Promise<boolean> } })
    | undefined;
  if (!nav) return 'Browser';
  try {
    if (nav.brave && typeof nav.brave.isBrave === 'function') {
      if (await nav.brave.isBrave()) return 'Brave';
    }
  } catch {
    // Ignore probe failure
  }
  const ua = nav.userAgent ?? '';
  if (/\bEdg\//.test(ua)) return 'Edge';
  if (/\bChrome\//.test(ua)) return 'Chrome';
  return 'Browser';
}

const NAME_STOPWORDS = new Set([
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
  'Google', 'Chrome', 'Brave', 'Firebase', 'Gemini', 'Claude', 'ChatGPT', 'OpenAI',
  'Please', 'Thanks', 'Thank', 'Hello', 'Dear', 'Subject', 'Team', 'Support',
  'Project', 'Quarter', 'Contract', 'Report', 'Summary', 'Update', 'Invoice',
]);

/**
 * Lightweight, zero-dependency on-device contextual heuristic NER for browsers
 * that do not ship Chrome's built-in Gemini Nano runtime (such as Brave or Edge).
 * Detects common context-anchored personal names, company suffixes, and street addresses.
 */
export function runLocalHeuristicNer(text: string): LocalAiSpan[] {
  const spans: LocalAiSpan[] = [];

  const addIfNew = (
    type: ContextualCategoryType,
    start: number,
    end: number,
    original: string,
    confidence: number,
  ) => {
    if (start < 0 || end <= start || text.slice(start, end) !== original) return;
    if (/^\[[A-Z_]+_\d+\]$/.test(original)) return;
    const overlaps = spans.some((s) => start < s.end && end > s.start);
    if (!overlaps) {
      spans.push({ type, start, end, original, confidence, source: 'local-ai' });
    }
  };

  // 1. Street addresses (e.g. "742 Evergreen Terrace", "123 Main St")
  const addrRe =
    /\b\d{1,6}\s+(?:[A-Z][a-zA-Z0-9.-]+\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Terrace|Ter|Place|Pl)\b/g;
  let m: RegExpExecArray | null;
  while ((m = addrRe.exec(text)) !== null) {
    addIfNew('ADDRESS', m.index, m.index + m[0].length, m[0], 0.8);
  }

  // 2. Organizations with explicit legal/business suffixes (e.g. "Acme Corp", "Globex LLC")
  const orgRe =
    /\b([A-Z][A-Za-z0-9&'-]+(?:\s+[A-Z][A-Za-z0-9&'-]+){0,3}\s+(?:Inc|LLC|Ltd|Corp|Corporation|GmbH|Labs|Technologies|Systems|Holdings|Partners|Group|Solutions)\.?)\b/g;
  while ((m = orgRe.exec(text)) !== null) {
    addIfNew('ORGANIZATION', m.index, m.index + m[1].length, m[1], 0.8);
  }

  // 3. Context-anchored person names (e.g. "to Alex Morgan", "from Sarah Chen", "Dr. Patel")
  // No /i flag so ONLY capitalized name words match (never trailing lowercase words like "at").
  const personRe =
    /\b(?:[Tt]o|[Ff]rom|[Dd]ear|[Hh]i|[Hh]ello|[Hh]ey|[Cc][Cc]|[Bb][Cc][Cc]|[Cc]ontact|[Mm]eet|[Cc]all|[Ee]mail|[Aa]sk|[Ww]ith|[Bb]y|[Mm]r\.|[Mm]s\.|[Mm]rs\.|[Dd]r\.|[Pp]rof\.)\s+([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){1,2})\b/g;
  while ((m = personRe.exec(text)) !== null) {
    const candidate = m[1];
    const words = candidate.split(/\s+/);
    if (words.some((w) => NAME_STOPWORDS.has(w))) continue;
    const innerOffset = m[0].lastIndexOf(candidate);
    if (innerOffset === -1) continue;
    const start = m.index + innerOffset;
    addIfNew('PERSON', start, start + candidate.length, candidate, 0.75);
  }

  return spans.sort((a, b) => a.start - b.start);
}

interface ChromeLanguageModelSession {
  prompt: (
    input: string,
    options?: { responseConstraint?: Record<string, unknown>; signal?: AbortSignal },
  ) => Promise<string>;
  clone?: () => Promise<ChromeLanguageModelSession>;
  destroy?: () => void;
}

interface ChromeLanguageModelApi {
  availability?: (options?: {
    expectedInputs?: Array<{ type: string; languages?: string[] }>;
    expectedOutputs?: Array<{ type: string; languages?: string[] }>;
  }) => Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
  create: (options?: {
    initialPrompts?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    systemPrompt?: string;
    signal?: AbortSignal;
    expectedInputs?: Array<{ type: string; languages?: string[] }>;
    expectedOutputs?: Array<{ type: string; languages?: string[] }>;
  }) => Promise<ChromeLanguageModelSession>;
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

export class ChromeLanguageModelRunner implements OnDeviceRunner {
  readonly engine = 'chrome-language-model' as const;
  private baseSession: ChromeLanguageModelSession | null = null;

  async checkAvailability(): Promise<{ status: LocalAiAvailability; reason?: string }> {
    const api = getChromeLanguageModel();
    if (!api) {
      return {
        status: 'unavailable',
        reason:
          'Chrome built-in LanguageModel API (Gemini Nano) is not available in this browser.',
      };
    }

    if (typeof api.availability === 'function') {
      try {
        const state = await api.availability({
          expectedInputs: [{ type: 'text', languages: ['en'] }],
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
        });
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

  private async createSession(
    api: ChromeLanguageModelApi,
    systemPrompt: string,
    signal?: AbortSignal,
  ): Promise<ChromeLanguageModelSession> {
    try {
      return await api.create({
        signal,
        initialPrompts: [{ role: 'system', content: systemPrompt }],
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
    } catch {
      signal?.throwIfAborted();
      return await api.create({
        signal,
        systemPrompt,
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
    }
  }

  async prompt(systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<string> {
    const api = getChromeLanguageModel();
    if (!api) throw new Error('Chrome LanguageModel API is unavailable.');

    const base = this.baseSession ?? (await this.createSession(api, systemPrompt, signal));
    const canClone = typeof base.clone === 'function';
    if (canClone) {
      this.baseSession = base;
    }

    const session = canClone ? await base.clone!() : base;

    try {
      signal?.throwIfAborted();
      return await session.prompt(userPrompt, {
        signal,
        responseConstraint: ENTITY_JSON_SCHEMA as unknown as Record<string, unknown>,
      });
    } finally {
      session.destroy?.();
    }
  }
}

export const LOCAL_SCAN_TIMEOUT_MS = 45_000;

export interface LocalScannerOptions {
  /**
   * When true, automatically use local heuristic NER on browsers that do not
   * ship Chrome's Gemini Nano runtime (e.g., Brave or Edge).
   * Never masks runtime errors or malformed output from an active Gemini Nano model.
   */
  enableBrowserHeuristicFallback?: boolean;
}

export class LocalContextualScanner {
  private readonly enableHeuristicFallback: boolean;

  constructor(
    private readonly runner: OnDeviceRunner | null,
    options: LocalScannerOptions = {},
  ) {
    this.enableHeuristicFallback = options.enableBrowserHeuristicFallback ?? false;
  }

  async checkStatus(): Promise<{
    status: LocalAiAvailability;
    engine: LocalEngineKind;
    browserName: string;
    reason?: string;
  }> {
    const browserName = await detectBrowserName();

    if (!this.runner) {
      if (this.enableHeuristicFallback) {
        return {
          status: 'ready',
          engine: 'local-heuristic',
          browserName,
          reason: `Using built-in local heuristic NER on ${browserName} (Gemini Nano is Chrome-only).`,
        };
      }
      return {
        status: 'unavailable',
        engine: 'none',
        browserName,
        reason: 'No on-device AI runtime available.',
      };
    }

    const res = await this.runner.checkAvailability();
    if (res.status === 'unavailable' && this.enableHeuristicFallback) {
      return {
        status: 'ready',
        engine: 'local-heuristic',
        browserName,
        reason: `Running on ${browserName}: using built-in local heuristic NER (names, orgs, addresses) because Gemini Nano is Chrome-only.`,
      };
    }

    return {
      status: res.status,
      engine: this.runner.engine,
      browserName,
      reason: res.reason,
    };
  }

  async scan(text: string): Promise<LocalAiScanResult> {
    const started = performance.now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<LocalAiScanResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({
          status: 'unavailable',
          engine: this.runner?.engine ?? 'none',
          spans: [],
          reason: 'The on-device scan timed out after 45 seconds. Retry the scan or use an explicitly approved rules-only review.',
          latencyMs: LOCAL_SCAN_TIMEOUT_MS,
        });
      }, LOCAL_SCAN_TIMEOUT_MS);
    });

    try {
      return await Promise.race([this.scanLocally(text, started, controller.signal), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async scanLocally(text: string, started: number, signal: AbortSignal): Promise<LocalAiScanResult> {
    const browserName = await detectBrowserName();

    if (!text.trim()) {
      return {
        status: 'ready',
        engine: this.runner ? this.runner.engine : 'none',
        browserName,
        spans: [],
        latencyMs: 0,
      };
    }

    const status = await this.checkStatus();
    signal.throwIfAborted();

    // Brave / non-Chrome local heuristic path
    if (status.engine === 'local-heuristic') {
      const spans = runLocalHeuristicNer(text);
      return {
        status: 'ready',
        engine: 'local-heuristic',
        browserName,
        spans,
        reason: status.reason,
        latencyMs: Number((performance.now() - started).toFixed(2)),
      };
    }

    if ((status.status !== 'ready' && status.status !== 'downloadable') || !this.runner) {
      return {
        status: status.status,
        engine: status.engine,
        browserName,
        spans: [],
        reason: status.reason,
        latencyMs: Math.round(performance.now() - started),
      };
    }

    try {
      if (this.runner.initialize) {
        await this.runner.initialize();
      }

      signal.throwIfAborted();
      const output = await this.runner.prompt(
        SYSTEM_PROMPT,
        `Text:\n"""\n${text}\n"""`,
        signal,
      );
      const parsed = parseJsonEntities(output);
      if (!parsed.ok) {
        return {
          status: 'unavailable',
          engine: this.runner.engine,
          browserName,
          spans: [],
          reason: `Fail-safe block: ${parsed.error}`,
          latencyMs: Math.round(performance.now() - started),
        };
      }

      return {
        status: 'ready',
        engine: this.runner.engine,
        browserName,
        spans: anchorEntities(text, parsed.entities),
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (err) {
      return {
        status: 'unavailable',
        engine: this.runner.engine,
        browserName,
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
