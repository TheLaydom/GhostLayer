# CHANGELOG.md

All notable changes to GhostLayer are documented in this file.

## [Unreleased]

### Added (Gemini/Antigravity — 2026-11-24)
- Created initial multi-agent coordination files (`AGENTS.md`, `TASKS.md`, `PROJECT_STATUS.md`, `CHANGELOG.md`, `AGENT_EVALUATIONS.md`).
- Scaffolded `extension/` as a Chrome Manifest V3 Side Panel app using React 19, TypeScript, Vite 6, and Tailwind CSS.
- Implemented `extension/src/core-adapter.ts` matching the shared `sanitize` / `restore` / `Finding` / `Mapping` / `Policy` contract (ready to swap to `packages/core`).
- Implemented strict on-device contextual detection (`extension/src/services/localAi.ts`) using `InferenceMode.ONLY_ON_DEVICE` / Chrome `LanguageModel` API with verbatim offset anchoring and fail-safe fallback.
- Implemented Firebase AI Logic (`InferenceMode.ONLY_IN_CLOUD`) + App Check integration (`extension/src/services/firebase.ts`) with explicit Mock Cloud mode for testing before Firebase credentials are configured.
- Built Side Panel UI with live category highlighting, exact outgoing wire preview, masked local placeholder vault, privacy policy drawer, and raw-vs-restored response comparison.
- Added right-click browser context menu (`Inspect & Sanitize with GhostLayer`) using RAM-only `chrome.storage.session` handoff to the Side Panel.
- Added live-as-you-type local deterministic hit counters and an in-memory Session Audit Log (`extension/src/ui/AuditLog.tsx`).
- Added Vitest unit test suites for `extension/src/core-adapter.ts` and `extension/src/services/localAi.ts` (pending execution once shell/Codex runs `npm test`).
- Added `DEMO_SCRIPT.md` (T4.4) with 3-minute demo script and `#BuildHybridAI 2026` pre-submission checklist.
- Added `README.md` with setup instructions, architecture summary, and honest limitations.

### Fixed (Gemini/Antigravity — 2026-11-24, addressing Codex review findings)
- Upgraded `extension/package.json` dependencies to `firebase@^13.4.0`, `vite@^8.3.8`, `@vitejs/plugin-react@^6.0.0`, `typescript@^5.9.3`, and `vitest@^4.1.12`.
- Added explicit `initializeDeviceModel()` initialization inside `FirebaseOnlyOnDeviceRunner` (`extension/src/services/firebase.ts`).
- Replaced build-time `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` with boolean `VITE_FIREBASE_APPCHECK_DEBUG_MODE` (runtime-generated private debug token), enforced `getToken(appCheck)` before live cloud calls, and refused to expose a live cloud client when App Check is unconfigured.
- Fixed malformed JSON handling in `extension/src/services/localAi.ts` so non-JSON or schema-invalid on-device output returns `unavailable` and triggers the fail-safe block instead of reporting `ready`.
- Aligned `extension/src/core-adapter.ts` with `@ghostlayer/core`: added `ENV` category, reserved literal placeholder lookalikes to prevent round-trip collisions, and added `createReview()` + `toCloudPrompt()` blocking unchanged rules-only fallback prompts.
- Added monotonic revision tracking in `extension/src/App.tsx` to invalidate stale approvals on prompt edits, policy changes, or in-flight async scans, and separated deterministic rule timing from on-device Nano latency.
- Added regression unit tests in `extension/tests/` for all fixes and logged reciprocal review of Codex's `packages/core` in `AGENT_EVALUATIONS.md`.

### Added & Integrated (Gemini/Antigravity — 2026-11-24)
- Unpacked Codex's `GhostLayer-core.bundle` (`b1293cb`) into `C:\Gh0stLi@arr` (`packages/core`, `SECURITY.md`, `ARCHITECTURE.md`, `LICENSE`, `.gitignore`, `SUBMISSION.md`) and initialized Git.
- Replaced the transitional sanitizer stub in `extension/src/core-adapter.ts` with direct imports from Codex's `@ghostlayer/core`.
- Built AI-site **Auto-Guard** content script (`extension/src/content.ts`, self-contained IIFE `dist/content.js`) targeting ChatGPT, Claude, Gemini, AI Studio, Perplexity, Poe, and Grok: intercepts Enter/Send when sensitive data is detected, displays a Shadow DOM firewall overlay with one-click **Sanitize & Send**, **Replace Only**, **Side Panel**, and explicit **Send Original Anyway**, plus an optional **Autopilot: Quietly Sanitize & Send** mode (toast notification) and one-click in-page **Restore Replies** button (text-node only, keeps critical secrets redacted).
- Fixed Vite 8 `__dirname` warning and narrow sidepanel telemetry bar spacing.
