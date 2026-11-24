import { CATEGORY_META, type Finding, type Severity } from '../core-adapter';

interface HighlightedPromptProps {
  text: string;
  findings: readonly Finding[];
}

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: 'bg-red-500/20 text-red-200 border-b border-red-400',
  high: 'bg-amber-500/20 text-amber-200 border-b border-amber-400',
  medium: 'bg-sky-500/20 text-sky-200 border-b border-sky-400',
};

export function HighlightedPrompt({ text, findings }: HighlightedPromptProps) {
  if (!text) {
    return <p className="font-mono text-xs text-zinc-500">No text scanned yet.</p>;
  }

  if (findings.length === 0) {
    return (
      <div className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-zinc-300">
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
    <div className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-zinc-200">
      {parts.map((part) => {
        if (!part.finding) return <span key={part.key}>{part.content}</span>;
        const meta = CATEGORY_META[part.finding.type];
        return (
          <mark
            key={part.key}
            title={`${meta.label} -> ${part.finding.placeholder} (${part.finding.source})`}
            className={`rounded-sm px-0.5 ${SEVERITY_STYLES[meta.severity]}`}
          >
            {part.content}
          </mark>
        );
      })}
    </div>
  );
}
