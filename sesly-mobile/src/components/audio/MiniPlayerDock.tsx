/**
 * MiniPlayerDock: the mini player, drawn from the audio store.
 *
 * It shows exactly while `audio.showMiniPlayer` is true: a story is in the
 * player and plays (the intent, so a start with autoplay and buffering
 * count), or for a moment after a pause made from its own button. Paused
 * anywhere else, finished, a sample in the player, after a restart or a
 * sign-out: nothing. No remembered story is ever docked (the library's
 * "Kaldığın yerden devam et" card resumes one).
 *
 * The button plays and pauses in place (a pause from here keeps the card for
 * `DOCK_PAUSE_HOLD_MS`, so the user can resume); the body opens the player
 * on the loaded story, which is instant. The card sinks at the touch and the
 * navigation runs in the next frame (MiniPlayerBar), so the press shows
 * before the player's mount takes the JS thread (LR-4).
 *
 * `leaving`: the shell's overlay is playing its exit after the store hid
 * the mini player. The last story drawn stays on the card meanwhile (the
 * store may already hold a sample or nothing).
 */

import React, { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { MiniPlayerBar, type MiniPlayerBarProps } from '../design/MiniPlayerBar';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { playbackProgress } from '../../utils/playbackProgress';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface MiniPlayerDockProps {
  /** The overlay plays its exit: keep drawing the last story. */
  leaving?: boolean;
}

export const MiniPlayerDock: React.FC<MiniPlayerDockProps> = observer(({ leaving = false }) => {
  const nav = useNavigation<Nav>();
  const audio = useAudioPlayer();
  const { t } = useTranslation('player');
  const last = useRef<MiniPlayerBarProps | null>(null);

  if (!audio.showMiniPlayer) {
    return leaving && last.current ? <MiniPlayerBar {...last.current} /> : null;
  }

  const narrationId = audio.audioId;
  const story = audio.currentStory;
  const props: MiniPlayerBarProps = {
    story: story ?? { id: narrationId },
    title: story?.title || t('untitled'),
    narratorName: audio.currentNarratorName,
    ownVoice: audio.currentOwnVoice,
    progress: playbackProgress.progress,
    minutesLeft: audio.remainingMinutes,
    isPlaying: audio.isPlaying,
    busy: audio.isBusy,
    onPress: () => nav.navigate('AudioPlayer', { narrationId }),
    onTogglePlay: () => {
      void audio.togglePlayPause({ fromDock: true });
    },
  };
  last.current = props;
  return <MiniPlayerBar {...props} />;
});

export default MiniPlayerDock;
