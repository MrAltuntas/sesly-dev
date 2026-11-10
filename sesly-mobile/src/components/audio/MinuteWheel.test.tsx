/**
 * MinuteWheel: three visible rows on a native scroll value, a stable first
 * offset, one unit on the band, one tap target, nudge buttons (SPEC-audio
 * 7.5, SPEC-design 3.9), and only the rows near the band (or on the way of a
 * scroll from code) on the native driver (LR-3).
 */

import React from 'react';
import { Animated } from 'react-native';
import { act, configure, fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { themes } from '../../theme/theme';
import {
  MinuteWheel,
  MinuteWheelHandle,
  WHEEL_HEIGHT,
  WHEEL_LIVE_ROWS,
  WHEEL_NEIGHBOUR_OPACITY,
  WHEEL_NEIGHBOUR_SCALE,
  WHEEL_REPEAT_DELAY_MS,
  WHEEL_REPEAT_INTERVAL_MS,
  WHEEL_ROW_HEIGHT,
  WHEEL_VISIBLE_ROWS,
  minuteAtOffset,
  minuteAtTap,
} from './MinuteWheel';

function renderWheel(value: number, theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi') {
  const onChange = jest.fn();
  const valueText = (minutes: number) => `${minutes} dakika`;
  const ref = React.createRef<MinuteWheelHandle>();
  const element = (
    <MinuteWheel
      ref={ref}
      value={value}
      min={1}
      max={180}
      onChange={onChange}
      unit="dk"
      accessibilityLabel="Süre"
      valueText={valueText}
      decrementLabel="Bir dakika azalt"
      incrementLabel="Bir dakika artır"
    />
  );
  const view = renderWithProviders(element, { theme });
  return { onChange, ref, view, element };
}

const flat = (node: { props: { style?: unknown } }) => {
  const style = node.props.style;
  const list = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...list.filter(Boolean)) as Record<string, unknown>;
};

const scrollToOffset = (y: number) =>
  fireEvent.scroll(screen.getByTestId('minute-wheel-scroll'), {
    nativeEvent: { contentOffset: { x: 0, y } },
  });
const scrollTo = (minute: number) => scrollToOffset((minute - 1) * WHEEL_ROW_HEIGHT);

const selectedNow = () => screen.getByTestId('minute-wheel-value').props.accessibilityValue.now;

/** The style a row's Text is drawn with (the animated values resolved). */
const rowMotion = (minute: number) => flat(screen.getByTestId(`minute-wheel-row-${minute}`));

type Node = ReturnType<typeof screen.getByTestId>;

/** Animated's interpolation class (not in its TypeScript types). */
const AnimatedInterpolation = (Animated as unknown as { Interpolation: new (...args: never[]) => unknown })
  .Interpolation;

/**
 * The style a row hands to its Animated.Text, before Animated resolves it:
 * the first element above the host Text whose style holds animated values.
 */
const rowAnimatedStyle = (minute: number) => {
  let node: Node | null = screen.getByTestId(`minute-wheel-row-${minute}`);
  while (node) {
    const style = flat(node);
    if (style.opacity instanceof AnimatedInterpolation) return style;
    node = node.parent;
  }
  return {} as Record<string, unknown>;
};

const valueOf = (animated: unknown): number =>
  (animated as { __getValue(): number }).__getValue();

// The rows are hidden from screen readers (the wheel is one adjustable control); the tests still look at them.
beforeAll(() => configure({ defaultIncludeHiddenElements: true }));
afterAll(() => configure({ defaultIncludeHiddenElements: false }));

