/**
 * ContinueListeningCard: "Kaldığın yerden devam et" at the top of
 * Masallarım (docs/release-pass/SPEC-audio.md 4.3, 4.4).
 *
 * An eyebrow line, then a Library row card (the same card, cover and
 * gutter as the rows under it): the cover, the title on one line, the
 * narrator with the time left ("Kerem anlatıyor, 6 dk kaldı") after a 3dp
 * progress line, and the round play button.
 *
 *   - Play resumes in place: the loaded story toggles; any other start
 *     plays with autoplay, and the mini player shows it. The button sinks
 *     at the touch and spins in the commit of the press (RC-6).
 *   - The body ("Oynatıcıyı aç") opens the player at once (the meta is
 *     known) and plays nothing by itself, like the mini player (VR-05).
 *   - A narration that is gone (404) is forgotten with "Masal bulunamadı."
 *     and the card leaves.
 *
 * The card's story comes from `useLastListened` (the screen decides where it
 * shows); the live parts (busy, playing, the minutes left) are read from the
 * audio store here, so only this card re-renders while it plays.
 */

import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { observer } from 'mobx-react-lite';
import { reaction } from 'mobx';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { CircleButton, Icon, PictureCover, ProgressBar } from '../design';
import { SPACE, Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { isUnplayableLoadError } from '../../utils/loadErrors';
import { forgetLastListened, metaOfLastPlayed, type LastListened } from '../../hooks/useLastListened';
import { rememberNarrationMeta } from '../../stores/narrationMeta';
import { playbackProgress, playedFraction, remainingMinutes } from '../../utils/playbackProgress';
import { showToast } from '../../utils/toast';
import { msg } from '../../i18n/messages';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { LIBRARY_CARD_GAP, LibraryRowCard } from './LibraryRowCard';
import { LIBRARY_COVER_RADIUS, LIBRARY_COVER_WIDTH, LIBRARY_PROGRESS_WIDTH } from './NarrationRow';
import { useRequestedStart } from './requestedStart';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export interface ContinueListeningCardProps {
  item: LastListened;
  /** The placeholder picture its row in the list has, so both show the same one. */
  placeholderIndex?: number;
}

export const ContinueListeningCard: React.FC<ContinueListeningCardProps> = observer(
  ({ item, placeholderIndex }) => {
    const T = useT();
    const styles = stylesFor(T);
    const text = textStylesFor(T);
    const { t } = useTranslation('library');
    const nav = useNavigation<Nav>();
    const audio = useAudioPlayer();
    const focused = useIsFocused();
    const focusedRef = useRef(focused);
    focusedRef.current = focused;

    const { record, positionMs, durationMs, live } = item;
    const id = record.narrationId;
    const title = record.story.title;
    // The start this card asked for, until it sounded or failed.
    const startedRef = useRef<string | null>(null);

    const starting = audio.pendingNarrationId === id;
    const playing = (live || starting) && audio.isPlaying;
    const busy = audio.isBusy && (starting || (live && !audio.pendingNarrationId));
    // Play spins in the commit of the press; the start runs in the next frame (RC-6).
    const { requested, request } = useRequestedStart();
    const waiting = requested && !live && !starting;
    const rate = audio.speedForAllStories ? audio.playbackSpeed : 1;
    const minutes =
      live && audio.hasPosition
        ? audio.remainingMinutes
        : remainingMinutes(positionMs, durationMs, rate);
    const hasMinutes = minutes != null && minutes > 0;
    const narrator = record.narratorName;
    const metaText =
      narrator && hasMinutes
        ? t('nav:miniPlayer.narratorRemaining', { name: narrator, minutes })
        : narrator
          ? t('row.narrator', { name: narrator })
          : hasMinutes
            ? t('row.remaining', { minutes })
            : '';

    const missing = () => {
      startedRef.current = null;
      void forgetLastListened(id);
      if (focusedRef.current) {
        showToast.info(msg(audio.loadError === 'audioRemoved' ? 'player.audioRemoved' : 'player.notFound'));
      }
    };

    // This card's start answered 404 or found the audio removed, before or
    // after it took the player (the narration was deleted or regenerated, or
    // an admin removed its audio). The store names the
    // narration a failure is about, so another story's 404 never counts.
    useEffect(
      () =>
        reaction(
          () =>
            isUnplayableLoadError(audio.loadError) &&
            audio.loadErrorNarrationId === id &&
            startedRef.current === id,
          gone => {
            if (gone) missing();
          },
        ),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [audio, id],
    );

    const play = async () => {
      if (live) {
        void audio.togglePlayPause();
        return;
      }
      startedRef.current = id;
      const started = await audio.startNarration(
        { narrationId: id, meta: metaOfLastPlayed(record) },
        { autoplay: true },
      );
      // Only this narration's 404, once (the reaction above usually took it).
      if (
        !started &&
        startedRef.current === id &&
        isUnplayableLoadError(audio.loadError) &&
        audio.loadErrorNarrationId === id
      ) {
        missing();
      }
    };

    // "Oynatıcıyı aç": the player opens as from the mini player, and plays
    // nothing by itself (VR-05). The round button is the one that resumes.
    const open = () => {
      rememberNarrationMeta(metaOfLastPlayed(record));
      nav.navigate('AudioPlayer', { narrationId: id });
    };

    return (
      <View testID="library-continue" style={styles.block}>
        <Text style={[text.meta, styles.eyebrow]}>{t('continue.eyebrow')}</Text>
        <LibraryRowCard
          spaced={false}
          onPress={open}
          // Not the row's label: the same story can be a row under it.
          accessibilityLabel={t('nav:miniPlayer.open', { title })}
          testID="library-continue-card"
          trailing={
            <CircleButton
              icon={playing ? 'pause' : 'play'}
              variant="action"
              busy={busy || waiting}
              // The control sinks at the touch; the card keeps the list's delay.
              pressDelay={0}
              onPress={() => (live ? void play() : request(play))}
              accessibilityLabel={
                playing ? t('a11y.pause', { title }) : t('continue.a11y', { title })
              }
              testID="library-continue-play"
            />
          }
        >
          <PictureCover
            story={record.story}
            width={LIBRARY_COVER_WIDTH}
            shape="square"
            radius={LIBRARY_COVER_RADIUS}
            flat
            placeholderIndex={placeholderIndex}
          />
          <View style={styles.mid}>
            <Text style={text.labelLarge} numberOfLines={1}>
              {title}
            </Text>
            <View style={styles.meta}>
              <ProgressBar
                value={playedFraction(positionMs, durationMs)}
                progress={live ? playbackProgress.progress : undefined}
                height={3}
                trackColor={T.line}
                style={styles.bar}
                testID="library-continue-progress"
              />
              {record.ownVoice ? <Icon name="wave" size={14} color={T.own} /> : null}
              {metaText ? (
                <Text style={styles.metaText} numberOfLines={1} testID="library-continue-meta">
                  {metaText}
                </Text>
              ) : null}
            </View>
          </View>
        </LibraryRowCard>
      </View>
    );
  },
);

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    block: { paddingTop: SPACE.sm, marginBottom: LIBRARY_CARD_GAP },
    eyebrow: {
      color: T.text2,
      marginHorizontal: T.screenPadH,
      marginBottom: SPACE.xs,
    },
    mid: { flex: 1, minWidth: 0 },
    meta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.tight,
      marginTop: SPACE.xs,
      minHeight: 18,
    },
    bar: { width: LIBRARY_PROGRESS_WIDTH },
    metaText: {
      fontFamily: T.fontBody,
      fontSize: 12.5,
      lineHeight: 18,
      color: T.text2,
      flexShrink: 1,
    },
  });

const stylesFor = themedStyles(makeStyles);

export default ContinueListeningCard;
