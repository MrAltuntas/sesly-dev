/**
 * SpeedSheet: "Oynatma hızı" (design v4 playful, the player's speed tile).
 *
 * The current value large in Baloo 2, the stepped slider drawn like the
 * player's progress (fat track, action fill, knob on its lip) with eight
 * stops, one line of explanation and the switch "Bütün masallarda bu hızı
 * kullan". Everything applies at once: the sheet stays open so the change
 * can be heard, and there is no Uygula or Vazgeç.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '../design/BottomSheet';
import { SwitchRow } from '../design/controls';
import { Theme, themedStyles, useT } from '../../theme/theme';
import { SteppedSlider } from './SteppedSlider';
import { NORMAL_SPEED_INDEX, SPEED_STOPS, formatSpeed, speedStopIndex } from './playerMath';

export interface SpeedSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Current playback speed. */
  speed: number;
  /** "Use this speed for every story". */
  forAllStories: boolean;
  onSpeedChange: (speed: number) => void;
  onForAllStoriesChange: (enabled: boolean) => void;
}

export const SpeedSheet: React.FC<SpeedSheetProps> = ({
  visible,
  onClose,
  speed,
  forAllStories,
  onSpeedChange,
  onForAllStoriesChange,
}) => {
  const T = useT();
  const { t } = useTranslation('player');
  const styles = stylesFor(T);
  const separator = t('decimalSeparator');
  const labels = useMemo(() => SPEED_STOPS.map(stop => formatSpeed(stop, separator)), [separator]);
  const index = speedStopIndex(speed);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('speed.title')}
      testID="speed-sheet"
      contentStyle={styles.content}
    >
      <Text style={styles.value} testID="speed-value">
        {labels[index]}
      </Text>
      <View style={styles.slider}>
        <SteppedSlider
          labels={labels}
          index={index}
          onChange={next => onSpeedChange(SPEED_STOPS[next])}
          markedIndex={NORMAL_SPEED_INDEX}
          markedNote={t('speed.normal')}
          accessibilityLabel={t('speed.title')}
          testID="speed-slider"
        />
      </View>
      <Text style={styles.note}>{t('speed.note')}</Text>
      <SwitchRow
        label={t('speed.forAll')}
        detail={t('speed.forAllDetail')}
        value={forAllStories}
        onValueChange={onForAllStoriesChange}
        testID="speed-for-all"
        style={styles.switchRow}
      />
    </BottomSheet>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    content: { paddingHorizontal: 0 },
    value: {
      textAlign: 'center',
      paddingHorizontal: T.screenPadH,
      fontFamily: T.fontDisplay,
      fontSize: 40,
      lineHeight: 52,
      color: T.text,
      fontVariant: ['tabular-nums'],
    },
    slider: { paddingHorizontal: T.screenPadH, marginTop: T.space.xs },
    note: {
      paddingTop: T.space.xs,
      paddingBottom: T.space.sm,
      paddingHorizontal: T.screenPadH,
      fontFamily: T.fontBody,
      fontSize: 13.5,
      lineHeight: 19,
      color: T.text2,
    },
    switchRow: { marginTop: T.space.xs },
  });

const stylesFor = themedStyles(makeStyles);

export default SpeedSheet;
