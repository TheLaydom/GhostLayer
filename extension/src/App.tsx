import { useEffect, useMemo, useRef, useState } from 'react';
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
  type ReviewResult,
} from './core-adapter';
import { createExtensionServices, type CloudResult } from './services/firebase';
import type { LocalAiAvailability, LocalAiScanResult } from './services/localAi';
import { loadSavedPolicy, savePolicy } from './services/storage';
import { AuditLog, type AuditEntry } from './ui/AuditLog';
import { HighlightedPrompt } from './ui/HighlightedPrompt';
import { PolicyDrawer } from './ui/PolicyDrawer';

const PENDING_SELECTION_KEY = 'ghostlayer.pendingSelection';

interface ScanSnapshot {
  revision: number;
  original: string;
  review: ReviewResult;
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
  const revisionRef = useRef(0);

  const [prompt, setPrompt] = useState('');
  const [policy, setPolicy] = useState<Policy>(() => createDefaultPolicy());
  const [policyOpen, setPolicyOpen] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);

  const [localAiStatus, setLocalAiStatus] = useState<{
    status: LocalAiAvailability;
    engine: string;
    browserName?: string;
    reason?: string;
  }>({ status: 'unavailable', engine: 'none' });

  const [snapshot, setSnapshot] = useState<ScanSnapshot | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
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

  const invalidateApproval = () => {
    revisionRef.current += 1;
    setSnapshot(null);
    setScanError(null);
    setSendError(null);
  };

  const livePreviewCounts = useMemo(() => {
    if (!prompt.trim()) return [] as Array<{ type: CategoryType; count: number }>;
    try {
      const preview = sanitize(prompt, policy);
      const counts = new Map<CategoryType, number>();
      for (const f of preview.findings) {
        counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
    } catch {
      return [];
    }
  }, [prompt, policy]);

  useEffect(() => {
    let mounted = true;
    loadSavedPolicy().then((saved) => {
      if (mounted) {
        revisionRef.current += 1;
        setPolicy(saved);
        setSnapshot(null);
      }
    });
    services.localScanner.checkStatus().then((st) => {
      if (mounted) setLocalAiStatus(st);
    });

    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      chrome.storage.session.get(PENDING_SELECTION_KEY).then((data) => {
        const pending = data[PENDING_SELECTION_KEY] as { text?: string } | undefined;
        if (mounted && pending?.text) {
          revisionRef.current += 1;
          setPrompt(pending.text);
          setSnapshot(null);
          setSelectionNotice('Loaded text from active browser tab.');
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
          revisionRef.current += 1;
          setPrompt(nextVal.text);
          setSnapshot(null);
          setSelectionNotice('Loaded text from active browser tab.');
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
  }, [services]);

  const updatePolicy = (next: Policy) => {
    invalidateApproval();
    setPolicy(next);
    void savePolicy(next);
  };

  const updatePrompt = (next: string) => {
    invalidateApproval();
    setPrompt(next);
  };

  const appendAudit = (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => {
    setAuditEntries((prev) => [
      { ...entry, id: `aud_${Date.now()}_${prev.length}`, timestamp: nowTime() },
      ...prev.slice(0, 29),
    ]);
  };

  const handleScan = async () => {
    const scanRevision = revisionRef.current;
    const capturedPrompt = prompt;
    const capturedPolicy = policy;

    setIsScanning(true);
    setScanError(null);
    setSendError(null);
    setSelectionNotice(null);

    try {
      const localAi = await services.localScanner.scan(capturedPrompt);
      if (revisionRef.current !== scanRevision) return;

      const ruleStart = performance.now();
      const review = sanitizer.createReview(
        capturedPrompt,
        capturedPolicy,
        localAi.status === 'ready',
        localAi.spans,
      );
      const ruleLatencyMs = Number((performance.now() - ruleStart).toFixed(2));

      setLocalAiStatus({
        status: localAi.status,
        engine: localAi.engine,
        browserName: localAi.browserName,
        reason: localAi.reason,
      });
      setSnapshot({
        revision: scanRevision,
        original: capturedPrompt,
        review,
        localAi,
        ruleLatencyMs,
      });

      appendAudit({
        action: review.blocked ? 'blocked' : 'scan',
        findingsCount: review.findings.length,
        localAiStatus: localAi.status,
        target: review.blocked ? `gate:${review.blocked}` : 'local-only',
        latencyMs: Math.round(ruleLatencyMs + localAi.latencyMs),
      });
    } catch (err) {
      if (revisionRef.current === scanRevision) {
        setScanError(err instanceof Error ? err.message : 'Local scan failed.');
      }
    } finally {
      if (revisionRef.current === scanRevision) {
        setIsScanning(false);
      }
    }
  };

  const blockerMessage = (() => {
    if (!snapshot || !snapshot.review.blocked) return null;
    if (snapshot.review.blocked === 'local-only') {
      return 'Local-Only Mode is active. Cloud transmission is disabled by your policy.';
    }
    if (snapshot.review.blocked === 'residual-sensitive-data') {
      return 'Blocked: outgoing payload still contains unredacted high-risk secret(s). Re-enable redaction or remove them.';
    }
    if (
      !policy.blockIfLocalAiUnavailable &&
      snapshot.review.sanitized === snapshot.original
    ) {
      return 'Blocked (fail-safe): On-device AI is unavailable and deterministic rules made no redactions. Sending unchanged original text to cloud is not permitted.';
    }
    return (
      snapshot.localAi.reason ??
      'On-device AI is unavailable. Fail-safe policy blocks cloud transmission rather than risking unredacted contextual PII.'
    );
  })();

  const canTransmit =
    Boolean(snapshot) &&
    snapshot!.revision === revisionRef.current &&
    snapshot!.review.blocked === null &&
    services.telemetry.firebaseConfigured &&
    !isScanning &&
    !isSending;

  const handleTransmit = async () => {
    if (!snapshot || !canTransmit) return;
    const sendRevision = snapshot.revision;

    setIsSending(true);
    setSendError(null);

    try {
      if (revisionRef.current !== sendRevision) {
        throw new Error('Review expired because prompt or policy changed. Re-scan first.');
      }
      const wirePayload = snapshot.review.toCloudPrompt(
        prompt,
        snapshot.review.sanitized,
      );

      const cloud = await services.cloudClient.generate(wirePayload);
      if (revisionRef.current !== sendRevision) return;

      const restoration = sanitizer.restore(
        cloud.rawText,
        snapshot.review.mappings,
        policy.restorableCategories,
      );

      setCloudOutput({
        cloud,
        restoredText: restoration.restored,
        restoredCount: restoration.restoredCount,
        skipped: restoration.skippedPlaceholders,
      });
      setResponseTab('restored');

      appendAudit({
        action: 'cloud-send',
        findingsCount: snapshot.review.findings.length,
        localAiStatus: snapshot.localAi.status,
        target: cloud.model,
        latencyMs: cloud.latencyMs,
      });
    } catch (err) {
      if (revisionRef.current === sendRevision) {
        setSendError(err instanceof Error ? err.message : 'Cloud transmission failed.');
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleResetVault = () => {
    invalidateApproval();
    sanitizer.clear();
    setCloudOutput(null);
    setRevealed({});
    setAuditEntries([]);
  };

  const handleCopySanitized = async () => {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(snapshot.review.sanitized);
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
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-zinc-800/80 bg-zinc-900/40 px-4 py-2 text-[11px]">
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
          <span className="text-zinc-400">
            {localAiStatus.engine === 'local-heuristic' ? 'Local NER:' : 'Nano:'}
          </span>
          <span
            className={`font-mono uppercase ${
              localAiStatus.status === 'ready' ? 'text-emerald-300' : 'text-amber-300'
            }`}
          >
            {localAiStatus.engine === 'local-heuristic'
              ? `HEURISTIC (${localAiStatus.browserName ?? 'Brave'})`
              : localAiStatus.status}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Cloud
            className={`h-3.5 w-3.5 shrink-0 ${
              policy.localOnlyMode
                ? 'text-zinc-500'
                : services.telemetry.firebaseConfigured
                  ? 'text-sky-400'
                  : 'text-zinc-500'
            }`}
          />
          <span className="text-zinc-400">Cloud:</span>
          <span className="truncate font-mono text-zinc-200">
            {policy.localOnlyMode
              ? 'LOCAL ONLY'
              : services.telemetry.firebaseConfigured
                ? services.telemetry.cloudModel
                : 'NOT CONNECTED'}
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
          <div className="mb-2 flex items-center justify-between gap-2">
            <label htmlFor="prompt-input" className="text-xs font-medium text-zinc-200">
              1. Prompt Input (Processed On-Device)
            </label>
            <span className="font-mono text-[10px] text-zinc-500">
              {policy.autoGuardAiSites
                ? policy.autoSanitizeSilently
                  ? 'AI Sites: Autopilot'
                  : 'AI Sites: Guard ON'
                : 'AI Sites: OFF'}
            </span>
          </div>

          <textarea
            id="prompt-input"
            rows={5}
            value={prompt}
            onChange={(e) => updatePrompt(e.target.value)}
            placeholder="Paste text, logs, code, or emails to sanitize locally before sending to AI..."
            className="w-full resize-y rounded border border-zinc-800 bg-zinc-950 p-2.5 font-mono text-xs leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
          />

          {livePreviewCounts.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-zinc-500">Live hits:</span>
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

          {scanError && (
            <div className="mt-2 rounded border border-red-500/40 bg-red-950/40 p-2 text-xs text-red-200">
              {scanError}
            </div>
          )}

          <div className="mt-2.5 flex items-center justify-end">
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
            <div className="flex flex-wrap items-center justify-between gap-1">
              <h2 className="text-xs font-medium text-zinc-200">
                2. Local Findings &amp; Outgoing Preview
              </h2>
              <span className="font-mono text-[11px] text-zinc-400">
                {snapshot.review.findings.length} finding(s) · rules{' '}
                {snapshot.ruleLatencyMs}ms · nano {snapshot.localAi.latencyMs}ms
              </span>
            </div>

            {blockerMessage && (
              <div className="flex items-start gap-2 rounded border border-red-500/40 bg-red-950/40 p-2.5 text-xs text-red-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <div className="flex-1">
                  <div className="font-medium">Cloud Transmission Blocked (Fail-Safe)</div>
                  <p className="mt-0.5 text-red-200/90">{blockerMessage}</p>
                  {snapshot.review.blocked === 'local-ai-unavailable' &&
                    policy.blockIfLocalAiUnavailable && (
                      <button
                        type="button"
                        onClick={() =>
                          updatePolicy({ ...policy, blockIfLocalAiUnavailable: false })
                        }
                        className="mt-2 rounded border border-red-400/40 bg-red-900/40 px-2 py-1 text-[11px] font-medium text-red-100 hover:bg-red-900/70"
                      >
                        Allow Deterministic-Only Fallback (Requires Re-Scan)
                      </button>
                    )}
                </div>
              </div>
            )}

            {!policy.blockIfLocalAiUnavailable &&
              snapshot.localAi.status !== 'ready' &&
              snapshot.review.blocked === null && (
                <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-950/30 p-2.5 text-xs text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <p>
                    Deterministic-only fallback is active because Gemini Nano is{' '}
                    {snapshot.localAi.status}. Contextual entities like personal names may
                    not be detected.
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
                  text={snapshot.original}
                  findings={snapshot.review.findings}
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
                  {snapshot.review.sanitized}
                </div>
              </div>
            </div>

            {snapshot.review.mappings.length > 0 && (
              <div className="overflow-x-auto rounded border border-zinc-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950 text-[10px] uppercase tracking-wider text-zinc-400">
                    <tr>
                      <th className="px-2.5 py-1.5">Token</th>
                      <th className="px-2.5 py-1.5">Source</th>
                      <th className="px-2.5 py-1.5">Local Vault</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/80 bg-zinc-900/30 font-mono text-[11px]">
                    {snapshot.review.mappings.map((m) => {
                      const isOpen = Boolean(revealed[m.placeholder]);
                      return (
                        <tr key={m.placeholder}>
                          <td className="px-2.5 py-1.5 text-emerald-300 whitespace-nowrap">
                            {m.placeholder}
                          </td>
                          <td className="px-2.5 py-1.5 text-zinc-400 whitespace-nowrap">
                            {m.source}
                          </td>
                          <td className="px-2.5 py-1.5 text-zinc-200">
                            <div className="flex items-center justify-between gap-2">
                              <span className="max-w-[140px] truncate">
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
                                className="text-zinc-500 hover:text-zinc-200 shrink-0"
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

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                {canTransmit ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span>Sanitized payload verified. Original values stay local.</span>
                  </>
                ) : !services.telemetry.firebaseConfigured ? (
                  <span>
                    Copy the sanitized prompt above, or connect Firebase AI Logic in{' '}
                    <code className="text-zinc-300">.env.local</code> for built-in Gemini.
                  </span>
                ) : (
                  <span>Resolve blockers above or copy the sanitized prompt manually.</span>
                )}
              </div>

              {services.telemetry.firebaseConfigured && (
                <button
                  type="button"
                  onClick={handleTransmit}
                  disabled={!canTransmit}
                  className="flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>
                    {isSending ? 'Transmitting...' : 'Send Sanitized to Gemini'}
                  </span>
                </button>
              )}
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
