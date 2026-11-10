import React from 'react';
import { AccessibilityInfo, Animated, Dimensions, Text, View } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '../../test-utils/render-helpers';
import { LIP, RADIUS, makeTextStyles, themes } from '../../theme/theme';
import { DURATION, EASE } from '../../theme/motion';
import {
  COVER_CARD_TITLE_LINE,
  CoverCard,
  CoverMeta,
  coverCardCaptionHeight,
  coverLip,
  coverRadius,
  textLineBox,
} from './PictureCover';
import { Icon } from './Icon';
import { StoryGridSkeleton, storyGridLayout } from '../story/StoryCard';
import {
  Bone,
  FadeIn,
  LoadingLine,
  RowSkeleton,
  SKELETON_PULSE_FLOOR,
  ShelfSkeleton,
  SkeletonPulse,
  SkeletonSwap,
  TextBones,
} from './Skeleton';

type TestNode = ReturnType<typeof screen.getByTestId>;

const flat = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

type Timing = { value: Animated.Value; config: Animated.TimingAnimationConfig };

/**
 * Records every Animated.timing and Animated.loop without running them: a
 * started timing lands on its value at once (the native driver runs off the
 * JS thread), a started loop does nothing.
 */
function recordAnimations() {
  const timings: Timing[] = [];
  const loop = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
  jest.spyOn(Animated, 'timing').mockImplementation(((value: Animated.Value, config: Animated.TimingAnimationConfig) => {
    timings.push({ value, config });
    return {
      start: (done?: (result: { finished: boolean }) => void) => {
        if (typeof config.toValue === 'number') value.setValue(config.toValue);
        done?.({ finished: true });
      },
      stop: jest.fn(),
      reset: jest.fn(),
    };
  }) as unknown as typeof Animated.timing);
  const loopSpy = jest.spyOn(Animated, 'loop').mockImplementation((() => loop) as unknown as typeof Animated.loop);
  return { timings, loop, loopSpy };
}

/** The frame after mount, when the pulse and the fade start. */
const nextFrame = () => act(() => jest.advanceTimersByTime(20));

/** Reduced motion on: the query answers true, and the change listener is captured. */
function reduceMotion(initial: boolean) {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(initial);
  let listener: ((value: boolean) => void) | undefined;
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((_event: string, handler: (value: boolean) => void) => {
    listener = handler;
    return { remove: jest.fn() };
  }) as unknown as typeof AccessibilityInfo.addEventListener);
  return (value: boolean) => act(() => listener?.(value));
}

