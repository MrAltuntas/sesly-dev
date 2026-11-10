/**
 * Button sizes (docs/release-pass/SPEC-design.md 1.4). Pure numbers, so hand
 * built buttons (`CardAction` on the voice cards) and the tests share them
 * with `Button`, which re-exports them.
 *
 *   size  face  lip  radius  padH  text   icon  gap  touch target
 *   sm    36    2    12      12    14/19  16    6    hitSlop 5 top and bottom
 *   md    44    2    16      16    15/21  20    8    hitSlop 1 top and bottom
 *   lg    52    3    20      20    16/22  20    8    55dp on its lip, no slop
 *
 * lg is only for the one bottom call to action of a screen or a form;
 * everything in sheets and dialogs is md. A face sinks by exactly its lip.
 */

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonMetrics {
  /** Face min height (dp); the lip is drawn below it. */
  height: number;
  lip: number;
  radius: number;
  /** Horizontal face padding. */
  padH: number;
  font: number;
  lineHeight: number;
  icon: number;
  /** Icon to label. */
  gap: number;
}

export const BUTTON_METRICS: Readonly<Record<ButtonSize, ButtonMetrics>> = {
  sm: { height: 36, lip: 2, radius: 12, padH: 12, font: 14, lineHeight: 19, icon: 16, gap: 6 },
  md: { height: 44, lip: 2, radius: 16, padH: 16, font: 15, lineHeight: 21, icon: 20, gap: 8 },
  lg: { height: 52, lip: 3, radius: 20, padH: 20, font: 16, lineHeight: 22, icon: 20, gap: 8 },
};

/** Vertical face padding of every size (the label line sits between). */
export const BUTTON_PAD_V = 8;

/** Minimum touch target (dp), the same as `T.touch`. */
export const BUTTON_TOUCH = 48;

/**
 * Top and bottom hit slop that brings a button and its lip to the 48dp touch
 * target (sm 5, md 1), or undefined when it is already that tall (lg).
 */
export function buttonHitSlop(size: ButtonSize, touch = BUTTON_TOUCH): { top: number; bottom: number } | undefined {
  const { height, lip } = BUTTON_METRICS[size];
  const slop = Math.max(0, (touch - height - lip) / 2);
  return slop > 0 ? { top: slop, bottom: slop } : undefined;
}
