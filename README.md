# GhostLayer

**Local-first AI privacy firewall** built as a Chrome Manifest V3 Side Panel extension using **Chrome On-Device AI (Gemini Nano)** and **Firebase AI Logic** (with **Firebase App Check**).

GhostLayer detects sensitive data locally (deterministic rules + on-device contextual detection), replaces it with consistent session placeholders (`[PERSON_1]`, `[EMAIL_1]`, `[API_KEY_1]`), shows you **exactly what will leave your device**, sends only the sanitized prompt to cloud Gemini, and restores safe placeholders locally. Raw mappings never leave your device.

## Architecture Overview

```text
User Prompt
  -> Local Deterministic Rules (secrets, keys, emails, phones, IPs, paths, Luhn cards)
  -> On-Device AI (Chrome LanguageModel / Firebase InferenceMode.ONLY_ON_DEVICE)
  -> Session Placeholder Vault (in-memory only; never persisted or transmitted)
  -> Privacy Policy Gate (fail-safe: blocks cloud if local AI is unavailable by default)
  -> User Wire Preview ("Exactly What Will Be Sent")
  -> Cloud Gemini via Firebase AI Logic (InferenceMode.ONLY_IN_CLOUD + App Check)
  -> Selective Local Placeholder Restoration (critical secrets stay redacted by default)
```

## Repository Structure

- `packages/core/` — Pure TypeScript detection, anonymization, restoration, and policy engine (no browser APIs).
- `extension/` — Chrome Manifest V3 Side Panel extension (React, TypeScript, Vite, Tailwind CSS, Firebase AI Logic, Chrome `LanguageModel` integration).
- `AGENTS.md`, `TASKS.md`, `PROJECT_STATUS.md`, `CHANGELOG.md`, `AGENT_EVALUATIONS.md` — Multi-agent coordination and progress tracking.

## Local Setup & Installation

### 1. Install and Build the Extension

```bash
cd extension
npm install
npm test
npm run build
```

### 2. Load Unpacked in Chrome

1. Open `chrome://extensions` in Google Chrome.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select `extension/dist`.
4. Click the **GhostLayer** toolbar icon to open the Side Panel.

### 3. Configure Firebase AI Logic (Optional — Mock Cloud Mode works out of the box)

1. Copy `extension/.env.example` to `extension/.env.local`.
2. Create or select a Firebase project and enable Firebase AI Logic:
   ```bash
   npx -y firebase-tools@latest init ailogic
   ```
3. Fill in `VITE_FIREBASE_*` keys in `extension/.env.local` (never commit `.env.local`).
4. For a private development build set `VITE_FIREBASE_APPCHECK_DEBUG=true` in `extension/.env.local`. After rebuilding, initiate a test request with synthetic data, then register the generated token from extension DevTools in Firebase Console (**Security -> App Check -> Apps -> Manage debug tokens**) and retry. Keep the token and debug build private.
   *(Note: Chrome Manifest V3 CSP blocks remote reCAPTCHA scripts, so MV3 extensions require either a debug token for local development or a custom App Check attestation provider for production.)*
5. Rebuild (`npm run build`) and reload the unpacked extension.

### 4. Enable Chrome On-Device AI (Gemini Nano)

1. Use Chrome desktop (138+ recommended) on supported hardware.
2. Enable `chrome://flags/#prompt-api-for-gemini-nano` and `chrome://flags/#optimization-guide-on-device-model` (BypassPerfRequirement if testing on non-standard hardware).
3. Restart Chrome and check `chrome://on-device-internals`.

## Honest Limitations

- **Anonymization is not perfect privacy.** Deterministic rules can miss novel secret formats, and on-device models can miss or misclassify contextual PII. Always inspect the outgoing wire preview before sending.
- **No silent cloud fallback for raw prompts.** Local contextual scanning uses `InferenceMode.ONLY_ON_DEVICE` (or direct Chrome `LanguageModel`). If Gemini Nano is unavailable, GhostLayer blocks cloud transmission by default unless you explicitly opt into Deterministic-Only Fallback.
- **Critical secrets are not auto-restored.** Placeholders for API keys, private keys, passwords, connection strings, credit cards, and SSNs remain redacted in responses by default.

## License

MIT — see `LICENSE`.
