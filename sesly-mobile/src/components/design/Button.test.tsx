/**
 * Button: the size table (SPEC-design 1.4), the state colours on every
 * surface level (1.6.1), loading that keeps the face, the faceless text
 * button that dims instead of sinking, and the new props.
 */

import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { configure, fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { PALETTE_KEYS } from '../../theme/palettes';
import { themes } from '../../theme/theme';
import { DURATION, PRESS_TINT } from '../../theme/motion';
import { mix } from '../../theme/color';
import { SURFACE_LEVELS, disabledFace, ghostFace, raisedFace } from '../../theme/surfaces';
import { BUTTON_METRICS, Button, ButtonSize, buttonColors, buttonHitSlop } from './Button';
import { buttonColors as pureButtonColors } from './buttonColors';
import { SurfaceLevelProvider } from './SurfaceLevel';

// Icons and the spinner are decorative and hidden from accessibility; these tests look at them.
configure({ defaultIncludeHiddenElements: true });

const gece = themes['gece-mavisi'];
const flat = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(5).filter(Boolean));

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

describe('Button sizes', () => {
  it.each([
    ['sm', 36, 12, 2, 12, 14, { top: 5, bottom: 5 }],
    ['md', 44, 16, 2, 16, 15, { top: 1, bottom: 1 }],
    ['lg', 52, 20, 3, 20, 16, undefined],
  ] as const)('%s: face %ddp, radius %d, lip %d, padH %d, font %d', (size, height, radius, lip, padH, font, slop) => {
    renderWithProviders(<Button label="Dinle" size={size} testID="b" />);
    expect(flat(screen.getByTestId('b-face'))).toMatchObject({
      minHeight: height,
      borderRadius: radius,
      paddingHorizontal: padH,
      paddingVertical: 8,
    });
    expect(flat(screen.getByTestId('b-lip')).top).toBe(lip);
    expect(flat(screen.getByTestId('b'))).toMatchObject({ paddingBottom: lip });
    expect(screen.getByTestId('b').props.hitSlop).toEqual(slop);
    expect(flat(screen.getByText('Dinle'))).toMatchObject({
      fontSize: font,
      lineHeight: BUTTON_METRICS[size].lineHeight,
    });
    // The face with its lip reaches the 48dp target (lg is 55 already).
    expect(height + lip + 2 * (slop?.top ?? 0)).toBeGreaterThanOrEqual(48);
  });

  it('the metrics table is the one of the spec and every line height clears 1.3 times the font', () => {
    expect(BUTTON_METRICS).toEqual({
      sm: { height: 36, lip: 2, radius: 12, padH: 12, font: 14, lineHeight: 19, icon: 16, gap: 6 },
      md: { height: 44, lip: 2, radius: 16, padH: 16, font: 15, lineHeight: 21, icon: 20, gap: 8 },
      lg: { height: 52, lip: 3, radius: 20, padH: 20, font: 16, lineHeight: 22, icon: 20, gap: 8 },
    });
    for (const size of Object.keys(BUTTON_METRICS) as ButtonSize[]) {
      const m = BUTTON_METRICS[size];
      expect(m.lineHeight).toBeGreaterThanOrEqual(m.font * 1.3);
      // The label line fits the face between the vertical paddings.
      expect(m.height - 2 * 8).toBeGreaterThanOrEqual(m.lineHeight);
    }
  });

  it('buttonHitSlop reaches any touch target and gives none once the face is tall enough', () => {
    expect(buttonHitSlop('sm')).toEqual({ top: 5, bottom: 5 });
    expect(buttonHitSlop('md')).toEqual({ top: 1, bottom: 1 });
    expect(buttonHitSlop('lg')).toBeUndefined();
    expect(buttonHitSlop('lg', 57)).toEqual({ top: 1, bottom: 1 });
    expect(buttonHitSlop('md', 40)).toBeUndefined();
  });

  it('the icon follows the size: 16 on sm, 20 on md and lg, with the size gap', () => {
    const view = renderWithProviders(<Button label="Dinle" icon="play" size="sm" testID="b" />);
    expect(flat(screen.getByTestId('icon-play')).width).toBe(16);
    expect(flat(screen.getByTestId('b-face')).gap).toBe(6);
    view.rerender(<Button label="Dinle" icon="play" size="lg" testID="b" />);
    expect(flat(screen.getByTestId('icon-play')).width).toBe(20);
    expect(flat(screen.getByTestId('b-face')).gap).toBe(8);
  });

  it('only block stretches; any other button keeps its content width', () => {
    const view = renderWithProviders(<Button label="Dinle" size="lg" testID="b" />);
    expect(flat(screen.getByTestId('b')).alignSelf).toBe('flex-start');
    view.rerender(<Button label="Dinle" size="sm" block testID="b" />);
    expect(flat(screen.getByTestId('b')).alignSelf).toBe('stretch');
    // In a row the caller centres a block button instead of stretching it.
    view.rerender(<Button label="Dinle" size="lg" block style={{ flex: 1, alignSelf: 'center' }} testID="b" />);
    expect(flat(screen.getByTestId('b'))).toMatchObject({ flex: 1, alignSelf: 'center' });
  });
});

