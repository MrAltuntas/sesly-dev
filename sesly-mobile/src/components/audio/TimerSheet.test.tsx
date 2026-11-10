/**
 * TimerSheet (SPEC-audio 7.5) on the real SleepTimerService: one fixed body
 * height in every mode and state, the controls that turn the timer on in
 * their own mode, the wheel with its rest delay and quick picks, the
 * countdown slot, the stories layouts with and without a queue, a stop line
 * that never flips, the render cost of a running countdown, and a mode
 * switch that only cross-fades two mounted bodies (LR-3). Then the player's
 * wrapper (PlayerTimerSheet) on a fake audio store and the real queue, with
 * props that keep their identity across status reports.
 */

import React from 'react';
import { Animated, PixelRatio } from 'react-native';
import { act, configure, fireEvent, screen } from '@testing-library/react-native';
import { makeAutoObservable, runInAction } from 'mobx';

import { renderScreen } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { DURATION } from '../../theme/motion';
import sleepTimerService from '../../services/SleepTimerService';
import { queueStore } from '../../stores/QueueStore';
import { queueSheet } from '../../stores/queueSheet';
import type { NarrationMeta } from '../../stores/narrationMeta';
import {
  rememberNarrationDuration,
  resetNarrationDurationsForTests,
} from '../../utils/narrationDurations';
import {
  TIMER_SLOT_HEIGHT,
  TimerSheet,
  WHEEL_REST_MS,
  timerBodyHeight,
} from './TimerSheet';
import { PlayerTimerSheet } from './PlayerTimerSheet';
import { WHEEL_ROW_HEIGHT } from './MinuteWheel';
import type { UpcomingStory } from './playerMath';

jest.setTimeout(60000);

// Hidden layers (the slot's other half) are still looked at.
beforeAll(() => configure({ defaultIncludeHiddenElements: true }));
afterAll(() => configure({ defaultIncludeHiddenElements: false }));

const mockPrefsUpdate = jest.fn();
jest.mock('../../services/UserPreferencesService', () => ({
  __esModule: true,
  default: {
    getCachedSync: () => null,
    get: jest.fn(() => new Promise(() => undefined)),
    update: (...args: unknown[]) => mockPrefsUpdate(...args),
  },
}));
jest.mock('../../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

// Render counters around the real SegmentedControl and MinuteWheel: they
// render exactly when the sheet does.
const mockRenders = { segments: 0, wheel: 0, wheelMounts: 0 };
jest.mock('../design/controls', () => {
  const React = require('react');
  const actual = jest.requireActual('../design/controls');
  return {
    ...actual,
    SegmentedControl: (props: Record<string, unknown>) => {
      mockRenders.segments += 1;
      return React.createElement(actual.SegmentedControl, props);
    },
  };
});
jest.mock('./MinuteWheel', () => {
  const React = require('react');
  const actual = jest.requireActual('./MinuteWheel');
  const Counted = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    mockRenders.wheel += 1;
    React.useEffect(() => {
      mockRenders.wheelMounts += 1;
    }, []);
    return React.createElement(actual.MinuteWheel, { ...props, ref });
  });
  return { ...actual, MinuteWheel: Counted };
});

// The audio store of PlayerTimerSheet.
const mockAudio = makeAutoObservable({
  isStoryLoaded: true,
  storyEnded: false,
  audioId: 'n-bremen',
  currentStory: { title: 'Bremen Mızıkacıları' } as { title: string } | null,
  totalDurationMs: 600_000,
  currentPositionMs: 372_000,
  playbackSpeed: 1,
});
jest.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => mockAudio,
}));

// The example of the mockups: it is 21:42, Bremen Mızıkacıları has 3:48
// left, the next story is Uykulu Ay (5 minutes).
const NOW = new Date(2026, 9, 13, 21, 42, 10).getTime();
const QUEUE: UpcomingStory[] = [
  { title: 'Uykulu Ay', durationSec: 300 },
  { title: 'Parmak Kız', durationSec: 300 },
];

const store = sleepTimerService.store;

const flat = (node: { props: { style?: unknown } }) => {
  const style = node.props.style;
  const list = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...list.filter(Boolean)) as Record<string, unknown>;
};

type SheetProps = React.ComponentProps<typeof TimerSheet>;

function sheet(props: Partial<SheetProps> = {}, onClose = jest.fn()) {
  return (
    <TimerSheet
      visible
      onClose={onClose}
      currentTitle="Bremen Mızıkacıları"
      remainingSec={228}
      queue={QUEUE}
      speed={1}
      {...props}
    />
  );
}

async function renderSheet(props: Partial<SheetProps> = {}, theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi') {
  const onClose = jest.fn();
  const view = await renderScreen(sheet(props, onClose), { theme });
  return { onClose, view };
}

/** The stop line of the body that is shown (both bodies are mounted). */
const stopLine = () => screen.getByTestId(`timer-stop-line-${store.mode}`);
const bodyHeight = () => flat(screen.getByTestId('timer-body')).height;
const wheelNow = () => screen.getByTestId('minute-wheel-value').props.accessibilityValue.now;
const tapPlus = () => {
  fireEvent(screen.getByTestId('minute-wheel-plus'), 'pressIn');
  fireEvent(screen.getByTestId('minute-wheel-plus'), 'pressOut');
};
const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });
/** The segmented control hands a choice over in the next frame. */
const pickSegment = (label: string) => {
  fireEvent.press(screen.getByLabelText(label));
  advance(16);
};
const countdownText = () => String(screen.getByTestId('timer-countdown').props.children);

beforeEach(() => {
  // React Native's Jest setup reports a system font scale of 2.
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
  jest.setSystemTime(NOW);
  sleepTimerService.turnOff();
  runInAction(() => {
    store.mode = 'stories';
    store.storyCount = 1;
    store.lastDurationMin = null;
    store.fadeOut = true;
  });
  mockPrefsUpdate.mockReset();
  mockPrefsUpdate.mockResolvedValue({});
  mockRenders.segments = 0;
  mockRenders.wheel = 0;
  mockRenders.wheelMounts = 0;
});

afterEach(async () => {
  sleepTimerService.turnOff();
  await i18n.changeLanguage('tr');
});

