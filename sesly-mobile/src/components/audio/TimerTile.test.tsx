/**
 * The player's sleep timer tile (SPEC-audio 7.4) on the real SleepTimerService:
 * label and value, tabular digits that change in place, the ring that is
 * always there, the drain line of a running duration timer, and OptionTile
 * (a press that sinks at the touch and opens its sheet in the next frame).
 */

import React from 'react';
import { Animated, Text } from 'react-native';
import { act, configure, fireEvent, screen } from '@testing-library/react-native';
import { runInAction } from 'mobx';

import { renderScreen } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { PALETTE_KEYS } from '../../theme/palettes';
import { getTheme, themes } from '../../theme/theme';
import { contrastRatio } from '../../theme/color';
import sleepTimerService from '../../services/SleepTimerService';
import { OPTION_TILE, OptionTile, TimerTile, optionTileStylesFor, timerTileTint } from './TimerTile';
import { SLEEP_DRAIN_CHUNK_MS, sleepDrain } from './sleepDrain';

jest.mock('../../services/UserPreferencesService', () => ({
  __esModule: true,
  default: {
    getCachedSync: () => null,
    get: jest.fn(() => new Promise(() => undefined)),
    update: jest.fn(() => Promise.resolve({})),
  },
}));
jest.mock('../../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

// The drain line is decorative (hidden from screen readers); the tests look at it.
beforeAll(() => configure({ defaultIncludeHiddenElements: true }));
afterAll(() => configure({ defaultIncludeHiddenElements: false }));

const NOW = new Date(2026, 9, 13, 21, 42, 0).getTime();
const store = sleepTimerService.store;

const flat = (node: { props: { style?: unknown } }) => {
  const style = node.props.style;
  const list = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...list.filter(Boolean)) as Record<string, unknown>;
};

const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

async function renderTile(theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi') {
  const onPress = jest.fn();
  await renderScreen(<TimerTile onPress={onPress} style={{ flex: 1 }} />, { theme });
  return onPress;
}

const value = () => screen.getByTestId('player-timer-state');
const label = () => screen.getByTestId('player-timer-entry-label');
const face = () => flat(screen.getByTestId('player-timer-entry-face'));

beforeEach(() => {
  jest.setSystemTime(NOW);
  sleepTimerService.turnOff();
  runInAction(() => {
    store.mode = 'duration';
    store.storyCount = 1;
    store.lastDurationMin = null;
    store.fadeOut = true;
  });
});

afterEach(async () => {
  sleepTimerService.turnOff();
  await i18n.changeLanguage('tr');
});

