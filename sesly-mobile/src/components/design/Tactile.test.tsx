/**
 * Tactile: the press delay (SPEC-design 1.3 rule 3), the sink equal to the
 * lip on the motion tokens, the dimmed group, the opaque-face guard, and the
 * real Pressability timing of a swipe and a quick tap.
 */

import React from 'react';
import { Animated, Text } from 'react-native';
import { act, fireEvent, renderHook, screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { DURATION, EASE, PRESS_DELAY_MS } from '../../theme/motion';
import { LIP, RADIUS } from '../../theme/theme';
import * as TactileModule from './Tactile';
import { TACTILE_DIM_OPACITY, Tactile, usePressSink, usePressTint } from './Tactile';
import { usePressTint as tintHook } from './usePressTint';

const flat = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(5).filter(Boolean));

const valueOf = (value: Animated.Value | Animated.AnimatedInterpolation<number>) =>
  (value as unknown as { __getValue(): number }).__getValue();

/** Animated.timing that lands at once (the native driver runs off the JS thread). */
function spyTiming() {
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

const sinkCalls = (timing: jest.SpyInstance) =>
  timing.mock.calls.filter(([, config]) => (config as { toValue: number }).toValue === 1);

/** A responder event Pressability accepts (no touches: the event is the touch). */
function touch(timestamp = 0) {
  return {
    persist: () => undefined,
    currentTarget: { measure: () => undefined },
    nativeEvent: { timestamp, pageX: 10, pageY: 10, locationX: 10, locationY: 10, touches: [], changedTouches: [] },
  };
}

describe('Tactile press delay', () => {
  it('waits PRESS_DELAY_MS (100) by default and 0 with pressDelay={0}', () => {
    expect(PRESS_DELAY_MS).toBe(100);
    const view = renderWithProviders(<Tactile color="#111111" lipColor="#000000" onPress={jest.fn()} testID="t" />);
    // The delay is a prop of the Pressable (Pressability's delayPressIn).
    expect(view.UNSAFE_getByProps({ testID: 't', unstable_pressDelay: 100 })).toBeTruthy();
    view.rerender(<Tactile color="#111111" lipColor="#000000" onPress={jest.fn()} pressDelay={0} testID="t" />);
    expect(view.UNSAFE_getByProps({ testID: 't', unstable_pressDelay: 0 })).toBeTruthy();
  });

  it('a swipe that the scroll takes over within the delay never sinks the face', () => {
    const timing = spyTiming();
    const onPress = jest.fn();
    renderWithProviders(<Tactile color="#111111" lipColor="#000000" onPress={onPress} testID="t" />);
    const host = screen.getByTestId('t');
    fireEvent(host, 'responderGrant', touch());
    act(() => jest.advanceTimersByTime(80));
    fireEvent(host, 'responderTerminate', touch(80));
    act(() => jest.advanceTimersByTime(500));
    expect(sinkCalls(timing)).toHaveLength(0);
    expect(onPress).not.toHaveBeenCalled();
    expect(flat(screen.getByTestId('t-face')).transform).toEqual([{ translateY: 0 }]);
  });

  it('a tap shorter than the delay still shows the full sink and the rise', () => {
    const timing = spyTiming();
    const onPress = jest.fn();
    renderWithProviders(<Tactile color="#111111" lipColor="#000000" lip={LIP.md} onPress={onPress} testID="t" />);
    const host = screen.getByTestId('t');
    fireEvent(host, 'responderGrant', touch());
    act(() => jest.advanceTimersByTime(40));
    expect(sinkCalls(timing)).toHaveLength(0);
    fireEvent(host, 'responderRelease', touch(40));
    // Activated on release: the face sank by its lip and the press fired.
    expect(sinkCalls(timing)).toHaveLength(1);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(flat(screen.getByTestId('t-face')).transform).toEqual([{ translateY: LIP.md }]);
    // Pressability holds the rise for its minimum press duration.
    act(() => jest.advanceTimersByTime(130));
    expect(timing).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ toValue: 0 }));
    expect(flat(screen.getByTestId('t-face')).transform).toEqual([{ translateY: 0 }]);
  });

  it('a held press sinks once the delay has passed, and at once with pressDelay 0', () => {
    const timing = spyTiming();
    const view = renderWithProviders(<Tactile color="#111111" lipColor="#000000" onPress={jest.fn()} testID="t" />);
    fireEvent(screen.getByTestId('t'), 'responderGrant', touch());
    act(() => jest.advanceTimersByTime(99));
    expect(sinkCalls(timing)).toHaveLength(0);
    act(() => jest.advanceTimersByTime(1));
    expect(sinkCalls(timing)).toHaveLength(1);
    fireEvent(screen.getByTestId('t'), 'responderRelease', touch(100));
    act(() => jest.advanceTimersByTime(500));
    view.unmount();

    timing.mockClear();
    renderWithProviders(<Tactile color="#111111" lipColor="#000000" onPress={jest.fn()} pressDelay={0} testID="n" />);
    fireEvent(screen.getByTestId('n'), 'responderGrant', touch());
    expect(sinkCalls(timing)).toHaveLength(1);
  });
});