describe('TimerSheet, one body height', () => {
  it('is 194dp at font scale 1 and 200dp from 1.3 on', () => {
    expect(timerBodyHeight(1)).toBe(194);
    expect(timerBodyHeight(1.3)).toBe(200);
    expect(timerBodyHeight(2)).toBe(200);
    expect(timerBodyHeight(0.85)).toBe(191);
    expect(timerBodyHeight(Number.NaN)).toBe(194);
  });

  it('keeps it in every mode and state', async () => {
    const H = timerBodyHeight(1);
    // Stories, with a queue.
    await renderSheet();
    expect(bodyHeight()).toBe(H);
    // A stepper tap with a long title on the stop line.
    const longTitle = 'Ormanın Derinliklerindeki Küçük Ayıcık ve Yıldız Tozu Masalı';
    expect(longTitle).toHaveLength(60);
    screen.unmount();
    await renderSheet({ queue: [{ title: longTitle, durationSec: 300 }, QUEUE[1]] });
    fireEvent.press(screen.getByTestId('timer-stepper-plus'));
    expect(store.storiesLeft).toBe(2);
    expect(stopLine().props.numberOfLines).toBe(2);
    expect(bodyHeight()).toBe(H);
    screen.unmount();

    // Stories, without a queue.
    await renderSheet({ queue: [] });
    expect(bodyHeight()).toBe(H);

    // Duration, off.
    pickSegment('Süre dolunca');
    act(() => sleepTimerService.turnOff());
    expect(screen.getByTestId('timer-wheel')).toBeOnTheScreen();
    expect(bodyHeight()).toBe(H);

    // Duration, running.
    fireEvent.press(screen.getByTestId('timer-switch'));
    expect(store.isDurationRunning).toBe(true);
    expect(bodyHeight()).toBe(H);
  });

  it('is the 1.3 height at a large system font, and every body text stops growing there', async () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1.3);
    await renderSheet();
    expect(bodyHeight()).toBe(timerBodyHeight(1.3));
    for (const id of ['timer-stop-line-stories', 'timer-upcoming']) {
      expect(screen.getByTestId(id).props.maxFontSizeMultiplier).toBe(1.3);
    }
    screen.unmount();
    runInAction(() => {
      store.mode = 'duration';
    });
    await renderSheet();
    expect(bodyHeight()).toBe(200);
    expect(screen.getByTestId('timer-countdown').props.maxFontSizeMultiplier).toBe(1.3);
    expect(stopLine().props.maxFontSizeMultiplier).toBe(1.3);
  });
});

describe('TimerSheet, off', () => {
  it('nothing is dimmed or blocked, and the fade-out row is there', async () => {
    await renderSheet();
    expect(screen.getByText('Uyku zamanlayıcısı')).toBeOnTheScreen();
    expect(screen.getByTestId('timer-switch').props.accessibilityState.checked).toBe(false);
    expect(screen.getByTestId('timer-fade')).toBeOnTheScreen();
    expect(flat(screen.getByTestId('timer-body')).opacity).toBeUndefined();
    expect(screen.getByTestId('timer-body').props.pointerEvents).toBeUndefined();
    expect(screen.getByTestId('timer-stepper-plus')).toBeEnabled();
    // The stop line is quieter while off.
    expect(flat(stopLine()).color).toBe(themes['gece-mavisi'].text2);
    // Off, the controls say what a tap does.
    expect(screen.getByTestId('timer-stepper').props.accessibilityHint).toBe('Dokununca zamanlayıcı açılır');
    // No Uygula, no Vazgeç.
    expect(screen.queryByText('Uygula')).toBeNull();
    expect(screen.queryByText('Vazgeç')).toBeNull();
  });

  it('"Süre dolunca" turns it on in duration mode', async () => {
    runInAction(() => {
      store.lastDurationMin = 25;
    });
    await renderSheet();
    pickSegment('Süre dolunca');
    expect(store.active).toBe(true);
    expect(store.mode).toBe('duration');
    // Started in the frame after the press.
    const startedAt = (store.endsAtMs as number) - 25 * 60000;
    expect(startedAt).toBeGreaterThanOrEqual(NOW);
    expect(startedAt).toBeLessThanOrEqual(NOW + 16);
    expect(wheelNow()).toBe(25);
    expect(flat(stopLine()).color).toBe(themes['gece-mavisi'].text);
  });

  it('"Masal bitince" turns it on in stories mode', async () => {
    runInAction(() => {
      store.mode = 'duration';
    });
    await renderSheet();
    pickSegment('Masal bitince');
    expect(store.active).toBe(true);
    expect(store.mode).toBe('stories');
    expect(store.storiesLeft).toBe(1);
  });

  it('the stepper plus turns it on in stories mode with the new count', async () => {
    await renderSheet();
    fireEvent.press(screen.getByTestId('timer-stepper-plus'));
    expect(store.active).toBe(true);
    expect(store.mode).toBe('stories');
    expect(store.storiesLeft).toBe(2);
    expect(mockPrefsUpdate).toHaveBeenCalledWith({ settings: { sleepTimerStoryCount: 2 } });
  });

  it('a quick pick starts that duration and moves the wheel', async () => {
    runInAction(() => {
      store.mode = 'duration';
      store.lastDurationMin = 25;
    });
    await renderSheet();
    expect(store.active).toBe(false);
    fireEvent.press(screen.getByTestId('timer-chip-withNext'));
    expect(store.isDurationRunning).toBe(true);
    expect(store.lastDurationMin).toBe(9);
    expect(store.endsAtMs).toBe(NOW + 9 * 60000);
    expect(wheelNow()).toBe(9);
    // Applied at once: nothing restarts it when the rest delay would have passed.
    advance(WHEEL_REST_MS * 2);
    expect(store.endsAtMs).toBe(NOW + 9 * 60000);
  });

  it('a wheel that rests starts the timer although it was off', async () => {
    runInAction(() => {
      store.mode = 'duration';
      store.lastDurationMin = 25;
    });
    await renderSheet();
    tapPlus();
    expect(store.active).toBe(false);
    advance(WHEEL_REST_MS);
    expect(store.isDurationRunning).toBe(true);
    expect(store.lastDurationMin).toBe(26);
  });

  it('the switch turns the timer on in the mode shown, and off again', async () => {
    await renderSheet();
    fireEvent.press(screen.getByTestId('timer-switch'));
    expect(store.active).toBe(true);
    expect(store.mode).toBe('stories');
    expect(screen.getByLabelText('Masal bitince').props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByTestId('timer-switch'));
    expect(store.active).toBe(false);
    expect(screen.getByTestId('timer-stories')).toBeOnTheScreen();
  });

  it('the switch with a wheel still moving starts on the wheel minute', async () => {
    runInAction(() => {
      store.mode = 'duration';
      store.lastDurationMin = 25;
    });
    await renderSheet();
    tapPlus();
    tapPlus();
    fireEvent.press(screen.getByTestId('timer-switch'));
    expect(store.lastDurationMin).toBe(27);
    expect(store.endsAtMs).toBe(NOW + 27 * 60000);
    advance(WHEEL_REST_MS * 2);
    expect(store.endsAtMs).toBe(NOW + 27 * 60000);
  });

  it('the fade-out switch works while the timer is off', async () => {
    await renderSheet();
    fireEvent.press(screen.getByTestId('timer-fade'));
    expect(store.fadeOut).toBe(false);
    expect(mockPrefsUpdate).toHaveBeenCalledWith({ sleepTimerFadeOut: false });
  });

  it('the title of a header that carries a control: one line, one step smaller', async () => {
    await renderSheet();
    const title = screen.getByTestId('sheet-title');
    expect(title).toHaveTextContent('Uyku zamanlayıcısı');
    expect(title.props.numberOfLines).toBe(1);
    expect(flat(title).fontSize).toBe(18);
  });
});

