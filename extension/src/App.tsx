import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAX_PROMPT_LENGTH } from '@ghostlayer/core';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  Lock,
  RefreshCw,
  Send,
  Shield,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import {
  CATEGORY_META,
  createDefaultPolicy,
  maskPreview,
  sanitize,
  SessionSanitizer,
  type CategoryType,
  type Policy,
} from './core-adapter';
import { createExtensionServices, type CloudResult } from './services/firebase';
import type { LocalAiAvailability, LocalAiScanResult } from './services/localAi';
import { loadSavedPolicy, savePolicy } from './services/storage';
import { AuditLog, type AuditEntry } from './ui/AuditLog';
import { HighlightedPrompt } from './ui/HighlightedPrompt';
import { PolicyDrawer } from './ui/PolicyDrawer';

const PENDING_SELECTION_KEY = 'ghostlayer.pendingSelection';

const SAMPLE_PROMPTS = [
  {
    label: 'Email + PII',
    text: 'Write a follow-up email to Alex Morgan at alex.morgan@acme.example about the Q4 contract. My phone is +1 (415) 555-0198.',
  },
  {
    label: 'Logs + Secrets',
    text: 'Debug why postgres://admin:Sup3rS3cretPass!@10.0.4.22:5432/prod fails with OPENAI_API_KEY=sk-proj-abc1234567890XYZ9876543210 in C:\\Users\\alex\\repo\\db.ts.',
  },
];

interface ScanSnapshot {
  revision: number;
  result: ReturnType<SessionSanitizer['createReview']>;
  localAi: LocalAiScanResult;
  ruleLatencyMs: number;
}

function nowTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function App() {
  const services = useMemo(() => createExtensionServices(), []);
  const sanitizer = useMemo(() => new SessionSanitizer(), []);

  const [prompt, setPrompt] = useState(SAMPLE_PROMPTS[0].text);
  const [policy, setPolicy] = useState<Policy>(() => createDefaultPolicy());
  const [policyOpen, setPolicyOpen] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);

  const [useMockCloud, setUseMockCloud] = useState(!services.telemetry.firebaseConfigured);
  const [localAiStatus, setLocalAiStatus] = useState<{
    status: LocalAiAvailability;
    engine: string;
    reason?: string;
  }>({ status: 'unavailable', engine: 'none' });

  const [snapshot, setSnapshot] = useState<ScanSnapshot | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const [cloudOutput, setCloudOutput] = useState<{
    cloud: CloudResult;
    restoredText: string;
    restoredCount: number;
    skipped: string[];
  } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [responseTab, setResponseTab] = useState<'restored' | 'raw'>('restored');
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const revision = useRef(0);
  const invalidateReview = useCallback(() => {
    revision.current++;
    setSnapshot(null);
    setCloudOutput(null);
    setSendError(null);
    setRevealed({});
  }, []);

  // Stateless live deterministic preview while typing (runs locally, <1ms, zero vault mutation)
  const livePreviewCounts = useMemo(() => {
    if (!prompt.trim() || prompt.length > MAX_PROMPT_LENGTH) {
      return [] as Array<{ type: CategoryType; count: number }>;
    }
    const preview = sanitize(prompt, policy);
    const counts = new Map<CategoryType, number>();
    for (const f of preview.findings) {
      counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
  }, [prompt, policy]);

  useEffect(() => {
    let mounted = true;
    loadSavedPolicy().then((saved) => {
      if (mounted) {
        invalidateReview();
        setPolicy(saved);
      }
    });
    services.localScanner.checkStatus().then((st) => {
      if (mounted) setLocalAiStatus(st);
    });

    // Consume any selection sent via right-click context menu (RAM-only session storage)
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      chrome.storage.session.get(PENDING_SELECTION_KEY).then((data) => {
        const pending = data[PENDING_SELECTION_KEY] as { text?: string } | undefined;
        if (mounted && pending?.text) {
          setPrompt(pending.text);
          invalidateReview();
          setSelectionNotice('Loaded selected text from browser context menu.');
          void chrome.storage.session.remove(PENDING_SELECTION_KEY);
        }
      });

      const handleStorageChange = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ) => {
        if (areaName !== 'session') return;
        const nextVal = changes[PENDING_SELECTION_KEY]?.newValue as
          | { text?: string }
          | undefined;
        if (nextVal?.text) {
          setPrompt(nextVal.text);
          invalidateReview();
          setSelectionNotice('Loaded selected text from browser context menu.');
          void chrome.storage.session.remove(PENDING_SELECTION_KEY);
        }
      };

      chrome.storage.onChanged.addListener(handleStorageChange);
      return () => {
        mounted = false;
        chrome.storage.onChanged.removeListener(handleStorageChange);
      };
    }

    return () => {
      mounted = false;
    };
  }, [services, invalidateReview]);

  const updatePolicy = (next: Policy) => {
    invalidateReview();
    setPolicy(next);
    void savePolicy(next);
  };

  const appendAudit = (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => {
    setAuditEntries((prev) => [
      { ...entry, id: `aud_${Date.now()}_${prev.length}`, timestamp: nowTime() },
      ...prev.slice(0, 29),
    ]);
  };

  const handleScan = async () => {
    invalidateReview();
    if (prompt.length > MAX_PROMPT_LENGTH) {
      setSendError(`Shorten the prompt to ${MAX_PROMPT_LENGTH.toLocaleString()} characters before reviewing.`);
      return;
    }
    const scanRevision = revision.current;
    setIsScanning(true);
    setSendError(null);
    setSelectionNotice(null);
    try {
      const localAi = await services.localScanner.scan(prompt);
      if (scanRevision !== revision.current) return;
      const ruleStart = performance.now();
      const result = sanitizer.createReview(prompt, policy, localAi.status === 'ready' ? localAi.spans : null);
      const ruleLatencyMs = Math.round(performance.now() - ruleStart);

      setLocalAiStatus({
        status: localAi.status,
        engine: localAi.engine,
        reason: localAi.reason,
      });
      setSnapshot({
        revision: scanRevision,
        result,
        localAi,
        ruleLatencyMs,
      });

      appendAudit({
        action: 'scan',
        findingsCount: result.findings.length,
        localAiStatus: localAi.status,
        target: 'local-only',
        latencyMs: ruleLatencyMs,
      });
    } catch (error) {
      if (scanRevision === revision.current) {
        setSendError(error instanceof Error ? error.message : 'Local review failed.');
      }
    } finally {
      setIsScanning(false);
    }
  };

  const blockers: Array<{ code: string; message: string }> = [];
  if (snapshot) {
    if (snapshot.result.blocked === 'local-only') {
      blockers.push({
        code: 'LOCAL_ONLY',
        message: 'Local-Only Mode is active. Cloud transmission is disabled by your policy.',
      });
    }
    if (snapshot.result.blocked === 'local-ai-unavailable') {
      blockers.push({
        code: 'LOCAL_AI_UNAVAILABLE',
        message:
          snapshot.localAi.reason ??
          'On-device AI is unavailable. Send requires an allowed rules-only review that redacts at least one span.',
      });
    }
    if (snapshot.result.blocked === 'residual-sensitive-data') {
      blockers.push({
        code: 'RESIDUAL_CRITICAL',
        message: 'Blocked: the preview contains recognizable sensitive data. Re-enable redaction or remove it.',
      });
    }
  }

  const canTransmit = Boolean(snapshot) && blockers.length === 0 && !isSending;

  const handleTransmit = async () => {
    if (!snapshot || !canTransmit || snapshot.revision !== revision.current) return;
    setIsSending(true);
    setSendError(null);
    try {
      const cloud = await services.cloudClient.generate(
        snapshot.result.toCloudPrompt(prompt, snapshot.result.sanitized),
        useMockCloud,
      );
      if (snapshot.revision !== revision.current) return;
      const restoration = sanitizer.restore(
        cloud.rawText,
        snapshot.result.mappings,
      );

      setCloudOutput({
        cloud,
        restoredText: restoration.restored,
        restoredCount: restoration.restoredCount,
        skipped: restoration.skippedPlaceholders,
      });
      setResponseTab('raw');

      appendAudit({
        action: 'cloud-send',
        findingsCount: snapshot.result.findings.length,
        localAiStatus: snapshot.localAi.status,
        target: cloud.model,
        latencyMs: cloud.latencyMs,
      });
    } catch (err) {
      if (snapshot.revision === revision.current) {
        setSendError(err instanceof Error ? err.message : 'Cloud transmission failed.');
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleResetVault = () => {
    sanitizer.clear();
    invalidateReview();
    setAuditEntries([]);
  };

  const handleCopySanitized = async () => {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(snapshot.result.sanitized);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded border border-emerald-500/40 bg-emerald-500/10">
            <Shield className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-zinc-100">
              GhostLayer
            </h1>
            <p className="text-[11px] text-zinc-400">Local-First AI Privacy Firewall</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleResetVault}
            className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Reset Vault</span>
          </button>
          <button
            type="button"
            onClick={() => setPolicyOpen(true)}
            className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Policy</span>
          </button>
        </div>
      </header>

      {/* Processing Boundary Indicators */}
      <div className="grid grid-cols-3 gap-2 border-b border-zinc-800/80 bg-zinc-900/40 px-4 py-2 text-[11px]">
        <div className="flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          <span className="text-zinc-400">Rules:</span>
          <span className="font-mono text-emerald-300">LOCAL</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Cpu
            className={`h-3.5 w-3.5 shrink-0 ${
              localAiStatus.status === 'ready' ? 'text-emerald-400' : 'text-amber-400'
            }`}
          />
          <span className="text-zinc-400">Nano:</span>
          <span
            className={`font-mono uppercase ${
              localAiStatus.status === 'ready' ? 'text-emerald-300' : 'text-amber-300'
            }`}
          >
            {localAiStatus.status}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Cloud
            className={`h-3.5 w-3.5 shrink-0 ${
              policy.localOnlyMode
                ? 'text-zinc-500'
                : services.telemetry.firebaseConfigured && !useMockCloud
                  ? 'text-sky-400'
                  : 'text-amber-400'
            }`}
          />
          <span className="text-zinc-400">Cloud:</span>
          <span className="truncate font-mono text-zinc-200">
            {policy.localOnlyMode
              ? 'DISABLED'
              : useMockCloud
                ? 'MOCK MODE'
                : services.telemetry.cloudModel}
          </span>
        </div>
      </div>

      {/* Main */}
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4">
        {selectionNotice && (
          <div className="flex items-center justify-between rounded border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
            <span>{selectionNotice}</span>
            <button
              type="button"
              onClick={() => setSelectionNotice(null)}
              className="text-emerald-400 hover:text-emerald-200"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Step 1: Draft */}
        <section className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="prompt-input" className="text-xs font-medium text-zinc-200">
              1. Prompt Input (Stays On-Device Until Approved)
            </label>
            <div className="flex items-center gap-1.5">
              {SAMPLE_PROMPTS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => {
                    setPrompt(s.text);
                    invalidateReview();
                  }}
                  className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                >
                  Sample: {s.label}
                </button>
              ))}
            </div>
          </div>

          <textarea
            id="prompt-input"
            maxLength={MAX_PROMPT_LENGTH}
            rows={5}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              invalidateReview();
            }}
            placeholder="Enter text, code, logs, or emails to sanitize locally..."
            className="w-full resize-y rounded border border-zinc-800 bg-zinc-950 p-2.5 font-mono text-xs leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
          />

          {/* Live deterministic pre-scan pills */}
          {livePreviewCounts.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-zinc-500">Live rule hits:</span>
              {livePreviewCounts.map(({ type, count }) => {
                const meta = CATEGORY_META[type];
                const pillTone =
                  meta.severity === 'critical'
                    ? 'border-red-500/40 bg-red-950/50 text-red-200'
                    : meta.severity === 'high'
                      ? 'border-amber-500/40 bg-amber-950/40 text-amber-200'
                      : 'border-sky-500/40 bg-sky-950/40 text-sky-200';
                return (
                  <span
                    key={type}
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${pillTone}`}
                  >
                    {count} {meta.label}
                  </span>
                );
              })}
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400">
              <input
                type="checkbox"
                checked={useMockCloud}
                disabled={!services.telemetry.firebaseConfigured}
                onChange={(e) => {
                  invalidateReview();
                  setUseMockCloud(e.target.checked);
                }}
                className="h-3.5 w-3.5 accent-amber-500"
              />
              <span>
                Mock Cloud Mode{' '}
                {!services.telemetry.firebaseConfigured && '(Firebase .env.local not set)'}
              </span>
            </label>

            <button
              type="button"
              onClick={handleScan}
              disabled={isScanning || !prompt.trim()}
              className="flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'Scanning Locally...' : 'Inspect & Sanitize'}</span>
            </button>
          </div>
        </section>

        {/* Step 2: Inspection & Wire Preview */}
        {snapshot && (
          <section className="space-y-3 rounded border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-zinc-200">
                2. Local Findings &amp; Exact Outgoing Preview
              </h2>
              <span className="font-mono text-[11px] text-zinc-400">
                {snapshot.result.findings.length} finding(s) · {snapshot.ruleLatencyMs}ms
              </span>
            </div>

            {blockers.map((b) => (
              <div
                key={b.code}
                className="flex items-start gap-2 rounded border border-red-500/40 bg-red-950/40 p-2.5 text-xs text-red-200"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <div className="flex-1">
                  <div className="font-medium">Cloud Transmission Blocked (Fail-Safe)</div>
                  <p className="mt-0.5 text-red-200/90">{b.message}</p>
                  {b.code === 'LOCAL_AI_UNAVAILABLE' && (
                    <button
                      type="button"
                      onClick={() =>
                        updatePolicy({ ...policy, blockIfLocalAiUnavailable: false })
                      }
                      className="mt-2 rounded border border-red-400/40 bg-red-900/40 px-2 py-1 text-[11px] font-medium text-red-100 hover:bg-red-900/70"
                    >
                      Allow Deterministic-Only Fallback
                    </button>
                  )}
                </div>
              </div>
            ))}

            {!policy.blockIfLocalAiUnavailable && snapshot.localAi.status !== 'ready' && (
              <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-950/30 p-2.5 text-xs text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <p>
                  Deterministic-only fallback is active because Chrome Gemini Nano is{' '}
                  {snapshot.localAi.status}. Contextual entities like personal names or
                  company names may not be detected.
                </p>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded border border-zinc-800 bg-zinc-950 p-2.5">
                <div className="mb-1.5 flex items-center justify-between text-[11px]">
                  <span className="font-medium text-zinc-300">Detected Locally</span>
                  <span className="font-mono text-emerald-400">ON-DEVICE ONLY</span>
                </div>
                <HighlightedPrompt
                  text={prompt}
                  findings={snapshot.result.findings}
                />
              </div>

              <div className="rounded border border-zinc-800 bg-zinc-950 p-2.5">
                <div className="mb-1.5 flex items-center justify-between text-[11px]">
                  <span className="font-medium text-zinc-300">
                    Exactly What Will Be Sent
                  </span>
                  <button
                    type="button"
                    onClick={handleCopySanitized}
                    className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200"
                  >
                    <Copy className="h-3 w-3" />
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <div className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-emerald-200">
                  {snapshot.result.sanitized}
                </div>
              </div>
            </div>

            {snapshot.result.mappings.length > 0 && (
              <div className="overflow-hidden rounded border border-zinc-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950 text-[11px] uppercase tracking-wider text-zinc-400">
                    <tr>
                      <th className="px-3 py-1.5">Placeholder</th>
                      <th className="px-3 py-1.5">Type</th>
                      <th className="px-3 py-1.5">Source</th>
                      <th className="px-3 py-1.5">Original (Local Vault)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/80 bg-zinc-900/30 font-mono text-[11px]">
                    {snapshot.result.mappings.map((m) => {
                      const isOpen = Boolean(revealed[m.placeholder]);
                      return (
                        <tr key={m.placeholder}>
                          <td className="px-3 py-1.5 text-emerald-300">{m.placeholder}</td>
                          <td className="px-3 py-1.5 text-zinc-300">{m.type}</td>
                          <td className="px-3 py-1.5 text-zinc-400">{m.source}</td>
                          <td className="px-3 py-1.5 text-zinc-200">
                            <div className="flex items-center justify-between gap-2">
                              <span className="max-w-[180px] truncate">
                                {isOpen ? m.original : maskPreview(m.original)}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setRevealed((prev) => ({
                                    ...prev,
                                    [m.placeholder]: !prev[m.placeholder],
                                  }))
                                }
                                aria-label={`Reveal ${m.placeholder}`}
                                className="text-zinc-500 hover:text-zinc-200"
                              >
                                {isOpen ? (
                                  <EyeOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                {canTransmit ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Sanitized payload verified. Original values stay local.</span>
                  </>
                ) : (
                  <span>Resolve blockers above or copy the sanitized prompt manually.</span>
                )}
              </div>

              <button
                type="button"
                onClick={handleTransmit}
                disabled={!canTransmit}
                className="flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" />
                <span>
                  {isSending
                    ? 'Transmitting...'
                    : useMockCloud
                      ? 'Send to Mock Cloud'
                      : 'Send Sanitized to Gemini'}
                </span>
              </button>
            </div>

            {sendError && (
              <div className="rounded border border-red-500/40 bg-red-950/40 p-2.5 text-xs text-red-200">
                {sendError}
              </div>
            )}
          </section>
        )}

        {/* Step 3: Response & Local Restoration */}
        {cloudOutput && (
          <section className="space-y-2.5 rounded border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-medium text-zinc-200">
                  3. Response ({cloudOutput.cloud.model} · {cloudOutput.cloud.latencyMs}ms)
                </h2>
                <p className="text-[11px] text-zinc-400">
                  Restored {cloudOutput.restoredCount} safe placeholder(s) locally.
                  {cloudOutput.skipped.length > 0 &&
                    ` Kept ${cloudOutput.skipped.join(', ')} redacted.`}
                </p>
              </div>
              <div className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setResponseTab('restored')}
                  className={`rounded px-2 py-1 ${
                    responseTab === 'restored'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Restored (Local)
                </button>
                <button
                  type="button"
                  onClick={() => setResponseTab('raw')}
                  className={`rounded px-2 py-1 ${
                    responseTab === 'raw'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Raw Cloud Output
                </button>
              </div>
            </div>

            <div className="whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-100">
              {responseTab === 'restored'
                ? cloudOutput.restoredText
                : cloudOutput.cloud.rawText}
            </div>
          </section>
        )}

        {/* RAM-only Session Audit Log */}
        <AuditLog entries={auditEntries} />
      </main>

      <PolicyDrawer
        open={policyOpen}
        policy={policy}
        onClose={() => setPolicyOpen(false)}
        onChange={updatePolicy}
      />
    </div>
  );
}