describe('Tactile sink', () => {
  it.each([LIP.sm, LIP.md, LIP.lg])('a %ddp lip: the face sinks by exactly the lip', lip => {
    spyTiming();
    renderWithProviders(<Tactile color="#111111" lipColor="#000000" lip={lip} onPress={jest.fn()} testID="t" />);
    expect(flat(screen.getByTestId('t-lip')).top).toBe(lip);
    expect(flat(screen.getByTestId('t'))).toMatchObject({ paddingBottom: lip });
    fireEvent(screen.getByTestId('t'), 'pressIn');
    expect(flat(screen.getByTestId('t-face')).transform).toEqual([{ translateY: lip }]);
    fireEvent(screen.getByTestId('t'), 'pressOut');
    expect(flat(screen.getByTestId('t-face')).transform).toEqual([{ translateY: 0 }]);
  });

  it('sinks in DURATION.pressIn and rises in DURATION.pressOut on the standard curve and the native driver', () => {
    const timing = spyTiming();
    renderWithProviders(<Tactile color="#111111" lipColor="#000000" onPress={jest.fn()} testID="t" />);
    fireEvent(screen.getByTestId('t'), 'pressIn');
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 1, duration: DURATION.pressIn, easing: EASE.standard, useNativeDriver: true }),
    );
    fireEvent(screen.getByTestId('t'), 'pressOut');
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 0, duration: DURATION.pressOut, easing: EASE.standard, useNativeDriver: true }),
    );
    // The old press constant is gone: the motion tokens are the only timing.
    expect('TACTILE_PRESS_MS' in TactileModule).toBe(false);
  });

  it('defaults to the md lip and the lg radius, and forwards a ring to the face', () => {
    renderWithProviders(
      <Tactile color="#111111" lipColor="#000000" borderColor="#ABCDEF" borderWidth={1} testID="t">
        <Text>Yüz</Text>
      </Tactile>,
    );
    expect(flat(screen.getByTestId('t'))).toMatchObject({ paddingBottom: LIP.md });
    expect(flat(screen.getByTestId('t-lip'))).toMatchObject({ top: LIP.md, borderRadius: RADIUS.lg });
    expect(flat(screen.getByTestId('t-face'))).toMatchObject({
      borderRadius: RADIUS.lg,
      borderColor: '#ABCDEF',
      borderWidth: 1,
    });
  });

  it('usePressSink: a control disabled while held rises at once and then ignores presses', () => {
    const timing = spyTiming();
    const { result, rerender } = renderHook(({ enabled }: { enabled: boolean }) => usePressSink(LIP.sm, enabled), {
      initialProps: { enabled: true },
    });
    act(() => result.current.onPressIn());
    expect(valueOf(result.current.translateY)).toBe(LIP.sm);
    rerender({ enabled: false });
    expect(valueOf(result.current.translateY)).toBe(0);
    timing.mockClear();
    act(() => result.current.onPressIn());
    expect(sinkCalls(timing)).toHaveLength(0);
    expect(valueOf(result.current.translateY)).toBe(0);
  });

  it('re-exports usePressTint next to usePressSink', () => {
    expect(usePressTint).toBe(tintHook);
  });
});

