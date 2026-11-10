/**
 * AudioPlayerScreen (design v4 playful, frame d "Oynatıcı").
 *
 * The cover, heavily blurred, glows behind the top of the screen and fades
 * into the canvas. Over it: the glass top bar (close, "Şimdi dinleniyor" or
 * the place in the queue and the category, the queue button), the artwork on
 * its lip, the Baloo 2 title (a link to the story page), the narrator line (a
 * wave dot in the own-voice colour when the parent's own voice reads), the
 * fat progress track with its knob, the times, the transport (15 seconds
 * back, play / pause, 15 seconds forward; previous and next at the sides
 * while the story plays from a queue of two or more) and two option tiles:
 * the sleep timer and the playback speed.
 *
 * The artwork grows with the height of the phone (`playerArtSize`) and the
 * gaps between the blocks share what is left, so a tall phone has no empty
 * band under the tiles and a 360 x 640 one scrolls a little. A story that
 * ended with nothing after it shows the end card above the tiles: "Baştan
 * dinle" and, when the queue or the home shelf has one, the next story; the
 * artwork gives up the card's height meanwhile, so the tiles stay on screen.
 *
 * Everything is derived from the audio store (SPEC-audio 5.1): the screen
 * keeps no copy of the narration. It opens at once for the loaded story and
 * for every narration whose metadata is known (a row, a card, the queue, the
 * story page); only a narration nothing is known about (a push tap) shows
 * the loading line while it is fetched. The title, the cover and the
 * narrator come from the store only while it holds the route's narration,
 * so a switch never shows the previous story. The store plays the queue on
 * by itself; when it starts another narration the screen follows with
 * `setParams` (never a replace, so nothing remounts).
 *
 * Every colour comes from the palette (`useT()`).
 *
 * The first frame (which the enter transition waits for) holds only what the
 * player needs to be used. The blurred glow and the two sheets come once the
 * transition has ended (`transitionEnd`, or `PLAYER_ENTER_FALLBACK_MS` without
 * one); the glow fades in where it always is, so nothing moves. A tile
 * pressed before that mounts the sheets at once (LR-4).
 *
 * Route: `AudioPlayer: { narrationId: string; autoplay?: boolean }`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { comparer, observable, reaction, runInAction, type IObservableValue } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useIsFocused, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LIP, SCREEN_PAD_H, SPACE, Theme, makeTextStyles, themedStyles, useT } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { DURATION, animateTo, useReducedMotion } from '../../theme/motion';
import { useAudioPlayer, type LoadError, type NarrationMeta } from '../../hooks/useAudioPlayer';
import sleepTimerService from '../../services/SleepTimerService';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { openStoryDetail } from '../../navigation/openStory';
import { Button } from '../../components/design/Button';
import { Card } from '../../components/design/cards';
import { Icon, IconName } from '../../components/design/Icon';
import { IconButton, StateIcon } from '../../components/design/rows';
import { PictureCover } from '../../components/design/PictureCover';
import { LoadingLine } from '../../components/design/Skeleton';
import { Tactile, usePressTint } from '../../components/design/Tactile';
import { Spinner } from '../../components/design/feedback';
import { resolveCover } from '../../components/design/covers';
import { SpeedSheet } from '../../components/audio/SpeedSheet';
import { OPTION_TILE, OptionTile, TimerTile, optionTileStylesFor } from '../../components/audio/TimerTile';
import { PlayerTimerSheet } from '../../components/audio/PlayerTimerSheet';
import { queueButtonLabel } from '../../components/audio/QueueSheet';
import { formatRemainingAtSpeed, formatSpeed } from '../../components/audio/playerMath';
import { getStoryStore } from '../../hooks/useStory';
import { getSubscriptionStore } from '../../hooks/useSubscription';
import { getNarrationMeta, type PlayerStory } from '../../stores/narrationMeta';
import { queueStore } from '../../stores/QueueStore';
import { queueSheet } from '../../stores/queueSheet';
import { PREVIOUS_RESTART_MS, playNext, playPrevious, playQueueFrom } from '../../stores/queuePlayback';
import { formatClock } from '../../utils/time';
import { storyShelfLabel } from '../../utils/storyLabels';
import { playbackProgress } from '../../utils/playbackProgress';
import { knownNarrationDurationMs } from '../../utils/narrationDurations';
import { NextUp, nextAfterStory } from './playerEnd';
import { contentNoteText } from '../../models/contentWarnings';
import { takeContentNotice } from '../../utils/contentNotice';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const SCREEN_W = Dimensions.get('window').width;

/** The transport's skip buttons, in seconds (the back15 / fwd15 glyphs). */
export const SKIP_SECONDS = 15;

/**
 * The glow and the sheets wait for the end of the player's enter transition,
 * or this long for a player shown without one.
 */
export const PLAYER_ENTER_FALLBACK_MS = 1000;

/** The blurred cover behind the top: it bleeds 40dp past the edges and ends 430dp down. */
const GLOW_BLEED = 40;
const GLOW_HEIGHT = 470;
/** Where the glow ends; its fade reaches the solid canvas exactly there (no seam). */
const GLOW_BOTTOM = GLOW_HEIGHT - GLOW_BLEED;

/** The fat progress track and its knob. */
export const TRACK_HEIGHT = 12;
export const KNOB_SIZE = 24;
const KNOB_LIP = LIP.sm;
/** Grabbing the knob grows it by this much (`DURATION.fast`). */
export const KNOB_GRAB_SCALE = 1.15;
/** The touch area of the track (its height); the track sits in its middle. */
const SEEK_TOUCH = 44;

/** Transport sizes (SPEC-audio 9): play 80 on the 4dp lip, skips 56, previous / next 40. */
export const PLAY_SIZE = 80;
const PLAY_GLYPH = 34;
const PLAY_SPINNER = 28;
export const SKIP_SIZE = 56;
const SKIP_GLYPH = 28;
const SIDE_SIZE = 40;
/** Previous and next are 40 wide: the slop brings their target to 48. */
const SIDE_HIT_SLOP = { left: 4, right: 4 };
/** Size of the narrator line's wave dot. */
const BY_DOT = 22;

/** Width the transport can take (the content is padded by the gutter on each side). */
const ROW_WIDTH = SCREEN_W - 2 * SCREEN_PAD_H;