describe('minuteAtOffset and minuteAtTap', () => {
  it('maps the offset to the nearest minute without wrapping', () => {
    expect(minuteAtOffset(0, 1, 180)).toBe(1);
    expect(minuteAtOffset(36 * WHEEL_ROW_HEIGHT, 1, 180)).toBe(37);
    expect(minuteAtOffset(36.4 * WHEEL_ROW_HEIGHT, 1, 180)).toBe(37);
    expect(minuteAtOffset(36.6 * WHEEL_ROW_HEIGHT, 1, 180)).toBe(38);
    expect(minuteAtOffset(-500, 1, 180)).toBe(1);
    expect(minuteAtOffset(99999, 1, 180)).toBe(180);
  });

  it('maps a tap inside the rows to the row under it', () => {
    expect(minuteAtTap(0, 1, 180)).toBe(1);
    expect(minuteAtTap(WHEEL_ROW_HEIGHT - 1, 1, 180)).toBe(1);
    expect(minuteAtTap(WHEEL_ROW_HEIGHT, 1, 180)).toBe(2);
    expect(minuteAtTap(20 * WHEEL_ROW_HEIGHT + 5, 1, 180)).toBe(21);
    expect(minuteAtTap(-10, 1, 180)).toBe(1);
    expect(minuteAtTap(1e6, 1, 180)).toBe(180);
  });
});

