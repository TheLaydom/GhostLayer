import { createDefaultPolicy, type Policy } from '../core-adapter';

const POLICY_STORAGE_KEY = 'ghostlayer.policy.v1';

/**
 * Persists ONLY non-sensitive privacy policy preferences locally.
 * Sensitive prompt mappings are intentionally kept in memory only and never persisted to disk.
 */
export async function loadSavedPolicy(): Promise<Policy> {
  const defaults = createDefaultPolicy();
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get(POLICY_STORAGE_KEY);
      const saved = data[POLICY_STORAGE_KEY] as Partial<Policy> | undefined;
      if (saved) return mergePolicy(defaults, saved);
    } else if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(POLICY_STORAGE_KEY);
      if (raw) return mergePolicy(defaults, JSON.parse(raw) as Partial<Policy>);
    }
  } catch {
    // Fall back to safe defaults if storage is unavailable
  }
  return defaults;
}

export async function savePolicy(policy: Policy): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [POLICY_STORAGE_KEY]: policy });
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify(policy));
    }
  } catch {
    // Ignore storage write errors in restricted contexts
  }
}

function mergePolicy(defaults: Policy, saved: Partial<Policy>): Policy {
  return {
    localOnlyMode: saved.localOnlyMode ?? defaults.localOnlyMode,
    blockIfLocalAiUnavailable:
      saved.blockIfLocalAiUnavailable ?? defaults.blockIfLocalAiUnavailable,
    autoGuardAiSites: saved.autoGuardAiSites ?? defaults.autoGuardAiSites,
    autoSanitizeSilently: saved.autoSanitizeSilently ?? defaults.autoSanitizeSilently,
    enabledCategories: {
      ...defaults.enabledCategories,
      ...(saved.enabledCategories ?? {}),
    },
    restorableCategories: {
      ...defaults.restorableCategories,
      ...(saved.restorableCategories ?? {}),
    },
  };
}
