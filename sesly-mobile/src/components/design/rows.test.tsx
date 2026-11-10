/**
 * rows.tsx: icon buttons by variant (faces, lips, rings, slop, the count),
 * faceless targets that dim instead of moving (SPEC-design 1.3), list rows,
 * the text field frame and its rings (1.6.1), the tab title and the avatar.
 */

import React, { createRef } from 'react';
import { Animated, NativeScrollEvent, NativeSyntheticEvent, TextInput } from 'react-native';
import { act, configure, fireEvent, renderHook, screen, within } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { PALETTE_KEYS } from '../../theme/palettes';
import { LIP, RADIUS, themes } from '../../theme/theme';
import { DURATION, PRESS_TINT } from '../../theme/motion';
import { lightness, withAlpha } from '../../theme/color';
import { glassRing, insetFace, raisedFace } from '../../theme/surfaces';
import {
  APP_BAR_EDGE_FADE,
  Avatar,
  FieldFrame,
  ICON_BADGE_SIZE,
  IconButton,
  ListRow,
  SCROLL_EDGE_OFFSET,
  StateIcon,
  StateView,
  TextField,
  TopAppBar,
  fieldRingColor,
  useScrollEdge,
} from './rows';
import { SurfaceLevelProvider } from './SurfaceLevel';

// Icons are decorative and hidden from accessibility; these tests look at them.
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

/** Every transform in the subtree (a faceless target must have none that moves). */
type Node = ReturnType<typeof screen.getByTestId>;
function translates(node: Node): unknown[] {
  const own: Record<string, unknown>[] = flat(node).transform ?? [];
  const children = (node.children ?? []).filter((c: Node | string): c is Node => typeof c !== 'string');
  return [...own.filter(t => t.translateY !== undefined && t.translateY !== 0), ...children.flatMap(translates)];
}

describe('IconButton tactile and glass', () => {
  it('tactile: a 44dp face one step above the canvas, radius 16, on a 2dp lip, slop to 48', () => {
    renderWithProviders(<IconButton variant="tactile" icon="search" onPress={jest.fn()} accessibilityLabel="Ara" testID="ib" />);
    expect(flat(screen.getByTestId('ib-face'))).toMatchObject({
      width: 44,
      height: 44,
      borderRadius: RADIUS.md,
      backgroundColor: raisedFace(gece, 'bg'),
    });
    expect(flat(screen.getByTestId('ib-lip'))).toMatchObject({ top: LIP.sm, backgroundColor: gece.lip });
    expect(screen.getByTestId('ib').props.hitSlop).toEqual({ top: 1, bottom: 1, left: 2, right: 2 });
  });

  it('tactile inside a surface container takes surface2, and sinks by its 2dp lip', () => {
    spyTiming();
    renderWithProviders(
      <SurfaceLevelProvider level="surface">
        <IconButton variant="tactile" icon="search" onPress={jest.fn()} accessibilityLabel="Ara" testID="ib" />
      </SurfaceLevelProvider>,
    );
    expect(flat(screen.getByTestId('ib-face')).backgroundColor).toBe(gece.surface2);
    fireEvent(screen.getByTestId('ib'), 'pressIn');
    expect(flat(screen.getByTestId('ib-face')).transform).toEqual([{ translateY: LIP.sm }]);
  });

  it.each(PALETTE_KEYS)('glass in %s: surface face with a 1dp opaque ring that stands off the canvas', key => {
    const T = themes[key];
    renderWithProviders(<IconButton variant="glass" icon="more" accessibilityLabel="Daha fazla" testID="g" />, {
      theme: key,
    });
    const face = flat(screen.getByTestId('g-face'));
    expect(face).toMatchObject({ backgroundColor: T.surface, borderWidth: 1, borderColor: glassRing(T) });
    expect(face.borderColor).toMatch(/^#[0-9A-F]{6}$/);
    expect(lightness(face.backgroundColor) - lightness(T.bg)).toBeGreaterThanOrEqual(6);
    expect(flat(screen.getByTestId('g-lip')).top).toBe(LIP.sm);
  });

  it('a smaller box keeps the 48dp target and the small radius; hitSlop and pressDelay pass through', () => {
    const view = renderWithProviders(
      <IconButton variant="tactile" box={32} icon="close" onPress={jest.fn()} accessibilityLabel="Kapat" testID="ib" />,
    );
    expect(screen.getByTestId('ib').props.hitSlop).toEqual({ top: 7, bottom: 7, left: 8, right: 8 });
    expect(flat(screen.getByTestId('ib-face')).borderRadius).toBe(RADIUS.sm);
    view.rerender(
      <IconButton variant="tactile" icon="close" hitSlop={4} pressDelay={0} onPress={jest.fn()} accessibilityLabel="Kapat" testID="ib" />,
    );
    expect(screen.getByTestId('ib').props.hitSlop).toBe(4);
    expect(view.UNSAFE_getByProps({ testID: 'ib', unstable_pressDelay: 0 })).toBeTruthy();
  });

  it('disabled: no press and no sink', () => {
    const timing = spyTiming();
    const onPress = jest.fn();
    renderWithProviders(<IconButton variant="tactile" icon="close" disabled onPress={onPress} accessibilityLabel="Kapat" testID="ib" />);
    fireEvent(screen.getByTestId('ib'), 'pressIn');
    fireEvent.press(screen.getByTestId('ib'));
    expect(onPress).not.toHaveBeenCalled();
    expect(timing).not.toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ toValue: 1 }));
  });
});

