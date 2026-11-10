/**
 * Palette registry of the playful design (design/v4/playful, README section
 * "Palette exploration", `index.html` classes `.theme-*`).
 *
 * The app is dark only. Six complete palettes ship and the user picks one
 * on the Profile screen ("Renk paleti", `components/profile/PalettePicker`);
 * the default is `gece-mavisi`. Every screen must look right in all six. Each palette is the flat token map of its CSS
 * class; `derivePalette` adds what the CSS derives with `color-mix()` (the
 * own-voice gradient, the status chip tints, the category tiles), so a
 * palette only states what it changes, exactly like the mockup.
 *
 * The values deviate from the approved mockup where its contrast fell short
 * (docs/release-pass/SPEC-design.md 1.6.3, note at the orijinal palette):
 * surfaces lifted to a 6 L* ladder, chip lips darker than the canvas, a few
 * error and warning colours moved off the action colour, a more opaque glass.
 *
 * Nothing in the app hard-codes one of these values: read them through
 * `useT()`.
 */

import { mix, withAlpha } from './color';

export const PALETTE_KEYS = [
  'kitaplik',
  'orman',
  'gece-mavisi',
  'murekkep',
  'erik',
  'orijinal',
] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];

export const DEFAULT_PALETTE: PaletteKey = 'gece-mavisi';

export function isPaletteKey(value: unknown): value is PaletteKey {
  return typeof value === 'string' && (PALETTE_KEYS as readonly string[]).includes(value);
}

/** The four story categories and their colour slots. */
export const CATEGORY_KEYS = ['uyku', 'turk', 'dunya', 'egitici'] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

/** Tokens a palette states (one CSS theme class). */
export interface BasePalette {
  // ─── Canvas and surfaces ───
  /** --bg: app background. */
  bg: string;
  /** --bar: tab bar, Android navigation bar. */
  bar: string;
  /** --bar-line: hairline on top of the tab bar. */
  barLine: string;
  /** --surface: cards, inputs, idle buttons. */
  surface: string;
  /** --surface-2: raised (mini player, selected narrator, active tab pill). */
  surface2: string;
  /** --line: progress tracks, idle filter chips. */
  line: string;
  /** --line-lip: lip under an idle filter chip. */
  lineLip: string;
  /** --lip: the darker under-edge of neutral cards and buttons. */
  lip: string;

  // ─── Text ───
  /** --text: titles and body. */
  text: string;
  /** --text-2: secondary. */
  text2: string;
  /** --text-3: meta, idle tabs. */
  text3: string;

  // ─── Action (the only "do it" colour) ───
  action: string;
  actionLip: string;
  onAction: string;

  // ─── Categories ───
  catUyku: string;
  catUykuLip: string;
  catTurk: string;
  catTurkLip: string;
  catDunya: string;
  catDunyaLip: string;
  catEgitici: string;
  catEgiticiLip: string;
  /** --on-cat: text and icons on a category fill. */
  onCat: string;

  // ─── Meaning ───
  /** --own: the parent's own voice. */
  own: string;
  ownLip: string;
  /** --success: "Hazır". */
  success: string;
  /** --warning. */
  warning: string;
  /**
   * Error and destructive actions. Not in the mockup (its frames show no
   * error); a soft red per palette that keeps 4.5:1 on bg and surface and
   * stays apart from the action colour (OKLab distance at least 7, see
   * contrastRules.test.ts).
   */
  error: string;
  /** --rec: the record button. */
  rec: string;
  /** --on-rec: glyph on the record button. Defaults to on-action. */
  onRec?: string;

  // ─── Small parts ───
  /** --badge / --on-badge: the level badge on a cover. */
  badge: string;
  onBadge: string;
  /** --knob / --knob-lip: the player's progress knob. */
  knob: string;
  knobLip: string;
  /** --cover-ring: 1px ring around covers ('transparent' in orijinal). */
  coverRing?: string;
  /** --shadow: soft drop shadows under floating parts. */
  shadow: string;

  // ─── Optional overrides of derived tokens (orijinal states its own) ───
  ownA?: string;
  ownB?: string;
  ownC?: string;
  chipOkFg?: string;
  chipOkBg?: string;
  chipActFg?: string;
  chipActBg?: string;
  /** Mürekkep: the category tiles become neutral cards with a coloured icon. */
  neutralTiles?: boolean;
}

