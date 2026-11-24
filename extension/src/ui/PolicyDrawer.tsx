import { X } from 'lucide-react';
import {
  ALL_CATEGORIES,
  CATEGORY_META,
  type CategoryType,
  type Policy,
} from '../core-adapter';

interface PolicyDrawerProps {
  open: boolean;
  policy: Policy;
  onClose: () => void;
  onChange: (next: Policy) => void;
}

function IosSwitch({
  checked,
  onChange,
  label,
  tone = 'blue',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  tone?: 'blue' | 'green';
}) {
  const activeBg = tone === 'green' ? 'bg-[#30D158]' : 'bg-[#0A84FF]';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[24px] w-[42px] shrink-0 items-center rounded-full transition-colors duration-200 ${
        checked ? activeBg : 'bg-white/15'
      }`}
    >
      <span
        className={`inline-block h-[20px] w-[20px] transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? 'translate-x-[20px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}

export function PolicyDrawer({ open, policy, onClose, onChange }: PolicyDrawerProps) {
  if (!open) return null;

  const toggleCategory = (cat: CategoryType) => {
    onChange({
      ...policy,
      enabledCategories: {
        ...policy.enabledCategories,
        [cat]: !policy.enabledCategories[cat],
      },
    });
  };

  const toggleRestore = (cat: CategoryType) => {
    onChange({
      ...policy,
      restorableCategories: {
        ...policy.restorableCategories,
        [cat]: !policy.restorableCategories[cat],
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-md">
      <div className="flex h-full w-full max-w-md flex-col border-l border-white/[0.08] bg-[#0B0C10]">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3.5">
          <h2 className="text-[15px] font-semibold tracking-tight text-white">
            Privacy Policy
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close privacy policy"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4 text-xs">
          {/* iOS Grouped Settings Card */}
          <section className="divide-y divide-white/[0.08] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#16171D]">
            <div className="flex items-center justify-between gap-3 p-3.5">
              <div>
                <div className="text-[13px] font-medium text-white">
                  Auto-Guard AI Websites
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-white/50">
                  Scan prompts locally before sending on ChatGPT, Claude, Gemini, Perplexity &amp; Grok.
                </p>
              </div>
              <IosSwitch
                checked={policy.autoGuardAiSites}
                onChange={(v) => onChange({ ...policy, autoGuardAiSites: v })}
                label="Auto-Guard AI Websites"
                tone="green"
              />
            </div>

            {policy.autoGuardAiSites && (
              <div className="flex items-center justify-between gap-3 p-3.5">
                <div>
                  <div className="text-[13px] font-medium text-white">
                    Autopilot (Quiet Sanitize)
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-white/50">
                    Automatically redact &amp; send with a subtle toast instead of a confirmation modal.
                  </p>
                </div>
                <IosSwitch
                  checked={policy.autoSanitizeSilently}
                  onChange={(v) => onChange({ ...policy, autoSanitizeSilently: v })}
                  label="Autopilot Quiet Sanitize"
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-3 p-3.5">
              <div>
                <div className="text-[13px] font-medium text-white">Local-Only Mode</div>
                <p className="mt-0.5 text-[11px] leading-snug text-white/50">
                  Disable built-in cloud Gemini calls; use GhostLayer strictly for local redaction.
                </p>
              </div>
              <IosSwitch
                checked={policy.localOnlyMode}
                onChange={(v) => onChange({ ...policy, localOnlyMode: v })}
                label="Local-Only Mode"
              />
            </div>

            <div className="flex items-center justify-between gap-3 p-3.5">
              <div>
                <div className="text-[13px] font-medium text-white">
                  Strict On-Device Fail-Safe
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-white/50">
                  Block cloud transmission if local contextual AI is unavailable.
                </p>
              </div>
              <IosSwitch
                checked={policy.blockIfLocalAiUnavailable}
                onChange={(v) => onChange({ ...policy, blockIfLocalAiUnavailable: v })}
                label="Strict On-Device Fail-Safe"
                tone="green"
              />
            </div>
          </section>

          {/* Categories Grouped Card */}
          <section className="space-y-2">
            <div className="flex items-center justify-between px-1 text-[11px] font-medium uppercase tracking-wider text-white/45">
              <span>Detection Categories</span>
              <div className="flex gap-5 pr-1">
                <span>Redact</span>
                <span>Restore</span>
              </div>
            </div>
            <div className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#16171D]">
              {ALL_CATEGORIES.map((cat) => {
                const meta = CATEGORY_META[cat];
                return (
                  <div
                    key={cat}
                    className="flex items-center justify-between px-3.5 py-2.5"
                  >
                    <div>
                      <span className="text-[13px] font-medium text-white/90">
                        {meta.label}
                      </span>
                      <span className="ml-2 font-mono text-[10px] text-white/35">
                        {cat}
                      </span>
                    </div>
                    <div className="flex items-center gap-7 pr-1">
                      <input
                        type="checkbox"
                        checked={policy.enabledCategories[cat]}
                        onChange={() => toggleCategory(cat)}
                        aria-label={`Redact ${meta.label}`}
                        className="h-4 w-4 rounded accent-[#30D158]"
                      />
                      <input
                        type="checkbox"
                        checked={policy.restorableCategories[cat]}
                        onChange={() => toggleRestore(cat)}
                        aria-label={`Restore ${meta.label}`}
                        className="h-4 w-4 rounded accent-[#0A84FF]"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="px-1 text-[11px] leading-relaxed text-white/40">
              Anonymization reduces exposure but cannot guarantee perfect privacy. Always
              review the outgoing preview before transmitting.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