describe('Button label', () => {
  it('wraps to two lines by default and shrinks to one with singleLine in a shared row', () => {
    const view = renderWithProviders(<Button label="Masalı dinlemeye başla" />);
    expect(screen.getByText('Masalı dinlemeye başla').props).toMatchObject({ numberOfLines: 2 });
    expect(screen.getByText('Masalı dinlemeye başla').props.adjustsFontSizeToFit).toBeUndefined();
    // The story detail dock CTA: inline (not block), next to the sample button.
    view.rerender(
      <Button label="Masalı dinlemeye başla" size="lg" singleLine style={{ flex: 1, alignSelf: 'center' }} />,
    );
    expect(screen.getByText('Masalı dinlemeye başla').props).toMatchObject({
      numberOfLines: 1,
      ellipsizeMode: 'tail',
      adjustsFontSizeToFit: true,
      minimumFontScale: 0.85,
    });
    expect(flat(screen.getByText('Masalı dinlemeye başla')).flexShrink).toBe(1);
  });

  it.each([
    ['secondary', 'md'],
    ['primary', 'lg'],
    ['ghost', 'sm'],
    ['text', 'md'],
  ] as const)(
    'a single-line %s %s block label keeps its size and full width: no auto-fit, never squeezed (NL-03)',
    (variant, size) => {
      const label = 'Arka planda devam et';
      renderWithProviders(
        <Button label={label} variant={variant} size={size} block singleLine icon="clock" testID="b" />,
      );
      const text = screen.getByText(label);
      // Android's auto-fit path turns the ellipsis off and wraps the last word
      // onto a clipped second line, so a block label (whose face has room) never
      // takes it; one line with a tail ellipsis is the only fallback.
      expect(text.props).toMatchObject({ numberOfLines: 1, ellipsizeMode: 'tail', textBreakStrategy: 'simple' });
      expect(text.props.adjustsFontSizeToFit).toBeUndefined();
      expect(text.props.minimumFontScale).toBeUndefined();
      // Its intrinsic width at the size's own font, never shrunk in the row.
      expect(flat(text)).toMatchObject({
        flexShrink: 0,
        textAlign: 'center',
        fontSize: BUTTON_METRICS[size].font,
        lineHeight: BUTTON_METRICS[size].lineHeight,
      });
      // The icon and the label stay centred as one group on the stretched face.
      expect(flat(screen.getByTestId('b'))).toMatchObject({ alignSelf: 'stretch' });
      expect(flat(screen.getByTestId('b-face'))).toMatchObject({
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: BUTTON_METRICS[size].gap,
      });
      expect(screen.getByTestId('icon-clock')).toBeOnTheScreen();
      // The whole label is the accessible name.
      expect(screen.getByRole('button', { name: label })).toBeOnTheScreen();
    },
  );

  it('a block label that may wrap still shrinks in its row (two-line dialog buttons)', () => {
    renderWithProviders(<Button label="Continue in the background" block icon="clock" />);
    const text = screen.getByText('Continue in the background');
    expect(text.props).toMatchObject({ numberOfLines: 2, ellipsizeMode: 'tail' });
    expect(text.props.adjustsFontSizeToFit).toBeUndefined();
    expect(flat(text).flexShrink).toBe(1);
  });

  it.each([
    ['primary', 'lg', false],
    ['secondary', 'md', true],
    ['ghost', 'sm', false],
    ['text', 'md', true],
  ] as const)(
    'a %s %s label (block %s) breaks greedily, so a label measured as one line keeps its last word',
    (variant, size, block) => {
      const label = 'Arka planda devam et';
      const view = renderWithProviders(
        <Button label={label} variant={variant} size={size} block={block} icon="clock" testID="b" />,
      );
      expect(screen.getByText(label).props.textBreakStrategy).toBe('simple');
      expect(screen.getByText(label).props.numberOfLines).toBe(2);
      // The label still shrinks inside the row next to its icon, centred.
      expect(flat(screen.getByText(label))).toMatchObject({ flexShrink: 1, textAlign: 'center' });
      view.rerender(
        <Button label={label} variant={variant} size={size} block={block} icon="clock" singleLine testID="b" />,
      );
      expect(screen.getByText(label).props).toMatchObject({
        numberOfLines: 1,
        textBreakStrategy: 'simple',
      });
      // Auto-fit only in a shared row; a block single line keeps its width.
      expect(screen.getByText(label).props.adjustsFontSizeToFit).toBe(block ? undefined : true);
      expect(flat(screen.getByText(label)).flexShrink).toBe(block ? 0 : 1);
    },
  );

  it('loading keeps the greedy label laid out under the spinner', () => {
    renderWithProviders(<Button label="Sesimi oluştur" loading testID="b" />);
    expect(screen.getByText('Sesimi oluştur').props.textBreakStrategy).toBe('simple');
    expect(flat(screen.getByText('Sesimi oluştur')).opacity).toBe(0);
  });
});

