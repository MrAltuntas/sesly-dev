/**
 * MiniPlayerBar: the copy for playing and paused, the progress line (nothing
 * before the line is measured, then the shared value by transform), the
 * busy button, the card that sinks by exactly its lip, presses that answer
 * at once (the player opens in the frame after the sink, LR-4), and the
 * geometry constants the shell and the tab lists read.
 */

import React from 'react';
import { Animated } from 'react-native';
import { act, configure, fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { LIP, SPACE, themes } from '../../theme/theme';
import { DURATION } from '../../theme/motion';
import {
  MINI_PLAYER_BUSY_SPINNER,
  MINI_PLAYER_GLYPH,
  MINI_PLAYER_TOGGLE_SIZE,
  MINI_PLAYER_CARD_HEIGHT,
  MINI_PLAYER_DOCK_HEIGHT,
  MINI_PLAYER_HEIGHT,
  MINI_PLAYER_LIP,
  MiniPlayerBar,
  playedFraction,
  remainingMinutes,
} from './MiniPlayerBar';
import { SurfaceLevelProvider } from './SurfaceLevel';

// Icons are decorative and hidden from accessibility; these tests look at them.
configure({ defaultIncludeHiddenElements: true });

const gece = themes['gece-mavisi'];
const flat = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(5).filter(Boolean));

const base = {
  story: { id: 's-1' },
  title: 'Bremen Mızıkacıları',
  positionMs: 134000,
  durationMs: 362000,
  onPress: jest.fn(),
  onTogglePlay: jest.fn(),
};

/** The line reports its width (the first layout). */
function measureTrack(width: number) {
  fireEvent(screen.getByTestId('mini-player-track'), 'layout', {
    nativeEvent: { layout: { width, height: 3, x: 0, y: 0 } },
  });
}

/** Native-driver timings land at once (the value moves off the JS thread on a device). */
function landTimingsAtOnce() {
  return jest.spyOn(Animated, 'timing').mockImplementation(((
    value: Animated.Value,
    config: { toValue: number },
  ) => ({
    start: (done?: (r: { finished: boolean }) => void) => {
      value.setValue(config.toValue);
      done?.({ finished: true });
    },
    stop: () => undefined,
    reset: () => undefined,
  })) as unknown as typeof Animated.timing);
}

describe('MiniPlayerBar geometry', () => {
  it('the card is 60 on a 3dp card lip, and the dock adds the 4dp gap to the bar', () => {
    expect(MINI_PLAYER_LIP).toBe(LIP.md);
    expect(MINI_PLAYER_LIP).toBe(gece.lipSize.md);
    expect(MINI_PLAYER_CARD_HEIGHT).toBe(44 + 2 * SPACE.sm);
    expect(MINI_PLAYER_HEIGHT).toBe(63);
    expect(MINI_PLAYER_DOCK_HEIGHT).toBe(MINI_PLAYER_HEIGHT + SPACE.xs);
    expect(MINI_PLAYER_DOCK_HEIGHT).toBe(67);
  });

  it('draws the card on its lip, on the scale: padding 8, gap 12, radius 20, a 36dp toggle on a 2dp lip', () => {
    renderWithProviders(<MiniPlayerBar {...base} isPlaying />);
    expect(flat(screen.getByTestId('mini-player'))).toMatchObject({
      marginHorizontal: gece.screenPadH,
      paddingBottom: MINI_PLAYER_LIP,
    });
    expect(flat(screen.getByTestId('mini-player-lip'))).toMatchObject({
      top: MINI_PLAYER_LIP,
      borderRadius: 20,
      backgroundColor: gece.lip,
    });
    expect(flat(screen.getByTestId('mini-player-card'))).toMatchObject({
      minHeight: MINI_PLAYER_CARD_HEIGHT,
      borderRadius: 20,
      backgroundColor: gece.surface2,
      paddingLeft: 8,
      paddingRight: 8,
    });
    expect(flat(screen.getByTestId('mini-player-open'))).toMatchObject({ gap: 12, paddingVertical: 8 });
    // The toggle: a sm button's face (36dp) on a 2dp lip, round.
    expect(flat(screen.getByTestId('mini-player-toggle-face'))).toMatchObject({
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: gece.action,
    });
    expect(flat(screen.getByTestId('mini-player-toggle-lip'))).toMatchObject({ top: LIP.sm });
    // The progress line: 16dp in from the card, 4dp above its bottom.
    expect(flat(screen.getByTestId('mini-player-track'))).toMatchObject({ left: 16, right: 16, bottom: 4, height: 3 });
  });

  it('tells the controls inside it that they sit on surface2', () => {
    renderWithProviders(<MiniPlayerBar {...base} isPlaying />);
    expect(screen.UNSAFE_getByType(SurfaceLevelProvider).props.level).toBe('surface2');
  });
});

