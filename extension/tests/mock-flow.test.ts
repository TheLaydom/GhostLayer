import { afterEach, expect, it, vi } from 'vitest';
import { createDefaultPolicy, SessionSanitizer } from '../src/core-adapter';
import { createExtensionServices } from '../src/services/firebase';

afterEach(() => vi.unstubAllEnvs());

it('reviews, previews, sends to the simulator, and restores locally', async () => {
  vi.stubEnv('VITE_FIREBASE_API_KEY', '');
  const { cloudClient } = createExtensionServices();
  const source = 'Write an email to alex@example.com.';
  const session = new SessionSanitizer();
  const policy = createDefaultPolicy();
  const blocked = session.createReview(source, policy, null);
  expect(() => blocked.toCloudPrompt(source, blocked.sanitized)).toThrow();

  const review = session.createReview(source, { ...policy, blockIfLocalAiUnavailable: false }, null);
  const preview = 'Write an email to [EMAIL_1].';
  expect(review.sanitized).toBe(preview);
  expect(() => review.toCloudPrompt(source + ' edited', preview)).toThrow();
  const outbound = review.toCloudPrompt(source, preview);
  await expect(cloudClient.generate(outbound, false)).rejects.toThrow('App Check');
  const simulated = await cloudClient.generate(outbound, true);
  expect(simulated.mode).toBe('mock-cloud');
  expect(simulated.rawText).toContain(preview);
  expect(simulated.rawText).not.toContain('alex@example.com');
  expect(session.restore(simulated.rawText, review.mappings).restored).toContain('alex@example.com');
});
