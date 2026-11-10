/**
 * The perceptual measures of the contrast contract: CIELAB L* (the surface
 * ladder and the lips) and OKLab distance (colours that must not read as
 * each other), checked against fixed points and the reference table of
 * docs/release-pass/SPEC-design.md 1.6.3.
 */

import { PALETTE_KEYS, PaletteKey, palettes } from './palettes';
import { contrastRatio, lightness, oklabDistance } from './color';

describe('lightness (CIELAB L*)', () => {
  it('is 0 for black, 100 for white and about 53.6 for mid grey', () => {
    expect(lightness('#000000')).toBe(0);
    expect(lightness('#FFFFFF')).toBeCloseTo(100, 6);
    expect(lightness('#fff')).toBeCloseTo(100, 6);
    expect(lightness('#808080')).toBeCloseTo(53.585, 2);
  });

  it('grows with the grey level and stays linear in the deep darks', () => {
    const greys = ['#000000', '#010101', '#0A0A0A', '#1A1A1A', '#404040', '#C0C0C0', '#FFFFFF'];
    const values = greys.map(lightness);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    // Below the CIE threshold L* is linear in luminance, so it never collapses to 0.
    expect(lightness('#010101')).toBeGreaterThan(0.2);
    expect(lightness('#010101')).toBeLessThan(0.3);
  });

  it('rejects a colour it cannot read', () => {
    expect(() => lightness('rgba(0,0,0,0.5)')).toThrow();
    expect(() => lightness('nope')).toThrow();
  });

  // L* of bar / bg / surface / surface2 / line after the ladder lift (1.6.3).
  const TABLE: Record<PaletteKey, [number, number, number, number, number]> = {
    kitaplik: [6.4, 9.2, 15.6, 21.8, 27.9],
    orman: [4.3, 6.6, 14.2, 20.3, 27.5],
    'gece-mavisi': [6.2, 9.2, 15.5, 21.5, 27.8],
    murekkep: [3.9, 5.8, 12.2, 18.3, 24.8],
    erik: [5.1, 7.6, 13.6, 19.7, 26.1],
    orijinal: [5.3, 7.8, 14.2, 20.5, 26.7],
  };

  it.each(PALETTE_KEYS)('%s matches the reference ladder within 0.1', key => {
    const P = palettes[key];
    const measured = (['bar', 'bg', 'surface', 'surface2', 'line'] as const).map(token => lightness(P[token]));
    measured.forEach((value, i) => {
      expect(Math.abs(value - TABLE[key][i])).toBeLessThanOrEqual(0.1);
    });
  });
});

describe('oklabDistance (x100)', () => {
  it('is 0 for the same colour and about 100 from black to white', () => {
    expect(oklabDistance('#F2917B', '#F2917B')).toBe(0);
    expect(oklabDistance('#000000', '#FFFFFF')).toBeCloseTo(100, 3);
  });

  it('is symmetric', () => {
    const pairs: [string, string][] = [
      ['#F58EB5', '#F2917B'],
      ['#FFA66E', '#F2B84B'],
      ['#121A29', '#FFFFFF'],
      ['#0E1C20', '#FF7A52'],
    ];
    for (const [a, b] of pairs) expect(oklabDistance(a, b)).toBeCloseTo(oklabDistance(b, a), 10);
  });

  it('obeys the triangle inequality', () => {
    const [a, b, c] = ['#F58EB5', '#F2917B', '#ABA4DC'];
    expect(oklabDistance(a, c)).toBeLessThanOrEqual(oklabDistance(a, b) + oklabDistance(b, c) + 1e-9);
  });

  it('separates gece-mavisi error from its action colour now, and did not before', () => {
    const P = palettes['gece-mavisi'];
    expect(oklabDistance(P.error, P.action)).toBeCloseTo(8.2, 0);
    // The shipped coral error (#F58A9B) sat 5.1 from the coral action.
    expect(oklabDistance('#F58A9B', P.action)).toBeLessThan(7);
  });

  it('measures hue and chroma, which the WCAG ratio ignores', () => {
    // Two colours of nearly the same luminance: ratio about 1, OKLab clearly apart.
    expect(contrastRatio('#FFA66E', '#F2B84B')).toBeLessThan(1.2);
    expect(oklabDistance('#FFA66E', '#F2B84B')).toBeGreaterThan(6.5);
  });
});