describe('MinuteWheel', () => {
  it('shows three rows of 36dp', () => {
    expect(WHEEL_VISIBLE_ROWS).toBe(3);
    expect(WHEEL_HEIGHT).toBe(3 * 36);
    renderWheel(20);
    expect(flat(screen.getByTestId('minute-wheel-value')).height).toBe(WHEEL_HEIGHT);
    // One row above and one below the band: the content is padded by one row.
    const scroll = screen.getByTestId('minute-wheel-scroll');
    expect(flat({ props: { style: scroll.props.contentContainerStyle } }).paddingVertical).toBe(
      WHEEL_ROW_HEIGHT,
    );
  });

  it('opens on the given minute, with every whole minute from 1 to 180', () => {
    renderWheel(37);
    expect(selectedNow()).toBe(37);
    expect(screen.getByTestId('minute-wheel-value').props.accessibilityValue).toEqual({
      min: 1,
      max: 180,
      now: 37,
      text: '37 dakika',
    });
    expect(screen.getByTestId('minute-wheel-row-1')).toBeOnTheScreen();
    expect(screen.getByTestId('minute-wheel-row-180')).toBeOnTheScreen();
    expect(screen.queryByTestId('minute-wheel-row-0')).toBeNull();
    expect(screen.queryByTestId('minute-wheel-row-181')).toBeNull();
  });

  it('sends its first offset once: the same object after a scroll-driven re-render', () => {
    renderWheel(20);
    const before = screen.getByTestId('minute-wheel-scroll').props.contentOffset;
    expect(before).toEqual({ x: 0, y: 19 * WHEEL_ROW_HEIGHT });

    scrollToOffset(5 * WHEEL_ROW_HEIGHT + 10);
    expect(selectedNow()).toBe(6);

    const after = screen.getByTestId('minute-wheel-scroll').props.contentOffset;
    expect(after).toBe(before);
    expect(after.y).toBe(19 * WHEEL_ROW_HEIGHT);
  });

  it('draws every row once, in one style; the rows near the band are sized and faded by the scroll position', () => {
    renderWheel(37);
    const T = themes['gece-mavisi'];
    for (const minute of [1, 36, 37, 38, 180]) {
      const style = rowMotion(minute);
      expect(style.fontFamily).toBe(T.fontDisplay);
      expect(style.fontSize).toBe(34);
      expect(style.lineHeight).toBe(46);
      expect(style.fontVariant).toEqual(['tabular-nums']);
    }
    for (const minute of [37 - WHEEL_LIVE_ROWS, 36, 37, 38, 37 + WHEEL_LIVE_ROWS]) {
      // Interpolations of the native scroll value, not fixed numbers.
      const animated = rowAnimatedStyle(minute);
      expect(animated.opacity).toBeInstanceOf(AnimatedInterpolation);
      const transform = animated.transform as { scale: unknown }[];
      expect(transform[0].scale).toBeInstanceOf(AnimatedInterpolation);
    }
  });

  it('rows further from the band are plain texts at the neighbour size, as the clamped interpolation draws them (LR-3)', () => {
    expect(WHEEL_LIVE_ROWS).toBeGreaterThanOrEqual(4);
    renderWheel(37);
    for (const minute of [1, 37 - WHEEL_LIVE_ROWS - 1, 37 + WHEEL_LIVE_ROWS + 1, 180]) {
      expect(rowAnimatedStyle(minute)).toEqual({});
      expect(rowMotion(minute)).toMatchObject({
        opacity: WHEEL_NEIGHBOUR_OPACITY,
        transform: [{ scale: WHEEL_NEIGHBOUR_SCALE }],
      });
    }
    // A few dozen native-driven rows at most, not 180.
    const live = Array.from({ length: 180 }, (_, i) => i + 1).filter(
      minute => rowAnimatedStyle(minute).opacity instanceof AnimatedInterpolation,
    );
    expect(live).toHaveLength(2 * WHEEL_LIVE_ROWS + 1);
  });

  it('the live rows follow the selected minute', () => {
    renderWheel(37);
    scrollTo(90);
    expect(selectedNow()).toBe(90);
    expect(rowAnimatedStyle(90 + WHEEL_LIVE_ROWS).opacity).toBeInstanceOf(AnimatedInterpolation);
    expect(rowAnimatedStyle(90 - WHEEL_LIVE_ROWS).opacity).toBeInstanceOf(AnimatedInterpolation);
    expect(rowAnimatedStyle(37)).toEqual({});
    // Near the end the window is cut there.
    scrollTo(180);
    expect(rowAnimatedStyle(180).opacity).toBeInstanceOf(AnimatedInterpolation);
    expect(rowAnimatedStyle(180 - WHEEL_LIVE_ROWS - 1)).toEqual({});
  });

  it('a scroll from code keeps every row on its way live until it arrives', () => {
    const { ref } = renderWheel(25);
    act(() => ref.current?.scrollToMinute(60));
    // Selected at once, the scroll still at 25: the rows from 25 to 60 grow on the band as it passes.
    for (const minute of [25 - WHEEL_LIVE_ROWS, 25, 40, 60, 60 + WHEEL_LIVE_ROWS]) {
      expect(rowAnimatedStyle(minute).opacity).toBeInstanceOf(AnimatedInterpolation);
    }
    for (const minute of [30, 45, 59]) scrollTo(minute);
    expect(rowAnimatedStyle(25).opacity).toBeInstanceOf(AnimatedInterpolation);
    // Arrived: the window is around 60 again.
    scrollTo(60);
    expect(rowAnimatedStyle(25)).toEqual({});
    expect(rowAnimatedStyle(60 - WHEEL_LIVE_ROWS).opacity).toBeInstanceOf(AnimatedInterpolation);
  });

  it('a silent jump from code moves the window at once', () => {
    const { ref } = renderWheel(25);
    act(() => ref.current?.setMinute(120, false));
    expect(rowAnimatedStyle(120).opacity).toBeInstanceOf(AnimatedInterpolation);
    expect(rowAnimatedStyle(25)).toEqual({});
  });

  it('a row is full size on the band and 0.6 at half opacity one row or more away', () => {
    renderWheel(37);
    const scale = (minute: number) =>
      valueOf((rowAnimatedStyle(minute).transform as { scale: unknown }[])[0].scale);
    const opacity = (minute: number) => valueOf(rowAnimatedStyle(minute).opacity);
    // The scroll value starts at the opening offset (minute 37).
    expect(scale(37)).toBe(1);
    expect(scale(36)).toBeCloseTo(WHEEL_NEIGHBOUR_SCALE);
    expect(scale(38)).toBeCloseTo(WHEEL_NEIGHBOUR_SCALE);
    expect(scale(40)).toBeCloseTo(WHEEL_NEIGHBOUR_SCALE);
    expect(opacity(37)).toBe(1);
    expect(opacity(38)).toBeCloseTo(WHEEL_NEIGHBOUR_OPACITY);
    // Drawn with those values.
    expect(rowMotion(37).opacity).toBe(1);
    expect(rowMotion(38).opacity).toBeCloseTo(WHEEL_NEIGHBOUR_OPACITY);
  });

  it('has exactly one unit, on the band, and it stays mounted while scrolling', () => {
    renderWheel(25);
    expect(screen.getAllByText('dk')).toHaveLength(1);
    const unit = screen.getByTestId('minute-wheel-unit');
    scrollTo(30);
    scrollTo(31);
    expect(screen.getAllByText('dk')).toHaveLength(1);
    expect(screen.getByTestId('minute-wheel-unit')).toBe(unit);
  });

  it('a scroll that changes the minute re-renders no row', () => {
    renderWheel(25);
    const before = [24, 25, 26, 27].map(m => screen.getByTestId(`minute-wheel-row-${m}`).props);
    scrollTo(26);
    expect(selectedNow()).toBe(26);
    const after = [24, 25, 26, 27].map(m => screen.getByTestId(`minute-wheel-row-${m}`).props);
    after.forEach((props, i) => expect(props).toBe(before[i]));
  });

  it('a parent render with the same props renders nothing inside', () => {
    const { view, element } = renderWheel(25);
    const before = screen.getByTestId('minute-wheel-row-25').props;
    const wheelBefore = screen.getByTestId('minute-wheel-value').props;
    view.rerender(element);
    expect(screen.getByTestId('minute-wheel-row-25').props).toBe(before);
    expect(screen.getByTestId('minute-wheel-value').props).toBe(wheelBefore);
  });

  it('follows the scroll position and reports every minute it passes', () => {
    const { onChange } = renderWheel(25);
    scrollTo(26);
    scrollTo(27);
    scrollTo(27);
    expect(onChange.mock.calls).toEqual([[26], [27]]);
    expect(selectedNow()).toBe(27);
  });

  it('tapping at the row below selects the next minute', () => {
    const { onChange } = renderWheel(20);
    const tap = screen.getByTestId('minute-wheel-tap');
    // Rows start at minute 1; the row of 21 spans 20 x 36 to 21 x 36.
    fireEvent.press(tap, { nativeEvent: { locationY: 20 * WHEEL_ROW_HEIGHT + 12 } });
    expect(onChange).toHaveBeenLastCalledWith(21);
    expect(selectedNow()).toBe(21);
    fireEvent.press(tap, { nativeEvent: { locationY: 19 * WHEEL_ROW_HEIGHT + 30 } });
    expect(selectedNow()).toBe(20);
  });

  it('a scroll from code reports its minute once, not the minutes it passes on the way', () => {
    const { onChange, ref } = renderWheel(25);
    act(() => ref.current?.scrollToMinute(9));
    expect(onChange.mock.calls).toEqual([[9]]);
    // The animated scroll reports the offsets between 25 and 9.
    for (const minute of [25, 24, 20, 15, 10, 9, 9]) scrollTo(minute);
    expect(onChange.mock.calls).toEqual([[9]]);
    expect(selectedNow()).toBe(9);
    // Arrived: the finger's scrolls report again.
    scrollTo(10);
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it('a silent move from code reports nothing on the way either', () => {
    const { onChange, ref } = renderWheel(25);
    act(() => ref.current?.setMinute(40));
    for (const minute of [26, 30, 35, 39, 40]) scrollTo(minute);
    expect(onChange).not.toHaveBeenCalled();
    expect(selectedNow()).toBe(40);
  });

  it('a tapped neighbour is reported once, also while the scroll still passes the old minute', () => {
    const { onChange } = renderWheel(20);
    fireEvent.press(screen.getByTestId('minute-wheel-tap'), {
      nativeEvent: { locationY: 20 * WHEEL_ROW_HEIGHT + 12 },
    });
    scrollTo(20);
    scrollTo(21);
    expect(onChange.mock.calls).toEqual([[21]]);
    expect(selectedNow()).toBe(21);
  });

  it('a finger that takes the wheel during a scroll from code is followed at once', () => {
    const { onChange, ref } = renderWheel(25);
    act(() => ref.current?.scrollToMinute(60));
    scrollTo(30);
    fireEvent(screen.getByTestId('minute-wheel-scroll'), 'scrollBeginDrag');
    scrollTo(31);
    expect(onChange.mock.calls).toEqual([[60], [31]]);
    expect(selectedNow()).toBe(31);
  });

  it('the rows are not separate targets for screen readers; the wheel is one adjustable control', () => {
    renderWheel(20);
    expect(screen.getByTestId('minute-wheel-tap').props.accessible).toBe(false);
    expect(screen.getByTestId('minute-wheel-tap').props.importantForAccessibility).toBe('no-hide-descendants');
    expect(screen.getByTestId('minute-wheel-value').props.accessibilityRole).toBe('adjustable');
  });

  it('minus and plus move one minute per tap', () => {
    const { onChange } = renderWheel(37);
    fireEvent(screen.getByTestId('minute-wheel-plus'), 'pressIn');
    fireEvent(screen.getByTestId('minute-wheel-plus'), 'pressOut');
    expect(onChange).toHaveBeenLastCalledWith(38);
    fireEvent(screen.getByTestId('minute-wheel-minus'), 'pressIn');
    fireEvent(screen.getByTestId('minute-wheel-minus'), 'pressOut');
    expect(onChange).toHaveBeenLastCalledWith(37);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('repeats while a button is held and stops on release', () => {
    const { onChange } = renderWheel(37);
    fireEvent(screen.getByTestId('minute-wheel-plus'), 'pressIn');
    expect(selectedNow()).toBe(38);
    act(() => {
      jest.advanceTimersByTime(WHEEL_REPEAT_DELAY_MS + WHEEL_REPEAT_INTERVAL_MS * 3);
    });
    expect(selectedNow()).toBe(41);
    fireEvent(screen.getByTestId('minute-wheel-plus'), 'pressOut');
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(selectedNow()).toBe(41);
    expect(onChange).toHaveBeenLastCalledWith(41);
  });

  it('disables minus at 1 and plus at 180, with a faint glyph, and a held button stops at the end', () => {
    renderWheel(1);
    const T = themes['gece-mavisi'];
    expect(screen.getByTestId('minute-wheel-minus')).toBeDisabled();
    expect(screen.getByTestId('minute-wheel-plus')).toBeEnabled();
    const glyph = (id: string) =>
      flat(screen.getByTestId(id).findAll((node: Node) => typeof node.type === 'string' && node.type === 'Text')[0]);
    expect(glyph('icon-minus').color).toBe(T.text3);
    expect(glyph('icon-plus').color).toBe(T.text);
    screen.unmount();

    const { onChange } = renderWheel(179);
    fireEvent(screen.getByTestId('minute-wheel-plus'), 'pressIn');
    act(() => {
      jest.advanceTimersByTime(WHEEL_REPEAT_DELAY_MS + WHEEL_REPEAT_INTERVAL_MS * 5);
    });
    expect(selectedNow()).toBe(180);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('minute-wheel-plus')).toBeDisabled();
  });

  it('the ref scrolls the wheel and reports it, or moves it silently', () => {
    const { onChange, ref } = renderWheel(37);
    act(() => ref.current?.scrollToMinute(4));
    expect(selectedNow()).toBe(4);
    expect(onChange).toHaveBeenLastCalledWith(4);
    act(() => ref.current?.scrollToMinute(999));
    expect(selectedNow()).toBe(180);

    onChange.mockClear();
    act(() => ref.current?.setMinute(12));
    expect(selectedNow()).toBe(12);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('answers the screen reader actions', () => {
    const { onChange } = renderWheel(10);
    const wheel = screen.getByTestId('minute-wheel-value');
    expect(wheel.props.accessibilityRole).toBe('adjustable');
    fireEvent(wheel, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).toHaveBeenLastCalledWith(11);
    fireEvent(wheel, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', scheme => {
    renderWheel(37, scheme);
    const T = themes[scheme];
    expect(rowMotion(37).color).toBe(T.text);
    expect(rowMotion(36).color).toBe(T.text);
    expect(flat(screen.getByTestId('minute-wheel-unit')).color).toBe(T.text2);
    // The selected minute sits on a band of the canvas colour.
    expect(flat(screen.getByTestId('minute-wheel-band')).backgroundColor).toBe(T.bg);
    // Minus and plus are round tactile buttons one step above the canvas, on their lip.
    expect(flat(screen.getByTestId('minute-wheel-plus-face')).backgroundColor).toBe(T.surface);
    expect(flat(screen.getByTestId('minute-wheel-plus-lip')).backgroundColor).toBe(T.lip);
  });
});

describe('MinuteWheel, deferred rows (LR-4R)', () => {
  function renderDeferred(value: number, deferRows: boolean) {
    const props = {
      value,
      min: 1,
      max: 180,
      onChange: jest.fn(),
      unit: 'dk',
      accessibilityLabel: 'Süre',
      valueText: (minutes: number) => `${minutes} dakika`,
      decrementLabel: 'Bir dakika azalt',
      incrementLabel: 'Bir dakika artır',
    };
    const view = renderWithProviders(<MinuteWheel {...props} deferRows={deferRows} />);
    return { view, props };
  }
  const rows = () => screen.queryAllByTestId(/^minute-wheel-row-\d+$/);

  it('draws only the live rows around its minute, with spacers that keep every offset', () => {
    renderDeferred(25, true);
    const drawn = rows().map(row => Number(String(row.props.testID).split('-').pop()));
    expect(drawn).toEqual(Array.from({ length: 2 * WHEEL_LIVE_ROWS + 1 }, (_, i) => 25 - WHEEL_LIVE_ROWS + i));
    expect(flat(screen.getByTestId('minute-wheel-spacer-before')).height).toBe((25 - WHEEL_LIVE_ROWS - 1) * WHEEL_ROW_HEIGHT);
    expect(flat(screen.getByTestId('minute-wheel-spacer-after')).height).toBe((180 - 25 - WHEEL_LIVE_ROWS) * WHEEL_ROW_HEIGHT);
    // The band's minute is there, with its neighbours.
    expect(screen.getByTestId('minute-wheel-row-24')).toBeOnTheScreen();
    expect(screen.getByTestId('minute-wheel-row-26')).toBeOnTheScreen();
  });

  it('at the ends: no spacer on the side with nothing to stand for', () => {
    renderDeferred(1, true);
    expect(screen.queryByTestId('minute-wheel-spacer-before')).toBeNull();
    expect(screen.getByTestId('minute-wheel-row-1')).toBeOnTheScreen();
    expect(screen.getByTestId('minute-wheel-spacer-after')).toBeOnTheScreen();
  });

  it('the window follows the minute while deferred', () => {
    renderDeferred(25, true);
    scrollTo(40);
    expect(screen.getByTestId('minute-wheel-row-48')).toBeOnTheScreen();
    expect(screen.queryByTestId('minute-wheel-row-17')).toBeNull();
    expect(flat(screen.getByTestId('minute-wheel-spacer-before')).height).toBe((40 - WHEEL_LIVE_ROWS - 1) * WHEEL_ROW_HEIGHT);
  });

  it('turned off, all 180 rows are drawn and the spacers go', () => {
    const { view, props } = renderDeferred(25, true);
    view.rerender(<MinuteWheel {...props} deferRows={false} />);
    expect(rows()).toHaveLength(180);
    expect(screen.queryByTestId('minute-wheel-spacer-before')).toBeNull();
    expect(screen.queryByTestId('minute-wheel-spacer-after')).toBeNull();
  });

  it('by default every row is drawn', () => {
    renderDeferred(25, false);
    expect(rows()).toHaveLength(180);
  });
});
