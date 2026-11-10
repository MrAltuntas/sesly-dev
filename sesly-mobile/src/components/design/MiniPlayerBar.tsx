/**
 * MiniPlayerBar: the playing story docked above the tab bar (`.mini` in
 * design/v4/playful). Presentational; `MiniPlayerDock` feeds it from the
 * audio store.
 *
 * A raised card (surface-2, 20dp corners) on its 3dp lip, on the page
 * gutter like the cards above it: a 44dp rounded cover, the title and
 * "X anlatıyor, N dk kaldı" ("Duraklatıldı, N dk kaldı" while paused) after
 * a wave mark (in the own-voice colour when the parent's own voice tells
 * it), a round action-colour play button the size of a sm button (36dp on
 * its 2dp lip, the sm button's 16dp glyph, a 48dp touch target; a spinner
 * of the same size in it while the story starts or waits for data), and a 3dp progress line along
 * the bottom edge, drawn once the line is measured.
 *
 * The dock is not inside scrolling content, so both the card and the button
 * answer the touch at once (no press delay). The card sinks by exactly its
 * lip. The body's `onPress` (opening the player, a heavy mount) runs in the
 * frame after the press, so the sunk card is drawn first (LR-4,
 * `useNextFramePress`); the play button acts at once.
 */

import React, { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LIP, RADIUS, SPACE, Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { BUTTON_METRICS } from './buttonMetrics';
import { Icon } from './Icon';
import { PictureCover } from './PictureCover';
import type { CoverSubject } from './covers';
import { AnimatedFill, Spinner } from './feedback';
import type { AnimatedProgress } from './feedback';
import { SurfaceLevelProvider } from './SurfaceLevel';
import { Tactile, useNextFramePress, usePressSink } from './Tactile';
import { playedFraction, remainingMinutes } from '../../utils/playbackProgress';

export { playedFraction, remainingMinutes };

/** Lip under the card (the card lip of the scale). */
export const MINI_PLAYER_LIP = LIP.md;
/** Face of the card: the 44dp cover with 8dp above and below. */
export const MINI_PLAYER_CARD_HEIGHT = 60;
/** Height of the card, lip included. */
export const MINI_PLAYER_HEIGHT = MINI_PLAYER_CARD_HEIGHT + MINI_PLAYER_LIP;
/** What the dock takes above the tab bar: the card on its lip and the 4dp gap to the bar. */
export const MINI_PLAYER_DOCK_HEIGHT = MINI_PLAYER_HEIGHT + SPACE.xs;

const COVER_SIZE = 44;
/** The play button: a sm button's face (36dp), so its glyph is a sm button's (16dp). */
export const MINI_PLAYER_TOGGLE_SIZE = BUTTON_METRICS.sm.height;
const TOGGLE_SIZE = MINI_PLAYER_TOGGLE_SIZE;
/** The play / pause glyph: the icon of a sm button on the icon scale (24 / 20 / 16). */
export const MINI_PLAYER_GLYPH = BUTTON_METRICS.sm.icon;
/** Touch slop that brings the button and its lip to the 48dp target. */
const TOGGLE_SLOP = (48 - TOGGLE_SIZE - LIP.sm) / 2;
/** Thickness of the progress line. */
const LINE = 3;
/** The spinner that replaces the play / pause glyph while busy. */
export const MINI_PLAYER_BUSY_SPINNER = MINI_PLAYER_GLYPH;

export interface MiniPlayerBarProps {
  story: CoverSubject;
  title: string;
  /** Narrator name for "X anlatıyor"; omitted when unknown. */
  narratorName?: string | null;
  /** The parent's own (cloned) voice tells the story: the wave takes its colour. */
  ownVoice?: boolean;
  /** Position and length, for a caller without the shared progress value. */
  positionMs?: number;
  durationMs?: number;
  /**
   * The loaded story: the shared native-driven progress value, which glides
   * between the player's reports. Wins over `positionMs` for the line.
   */
  progress?: AnimatedProgress;
  /** Whole minutes left, when the caller already knows them (the loaded story). */
  minutesLeft?: number | null;
  isPlaying: boolean;
  /** The story starts or waits for data: the button spins (it stays pressable). */
  busy?: boolean;
  onPress: () => void;
  onTogglePlay: () => void;
}

export const MiniPlayerBar: React.FC<MiniPlayerBarProps> = ({
  story,
  title,
  narratorName,
  ownVoice,
  positionMs = 0,
  durationMs = 0,
  progress,
  minutesLeft,
  isPlaying,
  busy = false,
  onPress,
  onTogglePlay,
}) => {
  const T = useT();
  const { t } = useTranslation('nav');
  const styles = stylesFor(T);
  // Nothing is drawn on the line until it reports its width (the first
  // layout, in the first frame), so the fill never runs ahead of the story.
  const [trackWidth, setTrackWidth] = useState(0);
  const { translateY, onPressIn, onPressOut } = usePressSink(MINI_PLAYER_LIP);
  const open = useNextFramePress(onPress);

  const minutes =
    minutesLeft !== undefined ? minutesLeft : remainingMinutes(positionMs, durationMs);
  const hasRemaining = minutes != null && minutes > 0;
  // "X anlatıyor" only while it plays; paused, the card says so.
  const subtitle = !isPlaying
    ? hasRemaining
      ? t('miniPlayer.pausedRemaining', { minutes })
      : t('miniPlayer.paused')
    : narratorName && hasRemaining
      ? t('miniPlayer.narratorRemaining', { name: narratorName, minutes })
      : narratorName
        ? t('miniPlayer.narrator', { name: narratorName })
        : hasRemaining
          ? t('miniPlayer.remaining', { minutes })
          : '';

  return (
    <SurfaceLevelProvider level="surface2">
      <View style={styles.wrap} testID="mini-player">
        <View style={styles.lip} testID="mini-player-lip" />
        <Animated.View style={[styles.card, { transform: [{ translateY }] }]} testID="mini-player-card">
          <Pressable
            onPress={open}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            unstable_pressDelay={0}
            accessibilityRole="button"
            accessibilityLabel={t('miniPlayer.open', { title })}
            testID="mini-player-open"
            style={styles.main}
          >
            <PictureCover story={story} width={COVER_SIZE} shape="square" radius={RADIUS.sm} flat />
            <View style={styles.text}>
              <Text numberOfLines={1} style={styles.title}>
                {title}
              </Text>
              {subtitle ? (
                <View style={styles.subtitleRow}>
                  <Icon name="wave" size={14} color={ownVoice ? T.own : T.text3} testID="mini-player-wave" />
                  <Text numberOfLines={1} style={styles.subtitle}>
                    {subtitle}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
          <Tactile
            color={T.action}
            lipColor={T.actionLip}
            lip={LIP.sm}
            radius={TOGGLE_SIZE / 2}
            onPress={onTogglePlay}
            pressDelay={0}
            hitSlop={{ top: TOGGLE_SLOP, bottom: TOGGLE_SLOP, left: TOGGLE_SLOP, right: TOGGLE_SLOP }}
            accessibilityLabel={isPlaying ? t('common:a11y.pause') : t('common:a11y.play')}
            accessibilityState={{ busy }}
            testID="mini-player-toggle"
            style={styles.toggle}
            faceStyle={styles.toggleFace}
          >
            {busy ? (
              <Spinner size={MINI_PLAYER_BUSY_SPINNER} color={T.onAction} testID="mini-player-busy" />
            ) : (
              <Icon name={isPlaying ? 'pause' : 'play'} size={MINI_PLAYER_GLYPH} color={T.onAction} />
            )}
          </Tactile>
          <View
            testID="mini-player-track"
            style={styles.progressTrack}
            onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}
          >
            {progress ? (
              <AnimatedFill
                progress={progress}
                trackWidth={trackWidth}
                height={LINE}
                radius={LINE / 2}
                color={T.action}
                testID="mini-player-progress"
              />
            ) : trackWidth > 0 ? (
              <View
                testID="mini-player-progress"
                style={[styles.progressFill, { width: trackWidth * playedFraction(positionMs, durationMs) }]}
              />
            ) : null}
          </View>
        </Animated.View>
      </View>
    </SurfaceLevelProvider>
  );
};

const makeStyles = (T: Theme) => {
  const text = textStylesFor(T);
  return StyleSheet.create({
    wrap: { marginHorizontal: T.screenPadH, paddingBottom: MINI_PLAYER_LIP },
    lip: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: MINI_PLAYER_LIP,
      bottom: 0,
      borderRadius: T.r.lg,
      backgroundColor: T.lip,
    },
    card: {
      minHeight: MINI_PLAYER_CARD_HEIGHT,
      borderRadius: T.r.lg,
      backgroundColor: T.surface2,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: T.space.sm,
      paddingRight: T.space.sm,
      overflow: 'hidden',
    },
    main: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: T.space.md,
      paddingVertical: T.space.sm,
    },
    text: { flex: 1, minWidth: 0 },
    title: text.label,
    subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs, marginTop: T.space.xxs },
    subtitle: { ...text.meta, color: T.text2, flexShrink: 1 },
    toggle: { marginLeft: T.space.sm },
    toggleFace: { width: TOGGLE_SIZE, height: TOGGLE_SIZE, alignItems: 'center', justifyContent: 'center' },
    progressTrack: {
      position: 'absolute',
      left: T.space.lg,
      right: T.space.lg,
      bottom: T.space.xs,
      height: LINE,
      borderRadius: LINE / 2,
      backgroundColor: T.line,
      overflow: 'hidden',
    },
    progressFill: { height: LINE, borderRadius: LINE / 2, backgroundColor: T.action },
  });
};

const stylesFor = themedStyles(makeStyles);
