/**
 * The player's option tiles (`.opt`, design v4 playful frame d) and the
 * sleep timer tile (SPEC-audio 7.4).
 *
 * `OptionTile`: a 64dp tactile tile with a 32dp icon square, a small label
 * and a Baloo 2 value. Its 2dp ring is always there (transparent while the
 * tile is not tinted), so switching the tint never moves the content. A tile
 * opens a sheet: it sinks at the touch (no press delay), rises at the press
 * itself rather than at Pressability's late press-out (LR-4R), and its
 * `onPress` runs in the next frame, so the sink and the rise are on the
 * native driver before the sheet's mount takes the JS thread (LR-4,
 * `useNextFramePress`). It draws its own lip and face (`usePressSink`), the
 * way `Tactile` does, to own that rise.
 *
 * `TimerTile`: the timer's state in two lines, "Zamanlayıcı / Kapalı",
 * "Zamanlayıcı / Bu masal", "Zamanlayıcı / 3 masal", or "Kalan süre / 14:52"
 * while a duration runs. The value has tabular digits on one line with no
 * auto-fit, so the countdown changes in place every second and never pumps
 * or slides; the motion is the drain line along the bottom of the face. It is
 * the only part of the player that observes the countdown every second.
 */

import React, { useEffect } from 'react';
import { Animated, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { LIP, SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { mix } from '../../theme/color';
import { raisedFace } from '../../theme/surfaces';
import { Icon, IconName } from '../design/Icon';
import { useSurfaceLevel } from '../design/SurfaceLevel';
import { useNextFramePress, usePressSink } from '../design/Tactile';
import sleepTimerService from '../../services/SleepTimerService';
import { sleepTimerEntryLabel } from './playerMath';
import { SLEEP_DRAIN_HEIGHT, SleepDrainLine } from './SleepDrainLine';

/** Face metrics of an option tile (dp). */
export const OPTION_TILE = {
  minHeight: 64,
  padH: SPACE.md,
  gap: SPACE.sm,
  icon: 32,
  ring: 2,
} as const;

/** Text sizes grow with the system font only this far (the slot is 86dp at 360dp). */
const TILE_MAX_FONT_SCALE = 1.3;

/** The timer tile's tint while a timer is on (opaque mixes over the canvas). */
export function timerTileTint(T: Theme): { face: string; ring: string } {
  return { face: mix(T.catUyku, 0.17, T.bg), ring: mix(T.catUyku, 0.55, T.bg) };
}

export interface OptionTileProps {
  icon: IconName;
  iconBg: string;
  iconColor: string;
  label: string;
  /** The value line; use `optionTileStylesFor(T).value` for its text. */
  value: React.ReactNode;
  /** Tinted face and ring (the timer is on). */
  tint?: { face: string; ring: string };
  onPress: () => void;
  accessibilityLabel: string;
  /** The tile; its face is `${testID}-face`, the icon square `${testID}-icon`. */
  testID: string;
  /** Outer box (flex, margins). */
  style?: StyleProp<ViewStyle>;
  /** Drawn over the bottom of the face (the timer's drain line). */
  overlay?: React.ReactNode;
}

export const OptionTile: React.FC<OptionTileProps> = ({
  icon,
  iconBg,
  iconColor,
  label,
  value,
  tint,
  onPress,
  accessibilityLabel,
  testID,
  style,
  overlay,
}) => {
  const T = useT();
  const styles = optionTileStylesFor(T);
  const level = useSurfaceLevel();
  const sink = usePressSink(LIP.md);
  const open = useNextFramePress(onPress);
  // The tile rises at the press itself (LR-4R). A quick tap gets its
  // press-out from Pressability up to 130 ms late, from a timer; the sheet's
  // mount in the next frame held that timer back, and the tile stayed sunk
  // for about a second. The late press-out then only confirms the rise.
  const press = () => {
    sink.onPressOut();
    open?.();
  };
  return (
    <Pressable
      onPress={press}
      onPressIn={sink.onPressIn}
      onPressOut={sink.onPressOut}
      // Like the transport above it (the player is no list): it answers at touch-down.
      unstable_pressDelay={0}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[styles.outer, style]}
    >
      <View pointerEvents="none" testID={`${testID}-lip`} style={[styles.lip, { borderRadius: T.r.lg }]} />
      <Animated.View
        testID={`${testID}-face`}
        style={[
          {
            backgroundColor: tint ? tint.face : raisedFace(T, level),
            borderRadius: T.r.lg,
            borderColor: tint?.ring ?? 'transparent',
            borderWidth: OPTION_TILE.ring,
            transform: [{ translateY: sink.translateY }],
          },
          styles.face,
        ]}
      >
        <View style={[styles.icon, { backgroundColor: iconBg }]} testID={`${testID}-icon`}>
          <Icon name={icon} size={20} color={iconColor} />
        </View>
        <View style={styles.text}>
          <Text
            style={styles.label}
            numberOfLines={1}
            maxFontSizeMultiplier={TILE_MAX_FONT_SCALE}
            testID={`${testID}-label`}
          >
            {label}
          </Text>
          {value}
        </View>
        {overlay}
      </Animated.View>
    </Pressable>
  );
};

export interface TimerTileProps {
  /** Opens the timer sheet. */
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export const TimerTile: React.FC<TimerTileProps> = observer(({ onPress, style }) => {
  const T = useT();
  const styles = optionTileStylesFor(T);
  const { t } = useTranslation('player');
  const timer = sleepTimerService.store;

  // The remembered choices (mode, last duration, fade-out) for the sheet.
  useEffect(() => {
    void sleepTimerService.initialize();
  }, []);

  const on = timer.active;
  const running = timer.isDurationRunning;
  const entry = sleepTimerEntryLabel({
    active: on,
    mode: timer.mode,
    storiesLeft: timer.storiesLeft,
    remainingSeconds: timer.remainingSeconds,
  });
  const spoken =
    entry.label === t('timer.short')
      ? `${t('timer.title')}, ${entry.value}`
      : `${t('timer.title')}, ${entry.label} ${entry.value}`;

  return (
    <OptionTile
      icon="moon"
      iconBg={T.catUyku}
      iconColor={T.onCat}
      label={entry.label}
      value={
        <Text
          style={styles.value}
          numberOfLines={1}
          maxFontSizeMultiplier={TILE_MAX_FONT_SCALE}
          testID="player-timer-state"
        >
          {entry.value}
        </Text>
      }
      tint={on ? timerTileTint(T) : undefined}
      onPress={onPress}
      accessibilityLabel={spoken}
      testID="player-timer-entry"
      style={style}
      overlay={running ? <SleepDrainLine style={styles.drain} testID="player-timer-drain" /> : null}
    />
  );
});

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    // The tile's own lip and face, as `Tactile` draws them.
    outer: { paddingBottom: LIP.md },
    lip: { position: 'absolute', left: 0, right: 0, bottom: 0, top: LIP.md, backgroundColor: T.lip },
    face: {
      minHeight: OPTION_TILE.minHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: OPTION_TILE.gap,
      paddingHorizontal: OPTION_TILE.padH,
      paddingVertical: SPACE.sm,
    },
    icon: {
      width: OPTION_TILE.icon,
      height: OPTION_TILE.icon,
      borderRadius: T.r.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: { flex: 1, minWidth: 0 },
    label: { fontFamily: T.fontBody, fontSize: 11.5, lineHeight: 15, color: T.text2 },
    /** The Baloo 2 value of every option tile: tabular digits, so a number never changes width. */
    value: {
      fontFamily: T.fontDisplay,
      fontSize: 17,
      lineHeight: 23,
      color: T.text,
      fontVariant: ['tabular-nums'],
    },
    // Inside the face, under the text: left / right like the content, 6 above the bottom.
    drain: {
      position: 'absolute',
      left: OPTION_TILE.padH,
      right: OPTION_TILE.padH,
      bottom: SPACE.tight,
      height: SLEEP_DRAIN_HEIGHT,
    },
  });

/** The option tile styles of a palette (`value` for a tile's value text). */
export const optionTileStylesFor = themedStyles(makeStyles);

export default TimerTile;
