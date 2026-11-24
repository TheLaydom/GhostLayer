/**
 * GhostLayer Auto-Guard Content Script for AI Websites.
 *
 * Runs strictly on supported AI chat sites declared in manifest.json.
 * - Tracks the active prompt editor (textarea or root [contenteditable="true"])
 *   across focus changes so clicking Send never loses the editor reference.
 * - Shows live secret count on the bottom-right GhostLayer Guard pill as you type.
 * - Intercepts Enter, Send button clicks, and form submits in window capture phase.
 * - Supports default Safe Review modal (one-click "Sanitize & Send"), Autopilot
 *   quiet-sanitize mode, and one-click in-page "Restore Replies".
 */

import {
  CATEGORY_META,
  createDefaultPolicy,
  SessionSanitizer,
  type CategoryType,
  type Mapping,
  type Policy,
} from './core-adapter';

const POLICY_STORAGE_KEY = 'ghostlayer.policy.v1';
const sanitizer = new SessionSanitizer();

// Tab-scoped in-memory vault (RAM only, cleared when tab closes)
const tabMappings = new Map<string, Mapping>();

let currentPolicy: Policy = createDefaultPolicy();
let bypassedTextOnce: string | null = null;
let lastPromptEl: HTMLElement | null = null;
let liveDetectedCount = 0;

let overlayHost: HTMLElement | null = null;
let badgeHost: HTMLElement | null = null;
let toastHost: HTMLElement | null = null;
let toastTimer: number | null = null;

function mergePolicy(saved?: Partial<Policy>): Policy {
  const defaults = createDefaultPolicy();
  if (!saved) return defaults;
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

function loadPolicy(): void {
  if (!chrome.storage?.local) return;
  chrome.storage.local.get(POLICY_STORAGE_KEY).then((data) => {
    currentPolicy = mergePolicy(data[POLICY_STORAGE_KEY] as Partial<Policy> | undefined);
    renderStatusBadge();
  });
}

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== 'local' || !changes[POLICY_STORAGE_KEY]) return;
  currentPolicy = mergePolicy(
    changes[POLICY_STORAGE_KEY].newValue as Partial<Policy> | undefined,
  );
  renderStatusBadge();
});

function showToast(message: string, tone: 'emerald' | 'amber' = 'emerald'): void {
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastHost?.remove();

  toastHost = document.createElement('div');
  toastHost.id = 'ghostlayer-toast';
  const shadow = toastHost.attachShadow({ mode: 'open' });
  const borderColor =
    tone === 'emerald' ? 'rgba(16, 185, 129, 0.5)' : 'rgba(245, 158, 11, 0.5)';
  const dotColor = tone === 'emerald' ? '#10b981' : '#f59e0b';

  shadow.innerHTML = `
    <style>
      .toast {
        position: fixed;
        right: 16px;
        bottom: 52px;
        z-index: 2147483645;
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: 380px;
        padding: 8px 12px;
        border-radius: 8px;
        background: rgba(9, 9, 11, 0.96);
        border: 1px solid ${borderColor};
        color: #f4f4f5;
        font: 12px/1.35 system-ui, -apple-system, Segoe UI, sans-serif;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: ${dotColor}; flex-shrink: 0; }
    </style>
    <div class="toast"><span class="dot"></span><span id="gl-toast-msg"></span></div>
  `;
  const msgEl = shadow.getElementById('gl-toast-msg');
  if (msgEl) msgEl.textContent = message;

  document.documentElement.appendChild(toastHost);
  toastTimer = window.setTimeout(() => {
    toastHost?.remove();
    toastHost = null;
  }, 4200);
}

/**
 * Resolves any child node inside a contenteditable editor (e.g. ProseMirror <p>)
 * up to the root editable host, or returns a textarea directly.
 */
