import { CARTESIA_UNIT_MAX_CHARS, GOOGLE_UNIT_MAX_BYTES, planSynthesisUnits } from './synthesis-plan';

describe('planSynthesisUnits', () => {
  const segments = [
    { text: 'Bir.', emotion: 'calm', speed: 0.8 },
    { text: 'Iki.', emotion: 'calm', pauseAfterMs: 600 },
    { text: 'Uc.', emotion: 'scared', speed: 0.95 },
    { text: 'Dort.', emotion: 'scared', volume: 1.2 },
  ];

  it('grouping off: one request per segment, tags resolved against the defaults', () => {
    const units = planSynthesisUnits(segments, {
      provider: 'cartesia',
      grouping: false,
      defaults: { emotion: 'neutral', speed: 0.85, volume: null },
    });
    expect(units).toEqual([
      { text: 'Bir.', parts: [{ text: 'Bir.', speed: 0.8 }], emotion: 'calm', speed: 0.8, volume: undefined },
      { text: 'Iki.', parts: [{ text: 'Iki.', pauseAfterMs: 600 }], emotion: 'calm', speed: 0.85, volume: undefined },
      { text: 'Uc.', parts: [{ text: 'Uc.', speed: 0.95 }], emotion: 'scared', speed: 0.95, volume: undefined },
      { text: 'Dort.', parts: [{ text: 'Dort.' }], emotion: 'scared', speed: 0.85, volume: 1.2 },
    ]);
  });

  it('Cartesia: consecutive segments with the same emotion and volume share a request; every part carries its speed', () => {
    const units = planSynthesisUnits(segments, {
      provider: 'cartesia',
      grouping: true,
      defaults: { speed: 0.85 },
    });
    expect(units).toEqual([
      {
        text: 'Bir. Iki.',
        parts: [
          { text: 'Bir.', speed: 0.8 },
          { text: 'Iki.', speed: 0.85, pauseAfterMs: 600 },
        ],
        emotion: 'calm',
        speed: 0.8,
        volume: undefined,
      },
      { text: 'Uc.', parts: [{ text: 'Uc.', speed: 0.95 }], emotion: 'scared', speed: 0.95, volume: undefined },
      // Same emotion, other volume: a request of its own.
      { text: 'Dort.', parts: [{ text: 'Dort.', speed: 0.85 }], emotion: 'scared', speed: 0.85, volume: 1.2 },
    ]);
  });

  it('Cartesia: without any speed the parts stay without one', () => {
    const units = planSynthesisUnits([{ text: 'a' }, { text: 'b' }], { provider: 'cartesia', grouping: true });
    expect(units).toEqual([{ text: 'a b', parts: [{ text: 'a' }, { text: 'b' }], emotion: undefined, speed: undefined, volume: undefined }]);
  });

  it('Cartesia: a request never exceeds the character cap', () => {
    const long = Array.from({ length: 10 }, () => ({ text: 'x'.repeat(400), emotion: 'calm' }));
    const units = planSynthesisUnits(long, { provider: 'cartesia', grouping: true });
    expect(units.map((u) => u.parts.length)).toEqual([3, 3, 3, 1]);
    units.forEach((u) => expect(u.parts.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(CARTESIA_UNIT_MAX_CHARS));
  });

  it('Google: emotions do not split requests; only the byte cap does; no request-level tags', () => {
    const units = planSynthesisUnits(segments, { provider: 'google', grouping: true, defaults: { emotion: 'calm' } });
    expect(units).toEqual([
      {
        text: 'Bir. Iki. Uc. Dort.',
        parts: [
          { text: 'Bir.', speed: 0.8 },
          { text: 'Iki.', pauseAfterMs: 600 },
          { text: 'Uc.', speed: 0.95 },
          { text: 'Dort.' },
        ],
      },
    ]);

    const big = Array.from({ length: 6 }, () => ({ text: 'ş'.repeat(1000) }));
    const bigUnits = planSynthesisUnits(big, { provider: 'google', grouping: true });
    expect(bigUnits.length).toBe(3);
    bigUnits.forEach((u) => expect(Buffer.byteLength(u.text, 'utf8')).toBeLessThanOrEqual(GOOGLE_UNIT_MAX_BYTES));
  });

  it('no segments: no requests', () => {
    expect(planSynthesisUnits([], { provider: 'google', grouping: true })).toEqual([]);
    expect(planSynthesisUnits([], { provider: 'cartesia', grouping: true })).toEqual([]);
  });
});
