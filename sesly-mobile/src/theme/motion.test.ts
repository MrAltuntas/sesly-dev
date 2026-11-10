/**
 * Motion tokens (docs/release-pass/SPEC-design.md 1.7 and 5.5): the order of
 * the durations, the feel of the springs, the reduced-motion rules of
 * `animateTo`, and the press tint of faceless targets.
 */

import { AccessibilityInfo, Animated } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import {
  CURVE,
  DURATION,
  EASE,
  PRESS_DELAY_MS,
  PRESS_TINT,
  SPRING_SHEET,
  SPRING_SNAPPY,
  animateTo,
  dampingRatio,
  easingFor,
  useReducedMotion,
} from './motion';
import { usePressTint } from '../components/design/usePressTint';

type TimingConfig = { toValue: number; duration: number; easing?: unknown; useNativeDriver: boolean };

/**
 * Animated.timing that lands at once (the native driver moves the value off
 * the JS thread; here it is set when started). Spy pattern of
 * library.test.tsx.
 */
function spyTiming() {
  return jest.spyOn(Animated, 'timing').mockImplementation(((value: Animated.Value, config: TimingConfig) => ({
    start: (cb?: (result: { finished: boolean }) => void) => {
      value.setValue(config.toValue);
      cb?.({ finished: true });
    },
    stop: () => undefined,
    reset: () => undefined,
  })) as unknown as typeof Animated.timing);
}

function valueOf(value: Animated.Value): number {
  return (value as unknown as { __getValue(): number }).__getValue();
}

describe('durations', () => {
  it('press, fast, base and enter grow in that order; leaving is quicker than arriving', () => {
    expect(DURATION.pressIn).toBeLessThan(DURATION.pressOut);
    expect(DURATION.pressOut).toBeLessThanOrEqual(DURATION.fast);
    expect(DURATION.fast).toBeLessThan(DURATION.base);
    expect(DURATION.base).toBeLessThan(DURATION.enter);
    expect(DURATION.exit).toBeLessThan(DURATION.enter);
    expect(DURATION.sheetExit).toBeLessThan(DURATION.sheetEnter);
  });

  it('loops are slower than any state change', () => {
    expect(DURATION.loop).toBeGreaterThan(DURATION.sheetEnter);
    expect(DURATION.pulse).toBeGreaterThan(DURATION.loop);
  });

  it('a press waits Android\'s tap timeout and dims to 0.6', () => {
    expect(PRESS_DELAY_MS).toBe(100);
    expect(PRESS_TINT).toBe(0.6);
  });
});

describe('springs', () => {
  it('the snappy spring overshoots a little, the sheet spring settles without visible overshoot', () => {
    const snappy = dampingRatio(SPRING_SNAPPY);
    expect(snappy).toBeGreaterThanOrEqual(0.6);
    expect(snappy).toBeLessThanOrEqual(0.85);
    expect(dampingRatio(SPRING_SHEET)).toBeGreaterThanOrEqual(0.85);
    expect(dampingRatio(SPRING_SHEET)).toBeLessThan(1);
  });

  it('dampingRatio is damping over the critical damping', () => {
    expect(dampingRatio({ stiffness: 100, damping: 20, mass: 1 })).toBe(1);
    expect(dampingRatio({ stiffness: 100, damping: 10, mass: 4 })).toBeCloseTo(0.25, 10);
  });
});