describe('TimerTile', () => {
  it('off: "Zamanlayıcı" over "Kapalı", and a tap opens the sheet', async () => {
    const onPress = await renderTile();
    expect(label()).toHaveTextContent('Zamanlayıcı');
    expect(value()).toHaveTextContent('Kapalı');
    expect(screen.getByTestId('player-timer-entry').props.accessibilityLabel).toBe(
      'Uyku zamanlayıcısı, Kapalı',
    );
    fireEvent.press(screen.getByTestId('player-timer-entry'));
    // The sheet opens in the next frame, after the sunk tile is drawn.
    expect(onPress).not.toHaveBeenCalled();
    advance(16);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a running duration: "Kalan süre" over "14:52"', async () => {
    sleepTimerService.startDuration(15);
    await renderTile();
    advance(8025);
    expect(label()).toHaveTextContent('Kalan süre');
    expect(value()).toHaveTextContent('14:52');
    expect(screen.getByTestId('player-timer-entry').props.accessibilityLabel).toBe(
      'Uyku zamanlayıcısı, Kalan süre 14:52',
    );
  });

  it('stories: "Bu masal" with one left, "3 masal" before', async () => {
    runInAction(() => {
      store.mode = 'stories';
    });
    sleepTimerService.turnOn({ maxStories: 3 });
    await renderTile();
    expect(label()).toHaveTextContent('Zamanlayıcı');
    expect(value()).toHaveTextContent('Bu masal');
    act(() => sleepTimerService.setStoryCount(3, 3));
    expect(value()).toHaveTextContent('3 masal');
  });

  it('is translated', async () => {
    await i18n.changeLanguage('en');
    sleepTimerService.startDuration(10);
    await renderTile();
    expect(label()).toHaveTextContent('Time left');
    expect(value()).toHaveTextContent('10:00');
  });

  it('the value has tabular digits on one line, no auto-fit, and a style that never changes with the ticks', async () => {
    sleepTimerService.startDuration(25);
    await renderTile();
    const node = value();
    expect(flat(node).fontVariant).toEqual(['tabular-nums']);
    expect(node.props.numberOfLines).toBe(1);
    expect(node.props.adjustsFontSizeToFit).toBeUndefined();
    expect(node.props.minimumFontScale).toBeUndefined();
    advance(1025); // the first tick
    const style = value().props.style;
    const texts = [String(value().props.children)];
    for (let i = 0; i < 3; i++) {
      advance(1000);
      texts.push(String(value().props.children));
      expect(value().props.style).toBe(style);
    }
    expect(texts).toEqual(['24:59', '24:58', '24:57', '24:56']);
  });

  it('the ring is 2dp on and off: switching the timer moves nothing', async () => {
    const T = themes['gece-mavisi'];
    await renderTile();
    expect(face().borderWidth).toBe(2);
    expect(face().borderColor).toBe('transparent');
    expect(face().backgroundColor).toBe(T.surface);
    const padding = face().paddingHorizontal;

    act(() => sleepTimerService.startDuration(20));
    expect(face().borderWidth).toBe(2);
    expect(face().borderColor).toBe(timerTileTint(T).ring);
    expect(face().backgroundColor).toBe(timerTileTint(T).face);
    expect(face().paddingHorizontal).toBe(padding);
  });

  it('has the tile metrics: 64dp, padding 12, gap 8, a 32dp icon square', async () => {
    const T = themes['gece-mavisi'];
    await renderTile();
    expect(face().minHeight).toBe(64);
    expect(face().paddingHorizontal).toBe(12);
    expect(face().gap).toBe(8);
    const icon = flat(screen.getByTestId('player-timer-entry-icon'));
    expect(icon.width).toBe(32);
    expect(icon.height).toBe(32);
    expect(icon.borderRadius).toBe(T.r.sm);
    expect(icon.backgroundColor).toBe(T.catUyku);
    expect(OPTION_TILE).toMatchObject({ minHeight: 64, padH: 12, gap: 8, icon: 32, ring: 2 });
  });

  it('the drain line shows only while a duration runs', async () => {
    await renderTile();
    expect(screen.queryByTestId('player-timer-drain')).toBeNull();

    act(() => sleepTimerService.startDuration(20));
    expect(screen.getByTestId('player-timer-drain')).toBeOnTheScreen();

    act(() => sleepTimerService.setMode('stories'));
    expect(store.active).toBe(true);
    expect(screen.queryByTestId('player-timer-drain')).toBeNull();

    act(() => sleepTimerService.startDuration(5));
    expect(screen.getByTestId('player-timer-drain')).toBeOnTheScreen();
    act(() => sleepTimerService.turnOff());
    expect(screen.queryByTestId('player-timer-drain')).toBeNull();
  });

  it('the drain moves on the native driver in chunks of at most 20 s, linear', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    sleepTimerService.startDuration(30);
    await renderTile();
    const drains = timing.mock.calls.filter(([animated]) => animated === sleepDrain.value);
    expect(drains.length).toBeGreaterThan(0);
    for (const [, config] of drains) {
      expect(config.useNativeDriver).toBe(true);
      expect(config.duration).toBeLessThanOrEqual(SLEEP_DRAIN_CHUNK_MS);
      expect(config.duration).toBeGreaterThan(0);
      expect(config.easing?.(0.5)).toBeCloseTo(0.5);
    }
    // 30 minutes from full: the first chunk ends 20 s down the line.
    const [, first] = drains[0];
    expect(first.duration).toBe(20_000);
    expect(first.toValue).toBeCloseTo((30 * 60000 - 20_000) / (30 * 60000), 6);
  });

  it('the drain fill (sleep colour) has at least 3:1 on the tinted face in every palette', () => {
    for (const key of PALETTE_KEYS) {
      const T = getTheme(key);
      const ratio = contrastRatio(T.catUyku, timerTileTint(T).face);
      expect({ key, ok: ratio >= 3 }).toEqual({ key, ok: true });
    }
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', async scheme => {
    const T = themes[scheme];
    sleepTimerService.startDuration(20);
    await renderTile(scheme);
    expect(flat(value()).color).toBe(T.text);
    expect(flat(value()).fontFamily).toBe(T.fontDisplay);
    expect(flat(label()).color).toBe(T.text2);
    const track = screen.getByTestId('player-timer-drain');
    expect(flat(track).backgroundColor).toMatch(/^rgba\(/);
    expect(flat(track).height).toBe(3);
    // The fill is drawn once the track has a width.
    expect(screen.queryByTestId('player-timer-drain-fill')).toBeNull();
    fireEvent(track, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 120, height: 3 } } });
    const fill = screen.getByTestId('player-timer-drain-fill');
    expect(flat(fill).backgroundColor).toBe(T.catUyku);
    expect(flat(fill).width).toBe(120);
  });
});

