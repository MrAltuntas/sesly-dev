/**
 * Pure helpers of the player: speed stops and labels, clock times, queue,
 * sleep timer stop times, shortcut chips and the player entry label.
 */

import i18n from '../../i18n';
import type { QueueEntry } from '../../stores/QueueStore';
import {
  rememberNarrationDuration,
  resetNarrationDurationsForTests,
} from '../../utils/narrationDurations';
import {
  NORMAL_SPEED_INDEX,
  SPEED_STOPS,
  STOP_LINE_HOLD_MS,
  clampMinutes,
  clockParams,
  durationStop,
  formatClockTime,
  formatCountdown,
  formatRemainingAtSpeed,
  formatSpeed,
  holdStop,
  maxStoryCount,
  scaleBySpeed,
  sleepTimerEntryLabel,
  snapSpeed,
  speedStopIndex,
  storiesValueText,
  storyStop,
  timerChips,
  turkishTimeSuffix,
  upcomingQueue,
} from './playerMath';

const at = (h: number, m: number, s = 0) => new Date(2026, 9, 13, h, m, s).getTime();

/** A queued narration of story `id` (the backend estimate is never a length). */
function entry(id: string, title = `Masal ${id}`): QueueEntry {
  return {
    narrationId: `n-${id}`,
    storyId: `s-${id}`,
    voiceProfileId: 'v-1',
    story: { id: `s-${id}`, title, coverImageUrl: null, translationGroupId: null, category: null },
    voiceProfile: null,
    narratorName: 'Achernar',
    ownVoice: false,
    estimateMs: 12 * 60000,
    addedAt: 0,
  };
}

afterEach(async () => {
  await i18n.changeLanguage('tr');
});

describe('playback speed', () => {
  it('has the eight stops of the mockup with 1,0x as the normal one', () => {
    expect(SPEED_STOPS).toEqual([0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2]);
    expect(SPEED_STOPS[NORMAL_SPEED_INDEX]).toBe(1);
  });

  it('snaps any value to the nearest stop', () => {
    expect(speedStopIndex(1)).toBe(3);
    expect(speedStopIndex(0.8)).toBe(1);
    expect(snapSpeed(1.3)).toBe(1.25);
    expect(snapSpeed(5)).toBe(2);
    expect(snapSpeed(0.1)).toBe(0.5);
    expect(snapSpeed(Number.NaN)).toBe(1);
    expect(snapSpeed(-2)).toBe(1);
  });

  it('formats with a decimal comma in Turkish and a point in English', () => {
    expect(formatSpeed(1, ',')).toBe('1,0x');
    expect(formatSpeed(0.5, ',')).toBe('0,5x');
    expect(formatSpeed(0.75, ',')).toBe('0,75x');
    expect(formatSpeed(1.25, ',')).toBe('1,25x');
    expect(formatSpeed(2, ',')).toBe('2,0x');
    expect(formatSpeed(1.1, '.')).toBe('1.1x');
    expect(formatSpeed(2, '.')).toBe('2.0x');
  });

  it('divides listening time by the speed', () => {
    expect(scaleBySpeed(300, 1.5)).toBe(200);
    expect(scaleBySpeed(300, 0)).toBe(300);
  });

  it('remaining label: same as before at 1,0x, shorter when faster', () => {
    expect(formatRemainingAtSpeed(0, 353, 1)).toBe('-5:53');
    expect(formatRemainingAtSpeed(53, 353, 1)).toBe('-5:00');
    expect(formatRemainingAtSpeed(53, 353, 2)).toBe('-2:30');
    expect(formatRemainingAtSpeed(53, 353, 0.5)).toBe('-10:00');
    expect(formatRemainingAtSpeed(400, 353, 1)).toBe('-0:00');
    expect(formatRemainingAtSpeed(10, 0, 1)).toBe('-:--');
  });
});

