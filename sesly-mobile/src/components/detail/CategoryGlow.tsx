/**
 * CategoryGlow: the soft round glow behind a cover (`.dt .blob` in
 * design/v4/playful): a radial gradient of the story's category colour,
 * 42% at the centre, 18% half way out, transparent at the rim.
 *
 * Drawn with react-native-svg so the fade is a real gradient on both
 * platforms. Decorative: hidden from screen readers and not touchable.
 */

import React, { useId } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

export interface CategoryGlowProps {
  /** Colour of the glow (`categoryColors(T, story.category).color`). */
  color: string;
  /** Diameter in dp (mockup 236 for a 144dp cover). */
  size: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Stops of the mockup's `radial-gradient(circle, 42% 0, 18% 50%, 0 71%)`. */
export const GLOW_STOPS: readonly { offset: number; opacity: number }[] = [
  { offset: 0, opacity: 0.42 },
  // 50% of the gradient line is 70% of the circle's radius.
  { offset: 0.7, opacity: 0.18 },
  { offset: 1, opacity: 0 },
];

export const CategoryGlow: React.FC<CategoryGlowProps> = ({ color, size, testID, style }) => {
  // One gradient id per glow, so two glows on a screen never share a fill.
  const id = `glow${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View
      testID={testID}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width: size, height: size }, style]}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            {GLOW_STOPS.map(stop => (
              <Stop
                key={stop.offset}
                offset={stop.offset}
                stopColor={color}
                stopOpacity={stop.opacity}
              />
            ))}
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
};