describe('MiniPlayerBar copy', () => {
  it('computes remaining minutes and the played fraction', () => {
    expect(remainingMinutes(0, 0)).toBeNull();
    expect(remainingMinutes(0, NaN)).toBeNull();
    expect(remainingMinutes(134000, 362000)).toBe(4);
    expect(remainingMinutes(361000, 362000)).toBe(1);
    expect(remainingMinutes(362000, 362000)).toBe(0);
    expect(remainingMinutes(-5, 60000)).toBe(1);
    expect(playedFraction(0, 0)).toBe(0);
    expect(playedFraction(90, 360)).toBe(0.25);
    expect(playedFraction(500, 360)).toBe(1);
    expect(playedFraction(-1, 360)).toBe(0);
  });

  it('while playing: title, narrator and time left; the body opens the player, the button pauses', () => {
    const onPress = jest.fn();
    const onTogglePlay = jest.fn();
    renderWithProviders(
      <MiniPlayerBar {...base} narratorName="Zeynep" isPlaying onPress={onPress} onTogglePlay={onTogglePlay} />,
    );
    expect(screen.getByText('Bremen Mızıkacıları')).toBeTruthy();
    expect(screen.getByText('Zeynep anlatıyor, 4 dk kaldı')).toBeTruthy();
    expect(screen.getByLabelText('Oynatıcıyı aç: Bremen Mızıkacıları')).toBeTruthy();

    fireEvent.press(screen.getByTestId('mini-player-open'));
    // The player opens in the next frame (the sunk card is drawn first).
    act(() => {
      jest.advanceTimersByTime(16);
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    // The play button acts at once.
    fireEvent.press(screen.getByRole('button', { name: 'Duraklat' }));
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('paused: never "anlatıyor", it says it is paused; the button offers play', () => {
    const { rerender } = renderWithProviders(<MiniPlayerBar {...base} narratorName="Zeynep" isPlaying={false} />);
    expect(screen.getByText('Duraklatıldı, 4 dk kaldı')).toBeTruthy();
    expect(screen.queryByText(/anlatıyor/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Oynat' })).toBeTruthy();

    // Length unknown: only the state.
    rerender(<MiniPlayerBar {...base} narratorName="Zeynep" durationMs={0} isPlaying={false} />);
    expect(screen.getByText('Duraklatıldı')).toBeTruthy();
  });

  it('degrades when data is missing', () => {
    const { rerender } = renderWithProviders(<MiniPlayerBar {...base} narratorName="Kerem" durationMs={0} isPlaying />);
    expect(screen.getByText('Kerem anlatıyor')).toBeTruthy();

    rerender(<MiniPlayerBar {...base} narratorName={null} isPlaying />);
    expect(screen.getByText('4 dk kaldı')).toBeTruthy();

    // Nothing to say: no subtitle row at all (no lone wave mark).
    rerender(<MiniPlayerBar {...base} narratorName={null} durationMs={0} isPlaying />);
    expect(screen.queryByText(/kaldı|anlatıyor/)).toBeNull();
    expect(screen.queryByTestId('mini-player-wave')).toBeNull();

    // The caller's minutes win over the position (the store's computed value); 0 left says nothing.
    rerender(<MiniPlayerBar {...base} narratorName="Kerem" minutesLeft={0} isPlaying />);
    expect(screen.getByText('Kerem anlatıyor')).toBeTruthy();
  });

  it('is translated', async () => {
    await i18n.changeLanguage('en');
    const { rerender } = renderWithProviders(<MiniPlayerBar {...base} narratorName="Zeynep" isPlaying />);
    expect(screen.getByText('Told by Zeynep, 4 min left')).toBeTruthy();
    rerender(<MiniPlayerBar {...base} narratorName="Zeynep" isPlaying={false} />);
    expect(screen.getByText('Paused, 4 min left')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  });
});

describe('MiniPlayerBar progress line', () => {
  it('draws nothing before the line is measured, then the played part of the measured width', () => {
    renderWithProviders(<MiniPlayerBar {...base} positionMs={90000} durationMs={360000} isPlaying />);
    expect(screen.queryByTestId('mini-player-progress')).toBeNull();

    measureTrack(320);
    expect(flat(screen.getByTestId('mini-player-progress'))).toMatchObject({ width: 80, backgroundColor: gece.action });
  });

  it('the loaded story: nothing before layout, then the shared animated value, by transform', () => {
    const progress = new Animated.Value(0.25);
    renderWithProviders(
      <MiniPlayerBar
        {...base}
        positionMs={undefined}
        durationMs={undefined}
        progress={progress}
        minutesLeft={3}
        narratorName="Zeynep"
        isPlaying
      />,
    );
    // The minutes come from the caller (the store's computed value).
    expect(screen.getByText('Zeynep anlatıyor, 3 dk kaldı')).toBeTruthy();
    // No width guess: a fill seeded wider than the line would run ahead of the story.
    expect(screen.queryByTestId('mini-player-progress')).toBeNull();

    measureTrack(360);
    const fill = flat(screen.getByTestId('mini-player-progress'));
    // As wide as the line and shifted left: a quarter of it shows.
    expect(fill.width).toBe(360);
    expect(fill.transform).toEqual([{ translateX: -270 }]);

    act(() => progress.setValue(0.5));
    expect(flat(screen.getByTestId('mini-player-progress')).transform).toEqual([{ translateX: -180 }]);

    // A narrower line (rotation, font scale) is followed.
    measureTrack(200);
    expect(flat(screen.getByTestId('mini-player-progress')).transform).toEqual([{ translateX: -100 }]);
  });
});

describe('MiniPlayerBar play button size (owner feedback: the glyph was a bit big)', () => {
  it('is a sm button: a 36dp face with the 16dp glyph of the icon scale, inside a 48dp touch target', () => {
    renderWithProviders(<MiniPlayerBar {...base} isPlaying={false} />);
    expect(MINI_PLAYER_TOGGLE_SIZE).toBe(36);
    expect(MINI_PLAYER_GLYPH).toBe(16);
    const glyph = screen.getByTestId('icon-play');
    expect(flat(glyph)).toMatchObject({ width: 16, height: 16 });
    // Smaller than the 20dp inline step it had, and on the 24 / 20 / 16 scale.
    expect([24, 20, 16]).toContain(MINI_PLAYER_GLYPH);
    const toggle = screen.getByTestId('mini-player-toggle');
    const slop = toggle.props.hitSlop as { top: number; bottom: number; left: number; right: number };
    expect(MINI_PLAYER_TOGGLE_SIZE + LIP.sm + slop.top + slop.bottom).toBe(48);
    expect(MINI_PLAYER_TOGGLE_SIZE + slop.left + slop.right).toBeGreaterThanOrEqual(44);
  });

  it('the pause glyph and the spinner take the same 16dp', () => {
    const { rerender } = renderWithProviders(<MiniPlayerBar {...base} isPlaying />);
    expect(flat(screen.getByTestId('icon-pause'))).toMatchObject({ width: 16, height: 16 });
    rerender(<MiniPlayerBar {...base} isPlaying busy />);
    expect(flat(screen.getByTestId('mini-player-busy'))).toMatchObject({ width: 16, height: 16 });
  });
});

describe('MiniPlayerBar busy button', () => {
  it('spins in the 36dp button while busy, stays pressable, and shows the glyph again after', () => {
    const onTogglePlay = jest.fn();
    const { rerender } = renderWithProviders(
      <MiniPlayerBar {...base} isPlaying busy onTogglePlay={onTogglePlay} />,
    );
    const spinner = screen.getByTestId('mini-player-busy');
    expect(flat(spinner)).toMatchObject({ width: MINI_PLAYER_BUSY_SPINNER, height: MINI_PLAYER_BUSY_SPINNER });
    expect(MINI_PLAYER_BUSY_SPINNER).toBe(16);
    expect(screen.getByTestId('spinner-indicator').props.color).toBe(gece.onAction);
    expect(screen.queryByTestId('icon-pause')).toBeNull();
    expect(screen.queryByTestId('icon-play')).toBeNull();
    // The button keeps its size and its label; screen readers hear it is busy.
    expect(flat(screen.getByTestId('mini-player-toggle-face'))).toMatchObject({ width: 36, height: 36 });
    const toggle = screen.getByRole('button', { name: 'Duraklat' });
    expect(toggle.props.accessibilityState).toMatchObject({ busy: true });

    // A tap while it spins still reaches the store (pause during a cold start).
    fireEvent.press(toggle);
    expect(onTogglePlay).toHaveBeenCalledTimes(1);

    rerender(<MiniPlayerBar {...base} isPlaying onTogglePlay={onTogglePlay} />);
    expect(screen.queryByTestId('mini-player-busy')).toBeNull();
    expect(screen.getByTestId('icon-pause')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Duraklat' }).props.accessibilityState).toMatchObject({ busy: false });
  });
});

describe('MiniPlayerBar press', () => {
  it('the card sinks by exactly its lip and rises on release', () => {
    const timing = landTimingsAtOnce();
    renderWithProviders(<MiniPlayerBar {...base} isPlaying />);
    const lipTop = flat(screen.getByTestId('mini-player-lip')).top;
    expect(lipTop).toBe(3);

    fireEvent(screen.getByTestId('mini-player-open'), 'pressIn');
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 1, duration: DURATION.pressIn, useNativeDriver: true }),
    );
    // The interpolation ends on the lip: [0, 3].
    expect(flat(screen.getByTestId('mini-player-card')).transform).toEqual([{ translateY: lipTop }]);

    fireEvent(screen.getByTestId('mini-player-open'), 'pressOut');
    expect(flat(screen.getByTestId('mini-player-card')).transform).toEqual([{ translateY: 0 }]);
  });

  it('the sink starts at the touch and the player opens in the next frame, after it (LR-4)', () => {
    const order: string[] = [];
    const timing = jest.spyOn(Animated, 'timing').mockImplementation(((
      value: Animated.Value,
      config: { toValue: number },
    ) => ({
      start: () => {
        order.push(`sink ${config.toValue}`);
        value.setValue(config.toValue);
      },
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.timing);
    const onPress = jest.fn(() => order.push('open'));
    renderWithProviders(<MiniPlayerBar {...base} isPlaying onPress={onPress} />);
    const card = screen.getByTestId('mini-player-open');

    // A tap: down, up and the press, in one go (as a busy JS thread gets them).
    fireEvent(card, 'pressIn');
    fireEvent(card, 'pressOut');
    fireEvent.press(card);
    expect(order).toEqual(['sink 1', 'sink 0']);
    expect(onPress).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(16);
    });
    expect(order).toEqual(['sink 1', 'sink 0', 'open']);
    expect(onPress).toHaveBeenCalledTimes(1);
    timing.mockRestore();
  });

  it('two taps in one frame open the player once; an unmount drops a pending open', () => {
    const onPress = jest.fn();
    const { unmount } = renderWithProviders(<MiniPlayerBar {...base} isPlaying onPress={onPress} />);
    fireEvent.press(screen.getByTestId('mini-player-open'));
    fireEvent.press(screen.getByTestId('mini-player-open'));
    act(() => {
      jest.advanceTimersByTime(16);
    });
    expect(onPress).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('mini-player-open'));
    unmount();
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('answers the touch at once: no press delay on the card or the button', () => {
    renderWithProviders(<MiniPlayerBar {...base} isPlaying />);
    type Instance = { type: unknown; props: { testID?: string; onPress?: unknown; unstable_pressDelay?: number } };
    const pressables: Instance[] = screen.UNSAFE_root.findAll(
      (node: Instance) =>
        typeof node.type !== 'string' &&
        (node.props.testID === 'mini-player-open' || node.props.testID === 'mini-player-toggle') &&
        'onPressIn' in node.props &&
        'unstable_pressDelay' in node.props,
      { deep: true },
    );
    const delays = new Map(pressables.map(node => [node.props.testID, node.props.unstable_pressDelay]));
    expect(delays).toEqual(
      new Map([
        ['mini-player-open', 0],
        ['mini-player-toggle', 0],
      ]),
    );
  });
});