/** A category's colours wherever it shows (tile, chip, dot, avatar). */
export interface CategoryColors {
  /** The category colour itself (chips, dots, avatars). */
  color: string;
  /** Its lip. */
  lip: string;
  /** Text and icons on `color`. */
  on: string;
  /** The category tile on home (neutral in murekkep). */
  tileBg: string;
  tileFg: string;
  tileLip: string;
  tileIcon: string;
}

export interface ColorPalette extends Required<Omit<BasePalette, 'neutralTiles'>> {
  /** Palette id. */
  name: PaletteKey;
  /** Derived: own-voice card gradient (top left to bottom right). */
  ownA: string;
  ownB: string;
  ownC: string;
  /** Derived: "Hazır" chip. */
  chipOkFg: string;
  chipOkBg: string;
  /** Derived: "Varsayılan" chip. */
  chipActFg: string;
  chipActBg: string;
  /** Derived: glass chip on a cover (duration). */
  glass: string;
  /** Derived: dim behind sheets and dialogs. */
  scrim: string;
  /** Derived: tinted surface for a translucent icon button over artwork. */
  surfaceGlass: string;
  /** Category colours by slot. */
  cat: Record<CategoryKey, CategoryColors>;
}

// ─────────────────────────────────────────────────────────────
// The six palettes (README token table, index.html .theme-*)
// ─────────────────────────────────────────────────────────────

const kitaplik: BasePalette = {
  bg: '#0E1C20', bar: '#0A1619', barLine: '#1A3036',
  surface: '#152A2F', surface2: '#1F383E', line: '#2A464D', lineLip: '#0B181A', lip: '#050E10',
  text: '#EDF3F1', text2: '#A8BDB9', text3: '#8CA39F',
  action: '#FF7A52', actionLip: '#C2461F', onAction: '#1A0B05',
  catUyku: '#B3A7F0', catUykuLip: '#7F71BD',
  catTurk: '#F2B866', catTurkLip: '#BA7F1C',
  catDunya: '#7CC3E6', catDunyaLip: '#3D8DB2',
  catEgitici: '#F0A3B5', catEgiticiLip: '#B96B80',
  onCat: '#0A1619',
  own: '#8FD9C4', ownLip: '#4FA28D',
  success: '#8FD9C4', warning: '#F2B866', error: '#FF8F8F',
  rec: '#FF7A52',
  badge: '#EDF3F1', onBadge: '#0E1C20', knob: '#FFFFFF', knobLip: '#A8BDB9',
  coverRing: '#24414A', shadow: '#010708',
};

const orman: BasePalette = {
  bg: '#0C1710', bar: '#08110B', barLine: '#1A2C20',
  surface: '#16281C', surface2: '#1F3626', line: '#2C4733', lineLip: '#09110B', lip: '#040A05',
  text: '#EEF2E8', text2: '#BAC7B3', text3: '#8FA089',
  action: '#F2B84B', actionLip: '#B4800E', onAction: '#1E1605',
  catUyku: '#C7A2DE', catUykuLip: '#936CAB',
  catTurk: '#EE8FA6', catTurkLip: '#B65671',
  catDunya: '#8DC5EA', catDunyaLip: '#5290B7',
  catEgitici: '#A8CF95', catEgiticiLip: '#71995D',
  onCat: '#0B120D',
  own: '#C7A2DE', ownLip: '#936CAB',
  success: '#A8CF95', warning: '#FFA66E', error: '#F48C80',
  rec: '#EE8FA6', onRec: '#0B120D',
  badge: '#EEF2E8', onBadge: '#0E1611', knob: '#FFFDF6', knobLip: '#BAC7B3',
  coverRing: '#25402D', shadow: '#020402',
};

