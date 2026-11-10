/**
 * Snackbar motion and shape (docs/release-pass/SPEC-design.md 1.7, 3.15;
 * r14-snackbar): it rises in, sinks out with the last message still drawn,
 * and casts no system shadow. A tone draws a mark before the text (V11); a
 * leaving bar still takes the touches on its area (F10).
 */

import React from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { LIP, themes } from '../../theme/theme';
import { PALETTE_KEYS } from '../../theme/palettes';
import { contrastRatio, mix } from '../../theme/color';
import { DURATION, EASE } from '../../theme/motion';
import { showToast } from '../../utils/toast';
import {
  SNACKBAR_ENTER_OFFSET,
  SNACKBAR_EXIT_OFFSET,
  SNACKBAR_MARK_SIZE,
  SNACKBAR_MARK_TINT,
  SNACKBAR_MIN_HEIGHT,
  SnackbarHost,
  sheetSnackbarClearance,
  snackbar,
  snackbarBottom,
  snackbarMark,
} from './Snackbar';

const gece = themes['gece-mavisi'];
const flat = (node: { props: { style?: unknown } }): Record<string, any> =>
  Object.assign({}, ...[node.props.style].flat(8).filter(Boolean));

afterEach(() => {
  act(() => {
    snackbar.dismiss();
    snackbar.setBottomInset(0);
  });
  act(() => {
    jest.advanceTimersByTime(DURATION.exit + 50);
  });
});

/**
 * Animated.timing that runs for its real duration on the fake clock (the
 * test environment ends a native-driver animation at once), lands on its
 * value, and is stopped by the next timing on the same value, like RN.
 */
function timedAnimations() {
  const running = new Map<Animated.Value, () => void>();
  return jest.spyOn(Animated, 'timing').mockImplementation(((
    value: Animated.Value,
    config: { toValue: number; duration: number },
  ) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let finish: ((r: { finished: boolean }) => void) | undefined;
    const stop = () => {
      if (timer == null) return;
      clearTimeout(timer);
      timer = null;
      running.delete(value);
      finish?.({ finished: false });
    };
    return {
      start: (done?: (r: { finished: boolean }) => void) => {
        running.get(value)?.();
        finish = done;
        running.set(value, stop);
        timer = setTimeout(() => {
          timer = null;
          running.delete(value);
          value.setValue(config.toValue);
          done?.({ finished: true });
        }, config.duration);
      },
      stop,
      reset: () => undefined,
    };
  }) as unknown as typeof Animated.timing);
}

const show = (message: string, extra: Partial<Parameters<typeof snackbar.show>[0]> = {}) => {
  let id = 0;
  act(() => {
    id = snackbar.show({ message, ...extra });
  });
  return id;
};

