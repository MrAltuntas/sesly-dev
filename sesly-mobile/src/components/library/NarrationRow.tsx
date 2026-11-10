/**
 * One narrated story in "Masallarım" (design/v4/playful, the `.nr` card):
 * a rounded square cover, the title, the narrator line ("X anlatıyor", after
 * a wave in the own-voice colour when the parent's own voice tells it, then
 * a small "aksanlı" marker when a voice of another language read it with its
 * accent), a status line (a 3dp progress line and the time left when a
 * position is known, "Hazırlanıyor, %60" while generating) with the language
 * codes, then three visible controls: "Sıraya ekle", the round play button
 * and "more".
 *
 * The play button plays in place (SPEC-audio 5.2): the loaded story toggles,
 * any other one starts with autoplay and the button spins until it sounds.
 * It sinks at the touch and spins in the commit of the press; the start runs
 * in the frame after it (RC-6, `useRequestedStart`).
 * The row body is the screen's (`onOpen`: the player for a ready narration,
 * the generation screen for one being prepared).
 *
 * A ready row has no long press (owner feedback: nobody found it); every
 * action is a visible control (SPEC-audio 6.4):
 *   "Sıraya ekle"   the queue glyph left of play: adds the narration to
 *                   Sıradakiler ("Sıraya eklendi" with "Sırayı aç"); once
 *                   queued it is filled in the action colour and takes it
 *                   out again ("Sıradan çıkar").
 *   "more"          right of play, at the card's edge: the row's menu
 *                   (`onMenu`: the story's page, delete).
 * A row being prepared has neither: it cannot be queued yet.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { computed } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import {
  CircleButton,
  ICON_SIZE_INLINE,
  Icon,
  IconButton,
  LanguageCodes,
  PictureCover,
  ProgressBar,
  Spinner,
} from '../design';
import { RADIUS, SPACE, Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { StoryNarration, isNarrationAccented } from '../../models/Narration';
import { getNarratorDisplay } from '../../models/Narrator';
import { isCloneProfile } from '../../models/VoiceProfile';
import {
  describeNarrationStatus,
  isPendingNarration,
  narrationDurationMs,
  narrationStatusText,
} from './narrationProgress';
import type { NarrationRowStatus } from './narrationProgress';
import { LIBRARY_CARD_LEADING, LIBRARY_CARD_PADDING, LibraryRowCard } from './LibraryRowCard';
import { playbackProgress } from '../../utils/playbackProgress';
import { resolveNarrationDurationMs } from '../../utils/narrationDurations';
import { useRequestedStart } from './requestedStart';
import { queueStore } from '../../stores/QueueStore';
import { addToQueueWithFeedback, removeFromQueueWithFeedback } from '../../stores/queueActions';
import { metaFromNarration } from '../../stores/narrationMeta';

/** Edge of the rounded square cover of a library row (dp): the row-card picture tile. */
export const LIBRARY_COVER_WIDTH = LIBRARY_CARD_LEADING;
/** Its corner radius (`.nr .av`: 16). */
export const LIBRARY_COVER_RADIUS = RADIUS.md;
/**
 * Width of "Sıraya ekle" and "more" beside the play button: the 44dp
 * minimum, with the 48dp touch height. The glyph is the inline 20dp.
 */
export const LIBRARY_ROW_CONTROL_WIDTH = 44;

/** Width of the progress line in the status row (dp). */
export const LIBRARY_PROGRESS_WIDTH = 48;

/** Line boxes of the text column: the title (labelLarge), the narrator, the status row. */
const TITLE_LINE = 21;
const BY_LINE = 18;
/** The status row holds a 22dp tag at most (the translation tag of a saved row). */
export const LIBRARY_META_HEIGHT = 22;
/** The text column of a row with a one-line title. */
export const LIBRARY_ROW_TEXT_HEIGHT =
  TITLE_LINE + SPACE.xxs + BY_LINE + SPACE.xs + LIBRARY_META_HEIGHT;
/** Face height of a library row with a one-line title (its skeleton is this tall). */
export const LIBRARY_ROW_HEIGHT =
  LIBRARY_CARD_PADDING * 2 + Math.max(LIBRARY_COVER_WIDTH, LIBRARY_ROW_TEXT_HEIGHT);

