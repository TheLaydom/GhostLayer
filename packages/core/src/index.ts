import { ruleMatches } from './rules.js';
import type { RuleCategory } from './rules.js';

export type Category = RuleCategory | 'PERSON' | 'ORGANIZATION' | 'ADDRESS' | 'CONFIDENTIAL';
export type LocalFinding = {
  type: 'PERSON' | 'ORGANIZATION' | 'ADDRESS' | 'CONFIDENTIAL';
  start: number;
  end: number;
  original: string;
  confidence: number;
};
export type FindingSource = 'rule' | 'local-ai';
export type Mapping = {
  original: string;
  placeholder: string;
  type: string;
  source: FindingSource;
  restorable?: boolean;
};
export type Finding = {
  type: string;
  original: string;
  placeholder: string;
  start: number;
  end: number;
  confidence: number;
  source: FindingSource;
};
export type Policy = {
  enabledCategories?: Readonly<Record<string, boolean>>;
  localOnlyMode?: boolean;
  blockIfLocalAiUnavailable?: boolean;
  restorableCategories?: Readonly<Record<string, boolean>>;
  localAi?: { status: 'unavailable' } | { status: 'ready'; findings: readonly LocalFinding[] };
};

export const MAX_PROMPT_LENGTH = 8_000;
const tokenPattern = /\[\s{0,12}([A-Z][A-Z0-9]{0,19}(?:[ _-][A-Z][A-Z0-9]{0,19}){0,4})\s{0,12}[_ -]\s{0,12}(\d{1,6})\s{0,12}\]/giu;
const contextualCategories = new Set(['PERSON', 'ORGANIZATION', 'ADDRESS', 'CONFIDENTIAL']);
const restrictedCategories = new Set([
  'API_KEY', 'AUTH_TOKEN', 'PASSWORD', 'PRIVATE_KEY', 'CONNECTION_STRING',
  'CREDIT_CARD', 'SSN', 'ENV', 'CONFIDENTIAL',
]);

function canonical(kind: string, number: string): string {
  return '[' + kind.toUpperCase().replace(/[ -]/g, '_') + '_' + number + ']';
}

export type SanitizeResult = {
  sanitized: string;
  findings: Finding[];
  mappings: Mapping[];
};

function sanitizeWithSession(text: string, policy: Policy, existing: Map<string, string>): SanitizeResult {
  if (!text.trim() || text.length > MAX_PROMPT_LENGTH) {
    throw new RangeError('Prompt must contain between 1 and 8,000 characters.');
  }
  type Span = Pick<Finding, 'start' | 'end' | 'confidence' | 'source'> & {
    type: Category;
    restricted?: boolean;
  };
  const candidates: Span[] = ruleMatches(text, policy.enabledCategories);
  if (policy.localAi?.status === 'ready') {
    if (policy.localAi.findings.length > 100) throw new TypeError('Too many local AI findings.');
    for (const finding of policy.localAi.findings) {
      const { type, start, end, original, confidence } = finding;
      if (!contextualCategories.has(type) ||
          !Number.isInteger(start) || !Number.isInteger(end) || start < 0 ||
          end > text.length || end <= start || text.slice(start, end) !== original ||
          !original.trim() || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new TypeError('Invalid local AI finding.');
      }
      if (policy.enabledCategories?.[type] !== false) {
        candidates.push({ type, start, end, confidence, source: 'local-ai' });
      }
    }
  }
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  const spans: Span[] = [];
  for (const candidate of candidates) {
    const last = spans.at(-1);
    if (!last || candidate.start >= last.end) {
      spans.push(candidate);
    } else {
      last.end = Math.max(last.end, candidate.end);
      last.restricted ||= restrictedCategories.has(candidate.type) &&
        policy.restorableCategories?.[candidate.type] !== true;
    }
  }

  const reserved = new Set(Array.from(text.matchAll(tokenPattern), match => canonical(match[1], match[2])));
  const allocated = new Set(existing.values());
  const byOriginal = new Map<string, Mapping>();
  const counts = new Map<Category, number>();
  const findings: Finding[] = [];
  let sanitized = '';
  let cursor = 0;
  for (const span of spans) {
    const original = text.slice(span.start, span.end);
    let mapping = byOriginal.get(original);
    if (!mapping) {
      let count = counts.get(span.type) ?? 0;
      let placeholder = existing.get(original);
      if (placeholder && reserved.has(placeholder)) {
        throw new Error('An existing session placeholder appears literally in this prompt.');
      }
      if (!placeholder) {
        do {
          placeholder = '[' + span.type + '_' + ++count + ']';
        } while (reserved.has(placeholder) || allocated.has(placeholder));
        allocated.add(placeholder);
      }
      counts.set(span.type, count);
      mapping = {
        original, placeholder, type: span.type, source: span.source,
        restorable: !span.restricted && (policy.restorableCategories?.[span.type] ??
          !restrictedCategories.has(span.type)),
      };
      byOriginal.set(original, mapping);
    } else if (span.restricted || !(policy.restorableCategories?.[span.type] ??
      !restrictedCategories.has(span.type))) {
      mapping.restorable = false;
    }
    findings.push({
      type: span.type, start: span.start, end: span.end, confidence: span.confidence,
      source: span.source, original, placeholder: mapping.placeholder,
    });
    sanitized += text.slice(cursor, span.start) + mapping.placeholder;
    cursor = span.end;
  }
  for (const { original, placeholder } of byOriginal.values()) existing.set(original, placeholder);
  return { sanitized: sanitized + text.slice(cursor), findings, mappings: [...byOriginal.values()] };
}

export function sanitize(text: string, policy: Policy = {}): SanitizeResult {
  return sanitizeWithSession(text, policy, new Map());
}

export function restore(text: string, mappings: readonly Mapping[]): string {
  const originals = new Map(mappings.filter(({ type, restorable }) =>
    restorable ?? !restrictedCategories.has(type)).map(({ placeholder, original }) => [placeholder, original]));
  return text.replace(tokenPattern, (token, kind: string, number: string) =>
    originals.get(canonical(kind, number)) ?? token);
}

function reviewWithSession(text: string, policy: Policy, existing: Map<string, string>) {
  const result = sanitizeWithSession(text, policy, existing);
  const localAiReady = policy.localAi?.status === 'ready';
  const blocked = policy.localOnlyMode ? 'local-only' :
    !localAiReady && (policy.blockIfLocalAiUnavailable !== false || result.sanitized === text)
      ? 'local-ai-unavailable' :
      ruleMatches(result.sanitized, undefined).some(({ type }) => restrictedCategories.has(type))
        ? 'residual-sensitive-data' : null;
  const approvedText = result.sanitized;
  return {
    ...result,
    blocked,
    toCloudPrompt(currentText: string, confirmedPreview: string): string {
      if (blocked) throw new Error(blocked);
      if (currentText !== text || confirmedPreview !== approvedText) {
        throw new Error('Review the current prompt and confirm its exact preview.');
      }
      return approvedText;
    },
  };
}

export function createReview(text: string, policy: Policy = {}) {
  return reviewWithSession(text, policy, new Map());
}

export function createSanitizationSession() {
  const existing = new Map<string, string>();
  return {
    sanitize: (text: string, policy: Policy = {}) => sanitizeWithSession(text, policy, existing),
    createReview: (text: string, policy: Policy = {}) => reviewWithSession(text, policy, existing),
    clear: () => existing.clear(),
  };
}