describe('SkeletonPulse', () => {
  it('a pulse is one busy, labelled block for a screen reader', async () => {
    renderWithProviders(
      <SkeletonPulse testID="sk">
        <RowSkeleton />
      </SkeletonPulse>,
    );
    await act(async () => undefined);
    const block = screen.getByTestId('sk');
    expect(block.props.accessibilityLabel).toBe('Yükleniyor...');
    expect(block.props.accessibilityRole).toBe('progressbar');
    expect(block.props.accessibilityState).toEqual({ busy: true });
  });

  it('draws the block into one layer, so no lip shows through a face while it fades', () => {
    renderWithProviders(
      <SkeletonPulse testID="sk">
        <Bone height={40} lip={3} />
      </SkeletonPulse>,
    );
    const block = screen.getByTestId('sk');
    expect(block.props.renderToHardwareTextureAndroid).toBe(true);
    expect(block.props.shouldRasterizeIOS).toBe(true);
  });

  it('breathes from 1 down to 0.7 and back on the native driver, a frame after mount', () => {
    const { timings, loop, loopSpy } = recordAnimations();
    renderWithProviders(
      <SkeletonPulse testID="sk">
        <Bone height={10} />
      </SkeletonPulse>,
    );
    // The mount frame is still.
    expect(loopSpy).not.toHaveBeenCalled();
    nextFrame();
    expect(loopSpy).toHaveBeenCalledTimes(1);
    expect(loop.start).toHaveBeenCalledTimes(1);
    expect(SKELETON_PULSE_FLOOR).toBe(0.7);
    expect(timings.map(t => t.config.toValue)).toEqual([0.7, 1]);
    for (const { config } of timings) {
      expect(config).toMatchObject({ duration: DURATION.pulse / 2, easing: EASE.symmetric, useNativeDriver: true });
    }
  });

  it('every pulse breathes with one value and one loop, stopped with the last one', () => {
    const { timings, loop, loopSpy } = recordAnimations();
    const Two: React.FC<{ second: boolean }> = ({ second }) => (
      <View>
        <SkeletonPulse testID="a">
          <Bone height={10} />
        </SkeletonPulse>
        {second ? (
          <SkeletonPulse testID="b">
            <Bone height={10} />
          </SkeletonPulse>
        ) : null}
      </View>
    );
    const view = renderWithProviders(<Two second />);
    nextFrame();
    expect(loopSpy).toHaveBeenCalledTimes(1);
    expect(loop.start).toHaveBeenCalledTimes(1);

    // Moving the one value moves both blocks.
    const shared = timings[0].value;
    act(() => shared.setValue(0.8));
    expect(flat(screen.getByTestId('a')).opacity).toBe(0.8);
    expect(flat(screen.getByTestId('b')).opacity).toBe(0.8);

    // One block leaves: the other keeps breathing.
    view.rerender(<Two second={false} />);
    expect(loop.stop).not.toHaveBeenCalled();
    // The last one leaves: the loop stops and the value is back at rest.
    view.unmount();
    expect(loop.stop).toHaveBeenCalledTimes(1);
    expect((shared as unknown as { __getValue(): number }).__getValue()).toBe(1);

    // A new skeleton starts a new loop.
    renderWithProviders(
      <SkeletonPulse testID="c">
        <Bone height={10} />
      </SkeletonPulse>,
    );
    nextFrame();
    expect(loopSpy).toHaveBeenCalledTimes(2);
  });

  it('a skeleton gone before its first frame starts nothing', () => {
    const { loopSpy } = recordAnimations();
    const view = renderWithProviders(
      <SkeletonPulse testID="sk">
        <Bone height={10} />
      </SkeletonPulse>,
    );
    view.unmount();
    nextFrame();
    expect(loopSpy).not.toHaveBeenCalled();
  });

  it('reduced motion starts no loop and keeps the block at full opacity', async () => {
    reduceMotion(true);
    const { loopSpy } = recordAnimations();
    renderWithProviders(
      <SkeletonPulse testID="sk" label="Anlatıcılar yükleniyor...">
        <Bone height={10} />
      </SkeletonPulse>,
    );
    await act(async () => undefined);
    nextFrame();
    expect(loopSpy).not.toHaveBeenCalled();
    expect(flat(screen.getByTestId('sk')).opacity).toBe(1);
    expect(screen.getByTestId('sk').props.accessibilityLabel).toBe('Anlatıcılar yükleniyor...');
  });

  it('turning reduced motion on stops a running pulse; off starts it again', async () => {
    const setReduced = reduceMotion(false);
    const { loop, loopSpy } = recordAnimations();
    renderWithProviders(
      <SkeletonPulse testID="sk">
        <Bone height={10} />
      </SkeletonPulse>,
    );
    await act(async () => undefined);
    nextFrame();
    expect(loop.start).toHaveBeenCalledTimes(1);
    setReduced(true);
    expect(loop.stop).toHaveBeenCalledTimes(1);
    expect(flat(screen.getByTestId('sk')).opacity).toBe(1);
    setReduced(false);
    nextFrame();
    expect(loopSpy).toHaveBeenCalledTimes(2);
  });
});

/**
 * Records every Animated.timing and holds it: a started fade stays where it
 * is (as on a busy device, before the native driver has run it) until the
 * test finishes it; a stop ends it unfinished.
 */
