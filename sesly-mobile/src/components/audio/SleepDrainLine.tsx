/**
 * SleepDrainLine: a 3dp line that empties toward a duration sleep timer's
 * deadline (SPEC-audio 7.4). Track in the sleep colour at 30 %, fill in the
 * sleep colour, moved by a transform on the shared native-driven drain value
 * (`sleepDrain`), so the line glides while the digits beside it stay still.
 * Decorative: the countdown text carries the information. Mount it only
 * while a duration timer runs; the caller positions it (`style`).
 */

import React, { useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Theme, themedStyles, useT } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { AnimatedFill } from '../design/feedback';
import { useSleepDrain } from './sleepDrain';

export const SLEEP_DRAIN_HEIGHT = 3;

export interface SleepDrainLineProps {
  style?: StyleProp<ViewStyle>;
  /** The track; the fill is `${testID}-fill`. */
  testID?: string;
}

export const SleepDrainLine: React.FC<SleepDrainLineProps> = React.memo(({ style, testID = 'sleep-drain' }) => {
  const T = useT();
  const styles = stylesFor(T);
  const progress = useSleepDrain();
  const [width, setWidth] = useState(0);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      testID={testID}
      style={[styles.track, style]}
    >
      <AnimatedFill
        progress={progress}
        trackWidth={width}
        height={SLEEP_DRAIN_HEIGHT}
        radius={SLEEP_DRAIN_HEIGHT / 2}
        color={T.catUyku}
        testID={`${testID}-fill`}
      />
    </View>
  );
});
SleepDrainLine.displayName = 'SleepDrainLine';

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    track: {
      height: SLEEP_DRAIN_HEIGHT,
      borderRadius: SLEEP_DRAIN_HEIGHT / 2,
      overflow: 'hidden',
      backgroundColor: withAlpha(T.catUyku, 0.3),
    },
  });

const stylesFor = themedStyles(makeStyles);

export default SleepDrainLine;