describe('curves', () => {
  it('every curve is a valid cubic-bezier that ends where it should', () => {
    for (const [x1, , x2] of Object.values(CURVE)) {
      expect(x1).toBeGreaterThanOrEqual(0);
      expect(x1).toBeLessThanOrEqual(1);
      expect(x2).toBeGreaterThanOrEqual(0);
      expect(x2).toBeLessThanOrEqual(1);
    }
    for (const ease of Object.values(EASE)) {
      expect(ease(0)).toBeCloseTo(0, 5);
      expect(ease(1)).toBeCloseTo(1, 5);
    }
  });

  it('standard decelerates, exit accelerates', () => {
    expect(EASE.standard(0.25)).toBeGreaterThan(0.25);
    expect(EASE.exit(0.25)).toBeLessThan(0.25);
    expect(EASE.linear(0.25)).toBeCloseTo(0.25, 10);
  });

  it('leaving uses the exit curve, loops the symmetric one, the rest the standard one', () => {
    expect(easingFor('exit')).toBe(EASE.exit);
    expect(easingFor('sheetExit')).toBe(EASE.exit);
    expect(easingFor('loop')).toBe(EASE.symmetric);
    expect(easingFor('pulse')).toBe(EASE.symmetric);
    for (const kind of ['pressIn', 'pressOut', 'fast', 'base', 'enter', 'sheetEnter'] as const) {
      expect(easingFor(kind)).toBe(EASE.standard);
    }
  });
});

describe('animateTo', () => {
  it('starts a native timing with the duration and curve of its kind', () => {
    const timing = spyTiming();
    const value = new Animated.Value(0);
    const onDone = jest.fn();
    const animation = animateTo(value, 1, 'base', false, { onDone });
    expect(animation).not.toBeNull();
    expect(timing).toHaveBeenCalledWith(
      value,
      expect.objectContaining({ toValue: 1, duration: DURATION.base, easing: EASE.standard, useNativeDriver: true }),
    );
    expect(valueOf(value)).toBe(1);
    expect(onDone).toHaveBeenCalledWith(true);

    animateTo(value, 0, 'exit', false);
    expect(timing).toHaveBeenLastCalledWith(
      value,
      expect.objectContaining({ toValue: 0, duration: DURATION.exit, easing: EASE.exit }),
    );
  });

  it('under reduced motion a translate jumps at once and nothing animates', () => {
    const timing = spyTiming();
    const value = new Animated.Value(0);
    const onDone = jest.fn();
    expect(animateTo(value, 22, 'base', true, { onDone })).toBeNull();
    expect(timing).not.toHaveBeenCalled();
    expect(valueOf(value)).toBe(22);
    expect(onDone).toHaveBeenCalledWith(true);
  });

  it('under reduced motion an opacity still cross-fades, in the fast duration', () => {
    const timing = spyTiming();
    const value = new Animated.Value(0);
    expect(animateTo(value, 1, 'sheetEnter', true, { fade: true })).not.toBeNull();
    expect(timing).toHaveBeenCalledWith(value, expect.objectContaining({ toValue: 1, duration: DURATION.fast }));
  });

  it('returns the started animation and reports an interrupted run as unfinished', () => {
    let finish: ((result: { finished: boolean }) => void) | undefined;
    const stop = jest.fn(() => finish?.({ finished: false }));
    jest.spyOn(Animated, 'timing').mockImplementation((() => ({
      start: (cb?: (result: { finished: boolean }) => void) => {
        finish = cb;
      },
      stop,
      reset: () => undefined,
    })) as unknown as typeof Animated.timing);
    const onDone = jest.fn();
    const animation = animateTo(new Animated.Value(0), 1, 'enter', false, { onDone });
    expect(onDone).not.toHaveBeenCalled();
    animation?.stop();
    expect(stop).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith(false);
  });

  it('a jump stops a running animation first', () => {
    const value = new Animated.Value(0);
    const stopAnimation = jest.spyOn(value, 'stopAnimation');
    animateTo(value, 1, 'base', true);
    expect(stopAnimation).toHaveBeenCalled();
    expect(valueOf(value)).toBe(1);
  });
});

