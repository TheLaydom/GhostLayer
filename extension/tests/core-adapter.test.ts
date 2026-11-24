import { describe, expect, it } from 'vitest';
import { createDefaultPolicy, SessionSanitizer } from '../src/core-adapter';

describe('SessionSanitizer (extension core-adapter)', () => {
  it('assigns consistent placeholders across repeated values in a session', () => {
    const sanitizer = new SessionSanitizer();
    const policy = createDefaultPolicy();

    const first = sanitizer.sanitize(
      'Email alex@example.com and CC Alex@Example.com.',
      policy,
    );
    expect(first.sanitized).toBe('Email [EMAIL_1] and CC [EMAIL_1].');
    expect(first.mappings).toHaveLength(1);

    const second = sanitizer.sanitize('Reply to alex@example.com ASAP.', policy);
    expect(second.sanitized).toBe('Reply to [EMAIL_1] ASAP.');
  });

  it('redacts critical secrets and refuses to auto-restore them by default', () => {
    const sanitizer = new SessionSanitizer();
    const policy = createDefaultPolicy();

    const input =
      'Send key sk-proj-abc1234567890XYZ9876543210 to alex@example.com please.';
    const res = sanitizer.sanitize(input, policy);

    expect(res.sanitized).not.toContain('sk-proj-abc1234567890XYZ9876543210');
    expect(res.sanitized).not.toContain('alex@example.com');
    expect(res.sanitized).toContain('[API_KEY_1]');
    expect(res.sanitized).toContain('[EMAIL_1]');

    const restored = sanitizer.restore(
      'Draft for [EMAIL_1]: rotated [API_KEY_1].',
      res.mappings,
      policy.restorableCategories,
    );
    expect(restored.restored).toBe('Draft for alex@example.com: rotated [API_KEY_1].');
    expect(restored.skippedPlaceholders).toContain('[API_KEY_1]');
  });

  it('detects residual critical secrets when a category is disabled by user', () => {
    const sanitizer = new SessionSanitizer();
    const policy = createDefaultPolicy();
    policy.enabledCategories.API_KEY = false;

    const res = sanitizer.sanitize('Use sk-proj-abc1234567890XYZ9876543210', policy);
    const residual = sanitizer.hasResidualCriticalSecrets(res.sanitized);
    expect(residual.length).toBeGreaterThan(0);
  });
});
