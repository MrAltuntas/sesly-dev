/**
 * Sesly theme (design v4 "playful", dark only).
 *
 * Six palettes live in `./palettes.ts` (the registry); the active one is
 * held by `ThemeProvider` (default `gece-mavisi`, picked by the user on the
 * Profile screen, "Renk paleti"). Every palette is dark.
 *
 * THE way to read colours in a component:
 *
 *   import { themedStyles, useT, Theme } from '../theme/theme';
 *
 *   const makeStyles = (T: Theme) => StyleSheet.create({ ... });
 *   const stylesFor = themedStyles(makeStyles);       // one sheet per palette, cached
 *
 *   const T = useT();                                  // re-renders on a palette switch
 *   const styles = stylesFor(T);                       // same object on every render
 *
 * Do not build a module-level StyleSheet from a palette: it freezes one
 * palette. There is no static palette export on purpose. Colours that depend
 * on where a control sits (`useSurfaceLevel()`, src/theme/surfaces.ts) are
 * computed per render, never cached in a sheet.
 *
 * Module-scope code that has no `T` reads the plain constants below
 * (`SPACE`, `RADIUS`, `LIP`, `SCREEN_PAD_H`, `lipFor`, `dockBottom`);
 * motion tokens live in `./motion`.
 *
 * Colour rules (README): `action` means "do it" (primary buttons, play,
 * progress, active tab, selected filter); category colours only mean "what
 * kind of story"; fills carry dark text (`onAction`, `onCat`), never white.
 * Everything tappable sits on a darker lip (`components/design/Tactile`).
 */

import { TextStyle } from 'react-native';
import { usePaletteState } from './ThemeProvider';
import {
  ColorPalette,
  PALETTE_KEYS,
  PaletteKey,
  palettes,
} from './palettes';

// ─────────────────────────────────────────────────────────────
// Shared (non-colour) tokens: fonts, radii, spacing, lips.
// Identical for every palette (docs/release-pass/SPEC-design.md 1.1 to 1.3).
// ─────────────────────────────────────────────────────────────

/**
 * The one spacing scale (dp). xxs optical nudges, xs icon to text in badges,
 * tight gaps inside chips, sm between sibling controls, md row-card padding,
 * lg page gutter and card padding, xl block to block, xxl before a new major
 * section, xxxl centred empty, error and loading blocks.
 */
