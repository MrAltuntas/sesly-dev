/**
 * useLastListened: the story behind the Library's "Kaldığın yerden devam et"
 * card (docs/release-pass/SPEC-audio.md 4.2).
 *
 * The record is the one the audio store writes whenever a story starts
 * (`utils/lastPlayed`), for the signed-in account only; the position is the
 * one the player saved for that narration (`narration_position:<id>`).
 *
 * When the Library gains focus the hook decides once whether there is a
 * card: a record of this account, a resumable position (played, not
 * finished) and not the story the mini player shows at that moment (it was
 * playing). While the screen stays focused the card keeps that story, so the
 * list never jumps: when its story starts the card turns live instead of
 * leaving, and the saved position is read again whenever the player starts,
 * pauses or switches stories. The next focus decides afresh.
 *
 * A narration that is gone (the Library deleted it, or the server answered
 * 404 when it started) is forgotten through `forgetLastListened`, and every
 * card showing it disappears.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { comparer, reaction } from 'mobx';
import { useFocusEffect } from '@react-navigation/native';
import { useAudioPlayer } from './useAudioPlayer';
import { isUnplayableLoadError } from '../utils/loadErrors';
import { getSessionUserId } from '../stores/session';
import type { NarrationMeta } from '../stores/narrationMeta';
import {
  clearLastPlayed,
  readLastPlayed,
  readSavedPositionMs,
  type LastPlayed,
} from '../utils/lastPlayed';
import { resolveNarrationDurationMs } from '../utils/narrationDurations';
import { shouldResumeFrom } from '../utils/playback';

export interface LastListened {
  record: LastPlayed;
  /**
   * The position saved on the device. While the story is in the player the
   * card reads the store's live values instead (`live`).
   */
  positionMs: number;
  /** The player's length while live, else `resolveNarrationDurationMs(id, record.estimateMs)`. */
  durationMs: number;
  /** The record's story is the one in the player. */
  live: boolean;
}

type ForgetListener = (narrationId: string) => void;
const forgetListeners = new Set<ForgetListener>();

/**
 * The narration is gone: clear the stored record when it points to it and
 * take the card away wherever it shows.
 */
export async function forgetLastListened(narrationId: string): Promise<void> {
  if (!narrationId) return;
  [...forgetListeners].forEach(listener => listener(narrationId));
  const record = await readLastPlayed(getSessionUserId());
  if (record?.narrationId === narrationId) await clearLastPlayed();
}

/** The record as a narration meta (what `startNarration` and the player read). */
export function metaOfLastPlayed(record: LastPlayed): NarrationMeta {
  return {
    narrationId: record.narrationId,
    storyId: record.storyId,
    voiceProfileId: record.voiceProfileId,
    story: record.story,
    voiceProfile: null,
    narratorName: record.narratorName,
    ownVoice: record.ownVoice,
    estimateMs: record.estimateMs,
  };
}

interface Shown {
  readonly record: LastPlayed;
  readonly positionMs: number;
}

/** What the player holds, as far as the card cares. */
interface Loaded {
  readonly id: string;
  readonly lengthMs: number;
}

function loadedOf(audio: {
  isStoryLoaded: boolean;
  audioId: string;
  totalDurationMs: number;
}): Loaded {
  return audio.isStoryLoaded
    ? { id: audio.audioId, lengthMs: audio.totalDurationMs }
    : { id: '', lengthMs: 0 };
}

export function useLastListened(): LastListened | null {
  const audio = useAudioPlayer();
  const [shown, setShown] = useState<Shown | null>(null);
  // Followed through a reaction, so the hook works outside an observer.
  const [loadedNow, setLoadedNow] = useState<Loaded>(() => loadedOf(audio));
  // The narration of the card of this focus; null while there is none.
  const shownIdRef = useRef<string | null>(null);
  // Bumped by every focus, blur and forget: a read that finishes later is dropped.
  const readSeqRef = useRef(0);

  const hide = useCallback((narrationId: string) => {
    if (shownIdRef.current !== narrationId) return;
    shownIdRef.current = null;
    readSeqRef.current += 1;
    setShown(null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const seq = ++readSeqRef.current;
      // The story the mini player shows right now gets no card.
      const playingAtFocus = audio.isStoryLoaded && audio.isPlaying ? audio.audioId : null;
      // The card of the last focus shows that story: it goes now, not after
      // the reads below (the list would move a few frames after the tab).
      if (playingAtFocus && shownIdRef.current === playingAtFocus) {
        shownIdRef.current = null;
        setShown(null);
      }
      void (async () => {
        const record = await readLastPlayed(getSessionUserId());
        const positionMs = record ? await readSavedPositionMs(record.narrationId) : 0;
        if (seq !== readSeqRef.current) return;
        const durationMs = record
          ? resolveNarrationDurationMs(record.narrationId, record.estimateMs)
          : 0;
        const visible =
          !!record &&
          record.narrationId !== playingAtFocus &&
          shouldResumeFrom(positionMs, durationMs / 1000);
        shownIdRef.current = visible && record ? record.narrationId : null;
        setShown(visible && record ? { record, positionMs } : null);
      })();

      // While focused, the card follows the position the player saves when
      // it starts, pauses or switches stories.
      const dispose = reaction(
        () => [audio.audioId, audio.isPlaying, audio.loadPhase],
        () => {
          const id = shownIdRef.current;
          if (!id) return;
          const at = readSeqRef.current;
          // A microtask later: the store writes the position in the same
          // tick as the change, and the read must come after that write.
          void Promise.resolve()
            .then(() => readSavedPositionMs(id))
            .then(positionMs => {
              if (at !== readSeqRef.current || shownIdRef.current !== id) return;
              setShown(prev =>
                prev && prev.record.narrationId === id && prev.positionMs !== positionMs
                  ? { ...prev, positionMs }
                  : prev,
              );
            });
        },
      );
      return () => {
        dispose();
        readSeqRef.current += 1;
      };
    }, [audio]),
  );

  useEffect(() => {
    forgetListeners.add(hide);
    const disposeLoaded = reaction(() => loadedOf(audio), setLoadedNow, {
      equals: comparer.structural,
      fireImmediately: true,
    });
    // The card's story answered 404 (deleted, or replaced by a regenerate),
    // whoever started it. The store names the narration a failure is about:
    // a start that fails before it takes the player (a push tap fetching a
    // deleted narration) leaves the previous story loaded, and that 404 is
    // not the loaded story's.
    const disposeMissing = reaction(
      () => (isUnplayableLoadError(audio.loadError) ? audio.loadErrorNarrationId : null),
      missingId => {
        if (!missingId || missingId !== shownIdRef.current) return;
        void forgetLastListened(missingId);
      },
    );
    return () => {
      forgetListeners.delete(hide);
      disposeLoaded();
      disposeMissing();
    };
  }, [audio, hide]);

  if (!shown) return null;
  const { record, positionMs } = shown;
  const live = loadedNow.id === record.narrationId;
  const durationMs =
    live && loadedNow.lengthMs > 0
      ? loadedNow.lengthMs
      : resolveNarrationDurationMs(record.narrationId, record.estimateMs);
  return { record, positionMs, durationMs, live };
}

export default useLastListened;