function holdAnimations() {
  type Held = Timing & { started: boolean; done?: (result: { finished: boolean }) => void; over: boolean };
  const held: Held[] = [];
  jest.spyOn(Animated, 'timing').mockImplementation(((value: Animated.Value, config: Animated.TimingAnimationConfig) => {
    const entry: Held = { value, config, started: false, over: false };
    held.push(entry);
    return {
      start: (done?: (result: { finished: boolean }) => void) => {
        entry.started = true;
        entry.done = done;
      },
      stop: () => {
        if (entry.over) return;
        entry.over = true;
        entry.done?.({ finished: false });
      },
      reset: jest.fn(),
    };
  }) as unknown as typeof Animated.timing);
  /** The native driver ran the fade to its end. */
  const finish = (index = held.length - 1) =>
    act(() => {
      const entry = held[index];
      if (entry.over) return;
      entry.over = true;
      if (typeof entry.config.toValue === 'number') entry.value.setValue(entry.config.toValue);
      entry.done?.({ finished: true });
    });
  /** The native driver is half way through it. */
  const midway = (index = held.length - 1) => act(() => held[index].value.setValue(0.5));
  return { held, finish, midway };
}

const opacityOf = (testID: string) =>
  flat(screen.getByTestId(testID, { includeHiddenElements: true })).opacity as number;

describe('FadeIn', () => {
  it('starts its one fade in the commit that mounts it, without waiting for a frame', () => {
    const { held, finish } = holdAnimations();
    const view = renderWithProviders(
      <FadeIn testID="fade">
        <Text>Masallar</Text>
      </FadeIn>,
    );
    // No frame has passed: the fade is already handed to the native driver,
    // so a JS thread busy with the rest of the screen cannot hold it at 0.
    expect(held).toHaveLength(1);
    expect(held[0].started).toBe(true);
    expect(held[0].config).toMatchObject({
      toValue: 1,
      duration: DURATION.enter,
      easing: EASE.standard,
      useNativeDriver: true,
    });
    expect(opacityOf('fade')).toBe(0);
    expect(screen.getByTestId('fade').props.needsOffscreenAlphaCompositing).toBe(true);
    finish();
    expect(opacityOf('fade')).toBe(1);

    // Later renders never fade it again.
    view.rerender(
      <FadeIn testID="fade">
        <Text>Masallar ve daha fazlası</Text>
      </FadeIn>,
    );
    nextFrame();
    expect(held).toHaveLength(1);
    expect(screen.getByText('Masallar ve daha fazlası')).toBeTruthy();
  });

  it('under reduced motion the content is at full opacity as soon as the answer is in', async () => {
    reduceMotion(true);
    const { held } = holdAnimations();
    renderWithProviders(
      <FadeIn testID="fade">
        <Text>Masallar</Text>
      </FadeIn>,
    );
    await act(async () => undefined);
    expect(opacityOf('fade')).toBe(1);
    // The fade started at mount went no further.
    expect(held.every(entry => entry.over)).toBe(true);
    nextFrame();
    expect(held).toHaveLength(1);
    expect(opacityOf('fade')).toBe(1);
  });

  it('skip shows content that was already on screen without a fade', () => {
    const { timings } = recordAnimations();
    renderWithProviders(
      <FadeIn testID="fade" skip>
        <Text>Masallar</Text>
      </FadeIn>,
    );
    nextFrame();
    expect(timings).toHaveLength(0);
    expect(flat(screen.getByTestId('fade')).opacity).toBe(1);
  });
});

