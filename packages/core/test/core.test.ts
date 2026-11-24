import { describe, expect, it, vi } from 'vitest';
import { createReview, createSanitizationSession, MAX_PROMPT_LENGTH, restore, sanitize } from '../src/index.js';
import type { LocalFinding } from '../src/index.js';

describe('detectors', () => {
  it.each([
    ['Élodie@example.com', 'EMAIL'],
    ['+1 (415) 555-0132', 'PHONE'],
    ['+40 721 123 456', 'PHONE'],
    ['10.3.4.5', 'IP_ADDRESS'],
    ['2001:db8::1', 'IP_ADDRESS'],
    ['fe80::1%eth0', 'IP_ADDRESS'],
    ['::ffff:192.0.2.1', 'IP_ADDRESS'],
    ['2001:db8:1:2:3:4:5:6', 'IP_ADDRESS'],
    ['AKIAEXAMPLE123456789', 'API_KEY'],
    ['ghp_abcdefghijklmnopqrstuvwx', 'AUTH_TOKEN'],
    ['AIzaabcdefghijklmnopqrstuvwx', 'API_KEY'],
    ['sk-proj-abcdefghijklmnopqrstuvwx', 'API_KEY'],
    ['eyJabcdefgh.abc12345.signature', 'AUTH_TOKEN'],
    ['aZ9v3YT7w8Yxl24XePu1MrQm', 'AUTH_TOKEN'],
    ['https://demo:example@example.test/item', 'CONNECTION_STRING'],
    ['https://portal.internal/profile', 'INTERNAL_URL'],
    ['C:\\Users\\Alex Morgan\\private.txt', 'FILE_PATH'],
    ['/home/alex/private.txt', 'FILE_PATH'],
    ['4111 1111 1111 1111', 'CREDIT_CARD'],
    ['123-45-6789', 'SSN'],
    ['APP_SECRET="synthetic phrase"', 'ENV'],
    ['-----BEGIN PRIVATE KEY-----\nexample\n-----END PRIVATE KEY-----', 'PRIVATE_KEY'],
  ])('redacts %s as %s', (raw, type) => {
    const { sanitized, findings } = sanitize('Review ' + raw + '.');
    expect(sanitized).not.toContain(raw);
    expect(findings[0]?.type).toBe(type);
    expect(findings[0]?.original).toContain(raw);
  });

  it.each(['999.1.2.3', '12:34:56', '2001::db8::1', '4111 1111 1111 1112',
    'https://example.test', 'a'.repeat(8_000), ':'.repeat(7_999) + 'z'])(
    'leaves non-matches unchanged', text => {
      expect(sanitize(text).sanitized).toBe(text);
    },
  );

  it('rejects blank and oversized requests', () => {
    expect(() => sanitize(' \n ')).toThrow(RangeError);
    expect(() => sanitize('a'.repeat(MAX_PROMPT_LENGTH + 1))).toThrow(RangeError);
  });
});

describe('review and restoration', () => {
  it('reserves literal and slightly mangled tokens, and reuses identical mapping values', () => {
    const source = '[ email-1 ] alex@example.com and alex@example.com at 10.0.0.1';
    const { sanitized, mappings } = sanitize(source);
    expect(sanitized).toBe('[ email-1 ] [EMAIL_2] and [EMAIL_2] at [IP_ADDRESS_1]');
    expect(restore('[ email-1 ] [ email - 2 ][email_2] [IP_ADDRESS_1] [EMAIL_9]', mappings))
      .toBe('[ email-1 ] alex@example.comalex@example.com 10.0.0.1 [EMAIL_9]');
  });

  it('joins overlapping spans without restoring a restricted suffix', () => {
    const source = 'Alex password=synthetic';
    const finding: LocalFinding = {
      type: 'PERSON', start: 0, end: 10, original: source.slice(0, 10), confidence: 0.9,
    };
    const review = createReview(source, { localAi: { status: 'ready', findings: [finding] } });
    expect(review.sanitized).toBe('[PERSON_1]');
    expect(restore('[PERSON_1]', review.mappings)).toBe('[PERSON_1]');
    const optedIn = sanitize('APP_SECRET=synthetic', { restorableCategories: { ENV: true } });
    expect(restore(optedIn.sanitized, optedIn.mappings)).toBe('APP_SECRET=synthetic');
  });

  it('filters disabled categories and rejects ungrounded AI input', () => {
    expect(sanitize('alex@example.com', { enabledCategories: { EMAIL: false } }).findings).toEqual([]);
    expect(() => sanitize('Alex', { localAi: { status: 'ready', findings: [
      { type: 'PERSON', start: 0, end: 4, original: 'Evan', confidence: 0.8 },
    ] } })).toThrow('Invalid local AI finding');
  });

  it('reuses placeholders across reviews until a session is cleared', () => {
    const session = createSanitizationSession();
    expect(session.sanitize('alex@example.com').sanitized).toBe('[EMAIL_1]');
    expect(session.sanitize('lee@example.com alex@example.com').sanitized)
      .toBe('[EMAIL_2] [EMAIL_1]');
    expect(() => session.sanitize('[ email-1 ] alex@example.com')).toThrow(/literally/i);
    session.clear();
    expect(session.sanitize('lee@example.com').sanitized).toBe('[EMAIL_1]');
  });

  it('blocks known high-risk data even when its display category is disabled', () => {
    const text = 'Ask alex@example.com about password: synthetic';
    const review = createReview(text, {
      enabledCategories: { PASSWORD: false }, blockIfLocalAiUnavailable: false,
    });
    expect(review.sanitized).toBe('Ask [EMAIL_1] about password: synthetic');
    expect(() => review.toCloudPrompt(text, review.sanitized)).toThrow('residual-sensitive-data');
  });

  it('blocks missing local AI by default and blocks locally-only reviews', () => {
    const text = 'alex@example.com';
    const missing = createReview(text);
    const local = createReview(text, { localOnlyMode: true, localAi: { status: 'ready', findings: [] } });
    expect(() => missing.toCloudPrompt(text, missing.sanitized)).toThrow('local-ai-unavailable');
    expect(() => local.toCloudPrompt(text, local.sanitized)).toThrow('local-only');
  });

  it('passes only the approved redacted string to a mock cloud, then restores it locally', () => {
    const original = 'Send a note to alex@example.com';
    const policy = { blockIfLocalAiUnavailable: false };
    const reviewed = createReview(original, policy);
    const cloud = vi.fn((_prompt: string) => 'Hi [EMAIL_1]');
    expect(() => cloud(reviewed.toCloudPrompt(original + '!', reviewed.sanitized))).toThrow(/review/i);
    expect(() => cloud(reviewed.toCloudPrompt(original, original))).toThrow(/review/i);
    const unresolved = createReview('Ask Alex', policy);
    expect(() => cloud(unresolved.toCloudPrompt('Ask Alex', unresolved.sanitized)))
      .toThrow('local-ai-unavailable');
    expect(cloud).not.toHaveBeenCalled();
    const response = cloud(reviewed.toCloudPrompt(original, reviewed.sanitized));
    expect(cloud).toHaveBeenCalledExactlyOnceWith('Send a note to [EMAIL_1]');
    expect(restore(response, reviewed.mappings)).toBe('Hi alex@example.com');
  });
});