describe('IconButton badge', () => {
  it('is a 28dp surface circle with the glass ring, no lip, a 16dp glyph and a 10dp slop', () => {
    renderWithProviders(<IconButton variant="badge" icon="bookmark" onPress={jest.fn()} accessibilityLabel="Kaydet" testID="bm" />);
    expect(ICON_BADGE_SIZE).toBe(28);
    expect(flat(screen.getByTestId('bm'))).toMatchObject({ width: 28, height: 28 });
    expect(flat(screen.getByTestId('bm-face'))).toMatchObject({
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: gece.surface,
      borderWidth: 1,
      borderColor: glassRing(gece),
    });
    expect(screen.queryByTestId('bm-lip')).toBeNull();
    expect(flat(screen.getByTestId('icon-bookmark')).width).toBe(16);
    expect(screen.getByTestId('bm').props.hitSlop).toBe(10);
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeTruthy();
  });

  it('dims while pressed and never moves', () => {
    const timing = spyTiming();
    renderWithProviders(<IconButton variant="badge" icon="bookmark" onPress={jest.fn()} accessibilityLabel="Kaydet" testID="bm" />);
    fireEvent(screen.getByTestId('bm'), 'pressIn');
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: PRESS_TINT, duration: DURATION.pressIn, useNativeDriver: true }),
    );
    expect(flat(screen.getByTestId('bm-face')).opacity).toBe(PRESS_TINT);
    expect(translates(screen.getByTestId('bm'))).toEqual([]);
    fireEvent(screen.getByTestId('bm'), 'pressOut');
    expect(flat(screen.getByTestId('bm-face')).opacity).toBe(1);
  });
});