export const SPACE = { xxs: 2, xs: 4, tight: 6, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

/** Side padding of every screen, sheet, dialog root and floating chrome (dp). */
export const SCREEN_PAD_H = 16;

/**
 * Bottom padding of a dock, a sheet or a form end: the system inset, at
 * least 12, plus 8 (0 gives 20, a 24dp gesture inset 32, a 48dp 3-button
 * bar 56).
 */
export function dockBottom(insetBottom: number): number {
  return Math.max(insetBottom, 12) + 8;
}

/**
 * Corner radii (dp). xs skeleton text bones, inline code, checkbox; sm chips,
 * segment pill, sm button; md md button, 44dp icon buttons, segmented well;
 * lg lg button, fields, row cards; xl `Card`; xxl dialog card, wide hero;
 * sheet bottom sheet top corners and covers 200dp and wider; pill circles
 * and pills (prefer `size / 2` for a known size).
 */
export const RADIUS = { xs: 6, sm: 12, md: 16, lg: 20, xl: 24, xxl: 28, sheet: 32, pill: 999 } as const;

/**
 * Lip heights (dp): sm for controls up to 48dp tall, md for 49 to 71dp and
 * every card, row and field, lg for objects 72dp and taller, covers 130dp
 * and wider and dialogs. A face sinks by exactly its lip.
 */
export const LIP = { sm: 2, md: 3, lg: 4 } as const;

/** Lip of a control by its face height. Cards, rows and fields use LIP.md whatever their height. */
export function lipFor(faceHeight: number): number {
  return faceHeight <= 48 ? LIP.sm : faceHeight < 72 ? LIP.md : LIP.lg;
}

/** Font family names as registered with `useFonts` in App.tsx. */
export const FONTS = {
  /**
   * Baloo 2 600: every heading and display line. Baloo 2 (the mockup's face)
   * has no ğ, ş, İ, Ğ or Ş, so Android drew those letters in Roboto; Baloo 2
   * covers Turkish fully (a test reads the bundled files' cmap).
   */
  display: 'Baloo2-SemiBold',
  /** Nunito 700: body, meta. */
  body: 'Nunito-Bold',
  /** Nunito 800: labels, buttons, chips, tab labels. */
  label: 'Nunito-ExtraBold',
} as const;

const sharedTokens = {
  // ─── Typography ───
  fontDisplay: FONTS.display,
  fontBody: FONTS.body,
  fontLabel: FONTS.label,

  // ─── Radii (`RADIUS`) ───
  r: RADIUS,

  // ─── Lips (the darker under-edge, in dp; `LIP`, `lipFor`) ───
  // One step under the mockup's 3 / 4 / 5 / 7: on a phone the deeper lips
  // read as a thick dark border rather than depth.
  lipSize: {
    /** Controls up to 48dp: chips, sm and md buttons, 44dp icon buttons. */
    sm: LIP.sm,
    /** Cards, rows, fields, lg buttons, controls 49 to 71dp. */
    md: LIP.md,
    /** Objects 72dp and taller, covers 130dp and wider, dialogs. */
    lg: LIP.lg,
  },

  // ─── Lines (dp) ───
  /** Hairlines: dividers, the cover ring, the tab bar top line. */
  hairline: 1,
  /** Selection rings and focus outlines. */
  ring: 2,

  // ─── Layout constants ───
  /** Minimum touch target (dp). */
  touch: 48,
  /** Bottom padding a tab screen adds under its content. */
  tabBarReservedHeight: 24,
  /** Side padding of a screen (`SCREEN_PAD_H`; the mockup's 20 wasted 8dp a row). */
  screenPadH: SCREEN_PAD_H,

  // ─── Spacing scale (`SPACE`) ───
  space: SPACE,
};

type SharedTokens = typeof sharedTokens;

// ─────────────────────────────────────────────────────────────
// Theme = shared tokens + one palette.
// ─────────────────────────────────────────────────────────────

export type { ColorPalette, PaletteKey };
export type Theme = SharedTokens & ColorPalette;

function buildTheme(palette: ColorPalette): Theme {
  return { ...sharedTokens, ...palette };
}

export const themes: Record<PaletteKey, Theme> = PALETTE_KEYS.reduce(
  (all, key) => ({ ...all, [key]: buildTheme(palettes[key]) }),
  {} as Record<PaletteKey, Theme>,
);

/** Theme of a palette. Use outside React (navigation theme, tests). */
export function getTheme(key: PaletteKey): Theme {
  return themes[key];
}

/** Reactive theme hook: the active palette (see `ThemeProvider`). */
export function useT(): Theme {
  return themes[usePaletteState().palette];
}

// ─────────────────────────────────────────────────────────────
// Type scale (README "Type", index.html).
//
// Display lines are Baloo 2 (Baloo 2 lacks Turkish letters), one size step
// above the mockup's Baloo 2 sizes because Baloo 2 has a smaller x-height.
// Every line height is at least 1.3 times the font size: a tighter line box
// clips accents (Ş, Ç, Ğ, İ) on Android.
// Text containers never get a fixed height.
// ─────────────────────────────────────────────────────────────

export interface TextStyles {
  /** Display L, Baloo 2 32: tab titles (Keşfet, Sesim), onboarding headline. */
  displayL: TextStyle;
  /** Display M, Baloo 2 28: greeting, story title on detail and player, hero title. */
  displayM: TextStyle;
  /** Section, Baloo 2 21: shelf headings, sheet and dialog titles, state titles. */
  heading: TextStyle;
  /** Baloo 2 18: detail sub-heads ("Kimin sesiyle dinlesin?"). */
  subheading: TextStyle;
  /** Tile, Baloo 2 15: category tiles. */
  tile: TextStyle;
  /** Body, Nunito 700 15.5: onboarding copy, descriptions. */
  body: TextStyle;
  /** Nunito 700 13.5: sub lines under a title, sheet copy. */
  bodySmall: TextStyle;
  /** Label, Nunito 800 14: card titles, list names. */
  label: TextStyle;
  /** Nunito 800 15: narrator rows, settings rows. */
  labelLarge: TextStyle;
  /** Meta, Nunito 700 12: durations, credits keys. */
  meta: TextStyle;
  /** Nunito 700 13: the small line above a greeting. */
  eyebrow: TextStyle;
  /** Nunito 800 13: "Tümü" and other text links. */
  link: TextStyle;
}

export function makeTextStyles(T: Theme): TextStyles {
  const display = T.fontDisplay;
  return {
    displayL: { fontFamily: display, fontSize: 32, lineHeight: 42, color: T.text },
    displayM: { fontFamily: display, fontSize: 28, lineHeight: 37, color: T.text },
    heading: { fontFamily: display, fontSize: 21, lineHeight: 28, color: T.text },
    subheading: { fontFamily: display, fontSize: 18, lineHeight: 24, color: T.text },
    tile: { fontFamily: display, fontSize: 15, lineHeight: 20, color: T.text },
    body: { fontFamily: T.fontBody, fontSize: 15.5, lineHeight: 23, color: T.text2 },
    bodySmall: { fontFamily: T.fontBody, fontSize: 13.5, lineHeight: 19, color: T.text2 },
    label: { fontFamily: T.fontLabel, fontSize: 14, lineHeight: 19, color: T.text },
    labelLarge: { fontFamily: T.fontLabel, fontSize: 15, lineHeight: 21, color: T.text },
    meta: { fontFamily: T.fontBody, fontSize: 12, lineHeight: 16, color: T.text3 },
    eyebrow: { fontFamily: T.fontBody, fontSize: 13, lineHeight: 18, color: T.text3 },
    link: { fontFamily: T.fontLabel, fontSize: 13, lineHeight: 18, color: T.text2 },
  };
}

// ─────────────────────────────────────────────────────────────
// Cached per-palette styles
// ─────────────────────────────────────────────────────────────

/**
 * Wraps a style factory so it runs once per theme. Themes are module
 * singletons (`themes`), so a switch back to a palette is a cache hit and
 * every component of a file shares one sheet per palette. Keyed by the theme
 * object, so a hand-built theme (a test) never collides with a real one and
 * nothing leaks. The factory reads only `T`: the result is shared by every
 * instance, so window sizes, insets and props go in inline styles.
 *
 *   const stylesFor = themedStyles(makeStyles);
 *   const styles = stylesFor(useT());
 */
export function themedStyles<S>(factory: (T: Theme) => S): (T: Theme) => S {
  const cache = new WeakMap<Theme, S>();
  return T => {
    let styles = cache.get(T);
    if (styles === undefined) {
      styles = factory(T);
      cache.set(T, styles);
    }
    return styles;
  };
}

/** The type scale of a theme, one object per palette. */
export const textStylesFor = themedStyles(makeTextStyles);

/** Text styles for the active palette (the same object until the palette changes). */
export function useTextStyles(): TextStyles {
  return textStylesFor(useT());
}
