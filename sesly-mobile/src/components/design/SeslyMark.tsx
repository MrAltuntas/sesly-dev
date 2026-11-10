/**
 * SeslyMark: the app mark.
 *
 * Two bitmaps. `logo.png` is the 2000px master, used large (splash). Scaling
 * that down to a top-bar size on the device leaves it soft and jagged, so
 * small sizes use `logo-mark.png`, which is pre-scaled per screen density
 * (28dp at 1x, 2x, 3x and 4x): the bitmap matches the pixels it is drawn on.
 *
 * A bitmap is decoded off the UI thread and lands a frame or more after its
 * view (in a debug build Metro serves it over HTTP, about 0.3 s), so a bar
 * would show the wordmark alone first. A small mark therefore draws the
 * vector mark (`seslyMarkVector.ts`, the same frame and colours) under the
 * bitmap from its first frame, and drops it once the bitmap has loaded.
 */

import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import {
  SESLY_MARK_GRADIENTS,
  SESLY_MARK_PATHS,
  SESLY_MARK_VIEWBOX,
  type SeslyMarkFill,
  type SeslyMarkGradient,
} from './seslyMarkVector';

/** Up to this size the density-matched small mark is used. */
export const SMALL_MARK_MAX_SIZE = 32;

export interface SeslyMarkProps {
  size?: number;
  /** Next to the wordmark the mark says nothing new: hide it from screen readers. */
  decorative?: boolean;
  testID?: string;
}

const GRADIENT_KEYS = Object.keys(SESLY_MARK_GRADIENTS) as SeslyMarkGradient[];

const gradientId = (key: SeslyMarkGradient) => `sesly-mark-${key}`;

const paintOf = (fill: SeslyMarkFill) => ('gradient' in fill ? `url(#${gradientId(fill.gradient)})` : fill.color);

/** The vector mark, filling a `size` square. Decorative on its own. */
export const SeslyMarkVector = React.memo(function SeslyMarkVector({
  size,
  testID,
}: {
  size: number;
  testID?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox={SESLY_MARK_VIEWBOX} testID={testID}>
      <Defs>
        {GRADIENT_KEYS.map(key => {
          const { x1, x2, stops } = SESLY_MARK_GRADIENTS[key];
          return (
            <LinearGradient key={key} id={gradientId(key)} gradientUnits="userSpaceOnUse" x1={x1} y1={0} x2={x2} y2={0}>
              {stops.map(([offset, color]) => (
                <Stop key={offset} offset={offset} stopColor={color} />
              ))}
            </LinearGradient>
          );
        })}
      </Defs>
      {SESLY_MARK_PATHS.map((path, i) => (
        <Path key={i} d={path.d} fill={paintOf(path.fill)} />
      ))}
    </Svg>
  );
});

export const SeslyMark: React.FC<SeslyMarkProps> = ({ size = 22, decorative, testID }) => {
  // The small bitmap has drawn: the vector under it can go.
  const [bitmapLoaded, setBitmapLoaded] = useState(false);
  const a11y = {
    accessible: !decorative,
    accessibilityLabel: decorative ? undefined : 'Sesly',
    accessibilityElementsHidden: decorative,
  };

  if (size > SMALL_MARK_MAX_SIZE) {
    return (
      <Image
        source={require('../../assets/images/logo.png')}
        style={{ width: size, height: size }}
        resizeMode="contain"
        // No cross-fade: the mark is there as soon as it decodes.
        fadeDuration={0}
        {...a11y}
        importantForAccessibility={decorative ? 'no' : 'auto'}
        testID={testID}
      />
    );
  }

  return (
    <View
      style={{ width: size, height: size }}
      {...a11y}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      testID={testID}
    >
      {bitmapLoaded ? null : <SeslyMarkVector size={size} testID={testID && `${testID}-vector`} />}
      <Image
        source={require('../../assets/images/logo-mark.png')}
        style={StyleSheet.absoluteFill}
        resizeMode="contain"
        // No cross-fade: the bitmap covers the vector at once.
        fadeDuration={0}
        onLoad={() => setBitmapLoaded(true)}
        testID={testID && `${testID}-bitmap`}
      />
    </View>
  );
};
