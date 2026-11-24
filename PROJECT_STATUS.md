# GhostLayer project status

Updated 2026-11-24. The designated shared directory `C:\Gh0stLi@arr` was initially empty. Gemini then populated it with the extension and coordination files. The available permission grant omitted that directory, and `git init` there failed with permission denied. The Codex core is staged in a separate writable Git checkout without a remote. No files in the shared directory were overwritten.

Node 26.13.1, npm 11.20.0, Git 2.56.1, and desktop Chrome 158.0.8127.37 were detected. Native Nano inference remains unverified. No shared Firebase credentials were configured.

The earlier single-package prototype is separate from this TypeScript handoff. It remains available for reference. This checkout reserves the extension integration for Gemini.

## Verified

- `npm run lint`, `npm run build`, and `npm test` passed in the staged TypeScript checkout. Vitest reported 37 passing cases. Core's package audit reported zero vulnerabilities with Vitest 4.1.12.
- The declared Gemini extension dependency set failed type-check and build. An isolated copy type-checked with Firebase 13.4.0 and built with Vite 8.3.8 and React plugin 6. That copy retains four high npm advisories under the Firebase tree. It is review evidence only.
- Ran two targeted regressions and a small detector benchmark against Gemini's actual source. See [evaluation](AGENT_EVALUATIONS.md) for results and open fixes.
- Browser smoke remains pending. The Playwright browser installer hit a child-process permission error and a short-lived isolated system Chrome launch never exposed a DevTools endpoint.
- Verified the official contest deadline and the requirement to use Gemini Nano 4 through Firebase AI Logic. See [submission checklist](SUBMISSION.md).

## Resume

1. Initialize Git in the shared directory with permission, preserving Gemini's files. Bring the staged core, root build setup, and license into the shared checkout. Reconcile the task and status changes with the existing shared files.
2. Gemini integrates the core's session and reviewed-text gate and addresses the extension fixes. Record mock browser evidence and then verify Firebase and Nano with synthetic data.
3. Before live verification, configure a Firebase project with App Check. Keep debug credentials and debug builds private. Review production attestation before distribution.

## GitHub development snapshot

This repository includes the verified TypeScript core and the latest Antigravity extension source as separate workspaces. The extension still uses its transitional adapter. Core tests passed with Vite pinned in the root workspace. The extension build fails with its declared Firebase 11 dependency, which lacks the hybrid inference API. Its test runner also hit a Windows child-process permission error on this host. Dependency audit flagged seven advisories in the combined tree. Browser and live Firebase checks remain open.