function resolvePromptRoot(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  if (node instanceof HTMLTextAreaElement) return node;
  if (node instanceof HTMLElement && node.isContentEditable) {
    // Walk up to the outermost contenteditable container
    let curr: HTMLElement = node;
    while (curr.parentElement?.isContentEditable) {
      curr = curr.parentElement;
    }
    return curr;
  }
  const closestEditable = node.closest('[contenteditable="true"], [role="textbox"], textarea');
  if (closestEditable instanceof HTMLElement) {
    return closestEditable;
  }
  return null;
}

function readPromptText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.value;
  }
  return (el.innerText || el.textContent || '').replace(/\u200B/g, '');
}

function findActivePromptElement(): HTMLElement | null {
  // 1. Check currently focused element first
  const fromFocus = resolvePromptRoot(document.activeElement);
  if (fromFocus && readPromptText(fromFocus).trim().length > 0) {
    lastPromptEl = fromFocus;
    return fromFocus;
  }

  // 2. Check last element the user actually typed into (crucial when Send button steals focus)
  if (lastPromptEl && lastPromptEl.isConnected && readPromptText(lastPromptEl).trim().length > 0) {
    return lastPromptEl;
  }

  // 3. Fallback scan: prefer visible editors that actually contain non-empty text
  const candidates = document.querySelectorAll<HTMLElement>(
    'div.ProseMirror[contenteditable="true"], [contenteditable="true"][role="textbox"], [contenteditable="true"], textarea',
  );
  let firstVisible: HTMLElement | null = null;
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 18) continue;
    if (!firstVisible) firstVisible = el;
    if (readPromptText(el).trim().length > 0) {
      lastPromptEl = el;
      return el;
    }
  }
  return fromFocus ?? firstVisible;
}

function writePromptText(el: HTMLElement, nextText: string): void {
  el.focus();
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const proto = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (proto?.set) {
      proto.set.call(el, nextText);
    } else {
      el.value = nextText;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const inserted = document.execCommand?.('insertText', false, nextText);
  if (!inserted) {
    el.textContent = nextText;
    el.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: nextText }),
    );
  }
}

function isSendButton(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof Element)) return null;
  const btn = target.closest('button');
  if (!btn) return null;

  const label = [
    btn.getAttribute('aria-label') ?? '',
    btn.getAttribute('data-testid') ?? '',
    btn.getAttribute('title') ?? '',
    btn.textContent ?? '',
  ]
    .join(' ')
    .toLowerCase();

  if (
    btn.type === 'submit' ||
    /\bsend\b|\bsubmit\b|send-button|send message|ask/.test(label)
  ) {
    return btn;
  }
  return null;
}

function rememberMappings(mappings: readonly Mapping[]): void {
  for (const m of mappings) {
    tabMappings.set(m.placeholder, m);
  }
  renderStatusBadge();
}

function restorePlaceholdersInPage(): void {
  if (tabMappings.size === 0) return;
  const mappings = Array.from(tabMappings.values());

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (
        tag === 'SCRIPT' ||
        tag === 'STYLE' ||
        tag === 'TEXTAREA' ||
        tag === 'INPUT' ||
        tag === 'NOSCRIPT'
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.isContentEditable || parent.closest('[contenteditable="true"]')) {
        return NodeFilter.FILTER_REJECT;
      }
      const val = node.nodeValue;
      if (!val || !val.includes('[')) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let nodesUpdated = 0;
  const skipped = new Set<string>();
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const before = current.nodeValue ?? '';
    const res = sanitizer.restore(
      before,
      mappings,
      currentPolicy.restorableCategories,
    );
    for (const s of res.skippedPlaceholders) skipped.add(s);
    if (res.restored !== before) {
      current.nodeValue = res.restored;
      nodesUpdated += 1;
    }
  }

  if (nodesUpdated > 0) {
    const skippedNote =
      skipped.size > 0
        ? ` (kept ${Array.from(skipped).join(', ')} redacted)`
        : '';
    showToast(`Restored safe placeholders in ${nodesUpdated} text block(s)${skippedNote}.`);
  } else {
    showToast(
      skipped.size > 0
        ? `No restorable placeholders found (${Array.from(skipped).join(', ')} kept redacted for safety).`
        : 'No matching placeholders found in visible replies yet.',
      'amber',
    );
  }
}

