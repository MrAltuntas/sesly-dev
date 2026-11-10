/**
 * Feedback pieces (docs/release-pass/SPEC-design.md 3.15, 1.3, 1.7; SPEC-audio
 * 4.3): CircleButton lips, busy state and press delay; the waveform's idle
 * bars; ProgressBar motion; the platform spinner size; the SectionHeader
 * link tint; LoadingLine's direction.
 */

import React from 'react';
import { ActivityIndicator, Animated, Platform } from 'react-native';
import { act, configure, fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { PALETTE_KEYS } from '../../theme/palettes';
import { LIP, themes } from '../../theme/theme';
import { contrastRatio, flatten, withAlpha } from '../../theme/color';
import { DURATION, EASE, PRESS_DELAY_MS } from '../../theme/motion';
import { WAVE_IDLE_ALPHA } from '../../theme/surfaces';
import {
  CIRCLE_BUSY_SPINNER,
  CircleButton,
  ProgressBar,
  SectionHeader,
  Spinner,
  Waveform,
  circleLip,
  spinnerIndicatorSize,
} from './feedback';
import { LoadingLine } from './Skeleton';

configure({ defaultIncludeHiddenElements: true });

const gece = themes['gece-mavisi'];
const flat = (node: { props: { style?: unknown } }): Record<string, any> =>
  Object.assign({}, ...[node.props.style].flat(8).filter(Boolean));

describe('CircleButton', () => {
  it.each([
    [42, LIP.sm],
    [48, LIP.sm],
    [49, LIP.md],
    [56, LIP.md],
    [80, LIP.md],
  ])('a %idp button sits on a %idp lip', (size, lip) => {
    expect(circleLip(size)).toBe(lip);
    renderWithProviders(<CircleButton icon="play" accessibilityLabel="Oynat" size={size} onPress={jest.fn()} testID="c" />);
    expect(flat(screen.getByTestId('c-lip')).top).toBe(lip);
    expect(flat(screen.getByTestId('c'))).toMatchObject({ paddingBottom: lip });
  });

  it('keeps a 48dp target whatever its size', () => {
    renderWithProviders(<CircleButton icon="play" accessibilityLabel="Oynat" size={36} onPress={jest.fn()} testID="c" />);
    // (48 - 36 - 2) / 2 on every side.
    expect(screen.getByTestId('c').props.hitSlop).toEqual({ top: 5, bottom: 5, left: 5, right: 5 });
  });

  it('busy: a 20dp spinner in place of the glyph, the face keeps its size and presses are ignored', () => {
    const onPress = jest.fn();
    const view = renderWithProviders(
      <CircleButton icon="play" accessibilityLabel="Oynat" size={44} variant="action" onPress={onPress} testID="c" />,
    );
    const idle = flat(screen.getByTestId('c-face'));
    expect(screen.getByTestId('icon-play')).toBeTruthy();
    expect(screen.queryByTestId('c-spinner')).toBeNull();

    view.rerender(
      <CircleButton icon="play" accessibilityLabel="Oynat" size={44} variant="action" onPress={onPress} busy testID="c" />,
    );
    const busy = flat(screen.getByTestId('c-face'));
    expect([busy.width, busy.height]).toEqual([idle.width, idle.height]);
    expect([busy.width, busy.height]).toEqual([44, 44]);
    expect(screen.queryByTestId('icon-play')).toBeNull();
    expect(flat(screen.getByTestId('c-spinner'))).toMatchObject({ width: CIRCLE_BUSY_SPINNER, height: CIRCLE_BUSY_SPINNER });
    expect(CIRCLE_BUSY_SPINNER).toBe(20);
    // The spinner takes the glyph's colour: dark ink on the action face.
    expect(screen.UNSAFE_getByType(ActivityIndicator).props.color).toBe(gece.onAction);
    expect(screen.getByRole('button', { name: 'Oynat' }).props.accessibilityState).toMatchObject({ busy: true });
    // Not dimmed while busy: only `disabled` dims.
    expect(flat(screen.getByTestId('c')).opacity).not.toBe(0.5);
    fireEvent.press(screen.getByTestId('c'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('passes its press delay to the face: the scrolling default, or 0 when asked', () => {
    const view = renderWithProviders(<CircleButton icon="play" accessibilityLabel="Oynat" onPress={jest.fn()} testID="c" />);
    expect(view.UNSAFE_getByProps({ testID: 'c', unstable_pressDelay: PRESS_DELAY_MS })).toBeTruthy();
    view.rerender(<CircleButton icon="play" accessibilityLabel="Oynat" onPress={jest.fn()} pressDelay={0} testID="c" />);
    expect(view.UNSAFE_getByProps({ testID: 'c', unstable_pressDelay: 0 })).toBeTruthy();
  });
});

describe('Waveform', () => {
  it('draws the unplayed bars in text at WAVE_IDLE_ALPHA', () => {
    renderWithProviders(<Waveform bars={10} progress={0.3} testID="wave" />);
    const bars = (screen.getByTestId('wave') as any).children;
    expect(flat(bars[0]).backgroundColor).toBe(gece.action);
    expect(flat(bars[2]).backgroundColor).toBe(gece.action);
    expect(flat(bars[3]).backgroundColor).toBe(withAlpha(gece.text, WAVE_IDLE_ALPHA));
    expect(flat(bars[9]).backgroundColor).toBe(withAlpha(gece.text, WAVE_IDLE_ALPHA));
  });

  it.each(PALETTE_KEYS)('in %s the idle bars reach 3:1 on surface', key => {
    const T = themes[key];
    const bar = flatten(withAlpha(T.text, WAVE_IDLE_ALPHA), T.surface);
    expect(contrastRatio(bar, T.surface)).toBeGreaterThanOrEqual(3);
  });
});

describe('ProgressBar', () => {
  const layout = (testID: string, width = 200) =>
    fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { width, height: 6, x: 0, y: 0 } } });

  it('animated: a new value eases in DURATION.base on the native driver, through a transform', () => {
    const timing = jest.spyOn(Animated, 'timing');
    const view = renderWithProviders(<ProgressBar value={0.2} animated testID="bar" />);
    layout('bar', 200);
    // Starts where it is, without a motion.
    expect(timing).not.toHaveBeenCalled();
    expect(flat(screen.getByTestId('bar-fill'))).toMatchObject({ width: 200, transform: [{ translateX: -160 }] });

    view.rerender(<ProgressBar value={0.6} animated testID="bar" />);
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 0.6, duration: DURATION.base, easing: EASE.standard, useNativeDriver: true }),
    );
    // The accessibility value follows at once.
    expect(screen.getByTestId('bar').props.accessibilityValue).toEqual({ min: 0, max: 100, now: 60 });
  });

  it('animated clamps the value to the track', () => {
    const timing = jest.spyOn(Animated, 'timing');
    const view = renderWithProviders(<ProgressBar value={0.5} animated testID="bar" />);
    view.rerender(<ProgressBar value={1.7} animated testID="bar" />);
    expect(timing).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ toValue: 1 }));
  });

  it('not animated (the default): a value change jumps, no timing', () => {
    const timing = jest.spyOn(Animated, 'timing');
    const view = renderWithProviders(<ProgressBar value={0.2} testID="bar" />);
    view.rerender(<ProgressBar value={0.6} testID="bar" />);
    expect(timing).not.toHaveBeenCalled();
    expect(flat(screen.getByTestId('bar-fill')).width).toBe('60%');
  });

  it('a live progress value wins over animated', () => {
    const timing = jest.spyOn(Animated, 'timing');
    const progress = new Animated.Value(0.25);
    const view = renderWithProviders(<ProgressBar value={0.25} progress={progress} animated testID="bar" />);
    layout('bar', 100);
    view.rerender(<ProgressBar value={0.5} progress={progress} animated testID="bar" />);
    expect(timing).not.toHaveBeenCalled();
    expect(flat(screen.getByTestId('bar-fill')).transform).toEqual([{ translateX: -75 }]);
  });

  it('the indeterminate bar loops in DURATION.loop on the symmetric curve, native', () => {
    const timing = jest.spyOn(Animated, 'timing');
    const loop = jest.spyOn(Animated, 'loop');
    const view = renderWithProviders(<ProgressBar testID="busy" />);
    expect(loop).toHaveBeenCalledTimes(1);
    expect(timing).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 1, duration: DURATION.loop, easing: EASE.symmetric, useNativeDriver: true }),
    );
    // A determinate value stops the loop and starts no other.
    view.rerender(<ProgressBar value={0.4} testID="busy" />);
    expect(loop).toHaveBeenCalledTimes(1);
  });
});