describe('IconButton plain', () => {
  it('a 48dp target that dims while pressed, never translates, and takes a hitSlop', () => {
    const timing = spyTiming();
    const onPress = jest.fn();
    renderWithProviders(
      <IconButton icon="prev" onPress={onPress} hitSlop={{ left: 4, right: 4 }} accessibilityLabel="Önceki" testID="p" />,
    );
    expect(flat(screen.getByTestId('p'))).toMatchObject({ width: 48, height: 48 });
    expect(screen.getByTestId('p').props.hitSlop).toEqual({ left: 4, right: 4 });
    fireEvent(screen.getByTestId('p'), 'pressIn');
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: PRESS_TINT, useNativeDriver: true }),
    );
    expect(flat(screen.getByTestId('p-glyph')).opacity).toBe(PRESS_TINT);
    expect(translates(screen.getByTestId('p'))).toEqual([]);
    fireEvent(screen.getByTestId('p'), 'pressOut');
    fireEvent.press(screen.getByTestId('p'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(flat(screen.getByTestId('p-glyph')).opacity).toBe(1);
  });

  it('disabled: dimmed glyph, no tint, no press', () => {
    const timing = spyTiming();
    const onPress = jest.fn();
    renderWithProviders(<IconButton icon="next" disabled onPress={onPress} accessibilityLabel="Sonraki" testID="p" />);
    expect(flat(screen.getByTestId('p')).opacity).toBe(0.5);
    fireEvent(screen.getByTestId('p'), 'pressIn');
    fireEvent.press(screen.getByTestId('p'));
    expect(timing).not.toHaveBeenCalled();
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sonraki' })).toBeDisabled();
  });
});

