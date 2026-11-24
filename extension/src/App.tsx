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
import {
  createDefaultAppearance,
  loadSavedAppearance,
  loadSavedPolicy,
  saveAppearance,
  savePolicy,
  type AppearanceSettings,
} from './services/storage';
import { AuditLog, type AuditEntry } from './ui/AuditLog';
import { GhostLogo } from './ui/GhostLogo';
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
  const [appearance, setAppearance] = useState<AppearanceSettings>(() =>
    createDefaultAppearance(),
  );
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
    loadSavedAppearance().then((saved) => {
      if (mounted) setAppearance(saved);
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

  const updateAppearance = (next: AppearanceSettings) => {
    setAppearance(next);
    void saveAppearance(next);
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

  const bgSrc = appearance.customBackgroundDataUrl ?? '/backgrounds/default-bg.png';
  const rootBgClass =
    appearance.style === 'frost-slate'
      ? 'bg-[#0B1120]'
      : 'bg-black';
  const cardSurfaceClass =
    appearance.style === 'ios-glass'
      ? 'border-white/[0.11] bg-[#0D0F16]/75 backdrop-blur-xl'
      : appearance.style === 'frost-slate'
        ? 'border-sky-300/15 bg-[#121B2E]/95'
        : 'border-white/[0.08] bg-[#14151B]';

  return (
    <div className={`relative flex min-h-screen flex-col ${rootBgClass} text-[#F5F5F7]`}>
      {/* Optional Frosted PNG Background Layer (Default: iOS Glass) */}
      {appearance.style === 'ios-glass' && (
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <img
            src={bgSrc}
            alt=""
            aria-hidden="true"
            style={{ opacity: appearance.backgroundOpacity / 100 }}
            className="h-full w-full scale-105 object-cover object-center blur-[2px] saturate-110"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/45 to-black/85" />
        </div>
      )}

      {/* iOS Translucent Glass Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/[0.08] bg-black/70 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <GhostLogo size={32} />
          <div>
            <h1 className="text-[15px] font-semibold tracking-[-0.02em] text-white">
              GhostLayer
            </h1>
            <p className="text-[11px] text-white/45">On-Device AI Firewall</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleResetVault}
            title="Reset session vault"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] bg-[#16171D] text-white/65 transition hover:bg-white/10 hover:text-white"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setPolicyOpen(true)}
            className="flex h-8 items-center gap-1.5 rounded-full border border-white/[0.08] bg-[#16171D] px-3 text-xs font-medium text-white/85 transition hover:bg-white/10 hover:text-white"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-[#38BDF8]" />
            <span>Policy</span>
          </button>
        </div>
      </header>

      {/* Compact iOS Pill Telemetry Bar */}
      <div className="relative z-10 flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] bg-black/55 px-4 py-2 text-[10px] backdrop-blur-md">
        <span className="inline-flex items-center gap-1 rounded-full border border-[#30D158]/30 bg-[#30D158]/10 px-2 py-0.5 font-medium text-[#70F095]">
          <Lock className="h-2.5 w-2.5" />
          <span>Local Rules</span>
        </span>

        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${
            localAiStatus.status === 'ready'
              ? 'border-[#0A84FF]/35 bg-[#0A84FF]/15 text-[#7AC4FF]'
              : 'border-[#FF9F0A]/35 bg-[#FF9F0A]/15 text-[#FFD27D]'
          }`}
        >
          <Cpu className="h-2.5 w-2.5" />
          <span>
            {localAiStatus.engine === 'local-heuristic'
              ? `Heuristic (${localAiStatus.browserName ?? 'Brave'})`
              : `Nano ${localAiStatus.status}`}
          </span>
        </span>

        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${
            policy.localOnlyMode || !services.telemetry.firebaseConfigured
              ? 'border-white/10 bg-white/[0.05] text-white/50'
              : 'border-[#38BDF8]/30 bg-[#38BDF8]/10 text-[#93DCFF]'
          }`}
        >
          <Cloud className="h-2.5 w-2.5" />
          <span>
            {policy.localOnlyMode
              ? 'Local Only'
              : services.telemetry.firebaseConfigured
                ? services.telemetry.cloudModel
                : 'Cloud Off'}
          </span>
        </span>
      </div>

      {/* Main Content */}
      <main className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col gap-3.5 p-3.5">
        {selectionNotice && (
          <div className="flex items-center justify-between rounded-2xl border border-[#0A84FF]/35 bg-[#0A84FF]/15 px-3.5 py-2 text-xs text-[#CFE8FF]">
            <span>{selectionNotice}</span>
            <button
              type="button"
              onClick={() => setSelectionNotice(null)}
              className="font-medium text-[#60A5FA] hover:text-white"
            >
              Done
            </button>
          </div>
        )}

        {/* Card 1: Prompt Composer */}
        <section className={`rounded-2xl border p-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.45)] ${cardSurfaceClass}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <label
              htmlFor="prompt-input"
              className="text-[12px] font-semibold tracking-tight text-white/90"
            >
              Prompt
            </label>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-white/50">
              {policy.autoGuardAiSites
                ? policy.autoSanitizeSilently
                  ? 'Web Autopilot ON'
                  : 'Web Guard ON'
                : 'Web Guard OFF'}
            </span>
          </div>

          <textarea
            id="prompt-input"
            rows={4}
            value={prompt}
            onChange={(e) => updatePrompt(e.target.value)}
            placeholder="Type or paste sensitive text, emails, or code — redacted locally before anything leaves your device..."
            className="w-full resize-y rounded-xl border border-white/[0.07] bg-black/75 p-3 font-mono text-xs leading-relaxed text-white placeholder:text-white/30 focus:border-[#0A84FF]/70 focus:outline-none focus:ring-2 focus:ring-[#0A84FF]/20"
          />

          {livePreviewCounts.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {livePreviewCounts.map(({ type, count }) => {
                const meta = CATEGORY_META[type];
                const pillTone =
                  meta.severity === 'critical'
                    ? 'border-[#FF453A]/40 bg-[#FF453A]/15 text-[#FFB4AF]'
                    : meta.severity === 'high'
                      ? 'border-[#FF9F0A]/40 bg-[#FF9F0A]/15 text-[#FFE0A3]'
                      : 'border-[#0A84FF]/40 bg-[#0A84FF]/15 text-[#A8D5FF]';
                return (
                  <span
                    key={type}
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${pillTone}`}
                  >
                    {count} {meta.label}
                  </span>
                );
              })}
            </div>
          )}

          {scanError && (
            <div className="mt-2.5 rounded-xl border border-[#FF453A]/40 bg-[#FF453A]/15 p-2.5 text-xs text-[#FFD2CF]">
              {scanError}
            </div>
          )}

          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              onClick={handleScan}
              disabled={isScanning || !prompt.trim()}
              className="flex items-center gap-1.5 rounded-full bg-[#0A84FF] px-4 py-2 text-xs font-semibold text-white shadow-[0_4px_16px_rgba(10,132,255,0.35)] transition hover:bg-[#3398FF] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'Scanning...' : 'Inspect & Sanitize'}</span>
            </button>
          </div>
        </section>

        {/* Card 2: Inspection & Wire Preview */}
        {snapshot && (
          <section className={`space-y-3 rounded-2xl border p-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.45)] ${cardSurfaceClass}`}>
            <div className="flex flex-wrap items-center justify-between gap-1">
              <h2 className="text-[12px] font-semibold tracking-tight text-white/90">
                Outgoing Review
              </h2>
              <span className="font-mono text-[10px] text-white/45">
                {snapshot.review.findings.length} finding(s) · {snapshot.ruleLatencyMs}ms
                rules · {snapshot.localAi.latencyMs}ms local
              </span>
            </div>

            {blockerMessage && (
              <div className="flex items-start gap-2.5 rounded-xl border border-[#FF453A]/40 bg-[#FF453A]/15 p-3 text-xs text-[#FFD2CF]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#FF453A]" />
                <div className="flex-1">
                  <div className="font-semibold text-white">Transmission Blocked</div>
                  <p className="mt-0.5 text-white/80">{blockerMessage}</p>
                  {snapshot.review.blocked === 'local-ai-unavailable' &&
                    policy.blockIfLocalAiUnavailable && (
                      <button
                        type="button"
                        onClick={() =>
                          updatePolicy({ ...policy, blockIfLocalAiUnavailable: false })
                        }
                        className="mt-2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-medium text-white transition hover:bg-white/25"
                      >
                        Allow Deterministic Fallback
                      </button>
                    )}
                </div>
              </div>
            )}

            <div className="grid gap-2.5 md:grid-cols-2">
              <div className="rounded-xl border border-white/[0.07] bg-black/70 p-3">
                <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider">
                  <span className="font-semibold text-white/50">On-Device Only</span>
                  <span className="font-mono text-[#30D158]">Private</span>
                </div>
                <HighlightedPrompt
                  text={snapshot.original}
                  findings={snapshot.review.findings}
                />
              </div>

              <div className="rounded-xl border border-[#0A84FF]/25 bg-[#07111F] p-3">
                <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider">
                  <span className="font-semibold text-[#7AC4FF]">Wire Preview</span>
                  <button
                    type="button"
                    onClick={handleCopySanitized}
                    className="flex items-center gap-1 normal-case text-white/60 transition hover:text-white"
                  >
                    <Copy className="h-3 w-3" />
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <div className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[#E0F2FE]">
                  {snapshot.review.sanitized}
                </div>
              </div>
            </div>

            {snapshot.review.mappings.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-black/50">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-white/40">
                    <tr>
                      <th className="px-3 py-2">Token</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Vault</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05] font-mono text-[11px]">
                    {snapshot.review.mappings.map((m) => {
                      const isOpen = Boolean(revealed[m.placeholder]);
                      return (
                        <tr key={m.placeholder}>
                          <td className="whitespace-nowrap px-3 py-2 text-[#60A5FA]">
                            {m.placeholder}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-white/45">
                            {m.source}
                          </td>
                          <td className="px-3 py-2 text-white/85">
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
                                className="shrink-0 text-white/40 transition hover:text-white"
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
              <div className="flex items-center gap-1.5 text-[11px] text-white/50">
                {canTransmit ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#30D158]" />
                    <span>Verified. Raw values stay local.</span>
                  </>
                ) : !services.telemetry.firebaseConfigured ? (
                  <span>Copy sanitized text above or connect Firebase AI Logic.</span>
                ) : (
                  <span>Resolve blockers above before sending.</span>
                )}
              </div>

              {services.telemetry.firebaseConfigured && (
                <button
                  type="button"
                  onClick={handleTransmit}
                  disabled={!canTransmit}
                  className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black shadow-sm transition hover:bg-white/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{isSending ? 'Sending...' : 'Send to Gemini'}</span>
                </button>
              )}
            </div>

            {sendError && (
              <div className="rounded-xl border border-[#FF453A]/40 bg-[#FF453A]/15 p-2.5 text-xs text-[#FFD2CF]">
                {sendError}
              </div>
            )}
          </section>
        )}

        {/* Card 3: Cloud Response & Local Restoration */}
        {cloudOutput && (
          <section className={`space-y-3 rounded-2xl border p-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.45)] ${cardSurfaceClass}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[12px] font-semibold tracking-tight text-white/90">
                  Response · {cloudOutput.cloud.model}
                </h2>
                <p className="text-[11px] text-white/45">
                  {cloudOutput.cloud.latencyMs}ms · restored {cloudOutput.restoredCount}{' '}
                  locally
                  {cloudOutput.skipped.length > 0 &&
                    ` · kept ${cloudOutput.skipped.join(', ')} redacted`}
                </p>
              </div>

              {/* iOS Segmented Control */}
              <div className="flex items-center rounded-full border border-white/[0.08] bg-black/70 p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setResponseTab('restored')}
                  className={`rounded-full px-3 py-1 font-medium transition ${
                    responseTab === 'restored'
                      ? 'bg-[#0A84FF] text-white'
                      : 'text-white/55 hover:text-white'
                  }`}
                >
                  Restored
                </button>
                <button
                  type="button"
                  onClick={() => setResponseTab('raw')}
                  className={`rounded-full px-3 py-1 font-medium transition ${
                    responseTab === 'raw'
                      ? 'bg-[#0A84FF] text-white'
                      : 'text-white/55 hover:text-white'
                  }`}
                >
                  Raw Cloud
                </button>
              </div>
            </div>

            <div className="whitespace-pre-wrap rounded-xl border border-white/[0.07] bg-black/70 p-3 text-[13px] leading-relaxed text-white/90">
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
        appearance={appearance}
        onClose={() => setPolicyOpen(false)}
        onChange={updatePolicy}
        onAppearanceChange={updateAppearance}
      />
    </div>
  );
}