describe('OptionTile', () => {
  it('draws any option on the same face with the shared value style', async () => {
    const T = themes['gece-mavisi'];
    const onPress = jest.fn();
    await renderScreen(
      <OptionTile
        icon="speed"
        iconBg={T.surface2}
        iconColor={T.text}
        label="Hız"
        value={
          <Text style={optionTileStylesFor(T).value} testID="speed-value">
            1,0x
          </Text>
        }
        onPress={onPress}
        accessibilityLabel="Oynatma hızı, 1,0x"
        testID="player-speed-entry"
      />,
    );
    expect(screen.getByTestId('player-speed-entry-label')).toHaveTextContent('Hız');
    expect(flat(screen.getByTestId('speed-value')).fontVariant).toEqual(['tabular-nums']);
    const speedFace = flat(screen.getByTestId('player-speed-entry-face'));
    expect(speedFace.borderWidth).toBe(2);
    expect(speedFace.borderColor).toBe('transparent');
    fireEvent.press(screen.getByTestId('player-speed-entry'));
    advance(16);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('sinks at the touch, with no press delay, and opens its sheet in the next frame (LR-4)', async () => {
    const order: string[] = [];
    const timing = jest.spyOn(Animated, 'timing').mockImplementation(((
      animated: Animated.Value,
      config: { toValue: number },
    ) => ({
      start: () => {
        order.push(`sink ${config.toValue}`);
        animated.setValue(config.toValue);
      },
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.timing);
    const onPress = jest.fn(() => order.push('open'));
    await renderScreen(<TimerTile onPress={onPress} />);
    const tile = screen.getByTestId('player-timer-entry');
    type Instance = { type: unknown; props: { testID?: string; unstable_pressDelay?: number } };
    const pressable = screen.UNSAFE_root.findAll(
      (node: Instance) =>
        typeof node.type !== 'string' &&
        node.props.testID === 'player-timer-entry' &&
        'unstable_pressDelay' in node.props,
      { deep: true },
    )[0] as Instance;
    expect(pressable.props.unstable_pressDelay).toBe(0);

    fireEvent(tile, 'pressIn');
    // Sunk on the lip at once.
    expect(flat(screen.getByTestId('player-timer-entry-face')).transform).toEqual([{ translateY: 3 }]);
    fireEvent(tile, 'pressOut');
    fireEvent.press(tile);
    // The press itself starts the rise again (harmless after a press-out).
    expect(order).toEqual(['sink 1', 'sink 0', 'sink 0']);
    advance(16);
    expect(order).toEqual(['sink 1', 'sink 0', 'sink 0', 'open']);
    timing.mockRestore();
  });

  it('a quick tap rises at the press, before the sheet opens, not at the late press-out (LR-4R)', async () => {
    const order: string[] = [];
    const timing = jest.spyOn(Animated, 'timing').mockImplementation(((
      animated: Animated.Value,
      config: { toValue: number },
    ) => ({
      start: () => {
        order.push(`sink ${config.toValue}`);
        animated.setValue(config.toValue);
      },
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.timing);
    const onPress = jest.fn(() => order.push('open'));
    await renderScreen(<TimerTile onPress={onPress} />);
    const tile = screen.getByTestId('player-timer-entry');

    // Pressability: press-in, the press, and the press-out only after its
    // minimum press time (here: never, as when the sheet's mount holds it).
    fireEvent(tile, 'pressIn');
    fireEvent(tile, 'press');
    expect(order).toEqual(['sink 1', 'sink 0']);
    expect(flat(screen.getByTestId('player-timer-entry-face')).transform).toEqual([{ translateY: 0 }]);
    advance(16);
    expect(order).toEqual(['sink 1', 'sink 0', 'open']);
    timing.mockRestore();
  });

  it('draws the lip and the face as Tactile does: a 3dp lip, radius and ring on the face', async () => {
    await renderTile();
    const T = themes['gece-mavisi'];
    const lip = flat(screen.getByTestId('player-timer-entry-lip'));
    expect(lip).toMatchObject({ position: 'absolute', top: 3, bottom: 0, backgroundColor: T.lip, borderRadius: T.r.lg });
    expect(flat(screen.getByTestId('player-timer-entry')).paddingBottom).toBe(3);
    expect(face()).toMatchObject({ borderRadius: T.r.lg, borderWidth: 2 });
    expect(screen.getByTestId('player-timer-entry').props.accessibilityRole).toBe('button');
  });
});
