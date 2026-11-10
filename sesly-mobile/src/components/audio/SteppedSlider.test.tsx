/**
 * SteppedSlider: equal-distance stops, ticks, labels and the marked stop
 * (playback speed, frame 5c); the knob and the fill on one native-driven
 * value (a tap glides in DURATION.base, a drag steps in DURATION.fast,
 * reduced motion jumps); the labels block sized from the font scale.
 */

import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { AccessibilityInfo, Animated, PixelRatio } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { themes } from '../../theme/theme';
import { DURATION, EASE } from '../../theme/motion';
import { scanSource } from '../../theme/designScan';
import {
  SLIDER_EDGE,
  SLIDER_MAX_FONT_SCALE,
  SteppedSlider,
  labelsBlockHeight,
  stopIndexAtX,
  stopPosition,
} from './SteppedSlider';

const LABELS = ['0,5x', '0,75x', '0,9x', '1,0x', '1,1x', '1,25x', '1,5x', '2,0x'];
const WIDTH = 312;

type SliderProps = React.ComponentProps<typeof SteppedSlider>;

const baseProps = (index: number, onChange: jest.Mock): SliderProps => ({
  labels: LABELS,
  index,
  onChange,
  markedIndex: 3,
  markedNote: 'Normal',
  accessibilityLabel: 'Oynatma hızı',
});

function renderSlider(index: number, theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi') {
  const onChange = jest.fn();
  const view = renderWithProviders(<SteppedSlider {...baseProps(index, onChange)} />, { theme });
  layout();
  return { onChange, view };
}

function layout(width: number = WIDTH) {
  fireEvent(screen.getByTestId('stepped-slider'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height: 100 } },
  });
}

/**
 * A controlled slider: every onChange becomes the new index, like the speed
 * sheet does through the store.
 */
function renderControlled(start: number) {
  const onChange = jest.fn();
  const Host: React.FC = () => {
    const [index, setIndex] = React.useState(start);
    return (
      <SteppedSlider
        {...baseProps(index, onChange)}
        onChange={next => {
          onChange(next);
          setIndex(next);
        }}
      />
    );
  };
  renderWithProviders(<Host />);
  layout();
  return onChange;
}

const flat = (node: { props: { style?: unknown } }) => {
  const style = node.props.style;
  const list = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...list.filter(Boolean)) as Record<string, unknown>;
};

/** Resolves an animated style value (plain numbers pass through). */
const resolved = (value: unknown): number =>
  typeof value === 'number' ? value : (value as { __getValue(): number }).__getValue();

const translateXOf = (testID: string): number => {
  const transform = (flat(screen.getByTestId(testID)).transform ?? []) as Array<Record<string, unknown>>;
  const entry = transform.find(t => 'translateX' in t);
  return entry ? resolved(entry.translateX) : 0;
};

