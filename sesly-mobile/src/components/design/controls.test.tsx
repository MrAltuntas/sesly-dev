/**
 * Selection controls without bobbing (docs/release-pass/SPEC-design.md 3.8,
 * 1.7): the segmented control's sliding pill, its optimistic value and its
 * label layers; the switch knob; the switch row, checkbox, chip and tag.
 */

import React from 'react';
import { AccessibilityInfo, Animated, Text } from 'react-native';
import { act, configure, fireEvent, screen, within } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { LIP, themes } from '../../theme/theme';
import { DURATION, EASE, PRESS_DELAY_MS, SPRING_SNAPPY } from '../../theme/motion';
import { insetFace } from '../../theme/surfaces';
import { BottomSheet } from './BottomSheet';
import { Card } from './cards';
import { Checkbox, Chip, SegmentedControl, Switch, SwitchRow, Tag } from './controls';
import { SurfaceLevelProvider } from './SurfaceLevel';

configure({ defaultIncludeHiddenElements: true });

const gece = themes['gece-mavisi'];
const flat = (node: { props: { style?: unknown } }): Record<string, any> =>
  Object.assign({}, ...[node.props.style].flat(8).filter(Boolean));

/** Resolves an animated style value (plain numbers pass through). */
const resolved = (value: unknown): number =>
  typeof value === 'number' ? value : (value as { __getValue(): number }).__getValue();

const translateXOf = (node: { props: { style?: unknown } }): number => {
  const transform = (flat(node).transform ?? []) as Array<Record<string, unknown>>;
  const entry = transform.find(t => 'translateX' in t);
  return entry ? resolved(entry.translateX) : 0;
};

/** Animated.timing / spring that land at once, like the native driver in a test. */
function instantAnimations() {
  const land =
    (value: Animated.Value, config: { toValue: number }) => ({
      start: (done?: (r: { finished: boolean }) => void) => {
        value.setValue(config.toValue);
        done?.({ finished: true });
      },
      stop: () => undefined,
      reset: () => undefined,
    });
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(land as unknown as typeof Animated.timing);
  const spring = jest.spyOn(Animated, 'spring').mockImplementation(land as unknown as typeof Animated.spring);
  return { timing, spring };
}

async function withReducedMotion() {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
}

/** Lets the reduced-motion query of the mounted controls answer. */
async function settle() {
  await act(async () => undefined);
}