describe('SkeletonSwap', () => {
  const Slot: React.FC<{ loading: boolean; skip?: boolean }> = ({ loading, skip }) => (
    <SkeletonSwap
      loading={loading}
      skip={skip}
      testID="slot"
      skeleton={
        <SkeletonPulse testID="slot-loading">
          <Bone height={40} lip={3} />
        </SkeletonPulse>
      }
    >
      <Text>Masallar</Text>
    </SkeletonSwap>
  );
  const skeletonShown = () => screen.queryByTestId('slot-skeleton', { includeHiddenElements: true });
  const contentShown = () => screen.queryByTestId('slot-content', { includeHiddenElements: true });
  /** What the frame shows: the skeleton or the content is drawn at some opacity. */
  const somethingVisible = () =>
    (skeletonShown() ? opacityOf('slot-skeleton') : 0) + (contentShown() ? opacityOf('slot-content') : 0) > 0;

  it('every render shows the skeleton or the content: the skeleton, both while they cross-fade, then the content', () => {
    const { held, finish, midway } = holdAnimations();
    const view = renderWithProviders(<Slot loading />);
    expect(skeletonShown()).not.toBeNull();
    expect(contentShown()).toBeNull();
    expect(opacityOf('slot-skeleton')).toBe(1);
    expect(screen.getByTestId('slot-loading').props.accessibilityState).toEqual({ busy: true });
    expect(somethingVisible()).toBe(true);

    // The content is there: it mounts under the fade, which starts in the
    // same commit (no frame passed), and the skeleton stays at full opacity
    // until the native driver moves the fade.
    view.rerender(<Slot loading={false} />);
    expect(held).toHaveLength(1);
    expect(held[0].started).toBe(true);
    expect(held[0].config).toMatchObject({
      toValue: 1,
      duration: DURATION.enter,
      easing: EASE.standard,
      useNativeDriver: true,
    });
    expect(opacityOf('slot-skeleton')).toBe(1);
    expect(opacityOf('slot-content')).toBe(0);
    expect(somethingVisible()).toBe(true);
    // Half way: both at half.
    midway();
    expect(opacityOf('slot-skeleton')).toBe(0.5);
    expect(opacityOf('slot-content')).toBe(0.5);
    // The skeleton under the content takes no touches and is not read out.
    const skeleton = screen.getByTestId('slot-skeleton', { includeHiddenElements: true });
    expect(skeleton.props.pointerEvents).toBe('none');
    expect(skeleton.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(screen.queryByTestId('slot-loading')).toBeNull();
    expect(screen.getByText('Masallar')).toBeOnTheScreen();

    // The fade ends: only the content, at full opacity, and nothing fades again.
    finish();
    expect(skeletonShown()).toBeNull();
    expect(opacityOf('slot-content')).toBe(1);
    expect(somethingVisible()).toBe(true);
    view.rerender(<Slot loading={false} />);
    nextFrame();
    expect(held).toHaveLength(1);
  });

  it('a JS thread that never gets to the fade still shows the skeleton, not an empty slot', () => {
    holdAnimations();
    const view = renderWithProviders(<Slot loading />);
    view.rerender(<Slot loading={false} />);
    // Frames pass with the fade not yet moved: the skeleton is still drawn.
    for (let i = 0; i < 50; i += 1) nextFrame();
    expect(opacityOf('slot-skeleton')).toBe(1);
    expect(somethingVisible()).toBe(true);
  });

  it("keeps the slot at the skeleton's height while the content fades in, so nothing under it moves", () => {
    const { finish } = holdAnimations();
    const view = renderWithProviders(<Slot loading />);
    act(() => {
      fireEvent(screen.getByTestId('slot-skeleton'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 180 } },
      });
    });
    expect(flat(screen.getByTestId('slot')).minHeight).toBeUndefined();
    view.rerender(<Slot loading={false} />);
    expect(flat(screen.getByTestId('slot')).minHeight).toBe(180);
    // The skeleton lies at the slot's top while the content takes its place in the flow.
    expect(flat(screen.getByTestId('slot-skeleton', { includeHiddenElements: true }))).toMatchObject({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
    });
    finish();
    expect(flat(screen.getByTestId('slot')).minHeight).toBeUndefined();
  });

  it('under reduced motion the content replaces the skeleton at once', async () => {
    reduceMotion(true);
    const { held } = holdAnimations();
    const view = renderWithProviders(<Slot loading />);
    await act(async () => undefined);
    view.rerender(<Slot loading={false} />);
    expect(held).toHaveLength(0);
    expect(skeletonShown()).toBeNull();
    expect(opacityOf('slot-content')).toBe(1);
  });

  it('turning reduced motion on during the cross-fade ends it at the content', async () => {
    const setReduced = reduceMotion(false);
    holdAnimations();
    const view = renderWithProviders(<Slot loading />);
    await act(async () => undefined);
    view.rerender(<Slot loading={false} />);
    expect(skeletonShown()).not.toBeNull();
    setReduced(true);
    expect(skeletonShown()).toBeNull();
    expect(opacityOf('slot-content')).toBe(1);
  });

  it('skip, and content already there at mount, show the content without a fade', () => {
    const { held } = holdAnimations();
    const view = renderWithProviders(<Slot loading skip />);
    view.rerender(<Slot loading={false} skip />);
    expect(held).toHaveLength(0);
    expect(skeletonShown()).toBeNull();
    expect(opacityOf('slot-content')).toBe(1);
    view.unmount();

    renderWithProviders(<Slot loading={false} />);
    expect(held).toHaveLength(0);
    expect(skeletonShown()).toBeNull();
    expect(opacityOf('slot-content')).toBe(1);
  });

  it('a load again shows the skeleton again, and the next content cross-fades again', () => {
    const { held, finish } = holdAnimations();
    const view = renderWithProviders(<Slot loading />);
    view.rerender(<Slot loading={false} />);
    finish();
    view.rerender(<Slot loading />);
    expect(contentShown()).toBeNull();
    expect(opacityOf('slot-skeleton')).toBe(1);
    view.rerender(<Slot loading={false} />);
    expect(held).toHaveLength(2);
    expect(opacityOf('slot-skeleton')).toBe(1);
    expect(opacityOf('slot-content')).toBe(0);
  });

  it('leaving during the cross-fade stops it without touching the gone slot', () => {
    const { held } = holdAnimations();
    const view = renderWithProviders(<Slot loading />);
    view.rerender(<Slot loading={false} />);
    view.unmount();
    expect(held[0].over).toBe(true);
  });
});