/** Animated.timing that lands at once, like the native driver in a test. */
function instantTiming() {
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

/** A responder event as PanResponder reads it (one finger at `x`, before that at `previousX`). */
function touchAt(x: number, previousX: number = x, startX: number = stopPosition(0, 8, WIDTH)) {
  const now = Date.now();
  const point = { pageX: x, pageY: 0, locationX: x, locationY: 0, identifier: 1, timestamp: now };
  return {
    nativeEvent: { ...point, touches: [point], changedTouches: [point] },
    touchHistory: {
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: now,
      numberActiveTouches: 1,
      touchBank: [
        {
          touchActive: true,
          startPageX: startX,
          startPageY: 0,
          startTimeStamp: now,
          currentPageX: x,
          currentPageY: 0,
          currentTimeStamp: now,
          previousPageX: previousX,
          previousPageY: 0,
          previousTimeStamp: now - 16,
        },
      ],
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('stop geometry', () => {
  it('puts the stops at equal distances between the edges', () => {
    expect(stopPosition(0, 8, WIDTH)).toBe(SLIDER_EDGE);
    expect(stopPosition(7, 8, WIDTH)).toBe(WIDTH - SLIDER_EDGE);
    const step = stopPosition(1, 8, WIDTH) - stopPosition(0, 8, WIDTH);
    for (let i = 1; i < 8; i++) {
      expect(stopPosition(i, 8, WIDTH) - stopPosition(i - 1, 8, WIDTH)).toBeCloseTo(step);
    }
    expect(stopPosition(0, 1, WIDTH)).toBe(SLIDER_EDGE);
  });

  it('snaps a position to the nearest stop and clamps at the ends', () => {
    expect(stopIndexAtX(stopPosition(3, 8, WIDTH), 8, WIDTH)).toBe(3);
    expect(stopIndexAtX(stopPosition(3, 8, WIDTH) + 15, 8, WIDTH)).toBe(3);
    expect(stopIndexAtX(stopPosition(3, 8, WIDTH) + 25, 8, WIDTH)).toBe(4);
    expect(stopIndexAtX(-50, 8, WIDTH)).toBe(0);
    expect(stopIndexAtX(5000, 8, WIDTH)).toBe(7);
    expect(stopIndexAtX(100, 8, 0)).toBe(0);
    expect(stopIndexAtX(100, 1, WIDTH)).toBe(0);
  });

  it('sizes the labels block from the font scale, capped at 1.3', () => {
    // A label line (18), the gap (2) and the note line (15).
    expect(labelsBlockHeight(1)).toBe(35);
    expect(labelsBlockHeight(1.15)).toBe(Math.ceil(35 * 1.15));
    expect(labelsBlockHeight(1.3)).toBe(46);
    expect(labelsBlockHeight(2)).toBe(46);
    // A broken scale reads as 1.
    expect(labelsBlockHeight(Number.NaN)).toBe(35);
    expect(labelsBlockHeight(0)).toBe(35);
  });
});

describe('SteppedSlider', () => {
  it('draws a tick and a label for each stop, the thumb on the selected one', () => {
    renderSlider(3);
    LABELS.forEach((label, i) => {
      expect(screen.getByText(label)).toBeOnTheScreen();
      expect(flat(screen.getByTestId(`stepped-slider-tick-${i}`)).left).toBeCloseTo(
        stopPosition(i, 8, WIDTH) - 1.5,
      );
    });
    // The knob is centred on its stop by a transform; its left never changes.
    expect(flat(screen.getByTestId('stepped-slider-thumb')).left).toBe(-12);
    expect(translateXOf('stepped-slider-thumb')).toBeCloseTo(stopPosition(3, 8, WIDTH));
    expect(translateXOf('stepped-slider-thumb-lip')).toBeCloseTo(stopPosition(3, 8, WIDTH));
  });

  it('draws the fill as wide as the track, its right edge on the knob', () => {
    renderSlider(5);
    const fill = flat(screen.getByTestId('stepped-slider-fill'));
    expect(fill.width).toBe(WIDTH);
    expect(translateXOf('stepped-slider-fill')).toBeCloseTo(stopPosition(5, 8, WIDTH) - WIDTH);
    // The rail clips the fill.
    expect(flat(screen.getByTestId('stepped-slider-rail')).overflow).toBe('hidden');
  });

  it('places the knob on the first layout without a motion', () => {
    const timing = jest.spyOn(Animated, 'timing');
    renderSlider(6);
    expect(timing).not.toHaveBeenCalled();
    expect(translateXOf('stepped-slider-thumb')).toBeCloseTo(stopPosition(6, 8, WIDTH));
  });

  it('a new width places the knob again at once', () => {
    const timing = jest.spyOn(Animated, 'timing');
    renderSlider(7);
    layout(200);
    expect(timing).not.toHaveBeenCalled();
    expect(translateXOf('stepped-slider-thumb')).toBeCloseTo(stopPosition(7, 8, 200));
    expect(flat(screen.getByTestId('stepped-slider-fill')).width).toBe(200);
  });

  it('marks the normal stop with a tall light tick and its note, whichever stop is selected', () => {
    const T = themes['gece-mavisi'];
    renderSlider(6);
    const normal = flat(screen.getByTestId('stepped-slider-tick-3'));
    const other = flat(screen.getByTestId('stepped-slider-tick-6'));
    expect(normal.height).toBe((other.height as number) * 2);
    expect(normal.backgroundColor).toBe(T.text2);
    expect(other.backgroundColor).toBe(T.line);
    expect(flat(screen.getByText('Normal')).color).toBe(T.text2);
    // The selected label is heavier and in the action colour; the others are not.
    expect(flat(screen.getByText('1,5x')).color).toBe(T.action);
    expect(flat(screen.getByText('1,5x')).fontFamily).toBe(T.fontLabel);
    expect(flat(screen.getByText('1,0x')).color).toBe(T.text3);
    expect(flat(screen.getByText('1,0x')).fontFamily).toBe(T.fontBody);
  });

  it('a tap on a label selects that stop', () => {
    const { onChange } = renderSlider(3);
    fireEvent.press(screen.getByTestId('stepped-slider-label-5'));
    expect(onChange).toHaveBeenLastCalledWith(5);
    fireEvent.press(screen.getByTestId('stepped-slider-label-3'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a tap glides the knob to its stop in DURATION.base on the native driver', () => {
    const timing = instantTiming();
    renderControlled(3);
    fireEvent.press(screen.getByTestId('stepped-slider-label-6'));
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        toValue: stopPosition(6, 8, WIDTH),
        duration: DURATION.base,
        easing: EASE.standard,
        useNativeDriver: true,
      }),
    );
    // Knob and fill move together: they read the same value.
    expect(translateXOf('stepped-slider-thumb')).toBeCloseTo(stopPosition(6, 8, WIDTH));
    expect(translateXOf('stepped-slider-fill')).toBeCloseTo(stopPosition(6, 8, WIDTH) - WIDTH);
    expect(flat(screen.getByTestId('stepped-slider-thumb')).left).toBe(-12);
  });

  it('a touch on the track selects the nearest stop and a drag follows the finger', () => {
    const { onChange } = renderSlider(3);
    const track = screen.getByTestId('stepped-slider-track');
    fireEvent(track, 'responderGrant', touchAt(stopPosition(0, 8, WIDTH)));
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent(track, 'responderMove', touchAt(stopPosition(2, 8, WIDTH), stopPosition(0, 8, WIDTH)));
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it('the touch down glides in DURATION.base, each stop of the drag steps in DURATION.fast', () => {
    const timing = instantTiming();
    const onChange = renderControlled(3);
    const track = screen.getByTestId('stepped-slider-track');
    const start = stopPosition(1, 8, WIDTH);
    fireEvent(track, 'responderGrant', touchAt(start, start, start));
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: start, duration: DURATION.base, useNativeDriver: true }),
    );

    fireEvent(track, 'responderMove', touchAt(stopPosition(2, 8, WIDTH), start, start));
    expect(onChange).toHaveBeenLastCalledWith(2);
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: stopPosition(2, 8, WIDTH), duration: DURATION.fast, useNativeDriver: true }),
    );
    expect(translateXOf('stepped-slider-thumb')).toBeCloseTo(stopPosition(2, 8, WIDTH));

    // A move inside the same stop changes nothing and starts no motion.
    const calls = timing.mock.calls.length;
    fireEvent(track, 'responderMove', touchAt(stopPosition(2, 8, WIDTH) + 5, start, start));
    expect(timing).toHaveBeenCalledTimes(calls);
  });

  it('a stop set from outside (another screen) glides in DURATION.base', () => {
    const timing = instantTiming();
    const { view } = renderSlider(3);
    view.rerender(<SteppedSlider {...baseProps(0, jest.fn())} />);
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: stopPosition(0, 8, WIDTH), duration: DURATION.base }),
    );
  });

  it('under reduced motion the knob jumps to the stop with no timing', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const timing = jest.spyOn(Animated, 'timing');
    renderControlled(3);
    await act(async () => undefined);
    fireEvent.press(screen.getByTestId('stepped-slider-label-0'));
    expect(timing).not.toHaveBeenCalled();
    expect(translateXOf('stepped-slider-thumb')).toBeCloseTo(stopPosition(0, 8, WIDTH));
    expect(translateXOf('stepped-slider-fill')).toBeCloseTo(stopPosition(0, 8, WIDTH) - WIDTH);
  });

  it('caps the label and note texts at font scale 1.3', () => {
    renderSlider(3);
    expect(SLIDER_MAX_FONT_SCALE).toBe(1.3);
    LABELS.forEach(label => {
      expect(screen.getByText(label).props.maxFontSizeMultiplier).toBe(1.3);
    });
    expect(screen.getByText('Normal').props.maxFontSizeMultiplier).toBe(1.3);
  });

  it('the labels block is 35dp at font scale 1 and 46dp at 1.3, so the note never spills', () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
    renderSlider(3);
    expect(flat(screen.getByTestId('stepped-slider-labels')).height).toBe(35);
    expect(flat(screen.getByTestId('stepped-slider-labels')).minHeight).toBeUndefined();
    screen.unmount();

    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1.3);
    renderSlider(3);
    expect(flat(screen.getByTestId('stepped-slider-labels')).height).toBe(46);
    screen.unmount();

    // Larger scales are capped with the texts.
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(2);
    renderSlider(3);
    expect(flat(screen.getByTestId('stepped-slider-labels')).height).toBe(46);
  });

  it('is one adjustable control for screen readers', () => {
    const { onChange } = renderSlider(3);
    const track = screen.getByTestId('stepped-slider-track');
    expect(track.props.accessibilityRole).toBe('adjustable');
    expect(track.props.accessibilityLabel).toBe('Oynatma hızı');
    expect(track.props.accessibilityValue).toEqual({ min: 0, max: 7, now: 3, text: '1,0x' });
    fireEvent(track, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).toHaveBeenLastCalledWith(4);
    fireEvent(track, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it('does not step past the ends', () => {
    const { onChange } = renderSlider(7);
    fireEvent(screen.getByTestId('stepped-slider-track'), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('draws nothing of the knob or the fill before its width is known', () => {
    renderWithProviders(<SteppedSlider {...baseProps(3, jest.fn())} />);
    expect(screen.queryByTestId('stepped-slider-thumb')).toBeNull();
    expect(screen.queryByTestId('stepped-slider-fill')).toBeNull();
    // The labels are laid out but hidden until the stops are known.
    expect(flat(screen.getByTestId('stepped-slider-label-3')).opacity).toBe(0);
  });

  it.each(['SteppedSlider.tsx', 'SpeedSheet.tsx'])('%s keeps to the spacing, radius, lip and motion scale', file => {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    expect(scanSource(source, `src/components/audio/${file}`)).toEqual([]);
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('is drawn like the player progress in the %s palette', scheme => {
    renderSlider(3, scheme);
    const T = themes[scheme];
    // The knob on its lip, the fat track and the action fill.
    expect(flat(screen.getByTestId('stepped-slider-thumb')).backgroundColor).toBe(T.knob);
    const lip = flat(screen.getByTestId('stepped-slider-thumb-lip'));
    expect(lip.backgroundColor).toBe(T.knobLip);
    expect(lip.top).toBe((flat(screen.getByTestId('stepped-slider-thumb')).top as number) + 2);
    expect(flat(screen.getByTestId('stepped-slider-rail')).backgroundColor).toBe(T.line);
    expect(flat(screen.getByTestId('stepped-slider-fill')).backgroundColor).toBe(T.action);
    expect(flat(screen.getByText('1,0x')).color).toBe(T.action);
  });
});
