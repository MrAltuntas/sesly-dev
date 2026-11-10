/**
 * Theme: the palette registry carries the playful mockup tokens for all six
 * palettes, derives the rest like the CSS does, keeps every text pair
 * readable, and the type scale keeps Baloo 2 from clipping.
 */

import React from 'react';
import { Text } from 'react-native';
import { render, renderHook, screen } from '@testing-library/react-native';

import {
  BASE_PALETTES,
  CATEGORY_KEYS,
  DEFAULT_PALETTE,
  PALETTE_KEYS,
  categoryColors,
  categorySlot,
  derivePalette,
  isPaletteKey,
  palettes,
} from './palettes';
import {
  FONTS,
  LIP,
  RADIUS,
  SCREEN_PAD_H,
  SPACE,
  Theme,
  dockBottom,
  getTheme,
  lipFor,
  makeTextStyles,
  textStylesFor,
  themedStyles,
  themes,
  useTextStyles,
} from './theme';
import { ThemeProvider } from './ThemeProvider';
import { contrastRatio, flatten, hexToRgb, mix, withAlpha } from './color';

describe('palette registry', () => {
  it('ships the six playful palettes, gece-mavisi by default', () => {
    expect(PALETTE_KEYS).toEqual(['kitaplik', 'orman', 'gece-mavisi', 'murekkep', 'erik', 'orijinal']);
    expect(DEFAULT_PALETTE).toBe('gece-mavisi');
    expect(Object.keys(palettes).sort()).toEqual([...PALETTE_KEYS].sort());
    expect(isPaletteKey('erik')).toBe(true);
    expect(isPaletteKey('acik')).toBe(false);
    expect(isPaletteKey('gece')).toBe(false);
    expect(isPaletteKey(null)).toBe(false);
  });

  it('gece-mavisi tokens (mockup values, ladder lifted)', () => {
    expect(palettes['gece-mavisi']).toMatchObject({
      name: 'gece-mavisi',
      bg: '#121A29',
      bar: '#0D1420',
      surface: '#1D2738',
      surface2: '#283449',
      line: '#35425A',
      lip: '#080C16',
      text: '#EDF0F6',
      text2: '#B5BED0',
      text3: '#939EB4',
      action: '#F2917B',
      actionLip: '#B85C46',
      onAction: '#2A110B',
      catUyku: '#ABA4DC',
      catUykuLip: '#786FA9',
      catTurk: '#DDBB7E',
      catDunya: '#88B6D6',
      catEgitici: '#96C4A6',
      onCat: '#0F1624',
      own: '#ABA4DC',
      ownLip: '#786FA9',
      success: '#96C4A6',
      warning: '#DDBB7E',
      rec: '#F2917B',
      coverRing: '#34425E',
    });
  });

  // SPEC-design 1.6.3: the ladder, lips, text3 and status colours as decided
  // in the release pass (surfaces lifted to a 6 L* ladder, chip lips under
  // the canvas, error and warning off the action colour), pinned so a change
  // is a deliberate one. contrastRules.test.ts checks the rules behind them.
  it.each([
    ['kitaplik', '#0A1619', '#0E1C20', '#152A2F', '#1F383E', '#2A464D', '#0B181A', '#050E10', '#8CA39F', '#FF8F8F', '#F2B866'],
    ['orman', '#08110B', '#0C1710', '#16281C', '#1F3626', '#2C4733', '#09110B', '#040A05', '#8FA089', '#F48C80', '#FFA66E'],
    ['gece-mavisi', '#0D1420', '#121A29', '#1D2738', '#283449', '#35425A', '#101522', '#080C16', '#939EB4', '#F58EB5', '#DDBB7E'],
    ['murekkep', '#0D0E0F', '#121314', '#1F2022', '#2B2D2F', '#393B3E', '#0C0D0E', '#060707', '#959691', '#F2958C', '#EBC3A3'],
    ['erik', '#160E1A', '#1D1322', '#2B1E31', '#392A41', '#493753', '#180F1C', '#0E0711', '#A9939F', '#FF8F8F', '#F1C163'],
    ['orijinal', '#100C30', '#15113A', '#211B55', '#2D2670', '#3A3386', '#110D31', '#0A0723', '#9D96D6', '#FF8FA3', '#FFBB5D'],
  ] as const)(
    '%s carries the release-pass ladder, lips and status colours',
    (key, bar, bg, surface, surface2, line, lineLip, lip, text3, error, warning) => {
      expect(palettes[key]).toMatchObject({ bar, bg, surface, surface2, line, lineLip, lip, text3, error, warning });
    },
  );

  it('the glass chip is the canvas at 70 %, opaque enough without a backdrop blur', () => {
    for (const key of PALETTE_KEYS) {
      expect(palettes[key].glass).toBe(withAlpha(palettes[key].bg, 0.7));
    }
  });

  it.each([
    ['kitaplik', '#0E1C20', '#FF7A52', '#8FD9C4', '#24414A'],
    ['orman', '#0C1710', '#F2B84B', '#C7A2DE', '#25402D'],
    ['murekkep', '#121314', '#7ACFBE', '#C3B9E6', '#2C2E31'],
    ['erik', '#1D1322', '#FFB08A', '#9EC4EA', '#3B2A44'],
    ['orijinal', '#15113A', '#FFD23F', '#C3A6FF', 'transparent'],
  ] as const)('%s carries its canvas, action, own voice and cover ring', (key, bg, action, own, ring) => {
    expect(palettes[key]).toMatchObject({ bg, action, own, coverRing: ring });
  });

  it('every palette defines every token with a colour value', () => {
    const keys = Object.keys(palettes['gece-mavisi']).filter(k => k !== 'name' && k !== 'cat');
    for (const key of PALETTE_KEYS) {
      const palette = palettes[key] as unknown as Record<string, unknown>;
      expect(Object.keys(palette).sort()).toEqual(Object.keys(palettes['gece-mavisi']).sort());
      for (const token of keys) {
        expect({ key, token, value: palette[token] }).toEqual({
          key,
          token,
          value: expect.stringMatching(/^(#[0-9A-F]{6}|rgba\([\d,.]+\)|transparent)$/),
        });
      }
    }
  });

  it('derives the own-voice gradient and chip tints like color-mix()', () => {
    const base = BASE_PALETTES.kitaplik;
    const derived = derivePalette('kitaplik', base);
    expect(derived.ownA).toBe(mix(base.own, 0.16, base.surface2));
    expect(derived.ownC).toBe(mix(base.own, 0.05, base.surface));
    expect(derived.chipOkBg).toBe(withAlpha(base.success, 0.12));
    expect(derived.chipActFg).toBe(mix(base.action, 0.45, base.text));
    expect(derived.onRec).toBe(base.onAction);
  });

  it('orijinal keeps the values its CSS class states', () => {
    expect(palettes.orijinal).toMatchObject({
      ownA: '#3A2F8E',
      ownB: '#2A2272',
      ownC: '#241D62',
      chipOkFg: '#72E3A6',
      chipActFg: '#FFD23F',
      onRec: '#1B1442',
    });
  });

  it('category tiles are filled in every palette but murekkep, where they are neutral with a coloured icon', () => {
    for (const key of PALETTE_KEYS) {
      const P = palettes[key];
      for (const slot of CATEGORY_KEYS) {
        const cat = P.cat[slot];
        if (key === 'murekkep') {
          expect(cat).toMatchObject({ tileBg: P.surface, tileFg: P.text, tileLip: P.lip, tileIcon: cat.color });
        } else {
          expect(cat).toMatchObject({ tileBg: cat.color, tileFg: P.onCat, tileLip: cat.lip, tileIcon: P.onCat });
        }
      }
    }
  });

  it('maps story categories to colour slots', () => {
    expect(categorySlot('BEDTIME')).toBe('uyku');
    expect(categorySlot('TURKISH_CLASSICS')).toBe('turk');
    expect(categorySlot('WORLD_CLASSICS')).toBe('dunya');
    expect(categorySlot('EDUCATIONAL')).toBe('egitici');
    expect(categorySlot('SOMETHING_NEW')).toBeNull();
    expect(categorySlot(null)).toBeNull();
    const P = palettes.erik;
    expect(categoryColors(P, 'WORLD_CLASSICS').color).toBe('#F09DB2');
    expect(categoryColors(P, undefined)).toMatchObject({ color: P.text3, tileBg: P.surface });
  });
});

// WCAG 2.x: 4.5:1 for text, 3:1 for icons and large text.
describe.each(PALETTE_KEYS)('contrast in %s', key => {
  const P = palettes[key];

  it('text on action, the one action colour, is at least 4.5:1', () => {
    expect(contrastRatio(P.onAction, P.action)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(P.onRec, P.rec)).toBeGreaterThanOrEqual(4.5);
  });

  it('the three text levels are readable on the canvas and on cards', () => {
    for (const fg of [P.text, P.text2, P.text3]) {
      expect(contrastRatio(fg, P.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(fg, P.surface)).toBeGreaterThanOrEqual(4.5);
    }
    // Every level also on surface-2 (a selected card, the mini player), so
    // a component never works in one palette only.
    expect(contrastRatio(P.text, P.surface2)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(P.text2, P.surface2)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(P.text3, P.surface2)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(P.text3, P.bar)).toBeGreaterThanOrEqual(4.5);
    // The action colour as text (a playing row's title) on cards.
    expect(contrastRatio(P.action, P.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(P.action, P.surface2)).toBeGreaterThanOrEqual(4.5);
    // Status colours as text on cards.
    for (const fg of [P.error, P.warning, P.success, P.own]) {
      expect(contrastRatio(fg, P.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(fg, P.surface2)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dark text on every category fill and on the own-voice colour', () => {
    for (const slot of CATEGORY_KEYS) {
      expect(contrastRatio(P.onCat, P.cat[slot].color)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(P.cat[slot].tileFg, P.cat[slot].tileBg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(P.onCat, P.own)).toBeGreaterThanOrEqual(4.5);
  });

  it('the status chips pass on the own-voice card', () => {
    const card = P.ownA;
    expect(contrastRatio(P.chipOkFg, flatten(P.chipOkBg, card))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(P.chipActFg, flatten(P.chipActBg, card))).toBeGreaterThanOrEqual(4.5);
  });

  it('error, success and warning read as text on the canvas and on cards', () => {
    for (const fg of [P.error, P.success, P.warning]) {
      expect(contrastRatio(fg, P.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(fg, P.surface)).toBeGreaterThanOrEqual(4.5);
    }
    // That error and warning never read as the action colour is part of the
    // contrast contract (contrastRules.test.ts, OKLab distance).
  });

  it('the action colour stands out as an icon on the canvas (3:1)', () => {
    expect(contrastRatio(P.action, P.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(P.action, P.bar)).toBeGreaterThanOrEqual(3);
  });

  it('the level badge is readable', () => {
    expect(contrastRatio(P.onBadge, P.badge)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('colour helpers', () => {
  it('parse, mix, tint and measure', () => {
    expect(hexToRgb('#F2917B')).toEqual({ r: 242, g: 145, b: 123 });
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(() => hexToRgb('nope')).toThrow();
    expect(mix('#FFFFFF', 0.5, '#000000')).toBe('#808080');
    expect(withAlpha('#FF0000', 0.12)).toBe('rgba(255,0,0,0.12)');
    expect(flatten('rgba(255,255,255,0.5)', '#000000')).toBe('#808080');
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
    // The README's published ratios for the default palette.
    expect(contrastRatio(palettes['gece-mavisi'].onAction, palettes['gece-mavisi'].action)).toBeCloseTo(7.7, 0);
    expect(contrastRatio(palettes['gece-mavisi'].text, palettes['gece-mavisi'].bg)).toBeCloseTo(15.3, 0);
  });
});

describe('themes', () => {
  it('a theme is the shared tokens plus one palette', () => {
    expect(getTheme('orman').bg).toBe('#0C1710');
    expect(themes.orman.fontDisplay).toBe(FONTS.display);
    expect(themes.orman.lipSize.md).toBe(3);
    expect(themes.erik.screenPadH).toBe(16);
  });

  it('every theme reads the shared constants', () => {
    for (const key of PALETTE_KEYS) {
      const T = themes[key];
      expect(T.space).toBe(SPACE);
      expect(T.r).toBe(RADIUS);
      expect(T.screenPadH).toBe(SCREEN_PAD_H);
      // Three lips only: the old 5dp `xl` is gone.
      expect(T.lipSize).toEqual({ sm: LIP.sm, md: LIP.md, lg: LIP.lg });
    }
  });
});

describe('shared tokens', () => {
  it('one spacing scale, on the 2 4 6 8 12 16 20 24 32 grid', () => {
    expect(SPACE).toEqual({ xxs: 2, xs: 4, tight: 6, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 });
    const steps = Object.values(SPACE);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    expect(SCREEN_PAD_H).toBe(SPACE.lg);
  });

  it('one radius set', () => {
    expect(RADIUS).toEqual({ xs: 6, sm: 12, md: 16, lg: 20, xl: 24, xxl: 28, sheet: 32, pill: 999 });
  });

  it('three lips, none of 5', () => {
    expect(LIP).toEqual({ sm: 2, md: 3, lg: 4 });
    expect(Object.values(LIP)).not.toContain(5);
  });

  it.each([
    [36, 2],
    [44, 2],
    [48, 2],
    [49, 3],
    [52, 3],
    [56, 3],
    [71, 3],
    [72, 4],
    [80, 4],
    [0, 2],
  ])('lipFor(%i) is %i', (height, lip) => {
    expect(lipFor(height)).toBe(lip);
  });

  it.each([
    [0, 20],
    [12, 20],
    [24, 32],
    [48, 56],
  ])('dockBottom(%i) is %i', (inset, padding) => {
    expect(dockBottom(inset)).toBe(padding);
  });
});

describe('cached styles', () => {
  it('themedStyles builds once per theme and returns the same object for it', () => {
    const factory = jest.fn((T: Theme) => ({ face: { backgroundColor: T.surface } }));
    const stylesFor = themedStyles(factory);
    const erik = Array.from({ length: 20 }, () => stylesFor(themes.erik));
    const orman = stylesFor(themes.orman);
    expect(factory).toHaveBeenCalledTimes(2);
    for (const styles of erik) expect(styles).toBe(erik[0]);
    expect(orman).not.toBe(erik[0]);
    expect(orman.face.backgroundColor).toBe(themes.orman.surface);
    expect(erik[0].face.backgroundColor).toBe(themes.erik.surface);
    // A switch back is a cache hit.
    expect(stylesFor(themes.erik)).toBe(erik[0]);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('keys by the theme object, so a hand-built theme never collides with a real one', () => {
    const factory = jest.fn((T: Theme) => ({ color: T.text }));
    const stylesFor = themedStyles(factory);
    const custom: Theme = { ...themes.erik, text: '#123456' };
    expect(stylesFor(custom).color).toBe('#123456');
    expect(stylesFor(themes.erik).color).toBe(themes.erik.text);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('each factory has its own cache', () => {
    const a = themedStyles(() => ({ a: 1 }));
    const b = themedStyles(() => ({ b: 2 }));
    expect(a(themes.erik)).toEqual({ a: 1 });
    expect(b(themes.erik)).toEqual({ b: 2 });
  });

  it('textStylesFor is stable per palette and equals makeTextStyles', () => {
    expect(textStylesFor(themes.erik)).toBe(textStylesFor(themes.erik));
    expect(textStylesFor(themes.erik)).not.toBe(textStylesFor(themes.orman));
    expect(textStylesFor(themes.erik)).toEqual(makeTextStyles(themes.erik));
  });
});

describe('type scale', () => {
  it('uses Baloo 2 for display and Nunito for the rest', () => {
    const styles = makeTextStyles(themes['gece-mavisi']);
    for (const key of ['displayL', 'displayM', 'heading', 'subheading', 'tile'] as const) {
      expect(styles[key].fontFamily).toBe('Baloo2-SemiBold');
    }
    expect(styles.body.fontFamily).toBe('Nunito-Bold');
    expect(styles.label.fontFamily).toBe('Nunito-ExtraBold');
    expect(styles.displayL.fontSize).toBe(32);
    expect(styles.heading.fontSize).toBe(21);
    expect(styles.body.fontSize).toBe(15.5);
  });

  it('every line height is at least 1.3 times the font size (Android clips Baloo 2 below that)', () => {
    for (const key of PALETTE_KEYS) {
      const styles = makeTextStyles(themes[key]);
      for (const style of Object.values(styles)) {
        expect(style.lineHeight! / style.fontSize!).toBeGreaterThanOrEqual(1.3);
      }
    }
  });

  it('useTextStyles colours follow the palette', () => {
    function TypeProbe() {
      const styles = useTextStyles();
      return <Text testID="type">{`${String(styles.displayL.color)}|${String(styles.body.color)}`}</Text>;
    }
    render(
      <ThemeProvider initialPalette="erik">
        <TypeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('type')).toHaveTextContent('#F7EEF3|#D0BECA');
  });

  it('useTextStyles keeps its identity across re-renders and between components', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider initialPalette="orman">{children}</ThemeProvider>
    );
    const first = renderHook(() => useTextStyles(), { wrapper });
    const initial = first.result.current;
    first.rerender({});
    expect(first.result.current).toBe(initial);
    const second = renderHook(() => useTextStyles(), { wrapper });
    expect(second.result.current).toBe(initial);
    expect(initial).toBe(textStylesFor(themes.orman));
  });
});
