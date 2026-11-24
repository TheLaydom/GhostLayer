# GhostLayer architecture

The core is a pure TypeScript package with no browser, storage, or network dependency. The extension owns input, the Chrome and Firebase adapters, transport, and rendering.

1. Run deterministic detection locally. The extension may additionally run a Firebase AI Logic model configured with `ONLY_ON_DEVICE`. Anchor its findings to exact UTF-16 offsets in the original prompt before passing them to the core.
2. Call `createReview(source, policy)` and display `sanitized` as the preview. Findings and mappings contain original text and stay in the current extension view. Use `createSanitizationSession()` to retain token numbering across reviews, then clear it on reset.
3. Invalidate the preview on source or policy edits. At the send action, call `review.toCloudPrompt(currentSource, confirmedPreview)`. This rejects stale, local-only, and blocked reviews. Pass the returned string alone to the Firebase cloud adapter. Require App Check and use `ONLY_IN_CLOUD` for the reviewed payload.
4. Restore eligible placeholders from the current review in memory. Make revealing the restored response an explicit display action. Never send the response and all mappings back as conversation history.

The extension adapts core categories for display and uses the core's session, review gate, and restoration report. Profile-local policy preferences are the only persisted settings. Selected text can pass from the browser context menu to the extension through Chrome session storage and is removed after the side panel reads it.