describe('Button loading', () => {
  it('keeps the face size: the label stays at opacity 0 under an absolutely centred spinner', () => {
    const onPress = jest.fn();
    const view = renderWithProviders(<Button label="Sesimi oluştur" size="md" onPress={onPress} testID="b" />);
    const restingFace = flat(screen.getByTestId('b-face'));
    expect(screen.queryByTestId('b-spinner')).toBeNull();

    view.rerender(<Button label="Sesimi oluştur" size="md" onPress={onPress} loading testID="b" />);
    expect(flat(screen.getByTestId('b-face'))).toMatchObject({
      minHeight: restingFace.minHeight,
      paddingHorizontal: restingFace.paddingHorizontal,
    });
    // The label still holds the width and stays the accessible name.
    expect(flat(screen.getByText('Sesimi oluştur')).opacity).toBe(0);
    expect(screen.getByRole('button', { name: 'Sesimi oluştur' }).props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
    const overlay = flat(screen.getByTestId('b-spinner'));
    expect(overlay).toMatchObject({ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' });
    // The spinner is drawn in the label colour, not dimmed: loading is not disabled.
    expect(screen.getByTestId('spinner-indicator').props.color).toBe(gece.onAction);
    expect(flat(screen.getByTestId('b-face')).backgroundColor).toBe(gece.action);
    fireEvent.press(screen.getByTestId('b'));
    expect(onPress).not.toHaveBeenCalled();

    view.rerender(<Button label="Sesimi oluştur" size="md" onPress={onPress} testID="b" />);
    expect(flat(screen.getByText('Sesimi oluştur')).opacity).toBeUndefined();
    expect(screen.queryByTestId('b-spinner')).toBeNull();
    fireEvent.press(screen.getByTestId('b'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a button with an icon shows the spinner in the icon slot and keeps its label visible', () => {
    renderWithProviders(<Button label="Sil" icon="trash" loading testID="b" />);
    expect(screen.queryByTestId('icon-trash')).toBeNull();
    expect(flat(screen.getByTestId('b-spinner'))).toMatchObject({ width: 20, height: 20 });
    expect(flat(screen.getByTestId('b-spinner')).position).toBeUndefined();
    expect(flat(screen.getByText('Sil')).opacity).toBeUndefined();
  });
});

describe('Button disabled', () => {
  it('draws the disabled face with a text3 label at full opacity and never sinks', () => {
    const timing = spyTiming();
    const onPress = jest.fn();
    renderWithProviders(<Button label="Devam et" disabled onPress={onPress} testID="b" />);
    expect(flat(screen.getByTestId('b-face')).backgroundColor).toBe(disabledFace(gece, 'bg'));
    expect(flat(screen.getByTestId('b-face')).backgroundColor).not.toBe(gece.action);
    expect(flat(screen.getByText('Devam et')).color).toBe(gece.text3);
    expect(flat(screen.getByTestId('b')).opacity).toBe(1);
    expect(screen.getByTestId('b').props.needsOffscreenAlphaCompositing).toBe(false);
    expect(screen.getByRole('button', { name: 'Devam et' }).props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent(screen.getByTestId('b'), 'pressIn');
    fireEvent.press(screen.getByTestId('b'));
    expect(timing.mock.calls.filter(([, c]) => (c as { toValue: number }).toValue === 1)).toHaveLength(0);
    expect(flat(screen.getByTestId('b-face')).transform).toEqual([{ translateY: 0 }]);
    expect(onPress).not.toHaveBeenCalled();
  });

  it.each(SURFACE_LEVELS)('on a %s container the disabled face is disabledFace of that level', level => {
    renderWithProviders(
      <SurfaceLevelProvider level={level}>
        <Button label="Devam et" variant="primary" tone="danger" disabled testID="b" />
      </SurfaceLevelProvider>,
    );
    expect(flat(screen.getByTestId('b-face')).backgroundColor).toBe(disabledFace(gece, level));
    expect(flat(screen.getByTestId('b-face')).backgroundColor).not.toBe(gece[level]);
    expect(flat(screen.getByTestId('b-lip')).backgroundColor).toBe(gece.lip);
  });
});

describe('Button colours on every level (test-16)', () => {
  it.each(PALETTE_KEYS)('a secondary face in %s is one step above its container, never the container colour', key => {
    const T = themes[key];
    for (const level of SURFACE_LEVELS) {
      const view = renderWithProviders(
        <SurfaceLevelProvider level={level}>
          <Button label="Vazgeç" variant="secondary" testID="b" />
        </SurfaceLevelProvider>,
        { theme: key },
      );
      const face = flat(screen.getByTestId('b-face')).backgroundColor;
      expect(face).toBe(raisedFace(T, level));
      expect(face).not.toBe(T[level]);
      expect(flat(screen.getByText('Vazgeç')).color).toBe(T.text);
      view.unmount();
    }
  });

  it('outside every provider a secondary button is on the canvas (surface face)', () => {
    renderWithProviders(<Button label="Vazgeç" variant="secondary" testID="b" />);
    expect(flat(screen.getByTestId('b-face')).backgroundColor).toBe(gece.surface);
  });

  it('a ghost face is an opaque hex over the card it sits on', () => {
    const view = renderWithProviders(<Button label="Yeni ses kaydet" variant="ghost" parentColor={gece.ownB} testID="b" />);
    const face = flat(screen.getByTestId('b-face')).backgroundColor;
    expect(face).toMatch(/^#[0-9A-F]{6}$/);
    expect(face).toBe(ghostFace(gece, gece.ownB));
    // Without a card colour it mixes over the container of its level.
    view.rerender(
      <SurfaceLevelProvider level="surface">
        <Button label="Yeni ses kaydet" variant="ghost" testID="b" />
      </SurfaceLevelProvider>,
    );
    expect(flat(screen.getByTestId('b-face')).backgroundColor).toBe(ghostFace(gece, gece.surface));
  });

  it('a danger primary is the error colour on a darker error lip', () => {
    renderWithProviders(<Button label="Sil" tone="danger" testID="b" />, { theme: 'erik' });
    const T = themes.erik;
    expect(flat(screen.getByTestId('b-face')).backgroundColor).toBe(T.error);
    expect(flat(screen.getByTestId('b-lip')).backgroundColor).toBe(mix(T.error, 0.62, T.lip));
    expect(flat(screen.getByText('Sil')).color).toBe(T.onAction);
  });

  it('re-exports the pure colour mapping', () => {
    expect(buttonColors).toBe(pureButtonColors);
  });
});

describe('Button text variant', () => {
  it('never moves: pressIn starts a native timing to 0.6 on its opacity, pressOut back to 1', () => {
    const timing = spyTiming();
    const onPress = jest.fn();
    renderWithProviders(<Button label="Hazır anlatıcıyla başla" variant="text" onPress={onPress} testID="b" />);
    fireEvent(screen.getByTestId('b'), 'pressIn');
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: PRESS_TINT, duration: DURATION.pressIn, useNativeDriver: true }),
    );
    expect(PRESS_TINT).toBe(0.6);
    const face = flat(screen.getByTestId('b-face'));
    expect(face.opacity).toBe(0.6);
    expect(face.transform).toBeUndefined();
    fireEvent(screen.getByTestId('b'), 'pressOut');
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 1, duration: DURATION.pressOut, useNativeDriver: true }),
    );
    expect(flat(screen.getByTestId('b-face')).opacity).toBe(1);
    fireEvent.press(screen.getByTestId('b'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('b-lip')).toBeNull();
  });

  it('is a 48dp target with no fill; disabled greys the label and starts nothing', () => {
    const timing = spyTiming();
    const view = renderWithProviders(<Button label="Düzenle" variant="text" size="sm" testID="b" />);
    expect(flat(screen.getByTestId('b-face'))).toMatchObject({ minHeight: 48, paddingHorizontal: 12 });
    expect(flat(screen.getByText('Düzenle')).color).toBe(gece.text);
    view.rerender(<Button label="Düzenle" variant="text" disabled onPress={jest.fn()} testID="b" />);
    expect(flat(screen.getByText('Düzenle')).color).toBe(gece.text3);
    expect(flat(screen.getByTestId('b')).opacity).toBeUndefined();
    fireEvent(screen.getByTestId('b'), 'pressIn');
    expect(timing).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Düzenle' })).toBeDisabled();
  });

  it('a danger text button reads in the error colour', () => {
    renderWithProviders(<Button label="Hesabı sil" variant="text" tone="danger" />);
    expect(flat(screen.getByText('Hesabı sil')).color).toBe(gece.error);
  });
});

describe('Button press delay', () => {
  it('waits 100 ms by default and passes pressDelay through, on both kinds', () => {
    const view = renderWithProviders(<Button label="Dinle" testID="b" />);
    expect(view.UNSAFE_getByProps({ testID: 'b', unstable_pressDelay: 100 })).toBeTruthy();
    view.rerender(<Button label="Dinle" pressDelay={0} testID="b" />);
    expect(view.UNSAFE_getByProps({ testID: 'b', unstable_pressDelay: 0 })).toBeTruthy();
    view.rerender(<Button label="Dinle" variant="text" testID="b" />);
    expect(view.UNSAFE_getByProps({ testID: 'b', unstable_pressDelay: 100 })).toBeTruthy();
    view.rerender(<Button label="Dinle" variant="text" pressDelay={0} testID="b" />);
    expect(view.UNSAFE_getByProps({ testID: 'b', unstable_pressDelay: 0 })).toBeTruthy();
  });
});