function closeOverlay(): void {
  overlayHost?.remove();
  overlayHost = null;
}

function renderStatusBadge(): void {
  badgeHost?.remove();
  badgeHost = null;

  if (!currentPolicy.autoGuardAiSites) return;

  badgeHost = document.createElement('div');
  badgeHost.id = 'ghostlayer-guard-badge';
  const shadow = badgeHost.attachShadow({ mode: 'open' });
  const hasMappings = tabMappings.size > 0;
  const modeLabel = currentPolicy.autoSanitizeSilently ? 'Autopilot' : 'Guard';
  const hasLiveHits = liveDetectedCount > 0;

  shadow.innerHTML = `
    <style>
      .bar {
        position: fixed;
        right: 16px;
        bottom: 14px;
        z-index: 2147483640;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .pill {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border-radius: 6px;
        background: rgba(9, 9, 11, 0.94);
        border: 1px solid ${hasLiveHits ? 'rgba(245, 158, 11, 0.75)' : 'rgba(16, 185, 129, 0.45)'};
        color: ${hasLiveHits ? '#fde68a' : '#d4d4d8'};
        font: 11px/1.2 system-ui, -apple-system, Segoe UI, sans-serif;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        cursor: pointer;
        user-select: none;
      }
      .pill:hover { border-color: ${hasLiveHits ? '#f59e0b' : 'rgba(16, 185, 129, 0.9)'}; color: #fff; }
      .restore {
        border-color: rgba(56, 189, 248, 0.5);
        color: #bae6fd;
      }
      .restore:hover { border-color: rgba(56, 189, 248, 0.9); color: #fff; }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: ${hasLiveHits ? '#f59e0b' : '#10b981'}; }
    </style>
    <div class="bar">
      ${
        hasMappings
          ? `<button class="pill restore" id="gl-restore-btn" type="button" title="Locally restore safe placeholders in AI replies on this page">Restore Replies (${tabMappings.size})</button>`
          : ''
      }
      <button class="pill" id="gl-open-btn" type="button" title="${
        hasLiveHits
          ? `GhostLayer detected ${liveDetectedCount} sensitive item(s) in your draft. Click to review or sanitize.`
          : `GhostLayer ${modeLabel} is active. Click to open Side Panel.`
      }">
        <span class="dot"></span>
        <span>${
          hasLiveHits
            ? `GhostLayer: ${liveDetectedCount} secret(s) in draft`
            : `GhostLayer ${modeLabel}`
        }</span>
      </button>
    </div>
  `;

  shadow.getElementById('gl-restore-btn')?.addEventListener('click', () => {
    restorePlaceholdersInPage();
  });

  shadow.getElementById('gl-open-btn')?.addEventListener('click', () => {
    const el = findActivePromptElement();
    const text = el ? readPromptText(el).trim() : '';
    if (el && text && liveDetectedCount > 0) {
      // Open intercept modal directly so user can sanitize with 1 click
      try {
        const res = sanitizer.sanitize(text, currentPolicy);
        if (res.findings.length > 0) {
          showInterceptModal({
            inputEl: el,
            originalText: text,
            sanitizedText: res.sanitized,
            mappings: res.mappings,
            categories: Array.from(new Set(res.findings.map((f) => f.type))),
            findingsCount: res.findings.length,
            triggerSubmit: () => {
              el.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
              );
            },
          });
          return;
        }
      } catch {
        // Fall through to opening Side Panel
      }
    }
    chrome.runtime.sendMessage({
      type: 'GHOSTLAYER_OPEN_SIDEPANEL',
      text,
    });
  });

  document.documentElement.appendChild(badgeHost);
}