describe('Spinner', () => {
  it('Android sizes its native indicator to the number; iOS knows only small and large', () => {
    expect(spinnerIndicatorSize(28, 'android')).toBe(28);
    expect(spinnerIndicatorSize(20, 'android')).toBe(20);
    expect(spinnerIndicatorSize(28, 'ios')).toBe('small');
    expect(spinnerIndicatorSize(30, 'ios')).toBe('large');
  });

  it('renders the size of the platform it runs on, in a box of the requested size', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = renderWithProviders(<Spinner size={28} testID="spin" />);
    expect(screen.UNSAFE_getByType(ActivityIndicator).props.size).toBe(28);
    expect(flat(screen.getByTestId('spin'))).toMatchObject({ width: 28, height: 28 });
    view.unmount();

    jest.replaceProperty(Platform, 'OS', 'ios');
    renderWithProviders(<Spinner size={28} testID="spin" />);
    expect(screen.UNSAFE_getByType(ActivityIndicator).props.size).toBe('small');
  });
});

describe('SectionHeader', () => {
  it('the link dims while held and never moves', () => {
    const timing = jest.spyOn(Animated, 'timing').mockImplementation(((value: Animated.Value, config: { toValue: number }) => ({
      start: () => value.setValue(config.toValue),
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.timing);
    const onLink = jest.fn();
    renderWithProviders(<SectionHeader title="Türk klasikleri" linkLabel="Tümü" onLinkPress={onLink} testID="sec" />);
    const link = screen.getByTestId('sec-link');
    fireEvent(link, 'pressIn');
    expect(flat(link).transform).toBeUndefined();
    expect(flat(screen.getByText('Tümü')).opacity).toBe(0.6);
    expect(timing).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 0.6, duration: DURATION.pressIn, useNativeDriver: true }),
    );
    fireEvent(link, 'pressOut');
    expect(flat(screen.getByText('Tümü')).opacity).toBe(1);
    fireEvent.press(link);
    expect(onLink).toHaveBeenCalledTimes(1);
  });

  it('a long title gives way and the link never wraps or shrinks (V2: "Tümünü")', () => {
    renderWithProviders(
      <SectionHeader
        title="Hazır anlatıcılar ve daha fazla ses seçeneği"
        linkLabel="Tümünü gör"
        onLinkPress={jest.fn()}
        testID="sec"
      />,
    );
    expect(flat(screen.getByTestId('sec-link')).flexShrink).toBe(0);
    expect(screen.getByText('Tümünü gör').props.numberOfLines).toBe(1);
    // The title is the part that shrinks, on one line.
    const title = screen.getByText('Hazır anlatıcılar ve daha fazla ses seçeneği');
    expect(title.props.numberOfLines).toBe(1);
    expect(flat(title).flexShrink).toBe(1);
  });

  it('the category dot is a circle of half its size', () => {
    renderWithProviders(<SectionHeader title="Uyku" dotColor={gece.catUyku} testID="sec" />);
    const dot = flat(screen.getByTestId('sec-dot'));
    expect(dot.borderRadius * 2).toBe(dot.width);
    expect(screen.queryByTestId('sec-link')).toBeNull();
  });
});

