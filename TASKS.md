# GhostLayer tasks

| Task | Owner | Status | Acceptance |
| --- | --- | --- | --- |
| T0.1 Audit | Codex | DONE | Inventory the shared path, tools, and verified AI access in project status. |
| T0.2 Monorepo scaffold | Codex | STAGED | TypeScript core workspace, extension boundary, build, lint, tests, MIT license. Shared integration needs write access. |
| T0.3 Agent instructions | Codex | DONE | Record ownership and handoff workflow. |
| T1.1 Rules | Codex | STAGED | Supported categories, positive and negative tests, bounded scan. |
| T1.2 Placeholders | Codex | STAGED | Stable, collision-safe mapping and overlap handling. |
| T1.3 Restore | Codex | STAGED | Repeated and unambiguous malformed tokens restore locally. |
| T1.4 Policy | Codex | STAGED | Category filters, local-only mode, default block when local AI is unavailable. |
| T1.5 Fail safe | Codex | STAGED | Test blocked network paths and sanitized fallback payload. |
| T2.1–T2.5 Extension MVP | Gemini | OPEN | MV3 build, category highlighting, exact preview, controls and coherent UI. |
| T3.1 Nano | Gemini | OPEN | Confirm native Chrome availability and test a safe fallback. |
| T3.2 Firebase | Gemini | OPEN | Mock adapter and App Check. Live verification needs Firebase project configuration. |
| T3.3 End-to-end | Gemini | OPEN | Verify preview, send and restoration with a mock and then Firebase. |
| T4.1 Security review | Codex | REVIEWED, FIXES OPEN | Resolve the findings in AGENT_EVALUATIONS.md and verify the integrated data flow. |
| T4.2 Extension integration test | Codex | BLOCKED | Core mock-transport tests pass. Exercise the integrated UI and capture the actual outgoing request after integration and browser access. |
| T4.3 README | Gemini | OPEN | Document reproducible install and limitations. |
| T4.4 Demo and rules | Shared | DRAFTED | Official rules reviewed and demo outlined. Record after integrated verification. |
| T4.5 Cross-review | Shared | OPEN | Inspect and run each agent's work before assigning evidence-backed scores. |
| Integration | Gemini | OPEN | Adopt `@ghostlayer/core`, wire `ENV` into policy UI, replace the stub vault, and route every send through `toCloudPrompt`. |
| Privacy and build fixes | Gemini | OPEN | Address SDK, device initialization, malformed outputs, stale approvals, and App Check findings in AGENT_EVALUATIONS.md. |
