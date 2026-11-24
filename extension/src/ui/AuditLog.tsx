import { ChevronDown, ChevronRight, History } from 'lucide-react';
import { useState } from 'react';

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: 'scan' | 'cloud-send' | 'blocked';
  findingsCount: number;
  localAiStatus: string;
  target: string;
  latencyMs: number;
  note?: string;
}

interface AuditLogProps {
  entries: readonly AuditEntry[];
}

export function AuditLog({ entries }: AuditLogProps) {
  const [open, setOpen] = useState(false);

  if (entries.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#14151B]/90">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-xs text-white/80 transition hover:bg-white/[0.04]"
      >
        <span className="flex items-center gap-2 font-medium">
          <History className="h-3.5 w-3.5 text-[#38BDF8]" />
          <span>Session Activity ({entries.length})</span>
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/45">
            RAM Only
          </span>
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-white/45" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-white/45" />
        )}
      </button>

      {open && (
        <div className="divide-y divide-white/[0.06] border-t border-white/[0.08] font-mono text-[11px]">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-white/35">{entry.timestamp}</span>
                <span
                  className={
                    entry.action === 'blocked'
                      ? 'text-[#FF453A]'
                      : entry.action === 'cloud-send'
                        ? 'text-[#0A84FF]'
                        : 'text-[#30D158]'
                  }
                >
                  {entry.action.toUpperCase()}
                </span>
                <span className="text-white/80">
                  {entry.findingsCount} redacted · {entry.target}
                </span>
              </div>
              <span className="text-white/40">{entry.latencyMs}ms</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