describe('LoadingLine', () => {
  it("lays the spinner before the label in a row, or above it with 'column'", () => {
    const view = renderWithProviders(<LoadingLine label="Metin yükleniyor..." testID="line" />);
    const line = screen.getByTestId('line');
    expect(flat(line).flexDirection).toBe('row');
    expect(line.props.accessibilityRole).toBe('progressbar');
    expect(line.props.accessibilityLabel).toBe('Metin yükleniyor...');
    view.rerender(<LoadingLine label="Metin yükleniyor..." direction="column" testID="line" />);
    expect(flat(screen.getByTestId('line')).flexDirection).toBe('column');
    expect(screen.getByText('Metin yükleniyor...')).toBeTruthy();
  });
});

describe('animated fill after a value change', () => {
  it('lands on the new value', () => {
    jest.spyOn(Animated, 'timing').mockImplementation(((value: Animated.Value, config: { toValue: number }) => ({
      start: () => value.setValue(config.toValue),
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.timing);
    const view = renderWithProviders(<ProgressBar value={0.1} animated testID="bar" />);
    fireEvent(screen.getByTestId('bar'), 'layout', { nativeEvent: { layout: { width: 100, height: 6, x: 0, y: 0 } } });
    act(() => view.rerender(<ProgressBar value={0.75} animated testID="bar" />));
    expect(flat(screen.getByTestId('bar-fill')).transform).toEqual([{ translateX: -25 }]);
  });
});
