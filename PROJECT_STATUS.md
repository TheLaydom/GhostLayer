# PROJECT_STATUS.md — GhostLayer

Last updated: 2026-11-24 (Gemini/Antigravity)

## Current State

- **Repository:** `C:\Gh0stLi@arr` — unified monorepo with Git initialized (`agent/codex` imported from `GhostLayer-core.bundle` at `b1293cb`), `packages/core` + `extension/` wired together.
- **Extension build & tests:** Verified live via PowerShell (`12/12` Vitest tests passing against `@ghostlayer/core`, `tsc --noEmit` + Vite 8.3.8 sidepanel + `background.js` + `content.js` 0 errors/0 warnings).
- **On-Device AI (Gemini Nano):** Verified running on user's Chrome desktop. Updated `extension/src/services/localAi.ts` with `expectedInputs`/`expectedOutputs` (`languages: ['en']`), `responseConstraint` JSON Schema enforcement, and warm session `clone()`. Note: Brave strips Google's Optimization Guide / Gemini Nano runtime, so Nano is Chrome-desktop-only (Brave uses deterministic fail-safe fallback).
- **Cloud AI (Firebase AI Logic + App Check):** **LIVE VERIFIED** on Firebase project `gh0stlairr` (`gemini-3.5-flash`, `1282ms` round-trip) with App Check enforced (`getToken()` verified), gitignored `extension/.env.local`, and Mock Mode removed.
- **Brave + Chrome Support:** Unified single MV3 build auto-detects Chrome (real Gemini Nano with `responseConstraint` JSON Schema) vs Brave/other Chromium (`Local NER: HEURISTIC (BRAVE)` in `1.5ms`).
- **GitHub Remote:** Synced and pushed to `https://github.com/TheLaydom/GhostLayer` (`main`).
- **Auto-Guard AI Websites:** Content script active on ChatGPT, Claude, Gemini, AI Studio, Perplexity, Poe, and Grok with live amber draft count pill, one-click `Sanitize & Send`, toggleable `Autopilot` quiet-sanitize mode, and one-click in-page `Restore Replies`.

## T0.1 Environment Audit (Honest Findings)

- **Existing files in `C:\Gh0stLi@arr`:** None existed prior to this session (`AGENTS.md`, `TASKS.md`, `PROJECT_STATUS.md`, `package.json`, `CHANGELOG.md` all absent).
- **Shell / CLI probe (`node`, `npm`, `git`, `chrome`, `firebase`):** **BLOCKED in Gemini/Antigravity's environment** — `run_command` fails with:
  `exec: "C:\\Users\\iorda\\AppData\\Local\\Programs\\antigravity\\powershell": executable file not found in %PATH%`
  Therefore, Gemini could NOT verify `node`, `npm`, `git`, or local Chrome versions via CLI, and has **NOT executed `npm install`, `tsc`, `vite build`, or `vitest`** yet. Do not treat `extension/` as build-verified until shell execution is restored or Codex runs the build/tests.
- **Firebase configuration:** Not configured yet. No `.env.local` or Firebase project credentials exist in the repo.
- **Chrome On-Device AI (Gemini Nano / `LanguageModel` API) & Firebase AI Logic docs verified via web search:**
  - `#BuildHybridAI 2026` submission window: Nov 11 – Nov 30, 2026 (2:00 PM PT); winners ~Dec 21, 2026; requires Firebase AI Logic + App Check + public open-source repo.
  - Firebase AI Logic Web SDK (`firebase/ai`) supports `InferenceMode.ONLY_ON_DEVICE`, `PREFER_ON_DEVICE`, `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD`.
  - **Critical security design decision:** Local contextual detection MUST use `InferenceMode.ONLY_ON_DEVICE` (or direct Chrome `LanguageModel` API), **NEVER** `PREFER_ON_DEVICE`, because `PREFER_ON_DEVICE` would silently fall back to cloud and leak raw prompts.
  - **Critical MV3 constraint:** Chrome Manifest V3 CSP blocks remote reCAPTCHA scripts (`https://www.google.com/recaptcha/...`). Standard `ReCaptchaEnterpriseProvider` cannot load in MV3 extension pages; use Firebase App Check Debug Token for local dev or a `CustomProvider` attestation backend for production MV3.
  - **User activation constraint:** Initializing/downloading Gemini Nano via Chrome's `LanguageModel` API requires an explicit user gesture (e.g., clicking "Inspect & Anonymize" or "Check / Download Local AI").

## Completed

- T0.1 (partial): Initial repo check, API/hackathon doc verification, and honest blocker logging.
- Seeded `AGENTS.md`, `TASKS.md`, `PROJECT_STATUS.md`, `CHANGELOG.md`, `AGENT_EVALUATIONS.md`.
- Implemented `extension/` MVP (T2.1–T2.5, T3.1–T3.3) against the shared core contract using a clean local adapter stub (`extension/src/core-adapter.ts`) ready to swap to `packages/core`.
- Addressed all 8 findings from Codex's `AGENT_EVALUATIONS.md` review (Firebase 13.4.0 / Vite 8.3.8 upgrade, `initializeDeviceModel()`, malformed local AI JSON fail-safe, unchanged rules-only fallback block, monotonic revision stale-approval guard, reserved placeholder collision fix, runtime-only App Check debug mode + `getToken` enforcement, separated rule vs Nano timings) and added regression tests in `extension/tests/`.
- Logged reciprocal review of Codex's commit `b1293cb` (`packages/core`, `SECURITY.md`, `ARCHITECTURE.md`) in `AGENT_EVALUATIONS.md`.
- Added right-click browser context menu (`Inspect & Sanitize with GhostLayer`) via RAM-only `chrome.storage.session`, live-as-you-type deterministic rule counters, an in-memory Session Audit Log (`extension/src/ui/AuditLog.tsx`), and Vitest suites in `extension/tests/` (pending execution once Codex/shell runs `npm test`).
- Wrote `README.md` (T4.3) and `DEMO_SCRIPT.md` (T4.4).

## Blockers Requiring User Action

1. **Antigravity PowerShell PATH:** Add `C:\Windows\System32\WindowsPowerShell\v1.0` to Windows `PATH` (and restart Antigravity) if you want Gemini/Antigravity to run `git`, `npm`, and `vitest` directly. (Codex can still run them independently.)
2. **Firebase Project & App Check (T3.2 live cloud):** To enable real cloud Gemini calls, create a Firebase project, run `npx firebase-tools init ailogic`, register an App Check debug token in Firebase Console, and populate `extension/.env.local` from `extension/.env.example`.
3. **Chrome Gemini Nano flags (T3.1 live browser test):** Ensure Chrome 138+ desktop with Gemini Nano enabled (`chrome://flags/#prompt-api-for-gemini-nano` and `chrome://flags/#optimization-guide-on-device-model`, then verify at `chrome://on-device-internals`).

## Next Steps

- **Codex:** Run `git init`, execute T0.2 (`packages/core` + monorepo setup + `LICENSE`), T0.3 (review `AGENTS.md`), T1.1–T1.5 (core detectors + tests), and verify `extension/` builds via `npm install && npm run build`.
- **Gemini:** Once `packages/core` lands (and/or shell access is restored), wire `extension/src/core-adapter.ts` to `@ghostlayer/core`, verify build & unpacked extension load in Chrome, and perform T4.5 cross-review.

### Nano structured-output follow-up

The Chrome runner now keeps the JSON constraint on every request and destroys standalone scan sessions so they cannot retain earlier prompts. The shared extension passed 13 tests and rebuilt both the side panel and content script. The installed Chrome copy still needs a reload and a live Nano scan to verify the device response.
