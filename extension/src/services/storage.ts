import { createDefaultPolicy, type Policy } from '../core-adapter';

const POLICY_STORAGE_KEY = 'ghostlayer.policy.v1';
const APPEARANCE_STORAGE_KEY = 'ghostlayer.appearance.v1';

export type UiStylePreset = 'ios-glass' | 'oled-black' | 'frost-slate';

export interface AppearanceSettings {
  style: UiStylePreset;
  /** Custom user-uploaded PNG/image data URL; null uses bundled default-bg.png. */
  customBackgroundDataUrl: string | null;
  /** Opacity percentage (0–70) for the background image under ios-glass mode. */
  backgroundOpacity: number;
}

export function createDefaultAppearance(): AppearanceSettings {
  return {
    style: 'ios-glass',
    customBackgroundDataUrl: null,
    backgroundOpacity: 32,
  };
}

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

export async function loadSavedAppearance(): Promise<AppearanceSettings> {
  const defaults = createDefaultAppearance();
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get(APPEARANCE_STORAGE_KEY);
      const saved = data[APPEARANCE_STORAGE_KEY] as Partial<AppearanceSettings> | undefined;
      if (saved) return { ...defaults, ...saved };
    } else if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
      if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<AppearanceSettings>) };
    }
  } catch {
    // Fall back to defaults
  }
  return defaults;
}

export async function saveAppearance(settings: AppearanceSettings): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [APPEARANCE_STORAGE_KEY]: settings });
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings));
    }
  } catch {
    // Ignore storage quota or write errors
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