/** Artwork of the mockup: 236 x 290 (this ratio), radius 32, on its cover lip. */
const ART_RATIO = 290 / 236;
/** The artwork never gets narrower than this (it scrolls instead) nor wider than that. */
export const ART_MIN_WIDTH = 170;
export const ART_MAX_WIDTH = 340;
/** It keeps at least this much canvas on each side. */
const ART_SIDE_MIN = 56;
/** Height of the glass top bar (a 44dp button on its 2dp lip) and of one title line. */
const TOP_BAR_HEIGHT = 44 + LIP.sm;
const TITLE_LINE = 34;
const TIME_LINE = 17;

/**
 * Everything on the screen but the artwork, at font scale 1 with a one-line
 * title (dp), from the styles below. 418dp.
 */
export const PLAYER_CHROME_HEIGHT = [
  SPACE.sm + TOP_BAR_HEIGHT, // top padding, the bar
  SPACE.lg + LIP.lg, // the art's margin and its lip
  SPACE.lg + TITLE_LINE, // the title
  SPACE.xs + BY_DOT, // the narrator line
  SPACE.md + SEEK_TOUCH, // the track
  -SPACE.sm + TIME_LINE, // the times, pulled up under the track
  SPACE.md + PLAY_SIZE + LIP.lg, // the transport
  SPACE.lg + OPTION_TILE.minHeight + LIP.md, // the option tiles
  SPACE.xxl, // the end padding
].reduce((sum, part) => sum + part, 0);

/**
 * The artwork's size for a window (NP-21): as large as the height left by
 * the rest of the player allows, within the side margins and the bounds. A
 * 360 x 640 phone keeps the smallest size and scrolls a little; a tall phone
 * grows the art until the side margins stop it, and the few dp that remain
 * are shared out between the blocks (the screen's flexible gaps), so nothing
 * leaves an empty band under the tiles.
 */
export function playerArtSize(
  windowWidth: number,
  windowHeight: number,
  insetTop: number,
  insetBottom: number,
  /** Height of a block shown besides the usual ones (the end card, RC-3). */
  reserved = 0,
): { width: number; height: number } {
  const room = (windowHeight - insetTop - insetBottom - PLAYER_CHROME_HEIGHT - Math.max(0, reserved)) / ART_RATIO;
  const width = Math.floor(
    Math.max(ART_MIN_WIDTH, Math.min(ART_MAX_WIDTH, windowWidth - 2 * ART_SIDE_MIN, room)),
  );
  return { width, height: Math.floor(width * ART_RATIO) };
}

/**
 * The end card's height with its margin, at font scale 1, until it has been
 * measured (RC-3): the ring and the lip of the card, its padding, the row
 * with "Baştan dinle" (a sm button on its lip) and, with a next story, the
 * divided row under it. 85dp alone, 148dp with the next story.
 */
export function playerEndCardEstimate(withNext: boolean): number {
  const smButton = 36 + LIP.sm;
  const card = 2 * 2 + 2 * SPACE.md + smButton + LIP.md;
  const next = withNext ? SPACE.md + SPACE.md + 1 + smButton : 0;
  return SPACE.lg + card + next;
}

/** Skip button size and gap: 56 / 24 alone, 8 apart with previous and next. */
export function transportLayout(withQueue: boolean, rowWidth: number = ROW_WIDTH): { skip: number; gap: number } {
  if (!withQueue) {
    const gap = SPACE.xxl;
    const skip = Math.min(SKIP_SIZE, Math.floor((rowWidth - PLAY_SIZE - 2 * gap) / 2));
    return { skip, gap };
  }
  const gap = SPACE.sm;
  const skip = Math.min(SKIP_SIZE, Math.floor((rowWidth - PLAY_SIZE - 2 * SIDE_SIZE - 4 * gap) / 2));
  return { skip: Math.max(48, skip), gap };
}

/** Previous restarts the story from this many whole seconds on (`playPrevious`). */
const PREVIOUS_RESTART_SECONDS = PREVIOUS_RESTART_MS / 1000;

/** What the screen draws for its narration, from the store or from the meta. */
interface RouteView {
  story: PlayerStory | null;
  storyId: string | null;
  narratorName: string | null;
  ownVoice: boolean;
}

/** The meta of a narration: remembered by the app, else its queue entry. */
function knownMeta(narrationId: string): NarrationMeta | null {
  if (!narrationId) return null;
  return (
    getNarrationMeta(narrationId) ?? queueStore.entries.find(entry => entry.narrationId === narrationId) ?? null
  );
}

// ─────────────────────────────────────────────────────────────
// Progress track (`.track`): line track, action fill, knob on its lip
// ─────────────────────────────────────────────────────────────

interface SeekTrackProps {
  /**
   * Played fraction, 0 to 1, animated on the native driver (see
   * `utils/playbackProgress`). The track never re-renders for a tick.
   */
  progress: Animated.Value;
  /** The route's story is in the player and its length is known. */
  seekable: boolean;
  onSeekFraction: (fraction: number) => void;
  accessibilityLabel: string;
  accessibilityValueText: string;
  onStep: (direction: 1 | -1) => void;
  styles: PlayerStyles;
}