describe('IconButton badgeCount', () => {
  it.each(['tactile', 'glass', 'plain'] as const)('%s: hidden at 0, shown with its value from 1', variant => {
    const view = renderWithProviders(
      <IconButton variant={variant} icon="more" badgeCount={0} onPress={jest.fn()} accessibilityLabel="Sıra" testID="q" />,
    );
    expect(screen.queryByTestId('q-count')).toBeNull();
    expect(screen.getByTestId('q').props.accessibilityValue?.text).toBeUndefined();

    view.rerender(<IconButton variant={variant} icon="more" badgeCount={3} onPress={jest.fn()} accessibilityLabel="Sıra" testID="q" />);
    expect(screen.getByTestId('q-count')).toHaveTextContent('3');
    expect(flat(screen.getByTestId('q-count'))).toMatchObject({ position: 'absolute', backgroundColor: gece.action });
    // Screen readers hear the label, then the count.
    expect(screen.getByRole('button', { name: 'Sıra' }).props.accessibilityValue).toEqual({ text: '3' });

    view.rerender(<IconButton variant={variant} icon="more" badgeCount={120} onPress={jest.fn()} accessibilityLabel="Sıra" testID="q" />);
    expect(screen.getByTestId('q-count')).toHaveTextContent('99+');
    view.rerender(<IconButton variant={variant} icon="more" onPress={jest.fn()} accessibilityLabel="Sıra" testID="q" />);
    expect(screen.queryByTestId('q-count')).toBeNull();
  });

  // NL-06 / V5-05: Android keeps the last value a view was given when the
  // prop goes away, so a cleared queue still announced "Sıra, 4".
  it.each(['tactile', 'glass', 'plain'] as const)(
    '%s: a count going back to 0 leaves an explicit empty value, not none',
    variant => {
      const button = (count?: number) => (
        <IconButton variant={variant} icon="queue" badgeCount={count} onPress={jest.fn()} accessibilityLabel="Sıra" testID="q" />
      );
      const value = () => screen.getByTestId('q').props.accessibilityValue;
      const view = renderWithProviders(button(4));
      expect(value()).toEqual({ text: '4' });

      view.rerender(button(0));
      expect(screen.queryByTestId('q-count')).toBeNull();
      expect(value()).toBeDefined();
      expect(value().text).toBe('');
      expect(value()).toEqual({ text: '' });

      // No count at all after one was shown: still explicitly empty.
      view.rerender(button(undefined));
      expect(value().text).toBe('');
      view.rerender(button(2));
      expect(value()).toEqual({ text: '2' });
    },
  );

  it('a button that never had a count sets no value at all', () => {
    const view = renderWithProviders(
      <IconButton variant="tactile" icon="queue" badgeCount={0} onPress={jest.fn()} accessibilityLabel="Sıra" testID="q" />,
    );
    expect(screen.getByTestId('q').props.accessibilityValue?.text).toBeUndefined();
    view.rerender(<IconButton variant="tactile" icon="bell" onPress={jest.fn()} accessibilityLabel="Bildirimler" testID="q" />);
    expect(screen.getByTestId('q').props.accessibilityValue?.text).toBeUndefined();
  });

  it.each(['tactile', 'glass', 'plain'] as const)(
    '%s with countInLabel: the label says the count, so no value is ever set',
    variant => {
      const button = (count: number, label: string) => (
        <IconButton
          variant={variant}
          icon="queue"
          badgeCount={count}
          countInLabel
          onPress={jest.fn()}
          accessibilityLabel={label}
          testID="q"
        />
      );
      const view = renderWithProviders(button(3, 'Sıradakiler, 3 masal'));
      // The bubble still shows the count; screen readers hear it once.
      expect(screen.getByTestId('q-count')).toHaveTextContent('3');
      expect(screen.getByRole('button', { name: 'Sıradakiler, 3 masal' }).props.accessibilityValue?.text).toBeUndefined();

      view.rerender(button(0, 'Sıradakiler'));
      expect(screen.queryByTestId('q-count')).toBeNull();
      expect(screen.getByRole('button', { name: 'Sıradakiler' }).props.accessibilityValue?.text).toBeUndefined();
    },
  );

  it('plain: the count sits on the glyph corner and dims with the glyph while pressed', () => {
    spyTiming();
    renderWithProviders(<IconButton icon="more" badgeCount={2} onPress={jest.fn()} accessibilityLabel="Sıra" testID="q" />);
    const glyph = screen.getByTestId('q-glyph');
    expect(within(glyph).getByTestId('q-count')).toHaveTextContent('2');
    expect(flat(screen.getByTestId('q-count'))).toMatchObject({ position: 'absolute', top: -6, right: -8 });
    fireEvent(screen.getByTestId('q'), 'pressIn');
    expect(flat(screen.getByTestId('q-glyph')).opacity).toBe(PRESS_TINT);
    expect(screen.getByTestId('q').props.needsOffscreenAlphaCompositing).toBe(false);
  });

  it('plain and disabled with a count: dimmed as one composited group', () => {
    const view = renderWithProviders(
      <IconButton icon="more" badgeCount={2} disabled onPress={jest.fn()} accessibilityLabel="Sıra" testID="q" />,
    );
    expect(flat(screen.getByTestId('q')).opacity).toBe(0.5);
    expect(screen.getByTestId('q').props.needsOffscreenAlphaCompositing).toBe(true);
    // Without a count there is nothing to overlap, so no offscreen layer.
    view.rerender(<IconButton icon="more" disabled onPress={jest.fn()} accessibilityLabel="Sıra" testID="q" />);
    expect(screen.getByTestId('q').props.needsOffscreenAlphaCompositing).toBe(false);
  });

  it('tactile: the count rides on the face, so it sinks with it', () => {
    spyTiming();
    renderWithProviders(
      <IconButton variant="tactile" icon="more" badgeCount={5} onPress={jest.fn()} accessibilityLabel="Sıra" testID="q" />,
    );
    expect(within(screen.getByTestId('q-face')).getByTestId('q-count')).toHaveTextContent('5');
    expect(flat(screen.getByTestId('q-count'))).toMatchObject({ top: -4, right: -4 });
    fireEvent(screen.getByTestId('q'), 'pressIn');
    expect(flat(screen.getByTestId('q-face')).transform).toEqual([{ translateY: LIP.sm }]);
  });
});

