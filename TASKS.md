# TASKS.md — GhostLayer Backlog

| ID | Phase | Task | Owner | Status | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- |
| T0.1 | Phase 0 | Audit environment and repo: existing files, node/npm, Chrome, Firebase config, Gemini Nano availability. Record in `PROJECT_STATUS.md`. | Gemini | DONE (partial — shell blocked; see `PROJECT_STATUS.md`) | Environment findings and blockers accurately documented in `PROJECT_STATUS.md`. |
| T0.2 | Phase 0 | Scaffold monorepo: `packages/core`, `extension/`, `.gitignore`, lint, Vitest, build scripts, MIT license. | Codex | OPEN | Root workspace builds/tests cleanly; MIT `LICENSE` and `.gitignore` committed; `git init` completed. |
| T0.3 | Phase 0 | Write/finalize `AGENTS.md` from coordination rules and ownership split. | Codex | OPEN (draft seeded by Gemini) | `AGENTS.md` reviewed and finalized by Codex on `main`. |
| T1.1 | Phase 1 | Deterministic detectors: email, phone, IPv4/IPv6, API keys/tokens (AWS, GitHub, Google, OpenAI-style, JWT, generic high-entropy), URLs with creds, file paths with usernames, credit cards (Luhn), env var assignments. | Codex | OPEN | Unit tests with positive & negative cases; no catastrophic backtracking regexes. |
| T1.2 | Phase 1 | Placeholder mapping: consistent, collision-safe, handles overlapping findings. | Codex | OPEN | Same original value maps to same placeholder in session; overlaps resolved deterministically. |
| T1.3 | Phase 1 | `restore()`: correct restoration including repeated and partially mangled placeholders in model output. | Codex | OPEN | Unit tests cover repeated, adjacent, and slightly mangled placeholders. |
| T1.4 | Phase 1 | Policy object: enabled categories, local-only mode, `blockIfLocalAiUnavailable` default `true`. | Codex | OPEN | Policy defaults and enforcement verified by unit tests. |
| T1.5 | Phase 1 | Fail-safe tests proving original text never appears in outgoing payload when local AI is unavailable. | Codex | OPEN | Automated tests prove fail-safe blocking and zero secret leakage. |
| T2.1 | Phase 2 | MV3 scaffold with React, Vite, Tailwind, sidepanel that builds and loads unpacked. | Gemini | DONE | `extension/` built cleanly (`vite v8.3.8`, 0 TS errors) and loaded unpacked in browser Side Panel. |
| T2.2 | Phase 2 | Prompt input UI with live highlighting of detected items by category. | Gemini | DONE | Verified live in Side Panel: live rule hit pills + color-coded local span highlighting with tooltips. |
| T2.3 | Phase 2 | "Exactly what will be sent" preview with sanitized text and list of replaced items. | Gemini | DONE | Verified live in Side Panel: exact sanitized preview + masked local vault table with click-to-reveal. |
| T2.4 | Phase 2 | Clear local vs cloud processing indicators and privacy controls (toggle categories, local-only mode). | Gemini | DONE | Verified live in Side Panel: telemetry strip + policy drawer + fail-safe fallback warning. |
| T2.5 | Phase 2 | Design system: typography, spacing, colors, no generic AI-template look, no fake features. | Gemini | DONE | Verified live in Side Panel: crisp dark security-tool UI. |
| T3.1 | Phase 3 | Investigate Chrome on-device AI (`LanguageModel` / Gemini Nano) availability and MV3 compatibility; implement contextual name/org detection behind feature check with graceful fallback. | Gemini | DONE | Verified live in Chrome: added `expectedInputs`/`expectedOutputs` (`languages: ['en']`), `responseConstraint` JSON Schema, and warm session cloning; Brave gracefully falls back via fail-safe policy. |
| T3.2 | Phase 3 | Firebase AI Logic cloud call with sanitized prompt, config via env, App Check wired up. | Gemini | IN PROGRESS (Firebase `gh0stlairr` + AI Logic enabled in gitignored `extension/.env.local`; pending App Check debug token registration & live send test) | `firebase/ai` (`ONLY_IN_CLOUD`) + `firebase/app-check` (`getToken` enforcement, runtime debug token mode) built cleanly; Mock Mode removed per user request. |
| T3.3 | Phase 3 | End-to-end flow: input -> detect -> sanitize -> preview -> cloud -> restore -> display. | Gemini (Codex reviews) | IN PROGRESS (12/12 unit tests + build passing; pending final live Gemini cloud send after App Check token registration) | Full E2E flow wired against `@ghostlayer/core` + AI-site Auto-Guard / Autopilot / In-Page Restore. |
| T4.1 | Phase 4 | Security review of full data flow, threat model in `SECURITY.md` including honest limitations. | Codex | OPEN | `SECURITY.md` documents threat model, guarantees, and explicit limitations. |
| T4.2 | Phase 4 | Integration tests for end-to-end flow. | Codex | OPEN | Automated tests verify full sanitize -> cloud -> restore pipeline and fail-safe invariants. |
| T4.3 | Phase 4 | `README.md` with reproducible install steps from clean clone, known limitations, license. | Gemini | IN PROGRESS | Clear, honest `README.md` in repo root. |
| T4.4 | Phase 4 | Three-minute demo script and checklist against `#BuildHybridAI 2026` hackathon rules. | Gemini | DONE (draft in `DEMO_SCRIPT.md`; final check pending build/Firebase) | Verified against `https://firebasehybridaihackathon.devpost.com/rules`. |
| T4.5 | Phase 4 | Cross-review: each agent reviews the other's code and scores it in `AGENT_EVALUATIONS.md` (100-pt rubric). | Both | OPEN | Evidence-backed scores from actually running code and tests. |

## Cross-Agent Requests

- **Gemini -> Codex:**
  1. Please run `git init` in `C:\Gh0stLi@arr` and initialize `main` + `agent/codex` + `agent/gemini` (Gemini's `run_command` tool currently fails on this host because `powershell` is missing from Antigravity's `%PATH%`).
  2. Please run `npm install`, `npm run typecheck`, `npm run build` inside `extension/` after `packages/core` or monorepo setup, and report any real TypeScript/build issues in `PROJECT_STATUS.md` or `TASKS.md`.
  3. Once `packages/core` lands with the shared `sanitize` / `restore` contract, Gemini (or Codex) can swap `extension/src/core-adapter.ts` to import directly from `@ghostlayer/core`.
  4. **Live test catch (2026-11-24):** Natural-language phrasing like `"my api key is fw4b6j9356b93j45645"` (19 chars, lowercase+digits, space + `is` instead of `:`/`=`) bypassed `packages/core/src/rules.ts` during live testing on Claude. Gemini added a temporary supplement in `extension/src/core-adapter.ts`; please consider upstreaming natural-language secret phrasing (`(?:api[\s_-]?key|password|secret|token)\s+is\s+<secret>`) into `packages/core/src/rules.ts`.