const SeekTrack: React.FC<SeekTrackProps> = ({
  progress,
  seekable,
  onSeekFraction,
  accessibilityLabel,
  accessibilityValueText,
  onStep,
  styles,
}) => {
  // Real pixel width from layout, for accurate knob positioning.
  const [trackW, setTrackW] = useState(ROW_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  // The finger's position while scrubbing: its own native value, so a drag
  // moves the knob without a React render per move.
  const dragProgress = useRef(new Animated.Value(0)).current;
  // The knob grows while it is held, in `DURATION.fast` on the native driver.
  const grab = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();

  // Latest props for the responder, which is created once.
  const latest = useRef({ onSeekFraction, trackW, reduced, seekable });
  useEffect(() => {
    latest.current = { onSeekFraction, trackW, reduced, seekable };
  }, [onSeekFraction, trackW, reduced, seekable]);

  // The track is centred (equal side padding), so its left edge follows
  // from its width. The knob's centre travels from half a knob in to half a
  // knob before the end, so the fraction is measured on that travel: the
  // knob stays under the finger, also at the ends.
  const fractionAt = (pageX: number) => {
    const w = latest.current.trackW;
    const left = (SCREEN_W - w) / 2;
    const travel = Math.max(1, w - KNOB_SIZE);
    return Math.min(1, Math.max(0, (pageX - left - KNOB_SIZE / 2) / travel));
  };

  const pan = useRef(
    PanResponder.create({
      // Nothing to scrub before the story is in the player and its length is
      // known: the knob would follow the finger and jump back on release.
      onStartShouldSetPanResponder: () => latest.current.seekable,
      onMoveShouldSetPanResponder: () => latest.current.seekable,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: evt => {
        dragProgress.setValue(fractionAt(evt.nativeEvent.pageX));
        setIsDragging(true);
        animateTo(grab, 1, 'fast', latest.current.reduced);
      },
      onPanResponderMove: evt => {
        dragProgress.setValue(fractionAt(evt.nativeEvent.pageX));
      },
      onPanResponderRelease: evt => {
        // Seek first: the shared value jumps to the target before the track
        // goes back to showing it, so the knob never flashes back.
        latest.current.onSeekFraction(fractionAt(evt.nativeEvent.pageX));
        setIsDragging(false);
        animateTo(grab, 0, 'fast', latest.current.reduced);
      },
      onPanResponderTerminate: () => {
        setIsDragging(false);
        animateTo(grab, 0, 'fast', latest.current.reduced);
      },
    }),
  ).current;

  useEffect(() => () => grab.stopAnimation(), [grab]);

  const shown = isDragging ? dragProgress : progress;
  // Transforms only, so the native driver can run them: the fill is as wide
  // as the track and slides in from the left inside the clipped track; the
  // knob travels inside the track's ends, so it never overhangs the gutter.
  const { fillX, knobX } = useMemo(() => {
    const w = Math.max(1, trackW);
    return {
      fillX: shown.interpolate({ inputRange: [0, 1], outputRange: [-w, 0], extrapolate: 'clamp' }),
      knobX: shown.interpolate({
        inputRange: [0, 1],
        outputRange: [0, Math.max(0, w - KNOB_SIZE)],
        extrapolate: 'clamp',
      }),
    };
  }, [shown, trackW]);
  const knobScale = useMemo(
    () => grab.interpolate({ inputRange: [0, 1], outputRange: [1, KNOB_GRAB_SCALE] }),
    [grab],
  );

  return (
    <View
      style={styles.seek}
      onLayout={e => setTrackW(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: accessibilityValueText }}
      accessibilityState={{ disabled: !seekable }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => {
        if (event.nativeEvent.actionName === 'increment') onStep(1);
        if (event.nativeEvent.actionName === 'decrement') onStep(-1);
      }}
      testID="player-seek"
      {...pan.panHandlers}
    >
      <View pointerEvents="none" style={styles.track} testID="player-seek-track">
        <Animated.View
          testID="player-seek-fill"
          style={[styles.trackFill, { width: trackW, transform: [{ translateX: fillX }] }]}
        />
      </View>
      {/* The travel and the grab on two layers: the grab's native value never
          reaches the shared progress value. */}
      <Animated.View
        pointerEvents="none"
        testID="player-seek-knob"
        style={[styles.knobWrap, { left: 0, transform: [{ translateX: knobX }] }]}
      >
        <Animated.View testID="player-seek-knob-grab" style={[styles.knobGrab, { transform: [{ scale: knobScale }] }]}>
          <View style={styles.knobLip} testID="player-seek-knob-lip" />
          <View style={styles.knob} testID="player-seek-knob-face" />
        </Animated.View>
      </Animated.View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// Small observers of the playback position
//
// Each reads the store's computed whole-second position, so it re-renders
// once a second on its own; the screen around them does not.
// ─────────────────────────────────────────────────────────────

/** A progress that stays at the start: the route's narration is not in the player yet. */
const IDLE_PROGRESS = new Animated.Value(0);

interface PlayerSeekBarProps {
  /** The store holds the route's narration: the track follows it. */
  active: boolean;
  /** Real length of the route's narration while it is not loaded (0 = unknown). */
  idleDurationSec: number;
  onSeekFraction: (fraction: number) => void;
  onStep: (direction: 1 | -1) => void;
  styles: PlayerStyles;
}

/** The progress track and the two clock labels under it. */
const PlayerSeekBar: React.FC<PlayerSeekBarProps> = observer(
  ({ active, idleDurationSec, onSeekFraction, onStep, styles }) => {
    const audioPlayer = useAudioPlayer();
    const { t } = useTranslation('player');
    const position = active ? audioPlayer.positionSeconds : 0;
    const elapsedLabel = formatClock(position);
    const remainingLabel = active
      ? formatRemainingAtSpeed(position, audioPlayer.totalDuration, audioPlayer.playbackSpeed)
      : formatRemainingAtSpeed(0, idleDurationSec, 1);
    return (
      <>
        <SeekTrack
          progress={active ? playbackProgress.progress : IDLE_PROGRESS}
          seekable={active && audioPlayer.totalDuration > 0}
          onSeekFraction={onSeekFraction}
          accessibilityLabel={t('a11y.seek')}
          accessibilityValueText={t('a11y.position', {
            elapsed: elapsedLabel,
            remaining: remainingLabel.replace('-', ''),
          })}
          onStep={onStep}
          styles={styles}
        />
        <View style={styles.timeRow}>
          <Text style={styles.timeLabel} testID="player-time-elapsed">
            {elapsedLabel}
          </Text>
          <Text style={styles.timeLabel} testID="player-time-remaining">
            {remainingLabel}
          </Text>
        </View>
      </>
    );
  },
);

/**
 * Previous: a story more than 5 s in starts over, else the previous queue
 * entry starts. Only the first entry within its first 5 s has nowhere to go.
 * Its own observer, so the second-by-second position re-renders this button
 * only.
 */
const PreviousButton: React.FC<{ active: boolean; first: boolean; onPress: () => void; label: string }> =
  observer(({ active, first, onPress, label }) => {
    const audioPlayer = useAudioPlayer();
    const restarts = active && audioPlayer.positionSeconds >= PREVIOUS_RESTART_SECONDS;
    return (
      <IconButton
        icon="prev"
        onPress={onPress}
        disabled={first && !restarts}
        hitSlop={SIDE_HIT_SLOP}
        pressDelay={0}
        accessibilityLabel={label}
        testID="player-previous"
        style={{ width: SIDE_SIZE }}
      />
    );
  });

// ─────────────────────────────────────────────────────────────
// Transport buttons
// ─────────────────────────────────────────────────────────────

const RoundButton: React.FC<{
  icon: IconName;
  size: number;
  glyph: number;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
  T: Theme;
}> = ({ icon, size, glyph, onPress, accessibilityLabel, testID, T }) => (
  <Tactile
    color={T.surface}
    lipColor={T.lip}
    lip={LIP.md}
    radius={size / 2}
    pressDelay={0}
    onPress={onPress}
    accessibilityLabel={accessibilityLabel}
    testID={testID}
    faceStyle={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
  >
    <Icon name={icon} size={Math.min(glyph, Math.round(size * 0.5))} color={T.text} />
  </Tactile>
);

/** The title, a link to the story page: lip-less, so it dims while pressed. */
const TitleLink: React.FC<{
  title: string;
  onPress?: () => void;
  hint: string;
  styles: PlayerStyles;
}> = ({ title, onPress, hint, styles }) => {
  const { opacity, onPressIn, onPressOut } = usePressTint(!onPress);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={!onPress}
      accessibilityRole="link"
      accessibilityLabel={title}
      accessibilityHint={onPress ? hint : undefined}
      testID="player-title"
      style={styles.titleWrap}
    >
      <Animated.Text style={[styles.title, { opacity }]} numberOfLines={2}>
        {title}
      </Animated.Text>
    </Pressable>
  );
};

/**
 * The end of a story that nothing followed (NP-18): "Baştan dinle", and the
 * next story when the queue or the home shelf has one. A queued story plays
 * at once; a shelf tale opens its page (a narrator is picked there).
 */
const StoryEndCard: React.FC<{
  next: NextUp | null;
  onRestart: () => void;
  onNext: () => void;
  styles: PlayerStyles;
}> = ({ next, onRestart, onNext, styles }) => {
  const { t } = useTranslation('player');
  const nextTitle = next?.title || t('untitled');
  return (
    <Card testID="player-end" style={styles.endCard} contentStyle={styles.endFace}>
      <View style={styles.endRow}>
        <Text style={styles.endTitle} accessibilityLiveRegion="polite" testID="player-end-title">
          {t('end.title')}
        </Text>
        <Button
          label={t('end.restart')}
          icon="restart"
          size="sm"
          // The one way on without a next story; beside one, the quieter choice.
          variant={next ? 'secondary' : 'primary'}
          onPress={onRestart}
          testID="player-end-restart"
        />
      </View>
      {next ? (
        <View style={styles.endNext} testID="player-end-next">
          <View style={styles.endNextText}>
            <Text style={styles.endCaption}>{t('end.nextCaption')}</Text>
            <Text style={styles.endNextTitle} numberOfLines={1} testID="player-end-next-title">
              {nextTitle}
            </Text>
          </View>
          <Button
            label={next.kind === 'queue' ? t('end.playNext') : t('end.openNext')}
            icon={next.kind === 'queue' ? 'play' : undefined}
            size="sm"
            onPress={onNext}
            accessibilityLabel={t(next.kind === 'queue' ? 'end.playNextA11y' : 'end.openNextA11y', {
              title: nextTitle,
            })}
            testID="player-end-next-action"
          />
        </View>
      ) : null}
    </Card>
  );
};

// ─────────────────────────────────────────────────────────────
// After the enter: the glow and the sheets
// ─────────────────────────────────────────────────────────────

type GlowSource = React.ComponentProps<typeof ExpoImage>['source'];

/**
 * The cover, heavily blurred, behind the top of the screen. It comes once the
 * enter transition has ended (`entered`) and fades in over `DURATION.enter`
 * (a cover cached in memory would otherwise pop in); it is absolutely placed,
 * so nothing moves when it comes. A later track's cover cross-fades in the
 * image itself (`transition`).
 */
const PlayerGlow: React.FC<{ entered: IObservableValue<boolean>; source: GlowSource; styles: PlayerStyles }> =
  observer(({ entered, source, styles }) => {
    const reduced = useReducedMotion();
    const fade = useRef(new Animated.Value(0)).current;
    const shown = entered.get();
    useEffect(() => {
      if (shown) animateTo(fade, 1, 'enter', reduced, { fade: true });
    }, [shown, fade, reduced]);
    useEffect(() => () => fade.stopAnimation(), [fade]);
    if (!shown) return null;
    return (
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} testID="player-glow-layer">
        {source ? (
          <ExpoImage
            testID="player-glow"
            source={source}
            blurRadius={42}
            contentFit="cover"
            transition={DURATION.base}
            style={styles.glow}
          />
        ) : null}
      </Animated.View>
    );
  });

interface PlayerSheetsProps {
  entered: IObservableValue<boolean>;
  timerOpen: boolean;
  onCloseTimer: () => void;
  speedOpen: boolean;
  onCloseSpeed: () => void;
  title: string;
}

/**
 * The timer and the speed sheet, mounted once the enter has ended (a tile
 * pressed sooner sets `entered` first). They stay mounted from then on, so
 * every close plays its exit.
 */
const PlayerSheets: React.FC<PlayerSheetsProps> = observer(
  ({ entered, timerOpen, onCloseTimer, speedOpen, onCloseSpeed, title }) => {
    const audioPlayer = useAudioPlayer();
    const changeSpeed = useCallback(
      (next: number) => {
        void audioPlayer.setSpeed(next);
      },
      [audioPlayer],
    );
    const changeForAll = useCallback(
      (enabled: boolean) => audioPlayer.setSpeedForAllStories(enabled),
      [audioPlayer],
    );
    if (!entered.get()) return null;
    return (
      <>
        <PlayerTimerSheet visible={timerOpen} onClose={onCloseTimer} currentTitle={title} />
        <SpeedSheet
          visible={speedOpen}
          onClose={onCloseSpeed}
          speed={audioPlayer.playbackSpeed}
          forAllStories={audioPlayer.speedForAllStories}
          onSpeedChange={changeSpeed}
          onForAllStoriesChange={changeForAll}
        />
      </>
    );
  },
);

// ─────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────

type AudioPlayerRoute = RouteProp<RootStackParamList, 'AudioPlayer'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

const AudioPlayerScreen: React.FC = observer(() => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<AudioPlayerRoute>();
  const audioPlayer = useAudioPlayer();
  const insets = useSafeAreaInsets();
  const windowSize = useWindowDimensions();
  const focused = useIsFocused();
  const T = useT();
  const { t } = useTranslation('player');
  const styles = stylesFor(T);

  const narrationId = route.params?.narrationId ?? '';
  const autoplayParam = !!route.params?.autoplay;

  /**
   * The narration the store's current failure is about. A start that fails
   * before its stream reaches the player leaves the previous story loaded
   * next to the store's `loadError`, so the error alone does not say whose
   * it is: a failed start belongs to the narration it started, any other
   * failure (a stream that never sounded, a refresh that answered 404) to
   * the loaded story.
   */
  const [failure, setFailure] = useState<{ id: string; error: LoadError } | null>(null);
  const [timerSheetOpen, setTimerSheetOpen] = useState(false);
  const [speedSheetOpen, setSpeedSheetOpen] = useState(false);
  // The end card as drawn (with its margin), for the art's room.
  const [endMeasured, setEndMeasured] = useState<{ withNext: boolean; height: number } | null>(null);

  // The enter transition has ended: the glow and the sheets may come. An
  // observable, so only those two re-render for it, not the screen.
  const [entered] = useState(() => observable.box(false));
  useEffect(() => {
    if (entered.get()) return;
    const done = () => runInAction(() => entered.set(true));
    const unsubscribe = navigation.addListener('transitionEnd', event => {
      if (!event.data?.closing) done();
    });
    const fallback = setTimeout(done, PLAYER_ENTER_FALLBACK_MS);
    return () => {
      unsubscribe();
      clearTimeout(fallback);
    };
  }, [entered, navigation]);

  // A tile that is pressed before the enter ended mounts the sheets at once.
  const openTimerSheet = useCallback(() => {
    runInAction(() => entered.set(true));
    setTimerSheetOpen(true);
  }, [entered]);
  const openSpeedSheet = useCallback(() => {
    runInAction(() => entered.set(true));
    setSpeedSheetOpen(true);
  }, [entered]);
  const closeTimerSheet = useCallback(() => setTimerSheetOpen(false), []);
  const closeSpeedSheet = useCallback(() => setSpeedSheetOpen(false), []);

  // The sleep timer's remembered choices (fade-out, last mode, last duration,
  // last story count) come from the preferences; the session bridge attaches
  // the player to it.
  useEffect(() => {
    void sleepTimerService.initialize();
  }, []);

  // ─── What the store says about the route's narration ───

  /** The store holds this narration (also while its stream still loads). */
  const storeOwns = !!narrationId && audioPlayer.isStoryLoaded && audioPlayer.audioId === narrationId;
  /** A start of this narration runs. */
  const starting = !!narrationId && audioPlayer.pendingNarrationId === narrationId;
  const meta = storeOwns ? null : knownMeta(narrationId);

  const view: RouteView | null = storeOwns
    ? {
        story: audioPlayer.currentStory,
        storyId: audioPlayer.currentStory?.id ?? null,
        narratorName: audioPlayer.currentNarratorName,
        ownVoice: audioPlayer.currentOwnVoice,
      }
    : meta
      ? {
          story: meta.story,
          storyId: meta.storyId || meta.story.id || null,
          narratorName: meta.narratorName,
          ownVoice: meta.ownVoice,
        }
      : null;

  // The failure the store holds now (none while a start or a reload runs)
  // and whether it is this narration's: only the loaded story's stream can
  // fail, a failed start or refresh is the one recorded for it.
  const storeError: LoadError | null = audioPlayer.loadPhase === 'failed' ? audioPlayer.loadError : null;
  const ownsError =
    storeError === 'streamFailed'
      ? storeOwns
      : !!storeError && failure?.id === narrationId && failure.error === storeError;
  const routeError: LoadError | null = !narrationId ? 'notFound' : ownsError ? storeError : null;

  // Who failed, recorded as it happens (also for starts made elsewhere: a
  // queue sheet row, the store's advance). Created before the start effect
  // below, so it sees that start.
  useEffect(
    () =>
      reaction(
        () => ({
          phase: audioPlayer.loadPhase,
          error: audioPlayer.loadError,
          pending: audioPlayer.pendingNarrationId,
          loaded: audioPlayer.isStoryLoaded ? audioPlayer.audioId : '',
        }),
        (now, before) => {
          if (now.phase !== 'failed' || !now.error) return;
          if (before.phase === 'failed' && before.error === now.error) return;
          const id = before.pending ?? now.loaded;
          if (id) setFailure({ id, error: now.error });
        },
        { equals: comparer.structural },
      ),
    [audioPlayer],
  );

  // ─── Starting the narration ───

  /** Start the route's narration, from its meta when one is known. */
  const startRouteNarration = useCallback(
    (autoplay: boolean) => {
      if (!narrationId) return;
      const id = narrationId;
      const known = knownMeta(id);
      audioPlayer
        .startNarration(known ? { narrationId: id, meta: known } : { narrationId: id }, { autoplay })
        .then(ok => {
          // A newer start that won also returns false; only a failure counts.
          const error = audioPlayer.loadError;
          if (!ok && error && audioPlayer.loadPhase === 'failed' && !audioPlayer.pendingNarrationId) {
            setFailure({ id, error });
          }
        })
        .catch(() => undefined);
    },
    [audioPlayer, narrationId],
  );

  // On mount and for every new narration of the route: start it unless the
  // store already holds it or is starting it, and honour `autoplay` once.
  // Decided at call time (not from render flags in the deps), so a store
  // change never runs it again.
  const handledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!narrationId) return;
    const fresh = handledRef.current !== narrationId;
    if (!fresh && !autoplayParam) return;
    handledRef.current = narrationId;
    const loadedNow = audioPlayer.isStoryLoaded && audioPlayer.audioId === narrationId;
    const startingNow = audioPlayer.pendingNarrationId === narrationId;
    if (!loadedNow && !startingNow) {
      startRouteNarration(autoplayParam);
    } else if (autoplayParam && !audioPlayer.isPlaying) {
      // Loaded (a finished story starts over) or still loading (the intent).
      void audioPlayer.play();
    }
    if (autoplayParam) navigation.setParams({ autoplay: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrationId, autoplayParam]);

  // Track changes without a remount: when the store starts another narration
  // (the queue went on, a row of the queue sheet), the open player follows.
  // Created once; the refs carry the current route and focus.
  const routeIdRef = useRef(narrationId);
  const focusedRef = useRef(focused);
  useEffect(() => {
    routeIdRef.current = narrationId;
    focusedRef.current = focused;
  }, [narrationId, focused]);
  useEffect(
    () =>
      reaction(
        () => ({ pending: audioPlayer.pendingNarrationId, loaded: audioPlayer.audioId }),
        (now, before) => {
          // A start that begins, or a story that took the player. A start that
          // failed leaves the old story in place: that is no track change.
          const id = now.pending ?? (now.loaded !== before.loaded ? now.loaded : null);
          if (!id || id === routeIdRef.current) return;
          if (focusedRef.current || queueStore.currentId === id) navigation.setParams({ narrationId: id });
        },
        { equals: comparer.structural },
      ),
    [audioPlayer, navigation],
  );

  // ─── Derived UI state ───

  // The position is NOT read here: the screen must not re-render on every
  // report of the player. The track follows the shared native-driven
  // progress value; the clock labels, the previous button, the timer tile and
  // the timer sheet are small observers of their own (above).
  const speed = audioPlayer.playbackSpeed;
  const story = view?.story ?? null;
  const title = story?.title || t('untitled');
  const storyId = view?.storyId ?? null;
  const categoryLabel = storyShelfLabel(story?.category);
  const idleDurationMs = storeOwns ? 0 : knownNarrationDurationMs(narrationId) ?? 0;

  // A story with content warnings says so under the title, the first time
  // this narration's player opens ("3-6 yaş için. Korkutucu bir sahne içeriyor.").
  const contentNote = contentNoteText(story?.ageGroup, story?.contentWarnings);
  const [noticeFor, setNoticeFor] = useState<string | null>(null);
  useEffect(() => {
    if (!narrationId || !contentNote) return;
    let live = true;
    void takeContentNotice(narrationId).then(first => {
      if (live && first) setNoticeFor(narrationId);
    });
    return () => {
      live = false;
    };
  }, [narrationId, contentNote]);
  const showContentNote = !!contentNote && noticeFor === narrationId;

  // The store's play state belongs to this narration only while it holds or
  // starts it (a sample may hold the player meanwhile).
  const mine = storeOwns || starting;
  const playing = mine && audioPlayer.isPlaying;
  const busy = mine && audioPlayer.isBusy;

  // Queue context: this narration is the queue's current entry.
  const queueEntries = queueStore.entries;
  const queueIndex = queueStore.currentId === narrationId ? queueStore.index : -1;
  const inQueue = queueIndex >= 0;
  const withSkips = inQueue && queueEntries.length >= 2;
  const hasNext = inQueue && !!queueStore.next;
  const queueCount = queueEntries.length;
  const transport = transportLayout(withSkips);
  const speedLabel = formatSpeed(speed, t('decimalSeparator'));

  // The story played to its end and nothing followed it (the store started
  // no next one): the end card offers it again, and the next story.
  const ended = storeOwns && !starting && audioPlayer.storyEnded && !audioPlayer.isPlaying;
  const nextUp: NextUp | null = ended
    ? nextAfterStory({
        narrationId,
        story,
        inQueue,
        queueNext: queueStore.next,
        queueEntries,
        shelf: story?.category ? getStoryStore()?.shelfByCategory.get(story.category) : null,
        locksPremium: !getSubscriptionStore().hasPremiumStories,
      })
    : null;

  // The end card makes room for itself (RC-3): the art gives up its height,
  // so the timer and speed tiles stay on screen. Measured once drawn, an
  // estimate in its first frame.
  const withNext = !!nextUp;
  const endRoom = ended
    ? endMeasured && endMeasured.withNext === withNext
      ? endMeasured.height
      : playerEndCardEstimate(withNext)
    : 0;
  const art = playerArtSize(windowSize.width, windowSize.height, insets.top, insets.bottom, endRoom);

  const glowSource = useMemo(() => {
    if (!story) return null;
    const cover = resolveCover(story);
    return cover.kind === 'remote' ? { uri: cover.uri, cacheKey: cover.cacheKey } : cover.source;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id, story?.translationGroupId, story?.coverImageUrl]);

  // ─── Actions ───

  const handleSeekFraction = (fraction: number) => {
    const duration = audioPlayer.totalDuration;
    if (!storeOwns || duration <= 0) return;
    const targetSeconds = Math.max(0, Math.min(duration, fraction * duration));
    // The store moves its position before the native seek, so the track and
    // the clock follow at once.
    void audioPlayer.seek(targetSeconds);
  };

  const handleRewind = () => {
    if (storeOwns) void audioPlayer.skipBackward(SKIP_SECONDS);
  };
  const handleForward = () => {
    if (storeOwns) void audioPlayer.skipForward(SKIP_SECONDS);
  };

  const handlePlay = () => {
    if (mine) {
      void audioPlayer.togglePlayPause();
      return;
    }
    // Something else holds the player (a sample took it): start this one.
    startRouteNarration(true);
  };

  const handlePrevious = () => {
    if (!storeOwns) {
      // The route's story is still starting (or a sample holds the player):
      // it is at its start, while the store's position is the last story's.
      const previous = queueStore.previous;
      if (previous) void playQueueFrom(previous.narrationId);
      return;
    }
    void playPrevious();
  };
  const handleNext = () => {
    if (hasNext) void playNext();
  };

  const openStory = storyId ? () => openStoryDetail(navigation, storyId) : undefined;

  // A play at the end starts the story over (the store seeks to 0 first).
  const handleRestart = () => {
    void audioPlayer.play();
  };
  const handleNextUp = () => {
    if (!nextUp) return;
    if (nextUp.kind === 'queue') {
      // The open player follows the start (setParams, above).
      void playQueueFrom(nextUp.entry.narrationId);
      return;
    }
    openStoryDetail(navigation, nextUp.storyId);
  };

  const retryInline = () => {
    if (storeOwns && routeError === 'streamFailed') {
      void audioPlayer.reloadStream();
      return;
    }
    startRouteNarration(true);
  };

  // ─── Render states ───

  const closeButton = (
    <IconButton
      icon="chevronDown"
      variant="glass"
      onPress={() => navigation.goBack()}
      accessibilityLabel={t('common:close')}
      testID="player-back"
    />
  );

  // Its audio was removed (story segments edited, cache cleared): no retry
  // can help, the story page creates it again.
  if (routeError === 'audioRemoved') {
    return (
      <View style={styles.root} testID="player-audio-removed">
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        <View style={[styles.topBar, styles.errorBar, { marginTop: insets.top + SPACE.sm }]}>{closeButton}</View>
        <View style={styles.centerFill}>
          <StateIcon icon="redo" />
          <Text style={styles.centerTitle}>{t('audioRemovedTitle')}</Text>
          <Text style={styles.centerText}>{t('audioRemovedMessage')}</Text>
          <View style={styles.centerGap} />
          {openStory ? (
            <Button
              label={t('recreate')}
              variant="primary"
              icon="redo"
              onPress={openStory}
              testID="player-recreate"
            />
          ) : null}
        </View>
      </View>
    );
  }

  const fullError = routeError === 'notFound' || (routeError === 'loadFailed' && !view);
  if (fullError) {
    return (
      <View style={styles.root} testID="player-error">
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        <View style={[styles.topBar, styles.errorBar, { marginTop: insets.top + SPACE.sm }]}>{closeButton}</View>
        <View style={styles.centerFill}>
          <StateIcon icon="alert" />
          <Text style={styles.centerTitle}>{t('common:errorState.title')}</Text>
          <Text style={styles.centerText}>{t(routeError ?? 'loadFailed')}</Text>
          <View style={styles.centerGap} />
          {narrationId ? (
            <Button
              label={t('common:retry')}
              variant="secondary"
              onPress={() => startRouteNarration(false)}
              testID="player-retry"
            />
          ) : null}
        </View>
      </View>
    );
  }

  if (!view) {
    // Nothing is known about this narration (a push tap): its fetch runs.
    return (
      <View style={styles.root} testID="player-loading">
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        {/* The way out stays where it is on the player, also while it loads. */}
        <View style={[styles.topBar, styles.errorBar, { marginTop: insets.top + SPACE.sm }]}>{closeButton}</View>
        <View style={styles.centerFill}>
          <LoadingLine label={t('loading')} direction="column" testID="player-loading-line" />
        </View>
      </View>
    );
  }

  const inlineError = routeError === 'streamFailed' || routeError === 'loadFailed';
  // One of the five gaps between the blocks: each takes an equal share of
  // the height left over (none when the content scrolls).
  const gap = <View style={styles.grow} pointerEvents="none" testID="player-gap" />;

  return (
    <View style={styles.root} testID="player-screen">
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* The cover glows behind the top of the screen and fades into the canvas. */}
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <PlayerGlow entered={entered} source={glowSource} styles={styles} />
        <LinearGradient
          testID="player-glow-fade"
          colors={[withAlpha(T.bg, 0.25), withAlpha(T.bg, 0.6), T.bg]}
          locations={[0, 0.55, 1]}
          style={styles.glowFade}
        />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + SPACE.sm, paddingBottom: insets.bottom + SPACE.xxl },
        ]}
        showsVerticalScrollIndicator={false}
        testID="player-scroll"
      >
        {/* Top bar. The gaps between the blocks below grow evenly with the
            height the art leaves (NP-21), so a tall phone has no empty band. */}
        <View style={styles.topBar}>
          {closeButton}
          <View style={styles.caption}>
            <Text style={styles.captionTop} numberOfLines={1} testID="player-caption">
              {inQueue ? t('queue.position', { index: queueIndex + 1, total: queueCount }) : t('nowPlaying')}
            </Text>
            {categoryLabel ? (
              <Text style={styles.captionMain} numberOfLines={1} testID="player-category">
                {categoryLabel}
              </Text>
            ) : null}
          </View>
          <IconButton
            icon="queue"
            variant="glass"
            badgeCount={queueCount}
            // The label says the count, so it is not repeated as the value.
            countInLabel
            onPress={() => queueSheet.open('player')}
            // "Sıradakiler" while empty, as the Library's button (RC-4).
            accessibilityLabel={queueButtonLabel(queueCount)}
            testID="player-queue"
          />
        </View>
        {gap}

        {/* Artwork */}
        <View style={styles.artWrap}>
          {story ? (
            <PictureCover
              story={story}
              title={title}
              width={art.width}
              height={art.height}
              radius={32}
              focus="center"
              testID="player-cover"
            />
          ) : null}
        </View>
        {gap}

        <TitleLink title={title} onPress={openStory} hint={t('openStory')} styles={styles} />
        {view.narratorName ? (
          <View style={styles.byRow} testID="player-narrator-row">
            <View
              style={[styles.byDot, { backgroundColor: view.ownVoice ? T.own : T.line }]}
              testID="player-narrator-dot"
            >
              <Icon name="wave" size={16} color={view.ownVoice ? T.onCat : T.text2} />
            </View>
            <Text style={styles.byText} numberOfLines={1} testID="player-narrator">
              {t('narratedBy', { name: view.narratorName })}
            </Text>
          </View>
        ) : null}
        {showContentNote ? (
          <View style={styles.noteRow} testID="player-content-note">
            <Icon name="info" size={16} color={T.text3} />
            <Text style={styles.noteText}>{contentNote}</Text>
          </View>
        ) : null}
        {gap}

        {/* Progress */}
        <View style={styles.seekWrap}>
          <PlayerSeekBar
            active={storeOwns}
            idleDurationSec={idleDurationMs / 1000}
            onSeekFraction={handleSeekFraction}
            onStep={direction => (direction > 0 ? handleForward() : handleRewind())}
            styles={styles}
          />
        </View>
        {gap}

        {/* Transport */}
        <View style={[styles.controls, { gap: transport.gap }]} testID="player-controls">
          {withSkips ? (
            <PreviousButton
              active={storeOwns}
              first={queueIndex === 0}
              onPress={handlePrevious}
              label={t('a11y.previous')}
            />
          ) : null}
          <RoundButton
            icon="back15"
            size={transport.skip}
            glyph={SKIP_GLYPH}
            onPress={handleRewind}
            accessibilityLabel={t('a11y.rewind', { seconds: SKIP_SECONDS })}
            testID="player-rewind"
            T={T}
          />
          <Tactile
            color={T.action}
            lipColor={T.actionLip}
            lip={LIP.lg}
            radius={PLAY_SIZE / 2}
            pressDelay={0}
            onPress={handlePlay}
            accessibilityLabel={playing ? t('common:a11y.pause') : t('common:a11y.play')}
            accessibilityState={{ busy }}
            testID="player-play"
            faceStyle={styles.playFace}
          >
            {busy ? (
              <Spinner size={PLAY_SPINNER} color={T.onAction} testID="player-play-busy" />
            ) : (
              <Icon name={playing ? 'pause' : 'play'} size={PLAY_GLYPH} color={T.onAction} />
            )}
          </Tactile>
          <RoundButton
            icon="fwd15"
            size={transport.skip}
            glyph={SKIP_GLYPH}
            onPress={handleForward}
            accessibilityLabel={t('a11y.forward', { seconds: SKIP_SECONDS })}
            testID="player-forward"
            T={T}
          />
          {withSkips ? (
            <IconButton
              icon="next"
              onPress={handleNext}
              disabled={!hasNext}
              hitSlop={SIDE_HIT_SLOP}
              pressDelay={0}
              accessibilityLabel={t('a11y.next')}
              testID="player-next"
              style={{ width: SIDE_SIZE }}
            />
          ) : null}
        </View>

        {/* A stream that did not start: the reason and a retry, the tiles stay. */}
        {inlineError ? (
          <Card testID="player-stream-error" style={styles.streamError} contentStyle={styles.streamErrorFace}>
            <StateIcon icon="alert" size={40} />
            <Text style={styles.streamErrorText} accessibilityLiveRegion="polite">
              {t('streamFailed')}
            </Text>
            <Button
              label={t('common:retry')}
              variant="text"
              size="sm"
              onPress={retryInline}
              testID="player-stream-retry"
            />
          </Card>
        ) : ended ? (
          <View
            testID="player-end-wrap"
            onLayout={event => {
              const height = Math.ceil(event.nativeEvent.layout.height);
              if (endMeasured?.withNext !== withNext || endMeasured.height !== height) {
                setEndMeasured({ withNext, height });
              }
            }}
          >
            <StoryEndCard next={nextUp} onRestart={handleRestart} onNext={handleNextUp} styles={styles} />
          </View>
        ) : null}
        {gap}

        {/* Options: sleep timer and speed */}
        <View style={styles.opts}>
          <TimerTile onPress={openTimerSheet} style={styles.optTile} />
          <OptionTile
            icon="speed"
            iconBg={T.surface2}
            iconColor={T.text}
            label={t('speed.short')}
            value={
              <Text
                style={optionTileStylesFor(T).value}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
                testID="player-speed-value"
              >
                {speedLabel}
              </Text>
            }
            onPress={openSpeedSheet}
            accessibilityLabel={`${t('speed.title')}, ${speedLabel}`}
            testID="player-speed-entry"
            style={styles.optTile}
          />
        </View>
      </ScrollView>

      {/* Sheets, once the enter has ended */}
      <PlayerSheets
        entered={entered}
        timerOpen={timerSheetOpen}
        onCloseTimer={closeTimerSheet}
        speedOpen={speedSheetOpen}
        onCloseSpeed={closeSpeedSheet}
        title={title}
      />
    </View>
  );
});

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const makeStyles = (T: Theme) => {
  const text = makeTextStyles(T);
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: T.bg },
    glow: {
      position: 'absolute',
      left: -GLOW_BLEED,
      right: -GLOW_BLEED,
      top: -GLOW_BLEED,
      height: GLOW_HEIGHT,
      opacity: 0.6,
    },
    // Exactly as tall as the glow reaches: solid canvas from its bottom edge on.
    glowFade: { position: 'absolute', left: 0, right: 0, top: 0, height: GLOW_BOTTOM },
    content: { paddingHorizontal: T.screenPadH, flexGrow: 1 },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: T.space.md,
    },
    errorBar: { paddingHorizontal: T.screenPadH },
    caption: { flex: 1, minWidth: 0, alignItems: 'center' },
    captionTop: { fontFamily: T.fontBody, fontSize: 12, lineHeight: 16, color: T.text2, textAlign: 'center' },
    captionMain: {
      fontFamily: T.fontLabel,
      fontSize: 13.5,
      lineHeight: 18,
      color: T.text,
      textAlign: 'center',
    },
    artWrap: { alignItems: 'center', marginTop: T.space.lg },
    titleWrap: { marginTop: T.space.lg, alignSelf: 'center', maxWidth: '100%' },
    title: {
      fontFamily: T.fontDisplay,
      fontSize: 26,
      lineHeight: 34,
      color: T.text,
      textAlign: 'center',
    },
    byRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: T.space.sm,
      marginTop: T.space.xs,
    },
    byDot: {
      width: BY_DOT,
      height: BY_DOT,
      borderRadius: BY_DOT / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    byText: { ...text.bodySmall, flexShrink: 1 },
    noteRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'center',
      gap: T.space.sm,
      marginTop: T.space.sm,
    },
    noteText: { ...text.bodySmall, color: T.text2, flexShrink: 1, textAlign: 'center' },
    seekWrap: { marginTop: T.space.md },
    seek: { height: SEEK_TOUCH, justifyContent: 'center' },
    track: {
      height: TRACK_HEIGHT,
      borderRadius: TRACK_HEIGHT / 2,
      backgroundColor: T.line,
      overflow: 'hidden',
    },
    trackFill: { height: TRACK_HEIGHT, borderRadius: TRACK_HEIGHT / 2, backgroundColor: T.action },
    knobWrap: {
      position: 'absolute',
      top: (SEEK_TOUCH - KNOB_SIZE) / 2,
      width: KNOB_SIZE,
      height: KNOB_SIZE + KNOB_LIP,
    },
    knobGrab: { width: KNOB_SIZE, height: KNOB_SIZE + KNOB_LIP },
    knobLip: {
      position: 'absolute',
      top: KNOB_LIP,
      left: 0,
      width: KNOB_SIZE,
      height: KNOB_SIZE,
      borderRadius: KNOB_SIZE / 2,
      backgroundColor: T.knobLip,
    },
    knob: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: KNOB_SIZE,
      height: KNOB_SIZE,
      borderRadius: KNOB_SIZE / 2,
      backgroundColor: T.knob,
    },
    timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -T.space.sm },
    timeLabel: {
      fontFamily: T.fontLabel,
      fontSize: 12.5,
      lineHeight: 17,
      color: T.text3,
      fontVariant: ['tabular-nums'],
    },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: T.space.md,
    },
    playFace: { width: PLAY_SIZE, height: PLAY_SIZE, alignItems: 'center', justifyContent: 'center' },
    streamError: { marginTop: T.space.lg },
    streamErrorFace: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: T.space.md,
      paddingVertical: T.space.sm,
      paddingLeft: T.space.md,
      paddingRight: T.space.xs,
    },
    streamErrorText: { ...text.bodySmall, color: T.text, flex: 1, minWidth: 0 },
    // A row-like panel: padding 12, its rows 12 apart.
    endCard: { marginTop: T.space.lg },
    endFace: { padding: T.space.md, gap: T.space.md },
    endRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.md },
    endTitle: { ...text.label, color: T.text, flex: 1, minWidth: 0 },
    endNext: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: T.space.md,
      paddingTop: T.space.md,
      borderTopWidth: T.hairline,
      borderTopColor: T.line,
    },
    endNextText: { flex: 1, minWidth: 0 },
    endCaption: { ...text.meta },
    endNextTitle: { ...text.label, color: T.text },
    grow: { flexGrow: 1 },
    opts: { flexDirection: 'row', gap: T.space.md, marginTop: T.space.lg },
    optTile: { flex: 1 },
    centerFill: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: T.screenPadH,
      paddingVertical: T.space.xxl,
    },
    centerTitle: { ...text.heading, marginTop: T.space.lg, marginBottom: T.space.tight, textAlign: 'center' },
    centerText: { ...text.bodySmall, textAlign: 'center' },
    centerGap: { height: T.space.xl },
  });
};

type PlayerStyles = ReturnType<typeof makeStyles>;
const stylesFor = themedStyles(makeStyles);

export default AudioPlayerScreen;
