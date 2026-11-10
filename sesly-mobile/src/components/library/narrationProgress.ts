/**
 * What a row of "Masallarım" can say about a narration: still generating,
 * partly listened, or only its length.
 *
 * Playback positions are real: the player stores them on the device under
 * `narration_position:<id>` while a story is in progress and removes the key
 * when the story ends. That is why "finished" and "never played" cannot be
 * told apart from the device alone (see `getNarrationListenState`).
 */

import { StoryNarration, getNarrationProgressPercentage } from '../../models/Narration';
import { NarrationStatus } from '../../types/enums';
import { playedFraction, remainingMinutes } from '../../utils/playbackProgress';

export type NarrationListenState = 'finished' | 'unplayed';

/**
 * BACKEND PLACEHOLDER (listening history): whether the user finished a
 * narration or never started it. Neither the narration payload nor the device
 * records it (the saved position is deleted at the end of a story), so this
 * returns null and the row shows the length alone. Read the field here when
 * `GET /narrations` carries it (for example `lastListenedAt` / `completedAt`
 * of the listening, which would also allow the "Son dinlenen" sort order).
 */
export function getNarrationListenState(
  _narration: Pick<StoryNarration, 'id'>,
): NarrationListenState | null {
  return null;
}

export const isPendingNarration = (narration: Pick<StoryNarration, 'status'>): boolean =>
  narration.status === NarrationStatus.PENDING || narration.status === NarrationStatus.GENERATING;

/** Failed narrations are not listed; they are retried from the story. */
export const isVisibleNarration = (narration: Pick<StoryNarration, 'status'>): boolean =>
  narration.status === NarrationStatus.READY || isPendingNarration(narration);

/** Narrations still generating first, then ready ones; newest first in both. */
export function sortNarrations(list: readonly StoryNarration[]): StoryNarration[] {
  const byDateDesc = (a: StoryNarration, b: StoryNarration) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  const pending = list.filter(isPendingNarration).sort(byDateDesc);
  const ready = list.filter(n => n.status === NarrationStatus.READY).sort(byDateDesc);
  return [...pending, ...ready];
}

/**
 * A generating narration with the percentage a status poll reported
 * (`GET /narrations/:id/status` sends a percentage, not chunk counts). The
 * row reads its percentage from the chunks, so they are scaled; a narration
 * whose chunks are not planned yet counts in hundredths. The same object
 * comes back when nothing changes, so a poll without news renders nothing.
 */
export function withGenerationProgress(
  narration: StoryNarration,
  percent: number,
  status?: string,
): StoryNarration {
  const clamped = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  const nextStatus =
    status === NarrationStatus.GENERATING || status === NarrationStatus.PENDING
      ? (status as NarrationStatus)
      : narration.status;
  // Nothing done and nothing planned yet: the row keeps "Hazırlanıyor"
  // instead of a "%0" that reads as stuck.
  const planned = narration.totalChunks > 0 || clamped > 0;
  const totalChunks = narration.totalChunks > 0 ? narration.totalChunks : planned ? 100 : 0;
  const completedChunks = Math.round((clamped / 100) * totalChunks);
  if (
    totalChunks === narration.totalChunks &&
    completedChunks === narration.completedChunks &&
    nextStatus === narration.status
  ) {
    return narration;
  }
  return { ...narration, status: nextStatus, totalChunks, completedChunks };
}

/**
 * Length in milliseconds before the player has reported the real one: the
 * story's estimate (the minutes its card shows, counted from its words), else
 * the narration's stored `totalDuration`, which the backend writes before the
 * audio exists and runs about three times too long; 0 when neither is known.
 * Callers ask `resolveNarrationDurationMs` first, so the real length wins.
 */
export function narrationDurationMs(
  narration: Pick<StoryNarration, 'totalDuration' | 'story'>,
): number {
  const minutes = narration.story?.estimatedDuration ?? 0;
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60000;
  return narration.totalDuration > 0 ? narration.totalDuration * 1000 : 0;
}

export type NarrationRowStatus =
  | { readonly kind: 'preparing'; readonly percent: number | null }
  | { readonly kind: 'progress'; readonly fraction: number; readonly minutesLeft: number }
  | {
      readonly kind: 'finished' | 'unplayed' | 'plain';
      readonly durationMinutes: number | null;
    };

/**
 * @param positionMs the known playback position (live from the player or
 *   saved on the device); null or 0 when there is none.
 * @param durationMs overrides the narration's own length (the player knows
 *   the exact one for the story it has loaded).
 * @param rate the speed the story plays at: the time left is wall-clock
 *   time, so 4 minutes of story at 2,0x say "2 dk kaldı".
 */
export function describeNarrationStatus(
  narration: StoryNarration,
  positionMs: number | null,
  durationMs: number = narrationDurationMs(narration),
  rate: number = 1,
): NarrationRowStatus {
  if (isPendingNarration(narration)) {
    const percent =
      narration.totalChunks > 0
        ? Math.max(0, Math.min(100, Math.round(getNarrationProgressPercentage(narration))))
        : null;
    return { kind: 'preparing', percent };
  }

  if (positionMs != null && positionMs > 0 && durationMs > 0) {
    const minutesLeft = remainingMinutes(positionMs, durationMs, rate);
    if (minutesLeft != null && minutesLeft > 0) {
      return { kind: 'progress', fraction: playedFraction(positionMs, durationMs), minutesLeft };
    }
  }

  const durationMinutes = durationMs > 0 ? Math.max(1, Math.round(durationMs / 60000)) : null;
  return { kind: getNarrationListenState(narration) ?? 'plain', durationMinutes };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The words of the status line ("4 dk kaldı", "Hazırlanıyor, %60", "5 dk"). */
export function narrationStatusText(status: NarrationRowStatus, t: Translate): string {
  switch (status.kind) {
    case 'preparing':
      return status.percent == null
        ? t('library:row.preparing')
        : t('library:row.preparingPercent', { percent: status.percent });
    case 'progress':
      return t('library:row.remaining', { minutes: status.minutesLeft });
    default: {
      const duration =
        status.durationMinutes == null
          ? ''
          : t('library:row.duration', { minutes: status.durationMinutes });
      if (status.kind === 'finished') {
        return duration
          ? t('library:row.listenedDuration', { duration })
          : t('library:row.listened');
      }
      if (status.kind === 'unplayed') {
        return duration
          ? t('library:row.unlistenedDuration', { duration })
          : t('library:row.unlistened');
      }
      return duration;
    }
  }
}
