import { afterEach, expect, it, vi } from 'vitest';
import { createDefaultPolicy, SessionSanitizer } from '../src/core-adapter';
import { createExtensionServices } from '../src/services/firebase';

afterEach(() => vi.unstubAllEnvs());

it('reviews, previews, enforces App Check gate, and restores cloud replies locally', async () => {
  vi.stubEnv('VITE_FIREBASE_API_KEY', '');
  const { cloudClient } = createExtensionServices();
  const source = 'Write an email to alex@example.com.';
  const session = new SessionSanitizer();
  const policy = createDefaultPolicy();

  // Strict fail-safe blocks when local AI is unavailable
  const blocked = session.createReview(source, policy, false);
  expect(() => blocked.toCloudPrompt(source, blocked.sanitized)).toThrow();

  // Rules-only fallback allows a changed, reviewed prompt and rejects stale edits
  const review = session.createReview(
    source,
    { ...policy, blockIfLocalAiUnavailable: false },
    false,
  );
  const preview = 'Write an email to [EMAIL_1].';
  expect(review.sanitized).toBe(preview);
  expect(() => review.toCloudPrompt(`${source} edited`, preview)).toThrow();

  const outbound = review.toCloudPrompt(source, preview);
  expect(outbound).toBe(preview);
  expect(outbound).not.toContain('alex@example.com');

  // Unconfigured Firebase/App Check rejects live cloud generation
  await expect(cloudClient.generate(outbound)).rejects.toThrow('App Check');

  // Simulated cloud reply preserves placeholders and restores locally
  const fakeCloudReply = `Sure! Here is a draft for [EMAIL_1]: Hello!`;
  const restored = session.restore(fakeCloudReply, review.mappings);
  expect(restored.restored).toBe('Sure! Here is a draft for alex@example.com: Hello!');
});