function updateLiveCount(el: HTMLElement | null): void {
  if (!currentPolicy.autoGuardAiSites || !el) {
    if (liveDetectedCount !== 0) {
      liveDetectedCount = 0;
      renderStatusBadge();
    }
    return;
  }

  const text = readPromptText(el);
  if (!text.trim()) {
    if (liveDetectedCount !== 0) {
      liveDetectedCount = 0;
      renderStatusBadge();
    }
    return;
  }

  try {
    const preview = new SessionSanitizer().sanitize(text, currentPolicy);
    if (preview.findings.length !== liveDetectedCount) {
      liveDetectedCount = preview.findings.length;
      renderStatusBadge();
    }
  } catch {
    // Ignore live preview errors on oversized inputs
  }
}

function showInterceptModal(opts: {
  inputEl: HTMLElement;
  originalText: string;
  sanitizedText: string;
  mappings: Mapping[];
  categories: CategoryType[];
  findingsCount: number;
  triggerSubmit: () => void;
}): void {
  closeOverlay();

  overlayHost = document.createElement('div');
  overlayHost.id = 'ghostlayer-intercept-overlay';
  const shadow = overlayHost.attachShadow({ mode: 'open' });

  const categoryLabels = opts.categories
    .map((c) => CATEGORY_META[c]?.label ?? c)
    .join(', ');

  shadow.innerHTML = `
    <style>
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        background: rgba(0, 0, 0, 0.65);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      }
      .card {
        width: 100%;
        max-width: 560px;
        background: #09090b;
        border: 1px solid #27272a;
        border-radius: 10px;
        color: #f4f4f5;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
        overflow: hidden;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid #27272a;
        background: #18181b;
      }
      .title { font-size: 13px; font-weight: 600; color: #fca5a5; }
      .sub { font-size: 11px; color: #a1a1aa; margin-top: 2px; }
      .body { padding: 14px 16px; }
      .label { font-size: 11px; color: #a1a1aa; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.04em; }
      .preview {
        background: #111114;
        border: 1px solid #27272a;
        border-radius: 6px;
        padding: 10px;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 12px;
        line-height: 1.5;
        color: #a7f3d0;
        max-height: 180px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
        padding: 12px 16px;
        border-top: 1px solid #27272a;
        background: #111114;
      }
      button {
        border-radius: 6px;
        padding: 7px 12px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        border: 1px solid transparent;
      }
      .btn-primary { background: #059669; color: #fff; }
      .btn-primary:hover { background: #10b981; }
      .btn-secondary { background: #18181b; color: #e4e4e7; border-color: #3f3f46; }
      .btn-secondary:hover { background: #27272a; }
      .btn-danger { background: transparent; color: #fca5a5; border-color: rgba(239, 68, 68, 0.35); }
      .btn-danger:hover { background: rgba(127, 29, 29, 0.35); }
    </style>
    <div class="backdrop">
      <div class="card" role="dialog" aria-modal="true" aria-label="GhostLayer Privacy Interception">
        <div class="head">
          <div>
            <div class="title">GhostLayer Intercepted ${opts.findingsCount} Sensitive Item(s)</div>
            <div class="sub">Detected locally: ${categoryLabels}</div>
          </div>
          <button class="btn-secondary" id="gl-cancel" type="button">Esc</button>
        </div>
        <div class="body">
          <div class="label">Sanitized Preview (Safe Replacement)</div>
          <div class="preview" id="gl-preview"></div>
        </div>
        <div class="actions">
          <button class="btn-danger" id="gl-bypass" type="button">Send Original Anyway</button>
          <button class="btn-secondary" id="gl-sidepanel" type="button">Side Panel</button>
          <button class="btn-secondary" id="gl-replace-only" type="button">Replace Only</button>
          <button class="btn-primary" id="gl-sanitize-send" type="button">Sanitize &amp; Send</button>
        </div>
      </div>
    </div>
  `;

  const previewEl = shadow.getElementById('gl-preview');
  if (previewEl) previewEl.textContent = opts.sanitizedText;

  shadow.getElementById('gl-cancel')?.addEventListener('click', closeOverlay);

  shadow.getElementById('gl-replace-only')?.addEventListener('click', () => {
    rememberMappings(opts.mappings);
    writePromptText(opts.inputEl, opts.sanitizedText);
    liveDetectedCount = 0;
    renderStatusBadge();
    closeOverlay();
  });

  shadow.getElementById('gl-sanitize-send')?.addEventListener('click', () => {
    rememberMappings(opts.mappings);
    writePromptText(opts.inputEl, opts.sanitizedText);
    bypassedTextOnce = opts.sanitizedText;
    liveDetectedCount = 0;
    renderStatusBadge();
    closeOverlay();
    window.setTimeout(() => opts.triggerSubmit(), 35);
  });

  shadow.getElementById('gl-sidepanel')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'GHOSTLAYER_OPEN_SIDEPANEL',
      text: opts.originalText,
    });
    closeOverlay();
  });

  shadow.getElementById('gl-bypass')?.addEventListener('click', () => {
    bypassedTextOnce = opts.originalText;
    closeOverlay();
    opts.triggerSubmit();
  });

  document.documentElement.appendChild(overlayHost);
}

