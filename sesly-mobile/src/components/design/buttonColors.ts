/**
 * Colours of a button by variant, tone and the level it sits on
 * (docs/release-pass/SPEC-design.md 1.6.1). Pure, so the mapping is testable
 * and the contrast contract (`src/theme/contrastRules.test.ts`) checks the
 * colours the button really draws.
 *
 * - primary: `action` on `actionLip`, label `onAction`. Danger: `error` on a
 *   darker error lip, label `onAction`.
 * - secondary: one ladder step above its container (`raisedFace`) on `lip`,
 *   label `text` (danger: `error`).
 * - ghost: the opaque `ghostFace` over the card it sits on (`parentColor`,
 *   else the container of `level`) on `lip`.
 * - text: no face and no lip, label `text` (danger: `error`).
 * - disabled, any variant: `disabledFace` on `lip` with a `text3` label and
 *   no opacity (a text button keeps no face and only greys its label). Never
 *   the action colour, so a disabled button never reads as faded salmon.
 */

import type { Theme } from '../../theme/theme';
import { flatten, mix } from '../../theme/color';
import { SurfaceLevel, disabledFace, ghostFace, raisedFace } from '../../theme/surfaces';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'text';
export type ButtonTone = 'default' | 'danger';

export interface ButtonColors {
  background: string;
  label: string;
  /** The lip under the face ('transparent' for a text button). */
  lip: string;
}

export interface ButtonColorState {
  disabled?: boolean;
  /**
   * Colour of the card a ghost button sits on (its face is mixed over it). A
   * translucent one is flattened onto the container; 'transparent' or none
   * means the container itself.
   */
  parentColor?: string;
}

export function buttonColors(
  T: Theme,
  variant: ButtonVariant,
  tone: ButtonTone = 'default',
  level: SurfaceLevel = 'bg',
  { disabled = false, parentColor }: ButtonColorState = {},
): ButtonColors {
  const danger = tone === 'danger';
  if (variant === 'text') {
    return { background: 'transparent', label: disabled ? T.text3 : danger ? T.error : T.text, lip: 'transparent' };
  }
  if (disabled) {
    return { background: disabledFace(T, level), label: T.text3, lip: T.lip };
  }
  switch (variant) {
    case 'primary':
      return danger
        ? { background: T.error, label: T.onAction, lip: mix(T.error, 0.62, T.lip) }
        : { background: T.action, label: T.onAction, lip: T.actionLip };
    case 'secondary':
      return { background: raisedFace(T, level), label: danger ? T.error : T.text, lip: T.lip };
    case 'ghost':
    default:
      return { background: ghostFace(T, opaqueParent(parentColor, T[level])), label: danger ? T.error : T.text, lip: T.lip };
  }
}

/** The opaque colour under a ghost face. */
function opaqueParent(parentColor: string | undefined, container: string): string {
  if (!parentColor || parentColor === 'transparent') return container;
  return parentColor.startsWith('#') ? parentColor : flatten(parentColor, container);
}
