import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChromeLanguageModelRunner,
  LocalContextualScanner,
  runLocalHeuristicNer,
  type OnDeviceRunner,
} from '../src/services/localAi';

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

  it('treats valid empty entities JSON as ready with zero spans', async () => {
    const emptyRunner: OnDeviceRunner = {
      engine: 'chrome-language-model',
      checkAvailability: async () => ({ status: 'ready' }),
      prompt: async () => '{"entities":[]}',
    };

    const scanner = new LocalContextualScanner(emptyRunner);
    const res = await scanner.scan('Summarize HTTP status codes.');
    expect(res.status).toBe('ready');
    expect(res.spans).toEqual([]);
  });

  it('fails safe to unavailable when on-device model returns malformed JSON', async () => {
    const malformedRunner: OnDeviceRunner = {
      engine: 'firebase-only-on-device',
      checkAvailability: async () => ({ status: 'ready' }),
      prompt: async () => 'Sorry, I cannot output JSON right now.',
    };

    const scanner = new LocalContextualScanner(malformedRunner);
    const res = await scanner.scan('Meet Alex Morgan tomorrow.');
    expect(res.status).toBe('unavailable');
    expect(res.spans).toEqual([]);
    expect(res.reason).toContain('Fail-safe block');
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

  it('runs local heuristic NER cleanly on Brave/non-Nano browsers when enabled', async () => {
    const scanner = new LocalContextualScanner(null, {
      enableBrowserHeuristicFallback: true,
    });
    const input = 'Write to Alex Morgan at Acme Corp located at 742 Evergreen Terrace.';
    const res = await scanner.scan(input);

    expect(res.status).toBe('ready');
    expect(res.engine).toBe('local-heuristic');
    const foundTexts = res.spans.map((s) => s.original);
    expect(foundTexts).toContain('Alex Morgan');
    expect(foundTexts).toContain('Acme Corp');
    expect(foundTexts).toContain('742 Evergreen Terrace');
    expect(runLocalHeuristicNer('No entities here.').length).toBe(0);
  });
});

afterEach(() => vi.unstubAllGlobals());

it('keeps Nano requests structured and destroys sessions that cannot be cloned', async () => {
  const prompt = vi.fn().mockRejectedValueOnce(new Error('Nano failed'))
    .mockResolvedValueOnce('{"entities":[{"text":"Alex Morgan","type":"PERSON"}]}');
  const destroy = vi.fn();
  const create = vi.fn().mockImplementation(async () => ({ prompt, destroy }));
  vi.stubGlobal('LanguageModel', { availability: async () => 'available', create });
  const scanner = new LocalContextualScanner(new ChromeLanguageModelRunner());

  expect((await scanner.scan('Write to Alex Morgan.')).status).toBe('unavailable');
  expect(prompt).toHaveBeenCalledTimes(1);
  expect((await scanner.scan('Write to Alex Morgan.')).spans).toHaveLength(1);
  expect(create).toHaveBeenCalledTimes(2);
  expect(destroy).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  }));
  expect(prompt).toHaveBeenLastCalledWith(expect.stringContaining('Alex Morgan'), {
    responseConstraint: expect.objectContaining({ required: ['entities'] }),
  });
});
