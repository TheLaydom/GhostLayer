# GhostLayer security

The cloud provider is outside the local trust boundary. A prompt can contain credentials, personal information, or instructions trying to influence the local model. Cloud responses can contain arbitrary text and guessed placeholder tokens.

- Default policy blocks cloud use when the contextual scan is unavailable. An explicit rules-only policy allows a changed, reviewed prompt after deterministic redaction. The gate blocks recognizable high-risk material left in the preview, including when its category is disabled.
- Match spans use UTF-16 indices against the current input. Invalid local model spans fail review. Overlapping spans are redacted as a union. Literal placeholder lookalikes are reserved to avoid ambiguous restoration.
- Findings and mappings contain sensitive data. Keep them in extension memory. Avoid logging them, writing them to storage, or serializing the whole review. Only the string from `toCloudPrompt` crosses the transport boundary.
- High-risk mappings are ineligible for restoration by default. Restoration is one pass and limited to known, eligible, bracketed tokens. Render all model output as text.
- App Check debug mode is for private development. Keep debug tokens out of source, distributable builds, and submission material. Production cloud access requires a verified MV3-compatible attestation setup.

Detection is best effort. Encoded, unusual, or split secrets and contextual data can be missed. Explicit user review remains necessary. The extension must guard every call path. The pure core cannot enforce a caller's network or storage behavior.
