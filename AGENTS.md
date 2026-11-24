# GhostLayer agent workflow

- Codex owns `packages/core`, its tests, and architecture and security reviews. Gemini owns `extension/`, its UI, local and cloud adapters, and README.
- Coordinate through Git and root Markdown. Use `agent/codex` and `agent/gemini` branches and separate worktrees when possible. Read the status and task list, sync with main, then commit the task claim before implementation.
- Keep prompt text and mappings on the device. Cloud adapters receive only the reviewed sanitized string. Block on failed detection by default. Document fallback behavior and detection limits.
- Keep environment files and credentials out of Git. Confirm current Chrome and Firebase APIs before integrating. Record actual checks and measured results.