describe('ListRow', () => {
  it('a plain row dims while pressed, never translates, and keeps the plain row metrics', () => {
    const timing = spyTiming();
    const onPress = jest.fn();
    renderWithProviders(<ListRow title="Bildirimler" icon="bell" onPress={onPress} testID="row" />);
    const content = screen.getByTestId('row-content');
    expect(flat(content)).toMatchObject({ minHeight: 56, gap: 12, paddingHorizontal: 16, paddingVertical: 8 });
    fireEvent(screen.getByTestId('row'), 'pressIn');
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: PRESS_TINT, useNativeDriver: true }),
    );
    expect(flat(screen.getByTestId('row-content')).opacity).toBe(PRESS_TINT);
    expect(translates(screen.getByTestId('row'))).toEqual([]);
    fireEvent(screen.getByTestId('row'), 'pressOut');
    fireEvent.press(screen.getByTestId('row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a disabled plain row neither tints nor presses', () => {
    const timing = spyTiming();
    const onPress = jest.fn();
    renderWithProviders(<ListRow title="Bildirimler" onPress={onPress} disabled testID="row" />);
    fireEvent(screen.getByTestId('row'), 'pressIn');
    fireEvent.press(screen.getByTestId('row'));
    expect(timing).not.toHaveBeenCalled();
    expect(onPress).not.toHaveBeenCalled();
    expect(flat(screen.getByTestId('row')).opacity).toBe(0.5);
  });

  it('the icon tile is 40dp, radius 12, one step above the level it sits on', () => {
    const view = renderWithProviders(<ListRow title="Bildirimler" icon="bell" testID="row" />);
    expect(flat(screen.getByTestId('row-tile'))).toMatchObject({
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: raisedFace(gece, 'bg'),
    });
    view.rerender(
      <SurfaceLevelProvider level="surface">
        <ListRow title="Bildirimler" icon="bell" testID="row" />
      </SurfaceLevelProvider>,
    );
    expect(flat(screen.getByTestId('row-tile')).backgroundColor).toBe(gece.surface2);
  });

  it('a card row: radius 20, padding 12, minHeight 64, raised from its container, sinking by its lip', () => {
    spyTiming();
    const view = renderWithProviders(<ListRow card title="Uyku masalları" icon="moon" onPress={jest.fn()} testID="card" />);
    expect(flat(screen.getByTestId('card-face'))).toMatchObject({
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 12,
      minHeight: 64,
      gap: 12,
      backgroundColor: gece.surface,
    });
    // The tile on the card is one more step up.
    expect(flat(screen.getByTestId('card-tile')).backgroundColor).toBe(gece.surface2);
    fireEvent(screen.getByTestId('card'), 'pressIn');
    expect(flat(screen.getByTestId('card-face')).transform).toEqual([{ translateY: LIP.md }]);
    view.rerender(
      <SurfaceLevelProvider level="surface">
        <ListRow card title="Uyku masalları" icon="moon" testID="card" />
      </SurfaceLevelProvider>,
    );
    expect(flat(screen.getByTestId('card-face')).backgroundColor).toBe(gece.surface2);
    expect(flat(screen.getByTestId('card-tile')).backgroundColor).toBe(gece.line);
  });

  it('subtitleLines caps the subtitle; by default it is not capped', () => {
    const view = renderWithProviders(<ListRow title="Klasikler" subtitle="Uzun bir açıklama" subtitleLines={2} />);
    expect(screen.getByText('Uzun bir açıklama').props.numberOfLines).toBe(2);
    view.rerender(<ListRow title="Klasikler" subtitle="Uzun bir açıklama" />);
    expect(screen.getByText('Uzun bir açıklama').props.numberOfLines).toBeUndefined();
  });

  it('waits the press delay inside lists', () => {
    const view = renderWithProviders(<ListRow title="Bildirimler" onPress={jest.fn()} testID="row" />);
    expect(view.UNSAFE_getByProps({ testID: 'row', unstable_pressDelay: 100 })).toBeTruthy();
  });
});

