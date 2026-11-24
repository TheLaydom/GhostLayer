import { describe, expect, it } from 'vitest';
import { createDefaultPolicy, SessionSanitizer } from '../src/core-adapter';

describe('SessionSanitizer (extension core-adapter)', () => {
  it('assigns consistent placeholders across repeated values in a session', () => {
    const sanitizer = new SessionSanitizer();
    const policy = createDefaultPolicy();

    const first = sanitizer.sanitize(
      'Email alex@example.com and CC alex@example.com.',
      policy,
    );
    expect(first.sanitized).toBe('Email [EMAIL_1] and CC [EMAIL_1].');
    expect(first.mappings).toHaveLength(1);

    const second = sanitizer.sanitize('Reply to alex@example.com ASAP.', policy);
    expect(second.sanitized).toBe('Reply to [EMAIL_1] ASAP.');
  });

  it('avoids placeholder collisions when literal tokens exist in source text', () => {
    const sanitizer = new SessionSanitizer();
    const policy = createDefaultPolicy();

    const input = 'Keep literal [EMAIL_1] untouched and redact alex@example.com.';
    const res = sanitizer.sanitize(input, policy);

    expect(res.sanitized).toBe('Keep literal [EMAIL_1] untouched and redact [EMAIL_2].');
    const restored = sanitizer.restore(res.sanitized, res.mappings, policy.restorableCategories);
    expect(restored.restored).toBe(input);
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

  it('blocks unchanged prompts under rules-only fallback when local AI is unavailable', () => {
    const sanitizer = new SessionSanitizer();
    const policy = createDefaultPolicy();
    policy.blockIfLocalAiUnavailable = false;

    const review = sanitizer.createReview('Meet Alex Morgan at headquarters.', policy, false);
    expect(review.blocked).toBe('local-ai-unavailable');
    expect(() =>
      review.toCloudPrompt('Meet Alex Morgan at headquarters.', review.sanitized),
    ).toThrow();
  });

  it('rejects stale or modified prompts in toCloudPrompt()', () => {
    const sanitizer = new SessionSanitizer();
    const policy = createDefaultPolicy();
    policy.blockIfLocalAiUnavailable = false;

    const original = 'Contact alex@example.com about billing.';
    const review = sanitizer.createReview(original, policy, false);
    expect(review.blocked).toBeNull();
    expect(review.toCloudPrompt(original, review.sanitized)).toBe(
      'Contact [EMAIL_1] about billing.',
    );
    expect(() => review.toCloudPrompt(`${original} extra`, review.sanitized)).toThrow();
  });

  it('catches natural-language secret phrasing like "my api key is <token>"', () => {
    const sanitizer = new SessionSanitizer();
    const policy = createDefaultPolicy();

    const res = sanitizer.sanitize(
      'this is a test but whatevs\nmy api key is fw4b6j9356b93j45645',
      policy,
    );
    expect(res.findings.length).toBeGreaterThan(0);
    expect(res.sanitized).not.toContain('fw4b6j9356b93j45645');
  });

  it('blocks residual critical secrets when a category is disabled by user', () => {
    const sanitizer = new SessionSanitizer();
    const policy = createDefaultPolicy();
    policy.enabledCategories.API_KEY = false;
    policy.blockIfLocalAiUnavailable = false;

    const review = sanitizer.createReview(
      'Use AKIAIOSFODNN7EXAMPLE with alex@example.com',
      policy,
      false,
    );
    expect(review.blocked).toBe('residual-sensitive-data');
  });
});
