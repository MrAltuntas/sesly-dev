/**
 * usePressTint: the press answer of a target without a lip, and above all
 * its way back to rest (V5R-01). A tab that a short tap had just focused
 * stayed drawn at PRESS_TINT after a slow switch: the press-in ran on the
 * native driver, the switch kept JS busy, and the end event of the press-in
 * (value 0.6) reached JS after the `setValue(1)` reset, so JS synced 0.6
 * back and committed it to the view. Only an animation started after it
 * ends after it, so the reset is a native timing to 1 (duration 0).
 *
 * `FakeNativeDriver` runs Animated.timing the way React Native 0.83 does
 * with the native driver (Animation.js): a started animation runs off the JS
 * thread; when it ends, or JS stops it, native sends an end event with its
 * value; JS handles the queued events later and writes each value to the JS
 * node (which Fabric then commits), also for an animation JS had already
 * stopped. `setValue` stops the running animation and sets the native node.
 */

import { Animated } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { DURATION, EASE, PRESS_TINT } from '../../theme/motion';
import { usePressTint } from './usePressTint';

type EndResult = { finished: boolean; value?: number };
type TimingConfig = { toValue: number; duration: number; easing?: unknown; useNativeDriver: boolean };

interface NativeRun {
  value: Animated.Value;
  toValue: number;
  done?: (result: EndResult) => void;
  notified: boolean;
}

/** The value JS holds (what the view is committed with), not the native node's. */
const jsValue = (value: Animated.Value) => (value as unknown as { __getValue(): number }).__getValue();

class FakeNativeDriver {
  /** The value of each native node. */
  readonly native = new Map<Animated.Value, number>();
  private readonly running = new Map<Animated.Value, NativeRun>();
  /** End events native has sent and JS has not handled yet (the JS thread is busy). */
  private readonly events: { run: NativeRun; value: number; finished: boolean }[] = [];
  readonly timing: jest.SpyInstance;
  readonly setValue: jest.SpyInstance;

  constructor() {
    const driver = this;
    this.timing = jest.spyOn(Animated, 'timing').mockImplementation(((
      value: Animated.Value,
      config: TimingConfig,
    ) => {
      let run: NativeRun | null = null;
      return {
        start: (done?: (result: EndResult) => void) => {
          // AnimatedValue.animate stops the animation it replaces.
          driver.stop(value);
          run = { value, toValue: config.toValue, done, notified: false };
          driver.running.set(value, run);
        },
        stop: () => {
          if (run && driver.running.get(value) === run) driver.stop(value);
        },
        reset: () => undefined,
      };
    }) as unknown as typeof Animated.timing);
    const realSetValue = Animated.Value.prototype.setValue;
    this.setValue = jest.spyOn(Animated.Value.prototype, 'setValue').mockImplementation(function (
      this: Animated.Value,
      next: number,
    ) {
      driver.stop(this);
      driver.native.set(this, next);
      realSetValue.call(this, next);
    });
    const realStop = Animated.Value.prototype.stopAnimation;
    jest.spyOn(Animated.Value.prototype, 'stopAnimation').mockImplementation(function (
      this: Animated.Value,
      callback?: (value: number) => void,
    ) {
      driver.stop(this);
      realStop.call(this, callback);
    });
  }

  /** JS stops the running animation: its end callback runs now, native sends its value. */
  private stop(value: Animated.Value): void {
    const run = this.running.get(value);
    if (!run) return;
    this.running.delete(value);
    this.notify(run, { finished: false });
    this.events.push({ run, value: this.native.get(value) ?? jsValue(value), finished: false });
  }

  private notify(run: NativeRun, result: EndResult): void {
    if (run.notified) return;
    run.notified = true;
    run.done?.(result);
  }

  /** A native frame: every running animation reaches its target and sends its end event. */
  frame(): void {
    for (const [value, run] of [...this.running]) {
      this.running.delete(value);
      this.native.set(value, run.toValue);
      this.events.push({ run, value: run.toValue, finished: true });
    }
  }

  /** JS is free again: it handles the queued end events in order. */
  deliver(): void {
    act(() => {
      for (const event of this.events.splice(0)) {
        this.notify(event.run, { finished: event.finished, value: event.value });
        (event.run.value as unknown as { __onAnimatedValueUpdateReceived(v: number): void }).__onAnimatedValueUpdateReceived(
          event.value,
        );
      }
    });
  }

  /** Native frames and JS handling until nothing runs. */
  settle(): void {
    this.frame();
    this.deliver();
  }

  /** The instant native returns to rest (duration 0) started on a value. */
  resets(value: Animated.Value): unknown[] {
    return this.timing.mock.calls.filter(
      ([target, config]) =>
        target === value &&
        (config as TimingConfig).toValue === 1 &&
        (config as TimingConfig).duration === 0 &&
        (config as TimingConfig).useNativeDriver === true,
    );
  }
}

let driver: FakeNativeDriver;