describe('useReducedMotion', () => {
  it('is false until the system answers, then follows the setting live', async () => {
    let listener: ((value: boolean) => void) | undefined;
    const remove = jest.fn();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
      _event: string,
      handler: (value: boolean) => void,
    ) => {
      listener = handler;
      return { remove };
    }) as unknown as typeof AccessibilityInfo.addEventListener);

    const { result, unmount } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    await act(async () => {});
    expect(result.current).toBe(true);
    act(() => listener?.(false));
    expect(result.current).toBe(false);
    unmount();
    expect(remove).toHaveBeenCalled();
  });

  it('a change event wins over a slower query answer from before it', async () => {
    let resolve: (value: boolean) => void = () => undefined;
    let listener: ((value: boolean) => void) | undefined;
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockReturnValue(new Promise<boolean>(r => (resolve = r)));
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
      _event: string,
      handler: (value: boolean) => void,
    ) => {
      listener = handler;
      return { remove: () => undefined };
    }) as unknown as typeof AccessibilityInfo.addEventListener);

    const { result } = renderHook(() => useReducedMotion());
    act(() => listener?.(true));
    expect(result.current).toBe(true);
    // The query was sent before the switch and still says false.
    await act(async () => resolve(false));
    expect(result.current).toBe(true);
  });

  it('stays false when the query fails', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockRejectedValue(new Error('no a11y'));
    const { result } = renderHook(() => useReducedMotion());
    await act(async () => {});
    expect(result.current).toBe(false);
  });

  it('ignores an answer that arrives after unmount', async () => {
    let resolve: (value: boolean) => void = () => undefined;
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockReturnValue(new Promise<boolean>(r => (resolve = r)));
    const errors = jest.spyOn(console, 'error');
    const { result, unmount } = renderHook(() => useReducedMotion());
    unmount();
    await act(async () => resolve(true));
    expect(result.current).toBe(false);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('usePressTint', () => {
  it('pressIn starts a native timing to 0.6, pressOut back to 1', () => {
    const timing = spyTiming();
    const { result } = renderHook(() => usePressTint());
    expect(valueOf(result.current.opacity)).toBe(1);

    act(() => result.current.onPressIn());
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing).toHaveBeenLastCalledWith(
      result.current.opacity,
      expect.objectContaining({ toValue: PRESS_TINT, duration: DURATION.pressIn, useNativeDriver: true }),
    );
    expect(valueOf(result.current.opacity)).toBe(0.6);

    act(() => result.current.onPressOut());
    expect(timing).toHaveBeenCalledTimes(2);
    expect(timing).toHaveBeenLastCalledWith(
      result.current.opacity,
      expect.objectContaining({ toValue: 1, duration: DURATION.pressOut, useNativeDriver: true }),
    );
    expect(valueOf(result.current.opacity)).toBe(1);
  });

  it('a disabled target starts nothing', () => {
    const timing = spyTiming();
    const { result } = renderHook(() => usePressTint(true));
    act(() => {
      result.current.onPressIn();
      result.current.onPressOut();
    });
    expect(timing).not.toHaveBeenCalled();
    expect(valueOf(result.current.opacity)).toBe(1);
  });

  it('a press-out without a press-in does nothing', () => {
    const timing = spyTiming();
    const { result } = renderHook(() => usePressTint());
    act(() => result.current.onPressOut());
    expect(timing).not.toHaveBeenCalled();
  });

  it('a target disabled while held returns to rest at once', () => {
    const timing = spyTiming();
    const { result, rerender } = renderHook(({ disabled }: { disabled: boolean }) => usePressTint(disabled), {
      initialProps: { disabled: false },
    });
    act(() => result.current.onPressIn());
    expect(valueOf(result.current.opacity)).toBe(0.6);
    rerender({ disabled: true });
    expect(valueOf(result.current.opacity)).toBe(1);
    act(() => result.current.onPressOut());
    // The reset is an instant native timing (V5R-01, usePressTint.test.ts); the late press-out adds nothing.
    expect(timing).toHaveBeenCalledTimes(2);
    expect(timing).toHaveBeenLastCalledWith(result.current.opacity, { toValue: 1, duration: 0, useNativeDriver: true });
  });

  it('keeps one value across re-renders', () => {
    const { result, rerender } = renderHook(() => usePressTint());
    const first = result.current.opacity;
    rerender({});
    expect(result.current.opacity).toBe(first);
  });
});
