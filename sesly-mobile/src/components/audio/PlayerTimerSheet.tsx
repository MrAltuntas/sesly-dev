/**
 * The player's timer sheet: TimerSheet fed from the audio store and the
 * queue (SPEC-audio 7.4, 7.5).
 *
 * What it reads, so it renders every few seconds and not on every status
 * update of the player:
 *   - the audio seconds left in the playing story, rounded up to 10 s
 *     (REMAINING_STEP_SEC; the stop line names a clock time, the quick picks
 *     whole minutes); null while the length is unknown or once the story has
 *     ended (a clock time would be meaningless then);
 *   - the stories queued after the playing one, when it plays from the
 *     queue, with their real lengths only;
 *   - the playing story's title and the playback speed.
 * While the sheet leaves it keeps the values it had, so its content does not
 * change under the exit animation. Every prop keeps its identity while its
 * content is the same (the queue is a structural computed, the callbacks are
 * stable), so a status report of the player never renders the sheet (LR-3).
 *
 * "Sırayı aç" closes this sheet and opens the queue sheet once this one is
 * gone (two sheets never animate at the same time).
 *
 * Props: `visible`, `onClose`, and optionally `currentTitle`, used only while
 * the audio store has no story title.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { comparer, computed } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import sleepTimerService from '../../services/SleepTimerService';
import { queueStore } from '../../stores/QueueStore';
import { queueSheet } from '../../stores/queueSheet';
import { TimerSheet } from './TimerSheet';
import { UpcomingStory, upcomingQueue } from './playerMath';

export interface PlayerTimerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Title to show while the audio store has none (the route's story). */
  currentTitle?: string;
}

/**
 * The time left is passed in steps of this many audio seconds. The stop line
 * adds it to the clock of each render, so the rounding shows up in the time
 * it names. Whole minutes would put that time up to a minute late, and the
 * error, growing and dropping every minute, would pass the line's 30 s hold
 * (STOP_LINE_HOLD_MS): the minute shown would hop. 10 s keeps the error
 * under 20 s, also at 0,5x. The quick picks still round up to whole minutes.
 */
export const REMAINING_STEP_SEC = 10;

interface SheetInputs {
  title: string;
  remainingSec: number | null;
  queue: readonly UpcomingStory[];
  speed: number;
}

/** No queue after the playing story: one array, so the prop never changes for it. */
const NO_QUEUE: readonly UpcomingStory[] = Object.freeze([]);

export const PlayerTimerSheet: React.FC<PlayerTimerSheetProps> = observer(
  ({ visible, onClose, currentTitle }) => {
    const audio = useAudioPlayer();
    const { t } = useTranslation('player');

    useEffect(() => {
      void sleepTimerService.initialize();
    }, []);

    // Audio seconds left, rounded up to REMAINING_STEP_SEC: a computed that
    // changes every few seconds although the position it reads changes every
    // 500 ms.
    const remainingStepSec = useMemo(
      () =>
        computed(() => {
          if (!audio.isStoryLoaded || audio.storyEnded || !(audio.totalDurationMs > 0)) return null;
          const leftSec = Math.max(0, (audio.totalDurationMs - audio.currentPositionMs) / 1000);
          return Math.ceil(leftSec / REMAINING_STEP_SEC) * REMAINING_STEP_SEC;
        }),
      [audio],
    );

    // The stories queued after the playing one, the same array while they
    // stay the same (titles and lengths): a structural computed keeps its old
    // value when the new one is equal.
    const upcoming = useMemo(
      () =>
        computed(
          (): readonly UpcomingStory[] => {
            const inQueue = !!queueStore.currentId && queueStore.currentId === audio.audioId;
            return inQueue ? upcomingQueue(queueStore.entries, queueStore.currentId) : NO_QUEUE;
          },
          { equals: comparer.structural },
        ),
      [audio],
    );

    const last = useRef<SheetInputs | null>(null);
    if (visible || !last.current) {
      last.current = {
        title: audio.currentStory?.title || currentTitle || t('untitled'),
        remainingSec: visible ? remainingStepSec.get() : null,
        queue: upcoming.get(),
        speed: audio.playbackSpeed,
      };
    }
    const inputs = last.current;

    // "Sırayı aç": this sheet leaves first, then the queue sheet comes up.
    const queueNext = useRef(false);
    const openQueue = useCallback(() => {
      queueNext.current = true;
      onClose();
    }, [onClose]);
    const handleClosed = useCallback(() => {
      if (!queueNext.current) return;
      queueNext.current = false;
      queueSheet.open('player');
    }, []);

    return (
      <TimerSheet
        visible={visible}
        onClose={onClose}
        onClosed={handleClosed}
        currentTitle={inputs.title}
        remainingSec={inputs.remainingSec}
        queue={inputs.queue}
        speed={inputs.speed}
        onOpenQueue={openQueue}
      />
    );
  },
);

export default PlayerTimerSheet;
