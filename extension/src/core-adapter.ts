/**
 * Shared Core Interface Adapter for GhostLayer Extension.
 *
 * Implements the exact contract defined in AGENTS.md so extension/ can be
 * developed and run independently in parallel with packages/core.
 *
 * SWAP POINT: Once Codex lands @ghostlayer/core (packages/core), replace the
 * local stub implementation below with direct imports from '@ghostlayer/core'.
 */

export type FindingSource = 'rule' | 'local-ai';

export type Severity = 'critical' | 'high' | 'medium';

export type CategoryType =
  | 'PRIVATE_KEY'
  | 'API_KEY'
  | 'AUTH_TOKEN'
  | 'CONNECTION_STRING'
  | 'PASSWORD'
  | 'CREDIT_CARD'
  | 'SSN'
  | 'EMAIL'
  | 'PHONE'
  | 'IP_ADDRESS'
  | 'INTERNAL_URL'
  | 'FILE_PATH'
  | 'PERSON'
  | 'ORGANIZATION'
  | 'ADDRESS'
  | 'CONFIDENTIAL';

export interface Finding {
  type: CategoryType;
  start: number;
  end: number;
  original: string;
  placeholder: string;
  confidence: number;
  source: FindingSource;
}

export interface Mapping {
  placeholder: string;
  original: string;
  type: CategoryType;
  source: FindingSource;
}

export interface Policy {
  enabledCategories: Record<CategoryType, boolean>;
  localOnlyMode: boolean;
  blockIfLocalAiUnavailable: boolean;
  restorableCategories: Record<CategoryType, boolean>;
}

export interface SanitizeResult {
  sanitized: string;
  findings: Finding[];
  mappings: Mapping[];
}

export interface CategoryMeta {
  label: string;
  severity: Severity;
  defaultRestore: boolean;
}

export const ALL_CATEGORIES: readonly CategoryType[] = [
  'PRIVATE_KEY',
  'API_KEY',
  'AUTH_TOKEN',
  'CONNECTION_STRING',
  'PASSWORD',
  'CREDIT_CARD',
  'SSN',
  'EMAIL',
  'PHONE',
  'IP_ADDRESS',
  'INTERNAL_URL',
  'FILE_PATH',
  'PERSON',
  'ORGANIZATION',
  'ADDRESS',
  'CONFIDENTIAL',
] as const;

export const CATEGORY_META: Record<CategoryType, CategoryMeta> = {
  PRIVATE_KEY: { label: 'Private Key', severity: 'critical', defaultRestore: false },
  API_KEY: { label: 'API Key', severity: 'critical', defaultRestore: false },
  AUTH_TOKEN: { label: 'Auth Token', severity: 'critical', defaultRestore: false },
  CONNECTION_STRING: { label: 'Connection String', severity: 'critical', defaultRestore: false },
  PASSWORD: { label: 'Password / Secret', severity: 'critical', defaultRestore: false },
  CREDIT_CARD: { label: 'Credit Card', severity: 'critical', defaultRestore: false },
  SSN: { label: 'SSN', severity: 'critical', defaultRestore: false },
  EMAIL: { label: 'Email Address', severity: 'high', defaultRestore: true },
  PHONE: { label: 'Phone Number', severity: 'high', defaultRestore: true },
  IP_ADDRESS: { label: 'IP Address', severity: 'medium', defaultRestore: true },
  INTERNAL_URL: { label: 'Internal URL', severity: 'medium', defaultRestore: true },
  FILE_PATH: { label: 'Private File Path', severity: 'medium', defaultRestore: true },
  PERSON: { label: 'Person Name', severity: 'high', defaultRestore: true },
  ORGANIZATION: { label: 'Organization', severity: 'medium', defaultRestore: true },
  ADDRESS: { label: 'Physical Address', severity: 'high', defaultRestore: true },
  CONFIDENTIAL: { label: 'Confidential Info', severity: 'high', defaultRestore: false },
};

export function createDefaultPolicy(): Policy {
  const enabledCategories = {} as Record<CategoryType, boolean>;
  const restorableCategories = {} as Record<CategoryType, boolean>;
  for (const cat of ALL_CATEGORIES) {
    enabledCategories[cat] = true;
    restorableCategories[cat] = CATEGORY_META[cat].defaultRestore;
  }
  return {
    enabledCategories,
    localOnlyMode: false,
    blockIfLocalAiUnavailable: true,
    restorableCategories,
  };
}