describe('Tactile disabled and dimmed', () => {
  it('a disabled control never sinks and stays a disabled button', () => {
    const timing = spyTiming();
    const onPress = jest.fn();
    renderWithProviders(<Tactile color="#111111" lipColor="#000000" onPress={onPress} disabled testID="t" />);
    fireEvent(screen.getByTestId('t'), 'pressIn');
    fireEvent.press(screen.getByTestId('t'));
    expect(sinkCalls(timing)).toHaveLength(0);
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('a disabled dimmed control fades as one composited group', () => {
    renderWithProviders(<Tactile color="#111111" lipColor="#000000" onPress={jest.fn()} disabled testID="t" />);
    const outer = screen.getByTestId('t');
    expect(flat(outer).opacity).toBe(TACTILE_DIM_OPACITY);
    expect(outer.props.needsOffscreenAlphaCompositing).toBe(true);
  });

  it('dimWhenDisabled false keeps full opacity and no offscreen layer', () => {
    renderWithProviders(
      <Tactile color="#111111" lipColor="#000000" onPress={jest.fn()} disabled dimWhenDisabled={false} testID="t" />,
    );
    const outer = screen.getByTestId('t');
    expect(flat(outer).opacity).toBe(1);
    expect(outer.props.needsOffscreenAlphaCompositing).toBe(false);
  });

  it('dimmed keeps the control pressable, composited, and sinking', () => {
    spyTiming();
    const onPress = jest.fn();
    const view = renderWithProviders(<Tactile color="#111111" lipColor="#000000" onPress={onPress} dimmed testID="t" />);
    const outer = screen.getByTestId('t');
    expect(flat(outer).opacity).toBe(TACTILE_DIM_OPACITY);
    expect(outer.props.needsOffscreenAlphaCompositing).toBe(true);
    fireEvent(outer, 'pressIn');
    expect(flat(screen.getByTestId('t-face')).transform).toEqual([{ translateY: LIP.md }]);
    fireEvent.press(outer);
    expect(onPress).toHaveBeenCalledTimes(1);
    view.unmount();
    // A static dimmed surface is composited too.
    renderWithProviders(<Tactile color="#111111" lipColor="#000000" dimmed testID="s" />);
    expect(screen.getByTestId('s').props.needsOffscreenAlphaCompositing).toBe(true);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('forwards an accessibility value', () => {
    renderWithProviders(
      <Tactile color="#111111" lipColor="#000000" onPress={jest.fn()} accessibilityValue={{ text: '3' }} testID="t" />,
    );
    expect(screen.getByTestId('t').props.accessibilityValue).toEqual({ text: '3' });
  });
});

describe('Tactile opaque face guard', () => {
  it('warns in development when a translucent face sits on a visible lip', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    renderWithProviders(<Tactile color="rgba(17, 17, 17, 0.5)" lipColor="#000000" testID="t" />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('rgba(17, 17, 17, 0.5)');
  });

  it('stays quiet for an opaque face, or a translucent one without a lip, and warns once per colour', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const view = renderWithProviders(<Tactile color="#111111" lipColor="#000000" testID="t" />);
    view.rerender(<Tactile color="rgba(0, 0, 0, 0.2)" lipColor="transparent" testID="t" />);
    expect(warn).not.toHaveBeenCalled();
    view.rerender(<Tactile color="rgba(0, 0, 0, 0.2)" lipColor="#000000" testID="t" />);
    view.rerender(<Tactile color="rgba(0, 0, 0, 0.2)" lipColor="#000000" testID="t" />);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a list of controls with the same translucent face warns once, a new colour again', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const view = renderWithProviders(
      <>
        {[1, 2, 3, 4].map(i => (
          <Tactile key={i} color="rgba(1, 2, 3, 0.4)" lipColor="#000000" onPress={jest.fn()} testID={`row-${i}`} />
        ))}
      </>,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    view.rerender(<Tactile color="rgba(4, 5, 6, 0.4)" lipColor="#000000" testID="t" />);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1][0])).toContain('rgba(4, 5, 6, 0.4)');
  });
});

describe('useNextFramePress (LR-4)', () => {
  const nextFrame = () =>
    act(() => {
      jest.advanceTimersByTime(16);
    });

  it('runs the press in the next frame, not inside the press', () => {
    const work = jest.fn();
    const { result } = renderHook(() => TactileModule.useNextFramePress(work));
    act(() => result.current?.());
    expect(work).not.toHaveBeenCalled();
    nextFrame();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('the sink a touch starts comes before the work the press starts', () => {
    const order: string[] = [];
    jest.spyOn(Animated, 'timing').mockImplementation(((
      value: Animated.Value,
      config: { toValue: number },
    ) => ({
      start: () => {
        order.push(config.toValue === 1 ? 'sink' : 'rise');
        value.setValue(config.toValue);
      },
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.timing);
    const Harness: React.FC = () => {
      const open = TactileModule.useNextFramePress(() => order.push('open'));
      return <Tactile color="#111111" lipColor="#000000" pressDelay={0} onPress={open} testID="t" />;
    };
    renderWithProviders(<Harness />);
    fireEvent(screen.getByTestId('t'), 'pressIn');
    fireEvent.press(screen.getByTestId('t'));
    fireEvent(screen.getByTestId('t'), 'pressOut');
    expect(order).toEqual(['sink', 'rise']);
    nextFrame();
    expect(order).toEqual(['sink', 'rise', 'open']);
  });

  it('runs once for taps within one frame, runs the latest handler, and drops a run on unmount', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { result, rerender, unmount } = renderHook(
      ({ handler }: { handler: () => void }) => TactileModule.useNextFramePress(handler),
      { initialProps: { handler: first } },
    );
    const run = result.current;
    act(() => {
      run?.();
      run?.();
    });
    rerender({ handler: second });
    // The same function across renders (a stable prop).
    expect(result.current).toBe(run);
    nextFrame();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    act(() => result.current?.());
    unmount();
    nextFrame();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('gives no handler for no press', () => {
    const { result } = renderHook(() => TactileModule.useNextFramePress(undefined));
    expect(result.current).toBeUndefined();
  });

  it('leaves the module API as it was: Tactile, usePressSink and the usePressTint re-export', () => {
    expect(typeof TactileModule.Tactile).toBe('function');
    expect(typeof TactileModule.usePressSink).toBe('function');
    expect(TactileModule.usePressTint).toBe(tintHook);
    expect(TactileModule.TACTILE_DIM_OPACITY).toBe(TACTILE_DIM_OPACITY);
  });
});
