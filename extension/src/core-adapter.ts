/**
 * GhostLayer Extension Core Adapter — backed directly by Codex's @ghostlayer/core.
 *
 * Preserves extension UI category metadata and adds extension-specific policy
 * settings (such as autoGuardAiSites) while delegating ALL detection,
 * placeholder collision handling, fail-safe review gating, and restoration
 * directly to @ghostlayer/core.
 */

import {
  createSanitizationSession,
  restore as coreRestore,
  sanitize as coreSanitize,
  type Category,
  type Finding as CoreFinding,
  type FindingSource,
  type LocalFinding,
  type Mapping as CoreMapping,
  type Policy as CorePolicy,
  type SanitizeResult as CoreSanitizeResult,
} from '@ghostlayer/core';

export type { FindingSource, LocalFinding };
export type CategoryType = Category;
export type Severity = 'critical' | 'high' | 'medium';

export interface Finding extends Omit<CoreFinding, 'type'> {
  type: CategoryType;
}

export interface Mapping extends Omit<CoreMapping, 'type'> {
  type: CategoryType;
}

export interface Policy {
  enabledCategories: Record<CategoryType, boolean>;
  localOnlyMode: boolean;
  blockIfLocalAiUnavailable: boolean;
  restorableCategories: Record<CategoryType, boolean>;
  /** Automatically intercept sensitive prompts before send on supported AI websites. */
  autoGuardAiSites: boolean;
  /** Automatically replace sensitive items and send without showing the confirmation modal. */
  autoSanitizeSilently: boolean;
}

export interface SanitizeResult {
  sanitized: string;
  findings: Finding[];
  mappings: Mapping[];
}

export type BlockReason =
  | 'local-only'
  | 'local-ai-unavailable'
  | 'residual-sensitive-data'
  | null;

export interface ReviewResult extends SanitizeResult {
  blocked: BlockReason;
  toCloudPrompt(currentText: string, confirmedPreview: string): string;
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
  'ENV',
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
  ENV: { label: 'Env Assignment', severity: 'critical', defaultRestore: false },
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
    autoGuardAiSites: true,
    autoSanitizeSilently: false,
  };
}

export function maskPreview(value: string): string {
  if (value.length <= 4) return '••••';
  if (value.length <= 8) return `${value.slice(0, 2)}••••`;
  return `${value.slice(0, 3)}••••${value.slice(-2)}`;
}

export interface RawSpan {
  type: 'PERSON' | 'ORGANIZATION' | 'ADDRESS' | 'CONFIDENTIAL';
  start: number;
  end: number;
  original: string;
  confidence: number;
  source: 'local-ai';
}

function toCorePolicy(
  policy: Policy,
  localAiReady: boolean,
  extraLocalAiSpans: readonly RawSpan[] = [],
): CorePolicy {
  return {
    enabledCategories: policy.enabledCategories,
    localOnlyMode: policy.localOnlyMode,
    blockIfLocalAiUnavailable: policy.blockIfLocalAiUnavailable,
    restorableCategories: policy.restorableCategories,
    localAi: localAiReady
      ? {
          status: 'ready',
          findings: extraLocalAiSpans.map((s) => ({
            type: s.type,
            start: s.start,
            end: s.end,
            original: s.original,
            confidence: s.confidence,
          })),
        }
      : { status: 'unavailable' },
  };
}

function adaptResult(res: CoreSanitizeResult): SanitizeResult {
  return {
    sanitized: res.sanitized,
    findings: res.findings as Finding[],
    mappings: res.mappings as Mapping[],
  };
}