export function maskPreview(value: string): string {
  if (value.length <= 4) return '••••';
  if (value.length <= 8) return `${value.slice(0, 2)}••••`;
  return `${value.slice(0, 3)}••••${value.slice(-2)}`;
}

// --- Local deterministic stub until @ghostlayer/core lands ---

interface RawSpan {
  type: CategoryType;
  start: number;
  end: number;
  original: string;
  confidence: number;
  source: FindingSource;
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
};

function isValidLuhn(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function isValidIpv4(raw: string): boolean {
  const parts = raw.split('.');
  return (
    parts.length === 4 &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255)
  );
}

const STUB_RULES: Array<{
  type: CategoryType;
  pattern: RegExp;
  group?: number;
  validate?: (val: string) => boolean;
}> = [
  {
    type: 'PRIVATE_KEY',
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  { type: 'API_KEY', pattern: /\bsk-(?:proj-|ant-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g },
  { type: 'API_KEY', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { type: 'API_KEY', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    type: 'AUTH_TOKEN',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  },
  {
    type: 'AUTH_TOKEN',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    type: 'CONNECTION_STRING',
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s'"`]+:[^\s'"`]+@[^\s'"`]+/gi,
  },
  {
    type: 'PASSWORD',
    pattern:
      /\b[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|API_KEY|ACCESS_KEY|AUTH_TOKEN|PRIVATE_KEY)\s*[:=]\s*["']?([^\s"'`;,]{6,})["']?/gi,
    group: 1,
    validate: (v) => !/^\[[A-Z_]+_\d+\]$/.test(v),
  },
  {
    type: 'CREDIT_CARD',
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    validate: isValidLuhn,
  },
  {
    type: 'SSN',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    type: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    type: 'INTERNAL_URL',
    pattern:
      /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|[a-z0-9-]+\.(?:internal|local|corp))(?::\d+)?(?:\/[^\s'"`<>]*)?/gi,
  },
  {
    type: 'IP_ADDRESS',
    pattern: /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g,
    validate: isValidIpv4,
  },
  {
    type: 'PHONE',
    pattern:
      /(?<!\w)(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-])\d{3,4}[\s.-]\d{4}(?!\w)/g,
  },
  {
    type: 'FILE_PATH',
    pattern: /\b[A-Za-z]:\\Users\\[^\s"'`<>|]+/g,
  },
  {
    type: 'FILE_PATH',
    pattern: /(?:^|[\s"'`(])(\/(?:Users|home)\/[A-Za-z0-9._-]+(?:\/[^\s"'`<>|)]*)?)/g,
    group: 1,
  },
];

function resolveRawOverlaps(spans: RawSpan[]): RawSpan[] {
  const sorted = [...spans].sort((a, b) => {
    const sevDiff =
      SEVERITY_RANK[CATEGORY_META[b.type].severity] -
      SEVERITY_RANK[CATEGORY_META[a.type].severity];
    if (sevDiff !== 0) return sevDiff;
    if (a.source !== b.source) return a.source === 'rule' ? -1 : 1;
    const lenDiff = b.end - b.start - (a.end - a.start);
    if (lenDiff !== 0) return lenDiff;
    return a.start - b.start;
  });

  const accepted: RawSpan[] = [];
  for (const s of sorted) {
    if (!accepted.some((e) => s.start < e.end && s.end > e.start)) {
      accepted.push(s);
    }
  }
  return accepted.sort((a, b) => a.start - b.start);
}

/**
 * Session vault keeping consistent placeholder mappings on-device.
 */
export class SessionSanitizer {
  private readonly valueToPlaceholder = new Map<string, string>();
  private readonly placeholderToMapping = new Map<string, Mapping>();
  private readonly counters = new Map<CategoryType, number>();

  private keyFor(type: CategoryType, original: string): string {
    const norm =
      type === 'EMAIL' || type === 'INTERNAL_URL' ? original.trim().toLowerCase() : original;
    return `${type}::${norm}`;
  }

  private assignPlaceholder(span: RawSpan): Mapping {
    const key = this.keyFor(span.type, span.original);
    const existing = this.valueToPlaceholder.get(key);
    if (existing) {
      return this.placeholderToMapping.get(existing)!;
    }
    const next = (this.counters.get(span.type) ?? 0) + 1;
    this.counters.set(span.type, next);
    const placeholder = `[${span.type}_${next}]`;
    const mapping: Mapping = {
      placeholder,
      original: span.original,
      type: span.type,
      source: span.source,
    };
    this.valueToPlaceholder.set(key, placeholder);
    this.placeholderToMapping.set(placeholder, mapping);
    return mapping;
  }

  sanitize(
    text: string,
    policy: Policy,
    extraLocalAiSpans: RawSpan[] = [],
  ): SanitizeResult {
    const rawSpans: RawSpan[] = [];

    for (const rule of STUB_RULES) {
      if (policy.enabledCategories[rule.type] === false) continue;
      const re = new RegExp(rule.pattern.source, rule.pattern.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const full = m[0];
        let val = full;
        let start = m.index;
        if (rule.group !== undefined) {
          const cap = m[rule.group];
          if (!cap) continue;
          const idx = full.indexOf(cap);
          if (idx === -1) continue;
          val = cap;
          start = m.index + idx;
        }
        if (rule.validate && !rule.validate(val)) continue;
        if (/^\[[A-Z_]+_\d+\]$/.test(val)) continue;
        rawSpans.push({
          type: rule.type,
          start,
          end: start + val.length,
          original: val,
          confidence: 1,
          source: 'rule',
        });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }

    for (const aiSpan of extraLocalAiSpans) {
      if (policy.enabledCategories[aiSpan.type] !== false) {
        rawSpans.push(aiSpan);
      }
    }

    const resolved = resolveRawOverlaps(rawSpans);
    const findings: Finding[] = [];
    const usedPlaceholders = new Set<string>();
    const chunks: string[] = [];
    let cursor = 0;

    for (const span of resolved) {
      if (span.start < cursor) continue;
      chunks.push(text.slice(cursor, span.start));
      const mapping = this.assignPlaceholder(span);
      chunks.push(mapping.placeholder);
      usedPlaceholders.add(mapping.placeholder);
      findings.push({
        type: span.type,
        start: span.start,
        end: span.end,
        original: span.original,
        placeholder: mapping.placeholder,
        confidence: span.confidence,
        source: span.source,
      });
      cursor = span.end;
    }
    chunks.push(text.slice(cursor));

    const mappings = Array.from(usedPlaceholders)
      .map((ph) => this.placeholderToMapping.get(ph)!)
      .filter(Boolean);

    return {
      sanitized: chunks.join(''),
      findings,
      mappings,
    };
  }

  /**
   * Restores placeholders locally, respecting restorableCategories so critical
   * secrets (API keys, passwords, private keys) are not re-injected unless enabled.
   */
  restore(
    text: string,
    mappings: readonly Mapping[],
    restorableCategories?: Partial<Record<CategoryType, boolean>>,
  ): { restored: string; restoredCount: number; skippedPlaceholders: string[] } {
    const byPlaceholder = new Map<string, Mapping>();
    for (const m of this.placeholderToMapping.values()) {
      byPlaceholder.set(m.placeholder, m);
    }
    for (const m of mappings) {
      byPlaceholder.set(m.placeholder, m);
    }

    let restoredCount = 0;
    const skipped = new Set<string>();

    const restored = text.replace(/\[([A-Z_]+_\d+)\]/g, (token) => {
      const entry = byPlaceholder.get(token);
      if (!entry) return token;
      const allow =
        restorableCategories?.[entry.type] ?? CATEGORY_META[entry.type].defaultRestore;
      if (!allow) {
        skipped.add(token);
        return token;
      }
      restoredCount += 1;
      return entry.original;
    });

    return {
      restored,
      restoredCount,
      skippedPlaceholders: Array.from(skipped),
    };
  }

  hasResidualCriticalSecrets(sanitizedText: string): Finding[] {
    const temp = new SessionSanitizer();
    const fullPolicy = createDefaultPolicy();
    const res = temp.sanitize(sanitizedText, fullPolicy);
    return res.findings.filter((f) => CATEGORY_META[f.type].severity === 'critical');
  }

  clear(): void {
    this.valueToPlaceholder.clear();
    this.placeholderToMapping.clear();
    this.counters.clear();
  }
}

export function sanitize(text: string, policy: Policy): SanitizeResult {
  return new SessionSanitizer().sanitize(text, policy);
}

export function restore(text: string, mappings: Mapping[]): string {
  return new SessionSanitizer().restore(text, mappings).restored;
}
