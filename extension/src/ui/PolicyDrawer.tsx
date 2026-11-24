import { ShieldAlert, X } from 'lucide-react';
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
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70">
      <div className="flex h-full w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Privacy Policy</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close privacy policy"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4 text-xs">
          <section className="space-y-3 rounded border border-zinc-800 bg-zinc-900/50 p-3">
            <label className="flex cursor-pointer items-start justify-between gap-3">
              <div>
                <div className="font-medium text-zinc-100">Local-Only Mode</div>
                <p className="mt-0.5 text-zinc-400">
                  Never transmit prompts to cloud AI. Use GhostLayer strictly for local
                  redaction and copy-paste sanitization.
                </p>
              </div>
              <input
                type="checkbox"
                checked={policy.localOnlyMode}
                onChange={(e) => onChange({ ...policy, localOnlyMode: e.target.checked })}
                className="mt-1 h-4 w-4 accent-emerald-500"
              />
            </label>

            <div className="border-t border-zinc-800 pt-3">
              <label className="flex cursor-pointer items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-zinc-100">
                    Fail-Safe: Block Cloud When Local AI Is Unavailable
                  </div>
                  <p className="mt-0.5 text-zinc-400">
                    Default ON. Prevents accidental leakage of contextual PII (names,
                    organizations) when Chrome Gemini Nano is unavailable. Disable only if
                    you explicitly accept deterministic-only scanning.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={policy.blockIfLocalAiUnavailable}
                  onChange={(e) =>
                    onChange({ ...policy, blockIfLocalAiUnavailable: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 accent-emerald-500"
                />
              </label>
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              <span>Category</span>
              <div className="flex gap-5">
                <span>Redact</span>
                <span>Restore</span>
              </div>
            </div>
            <div className="divide-y divide-zinc-800/80 rounded border border-zinc-800 bg-zinc-900/40">
              {ALL_CATEGORIES.map((cat) => {
                const meta = CATEGORY_META[cat];
                return (
                  <div key={cat} className="flex items-center justify-between px-3 py-2">
                    <div>
                      <span className="font-medium text-zinc-200">{meta.label}</span>
                      <span className="ml-2 font-mono text-[10px] text-zinc-500">{cat}</span>
                    </div>
                    <div className="flex items-center gap-8 pr-1">
                      <input
                        type="checkbox"
                        checked={policy.enabledCategories[cat]}
                        onChange={() => toggleCategory(cat)}
                        aria-label={`Redact ${meta.label}`}
                        className="h-3.5 w-3.5 accent-emerald-500"
                      />
                      <input
                        type="checkbox"
                        checked={policy.restorableCategories[cat]}
                        onChange={() => toggleRestore(cat)}
                        aria-label={`Restore ${meta.label}`}
                        className="h-3.5 w-3.5 accent-sky-500"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-zinc-500">
              Anonymization reduces exposure but cannot guarantee perfect privacy. Always
              review the outgoing preview before transmitting.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