describe('TimerSheet, "Masal bitince"', () => {
  beforeEach(() => {
    sleepTimerService.turnOn({ maxStories: 3 });
  });

  it('with two stories queued: the stepper goes to 3 and the upcoming line names them', async () => {
    await renderSheet();
    expect(screen.getByText('Kaç masal sonra')).toBeOnTheScreen();
    expect(screen.getByText('1, bu masal demek')).toBeOnTheScreen();
    expect(screen.getByTestId('timer-stepper-value')).toHaveTextContent('1');
    expect(screen.getByTestId('timer-stepper').props.accessibilityValue.max).toBe(3);
    expect(screen.getByTestId('timer-upcoming')).toHaveTextContent('Sırada: Uykulu Ay, Parmak Kız');
    expect(screen.getByTestId('timer-upcoming').props.numberOfLines).toBe(2);
    expect(stopLine()).toHaveTextContent("Bremen Mızıkacıları bitince, 21:45'te durur");

    fireEvent.press(screen.getByTestId('timer-stepper-plus'));
    fireEvent.press(screen.getByTestId('timer-stepper-plus'));
    expect(store.storiesLeft).toBe(3);
    expect(screen.getByTestId('timer-stepper-plus')).toBeDisabled();
    expect(stopLine()).toHaveTextContent("Parmak Kız bitince, 21:55'te durur");
    expect(screen.queryByTestId('timer-open-queue')).toBeNull();
  });

  it('a stepper tap moves the stop at once', async () => {
    await renderSheet();
    fireEvent.press(screen.getByTestId('timer-stepper-plus'));
    expect(stopLine()).toHaveTextContent("Uykulu Ay bitince, 21:50'de durur");
    expect(mockPrefsUpdate).toHaveBeenLastCalledWith({ settings: { sleepTimerStoryCount: 2 } });
  });

  it('without a queue: no stepper, the hint, and "Sırayı aç" asks for the queue', async () => {
    const onOpenQueue = jest.fn();
    await renderSheet({ queue: [], onOpenQueue });
    expect(screen.queryByTestId('timer-stepper')).toBeNull();
    expect(screen.queryByText('Kaç masal sonra')).toBeNull();
    expect(stopLine()).toHaveTextContent("Bremen Mızıkacıları bitince, 21:45'te durur");
    expect(screen.getByTestId('timer-queue-hint')).toHaveTextContent(
      'Sıraya masal eklersen kaç masal sonra duracağını seçebilirsin.',
    );
    fireEvent.press(screen.getByText('Sırayı aç'));
    expect(onOpenQueue).toHaveBeenCalledTimes(1);
  });

  it('without an onOpenQueue there is no button', async () => {
    await renderSheet({ queue: [] });
    expect(screen.getByTestId('timer-queue-hint')).toBeOnTheScreen();
    expect(screen.queryByTestId('timer-open-queue')).toBeNull();
  });

  it('divides the story lengths by the speed', async () => {
    await renderSheet({ speed: 2 });
    // 228 s of audio at 2,0x is 114 s: 21:42:10 + 1:54 = 21:44.
    expect(stopLine()).toHaveTextContent("Bremen Mızıkacıları bitince, 21:44'te durur");
  });

  it('names the story without a time while a length is unknown', async () => {
    await renderSheet({ remainingSec: null });
    expect(stopLine()).toHaveTextContent('Bremen Mızıkacıları bitince durur');
  });

  it('the stop line does not flip across a minute while the time left wobbles by a second', async () => {
    // Stop at 21:51:59 / 21:52:00: right on a minute boundary.
    jest.setSystemTime(new Date(2026, 9, 13, 21, 42, 0).getTime());
    const { view } = await renderSheet({ remainingSec: 600, queue: [] });
    const first = stopLine().props.children;
    const seen = new Set<string>([String(first)]);
    for (let i = 1; i <= 12; i++) {
      jest.setSystemTime(new Date(2026, 9, 13, 21, 42, i).getTime() - (i % 2 === 0 ? 1 : 0));
      view.rerender(sheet({ remainingSec: i % 2 === 0 ? 600 : 599, queue: [] }));
      seen.add(String(stopLine().props.children));
    }
    expect(seen.size).toBe(1);
    // A real change of input (the story count) updates it at once.
    view.rerender(sheet({ remainingSec: 600 }));
    fireEvent.press(screen.getByTestId('timer-stepper-plus'));
    expect(stopLine()).toHaveTextContent(/^Uykulu Ay bitince, /);
  });

  it('switching to "Süre dolunca" starts a duration timer at once and shows the wheel', async () => {
    await renderSheet();
    pickSegment('Süre dolunca');
    expect(store.mode).toBe('duration');
    expect(store.isDurationRunning).toBe(true);
    expect(store.remainingSeconds).toBe(20 * 60);
    expect(screen.getByTestId('timer-wheel')).toBeOnTheScreen();
    // The stories body stays mounted under it, hidden.
    expect(screen.getByTestId('timer-stories').props.pointerEvents).toBe('none');
    expect(screen.getByTestId('timer-wheel').props.pointerEvents).toBe('box-none');
  });

  it('says "1 story" in English for one story', async () => {
    await i18n.changeLanguage('en');
    await renderSheet();
    expect(screen.getByTestId('timer-stepper').props.accessibilityValue.text).toBe('1 story');
    fireEvent.press(screen.getByTestId('timer-stepper-plus'));
    expect(screen.getByTestId('timer-stepper').props.accessibilityValue.text).toBe('2 stories');
  });
});