const geceMavisi: BasePalette = {
  bg: '#121A29', bar: '#0D1420', barLine: '#1D2739',
  surface: '#1D2738', surface2: '#283449', line: '#35425A', lineLip: '#101522', lip: '#080C16',
  text: '#EDF0F6', text2: '#B5BED0', text3: '#939EB4',
  action: '#F2917B', actionLip: '#B85C46', onAction: '#2A110B',
  catUyku: '#ABA4DC', catUykuLip: '#786FA9',
  catTurk: '#DDBB7E', catTurkLip: '#A88542',
  catDunya: '#88B6D6', catDunyaLip: '#5082A3',
  catEgitici: '#96C4A6', catEgiticiLip: '#5F9071',
  onCat: '#0F1624',
  own: '#ABA4DC', ownLip: '#786FA9',
  success: '#96C4A6', warning: '#DDBB7E', error: '#F58EB5',
  rec: '#F2917B',
  badge: '#EDF0F6', onBadge: '#121A29', knob: '#FFFFFF', knobLip: '#B5BED0',
  coverRing: '#34425E', shadow: '#02040A',
};

const murekkep: BasePalette = {
  bg: '#121314', bar: '#0D0E0F', barLine: '#1F2123',
  surface: '#1F2022', surface2: '#2B2D2F', line: '#393B3E', lineLip: '#0C0D0E', lip: '#060707',
  text: '#F0F0EC', text2: '#BDBDB7', text3: '#959691',
  action: '#7ACFBE', actionLip: '#33978A', onAction: '#0A1D19',
  catUyku: '#C3B9E6', catUykuLip: '#8F84B2',
  catTurk: '#EBC3A3', catTurkLip: '#B68D6B',
  catDunya: '#AACAE3', catDunyaLip: '#7395AF',
  catEgitici: '#BBD8AA', catEgiticiLip: '#85A372',
  onCat: '#141516',
  own: '#C3B9E6', ownLip: '#8F84B2',
  success: '#BBD8AA', warning: '#EBC3A3', error: '#F2958C',
  rec: '#7ACFBE',
  badge: '#F0F0EC', onBadge: '#121314', knob: '#FFFFFF', knobLip: '#BDBDB7',
  coverRing: '#2C2E31', shadow: '#000000',
  neutralTiles: true,
};

const erik: BasePalette = {
  bg: '#1D1322', bar: '#160E1A', barLine: '#2A1D30',
  surface: '#2B1E31', surface2: '#392A41', line: '#493753', lineLip: '#180F1C', lip: '#0E0711',
  text: '#F7EEF3', text2: '#D0BECA', text3: '#A9939F',
  action: '#FFB08A', actionLip: '#C7774F', onAction: '#2B130A',
  catUyku: '#9EC4EA', catUykuLip: '#678FB6',
  catTurk: '#F1C163', catTurkLip: '#B98712',
  catDunya: '#F09DB2', catDunyaLip: '#BA667E',
  catEgitici: '#ABD29C', catEgiticiLip: '#749D64',
  onCat: '#1A1020',
  own: '#9EC4EA', ownLip: '#678FB6',
  success: '#ABD29C', warning: '#F1C163', error: '#FF8F8F',
  rec: '#FFB08A',
  badge: '#F7EEF3', onBadge: '#1D1322', knob: '#FFFFFF', knobLip: '#D0BECA',
  coverRing: '#3B2A44', shadow: '#060208',
};

const orijinal: BasePalette = {
  bg: '#15113A', bar: '#100C30', barLine: '#221C58',
  surface: '#211B55', surface2: '#2D2670', line: '#3A3386', lineLip: '#110D31', lip: '#0A0723',
  // text3 one step lighter than the mockup's #8F87C9 (3.99:1 on surface2).
  // Deviation from the approved mockup in every palette (SPEC-design 1.6.3):
  // surfaces lifted to a 6 L* ladder for contrast; chip lips darker than the
  // canvas. Warnings of orman and orijinal moved off their action colour,
  // gece-mavisi's error off its action colour.
  text: '#F5F2FF', text2: '#BDB5EC', text3: '#9D96D6',
  action: '#FFD23F', actionLip: '#C99400', onAction: '#1B1442',
  catUyku: '#C3A6FF', catUykuLip: '#8C6DDB',
  catTurk: '#FF8C6B', catTurkLip: '#C85A3D',
  catDunya: '#5CD6F2', catDunyaLip: '#2B9DBA',
  catEgitici: '#72E3A6', catEgiticiLip: '#36AC6D',
  onCat: '#1B1442',
  own: '#C3A6FF', ownLip: '#8C6DDB',
  success: '#72E3A6', warning: '#FFBB5D', error: '#FF8FA3',
  rec: '#FF8C6B', onRec: '#1B1442',
  badge: '#F5F2FF', onBadge: '#1B1442', knob: '#FFFFFF', knobLip: '#B9B1E6',
  coverRing: 'transparent', shadow: '#040214',
  ownA: '#3A2F8E', ownB: '#2A2272', ownC: '#241D62',
  chipOkFg: '#72E3A6', chipOkBg: 'rgba(114,227,166,0.18)',
  chipActFg: '#FFD23F', chipActBg: 'rgba(255,210,63,0.17)',
};