describe('shapes', () => {
  const T = themes.kitaplik;

  it('tones: surface by default, text and raised one step lighter, line on a card', () => {
    const color = (tone?: 'surface' | 'text' | 'line' | 'raised') => {
      const view = renderWithProviders(
        <View testID="w">
          <Bone tone={tone} height={10} />
        </View>,
        { theme: 'kitaplik' },
      );
      const wrap = screen.getByTestId('w');
      const [bone] = wrap.findAll((node: TestNode) => typeof node.type === 'string' && node !== wrap);
      const color = flat(bone).backgroundColor;
      view.unmount();
      return color;
    };
    expect(color()).toBe(T.surface);
    expect(color('text')).toBe(T.surface2);
    expect(color('raised')).toBe(T.surface2);
    expect(color('line')).toBe(T.line);
  });

  it('text bones take the tone they are given', () => {
    const view = renderWithProviders(<TextBones tone="text" lines={3} />, { theme: 'kitaplik' });
    const json = JSON.stringify(view.toJSON());
    expect(json.split(T.surface2).length - 1).toBe(3);
  });

  it('a lipped shape sits on the lip of the card it stands for', () => {
    const view = renderWithProviders(<Bone height={20} lip={3} radius={20} />, { theme: 'kitaplik' });
    const json = JSON.stringify(view.toJSON());
    expect(json).toContain(T.surface);
    expect(json).toContain(T.lip);
  });

  it('a default row skeleton is a row card: radius 20 on the 3dp lip, a 46dp tile with the 16 corner', () => {
    renderWithProviders(
      <View testID="w">
        <RowSkeleton />
      </View>,
    );
    const wrap = screen.getByTestId('w');
    const styled = (key: string, value: number) =>
      wrap.findAll((node: TestNode) => typeof node.type === 'string' && flat(node)[key] === value);
    // The outer box reserves the lip; the lip layer starts 3 lower and has the row corner.
    expect(styled('paddingBottom', LIP.md).length).toBeGreaterThan(0);
    expect(wrap.findAll((node: TestNode) => typeof node.type === 'string' && flat(node).top === LIP.md && flat(node).borderRadius === RADIUS.lg)).toHaveLength(1);
    // The face: 70 tall on the row radius; the leading tile 46 on 16.
    expect(wrap.findAll((node: TestNode) => typeof node.type === 'string' && flat(node).height === 70 && flat(node).borderRadius === RADIUS.lg)).toHaveLength(1);
    expect(wrap.findAll((node: TestNode) => typeof node.type === 'string' && flat(node).width === 46 && flat(node).borderRadius === RADIUS.md)).toHaveLength(1);
    // No corner off the radius set.
    expect(styled('borderRadius', 22)).toHaveLength(0);
    expect(styled('borderRadius', 14)).toHaveLength(0);
  });

  it('a shelf skeleton has the real geometry: heading box, 12 to the covers, cover corners and lips', () => {
    renderWithProviders(<ShelfSkeleton coverWidth={100} coverHeight={150} covers={2} testID="shelf" />, {
      theme: 'kitaplik',
    });
    const hosts = (root: TestNode, test: (node: TestNode) => boolean): TestNode[] =>
      root.findAll((node: TestNode) => typeof node.type === 'string' && node !== root && test(node));
    const hostParent = (node: TestNode) => {
      let at = node.parent;
      while (at && typeof at.type !== 'string') at = at.parent;
      return at as TestNode;
    };
    const shelf = screen.getByTestId('shelf');
    const heading = screen.getByTestId('shelf-heading');
    // The real heading's one line at the font scale, in whole pixels.
    const { fontScale, scale } = Dimensions.get('window');
    expect(flat(heading).height).toBe(textLineBox(makeTextStyles(T).heading.lineHeight ?? 0, fontScale, scale));
    expect(hosts(heading, () => true).map(node => flat(node).backgroundColor)).toEqual([T.surface2]);
    const faces = hosts(shelf, node => flat(node).height === 150);
    expect(faces).toHaveLength(2);
    // The covers start 12 under the heading box, 12 apart.
    expect(flat(hostParent(hostParent(hostParent(faces[0]))))).toMatchObject({ marginTop: 12, gap: 12 });
    for (const face of faces) {
      expect(flat(face)).toMatchObject({ borderRadius: coverRadius(100, 'upright'), backgroundColor: T.surface });
      expect(flat(hostParent(face)).paddingBottom).toBe(coverLip(100));
    }
    // Under each cover the caption block, 8 lower: two title lines (the
    // default) in boxes of the real line height, each with a text bone.
    const line = textLineBox(COVER_CARD_TITLE_LINE, fontScale, scale);
    for (const i of [0, 1]) {
      expect(flat(screen.getByTestId(`shelf-caption-${i}`))).toMatchObject({ marginTop: 8, height: 2 * line });
      for (const j of [0, 1]) {
        const box = screen.getByTestId(`shelf-caption-${i}-line-${j}`);
        expect(flat(box).height).toBe(line);
        expect(hosts(box, () => true).map(node => flat(node))).toEqual([
          expect.objectContaining({ height: 12, backgroundColor: T.surface2 }),
        ]);
      }
      expect(screen.queryByTestId(`shelf-caption-${i}-line-2`)).toBeNull();
      expect(screen.queryByTestId(`shelf-caption-${i}-marks`)).toBeNull();
    }
  });

  /** The device the skeleton is drawn on: its font scale and pixel ratio. */
  function onDevice(fontScale: number, scale: number) {
    const window = Dimensions.get('window');
    jest.spyOn(Dimensions, 'get').mockReturnValue({ ...window, fontScale, scale });
  }

  /** What a real cover card takes under its cover, from its own styles. */
  function realCaptionHeight(titleLines: number, marks: boolean, fontScale: number, scale: number): number {
    const view = renderWithProviders(
      <CoverCard story={{ id: 'a' }} title="Keloğlan ile Altın Başaklar" width={100} titleLines={titleLines} testID="card">
        {marks ? (
          <CoverMeta>
            <Icon name="lock" size={16} color={themes.kitaplik.text2} />
          </CoverMeta>
        ) : null}
      </CoverCard>,
      { theme: 'kitaplik' },
    );
    const title = flat(screen.getByText('Keloğlan ile Altın Başaklar'));
    const lines = screen.getByText('Keloğlan ile Altın Başaklar').props.numberOfLines as number;
    let height = title.marginTop + lines * textLineBox(title.lineHeight, fontScale, scale);
    if (marks) {
      const meta = screen.getByTestId('card-meta');
      height += flat(meta).marginTop + flat(screen.getByTestId('icon-lock', { includeHiddenElements: true })).height;
    }
    view.unmount();
    return height;
  }

  it.each([
    [1, 2.625, false],
    [1, 2.625, true],
    [1.3, 2.625, false],
    [2, 2, true],
  ])('at font scale %s and %sx the caption block is as tall as the real card (marks: %s)', (fontScale, scale, marks) => {
    onDevice(fontScale, scale);
    const real = realCaptionHeight(2, marks, fontScale, scale);
    renderWithProviders(<ShelfSkeleton coverWidth={100} coverHeight={146} covers={1} marks={marks} testID="shelf" />, {
      theme: 'kitaplik',
    });
    const caption = flat(screen.getByTestId('shelf-caption-0'));
    expect(caption.marginTop + caption.height).toBeCloseTo(real, 6);
    expect(caption.marginTop + caption.height).toBeCloseTo(
      coverCardCaptionHeight({ titleLines: 2, marks, fontScale, pixelRatio: scale }),
      6,
    );
    // Each line box is a whole number of device pixels, like the platform's lines.
    const line = flat(screen.getByTestId('shelf-caption-0-line-0')).height;
    expect(Number.isInteger(Math.round(line * scale * 1e6) / 1e6)).toBe(true);
    if (marks) {
      expect(flat(screen.getByTestId('shelf-caption-0-marks'))).toMatchObject({ marginTop: 2, height: 16 });
    } else {
      expect(screen.queryByTestId('shelf-caption-0-marks')).toBeNull();
    }
  });

  it('reserves as many title lines as it is given', () => {
    const { fontScale, scale } = Dimensions.get('window');
    renderWithProviders(<ShelfSkeleton coverWidth={100} coverHeight={146} covers={1} titleLines={3} testID="shelf" />);
    expect(screen.getByTestId('shelf-caption-0-line-2')).toBeTruthy();
    expect(flat(screen.getByTestId('shelf-caption-0')).height).toBe(
      3 * textLineBox(COVER_CARD_TITLE_LINE, fontScale, scale),
    );
  });

  it('the Keşfet grid skeleton covers have the corners and lips of the real covers', () => {
    renderWithProviders(<StoryGridSkeleton rows={2} testID="grid" />, { theme: 'kitaplik' });
    const { columns, cardWidth } = storyGridLayout(Dimensions.get('window').width - T.screenPadH * 2);
    const grid = screen.getByTestId('grid');
    const faces = grid.findAll(
      (node: TestNode) => typeof node.type === 'string' && flat(node).height === Math.round(cardWidth * 1.5),
    );
    expect(faces).toHaveLength(columns * 2);
    for (const face of faces) {
      // The real grid cover (`CoverCard` at this width), not a near miss.
      expect(flat(face)).toMatchObject({ borderRadius: coverRadius(cardWidth, 'upright'), backgroundColor: T.surface });
      let lipBox = face.parent;
      while (lipBox && typeof lipBox.type !== 'string') lipBox = lipBox.parent;
      expect(flat(lipBox as TestNode).paddingBottom).toBe(coverLip(cardWidth));
    }
  });
});

describe('LoadingLine', () => {
  it('is a busy spinner line; a column stacks the spinner over the label', () => {
    const view = renderWithProviders(<LoadingLine testID="line" />);
    expect(flat(screen.getByTestId('line'))).toMatchObject({ minHeight: 48, flexDirection: 'row' });
    expect(screen.getByText('Yükleniyor...')).toBeOnTheScreen();
    expect(screen.getByTestId('line').props.accessibilityState).toEqual({ busy: true });
    view.unmount();
    renderWithProviders(<LoadingLine testID="line" label="Belge yükleniyor..." direction="column" />);
    expect(flat(screen.getByTestId('line'))).toMatchObject({ flexDirection: 'column', alignItems: 'center' });
    expect(screen.getByLabelText('Belge yükleniyor...')).toBeTruthy();
  });
});
