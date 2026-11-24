import { CATEGORY_META, type Finding, type Severity } from '../core-adapter';

interface HighlightedPromptProps {
  text: string;
  findings: readonly Finding[];
}

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: 'bg-[#FF453A]/20 text-[#FFD2CF] border-b border-[#FF453A]',
  high: 'bg-[#FF9F0A]/20 text-[#FFE5B4] border-b border-[#FF9F0A]',
  medium: 'bg-[#0A84FF]/25 text-[#CFE8FF] border-b border-[#38BDF8]',
};

export function HighlightedPrompt({ text, findings }: HighlightedPromptProps) {
  if (!text) {
    return <p className="font-mono text-xs text-white/40">No text scanned yet.</p>;
  }

  if (findings.length === 0) {
    return (
      <div className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-white/80">
        {text}
      </div>
    );
  }

  const parts: Array<{ key: string; content: string; finding?: Finding }> = [];
  let cursor = 0;

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    if (f.start > cursor) {
      parts.push({ key: `t_${cursor}`, content: text.slice(cursor, f.start) });
    }
    parts.push({ key: `f_${i}_${f.start}`, content: text.slice(f.start, f.end), finding: f });
    cursor = f.end;
  }

  if (cursor < text.length) {
    parts.push({ key: `t_${cursor}`, content: text.slice(cursor) });
  }

  return (
    <div className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-white/90">
      {parts.map((part) => {
        if (!part.finding) return <span key={part.key}>{part.content}</span>;
        const meta = CATEGORY_META[part.finding.type];
        return (
          <mark
            key={part.key}
            title={`${meta.label} -> ${part.finding.placeholder} (${part.finding.source})`}
            className={`rounded px-1 py-0.5 ${SEVERITY_STYLES[meta.severity]}`}
          >
            {part.content}
          </mark>
        );
      })}
    </div>
  );
}