export const BASE_PALETTES: Record<PaletteKey, BasePalette> = {
  kitaplik,
  orman,
  'gece-mavisi': geceMavisi,
  murekkep,
  erik,
  orijinal,
};

// ─────────────────────────────────────────────────────────────
// Derivation (the shared `[class*="theme-"]` rule of index.html)
// ─────────────────────────────────────────────────────────────

function category(base: BasePalette, color: string, lip: string): CategoryColors {
  const neutral = !!base.neutralTiles;
  return {
    color,
    lip,
    on: base.onCat,
    tileBg: neutral ? base.surface : color,
    tileFg: neutral ? base.text : base.onCat,
    tileLip: neutral ? base.lip : lip,
    tileIcon: neutral ? color : base.onCat,
  };
}

export function derivePalette(name: PaletteKey, base: BasePalette): ColorPalette {
  const { neutralTiles: _neutral, ...tokens } = base;
  return {
    ...tokens,
    name,
    onRec: base.onRec ?? base.onAction,
    coverRing: base.coverRing ?? 'transparent',
    ownA: base.ownA ?? mix(base.own, 0.16, base.surface2),
    ownB: base.ownB ?? mix(base.own, 0.08, base.surface2),
    ownC: base.ownC ?? mix(base.own, 0.05, base.surface),
    chipOkFg: base.chipOkFg ?? mix(base.success, 0.45, base.text),
    chipOkBg: base.chipOkBg ?? withAlpha(base.success, 0.12),
    chipActFg: base.chipActFg ?? mix(base.action, 0.45, base.text),
    chipActBg: base.chipActBg ?? withAlpha(base.action, 0.12),
    // 0.7, not the mockup's 0.62: React Native has no backdrop blur, and text
    // on the duration chip over a white cover needs 4.5:1.
    glass: withAlpha(base.bg, 0.7),
    scrim: withAlpha(base.shadow, 0.72),
    surfaceGlass: withAlpha(base.surface, 0.75),
    cat: {
      uyku: category(base, base.catUyku, base.catUykuLip),
      turk: category(base, base.catTurk, base.catTurkLip),
      dunya: category(base, base.catDunya, base.catDunyaLip),
      egitici: category(base, base.catEgitici, base.catEgiticiLip),
    },
  };
}

export const palettes: Record<PaletteKey, ColorPalette> = PALETTE_KEYS.reduce(
  (all, key) => ({ ...all, [key]: derivePalette(key, BASE_PALETTES[key]) }),
  {} as Record<PaletteKey, ColorPalette>,
);

// ─────────────────────────────────────────────────────────────
// Story category to colour slot
// ─────────────────────────────────────────────────────────────

const CATEGORY_SLOTS: Record<string, CategoryKey> = {
  BEDTIME: 'uyku',
  TURKISH_CLASSICS: 'turk',
  WORLD_CLASSICS: 'dunya',
  EDUCATIONAL: 'egitici',
  FABLE: 'egitici',
};

/** Colour slot of a backend story category; null for an unknown one. */
export function categorySlot(category: string | null | undefined): CategoryKey | null {
  return (category && CATEGORY_SLOTS[category]) || null;
}

/**
 * Colours of a story category in a palette. An unknown category gets the
 * neutral surface colours (no category colour claims it).
 */
export function categoryColors(
  palette: ColorPalette,
  category: string | null | undefined,
): CategoryColors {
  const slot = categorySlot(category);
  if (slot) return palette.cat[slot];
  return {
    color: palette.text3,
    lip: palette.lip,
    on: palette.bg,
    tileBg: palette.surface,
    tileFg: palette.text,
    tileLip: palette.lip,
    tileIcon: palette.text2,
  };
}
