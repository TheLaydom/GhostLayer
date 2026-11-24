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
    <section className="rounded border border-zinc-800 bg-zinc-900/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-900/60"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <History className="h-3.5 w-3.5 text-zinc-400" />
          <span>Session Audit Log ({entries.length}) — RAM Only</span>
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
        )}
      </button>

      {open && (
        <div className="divide-y divide-zinc-800/80 border-t border-zinc-800 font-mono text-[11px]">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-zinc-500">{entry.timestamp}</span>
                <span
                  className={
                    entry.action === 'blocked'
                      ? 'text-red-400'
                      : entry.action === 'cloud-send'
                        ? 'text-sky-400'
                        : 'text-emerald-400'
                  }
                >
                  {entry.action.toUpperCase()}
                </span>
                <span className="text-zinc-300">
                  {entry.findingsCount} redacted · {entry.target}
                </span>
              </div>
              <span className="text-zinc-500">
                nano:{entry.localAiStatus} · {entry.latencyMs}ms
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
