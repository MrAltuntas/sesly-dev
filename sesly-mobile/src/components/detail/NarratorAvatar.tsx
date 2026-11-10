/**
 * NarratorAvatar: the avatar of a narrator (`.nc .av` and `.nr .av` in
 * design/v4/playful).
 *
 * 'own' (the parent's cloned voice): the own-voice colour with the wave
 * glyph, the hero of every narrator choice. 'ready' (a ready-made
 * narrator): the narrator's initial on a category colour. The colour comes
 * from `narratorAvatarSlotFor` on the voice id, the helper the Sesim tab and
 * the narrator catalogue use, so one narrator wears one colour everywhere.
 */

import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { Theme, useT } from '../../theme/theme';
import type { CategoryColors } from '../../theme/palettes';
import { Avatar, avatarRadius } from '../design';
import { initialOf } from '../../i18n/text';
import { narratorAvatarSlotFor } from '../voice/narratorRows';

export type NarratorAvatarTone = 'own' | 'ready';

/** Category colours of a ready-made narrator's avatar, stable per voice id. */
export function narratorColors(T: Theme, key: string): CategoryColors {
  return T.cat[narratorAvatarSlotFor(key)];
}

/**
 * Corners of a rounded (`.nr`) avatar by its edge: the design's own
 * `avatarRadius` (the radius roles of SPEC-design 1.2: a 40dp tile 12, a
 * picture tile 16), which `Avatar` draws its bubble and its lip with. The
 * skeletons that stand for these rows read it here.
 */
export function roundedAvatarRadius(size: number): number {
  return avatarRadius(size, 'rounded');
}

export interface NarratorAvatarProps {
  name: string;
  tone?: NarratorAvatarTone;
  /** What picks the colour of a ready-made narrator (voice id). Default: the name. */
  colorKey?: string;
  size?: number;
  /** 'circle' (narrator cards) or 'rounded' (`.nr` rows). */
  shape?: 'circle' | 'rounded';
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const NarratorAvatar: React.FC<NarratorAvatarProps> = ({
  name,
  tone = 'ready',
  colorKey,
  size = 40,
  shape = 'circle',
  testID,
  style,
}) => {
  const T = useT();
  if (tone === 'own') {
    return <Avatar icon="wave" size={size} color={T.own} textColor={T.onCat} shape={shape} testID={testID} style={style} />;
  }
  return (
    <Avatar
      initial={initialOf(name, '?')}
      size={size}
      color={narratorColors(T, colorKey ?? name).color}
      textColor={T.onCat}
      shape={shape}
      testID={testID}
      style={style}
    />
  );
};
