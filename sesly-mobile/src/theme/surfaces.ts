/**
 * The neutral surface ladder and the faces drawn on it
 * (docs/release-pass/SPEC-design.md 1.6.1). Pure functions of a palette, so
 * components and the contrast contract (`contrastRules.test.ts`) read the
 * same values.
 *
 *   bar  <  bg  <  surface  <  surface2  <  line      (each step >= 6 CIELAB L*)
 *
 * A container says which level it is (`SurfaceLevelProvider`,
 * components/design/SurfaceLevel); a neutral control inside it takes the next
 * step up (raised) or the step down (inset). Nothing is ever drawn in its
 * container's colour.
 *
 *   container     raised     inset     disabled
 *   bg            surface    surface   surface
 *   surface       surface2   bg        surface2
 *   surface2      line       surface   surface
 */

import type { ColorPalette } from './palettes';
import { mix } from './color';

export type SurfaceLevel = 'bg' | 'surface' | 'surface2';

export const SURFACE_LEVELS: readonly SurfaceLevel[] = ['bg', 'surface', 'surface2'];

const LADDER = ['bg', 'surface', 'surface2', 'line'] as const;

type LadderPalette = Pick<ColorPalette, 'bg' | 'surface' | 'surface2' | 'line'>;

/** Secondary button, tactile icon button, stepper key, row icon tile. */
export function raisedFace(P: LadderPalette, level: SurfaceLevel): string {
  return P[LADDER[LADDER.indexOf(level) + 1]];
}

/** Text field, search field, segmented well. */
export function insetFace(P: LadderPalette, level: SurfaceLevel): string {
  return level === 'bg' ? P.surface : P[LADDER[LADDER.indexOf(level) - 1]];
}

/** Disabled button of any variant: never the action colour, never above surface2. */
export function disabledFace(P: LadderPalette, level: SurfaceLevel): string {
  return level === 'surface2' ? P.surface : raisedFace(P, level);
}

/** 1dp opaque ring of a glass control (cover bookmark, player close and more). */
export function glassRing(P: Pick<ColorPalette, 'text' | 'surface'>): string {
  return mix(P.text, 0.3, P.surface);
}

/**
 * Opaque ghost face (second action on a tinted card): bar at 55 % over that
 * card. A translucent face over the lip layer read as a dark slab.
 */
export function ghostFace(P: Pick<ColorPalette, 'bar'>, cardColor: string): string {
  return mix(P.bar, 0.55, cardColor);
}

/** Unplayed waveform bars (decorative, aria-hidden): 3:1 on surface. */
export const WAVE_IDLE_ALPHA = 0.4;