describe('FieldFrame and TextField', () => {
  it('the ring is transparent at rest, text2 while focused, error with an error', () => {
    const view = renderWithProviders(<TextField label="E-posta" value="" onChangeText={jest.fn()} testID="mail" />);
    const ring = () => flat(screen.getByTestId('mail-field-face')).borderColor;
    expect(flat(screen.getByTestId('mail-field-face')).borderWidth).toBe(2);
    expect(ring()).toBe('transparent');
    fireEvent(screen.getByTestId('mail'), 'focus');
    expect(ring()).toBe(gece.text2);
    fireEvent(screen.getByTestId('mail'), 'blur');
    expect(ring()).toBe('transparent');
    view.rerender(<TextField label="E-posta" error="Geçerli bir e-posta gir" value="" onChangeText={jest.fn()} testID="mail" />);
    expect(ring()).toBe(gece.error);
    // The error wins over the focus.
    fireEvent(screen.getByTestId('mail'), 'focus');
    expect(ring()).toBe(gece.error);
    expect(flat(screen.getByText('E-posta')).color).toBe(gece.error);
  });

  it('forwards focus and blur to the caller', () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    renderWithProviders(
      <TextField label="E-posta" value="" onChangeText={jest.fn()} onFocus={onFocus} onBlur={onBlur} testID="mail" />,
    );
    fireEvent(screen.getByTestId('mail'), 'focus');
    fireEvent(screen.getByTestId('mail'), 'blur');
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('the face is inset from its container: surface on the canvas, the canvas inside a sheet', () => {
    const view = renderWithProviders(<TextField label="E-posta" value="" onChangeText={jest.fn()} testID="mail" />);
    expect(flat(screen.getByTestId('mail-field-face'))).toMatchObject({
      backgroundColor: insetFace(gece, 'bg'),
      borderRadius: 20,
      minHeight: 52,
      paddingLeft: 16,
      paddingRight: 8,
    });
    expect(flat(screen.getByTestId('mail-field-lip'))).toMatchObject({ top: LIP.md, borderRadius: 20, backgroundColor: gece.lip });
    view.rerender(
      <SurfaceLevelProvider level="surface">
        <TextField label="E-posta" value="" onChangeText={jest.fn()} testID="mail" />
      </SurfaceLevelProvider>,
    );
    expect(flat(screen.getByTestId('mail-field-face')).backgroundColor).toBe(gece.bg);
    expect(flat(screen.getByTestId('mail-field-face')).backgroundColor).not.toBe(gece.surface);
  });

  it('draws no Android underline, colours the cursor and the handles, and passes editable through', () => {
    renderWithProviders(<TextField label="E-posta" value="" editable={false} onChangeText={jest.fn()} testID="mail" />);
    expect(screen.getByTestId('mail').props).toMatchObject({
      underlineColorAndroid: 'transparent',
      selectionHandleColor: gece.action,
      cursorColor: gece.action,
      selectionColor: gece.action,
      placeholderTextColor: gece.text3,
      editable: false,
    });
  });

  it('a ref reaches the input, so a sheet can focus it', () => {
    const ref = createRef<TextInput>();
    renderWithProviders(<TextField ref={ref} label="E-posta" value="" onChangeText={jest.fn()} testID="mail" />);
    expect(ref.current).not.toBeNull();
    expect((ref.current as unknown as { props: { testID: string } }).props.testID).toBe('mail');
    ref.current?.focus();
    expect(ref.current?.focus).toHaveBeenCalledTimes(1);
  });

  it('the label sits 8 above the field and the helper 6 below it', () => {
    renderWithProviders(<TextField label="Şifre" helper="En az 6 karakter" value="" onChangeText={jest.fn()} />);
    expect(flat(screen.getByText('Şifre')).marginBottom).toBe(8);
    expect(flat(screen.getByText('En az 6 karakter')).marginTop).toBe(6);
  });

  it('fieldRingColor and a bare FieldFrame', () => {
    expect(fieldRingColor(gece, false, false)).toBe('transparent');
    expect(fieldRingColor(gece, true, false)).toBe(gece.text2);
    expect(fieldRingColor(gece, true, true)).toBe(gece.error);
    renderWithProviders(
      <SurfaceLevelProvider level="surface2">
        <FieldFrame ringColor="transparent" testID="f" />
      </SurfaceLevelProvider>,
    );
    expect(flat(screen.getByTestId('f-face')).backgroundColor).toBe(insetFace(gece, 'surface2'));
  });
});

describe('TopAppBar', () => {
  it('the tab title shrinks a little instead of truncating at large font scales', () => {
    renderWithProviders(<TopAppBar variant="tab" title="Kütüphane" />);
    expect(screen.getByText('Kütüphane').props).toMatchObject({
      numberOfLines: 1,
      adjustsFontSizeToFit: true,
      maxFontSizeMultiplier: 1.15,
      minimumFontScale: 0.8,
    });
  });

  it('the back button is the tactile icon button on the canvas', () => {
    renderWithProviders(<TopAppBar title="Ses kaydı" onBack={jest.fn()} />);
    expect(flat(screen.getByTestId('appbar-back-face')).backgroundColor).toBe(gece.surface);
    expect(flat(screen.getByTestId('appbar-back-lip')).top).toBe(LIP.sm);
  });
});

describe('TopAppBar scroll edge (V18)', () => {
  const scrollTo = (y: number) =>
    ({ nativeEvent: { contentOffset: { x: 0, y } } }) as unknown as NativeSyntheticEvent<NativeScrollEvent>;

  it('a bar without `scrolled` draws no fade and stays in the flow as before', () => {
    renderWithProviders(<TopAppBar variant="tab" title="Sesim" />);
    expect(screen.queryByTestId('appbar-edge')).toBeNull();
  });

  it('hangs a canvas fade under the bar, hidden at the top and shown once the list is under it', () => {
    const timing = spyTiming();
    const view = renderWithProviders(<TopAppBar variant="back" title="Anlatıcılar" scrolled={false} />);
    const edge = () => screen.getByTestId('appbar-edge');
    // Below the bar, over the list, taking no touches and no space.
    expect(flat(edge())).toMatchObject({ position: 'absolute', top: '100%', left: 0, right: 0, height: APP_BAR_EDGE_FADE, opacity: 0 });
    expect(edge().props.pointerEvents).toBe('none');
    const gradient = within(edge()).getByTestId('appbar-edge-fade');
    expect(gradient.props.colors).toEqual([gece.bg, withAlpha(gece.bg, 0)]);

    view.rerender(<TopAppBar variant="back" title="Anlatıcılar" scrolled />);
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 1, duration: DURATION.fast, useNativeDriver: true }),
    );
    expect(flat(edge()).opacity).toBe(1);

    view.rerender(<TopAppBar variant="back" title="Anlatıcılar" scrolled={false} />);
    expect(timing).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ toValue: 0 }));
    expect(flat(edge()).opacity).toBe(0);
  });

  it('useScrollEdge flips only when the offset crosses the threshold', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useScrollEdge();
    });
    const first = renders;
    expect(result.current.scrolled).toBe(false);

    act(() => result.current.onScroll(scrollTo(SCROLL_EDGE_OFFSET)));
    expect(result.current.scrolled).toBe(false);
    expect(renders).toBe(first);

    act(() => result.current.onScroll(scrollTo(SCROLL_EDGE_OFFSET + 1)));
    expect(result.current.scrolled).toBe(true);
    const afterFlip = renders;
    // Scrolling further down does not render again.
    act(() => result.current.onScroll(scrollTo(240)));
    act(() => result.current.onScroll(scrollTo(480)));
    expect(renders).toBe(afterFlip);

    // Back at the top (also an overscroll bounce).
    act(() => result.current.onScroll(scrollTo(-20)));
    expect(result.current.scrolled).toBe(false);
  });

  it('the handler is stable, so a list never re-binds it', () => {
    const { result } = renderHook(() => useScrollEdge());
    const handler = result.current.onScroll;
    act(() => result.current.onScroll(scrollTo(100)));
    expect(result.current.onScroll).toBe(handler);
  });
});