export interface NarrationRowProps {
  narration: StoryNarration;
  /** Position the player saved on the device for this narration; null or 0 when none. */
  savedPositionMs?: number | null;
  placeholderIndex?: number;
  /** The row body: opens the player, or the generation screen while it is prepared. */
  onOpen: (narration: StoryNarration) => void;
  /** The "more" button of a ready row: the row's menu (the story's page, delete). */
  onMenu?: (narration: StoryNarration) => void;
}

export const NarrationRow: React.FC<NarrationRowProps> = observer(
  ({ narration, savedPositionMs, placeholderIndex, onOpen, onMenu }) => {
    const T = useT();
    const { t } = useTranslation('library');
    const styles = stylesFor(T);
    const text = textStylesFor(T);
    const player = useAudioPlayer();

    // Whether the player holds or starts this row's story, as computeds: a
    // row re-renders only when its own answer changes, so a start or a
    // switch re-renders the rows it leaves and reaches, not every row of
    // the list (NL-07).
    const holds = useMemo(
      () => computed(() => player.audioId === narration.id && player.isStoryLoaded),
      [player, narration.id],
    );
    const startsHere = useMemo(
      () => computed(() => player.pendingNarrationId === narration.id),
      [player, narration.id],
    );

    const pending = isPendingNarration(narration);
    // The story the player holds right now (playing or paused).
    const active = !pending && holds.get();
    // A start of this narration is on its way (the player flips to it once loaded).
    const starting = !pending && startsHere.get();
    const playing = (active || starting) && player.isPlaying;
    // Spins while the user waits for this story: its start, or a stall of it.
    // `isBusy` is read last, so only this story's row follows a stall (not
    // every row of the list on each buffering change).
    const busy = (starting || (active && !player.pendingNarrationId)) && player.isBusy;
    // A press of play spins the button in its own commit; the start runs in
    // the next frame (RC-6). Once the store shows the start, it takes over.
    const { requested, request } = useRequestedStart();
    const waiting = requested && !pending && !active && !starting;

    // One length for a narration everywhere: the player's while it is
    // loaded, else the real one remembered on the device, else the story's
    // own estimate (the length its card shows; see `narrationDurationMs`).
    const durationMs =
      active && (player.totalDurationMs ?? 0) > 0
        ? player.totalDurationMs
        : resolveNarrationDurationMs(narration.id, narrationDurationMs(narration));
    // The time left is wall-clock time: the loaded story's speed, or the
    // speed every story plays at when "use for all stories" is on.
    const rate = player.speedForAllStories ? player.playbackSpeed : 1;
    // The loaded story reads the store's computed values, so the row
    // re-renders when the minute changes, not on every position report; its
    // bar is the shared native-driven progress value.
    const liveMinutes = active && player.hasPosition ? player.remainingMinutes : null;
    const status: NarrationRowStatus =
      liveMinutes != null && liveMinutes > 0
        ? { kind: 'progress', fraction: 0, minutesLeft: liveMinutes }
        : describeNarrationStatus(narration, active ? null : savedPositionMs ?? null, durationMs, rate);
    const live = active && status.kind === 'progress';
    const statusText = narrationStatusText(status, t);

    const title = narration.story?.title ?? t('row.fallbackTitle');
    const narrator = getNarratorDisplay(narration.voiceProfile);
    const ownVoice = !!narration.voiceProfile && isCloneProfile(narration.voiceProfile);
    const accented = isNarrationAccented(narration);
    const story = narration.story ?? { id: narration.storyId || narration.id };

    const body = (
      <>
        <PictureCover
          story={story}
          width={LIBRARY_COVER_WIDTH}
          shape="square"
          radius={LIBRARY_COVER_RADIUS}
          flat
          placeholderIndex={placeholderIndex}
        />
        <View style={styles.mid}>
          <Text style={text.labelLarge} numberOfLines={2}>
            {title}
          </Text>
          {narrator ? (
            <View style={styles.byRow}>
              {ownVoice ? (
                <Icon
                  name="wave"
                  size={14}
                  color={T.own}
                  testID={`library-own-voice-${narration.id}`}
                />
              ) : null}
              <Text style={styles.by} numberOfLines={1}>
                {t('row.narrator', { name: narrator.name })}
              </Text>
              {/* Read by a voice of another language, with its accent: a
                  quiet marker after the narrator, nothing more. */}
              {accented ? (
                <View style={styles.accent} testID={`library-accent-${narration.id}`}>
                  <Text style={styles.accentText} numberOfLines={1}>
                    {t('row.accented')}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <View style={styles.meta}>
            {status.kind === 'progress' ? (
              <ProgressBar
                value={live ? undefined : status.fraction}
                progress={live ? playbackProgress.progress : undefined}
                height={3}
                trackColor={T.line}
                style={styles.bar}
                testID={`library-progress-${narration.id}`}
              />
            ) : null}
            {statusText ? (
              <Text style={styles.metaText} numberOfLines={1}>
                {statusText}
              </Text>
            ) : null}
            {narration.story ? (
              <LanguageCodes
                codes={narration.story.availableLanguages}
                shown={narration.story.language}
                style={styles.codes}
              />
            ) : null}
          </View>
        </View>
      </>
    );

    if (pending) {
      // Opens the generation screen, which follows the running job.
      return (
        <LibraryRowCard
          onPress={() => onOpen(narration)}
          accessibilityLabel={`${t('a11y.preparing', { title })}. ${statusText}`}
          testID={`library-narration-${narration.id}`}
          trailing={<Spinner size={20} testID={`library-spinner-${narration.id}`} />}
        >
          {body}
        </LibraryRowCard>
      );
    }

    const togglePlay = () => {
      if (active) {
        void player.togglePlayPause();
        return;
      }
      // Starts in place; the mini player shows it while it plays.
      request(() => player.startNarration({ narration }, { autoplay: true }));
    };

    // Read in render: an observer, so the glyph follows the queue.
    const queued = queueStore.has(narration.id);
    const toggleQueue = () => {
      if (queueStore.has(narration.id)) removeFromQueueWithFeedback(narration.id);
      else addToQueueWithFeedback(metaFromNarration(narration));
    };

    return (
      <LibraryRowCard
        onPress={() => onOpen(narration)}
        accessibilityLabel={t('a11y.openNarration', { title })}
        testID={`library-narration-${narration.id}`}
        plainTrailing={!!onMenu}
        tightTrailing
        trailing={
          <>
          <IconButton
            icon="queue"
            filled={queued}
            size={ICON_SIZE_INLINE}
            color={queued ? T.action : T.text2}
            pressDelay={0}
            onPress={toggleQueue}
            accessibilityLabel={t(queued ? 'a11y.queueRemove' : 'a11y.queueAdd', { title })}
            testID={`library-queue-${narration.id}`}
            style={styles.control}
          />
          <CircleButton
            icon={playing ? 'pause' : 'play'}
            variant={active || starting || waiting ? 'action' : 'neutral'}
            busy={busy || waiting}
            // The control, not the row: it sinks at the touch (RC-6); the
            // row body keeps the list's press delay.
            pressDelay={0}
            onPress={togglePlay}
            accessibilityLabel={t(playing ? 'a11y.pause' : 'a11y.play', { title })}
            testID={`library-play-${narration.id}`}
          />
          {onMenu ? (
            <IconButton
              icon="more"
              size={ICON_SIZE_INLINE}
              color={T.text2}
              pressDelay={0}
              onPress={() => onMenu(narration)}
              accessibilityLabel={t('a11y.options', { title })}
              testID={`library-more-${narration.id}`}
              style={styles.control}
            />
          ) : null}
          </>
        }
      >
        {body}
      </LibraryRowCard>
    );
  },
);

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    mid: { flex: 1, minWidth: 0 },
    // "Sıraya ekle" and "more": 44dp wide, the 48dp touch height.
    control: { width: LIBRARY_ROW_CONTROL_WIDTH },
    byRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.xxs },
    by: {
      flexShrink: 1,
      fontFamily: T.fontBody,
      fontSize: 12.5,
      lineHeight: BY_LINE,
      color: T.text2,
    },
    // `.nr .lg`: a small tag on the line colour.
    accent: {
      minHeight: 17,
      borderRadius: RADIUS.xs,
      paddingHorizontal: SPACE.tight,
      backgroundColor: T.line,
      justifyContent: 'center',
      flexShrink: 0,
    },
    accentText: { fontFamily: T.fontLabel, fontSize: 10.5, lineHeight: 15, color: T.text2 },
    meta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.tight,
      marginTop: SPACE.xs,
      minHeight: LIBRARY_META_HEIGHT,
    },
    bar: { width: LIBRARY_PROGRESS_WIDTH },
    metaText: {
      fontFamily: T.fontBody,
      fontSize: 12,
      lineHeight: 16,
      color: T.text3,
      flexShrink: 1,
    },
    codes: { alignSelf: 'center' },
  });

const stylesFor = themedStyles(makeStyles);

export default NarrationRow;