describe('TimerSheet, "Süre dolunca"', () => {
  beforeEach(() => {
    runInAction(() => {
      store.mode = 'duration';
      store.lastDurationMin = 25;
    });
  });

  async function openWheel(props: Partial<SheetProps> = {}) {
    const result = await renderSheet(props);
    fireEvent.press(screen.getByTestId('timer-switch'));
    return result;
  }

  it('opens on the last used duration; running, the line names the real deadline', async () => {
    await renderSheet();
    expect(wheelNow()).toBe(25);
    expect(stopLine()).toHaveTextContent("25 dk, 22:07'de durur");
    expect(stopLine().props.numberOfLines).toBe(1);
    fireEvent.press(screen.getByTestId('timer-switch'));
    expect(stopLine()).toHaveTextContent("22:07'de durur");
    expect(screen.getAllByText('dk')).toHaveLength(1);
  });

  it('the stop line follows the wheel; the timer restarts once it has rested', async () => {
    await openWheel();
    advance(5000);
    tapPlus();
    tapPlus();
    expect(wheelNow()).toBe(27);
    expect(stopLine()).toHaveTextContent("27 dk, 22:09'da durur");
    // Still the timer that was started with 25 minutes.
    expect(store.remainingSeconds).toBe(25 * 60 - 4);

    advance(WHEEL_REST_MS - 100);
    expect(store.lastDurationMin).toBe(25);
    advance(100);
    expect(store.lastDurationMin).toBe(27);
    expect(store.endsAtMs).toBe(NOW + 5000 + WHEEL_REST_MS + 27 * 60000);
    expect(mockPrefsUpdate).toHaveBeenLastCalledWith({ sleepTimerLastDuration: 27 });
  });

  it('every move of the wheel restarts the rest delay', async () => {
    await openWheel();
    tapPlus();
    advance(WHEEL_REST_MS - 200);
    tapPlus();
    advance(WHEEL_REST_MS - 200);
    expect(store.lastDurationMin).toBe(25);
    advance(200);
    expect(store.lastDurationMin).toBe(27);
  });

  it('closing before the wheel rested still applies the value', async () => {
    const { view } = await openWheel();
    tapPlus();
    view.rerender(sheet({ visible: false }));
    expect(store.lastDurationMin).toBe(26);
    expect(store.remainingSeconds).toBe(26 * 60);
  });

  it('turned off before the wheel rested and on again: the minute the wheel shows', async () => {
    await openWheel();
    tapPlus();
    tapPlus();
    fireEvent.press(screen.getByTestId('timer-switch'));
    advance(WHEEL_REST_MS * 2);
    expect(store.active).toBe(false);
    expect(wheelNow()).toBe(27);
    expect(stopLine()).toHaveTextContent("27 dk, 22:09'da durur");

    fireEvent.press(screen.getByTestId('timer-switch'));
    expect(store.lastDurationMin).toBe(27);
    expect(store.endsAtMs).toBe(NOW + WHEEL_REST_MS * 2 + 27 * 60000);
  });

  it('the quick picks: the short labels, one row that scrolls sideways', async () => {
    await renderSheet();
    expect(screen.getByText('Bu masal (4 dk)')).toBeOnTheScreen();
    expect(screen.getByText('Sıradakiyle (9 dk)')).toBeOnTheScreen();
    expect(screen.getByText('Son seçim (25 dk)')).toBeOnTheScreen();
    expect(screen.getByTestId('timer-chip-withNext').props.accessibilityRole).toBe('button');
    expect(screen.getByTestId('timer-chip-withNext').props.accessibilityState?.selected).toBeUndefined();
  });

  it('the quick picks are in English', async () => {
    await i18n.changeLanguage('en');
    await renderSheet();
    expect(screen.getByText('This story (4 min)')).toBeOnTheScreen();
    expect(screen.getByText('With next (9 min)')).toBeOnTheScreen();
    expect(screen.getByText('Last time (25 min)')).toBeOnTheScreen();
    // The wheel says one minute in the singular.
    const wheel = () => screen.getByTestId('minute-wheel-value').props.accessibilityValue.text;
    expect(wheel()).toBe('25 minutes');
    fireEvent.press(screen.getByTestId('timer-chip-thisStory'));
    for (let i = 0; i < 3; i++) {
      fireEvent(screen.getByTestId('minute-wheel-minus'), 'pressIn');
      fireEvent(screen.getByTestId('minute-wheel-minus'), 'pressOut');
    }
    expect(wheel()).toBe('1 minute');
  });

  it('the slot is a horizontal ScrollView of 46dp, also with no quick pick to show', async () => {
    runInAction(() => {
      store.lastDurationMin = null;
    });
    await renderSheet({ queue: [], remainingSec: null });
    const chips = screen.getByTestId('timer-chips');
    expect(chips.props.horizontal).toBe(true);
    expect(flat(chips).height).toBe(TIMER_SLOT_HEIGHT);
    expect(TIMER_SLOT_HEIGHT).toBe(46);
    expect(flat(screen.getByTestId('timer-slot')).height).toBe(46);
    expect(screen.queryByTestId('timer-chip-thisStory')).toBeNull();
    expect(screen.queryByTestId('timer-chip-last')).toBeNull();
    expect(wheelNow()).toBe(20);
  });

  it('leaves out chips with nothing to show or a repeated value', async () => {
    runInAction(() => {
      store.lastDurationMin = 4;
    });
    await renderSheet({ queue: [] });
    expect(screen.getByText('Bu masal (4 dk)')).toBeOnTheScreen();
    expect(screen.queryByTestId('timer-chip-withNext')).toBeNull();
    expect(screen.queryByTestId('timer-chip-last')).toBeNull();
  });

  it('mounts the wheel once per opening; the switch and the running state never remount it', async () => {
    const { view } = await renderSheet();
    expect(mockRenders.wheelMounts).toBe(1);
    fireEvent.press(screen.getByTestId('timer-switch'));
    fireEvent.press(screen.getByTestId('timer-add-five'));
    fireEvent.press(screen.getByTestId('timer-switch'));
    expect(mockRenders.wheelMounts).toBe(1);
    // Another mode and back: the same wheel, only hidden and shown (LR-3).
    pickSegment('Masal bitince');
    pickSegment('Süre dolunca');
    expect(mockRenders.wheelMounts).toBe(1);
    // Closed and opened again: a fresh wheel on the remembered minute.
    view.rerender(sheet({ visible: false }));
    await act(async () => undefined);
    view.rerender(sheet({ visible: true }));
    await act(async () => undefined);
    expect(mockRenders.wheelMounts).toBe(2);
    expect(wheelNow()).toBe(store.durationMin);
  });

  it('a quick pick is not restarted by the minutes the wheel passes on its way to it', async () => {
    await renderSheet();
    fireEvent.press(screen.getByTestId('timer-chip-withNext'));
    // The wheel scrolls from 25 to 9 and reports the offsets on the way.
    for (const minute of [25, 22, 18, 13, 10, 9]) {
      fireEvent.scroll(screen.getByTestId('minute-wheel-scroll'), {
        nativeEvent: { contentOffset: { x: 0, y: (minute - 1) * WHEEL_ROW_HEIGHT } },
      });
    }
    // The line names the deadline that runs, not a wheel value about to restart it.
    expect(stopLine()).toHaveTextContent("21:51'de durur");
    advance(WHEEL_REST_MS * 2);
    expect(store.endsAtMs).toBe(NOW + 9 * 60000);
    expect(mockPrefsUpdate).toHaveBeenCalledTimes(1);
  });

  it('switching back to "Masal bitince" drops a value that has not rested', async () => {
    await openWheel();
    tapPlus();
    pickSegment('Masal bitince');
    advance(WHEEL_REST_MS * 2);
    expect(store.mode).toBe('stories');
    expect(store.endsAtMs).toBeNull();
    expect(store.lastDurationMin).toBe(25);
    // Back on the wheel: it shows the timer's minute, not the dropped one.
    pickSegment('Süre dolunca');
    expect(wheelNow()).toBe(25);
  });
});