describe('clock times', () => {
  it('formats a 24 hour clock', () => {
    expect(formatClockTime(new Date(at(21, 51)))).toBe('21:51');
    expect(formatClockTime(new Date(at(7, 5)))).toBe('07:05');
  });

  it('picks the Turkish suffix from how the time is read', () => {
    expect(turkishTimeSuffix(21, 51)).toBe('de'); // elli bir
    expect(turkishTimeSuffix(22, 19)).toBe('da'); // on dokuz
    expect(turkishTimeSuffix(22, 1)).toBe('de'); // bir
    expect(turkishTimeSuffix(22, 7)).toBe('de'); // yedi
    expect(turkishTimeSuffix(22, 3)).toBe('te'); // üç
    expect(turkishTimeSuffix(22, 4)).toBe('te'); // dört
    expect(turkishTimeSuffix(22, 5)).toBe('te'); // beş
    expect(turkishTimeSuffix(22, 6)).toBe('da'); // altı
    expect(turkishTimeSuffix(21, 40)).toBe('ta'); // kırk
    expect(turkishTimeSuffix(21, 30)).toBe('da'); // otuz
    expect(turkishTimeSuffix(21, 10)).toBe('da'); // on
    expect(turkishTimeSuffix(21, 20)).toBe('de'); // yirmi
    expect(turkishTimeSuffix(21, 50)).toBe('de'); // elli
    expect(turkishTimeSuffix(22, 0)).toBe('de'); // yirmi iki
    expect(turkishTimeSuffix(10, 0)).toBe('da'); // on
    expect(turkishTimeSuffix(0, 0)).toBe('da'); // sıfır
  });

  it('gives the suffix only in Turkish', () => {
    expect(clockParams(new Date(at(22, 19)), 'tr')).toEqual({ time: '22:19', suffix: 'da' });
    expect(clockParams(new Date(at(22, 19)), 'en')).toEqual({ time: '22:19', suffix: '' });
  });

  it('formats the countdown', () => {
    expect(formatCountdown(1122)).toBe('18:42');
    expect(formatCountdown(59.2)).toBe('1:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

describe('upcomingQueue', () => {
  const entries = [entry('a'), entry('b'), entry('c'), entry('d')];

  afterEach(() => resetNarrationDurationsForTests());

  it('lists the entries after the playing one, in order, with the real lengths the device knows', () => {
    rememberNarrationDuration('n-b', 287_000);
    rememberNarrationDuration('n-d', 301_500);
    expect(upcomingQueue(entries, 'n-a')).toEqual([
      { title: 'Masal b', durationSec: 287 },
      // Never played on this device: unknown, not the backend's estimate.
      { title: 'Masal c', durationSec: null },
      { title: 'Masal d', durationSec: 301.5 },
    ]);
    expect(upcomingQueue(entries, 'n-c')).toEqual([{ title: 'Masal d', durationSec: 301.5 }]);
    expect(upcomingQueue(entries, 'n-d')).toEqual([]);
  });

  it('is empty without a queue context or when the playing narration is not queued', () => {
    expect(upcomingQueue(entries, 'n-x')).toEqual([]);
    expect(upcomingQueue(entries, null)).toEqual([]);
    expect(upcomingQueue(entries, undefined)).toEqual([]);
    expect(upcomingQueue([], 'n-a')).toEqual([]);
  });

  it('reads lengths through the given lookup and drops broken ones', () => {
    const lengths: Record<string, number | null> = { 'n-b': 0, 'n-c': Number.NaN, 'n-d': 90_000 };
    expect(upcomingQueue(entries, 'n-a', id => lengths[id] ?? null)).toEqual([
      { title: 'Masal b', durationSec: null },
      { title: 'Masal c', durationSec: null },
      { title: 'Masal d', durationSec: 90 },
    ]);
  });

  it('names an entry without a known title by the generic word', () => {
    expect(upcomingQueue([entry('a'), entry('b', '')], 'n-a')).toEqual([{ title: 'Masal', durationSec: null }]);
  });

  it('counts the playing story in the maximum', () => {
    expect(maxStoryCount([])).toBe(1);
    expect(maxStoryCount(upcomingQueue(entries, 'n-a'))).toBe(4);
  });
});

describe('holdStop', () => {
  const t0 = at(21, 50, 50);

  it('keeps the shown stop while it moves less than 30 s, so the minute never flips', () => {
    const first = holdStop(null, 'k', new Date(t0));
    expect(first).toEqual({ key: 'k', atMs: t0 });
    // 21:50:50 and 21:51:10 name different minutes; the line keeps the first.
    expect(holdStop(first, 'k', new Date(t0 + 20_000))).toBe(first);
    expect(holdStop(first, 'k', new Date(t0 - 29_999))).toBe(first);
    expect(holdStop(first, 'k', new Date(t0 + STOP_LINE_HOLD_MS))).toEqual({ key: 'k', atMs: t0 + 30_000 });
  });

  it('takes a new stop at once when its inputs change or it becomes known or unknown', () => {
    const first = holdStop(null, 'title|1|1', new Date(t0));
    expect(holdStop(first, 'title|2|1', new Date(t0 + 1000))).toEqual({ key: 'title|2|1', atMs: t0 + 1000 });
    const unknown = holdStop(first, 'title|1|1', null);
    expect(unknown).toEqual({ key: 'title|1|1', atMs: null });
    expect(holdStop(unknown, 'title|1|1', null)).toBe(unknown);
    expect(holdStop(unknown, 'title|1|1', new Date(t0))).toEqual({ key: 'title|1|1', atMs: t0 });
  });
});

describe('storyStop', () => {
  // The example of the mockup: 21:42, Bremen has 3:48 left, Uykulu Ay is 5 minutes.
  const base = {
    currentTitle: 'Bremen Mızıkacıları',
    remainingSec: 228,
    queue: [
      { title: 'Uykulu Ay', durationSec: 300 },
      { title: 'Parmak Kız', durationSec: null },
    ],
    speed: 1,
    nowMs: at(21, 42, 12),
  };

  it('1 stops after the playing story', () => {
    const stop = storyStop({ ...base, storyCount: 1 });
    expect(stop.title).toBe('Bremen Mızıkacıları');
    expect(formatClockTime(stop.at as Date)).toBe('21:46');
  });

  it('2 stops after the next queued story, as in frame 25', () => {
    const stop = storyStop({ ...base, storyCount: 2 });
    expect(stop.title).toBe('Uykulu Ay');
    expect(formatClockTime(stop.at as Date)).toBe('21:51');
  });

  it('divides the way by the speed', () => {
    const stop = storyStop({ ...base, storyCount: 2, speed: 2 });
    expect(formatClockTime(stop.at as Date)).toBe('21:46');
  });

  it('has no time when a length on the way is unknown', () => {
    expect(storyStop({ ...base, storyCount: 3 })).toEqual({ title: 'Parmak Kız', at: null });
    expect(storyStop({ ...base, remainingSec: null, storyCount: 1 }).at).toBeNull();
  });

  it('clamps the count to the queue', () => {
    expect(storyStop({ ...base, storyCount: 9 }).title).toBe('Parmak Kız');
    expect(storyStop({ ...base, storyCount: 0 }).title).toBe('Bremen Mızıkacıları');
  });
});

describe('duration timer', () => {
  it('adds the minutes to now', () => {
    expect(formatClockTime(durationStop(37, at(21, 42)))).toBe('22:19');
  });

  it('clamps to 1..180 whole minutes', () => {
    expect(clampMinutes(0)).toBe(1);
    expect(clampMinutes(500)).toBe(180);
    expect(clampMinutes(24.6)).toBe(25);
    expect(clampMinutes(Number.NaN)).toBe(1);
  });
});

describe('timerChips', () => {
  it('computes the three chips of frame 25a', () => {
    expect(
      timerChips({ remainingSec: 228, nextDurationSec: 300, lastDurationMin: 25, speed: 1 }),
    ).toEqual([
      { kind: 'thisStory', minutes: 4 },
      { kind: 'withNext', minutes: 9 },
      { kind: 'last', minutes: 25 },
    ]);
  });

  it('leaves out a chip with nothing to show', () => {
    expect(timerChips({ remainingSec: 228, nextDurationSec: null, lastDurationMin: null, speed: 1 })).toEqual([
      { kind: 'thisStory', minutes: 4 },
    ]);
    expect(timerChips({ remainingSec: null, nextDurationSec: 300, lastDurationMin: 25, speed: 1 })).toEqual([
      { kind: 'last', minutes: 25 },
    ]);
    expect(timerChips({ remainingSec: 0, nextDurationSec: null, lastDurationMin: null, speed: 1 })).toEqual([]);
  });

  it('leaves out a chip that repeats an earlier value', () => {
    expect(timerChips({ remainingSec: 228, nextDurationSec: 300, lastDurationMin: 9, speed: 1 })).toEqual([
      { kind: 'thisStory', minutes: 4 },
      { kind: 'withNext', minutes: 9 },
    ]);
  });

  it('divides by the speed and stays inside the wheel range', () => {
    expect(timerChips({ remainingSec: 228, nextDurationSec: 300, lastDurationMin: null, speed: 2 })).toEqual([
      { kind: 'thisStory', minutes: 2 },
      { kind: 'withNext', minutes: 5 },
    ]);
    expect(timerChips({ remainingSec: 60, nextDurationSec: 20000, lastDurationMin: 240, speed: 1 })).toEqual([
      { kind: 'thisStory', minutes: 1 },
    ]);
  });
});

describe('sleepTimerEntryLabel', () => {
  const state = { active: true, mode: 'stories' as const, storiesLeft: 1, remainingSeconds: 0 };

  it('off: the tile name over "Kapalı"', () => {
    expect(sleepTimerEntryLabel({ ...state, active: false })).toEqual({ label: 'Zamanlayıcı', value: 'Kapalı' });
    // Off wins over whatever the mode holds.
    expect(sleepTimerEntryLabel({ ...state, active: false, mode: 'duration', remainingSeconds: 600 })).toEqual({
      label: 'Zamanlayıcı',
      value: 'Kapalı',
    });
  });

  it('stories: "Bu masal" for the last one, "n masal" before', () => {
    expect(sleepTimerEntryLabel(state)).toEqual({ label: 'Zamanlayıcı', value: 'Bu masal' });
    expect(sleepTimerEntryLabel({ ...state, storiesLeft: 0 })).toEqual({ label: 'Zamanlayıcı', value: 'Bu masal' });
    expect(sleepTimerEntryLabel({ ...state, storiesLeft: 3 })).toEqual({ label: 'Zamanlayıcı', value: '3 masal' });
  });

  it('duration: "Kalan süre" over the bare countdown', () => {
    const duration = { ...state, mode: 'duration' as const };
    expect(sleepTimerEntryLabel({ ...duration, remainingSeconds: 892 })).toEqual({
      label: 'Kalan süre',
      value: '14:52',
    });
    expect(sleepTimerEntryLabel({ ...duration, remainingSeconds: 1080 }).value).toBe('18:00');
    expect(sleepTimerEntryLabel({ ...duration, remainingSeconds: 4.2 }).value).toBe('0:05');
    expect(sleepTimerEntryLabel({ ...duration, remainingSeconds: 180 * 60 }).value).toBe('180:00');
  });

  it('is translated', async () => {
    await i18n.changeLanguage('en');
    expect(sleepTimerEntryLabel({ ...state, active: false })).toEqual({ label: 'Timer', value: 'Off' });
    expect(sleepTimerEntryLabel(state).value).toBe('This story');
    expect(sleepTimerEntryLabel({ ...state, storiesLeft: 3 }).value).toBe('3 stories');
    expect(sleepTimerEntryLabel({ ...state, mode: 'duration', remainingSeconds: 600 })).toEqual({
      label: 'Time left',
      value: '10:00',
    });
  });
});

describe('storiesValueText', () => {
  it('says one story in the singular', async () => {
    expect(storiesValueText(1)).toBe('1 masal');
    expect(storiesValueText(3)).toBe('3 masal');
    await i18n.changeLanguage('en');
    expect(storiesValueText(1)).toBe('1 story');
    expect(storiesValueText(2)).toBe('2 stories');
  });
});
