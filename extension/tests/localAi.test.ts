import { describe, expect, it } from 'vitest';
import { LocalContextualScanner, type OnDeviceRunner } from '../src/services/localAi';

describe('LocalContextualScanner (on-device AI)', () => {
  it('returns unavailable cleanly when no runner is present (never falls back to cloud)', async () => {
    const scanner = new LocalContextualScanner(null);
    const res = await scanner.scan('Email Alex Morgan at Acme Corp.');
    expect(res.status).toBe('unavailable');
    expect(res.spans).toEqual([]);
  });

  it('anchors verbatim entities and drops hallucinated entities', async () => {
    const fakeRunner: OnDeviceRunner = {
      engine: 'chrome-language-model',
      checkAvailability: async () => ({ status: 'ready' }),
      prompt: async () =>
        JSON.stringify({
          entities: [
            { text: 'Alex Morgan', type: 'PERSON' },
            { text: 'Acme Corp', type: 'ORGANIZATION' },
            { text: 'Hallucinated Person', type: 'PERSON' },
          ],
        }),
    };

    const scanner = new LocalContextualScanner(fakeRunner);
    const input = 'Send the Q4 draft to Alex Morgan at Acme Corp.';
    const res = await scanner.scan(input);

    expect(res.status).toBe('ready');
    expect(res.spans).toHaveLength(2);
    expect(res.spans[0].original).toBe('Alex Morgan');
    expect(input.slice(res.spans[0].start, res.spans[0].end)).toBe('Alex Morgan');
    expect(res.spans[1].original).toBe('Acme Corp');
  });

  it('fails safe to unavailable when on-device inference throws', async () => {
    const failingRunner: OnDeviceRunner = {
      engine: 'firebase-only-on-device',
      checkAvailability: async () => ({ status: 'ready' }),
      prompt: async () => {
        throw new Error('Model crashed');
      },
    };

    const scanner = new LocalContextualScanner(failingRunner);
    const res = await scanner.scan('Meet Alex Morgan tomorrow.');
    expect(res.status).toBe('unavailable');
    expect(res.spans).toEqual([]);
    expect(res.reason).toContain('Model crashed');
  });
});
