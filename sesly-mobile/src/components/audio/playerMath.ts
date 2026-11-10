/**
 * Pure helpers of the player: playback speed stops and labels, the sleep
 * timer's stop times, shortcut chips and the label of the player entry
 * (design v4 playful, frame d and its sheets). No React, no stores: everything
 * here is unit tested in `playerMath.test.ts`.
 */

import i18n from '../../i18n';
import type { QueueEntry } from '../../stores/QueueStore';
import { knownNarrationDurationMs } from '../../utils/narrationDurations';
import { formatClock, UNKNOWN_REMAINING_LABEL } from '../../utils/time';

// ─────────────────────────────────────────────────────────────
// Playback speed
// ─────────────────────────────────────────────────────────────

/** The eight stops of the speed slider (frame 5c, revision 4). */
export const SPEED_STOPS: readonly number[] = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];
export const NORMAL_SPEED = 1;
export const NORMAL_SPEED_INDEX = SPEED_STOPS.indexOf(NORMAL_SPEED);

const validSpeed = (speed: number): number =>
  typeof speed === 'number' && Number.isFinite(speed) && speed > 0 ? speed : NORMAL_SPEED;

/** Index of the stop nearest to `speed` (anything invalid is 1,0x). */
export function speedStopIndex(speed: number): number {
  const value = validSpeed(speed);
  let best = NORMAL_SPEED_INDEX;
  let bestDistance = Number.POSITIVE_INFINITY;
  SPEED_STOPS.forEach((stop, index) => {
    const distance = Math.abs(stop - value);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** `speed` moved to the nearest stop. */
export function snapSpeed(speed: number): number {
  return SPEED_STOPS[speedStopIndex(speed)];
}

/**
 * "1,0x", "0,75x", "2,0x": at least one decimal, the separator of the UI
 * language (comma in Turkish, point in English).
 */
export function formatSpeed(speed: number, decimalSeparator: string): string {
  const value = Math.round(validSpeed(speed) * 100) / 100;
  const text = Number.isInteger(value * 10) ? value.toFixed(1) : value.toFixed(2);
  return `${text.replace('.', decimalSeparator)}x`;
}

/** Listening time of `seconds` of audio at `speed`. */
export function scaleBySpeed(seconds: number, speed: number): number {
  return seconds / validSpeed(speed);
}

/**
 * The player's right-hand label: time left at the current speed, "-m:ss".
 * Same whole-second rule as `formatRemaining` (the two labels add up at
 * 1,0x) and the same placeholder while the duration is unknown.
 */
export function formatRemainingAtSpeed(
  positionSec: number,
  durationSec: number,
  speed: number,
): string {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return UNKNOWN_REMAINING_LABEL;
  const position = Number.isFinite(positionSec) && positionSec > 0 ? positionSec : 0;
  const left = Math.max(0, Math.floor(durationSec) - Math.floor(position));
  return `-${formatClock(scaleBySpeed(left, speed))}`;
}

// ─────────────────────────────────────────────────────────────
// Clock times
// ─────────────────────────────────────────────────────────────

/** "21:51" (24 hour clock in both UI languages). */
export function formatClockTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

const UNIT_SUFFIX = ['', 'de', 'de', 'te', 'te', 'te', 'da', 'de', 'de', 'da'] as const;
const TENS_SUFFIX = ['', 'da', 'de', 'da', 'ta', 'de'] as const;

function numberSuffix(value: number): string {
  if (value <= 0) return 'da'; // "sıfır"
  const unit = value % 10;
  if (unit > 0) return UNIT_SUFFIX[unit];
  return TENS_SUFFIX[Math.floor(value / 10) % 6] || 'da';
}

/**
 * Turkish locative suffix for a clock time as it is read aloud:
 * 21:51 "elli bir'de", 22:19 "on dokuz'da", 22:03 "üç'te", 21:40 "kırk'ta".
 * A full hour is read as the hour ("22:00'de", yirmi ikide).
 */
export function turkishTimeSuffix(hours: number, minutes: number): string {
  return minutes > 0 ? numberSuffix(minutes) : numberSuffix(hours);
}

/**
 * Interpolation values for the "{{time}}'{{suffix}} durur" strings. Only
 * Turkish has a suffix; every other language gets an empty one.
 */
export function clockParams(date: Date, language: string): { time: string; suffix: string } {
  return {
    time: formatClockTime(date),
    suffix: language === 'tr' ? turkishTimeSuffix(date.getHours(), date.getMinutes()) : '',
  };
}

/** "18:42" countdown of the running state. */
export function formatCountdown(seconds: number): string {
  return formatClock(Math.max(0, Math.ceil(seconds)));
}

// ─────────────────────────────────────────────────────────────
// Queue
// ─────────────────────────────────────────────────────────────

/** A story that plays after the current one, as the sleep timer counts it. */
export interface UpcomingStory {
  readonly title: string;
  /** Audio length in seconds; null while the device has not learnt it. */
  readonly durationSec: number | null;
}

/**
 * The queue entries after `currentId`, in order, with their real lengths
 * only (the device's memory of each narration; the backend's estimate runs
 * long and is never used). Empty without a queue context or when
 * `currentId` is not queued.
 */
export function upcomingQueue(
  entries: readonly QueueEntry[],
  currentId: string | null | undefined,
  lengthMs: (narrationId: string) => number | null = knownNarrationDurationMs,
): UpcomingStory[] {
  if (!currentId) return [];
  const index = entries.findIndex(entry => entry.narrationId === currentId);
  if (index < 0) return [];
  return entries.slice(index + 1).map(entry => {
    const ms = lengthMs(entry.narrationId);
    return {
      title: entry.story?.title || i18n.t('player:untitled'),
      durationSec: ms !== null && Number.isFinite(ms) && ms > 0 ? ms / 1000 : null,
    };
  });
}

/** Largest "stop after N stories": the playing story plus the queue. */
export function maxStoryCount(queue: readonly UpcomingStory[]): number {
  return 1 + queue.length;
}

// ─────────────────────────────────────────────────────────────
// Sleep timer
// ─────────────────────────────────────────────────────────────

export const TIMER_MIN_MINUTES = 1;
export const TIMER_MAX_MINUTES = 180;

export function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return TIMER_MIN_MINUTES;
  return Math.min(TIMER_MAX_MINUTES, Math.max(TIMER_MIN_MINUTES, Math.round(minutes)));
}

export interface StoryStopInput {
  currentTitle: string;
  /** Audio seconds left in the playing story; null when unknown. */
  remainingSec: number | null;
  queue: readonly UpcomingStory[];
  /** 1 is the story playing now. */
  storyCount: number;
  speed: number;
  nowMs: number;
}

export interface StoryStop {
  /** The story playback stops after. */
  title: string;
  /** When that is; null when a length on the way is unknown. */
  at: Date | null;
}

/** Where and when "stop after N stories" stops. */
export function storyStop(input: StoryStopInput): StoryStop {
  const count = Math.min(Math.max(1, Math.round(input.storyCount)), maxStoryCount(input.queue));
  const included = input.queue.slice(0, count - 1);
  const title = count === 1 ? input.currentTitle : included[included.length - 1].title;
  let total: number | null =
    input.remainingSec !== null && Number.isFinite(input.remainingSec)
      ? Math.max(0, input.remainingSec)
      : null;
  for (const entry of included) {
    total = total === null || entry.durationSec === null ? null : total + entry.durationSec;
  }
  return {
    title,
    at: total === null ? null : new Date(input.nowMs + scaleBySpeed(total, input.speed) * 1000),
  };
}

/** When a duration timer of `minutes` started now stops. */
export function durationStop(minutes: number, nowMs: number): Date {
  return new Date(nowMs + minutes * 60000);
}

/** A shown stop moves only this far before its line changes (r14-stopline-flip). */
export const STOP_LINE_HOLD_MS = 30000;

/** What a stop line shows: its inputs (`key`) and the time it names. */
export interface ShownStop {
  readonly key: string;
  readonly atMs: number | null;
}

/**
 * The stop a line keeps showing. A computed stop wobbles by about a second
 * from render to render (the clock and the whole-second position move on
 * different phases), so a stop near a minute boundary would flip between
 * two minutes. The shown one is replaced only when its inputs change (title,
 * story count, speed: `key`), when it becomes known or unknown, or when the
 * time moves by STOP_LINE_HOLD_MS or more.
 */
export function holdStop(shown: ShownStop | null, key: string, at: Date | null): ShownStop {
  const atMs = at ? at.getTime() : null;
  if (
    shown &&
    shown.key === key &&
    (shown.atMs === null) === (atMs === null) &&
    (atMs === null || Math.abs(atMs - (shown.atMs as number)) < STOP_LINE_HOLD_MS)
  ) {
    return shown;
  }
  return { key, atMs };
}

export type TimerChipKind = 'thisStory' | 'withNext' | 'last';

export interface TimerChip {
  kind: TimerChipKind;
  minutes: number;
}

export interface TimerChipInput {
  /** Audio seconds left in the playing story; null when unknown. */
  remainingSec: number | null;
  /** Audio length of the next queued story; null when there is none or it is unknown. */
  nextDurationSec: number | null;
  /** Last duration the user set; null when never. */
  lastDurationMin: number | null;
  speed: number;
}

const wholeMinutesUp = (seconds: number, speed: number): number =>
  Math.max(1, Math.ceil(scaleBySpeed(seconds, speed) / 60));

/**
 * Shortcut chips of the minute wheel. A chip is left out when it has
 * nothing to show, is out of the wheel's range or repeats an earlier one.
 */
export function timerChips(input: TimerChipInput): TimerChip[] {
  const candidates: TimerChip[] = [];
  const left =
    input.remainingSec !== null && Number.isFinite(input.remainingSec) && input.remainingSec > 0
      ? input.remainingSec
      : null;
  if (left !== null) {
    candidates.push({ kind: 'thisStory', minutes: wholeMinutesUp(left, input.speed) });
    if (input.nextDurationSec !== null && input.nextDurationSec > 0) {
      candidates.push({
        kind: 'withNext',
        minutes: wholeMinutesUp(left + input.nextDurationSec, input.speed),
      });
    }
  }
  if (input.lastDurationMin !== null && Number.isFinite(input.lastDurationMin)) {
    candidates.push({ kind: 'last', minutes: Math.round(input.lastDurationMin) });
  }
  const seen = new Set<number>();
  return candidates.filter(chip => {
    if (chip.minutes < TIMER_MIN_MINUTES || chip.minutes > TIMER_MAX_MINUTES) return false;
    if (seen.has(chip.minutes)) return false;
    seen.add(chip.minutes);
    return true;
  });
}

export interface TimerEntryState {
  active: boolean;
  mode: 'stories' | 'duration';
  storiesLeft: number;
  remainingSeconds: number;
}

export interface TimerEntryLabel {
  /** The small line: "Zamanlayıcı", or "Kalan süre" while a duration runs. */
  label: string;
  /** The Baloo 2 line: "Kapalı", "Bu masal", "3 masal" or the countdown "14:52". */
  value: string;
}

/**
 * The two lines of the player's sleep timer tile. The countdown is the bare
 * "14:52" (tabular digits, so its width never changes) under "Kalan süre";
 * every value fits the tile's 86dp text slot at 360dp. Reads the UI language
 * from i18n: the caller must use `useTranslation()` so it re-renders on a
 * language change.
 */
export function sleepTimerEntryLabel(state: TimerEntryState): TimerEntryLabel {
  const t = (key: string, options?: Record<string, unknown>): string => i18n.t(key, options ?? {});
  const short = t('player:timer.short');
  if (!state.active) return { label: short, value: t('player:timer.off') };
  if (state.mode === 'stories') {
    return {
      label: short,
      value:
        state.storiesLeft <= 1
          ? t('player:timer.tileThisStory')
          : t('player:timer.tileStories', { n: state.storiesLeft }),
    };
  }
  return { label: t('player:timer.remainingLabel'), value: formatCountdown(state.remainingSeconds) };
}

/** Spoken value of the story count: "1 masal" / "1 story", "3 masal" / "3 stories". */
export function storiesValueText(n: number): string {
  return n === 1
    ? i18n.t('player:timer.storiesValueOne')
    : i18n.t('player:timer.storiesValue', { n });
}