function inspectAndGuard(
  event: Event,
  inputEl: HTMLElement,
  triggerSubmit: () => void,
): void {
  if (!currentPolicy.autoGuardAiSites) return;
  if (overlayHost) return;

  const text = readPromptText(inputEl);
  if (!text.trim()) return;

  if (bypassedTextOnce !== null && bypassedTextOnce === text) {
    bypassedTextOnce = null;
    return;
  }

  try {
    const result = sanitizer.sanitize(text, currentPolicy);
    if (result.findings.length === 0) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const uniqueCategories = Array.from(new Set(result.findings.map((f) => f.type)));

    if (currentPolicy.autoSanitizeSilently) {
      rememberMappings(result.mappings);
      writePromptText(inputEl, result.sanitized);
      bypassedTextOnce = result.sanitized;
      liveDetectedCount = 0;
      renderStatusBadge();
      const labels = uniqueCategories
        .map((c) => CATEGORY_META[c]?.label ?? c)
        .join(', ');
      showToast(
        `GhostLayer Autopilot redacted ${result.findings.length} item(s): ${labels}.`,
      );
      window.setTimeout(() => triggerSubmit(), 35);
      return;
    }

    showInterceptModal({
      inputEl,
      originalText: text,
      sanitizedText: result.sanitized,
      mappings: result.mappings,
      categories: uniqueCategories,
      findingsCount: result.findings.length,
      triggerSubmit,
    });
  } catch {
    // Never crash the host page if input exceeds max length or collides
  }
}

// Track the real editor element whenever the user focuses or types in it
window.addEventListener(
  'input',
  (e) => {
    const root = resolvePromptRoot(e.target);
    if (root) {
      lastPromptEl = root;
      updateLiveCount(root);
    }
  },
  true,
);

window.addEventListener(
  'focusin',
  (e) => {
    const root = resolvePromptRoot(e.target);
    if (root) {
      lastPromptEl = root;
      updateLiveCount(root);
    }
  },
  true,
);

window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && overlayHost) {
      closeOverlay();
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.ctrlKey || e.metaKey) return;

    const inputEl = resolvePromptRoot(e.target) ?? findActivePromptElement();
    if (!inputEl) return;

    inspectAndGuard(e, inputEl, () => {
      inputEl.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
      );
    });
  },
  true,
);

window.addEventListener(
  'click',
  (e) => {
    const btn = isSendButton(e.target);
    if (!btn) return;

    const inputEl = findActivePromptElement();
    if (!inputEl) return;

    inspectAndGuard(e, inputEl, () => btn.click());
  },
  true,
);

window.addEventListener(
  'submit',
  (e) => {
    const inputEl = findActivePromptElement();
    if (!inputEl) return;

    inspectAndGuard(e, inputEl, () => {
      if (e.target instanceof HTMLFormElement) e.target.requestSubmit();
    });
  },
  true,
);

loadPolicy();