describe('SnackbarHost', () => {
  it('the bar has no elevation, a 3dp lip and radius 16; the host keeps its own elevation in the gutter', () => {
    renderWithProviders(<SnackbarHost />);
    show('Masal kaydedildi');
    const bar = flat(screen.getByTestId('snackbar'));
    expect(bar.elevation).toBeUndefined();
    expect(bar).toMatchObject({
      borderRadius: 16,
      borderBottomWidth: LIP.md,
      borderBottomColor: gece.lip,
      backgroundColor: gece.surface2,
    });
    expect(flat(screen.getByTestId('snackbar-host'))).toMatchObject({
      elevation: 12,
      left: gece.screenPadH,
      right: gece.screenPadH,
    });
    expect(gece.screenPadH).toBe(16);
  });

  it('enters: rises from 16dp below and fades in, both in DURATION.enter on the native driver', () => {
    const timing = jest.spyOn(Animated, 'timing');
    renderWithProviders(<SnackbarHost />);
    expect(timing).not.toHaveBeenCalled();
    show('Masal kaydedildi');
    const enter = timing.mock.calls.map(([, config]) => config);
    expect(enter).toHaveLength(2);
    expect(enter).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toValue: 0, duration: DURATION.enter, easing: EASE.standard, useNativeDriver: true }),
        expect.objectContaining({ toValue: 1, duration: DURATION.enter, easing: EASE.standard, useNativeDriver: true }),
      ]),
    );
    // It starts below its place and invisible.
    const bar = flat(screen.getByTestId('snackbar'));
    expect(bar.transform).toEqual([{ translateY: SNACKBAR_ENTER_OFFSET }]);
    expect(bar.opacity).toBe(0);
  });

  it('after a dismiss the last message stays drawn for DURATION.exit, sinking 8dp, then unmounts', () => {
    const timing = timedAnimations();
    renderWithProviders(<SnackbarHost />);
    show('Masal kaydedildi');
    act(() => {
      jest.advanceTimersByTime(DURATION.enter + 50);
    });
    timing.mockClear();

    act(() => snackbar.dismiss());
    expect(snackbar.getState().current).toBeNull();
    expect(screen.getByText('Masal kaydedildi')).toBeTruthy();
    const exit = timing.mock.calls.map(([, config]) => config);
    expect(exit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toValue: SNACKBAR_EXIT_OFFSET, duration: DURATION.exit, easing: EASE.exit, useNativeDriver: true }),
        expect.objectContaining({ toValue: 0, duration: DURATION.exit, easing: EASE.exit, useNativeDriver: true }),
      ]),
    );
    // A leaving bar still takes the touches on its area, so a tap aimed at
    // it never lands on the row under it (F10).
    expect(screen.getByTestId('snackbar').props.pointerEvents).toBe('auto');
    expect(screen.getByTestId('snackbar').props.onStartShouldSetResponder()).toBe(true);

    act(() => {
      jest.advanceTimersByTime(DURATION.exit - 1);
    });
    expect(screen.getByTestId('snackbar')).toBeTruthy();
    expect(screen.getByText('Masal kaydedildi')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('snackbar')).toBeNull();
  });

  it('times out after its duration, then leaves the same way', () => {
    timedAnimations();
    renderWithProviders(<SnackbarHost />);
    show('Bir dakika', { duration: 1000 });
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(snackbar.getState().current).toBeNull();
    expect(screen.getByText('Bir dakika')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(DURATION.exit + 50);
    });
    expect(screen.queryByText('Bir dakika')).toBeNull();
  });

  it('a message shown while the last one leaves takes the bar over and stays', () => {
    const timing = timedAnimations();
    renderWithProviders(<SnackbarHost />);
    show('Eski');
    act(() => {
      jest.advanceTimersByTime(DURATION.enter);
    });
    act(() => snackbar.dismiss());
    act(() => {
      jest.advanceTimersByTime(DURATION.exit / 2);
    });
    timing.mockClear();
    show('Yeni');
    // It turns back from where it is: no jump to 16dp below.
    expect(timing.mock.calls.map(([, config]) => config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toValue: 0, duration: DURATION.enter }),
        expect.objectContaining({ toValue: 1, duration: DURATION.enter }),
      ]),
    );
    expect(flat(screen.getByTestId('snackbar')).transform).not.toEqual([{ translateY: SNACKBAR_ENTER_OFFSET }]);
    // Past the moment the old exit would have ended: still there.
    act(() => {
      jest.advanceTimersByTime(DURATION.exit + 100);
    });
    expect(screen.getByText('Yeni')).toBeTruthy();
    expect(screen.queryByText('Eski')).toBeNull();
    expect(screen.getByTestId('snackbar').props.pointerEvents).toBe('auto');
  });

  it('a replacing message changes the bar in place, without a second entrance', () => {
    timedAnimations();
    renderWithProviders(<SnackbarHost />);
    show('Birinci');
    act(() => {
      jest.advanceTimersByTime(DURATION.enter + 50);
    });
    show('İkinci');
    expect(screen.getByText('İkinci')).toBeTruthy();
    expect(screen.queryByText('Birinci')).toBeNull();
    // It did not drop back below its place or fade out.
    expect(flat(screen.getByTestId('snackbar'))).toMatchObject({ transform: [{ translateY: 0 }], opacity: 1 });
  });

  it('the action runs once, also when pressed again while the bar leaves', () => {
    const onAction = jest.fn();
    renderWithProviders(<SnackbarHost />);
    show('Parmak Kız kaydedildi', { actionLabel: 'Göster', onAction });
    fireEvent.press(screen.getByRole('button', { name: 'Göster' }));
    fireEvent.press(screen.getByRole('button', { name: 'Göster' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('a leaving bar swallows a press on its action without running it', () => {
    const onAction = jest.fn();
    timedAnimations();
    renderWithProviders(<SnackbarHost />);
    show('Parmak Kız kaydedildi', { actionLabel: 'Göster', onAction });
    act(() => snackbar.dismiss());
    // Still drawn, still in the way, but its action is off.
    fireEvent.press(screen.getByTestId('snackbar-action'));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByTestId('snackbar').props.pointerEvents).toBe('auto');
  });

  it('under reduced motion it does not move, it only fades in DURATION.fast', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const timing = jest.spyOn(Animated, 'timing');
    renderWithProviders(<SnackbarHost />);
    await act(async () => undefined);
    show('Sessiz');
    const calls = timing.mock.calls.map(([, config]) => config);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ toValue: 1, duration: DURATION.fast, useNativeDriver: true });
    expect(flat(screen.getByTestId('snackbar')).transform).toEqual([{ translateY: 0 }]);

    timing.mockClear();
    act(() => snackbar.dismiss());
    const exit = timing.mock.calls.map(([, config]) => config);
    expect(exit).toHaveLength(1);
    expect(exit[0]).toMatchObject({ toValue: 0, duration: DURATION.fast });
    // Leaving, it stays in place too: no 8dp jump before the fade.
    expect(flat(screen.getByTestId('snackbar')).transform).toEqual([{ translateY: 0 }]);
    act(() => {
      jest.advanceTimersByTime(DURATION.fast + 50);
    });
    expect(screen.queryByTestId('snackbar')).toBeNull();
  });

  it('a neutral message has no mark; a success one leads with a check on a tinted disc', () => {
    renderWithProviders(<SnackbarHost />);
    show('Bilgi');
    expect(screen.queryByTestId('snackbar-mark')).toBeNull();

    show('Anlatıcı eklendi', { tone: 'success' });
    expect(flat(screen.getByTestId('snackbar-mark'))).toMatchObject({
      width: SNACKBAR_MARK_SIZE,
      height: SNACKBAR_MARK_SIZE,
      borderRadius: SNACKBAR_MARK_SIZE / 2,
      backgroundColor: mix(gece.success, SNACKBAR_MARK_TINT, gece.surface2),
    });
    // Decorative: hidden from screen readers, which read the message.
    expect(flat(screen.getByTestId('icon-check', { includeHiddenElements: true })).width).toBe(16);
  });

  it('an error or a warning leads with the alert mark in its own colour', () => {
    renderWithProviders(<SnackbarHost />);
    show('Bağlantı kurulamadı', { tone: 'error' });
    expect(flat(screen.getByTestId('snackbar-mark')).backgroundColor).toBe(mix(gece.error, SNACKBAR_MARK_TINT, gece.surface2));
    expect(screen.getByTestId('icon-alert', { includeHiddenElements: true })).toBeTruthy();
    show('Az kaldı', { tone: 'warning' });
    expect(flat(screen.getByTestId('snackbar-mark')).backgroundColor).toBe(mix(gece.warning, SNACKBAR_MARK_TINT, gece.surface2));
  });

  it('a message without an action keeps 16dp to the right edge, as to the left', () => {
    renderWithProviders(<SnackbarHost />);
    show('Bağlantı kurulamadı. İnternet bağlantını kontrol edip tekrar dene.');
    const bar = flat(screen.getByTestId('snackbar'));
    expect(bar.paddingLeft).toBe(16);
    const alone = flat(screen.getByText(/Bağlantı kurulamadı/));
    expect(bar.paddingRight + alone.paddingRight).toBe(bar.paddingLeft);

    // With an action, the action's own padding is the right inset.
    show('Parmak Kız kaydedildi', { actionLabel: 'Göster', onAction: jest.fn() });
    expect(flat(screen.getByText('Parmak Kız kaydedildi')).paddingRight).toBeUndefined();
  });

  it('showToast passes its level as the tone (info stays neutral)', () => {
    const spy = jest.spyOn(snackbar, 'show');
    showToast.success('Kaydedildi');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'Kaydedildi', tone: 'success' }));
    showToast.error('Olmadı');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'error' }));
    showToast.warning('Dikkat');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'warning' }));
    showToast.info('Bilgi');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'neutral' }));
  });

  it.each(PALETTE_KEYS)('%s: every mark stands off its disc and the disc off the bar', key => {
    const T = themes[key];
    expect(snackbarMark(T, 'neutral')).toBeNull();
    expect(snackbarMark(T, undefined)).toBeNull();
    for (const tone of ['success', 'error', 'warning'] as const) {
      const mark = snackbarMark(T, tone)!;
      expect(mark.disc).toMatch(/^#[0-9A-F]{6}$/);
      expect(mark.disc).not.toBe(T.surface2);
      // A graphic: 3:1 on its disc (WCAG 1.4.11), and the message text still reads beside it.
      expect(contrastRatio(mark.ink, mark.disc)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(T.text, T.surface2)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('unmounting while a message leaves is quiet', () => {
    timedAnimations();
    const error = jest.spyOn(console, 'error');
    const view = renderWithProviders(<SnackbarHost />);
    show('Gidiyor');
    act(() => snackbar.dismiss());
    view.unmount();
    act(() => {
      jest.advanceTimersByTime(DURATION.exit + 50);
    });
    expect(error).not.toHaveBeenCalled();
  });
});

describe('placement (V3-08)', () => {
  it('stays above the bottom chrome on screen; in a sheet always above the gesture area', () => {
    act(() => snackbar.setBottomInset(120));
    renderWithProviders(
      <>
        <SnackbarHost />
        <SnackbarHost inSheet />
      </>,
    );
    show('Sıra temizlendi', { actionLabel: 'Geri al', onAction: () => undefined });

    // No safe area in tests.
    expect(flat(screen.getByTestId('snackbar-host')).bottom).toBe(snackbarBottom(false, 120, 0));
    expect(flat(screen.getByTestId('sheet-snackbar-host')).bottom).toBe(snackbarBottom(true, 120, 0));
    expect(snackbarBottom(false, 120, 0)).toBe(128);
    expect(snackbarBottom(true, 120, 0)).toBe(16);
    expect(snackbarBottom(false, 0, 24)).toBe(40);
    expect(flat(screen.getByTestId('sheet-snackbar')).minHeight).toBe(SNACKBAR_MIN_HEIGHT);
  });

  it('the clearance of a sheet reaches past the top of its bar, at every font scale', () => {
    renderWithProviders(<SnackbarHost inSheet />);
    show('Sıra temizlendi', { actionLabel: 'Geri al', onAction: () => undefined });
    const bar = flat(screen.getByTestId('sheet-snackbar'));
    const message = flat(screen.getByText('Sıra temizlendi'));

    for (const [safeBottom, fontScale] of [
      [0, 1],
      [24, 1],
      [48, 1.3],
      [0, 2],
    ]) {
      // The bar as drawn: one line of message, its paddings and its lip.
      const height = Math.max(
        Number(bar.minHeight),
        Math.ceil(Number(message.lineHeight) * fontScale) +
          2 * Number(message.paddingVertical) +
          Number(bar.borderBottomWidth),
      );
      const top = snackbarBottom(true, 0, safeBottom) + height;
      expect(sheetSnackbarClearance(safeBottom, fontScale)).toBe(top + 8);
    }
  });
});