beforeEach(() => {
  driver = new FakeNativeDriver();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const renderTint = (disabled = false) =>
  renderHook(({ disabled: off }: { disabled: boolean }) => usePressTint(off), { initialProps: { disabled } });

describe('usePressTint: a press', () => {
  it('dims to PRESS_TINT in DURATION.pressIn and comes back in DURATION.pressOut, on the native driver', () => {
    const { result } = renderTint();
    act(() => result.current.onPressIn());
    expect(driver.timing).toHaveBeenLastCalledWith(
      result.current.opacity,
      expect.objectContaining({
        toValue: PRESS_TINT,
        duration: DURATION.pressIn,
        easing: EASE.standard,
        useNativeDriver: true,
      }),
    );
    driver.settle();
    expect(jsValue(result.current.opacity)).toBe(PRESS_TINT);

    act(() => result.current.onPressOut());
    expect(driver.timing).toHaveBeenLastCalledWith(
      result.current.opacity,
      expect.objectContaining({ toValue: 1, duration: DURATION.pressOut, easing: EASE.standard, useNativeDriver: true }),
    );
    driver.settle();
    expect(jsValue(result.current.opacity)).toBe(1);
    expect(driver.resets(result.current.opacity)).toHaveLength(0);
  });

  it('a press-out without a press-in, and a second press-out, start nothing', () => {
    const { result } = renderTint();
    act(() => result.current.onPressOut());
    expect(driver.timing).not.toHaveBeenCalled();
    act(() => result.current.onPressIn());
    act(() => {
      result.current.onPressOut();
      result.current.onPressOut();
    });
    expect(driver.timing).toHaveBeenCalledTimes(2);
  });

  it('a disabled target starts nothing, also on mount (a long list of disabled rows animates nothing)', () => {
    const { result } = renderTint(true);
    act(() => {
      result.current.onPressIn();
      result.current.onPressOut();
      result.current.reset();
    });
    expect(driver.timing).not.toHaveBeenCalled();
    expect(driver.setValue).not.toHaveBeenCalled();
    expect(jsValue(result.current.opacity)).toBe(1);
  });

  it('keeps one value and stable handlers across re-renders', () => {
    const { result, rerender } = renderTint();
    const first = result.current;
    rerender({ disabled: false });
    expect(result.current.opacity).toBe(first.opacity);
    expect(result.current.onPressOut).toBe(first.onPressOut);
    expect(result.current.reset).toBe(first.reset);
  });
});

describe('usePressTint: disabled while held (V5R-01)', () => {
  it('a slow switch: the press-in end event arrives after the reset, and the value still ends at 1', () => {
    const { result, rerender } = renderTint();
    const { opacity } = result.current;
    act(() => result.current.onPressIn());
    // The press-in ends on native while JS renders the new tab: its end event (0.6) waits.
    driver.frame();
    // The tab is focused (the tint is disabled) before Pressability's delayed press-out.
    rerender({ disabled: true });
    // Back to rest with a native timing to 1, not setValue (which the late 0.6 would undo).
    expect(driver.resets(opacity)).toHaveLength(1);
    expect(driver.setValue).not.toHaveBeenCalled();
    // The delayed press-out (minPressDuration) finds the target at rest.
    act(() => result.current.onPressOut());
    expect(driver.timing).toHaveBeenCalledTimes(2);
    // JS is free: the late 0.6 is handled first, the reset's 1 after it.
    driver.settle();
    expect(jsValue(opacity)).toBe(1);
    expect(driver.native.get(opacity)).toBe(1);
  });

  it('a press-in still in flight is stopped by the reset and the value ends at 1', () => {
    const { result, rerender } = renderTint();
    const { opacity } = result.current;
    act(() => result.current.onPressIn());
    rerender({ disabled: true });
    expect(driver.resets(opacity)).toHaveLength(1);
    driver.settle();
    expect(jsValue(opacity)).toBe(1);
    // Disabled now: a new press starts nothing.
    act(() => result.current.onPressIn());
    expect(driver.timing).toHaveBeenCalledTimes(2);
  });

  it('a press-out that came first returns as usual, and the later disable adds nothing', () => {
    const { result, rerender } = renderTint();
    const { opacity } = result.current;
    act(() => result.current.onPressIn());
    driver.frame();
    act(() => result.current.onPressOut());
    rerender({ disabled: true });
    expect(driver.resets(opacity)).toHaveLength(0);
    expect(driver.timing).toHaveBeenCalledTimes(2);
    driver.settle();
    expect(jsValue(opacity)).toBe(1);
  });

  it('enabled again after the reset: the next press dims and returns as usual', () => {
    const { result, rerender } = renderTint();
    const { opacity } = result.current;
    act(() => result.current.onPressIn());
    rerender({ disabled: true });
    driver.settle();
    rerender({ disabled: false });
    act(() => result.current.onPressIn());
    driver.settle();
    expect(jsValue(opacity)).toBe(PRESS_TINT);
    act(() => result.current.onPressOut());
    driver.settle();
    expect(jsValue(opacity)).toBe(1);
  });
});

describe('usePressTint: reset', () => {
  it('puts a held target at rest with a native timing to 1, so a late end event cannot leave it dimmed', () => {
    const { result } = renderTint();
    const { opacity } = result.current;
    act(() => result.current.onPressIn());
    driver.frame();
    act(() => result.current.reset());
    expect(driver.timing).toHaveBeenLastCalledWith(opacity, { toValue: 1, duration: 0, useNativeDriver: true });
    // A second reset and the delayed press-out start nothing more.
    act(() => {
      result.current.reset();
      result.current.onPressOut();
    });
    expect(driver.timing).toHaveBeenCalledTimes(2);
    driver.settle();
    expect(jsValue(opacity)).toBe(1);
  });

  it('does nothing at rest or while the value already returns to rest', () => {
    const { result } = renderTint();
    act(() => result.current.reset());
    expect(driver.timing).not.toHaveBeenCalled();
    act(() => result.current.onPressIn());
    act(() => result.current.onPressOut());
    act(() => result.current.reset());
    expect(driver.timing).toHaveBeenCalledTimes(2);
    driver.settle();
    expect(jsValue(result.current.opacity)).toBe(1);
  });
});
