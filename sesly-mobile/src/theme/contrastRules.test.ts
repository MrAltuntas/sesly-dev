/**
 * Contrast contract of the six palettes (docs/release-pass/SPEC-design.md 1.6).
 * theme.test.tsx checks text levels; this file checks what the components draw on top of
 * each other, so no palette can make a button, a field, a lip, a thumb or a badge vanish.
 */
import { CATEGORY_KEYS, PALETTE_KEYS, palettes } from './palettes';
import { contrastRatio, flatten, lightness as L, mix, oklabDistance, withAlpha } from './color';
import {
  SurfaceLevel, WAVE_IDLE_ALPHA, disabledFace, ghostFace, glassRing, insetFace, raisedFace,
} from './surfaces';
import { buttonColors } from '../components/design/buttonColors';
import { themes } from './theme';

const STEP = 6;
const LEVELS: SurfaceLevel[] = ['bg', 'surface', 'surface2'];
const ratio = contrastRatio;

describe.each(PALETTE_KEYS)('contrast contract: %s', key => {
  const P = palettes[key];

  it('the neutral ladder has a visible step between every level', () => {
    expect(L(P.bg) - L(P.bar)).toBeGreaterThan(1);
    expect(L(P.barLine) - L(P.bar)).toBeGreaterThanOrEqual(STEP);
    expect(L(P.surface) - L(P.bg)).toBeGreaterThanOrEqual(STEP);
    expect(L(P.surface2) - L(P.surface)).toBeGreaterThanOrEqual(STEP);
    expect(L(P.line) - L(P.surface2)).toBeGreaterThanOrEqual(STEP);
  });

  it.each(LEVELS)('neutral faces stand off a %s container', level => {
    const parent = P[level];
    expect(Math.abs(L(raisedFace(P, level)) - L(parent))).toBeGreaterThanOrEqual(STEP);
    expect(Math.abs(L(insetFace(P, level)) - L(parent))).toBeGreaterThanOrEqual(STEP);
    expect(Math.abs(L(disabledFace(P, level)) - L(parent))).toBeGreaterThanOrEqual(STEP);
    expect(ratio(P.text, raisedFace(P, level))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.text3, disabledFace(P, level))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.text2, insetFace(P, level))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.text3, insetFace(P, level))).toBeGreaterThanOrEqual(4.5);
    for (const ringColor of [P.text2, P.error]) {
      expect(ratio(ringColor, insetFace(P, level))).toBeGreaterThanOrEqual(3);
      expect(ratio(ringColor, parent)).toBeGreaterThanOrEqual(3);
    }
    // The component mapping really uses the ladder.
    const T = themes[key];
    expect(buttonColors(T, 'secondary', 'default', level).background).toBe(raisedFace(P, level));
    expect(buttonColors(T, 'primary', 'default', level, { disabled: true }).background).toBe(disabledFace(P, level));
  });

  it('every text level reads on every neutral level', () => {
    for (const fg of [P.text, P.text2, P.text3]) {
      for (const bg of [P.bg, P.bar, P.surface, P.surface2]) expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(P.text, P.line)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.text2, P.line)).toBeGreaterThanOrEqual(4.5);
  });

  it('filled controls stand out on every container (WCAG 1.4.11)', () => {
    for (const parent of [P.bg, P.bar, P.surface, P.surface2, P.line]) {
      expect(ratio(P.action, parent)).toBeGreaterThanOrEqual(3);
    }
    expect(ratio(P.error, P.surface)).toBeGreaterThanOrEqual(3);
    expect(ratio(P.error, P.surface2)).toBeGreaterThanOrEqual(3);
    expect(ratio(P.rec, P.bg)).toBeGreaterThanOrEqual(3);
    expect(ratio(P.onAction, P.action)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.onAction, P.error)).toBeGreaterThanOrEqual(4.5);
    for (const slot of CATEGORY_KEYS) {
      const tile = P.cat[slot];
      if (tile.tileBg === P.surface) continue;
      expect(ratio(tile.tileBg, P.bg)).toBeGreaterThanOrEqual(3);
      expect(ratio(tile.tileFg, tile.tileBg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('state marks are visible: switch thumbs, checkbox, waveform', () => {
    expect(ratio(P.text3, P.line)).toBeGreaterThanOrEqual(3);
    expect(ratio(P.onAction, P.action)).toBeGreaterThanOrEqual(3);
    for (const parent of [P.bg, P.surface, P.surface2]) expect(ratio(P.text3, parent)).toBeGreaterThanOrEqual(3);
    const wave = flatten(withAlpha(P.text, WAVE_IDLE_ALPHA), P.surface);
    expect(ratio(wave, P.surface)).toBeGreaterThanOrEqual(3);
  });

  it('glass, ghost and tinted faces are opaque and keep their labels', () => {
    const ring = glassRing(P);
    expect(ring).toMatch(/^#[0-9A-F]{6}$/);
    expect(ratio(ring, P.bg)).toBeGreaterThanOrEqual(2.5);
    const ghost = ghostFace(P, P.ownB);
    expect(ghost).toMatch(/^#[0-9A-F]{6}$/);
    expect(ratio(P.text, ghost)).toBeGreaterThanOrEqual(4.5);
    const requested = mix(P.success, key === 'orijinal' ? 0.18 : 0.12, P.surface2);
    expect(ratio(P.chipOkFg, requested)).toBeGreaterThanOrEqual(4.5);
    // The failed tag of an own-voice slot, on the slot's surface face.
    expect(ratio(P.error, flatten(withAlpha(P.error, 0.16), P.surface))).toBeGreaterThanOrEqual(4.5);
    // The mic glyph of an own-voice slot on its neutral tile.
    expect(ratio(P.own, P.surface2)).toBeGreaterThanOrEqual(3);
    expect(ratio(P.warning, flatten(withAlpha(P.warning, 0.14), P.surface))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.text2, flatten(withAlpha(P.text, 0.08), P.surface))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.chipActFg, flatten(P.chipActBg, P.bg))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.chipOkFg, flatten(P.chipOkBg, P.ownA))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.text, flatten(P.glass, '#FFFFFF'))).toBeGreaterThanOrEqual(4.5);
  });

  it('lips read as shadow and never as a lighter band', () => {
    const coloured: [string, string][] = [
      [P.action, P.actionLip], [P.own, P.ownLip], [P.line, P.lineLip],
      ...CATEGORY_KEYS.map(slot => [P.cat[slot].color, P.cat[slot].lip] as [string, string]),
    ];
    for (const [face, lip] of coloured) expect(L(face) - L(lip)).toBeGreaterThanOrEqual(15);
    expect(L(P.surface) - L(P.lip)).toBeGreaterThanOrEqual(8);
    expect(L(P.bg) - L(P.lip)).toBeGreaterThanOrEqual(3.5);
    expect(L(P.bg) - L(P.lineLip)).toBeGreaterThanOrEqual(1.9);
    expect(L(P.surface) - L(P.lineLip)).toBeGreaterThanOrEqual(6);
    const dangerLip = buttonColors(themes[key], 'primary', 'danger').lip;
    expect(L(P.error) - L(dangerLip)).toBeGreaterThanOrEqual(15);
  });

  it('error and warning never read as the action colour', () => {
    expect(oklabDistance(P.error, P.action)).toBeGreaterThanOrEqual(7);
    expect(oklabDistance(P.warning, P.action)).toBeGreaterThanOrEqual(6.5);
    expect(oklabDistance(P.warning, P.error)).toBeGreaterThanOrEqual(6.5);
  });

  it('a sheet stands off the scrim behind it', () => {
    expect(L(P.surface) - L(flatten(P.scrim, P.bg))).toBeGreaterThanOrEqual(STEP);
  });
});
