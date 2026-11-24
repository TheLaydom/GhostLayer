# GhostLayer — 3-Minute Demo Script & Hackathon Checklist (T4.4)

Target competition: **#BuildHybridAI 2026** (Google Firebase Hybrid AI Hackathon)
Official rules: https://firebasehybridaihackathon.devpost.com/rules
Submission deadline: **November 30, 2026 at 2:00 PM PT** (verify directly on Devpost before submitting).

---

## 3-Minute Demo Video Script

### 0:00 – 0:25 | The Problem
- Show a realistic developer/work prompt containing a person's name, email, phone number, database connection string, and an OpenAI API key.
- Explain why pasting sensitive data directly into cloud AI is a real risk — and why a pure cloud "privacy filter" defeats the point because your secrets already left your machine.

### 0:25 – 0:55 | Why Hybrid AI? (Local + Cloud Architecture)
- Open the **GhostLayer** Chrome MV3 Side Panel.
- Point out the top telemetry strip:
  - `Rules: LOCAL` (deterministic secret & PII engine)
  - `Nano: READY` (Chrome on-device Gemini Nano via `InferenceMode.ONLY_ON_DEVICE`)
  - `Cloud: gemini-3.5-flash` (Firebase AI Logic `InferenceMode.ONLY_IN_CLOUD` + App Check)
- Emphasize the core security boundary: **raw prompts NEVER fall back to cloud**. Local contextual scanning strictly runs on-device; cloud Gemini only ever sees sanitized placeholders.

### 0:55 – 1:45 | Live End-to-End Walkthrough
1. Click **Sample: Email + PII** (or paste a prompt with a name, email, phone, and API key).
2. Click **Inspect & Sanitize**.
3. Show **Detected Locally (On-Device Only)** with color-coded highlights by severity and source (`rule` vs `local-ai`).
4. Show **Exactly What Will Be Sent** — every sensitive item replaced with consistent placeholders (`[PERSON_1]`, `[EMAIL_1]`, `[PHONE_1]`, `[API_KEY_1]`).
5. Show the **Local Vault** table (masked by default, click-to-reveal stays strictly in memory on-device).
6. Click **Send Sanitized to Gemini**.
7. Toggle between **Raw Cloud Output** (proving cloud Gemini only saw and returned placeholders) and **Restored (Local)** (proving GhostLayer restored `[PERSON_1]` and `[EMAIL_1]` locally while keeping `[API_KEY_1]` redacted by default).

### 1:45 – 2:25 | Fail-Safe & Privacy Controls
- Open the **Policy** drawer.
- Show **Local-Only Mode** (zero network egress) and **Fail-Safe: Block Cloud When Local AI Is Unavailable** (enabled by default).
- Explain what happens if Gemini Nano is unavailable: GhostLayer blocks cloud transmission and tells the user clearly instead of silently leaking contextual PII, offering an explicit Deterministic-Only Fallback toggle.

### 2:25 – 3:00 | Honest Limitations & Open Source
- Briefly state GhostLayer's honest security posture: anonymization reduces exposure dramatically, but no regex or local model is 100% perfect — which is why GhostLayer always puts the user in front of an exact outgoing wire preview.
- Show the public MIT-licensed repository and how to build & load unpacked in Chrome.

---

## Pre-Submission Verification Checklist

- [ ] Verify eligibility requirements on https://firebasehybridaihackathon.devpost.com/rules (do not misrepresent age or eligibility; if ineligible, publish as an independent open-source portfolio project).
- [ ] Public GitHub/GitLab repository with MIT `LICENSE` committed.
- [ ] `packages/core` unit & fail-safe tests passing (`npm test`).
- [ ] `extension/` builds cleanly (`npm run build`) and loads unpacked in Chrome MV3.
- [ ] Firebase AI Logic enabled (`npx firebase-tools init ailogic`) and tested with live cloud Gemini.
- [ ] Firebase App Check configured (debug token for local demo / custom provider documented for MV3).
- [ ] Zero secrets or `.env.local` committed to Git (`git status` & `git log` verified).
- [ ] Demo video <= 3:00 uploaded and linked in Devpost submission.
- [ ] English project description matches implemented functionality with zero fabricated claims.
