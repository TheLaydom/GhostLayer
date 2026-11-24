import { createSanitizationSession, restoreWithReport, sanitize } from '@ghostlayer/core';
import type { Category, LocalFinding, Mapping } from '@ghostlayer/core';

export { sanitize };

export type Severity = 'critical' | 'high' | 'medium';

export type CategoryType = Category;
export type { Finding, FindingSource, Mapping } from '@ghostlayer/core';
export interface Policy {
  enabledCategories: Record<CategoryType, boolean>;
  localOnlyMode: boolean;
  blockIfLocalAiUnavailable: boolean;
  restorableCategories: Record<CategoryType, boolean>;
}

export type { SanitizeResult } from '@ghostlayer/core';

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
  'ENV',
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
  ENV: { label: 'Environment Variable', severity: 'critical', defaultRestore: false },
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


export class SessionSanitizer {
  private readonly session = createSanitizationSession();

  sanitize(text: string, policy: Policy, findings: readonly LocalFinding[] = []) {
    return this.session.sanitize(text, { ...policy, localAi: { status: 'ready', findings } });
  }

  createReview(text: string, policy: Policy, findings: readonly LocalFinding[] | null) {
    return this.session.createReview(text, {
      ...policy,
      localAi: findings ? { status: 'ready', findings } : { status: 'unavailable' },
    });
  }

  restore(text: string, mappings: readonly Mapping[]) {
    return restoreWithReport(text, mappings);
  }

  clear() {
    this.session.clear();
  }
}