const NATURAL_LANGUAGE_SECRET_RE =
  /\b(?:my\s+)?(?:api[\s_-]?key|secret[\s_-]?key|access[\s_-]?token|auth[\s_-]?token|private[\s_-]?key|password|passwd|passphrase|secret|token)\s+(?:is|are)\s+["'`]?([^\s"'`,;.!?]{6,})["'`]?/gi;

const COMMON_NON_SECRET_WORDS = new Set([
  'hidden', 'redacted', 'missing', 'expired', 'invalid', 'broken', 'working',
  'revoked', 'rotated', 'stored', 'public', 'private', 'secret', 'required',
  'optional', 'loading', 'undefined', 'disabled', 'enabled', 'empty', 'wrong',
]);

/**
 * Supplements @ghostlayer/core with natural-language secret phrasing such as
 * "my api key is fw4b6j9356b93j45645" or "password is ...".
 * Logged in TASKS.md for Codex to upstream into packages/core/src/rules.ts.
 */
function detectNaturalLanguageSecrets(
  text: string,
  policy: Policy,
): RawSpan[] {
  if (policy.enabledCategories.API_KEY === false && policy.enabledCategories.PASSWORD === false) {
    return [];
  }
  const spans: RawSpan[] = [];
  const re = new RegExp(NATURAL_LANGUAGE_SECRET_RE.source, NATURAL_LANGUAGE_SECRET_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const val = match[1];
    if (!val || /^\[[A-Z_]+_\d+\]$/.test(val)) continue;
    if (COMMON_NON_SECRET_WORDS.has(val.toLowerCase())) continue;
    // Require at least one digit/symbol OR length >= 10 to avoid flagging normal English prose
    const looksLikeSecret = /[\d_\-!@#$%^&*+=/.]/.test(val) || val.length >= 10;
    if (!looksLikeSecret) continue;

    const innerIdx = match[0].lastIndexOf(val);
    if (innerIdx === -1) continue;
    const start = match.index + innerIdx;
    spans.push({
      type: 'CONFIDENTIAL',
      start,
      end: start + val.length,
      original: val,
      confidence: 0.9,
      source: 'local-ai',
    });
  }
  return spans;
}

export class SessionSanitizer {
  private readonly session = createSanitizationSession();

  sanitize(
    text: string,
    policy: Policy,
    extraLocalAiSpans: RawSpan[] = [],
  ): SanitizeResult {
    const nlSpans = detectNaturalLanguageSecrets(text, policy);
    const mergedSpans = [...extraLocalAiSpans, ...nlSpans];
    const corePol = toCorePolicy(
      policy,
      mergedSpans.length > 0,
      mergedSpans,
    );
    return adaptResult(this.session.sanitize(text, corePol));
  }

  createReview(
    text: string,
    policy: Policy,
    localAiReady: boolean,
    extraLocalAiSpans: RawSpan[] = [],
  ): ReviewResult {
    const nlSpans = detectNaturalLanguageSecrets(text, policy);
    const mergedSpans = [...extraLocalAiSpans, ...nlSpans];
    const corePol = toCorePolicy(
      policy,
      localAiReady || nlSpans.length > 0,
      mergedSpans,
    );
    const review = this.session.createReview(text, corePol);
    // Preserve strict fail-safe if localAiReady was false and we only injected nlSpans
    const blocked = (
      !localAiReady &&
      (policy.blockIfLocalAiUnavailable || review.sanitized === text)
        ? 'local-ai-unavailable'
        : review.blocked
    ) as BlockReason;
    return {
      sanitized: review.sanitized,
      findings: review.findings as Finding[],
      mappings: review.mappings as Mapping[],
      blocked,
      toCloudPrompt: (currentText: string, confirmedPreview: string) => {
        if (blocked) throw new Error(blocked);
        return review.toCloudPrompt(currentText, confirmedPreview);
      },
    };
  }

  restore(
    text: string,
    mappings: readonly Mapping[],
    restorableCategories?: Partial<Record<CategoryType, boolean>>,
  ): { restored: string; restoredCount: number; skippedPlaceholders: string[] } {
    const effectiveMappings: CoreMapping[] = mappings.map((m) => ({
      ...m,
      restorable:
        restorableCategories?.[m.type] ??
        m.restorable ??
        CATEGORY_META[m.type].defaultRestore,
    }));

    const restored = coreRestore(text, effectiveMappings);

    // Count restored & skipped placeholders for transparent UI feedback
    let restoredCount = 0;
    const skippedPlaceholders: string[] = [];
    for (const m of effectiveMappings) {
      if (text.includes(m.placeholder)) {
        if (m.restorable) {
          restoredCount += 1;
        } else {
          skippedPlaceholders.push(m.placeholder);
        }
      }
    }

    return { restored, restoredCount, skippedPlaceholders };
  }

  clear(): void {
    this.session.clear();
  }
}

export function sanitize(text: string, policy: Policy): SanitizeResult {
  return adaptResult(coreSanitize(text, toCorePolicy(policy, false)));
}

export function restore(text: string, mappings: Mapping[]): string {
  return coreRestore(text, mappings);
}
