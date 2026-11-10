/**
 * Stepper: minus, number, plus (the sleep timer's story count; SPEC-design 3.9).
 *
 * Two 40dp round tactile keys (one step above their container on a 2dp lip,
 * inside 48dp targets) around a Baloo 2 number. The keys answer at
 * touch-down (no press delay). A key is disabled at its end of the range: it
 * keeps its place and draws the disabled face with a faint glyph. The number
 * has tabular digits in a box of a fixed minimum width, so the keys never
 * move when it goes from 9 to 10. The group is adjustable for screen readers.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '../design/Icon';
import { useSurfaceLevel } from '../design/SurfaceLevel';
import { Tactile } from '../design/Tactile';
import { LIP, SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { disabledFace, raisedFace } from '../../theme/surfaces';

/** Visible edge of a key; the touch target is 48dp. */
export const STEPPER_BUTTON = 40;
/** The number's box: two tabular Baloo 2 digits fit with room to spare. */
export const STEPPER_VALUE_MIN_WIDTH = 44;
/** The number grows with the system font only this far. */
const VALUE_MAX_FONT_SCALE = 1.3;

export interface StepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  /** Label of the whole control ("Kaç masal sonra"). */
  accessibilityLabel: string;
  /** Spoken value ("2 masal"). */
  valueText: string;
  /** Read after the value ("Dokununca zamanlayıcı açılır"). */
  accessibilityHint?: string;
  decrementLabel: string;
  incrementLabel: string;
  testID?: string;
}

export const Stepper: React.FC<StepperProps> = ({
  value,
  min,
  max,
  onChange,
  accessibilityLabel,
  valueText,
  accessibilityHint,
  decrementLabel,
  incrementLabel,
  testID = 'stepper',
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const level = useSurfaceLevel();
  const canDecrement = value > min;
  const canIncrement = value < max;

  const step = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta));
    if (next !== value) onChange(next);
  };

  const slop = (T.touch - STEPPER_BUTTON - LIP.sm) / 2;
  const button = (delta: 1 | -1) => {
    const enabled = delta > 0 ? canIncrement : canDecrement;
    return (
      <Tactile
        color={enabled ? raisedFace(T, level) : disabledFace(T, level)}
        lipColor={T.lip}
        lip={LIP.sm}
        radius={STEPPER_BUTTON / 2}
        onPress={() => step(delta)}
        disabled={!enabled}
        // The disabled face says it; the key never fades as a whole.
        dimWhenDisabled={false}
        pressDelay={0}
        hitSlop={{ top: slop, bottom: slop, left: SPACE.xs, right: SPACE.xs }}
        accessibilityLabel={delta > 0 ? incrementLabel : decrementLabel}
        accessibilityHint={accessibilityHint}
        testID={`${testID}-${delta > 0 ? 'plus' : 'minus'}`}
        faceStyle={styles.button}
      >
        <Icon
          name={delta > 0 ? 'plus' : 'minus'}
          size={20}
          color={enabled ? T.text : T.text3}
          testID={`${testID}-${delta > 0 ? 'plus' : 'minus'}-glyph`}
        />
      </Tactile>
    );
  };

  return (
    <View
      testID={testID}
      accessible={false}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityValue={{ min, max, now: value, text: valueText }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => {
        if (event.nativeEvent.actionName === 'increment') step(1);
        if (event.nativeEvent.actionName === 'decrement') step(-1);
      }}
      style={styles.row}
    >
      {button(-1)}
      <View style={styles.valueBox} testID={`${testID}-value-box`}>
        <Text
          testID={`${testID}-value`}
          accessibilityLabel={valueText}
          maxFontSizeMultiplier={VALUE_MAX_FONT_SCALE}
          numberOfLines={1}
          style={styles.value}
        >
          {value}
        </Text>
      </View>
      {button(1)}
    </View>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
    button: {
      width: STEPPER_BUTTON,
      height: STEPPER_BUTTON,
      alignItems: 'center',
      justifyContent: 'center',
    },
    valueBox: { minWidth: STEPPER_VALUE_MIN_WIDTH, alignItems: 'center' },
    value: {
      textAlign: 'center',
      fontFamily: T.fontDisplay,
      fontSize: 20,
      lineHeight: 26,
      color: T.text,
      fontVariant: ['tabular-nums'],
    },
  });

const stylesFor = themedStyles(makeStyles);

export default Stepper;