describe('SegmentedControl', () => {
  const segments = [
    { value: 'tr', label: 'Türkçe' },
    { value: 'en', label: 'English' },
    { value: 'de', label: 'Deutsch' },
  ] as const;
  type Lang = (typeof segments)[number]['value'];

  const layoutWell = (width = 320) =>
    fireEvent(screen.getByTestId('seg'), 'layout', {
      nativeEvent: { layout: { width, height: 42, x: 0, y: 0 } },
    });

  it('after a layout of 320 a press on the third segment springs the pill to it on the native driver', () => {
    const { spring } = instantAnimations();
    renderWithProviders(<SegmentedControl segments={segments} value="en" onChange={jest.fn()} testID="seg" />);
    layoutWell(320);
    // (320 - 8 - 2 * 4) / 3: one segment, the pill is as wide.
    const segW = (320 - 8 - 8) / 3;
    const pill = screen.getByTestId('seg-pill');
    expect(flat(pill).width).toBeCloseTo(segW, 5);
    expect(flat(pill)).toMatchObject({ position: 'absolute', top: 4, left: 4 });
    expect(translateXOf(pill)).toBeCloseTo(segW + 4, 5);

    fireEvent.press(screen.getByRole('radio', { name: 'Deutsch' }));
    expect(spring).toHaveBeenCalledTimes(1);
    expect(spring).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 2, useNativeDriver: true, ...SPRING_SNAPPY }),
    );
    expect(translateXOf(screen.getByTestId('seg-pill'))).toBeCloseTo(2 * (segW + 4), 5);
  });

  it('springs to index 1 from the first segment', () => {
    const { spring } = instantAnimations();
    renderWithProviders(<SegmentedControl segments={segments} value="tr" onChange={jest.fn()} testID="seg" />);
    layoutWell(320);
    fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    expect(spring).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 1, useNativeDriver: true }),
    );
  });

  it("the spring's overshoot never carries the pill past the first or the last segment (RC-5)", () => {
    let springValue: Animated.Value | null = null;
    jest.spyOn(Animated, 'spring').mockImplementation(((value: Animated.Value) => ({
      start: () => {
        springValue = value;
      },
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.spring);
    renderWithProviders(<SegmentedControl segments={segments} value="en" onChange={jest.fn()} testID="seg" />);
    layoutWell(320);
    const segW = (320 - 8 - 8) / 3;
    fireEvent.press(screen.getByRole('radio', { name: 'Deutsch' }));
    expect(springValue).not.toBeNull();

    // On its way: in step with the position.
    act(() => springValue!.setValue(1.5));
    expect(translateXOf(screen.getByTestId('seg-pill'))).toBeCloseTo(1.5 * (segW + 4), 5);
    // Past the last segment (the spring's 3 %): held at its place.
    act(() => springValue!.setValue(2.06));
    expect(translateXOf(screen.getByTestId('seg-pill'))).toBeCloseTo(2 * (segW + 4), 5);
    // Past the first one on the way back: held at 0.
    act(() => springValue!.setValue(-0.06));
    expect(translateXOf(screen.getByTestId('seg-pill'))).toBe(0);
  });

  it('two segments: the pill stays inside the well at both ends', () => {
    let springValue: Animated.Value | null = null;
    jest.spyOn(Animated, 'spring').mockImplementation(((value: Animated.Value) => ({
      start: () => {
        springValue = value;
      },
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.spring);
    const two = [
      { value: 'a', label: 'Masal bitince' },
      { value: 'b', label: 'Süre dolunca' },
    ] as const;
    renderWithProviders(<SegmentedControl segments={two} value="a" onChange={jest.fn()} testID="seg" />);
    layoutWell(320);
    const segW = (320 - 8 - 4) / 2;
    fireEvent.press(screen.getByRole('radio', { name: 'Süre dolunca' }));
    act(() => springValue!.setValue(1.04));
    expect(translateXOf(screen.getByTestId('seg-pill'))).toBeCloseTo(segW + 4, 5);
  });

  it("drives a caller's position value: it moves at the press, before onChange (LR-3R)", () => {
    const { spring } = instantAnimations();
    const position = new Animated.Value(0);
    const onChange = jest.fn();
    renderWithProviders(
      <SegmentedControl segments={segments} value="tr" onChange={onChange} position={position} testID="seg" />,
    );
    layoutWell(320);
    fireEvent.press(screen.getByRole('radio', { name: 'Deutsch' }));

    expect(spring).toHaveBeenCalledWith(position, expect.objectContaining({ toValue: 2, useNativeDriver: true }));
    expect(resolved(position)).toBe(2);
    // The caller hears of it only in the next frame; the value already moved.
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(16);
    });
    expect(onChange).toHaveBeenCalledWith('de');
  });

  it('a press that picks a segment lifts its press dimming at once, before the late press-out (LR-3R)', () => {
    const calls: Array<{ toValue: number; duration?: number }> = [];
    jest.spyOn(Animated, 'timing').mockImplementation(((
      value: Animated.Value,
      config: { toValue: number; duration?: number },
    ) => ({
      start: () => {
        calls.push(config);
        value.setValue(config.toValue);
      },
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.timing);
    jest.spyOn(Animated, 'spring').mockImplementation(((value: Animated.Value, config: { toValue: number }) => ({
      start: () => value.setValue(config.toValue),
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.spring);
    renderWithProviders(<SegmentedControl segments={segments} value="tr" onChange={jest.fn()} testID="seg" />);
    layoutWell(320);
    const target = screen.getByRole('radio', { name: 'English' });

    fireEvent(target, 'pressIn');
    expect(resolved(flat(screen.getByTestId('seg-en-labels')).opacity)).toBeLessThan(1);
    // The press lands before its press-out: the labels are back at rest at once.
    fireEvent(target, 'press');
    expect(calls[calls.length - 1]).toMatchObject({ toValue: 1, duration: 0 });
    expect(resolved(flat(screen.getByTestId('seg-en-labels')).opacity)).toBe(1);
    // The late press-out starts nothing more.
    const before = calls.length;
    fireEvent(target, 'pressOut');
    expect(calls).toHaveLength(before);
  });

  it('draws the pill inside the selected segment before the first layout, the shared pill after it', () => {
    renderWithProviders(<SegmentedControl segments={segments} value="en" onChange={jest.fn()} testID="seg" />);
    expect(screen.queryByTestId('seg-pill')).toBeNull();
    const inline = screen.getByTestId('seg-en-pill');
    // The pill fills the selected segment: same box as the measured pill.
    expect(flat(inline)).toMatchObject({ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 });
    expect(screen.queryByTestId('seg-tr-pill')).toBeNull();
    expect(screen.queryByTestId('seg-de-pill')).toBeNull();

    layoutWell(320);
    expect(screen.getByTestId('seg-pill')).toBeTruthy();
    expect(screen.queryByTestId('seg-en-pill')).toBeNull();
  });

  it('the pill is the action face on its 2dp action lip, radius 12', () => {
    renderWithProviders(<SegmentedControl segments={segments} value="en" onChange={jest.fn()} testID="seg" />);
    layoutWell(320);
    expect(flat(screen.getByTestId('seg-pill-lip'))).toMatchObject({
      backgroundColor: gece.actionLip,
      top: LIP.sm,
      borderRadius: 12,
    });
    expect(flat(screen.getByTestId('seg-pill-face'))).toMatchObject({
      backgroundColor: gece.action,
      bottom: LIP.sm,
      borderRadius: 12,
    });
  });

  it('each segment has two label layers whose opacities are interpolated from the pill position', () => {
    // A spring caught half way: the pill between Türkçe and English.
    let springValue: Animated.Value | null = null;
    jest.spyOn(Animated, 'spring').mockImplementation(((value: Animated.Value, config: { toValue: number }) => ({
      start: () => {
        springValue = value;
        value.setValue(config.toValue / 2);
      },
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.spring);
    renderWithProviders(<SegmentedControl segments={segments} value="tr" onChange={jest.fn()} testID="seg" />);
    layoutWell(320);
    const ink = (value: Lang) => {
      const f = flat(screen.getByTestId(`seg-${value}-label`));
      const a = flat(screen.getByTestId(`seg-${value}-label-alt`));
      const byColor: Record<string, number> = { [f.color]: f.opacity, [a.color]: a.opacity };
      return { onAction: byColor[gece.onAction], text2: byColor[gece.text2] };
    };
    expect(ink('tr')).toEqual({ onAction: 1, text2: 0 });
    expect(ink('en')).toEqual({ onAction: 0, text2: 1 });

    fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    expect(springValue).not.toBeNull();
    // Half way the two inks of both segments are half shown: a cross-fade, not a switch.
    expect(ink('tr')).toEqual({ onAction: 0.5, text2: 0.5 });
    expect(ink('en')).toEqual({ onAction: 0.5, text2: 0.5 });
    expect(ink('de')).toEqual({ onAction: 0, text2: 1 });

    act(() => springValue!.setValue(1));
    expect(ink('tr')).toEqual({ onAction: 0, text2: 1 });
    expect(ink('en')).toEqual({ onAction: 1, text2: 0 });
  });

  it('the label read by queries and screen readers takes the colour of the current choice; the other is hidden', () => {
    renderWithProviders(<SegmentedControl segments={segments} value="tr" onChange={jest.fn()} testID="seg" />);
    expect(flat(screen.getByTestId('seg-tr-label')).color).toBe(gece.onAction);
    expect(flat(screen.getByTestId('seg-en-label')).color).toBe(gece.text2);
    expect(screen.getByTestId('seg-en-label-alt').props.accessibilityElementsHidden).toBe(true);
    expect(screen.getByTestId('seg-en-label-alt').props.importantForAccessibility).toBe('no-hide-descendants');
    // The default query (hidden elements left out) finds one label per segment.
    expect(screen.getAllByText('English', { includeHiddenElements: false })).toHaveLength(1);
    expect(screen.getByTestId('seg-en-label').props.maxFontSizeMultiplier).toBe(1.3);
  });

  describe('label copies keep their ink (LA-3: no label vanishes while the pill slides)', () => {
    const labelOf = (value: Lang) => segments.find(s => s.value === value)!.label;
    /** Both copies of a segment label in tree order: the one in the flow, then the one over it. */
    const copies = (value: Lang) =>
      within(screen.getByTestId(`seg-${value}-labels`)).getAllByText(labelOf(value), {
        includeHiddenElements: true,
      });
    const inks = (value: Lang) => copies(value).map(node => flat(node).color);
    const opacities = (value: Lang) => copies(value).map(node => resolved(flat(node).opacity));

    it('fill mode: no copy changes colour at the press, and at pos=index the pill ink of the new choice is fully shown', () => {
      // A spring caught at its start: the pill has not left Türkçe yet.
      let springValue: Animated.Value | null = null;
      jest.spyOn(Animated, 'spring').mockImplementation(((value: Animated.Value) => ({
        start: () => {
          springValue = value;
        },
        stop: () => undefined,
        reset: () => undefined,
      })) as unknown as typeof Animated.spring);
      renderWithProviders(<SegmentedControl segments={segments} value="tr" onChange={jest.fn()} testID="seg" />);
      layoutWell(320);
      for (const value of ['tr', 'en', 'de'] as const) {
        expect(inks(value)).toEqual([gece.text2, gece.onAction]);
      }
      expect(opacities('tr')).toEqual([0, 1]);
      expect(opacities('en')).toEqual([1, 0]);

      fireEvent.press(screen.getByRole('radio', { name: 'English' }));
      expect(springValue).not.toBeNull();
      // The selection changed, the pill did not move: every copy draws what it drew before.
      for (const value of ['tr', 'en', 'de'] as const) {
        expect(inks(value)).toEqual([gece.text2, gece.onAction]);
      }
      expect(opacities('tr')).toEqual([0, 1]);
      expect(opacities('en')).toEqual([1, 0]);
      // Only the copy that is read follows the choice.
      expect(flat(screen.getByTestId('seg-en-label')).color).toBe(gece.onAction);
      expect(flat(screen.getByTestId('seg-tr-label')).color).toBe(gece.text2);
      expect(screen.getAllByText('English', { includeHiddenElements: false })).toHaveLength(1);
      expect(screen.getAllByText('Türkçe', { includeHiddenElements: false })).toHaveLength(1);

      act(() => springValue!.setValue(1));
      expect(opacities('en')).toEqual([0, 1]);
      expect(opacities('tr')).toEqual([1, 0]);
      expect(inks('en')).toEqual([gece.text2, gece.onAction]);
      expect(inks('tr')).toEqual([gece.text2, gece.onAction]);
    });

    it('compact mode: the copies keep their ink and the new choice ends fully on its pill', () => {
      instantAnimations();
      renderWithProviders(
        <SegmentedControl compact segments={segments} value="tr" onChange={jest.fn()} testID="seg" />,
      );
      expect(opacities('tr')).toEqual([0, 1]);

      fireEvent.press(screen.getByRole('radio', { name: 'English' }));
      for (const value of ['tr', 'en', 'de'] as const) {
        expect(inks(value)).toEqual([gece.text2, gece.onAction]);
      }
      expect(opacities('en')).toEqual([0, 1]);
      expect(opacities('tr')).toEqual([1, 0]);
      expect(flat(screen.getByTestId('seg-en-label')).color).toBe(gece.onAction);
      expect(screen.getByTestId('seg-tr-label-alt').props.accessibilityElementsHidden).toBe(true);
    });
  });

  it('the pill moves at the press and onChange runs only in the next frame', () => {
    const { spring } = instantAnimations();
    const onChange = jest.fn();
    renderWithProviders(<SegmentedControl segments={segments} value="tr" onChange={onChange} testID="seg" />);
    layoutWell(320);
    fireEvent.press(screen.getByRole('radio', { name: 'Deutsch' }));
    // Shown at once.
    expect(spring).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radio', { name: 'Deutsch' })).toBeSelected();
    expect(screen.getByRole('radio', { name: 'Türkçe' })).not.toBeSelected();
    expect(onChange).not.toHaveBeenCalled();

    act(() => jest.runOnlyPendingTimers());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('de');
  });

  it('a caller that answers at once is followed: its state change, or its refusal', () => {
    const Host: React.FC<{ accept: boolean }> = ({ accept }) => {
      const [value, setValue] = React.useState<Lang>('tr');
      return (
        <SegmentedControl
          segments={segments}
          value={value}
          onChange={next => {
            if (accept) setValue(next);
          }}
          testID="seg"
        />
      );
    };
    const view = renderWithProviders(<Host accept />);
    fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    act(() => jest.runOnlyPendingTimers());
    expect(screen.getByRole('radio', { name: 'English' })).toBeSelected();
    view.unmount();

    renderWithProviders(<Host accept={false} />);
    fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    expect(screen.getByRole('radio', { name: 'English' })).toBeSelected();
    act(() => jest.runOnlyPendingTimers());
    // Refused: the pill goes back to the value the caller holds.
    expect(screen.getByRole('radio', { name: 'Türkçe' })).toBeSelected();
    expect(screen.getByRole('radio', { name: 'English' })).not.toBeSelected();
  });

  it('an async caller (a promise) keeps the choice shown until its value catches up', async () => {
    let resolve: () => void = () => undefined;
    const onChange = jest.fn(
      () =>
        new Promise<void>(yes => {
          resolve = yes;
        }),
    );
    const view = renderWithProviders(
      <SegmentedControl segments={segments} value="tr" onChange={onChange} testID="seg" />,
    );
    fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    act(() => jest.runOnlyPendingTimers());
    await act(async () => undefined);
    // Still working (the UI language takes a while): the choice stays shown.
    expect(screen.getByRole('radio', { name: 'English' })).toBeSelected();

    view.rerender(<SegmentedControl segments={segments} value="en" onChange={onChange} testID="seg" />);
    await act(async () => {
      resolve();
    });
    expect(screen.getByRole('radio', { name: 'English' })).toBeSelected();
    // A change from outside is shown as it comes.
    view.rerender(<SegmentedControl segments={segments} value="de" onChange={onChange} testID="seg" />);
    expect(screen.getByRole('radio', { name: 'Deutsch' })).toBeSelected();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a caller that returns a failed promise gets its own value shown again', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let reject: (reason: unknown) => void = () => undefined;
    const onChange = jest.fn(
      () =>
        new Promise<void>((_, no) => {
          reject = no;
        }),
    );
    renderWithProviders(<SegmentedControl segments={segments} value="tr" onChange={onChange} testID="seg" />);
    fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    act(() => jest.runOnlyPendingTimers());
    expect(screen.getByRole('radio', { name: 'English' })).toBeSelected();

    await act(async () => {
      reject(new Error('400'));
    });
    expect(screen.getByRole('radio', { name: 'Türkçe' })).toBeSelected();
    expect(screen.getByRole('radio', { name: 'English' })).not.toBeSelected();
  });

  it('a second tap in the same frame hands over only the last choice', () => {
    const onChange = jest.fn();
    renderWithProviders(<SegmentedControl segments={segments} value="tr" onChange={onChange} testID="seg" />);
    fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    fireEvent.press(screen.getByRole('radio', { name: 'Deutsch' }));
    act(() => jest.runOnlyPendingTimers());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('de');
  });

  it('tapping away and back within one frame tells the caller nothing', () => {
    const onChange = jest.fn();
    renderWithProviders(<SegmentedControl segments={segments} value="tr" onChange={onChange} testID="seg" />);
    fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    fireEvent.press(screen.getByRole('radio', { name: 'Türkçe' }));
    act(() => jest.runOnlyPendingTimers());
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Türkçe' })).toBeSelected();
  });

  it('a choice made just before unmounting still reaches the caller', () => {
    const onChange = jest.fn();
    const view = renderWithProviders(
      <SegmentedControl segments={segments} value="tr" onChange={onChange} testID="seg" />,
    );
    fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    view.unmount();
    expect(onChange).toHaveBeenCalledWith('en');
    act(() => jest.runOnlyPendingTimers());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('no segment label carries a translate after pressIn; the labels dim instead', () => {
    const { timing } = instantAnimations();
    renderWithProviders(<SegmentedControl segments={segments} value="tr" onChange={jest.fn()} testID="seg" />);
    fireEvent(screen.getByRole('radio', { name: 'English' }), 'pressIn');
    for (const id of ['seg-en', 'seg-en-labels', 'seg-en-label', 'seg-en-label-alt']) {
      expect(flat(screen.getByTestId(id)).transform).toBeUndefined();
    }
    expect(resolved(flat(screen.getByTestId('seg-en-labels')).opacity)).toBe(0.6);
    expect(timing).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 0.6, duration: DURATION.pressIn, useNativeDriver: true }),
    );
  });

  it('a segment offers a 48dp target and waits for the press delay', () => {
    renderWithProviders(<SegmentedControl segments={segments} value="tr" onChange={jest.fn()} testID="seg" />);
    const segment = screen.getByTestId('seg-en');
    expect(segment.props.hitSlop).toEqual({ top: 7, bottom: 7 });
    // The face is 32 plus the pill's 2dp lip.
    expect(flat(screen.getByTestId('seg-en-labels'))).toMatchObject({ minHeight: 34, paddingBottom: 2, paddingHorizontal: 12 });
  });

  it('the well is inset: surface on the canvas, bg inside a surface container, surface inside surface2', () => {
    const view = renderWithProviders(
      <SegmentedControl segments={segments} value="tr" onChange={jest.fn()} testID="seg" />,
    );
    expect(flat(screen.getByTestId('seg'))).toMatchObject({
      backgroundColor: gece.surface,
      borderRadius: 16,
      padding: 4,
      gap: 4,
    });
    expect(flat(screen.getByTestId('seg')).paddingBottom).toBeUndefined();
    view.unmount();

    const inSurface = renderWithProviders(
      <SurfaceLevelProvider level="surface">
        <SegmentedControl segments={segments} value="tr" onChange={jest.fn()} testID="seg" />
      </SurfaceLevelProvider>,
    );
    expect(flat(screen.getByTestId('seg')).backgroundColor).toBe(gece.bg);
    inSurface.unmount();

    renderWithProviders(
      <SurfaceLevelProvider level="surface2">
        <SegmentedControl segments={segments} value="tr" onChange={jest.fn()} testID="seg" />
      </SurfaceLevelProvider>,
    );
    expect(flat(screen.getByTestId('seg')).backgroundColor).toBe(insetFace(gece, 'surface2'));
  });

  it('the real containers set the level: the canvas colour in a Card and in a BottomSheet, surface in a raised Card', () => {
    const inCard = renderWithProviders(
      <Card>
        <SegmentedControl segments={segments} value="tr" onChange={jest.fn()} testID="seg" />
      </Card>,
    );
    expect(flat(screen.getByTestId('seg')).backgroundColor).toBe(gece.bg);
    inCard.unmount();

    const inRaised = renderWithProviders(
      <Card tone="raised">
        <SegmentedControl segments={segments} value="tr" onChange={jest.fn()} testID="seg" />
      </Card>,
    );
    expect(flat(screen.getByTestId('seg')).backgroundColor).toBe(gece.surface);
    inRaised.unmount();

    renderWithProviders(
      <BottomSheet visible onClose={jest.fn()} title="Uyku zamanlayıcısı">
        <SegmentedControl segments={segments} value="tr" onChange={jest.fn()} testID="seg" />
      </BottomSheet>,
    );
    expect(flat(screen.getByTestId('seg')).backgroundColor).toBe(gece.bg);
  });

  it('compact: each segment hugs its label (padH 8) and cross-fades its own pill in DURATION.fast', () => {
    const { timing, spring } = instantAnimations();
    renderWithProviders(
      <SegmentedControl compact segments={segments} value="tr" onChange={jest.fn()} testID="seg" />,
    );
    expect(flat(screen.getByTestId('seg-tr-labels')).paddingHorizontal).toBe(8);
    expect(flat(screen.getByTestId('seg')).alignSelf).toBe('flex-start');
    // Every segment holds its pill; only the selected one shows it.
    expect(resolved(flat(screen.getByTestId('seg-tr-pill')).opacity)).toBe(1);
    expect(resolved(flat(screen.getByTestId('seg-en-pill')).opacity)).toBe(0);

    timing.mockClear();
    fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    const fades = timing.mock.calls.filter(([, config]) => (config as { duration: number }).duration === DURATION.fast);
    expect(fades).toHaveLength(2);
    fades.forEach(([, config]) => expect(config).toMatchObject({ useNativeDriver: true }));
    expect(spring).not.toHaveBeenCalled();
    expect(resolved(flat(screen.getByTestId('seg-en-pill')).opacity)).toBe(1);
    expect(resolved(flat(screen.getByTestId('seg-tr-pill')).opacity)).toBe(0);
  });

  it('under reduced motion the pill jumps: no spring', async () => {
    await withReducedMotion();
    const { spring } = instantAnimations();
    renderWithProviders(<SegmentedControl segments={segments} value="tr" onChange={jest.fn()} testID="seg" />);
    await settle();
    layoutWell(320);
    fireEvent.press(screen.getByRole('radio', { name: 'Deutsch' }));
    expect(spring).not.toHaveBeenCalled();
    const segW = (320 - 8 - 8) / 3;
    expect(translateXOf(screen.getByTestId('seg-pill'))).toBeCloseTo(2 * (segW + 4), 5);
  });

  it('a value that is none of the segments selects nothing and draws no pill', () => {
    renderWithProviders(
      <SegmentedControl segments={segments} value={'fr' as Lang} onChange={jest.fn()} testID="seg" />,
    );
    layoutWell(320);
    expect(screen.queryByTestId('seg-pill')).toBeNull();
    segments.forEach(s => expect(screen.getByRole('radio', { name: s.label })).not.toBeSelected());
    expect(flat(screen.getByTestId('seg-en-label')).color).toBe(gece.text2);
  });
});

describe('Switch', () => {
  it('re-rendered with value true runs a timing to 1 in DURATION.base on the native driver', () => {
    const timing = jest.spyOn(Animated, 'timing');
    const view = renderWithProviders(<Switch value={false} onValueChange={jest.fn()} testID="s" />);
    expect(timing).not.toHaveBeenCalled();
    view.rerender(<Switch value onValueChange={jest.fn()} testID="s" />);
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 1, duration: DURATION.base, easing: EASE.standard, useNativeDriver: true }),
    );
    view.rerender(<Switch value={false} onValueChange={jest.fn()} testID="s" />);
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 0, duration: DURATION.base }),
    );
  });

  it('the knob sits 4dp in and slides 22; the on layers are action and onAction over line and text3', () => {
    instantAnimations();
    const view = renderWithProviders(<Switch value={false} onValueChange={jest.fn()} testID="s" />);
    expect(flat(screen.getByTestId('s-thumb'))).toMatchObject({ width: 22, height: 22, marginLeft: 4 });
    expect(translateXOf(screen.getByTestId('s-thumb'))).toBe(0);
    expect(flat(screen.getByTestId('s-thumb-off')).backgroundColor).toBe(gece.text3);
    expect(flat(screen.getByTestId('s-thumb-on')).backgroundColor).toBe(gece.onAction);
    expect(resolved(flat(screen.getByTestId('s-thumb-on')).opacity)).toBe(0);
    expect(flat(screen.getByTestId('s-track-on'))).toMatchObject({
      backgroundColor: gece.action,
      borderBottomColor: gece.actionLip,
      borderBottomWidth: 2,
    });
    expect(resolved(flat(screen.getByTestId('s-track-on')).opacity)).toBe(0);

    view.rerender(<Switch value onValueChange={jest.fn()} testID="s" />);
    expect(translateXOf(screen.getByTestId('s-thumb'))).toBe(22);
    expect(resolved(flat(screen.getByTestId('s-thumb-on')).opacity)).toBe(1);
    expect(resolved(flat(screen.getByTestId('s-track-on')).opacity)).toBe(1);
    // The knob keeps its margin: only the transform moves it.
    expect(flat(screen.getByTestId('s-thumb')).marginLeft).toBe(4);
  });

  it('under reduced motion the knob lands on 22 with no timing', async () => {
    await withReducedMotion();
    const timing = jest.spyOn(Animated, 'timing');
    const view = renderWithProviders(<Switch value={false} onValueChange={jest.fn()} testID="s" />);
    await settle();
    view.rerender(<Switch value onValueChange={jest.fn()} testID="s" />);
    expect(timing).not.toHaveBeenCalled();
    expect(translateXOf(screen.getByTestId('s-thumb'))).toBe(22);
  });

  it('toggles, and a disabled one ignores presses and dims as one group', () => {
    const onValueChange = jest.fn();
    const view = renderWithProviders(<Switch value onValueChange={onValueChange} testID="s" accessibilityLabel="Uyku" />);
    fireEvent.press(screen.getByRole('switch', { name: 'Uyku' }));
    expect(onValueChange).toHaveBeenCalledWith(false);
    view.rerender(<Switch value onValueChange={onValueChange} testID="s" accessibilityLabel="Uyku" disabled />);
    fireEvent.press(screen.getByRole('switch', { name: 'Uyku' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('s').props.needsOffscreenAlphaCompositing).toBe(true);
    expect(flat(screen.getByTestId('s')).opacity).toBe(0.5);
  });
});

describe('SwitchRow', () => {
  it('never translates on pressIn; the label block dims', () => {
    const { timing } = instantAnimations();
    renderWithProviders(<SwitchRow label="Sesi kıs" value={false} onValueChange={jest.fn()} testID="row" />);
    fireEvent(screen.getByTestId('row'), 'pressIn');
    expect(flat(screen.getByTestId('row-text')).transform).toBeUndefined();
    expect(flat(screen.getByTestId('row')).transform).toBeUndefined();
    expect(resolved(flat(screen.getByTestId('row-text')).opacity)).toBe(0.6);
    expect(timing).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ toValue: 0.6 }));
    fireEvent(screen.getByTestId('row'), 'pressOut');
    expect(resolved(flat(screen.getByTestId('row-text')).opacity)).toBe(1);
  });

  it('is a 56dp plain row (gap 12, padH 16) whose knob animates with the value', () => {
    instantAnimations();
    const view = renderWithProviders(
      <SwitchRow label="Sesi kıs" value={false} onValueChange={jest.fn()} testID="row" />,
    );
    expect(flat(screen.getByTestId('row'))).toMatchObject({ minHeight: 56, gap: 12, paddingHorizontal: 16 });
    view.rerender(<SwitchRow label="Sesi kıs" value onValueChange={jest.fn()} testID="row" />);
    expect(translateXOf(screen.getByTestId('row-thumb'))).toBe(22);
  });

  it('a disabled row neither toggles nor dims on press', () => {
    const timing = jest.spyOn(Animated, 'timing');
    const onValueChange = jest.fn();
    renderWithProviders(<SwitchRow label="Kapalı" value={false} disabled onValueChange={onValueChange} testID="row" />);
    fireEvent(screen.getByTestId('row'), 'pressIn');
    fireEvent.press(screen.getByTestId('row'));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(timing).not.toHaveBeenCalled();
    expect(screen.getByTestId('row').props.needsOffscreenAlphaCompositing).toBe(true);
  });
});

describe('Checkbox', () => {
  it('idle: a 2dp text3 ring on no face; checked: the action face and ring on an actionLip edge, same box', () => {
    const view = renderWithProviders(<Checkbox checked={false} onToggle={jest.fn()} testID="cb" />);
    const idle = flat(screen.getByTestId('cb-box'));
    expect(idle).toMatchObject({
      width: 24,
      height: 24,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: gece.text3,
      backgroundColor: 'transparent',
    });
    expect(idle.borderBottomColor).toBeUndefined();

    view.rerender(<Checkbox checked onToggle={jest.fn()} testID="cb" />);
    const on = flat(screen.getByTestId('cb-box'));
    expect(on).toMatchObject({
      backgroundColor: gece.action,
      borderColor: gece.action,
      borderBottomColor: gece.actionLip,
      borderWidth: 2,
    });
    expect([on.width, on.height, on.borderRadius]).toEqual([idle.width, idle.height, idle.borderRadius]);
    expect(screen.getByTestId('icon-check')).toBeTruthy();
  });

  it('dims while pressed and never moves; the target is 48dp', () => {
    instantAnimations();
    renderWithProviders(<Checkbox checked={false} onToggle={jest.fn()} testID="cb" />);
    expect(flat(screen.getByTestId('cb'))).toMatchObject({ width: 48, height: 48 });
    // It sits in scrolling forms: the tint waits for the press delay.
    expect(screen.UNSAFE_getByProps({ testID: 'cb', unstable_pressDelay: PRESS_DELAY_MS })).toBeTruthy();
    fireEvent(screen.getByTestId('cb'), 'pressIn');
    expect(resolved(flat(screen.getByTestId('cb-box')).opacity)).toBe(0.6);
    expect(flat(screen.getByTestId('cb-box')).transform).toBeUndefined();
  });
});

describe('Chip', () => {
  it('is a 34dp face with padH 12 on a 2dp lip, radius 12', () => {
    renderWithProviders(<Chip label="Türkçe" onPress={jest.fn()} testID="c" />);
    expect(flat(screen.getByTestId('c-face'))).toMatchObject({ minHeight: 34, paddingHorizontal: 12, borderRadius: 12 });
    expect(flat(screen.getByTestId('c-lip'))).toMatchObject({ top: 2, borderRadius: 12 });
  });

  it('onLongPress fires, and a long press is not a press', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    renderWithProviders(<Chip label="Uyku listesi" onPress={onPress} onLongPress={onLongPress} testID="c" />);
    fireEvent(screen.getByTestId('c'), 'longPress');
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("role 'button' is a plain action: no selected or checked state is announced", () => {
    renderWithProviders(<Chip label="Bu masal (12 dk)" role="button" selected onPress={jest.fn()} testID="c" />);
    const chip = screen.getByRole('button', { name: 'Bu masal (12 dk)' });
    expect(chip.props.accessibilityState?.selected).toBeUndefined();
    expect(chip.props.accessibilityState?.checked).toBeUndefined();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('draws a trailing node after the label', () => {
    renderWithProviders(<Chip label="Uyku" trailing={<Text testID="count">3</Text>} onPress={jest.fn()} testID="c" />);
    const face = screen.getByTestId('c-face') as any;
    const texts = face.findAll((n: any) => n.type === 'Text' && typeof n.props.children !== 'undefined');
    const order = texts.map((n: any) => n.props.children);
    expect(order.indexOf('Uyku')).toBeLessThan(order.indexOf('3'));
  });
});

describe('Tag', () => {
  it('md: minHeight 28, padH 12, gap 4; sm: minHeight 24, padH 8; never a fixed height', () => {
    const view = renderWithProviders(<Tag label="Hazır" testID="tag" />);
    const md = flat(screen.getByTestId('tag'));
    expect(md).toMatchObject({ minHeight: 28, paddingHorizontal: 12, gap: 4, borderRadius: 14 });
    expect(md.height).toBeUndefined();
    view.rerender(<Tag label="Hazır" size="sm" testID="tag" />);
    const sm = flat(screen.getByTestId('tag'));
    expect(sm).toMatchObject({ minHeight: 24, paddingHorizontal: 8, borderRadius: 12 });
    expect(sm.height).toBeUndefined();
  });

  it('the label follows the system font up to 1.3 by default, or as far as asked', () => {
    const view = renderWithProviders(<Tag label="Hazır" testID="tag" />);
    expect(screen.getByText('Hazır').props.maxFontSizeMultiplier).toBe(1.3);
    view.rerender(<Tag label="Hazır" maxFontSizeMultiplier={1.15} testID="tag" />);
    expect(screen.getByText('Hazır').props.maxFontSizeMultiplier).toBe(1.15);
  });
});