describe('TimerSheet, mode switch (LR-3)', () => {
  type Node = ReturnType<typeof screen.getByTestId>;
  /**
   * The opacity a body is drawn with: the animated value its Animated.View
   * hands over (the host's props keep the first value under Jest).
   */
  const opacityOf = (node: Node): unknown => {
    let current: Node | null = node;
    while (current) {
      const opacity = flat(current).opacity as { __getValue?: () => number } | number | undefined;
      if (opacity && typeof opacity === 'object' && opacity.__getValue) return opacity.__getValue();
      current = current.parent;
    }
    return flat(node).opacity;
  };
  /** A body is hidden: transparent, untouchable, hidden from screen readers. */
  const expectHidden = (node: Node) => {
    expect(opacityOf(node)).toBe(0);
    expect(node.props.pointerEvents).toBe('none');
    expect(node.props.accessibilityElementsHidden).toBe(true);
    expect(node.props.importantForAccessibility).toBe('no-hide-descendants');
  };
  const expectShown = (node: Node) => {
    expect(opacityOf(node)).toBe(1);
    expect(node.props.pointerEvents).toBe('box-none');
    expect(node.props.accessibilityElementsHidden).toBe(false);
    expect(node.props.importantForAccessibility).toBe('auto');
  };
  /** The sheet is laid out and its enter has ended (`onOpened`). */
  const comeUp = () => {
    fireEvent(screen.getByTestId('timer-sheet'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 520 } },
    });
    advance(DURATION.sheetEnter + 100);
  };

  beforeEach(() => {
    sleepTimerService.turnOn({ maxStories: 3 });
  });

  it('opened in "Masal bitince": the wheel mounts once the sheet is up, hidden under the stories body', async () => {
    await renderSheet();
    // Not in the first frame of the opening: the sheet comes up without it.
    expect(screen.queryByTestId('timer-wheel')).toBeNull();
    expect(mockRenders.wheelMounts).toBe(0);
    comeUp();
    expect(mockRenders.wheelMounts).toBe(1);
    expectShown(screen.getByTestId('timer-stories'));
    expectHidden(screen.getByTestId('timer-wheel'));
    // Both inside the one fixed body, on top of each other.
    const body = screen.getByTestId('timer-body');
    for (const id of ['timer-stories', 'timer-wheel']) {
      expect(flat(screen.getByTestId(id))).toMatchObject({ position: 'absolute', top: 0, bottom: 0 });
      expect(body.findAll((node: Node) => node.props.testID === id).length).toBeGreaterThan(0);
    }
  });

  it('switching the mode neither mounts nor unmounts the wheel: the bodies cross-fade', async () => {
    await renderSheet();
    comeUp();
    expect(mockRenders.wheelMounts).toBe(1);
    // The pill's spring lands at once (on a device the value moves off the
    // JS thread); the bodies cross-fade from that same value.
    const spring = jest.spyOn(Animated, 'spring').mockImplementation(((
      value: Animated.Value,
      config: { toValue: number },
    ) => ({
      start: (done?: (result: { finished: boolean }) => void) => {
        value.setValue(config.toValue);
        done?.({ finished: true });
      },
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.spring);

    pickSegment('Süre dolunca');
    expect(store.mode).toBe('duration');
    // One position change on the native driver: the pill's spring.
    expect(spring).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 1, useNativeDriver: true }),
    );
    advance(DURATION.fast + 50);
    expectShown(screen.getByTestId('timer-wheel'));
    expectHidden(screen.getByTestId('timer-stories'));

    pickSegment('Masal bitince');
    advance(DURATION.fast + 50);
    expectShown(screen.getByTestId('timer-stories'));
    expectHidden(screen.getByTestId('timer-wheel'));

    pickSegment('Süre dolunca');
    advance(DURATION.fast + 50);
    expect(mockRenders.wheelMounts).toBe(1);
    expect(screen.getAllByTestId('minute-wheel')).toHaveLength(1);
    spring.mockRestore();
  });

  it('the body follows the pill at the press, before the sheet hears of the new mode (LR-3R)', async () => {
    await renderSheet();
    comeUp();
    let pill: Animated.Value | null = null;
    jest.spyOn(Animated, 'spring').mockImplementation(((value: Animated.Value) => ({
      start: () => {
        pill = value;
      },
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.spring);

    // The press: the pill starts to slide; the mode is handed over a frame later.
    fireEvent.press(screen.getByLabelText('Süre dolunca'));
    expect(store.mode).toBe('stories');
    expect(pill).not.toBeNull();
    // Half way along, both bodies are half drawn: they ride the pill's value.
    act(() => pill!.setValue(0.5));
    expect(opacityOf(screen.getByTestId('timer-wheel'))).toBeCloseTo(0.5, 5);
    expect(opacityOf(screen.getByTestId('timer-stories'))).toBeCloseTo(0.5, 5);
    // The spring's overshoot never draws a body above 1 or below 0.
    act(() => pill!.setValue(1.04));
    expect(opacityOf(screen.getByTestId('timer-wheel'))).toBe(1);
    expect(opacityOf(screen.getByTestId('timer-stories'))).toBe(0);

    advance(16);
    expect(store.mode).toBe('duration');
    expectShown(screen.getByTestId('timer-wheel'));
    expectHidden(screen.getByTestId('timer-stories'));
  });

  it('opened in "Süre dolunca": the first frame has only the rows around the minute, the rest once it is up (LR-4R)', async () => {
    runInAction(() => {
      store.mode = 'duration';
      store.lastDurationMin = 25;
    });
    await renderSheet();
    const rows = () => screen.queryAllByTestId(/^minute-wheel-row-\d+$/).length;
    expect(screen.getByTestId('timer-wheel')).toBeOnTheScreen();
    expect(rows()).toBeLessThan(20);
    expect(screen.getByTestId('minute-wheel-spacer-after')).toBeOnTheScreen();

    comeUp();
    expect(rows()).toBe(180);
    expect(mockRenders.wheelMounts).toBe(1);
  });

  it('opened in "Masal bitince": the hidden wheel waits with few rows until the switch', async () => {
    await renderSheet();
    comeUp();
    const rows = () => screen.queryAllByTestId(/^minute-wheel-row-\d+$/).length;
    expect(rows()).toBeLessThan(20);
    pickSegment('Süre dolunca');
    expect(rows()).toBe(180);
    // Switched back: the rows stay until the sheet has gone.
    pickSegment('Masal bitince');
    expect(rows()).toBe(180);
  });

  it('opened again after the mode changed while closed, the right body shows', async () => {
    const { view } = await renderSheet();
    comeUp();
    expectShown(screen.getByTestId('timer-stories'));
    view.rerender(sheet({ visible: false }));
    await act(async () => undefined);
    advance(DURATION.sheetExit + 100);
    act(() => {
      runInAction(() => {
        store.mode = 'duration';
      });
    });
    view.rerender(sheet({ visible: true }));
    await act(async () => undefined);
    expectShown(screen.getByTestId('timer-wheel'));
    expectHidden(screen.getByTestId('timer-stories'));
  });

  it('a switch before the sheet is up mounts the wheel at once, and it stays when switched back', async () => {
    await renderSheet();
    pickSegment('Süre dolunca');
    expect(mockRenders.wheelMounts).toBe(1);
    expect(screen.getByTestId('timer-wheel').props.pointerEvents).toBe('box-none');
    pickSegment('Masal bitince');
    comeUp();
    expect(mockRenders.wheelMounts).toBe(1);
    expectHidden(screen.getByTestId('timer-wheel'));
  });

  it('the hidden wheel keeps its place and is set to the timer minute when shown again', async () => {
    runInAction(() => {
      store.lastDurationMin = 25;
    });
    await renderSheet();
    comeUp();
    pickSegment('Süre dolunca');
    expect(wheelNow()).toBe(25);
    // Moved, not rested, then hidden: the timer keeps 25 and so does the wheel.
    tapPlus();
    tapPlus();
    expect(wheelNow()).toBe(27);
    pickSegment('Masal bitince');
    advance(WHEEL_REST_MS * 2);
    expect(store.lastDurationMin).toBe(25);
    pickSegment('Süre dolunca');
    expect(wheelNow()).toBe(25);
    expect(stopLine()).toHaveTextContent("22:07'de durur");
    // It still rests and starts the timer from there.
    tapPlus();
    advance(WHEEL_REST_MS);
    expect(store.lastDurationMin).toBe(26);
    expect(mockRenders.wheelMounts).toBe(1);
  });

  it('a touch on the hidden body reaches nothing: its controls sit under pointerEvents none', async () => {
    await renderSheet();
    comeUp();
    const wheel = screen.getByTestId('timer-wheel');
    expect(wheel.props.pointerEvents).toBe('none');
    // The chips and the minus and plus are inside it.
    for (const id of ['timer-chips', 'minute-wheel-plus', 'minute-wheel-minus']) {
      expect(wheel.findAll((node: Node) => node.props.testID === id).length).toBeGreaterThan(0);
    }
  });
});

describe('TimerSheet, running', () => {
  beforeEach(() => {
    sleepTimerService.startDuration(25);
    // 18:42 left.
    jest.advanceTimersByTime((25 * 60 - 1122) * 1000 + 25);
    mockPrefsUpdate.mockClear();
  });

  it('the countdown takes the slot of the quick picks, and the wheel stays', async () => {
    await renderSheet();
    expect(screen.getByTestId('timer-wheel')).toBeOnTheScreen();
    expect(wheelNow()).toBe(25);
    const running = screen.getByTestId('timer-running');
    expect(running.props.pointerEvents).toBe('box-none');
    expect(running.props.accessibilityElementsHidden).toBe(false);
    expect(screen.getByTestId('timer-chips-layer').props.pointerEvents).toBe('none');
    expect(screen.getByTestId('timer-chips-layer').props.accessibilityElementsHidden).toBe(true);
    expect(screen.getByTestId('timer-slot').findAll((n: { props: { testID?: string } }) => n.props.testID === 'timer-countdown')).not.toHaveLength(0);
    expect(countdownText()).toBe('18:42');
    expect(screen.getByText('kaldı')).toBeOnTheScreen();
    expect(screen.getByText('+5 dk')).toBeOnTheScreen();
    expect(screen.getByTestId('timer-drain')).toBeOnTheScreen();
    expect(screen.queryByText('Süreyi değiştir')).toBeNull();
    expect(screen.getByLabelText('Süre dolunca').props.accessibilityState.selected).toBe(true);
  });

  it('the countdown has tabular digits on one line and never shrinks to fit', async () => {
    await renderSheet();
    const countdown = screen.getByTestId('timer-countdown');
    expect(flat(countdown).fontVariant).toEqual(['tabular-nums']);
    expect(flat(countdown).fontSize).toBe(28);
    expect(flat(countdown).lineHeight).toBe(38);
    expect(countdown.props.numberOfLines).toBe(1);
    expect(countdown.props.adjustsFontSizeToFit).toBeUndefined();
    expect(countdown.props.minimumFontScale).toBeUndefined();
  });

  it('a running countdown re-renders only the countdown', async () => {
    await renderSheet();
    advance(1000);
    const segments = mockRenders.segments;
    const wheel = mockRenders.wheel;
    expect(segments).toBeGreaterThan(0);
    expect(wheel).toBeGreaterThan(0);
    const texts = [countdownText()];
    for (let i = 0; i < 10; i++) {
      advance(1000);
      texts.push(countdownText());
    }
    // The text changed every second ...
    for (let i = 1; i < texts.length; i++) expect(texts[i]).not.toBe(texts[i - 1]);
    // ... and nothing else of the sheet rendered.
    expect(mockRenders.segments).toBe(segments);
    expect(mockRenders.wheel).toBe(wheel);
  });

  it('"+5 dk" adds five minutes and the line names the new deadline', async () => {
    await renderSheet();
    fireEvent.press(screen.getByTestId('timer-add-five'));
    expect(countdownText()).toBe('23:42');
    expect(stopLine()).toHaveTextContent("22:12'de durur");
  });

  it('the header switch turns it off: the quick picks come back in the same slot', async () => {
    await renderSheet();
    fireEvent.press(screen.getByTestId('timer-switch'));
    expect(store.active).toBe(false);
    expect(screen.getByTestId('timer-wheel')).toBeOnTheScreen();
    expect(screen.getByTestId('timer-chips-layer').props.pointerEvents).toBe('box-none');
    expect(screen.getByTestId('timer-running').props.pointerEvents).toBe('none');
    expect(screen.queryByTestId('timer-drain')).toBeNull();
    expect(countdownText()).toBe('25:00');
  });

  it('leaves the running state when the timer ends', async () => {
    await renderSheet();
    advance(1122 * 1000);
    expect(store.active).toBe(false);
    expect(screen.getByTestId('timer-switch').props.accessibilityState.checked).toBe(false);
    expect(screen.getByTestId('timer-running').props.pointerEvents).toBe('none');
  });
});

describe('TimerSheet, shell', () => {
  it('closes on the scrim and renders nothing while hidden', async () => {
    const { onClose } = await renderSheet();
    fireEvent.press(screen.getByTestId('sheet-scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
    screen.unmount();

    await renderSheet({ visible: false });
    expect(screen.queryByTestId('timer-sheet')).toBeNull();
  });

  it('scrolls when it does not fit', async () => {
    await renderSheet();
    expect(screen.getByTestId('sheet-scroll')).toBeOnTheScreen();
  });

  it('the segment labels never move when pressed', async () => {
    await renderSheet();
    fireEvent(screen.getByTestId('timer-mode-duration'), 'pressIn');
    for (const id of ['timer-mode-duration-label', 'timer-mode-duration-labels']) {
      const transform = (flat(screen.getByTestId(id)).transform ?? []) as Record<string, unknown>[];
      expect(transform.some(t => 'translateY' in t)).toBe(false);
    }
    fireEvent(screen.getByTestId('timer-mode-duration'), 'pressOut');
  });

  it('is translated, without the Turkish suffix', async () => {
    await i18n.changeLanguage('en');
    sleepTimerService.turnOn({ maxStories: 3 });
    await renderSheet();
    expect(screen.getByText('Sleep timer')).toBeOnTheScreen();
    expect(screen.getByLabelText('End of story')).toBeOnTheScreen();
    expect(screen.getByLabelText('After a time')).toBeOnTheScreen();
    expect(stopLine()).toHaveTextContent('Stops after Bremen Mızıkacıları, at 21:45');
    expect(screen.getByTestId('timer-upcoming')).toHaveTextContent('Next: Uykulu Ay, Parmak Kız');
    expect(screen.getByText('Fade the sound out over the last minute')).toBeOnTheScreen();
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', async scheme => {
    sleepTimerService.turnOn({ maxStories: 3 });
    await renderSheet({}, scheme);
    const T = themes[scheme];
    expect(flat(screen.getByTestId('timer-sheet')).backgroundColor).toBe(T.surface);
    expect(flat(stopLine()).color).toBe(T.text);
    expect(flat(screen.getByText('Kaç masal sonra')).color).toBe(T.text);
    // The mode choice is the inset well of the sheet; the story count sits in a canvas well.
    expect(flat(screen.getByTestId('timer-mode')).backgroundColor).toBe(T.bg);
    expect(flat(screen.getByTestId('timer-stories-row')).backgroundColor).toBe(T.bg);
    expect(flat(screen.getByTestId('timer-stepper-plus-face')).backgroundColor).toBe(T.surface2);
    expect(flat(screen.getByText('1, bu masal demek')).color).toBe(T.text2);
  });
});

// ─────────────────────────────────────────────────────────────
// PlayerTimerSheet
// ─────────────────────────────────────────────────────────────

const meta = (id: string, title: string): NarrationMeta => ({
  narrationId: `n-${id}`,
  storyId: `s-${id}`,
  voiceProfileId: 'v-1',
  story: { id: `s-${id}`, title, coverImageUrl: null, translationGroupId: null, category: null },
  voiceProfile: null,
  narratorName: 'Achernar',
  ownVoice: false,
  estimateMs: 0,
});

describe('PlayerTimerSheet', () => {
  beforeEach(() => {
    runInAction(() => {
      mockAudio.isStoryLoaded = true;
      mockAudio.storyEnded = false;
      mockAudio.audioId = 'n-bremen';
      mockAudio.currentStory = { title: 'Bremen Mızıkacıları' };
      mockAudio.totalDurationMs = 600_000;
      mockAudio.currentPositionMs = 372_000;
      mockAudio.playbackSpeed = 1;
    });
    queueStore.reset();
    queueSheet.close();
    resetNarrationDurationsForTests();
    sleepTimerService.turnOn({ maxStories: 3 });
  });

  afterEach(() => {
    // The sheet is still mounted here (RNTL unmounts after this hook).
    act(() => {
      queueStore.reset();
      queueSheet.close();
    });
  });

  it('passes the time left in the story in 10 s steps, and the playing title', async () => {
    // 228 s left, passed as 230: the stop is 21:42:10 + 3:50 = 21:46.
    await renderScreen(<PlayerTimerSheet visible onClose={jest.fn()} />);
    expect(stopLine()).toHaveTextContent("Bremen Mızıkacıları bitince, 21:46'da durur");
    const inner = (TimerSheet as unknown as { type: React.ComponentType<SheetProps> }).type;
    const sheetProps = () => screen.UNSAFE_getByType(inner).props as SheetProps;
    expect(sheetProps().remainingSec).toBe(230);
    // A position report inside the same step passes the same value.
    act(() => {
      runInAction(() => {
        mockAudio.currentPositionMs = 375_000;
      });
    });
    expect(sheetProps().remainingSec).toBe(230);
    act(() => {
      runInAction(() => {
        mockAudio.currentPositionMs = 380_000;
      });
    });
    expect(sheetProps().remainingSec).toBe(220);
    expect(stopLine()).toHaveTextContent("Bremen Mızıkacıları bitince, 21:46'da durur");
  });

  it('the stop line holds one time for minutes while the story plays on', async () => {
    // 228 s left at 21:42:10: the story ends at 21:45:58. Rounded up to whole
    // minutes, the named time would run up to a minute late and hop between
    // 21:45 and 21:46 as the rounding error grows and drops.
    await renderScreen(<PlayerTimerSheet visible onClose={jest.fn()} />);
    const seen = new Set<string>();
    for (let i = 1; i <= 360; i++) {
      // A status report every 500 ms, the clock moving with the story.
      act(() => {
        jest.advanceTimersByTime(500);
        runInAction(() => {
          mockAudio.currentPositionMs = 372_000 + i * 500;
        });
      });
      seen.add(String(stopLine().props.children));
    }
    expect([...seen]).toEqual(["Bremen Mızıkacıları bitince, 21:46'da durur"]);
  });

  it('a story that has ended names no time', async () => {
    runInAction(() => {
      mockAudio.storyEnded = true;
      mockAudio.currentPositionMs = 600_000;
    });
    await renderScreen(<PlayerTimerSheet visible onClose={jest.fn()} />);
    expect(stopLine()).toHaveTextContent('Bremen Mızıkacıları bitince durur');
  });

  it('counts the stories queued after the playing one when it plays from the queue', async () => {
    queueStore.replaceAll([meta('bremen', 'Bremen Mızıkacıları'), meta('ay', 'Uykulu Ay'), meta('kiz', 'Parmak Kız')]);
    queueStore.startAt('n-bremen');
    rememberNarrationDuration('n-ay', 300_000);
    await renderScreen(<PlayerTimerSheet visible onClose={jest.fn()} />);
    expect(screen.getByTestId('timer-upcoming')).toHaveTextContent('Sırada: Uykulu Ay, Parmak Kız');
    fireEvent.press(screen.getByTestId('timer-stepper-plus'));
    expect(stopLine()).toHaveTextContent("Uykulu Ay bitince, 21:51'de durur");
  });

  it('a status report renders nothing, and a wrapper render keeps every prop (LR-3)', async () => {
    queueStore.replaceAll([meta('bremen', 'Bremen Mızıkacıları'), meta('ay', 'Uykulu Ay'), meta('kiz', 'Parmak Kız')]);
    queueStore.startAt('n-bremen');
    const onClose = jest.fn();
    await renderScreen(<PlayerTimerSheet visible onClose={onClose} />);
    const inner = (TimerSheet as unknown as { type: React.ComponentType<SheetProps> }).type;
    const sheetProps = () => screen.UNSAFE_getByType(inner).props as SheetProps;
    const before = sheetProps();
    expect(before.queue.map(entry => entry.title)).toEqual(['Uykulu Ay', 'Parmak Kız']);
    const renders = mockRenders.segments;

    // Status reports every 500 ms inside one 10 s step of the time left.
    for (let i = 1; i <= 6; i++) {
      act(() => {
        runInAction(() => {
          mockAudio.currentPositionMs = 372_000 + i * 500;
        });
      });
    }
    expect(mockRenders.segments).toBe(renders);

    // The wrapper renders again (a new story object, the same title): the
    // sheet gets the very same props and does not render.
    act(() => {
      runInAction(() => {
        mockAudio.currentStory = { title: 'Bremen Mızıkacıları' };
      });
    });
    const after = sheetProps();
    expect(after.queue).toBe(before.queue);
    expect(after.onOpenQueue).toBe(before.onOpenQueue);
    expect(after.onClosed).toBe(before.onClosed);
    expect(after.onClose).toBe(onClose);
    expect(after.remainingSec).toBe(before.remainingSec);
    expect(mockRenders.segments).toBe(renders);

    // A real change of the queue still reaches it.
    act(() => rememberNarrationDuration('n-ay', 300_000));
    expect(sheetProps().queue).not.toBe(before.queue);
    expect(sheetProps().queue[0]).toEqual({ title: 'Uykulu Ay', durationSec: 300 });
  });

  it('without a queue the sheet gets one empty array, the same every time', async () => {
    const view = await renderScreen(<PlayerTimerSheet visible onClose={jest.fn()} />);
    const inner = (TimerSheet as unknown as { type: React.ComponentType<SheetProps> }).type;
    const first = (screen.UNSAFE_getByType(inner).props as SheetProps).queue;
    expect(first).toEqual([]);
    view.rerender(<PlayerTimerSheet visible={false} onClose={jest.fn()} />);
    view.rerender(<PlayerTimerSheet visible onClose={jest.fn()} />);
    expect((screen.UNSAFE_getByType(inner).props as SheetProps).queue).toBe(first);
  });

  it('a queue the playing story is not part of is no queue', async () => {
    queueStore.replaceAll([meta('ay', 'Uykulu Ay'), meta('kiz', 'Parmak Kız')]);
    await renderScreen(<PlayerTimerSheet visible onClose={jest.fn()} />);
    expect(screen.queryByTestId('timer-stepper')).toBeNull();
    expect(screen.getByTestId('timer-queue-hint')).toBeOnTheScreen();
  });

  it('"Sırayı aç" closes the sheet and opens the queue once it has gone', async () => {
    const onClose = jest.fn();
    const view = await renderScreen(<PlayerTimerSheet visible onClose={onClose} />);
    fireEvent.press(screen.getByText('Sırayı aç'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(queueSheet.visible).toBe(false);

    view.rerender(<PlayerTimerSheet visible={false} onClose={onClose} />);
    await act(async () => undefined);
    advance(1000);
    expect(queueSheet.visible).toBe(true);
    expect(queueSheet.origin).toBe('player');
  });

  it('a plain close does not open the queue', async () => {
    const onClose = jest.fn();
    const view = await renderScreen(<PlayerTimerSheet visible onClose={onClose} />);
    view.rerender(<PlayerTimerSheet visible={false} onClose={onClose} />);
    await act(async () => undefined);
    advance(1000);
    expect(queueSheet.visible).toBe(false);
  });

  it('keeps what it shows while it leaves, and reads again when it opens', async () => {
    const onClose = jest.fn();
    const view = await renderScreen(<PlayerTimerSheet visible onClose={onClose} />);
    // TimerSheet is an observer (a memo): the tree holds the component it wraps.
    const inner = (TimerSheet as unknown as { type: React.ComponentType<SheetProps> }).type;
    const sheetProps = () => screen.UNSAFE_getByType(inner).props as SheetProps;
    expect(sheetProps()).toMatchObject({ currentTitle: 'Bremen Mızıkacıları', remainingSec: 230, speed: 1 });

    view.rerender(<PlayerTimerSheet visible={false} onClose={onClose} />);
    runInAction(() => {
      mockAudio.currentStory = { title: 'Pinokyo' };
      mockAudio.currentPositionMs = 100_000;
      mockAudio.playbackSpeed = 1.5;
    });
    expect(sheetProps()).toMatchObject({
      visible: false,
      currentTitle: 'Bremen Mızıkacıları',
      remainingSec: 230,
      speed: 1,
    });

    view.rerender(<PlayerTimerSheet visible onClose={onClose} />);
    expect(sheetProps()).toMatchObject({ currentTitle: 'Pinokyo', remainingSec: 500, speed: 1.5 });
  });
});