describe('Avatar', () => {
  it('without a lip a pressable avatar dims and never moves', () => {
    const timing = spyTiming();
    const onPress = jest.fn();
    renderWithProviders(<Avatar initial="Z" size={40} onPress={onPress} accessibilityLabel="Profil" testID="av" />);
    fireEvent(screen.getByTestId('av'), 'pressIn');
    expect(timing).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ toValue: PRESS_TINT }));
    expect(flat(screen.getByTestId('av-face')).opacity).toBe(PRESS_TINT);
    expect(translates(screen.getByTestId('av'))).toEqual([]);
    expect(flat(screen.getByTestId('av'))).toMatchObject({ width: 48, height: 48 });
    fireEvent.press(screen.getByRole('button', { name: 'Profil' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('with a lip the bubble sinks onto a separate lip layer, which stays put', () => {
    spyTiming();
    renderWithProviders(
      <Avatar icon="mic" size={52} lipColor={gece.ownLip} onPress={jest.fn()} accessibilityLabel="Sesim" testID="av" />,
    );
    expect(flat(screen.getByTestId('av-lip'))).toMatchObject({ top: LIP.md, backgroundColor: gece.ownLip });
    fireEvent(screen.getByTestId('av'), 'pressIn');
    expect(flat(screen.getByTestId('av-face')).transform).toEqual([{ translateY: LIP.md }]);
    expect(flat(screen.getByTestId('av-lip')).transform).toBeUndefined();
    fireEvent(screen.getByTestId('av'), 'pressOut');
    expect(flat(screen.getByTestId('av-face')).transform).toEqual([{ translateY: 0 }]);
  });

  it('a 40dp avatar (the top bar) sits on the control lip like the bell beside it, and sinks by it', () => {
    spyTiming();
    renderWithProviders(
      <Avatar initial="S" size={40} lipColor={gece.ownLip} onPress={jest.fn()} accessibilityLabel="Profil" testID="av" />,
    );
    expect(flat(screen.getByTestId('av-lip')).top).toBe(LIP.sm);
    expect(flat(screen.getByTestId('av'))).toMatchObject({ width: 48, height: 48 });
    fireEvent(screen.getByTestId('av'), 'pressIn');
    expect(flat(screen.getByTestId('av-face')).transform).toEqual([{ translateY: LIP.sm }]);
  });

  it('a static avatar with a lip keeps its testID on the bubble and draws the lip below it', () => {
    renderWithProviders(<Avatar icon="mic" size={52} shape="rounded" lipColor={gece.ownLip} testID="own" />);
    expect(flat(screen.getByTestId('own'))).toMatchObject({ width: 52, height: 52, backgroundColor: gece.own });
    // 52dp rounded: the picture-tile corner of the radius roles.
    expect(flat(screen.getByTestId('own-lip'))).toMatchObject({ top: LIP.md, backgroundColor: gece.ownLip, borderRadius: RADIUS.md });
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('StateView and StateIcon', () => {
  it('the title is as narrow as the message and the action is an md button 24 below', () => {
    renderWithProviders(
      <StateView title="İnternete bağlı değilsin" message="Bağlantı gerekiyor." actionLabel="Tekrar dene" onAction={jest.fn()} />,
    );
    expect(flat(screen.getByText('İnternete bağlı değilsin')).maxWidth).toBe(300);
    const action = screen.getByRole('button', { name: 'Tekrar dene' });
    expect(flat(action).marginTop).toBe(24);
    expect(flat(action).paddingBottom).toBe(LIP.sm);
  });

  it('the state icon sits on the lg lip', () => {
    renderWithProviders(<StateIcon icon="bell" testID="si" />);
    expect(flat(screen.getByTestId('si'))).toMatchObject({
      width: 76,
      height: 76 + LIP.lg,
      borderBottomWidth: LIP.lg,
      borderBottomColor: gece.lip,
      backgroundColor: gece.surface2,
    });
    expect(LIP.lg).toBe(4);
  });
});
