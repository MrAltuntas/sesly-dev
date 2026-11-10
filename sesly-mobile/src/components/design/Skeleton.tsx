/**
 * Skeletons: the loading state of the playful design.
 *
 * Content that is on its way is drawn as quiet shapes of the content
 * itself (a cover, a row, a card), in the surface colour on the canvas, so
 * nothing jumps when the real thing arrives and nothing darkens the screen.
 * A `SkeletonPulse` breathes its children's opacity on the native driver and
 * tells a screen reader the block is loading. Every pulse on screen breathes
 * with one shared value, so the blocks of a screen move in step; the block
 * is drawn into one texture first, so the lips never show through the faces
 * while it fades. It stays still when the system asks for reduced motion.
 *
 *   <SkeletonPulse testID="library-loading">
 *     <RowSkeleton />
 *     <RowSkeleton />
 *   </SkeletonPulse>
 *
 * The first real content after a skeleton fades in once (`FadeIn`), the fade
 * started in the commit that mounts it. Where the skeleton and the content
 * share one slot, `SkeletonSwap` keeps the skeleton under the content and
 * cross-fades the two in place, so no frame is empty and the slot keeps its
 * height while it fades:
 *
 *   <SkeletonSwap loading={!loaded} skeleton={<HomeSkeleton />}>
 *     <Content />
 *   </SkeletonSwap>
 *
 * Where no shape makes sense (a sheet that fetches one value), use
 * `LoadingLine`: the platform spinner with a short label.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Animated,
  DimensionValue,
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { LIP, RADIUS, Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { DURATION, EASE, useReducedMotion } from '../../theme/motion';
import { Spinner } from './feedback';
import {
  COVER_CARD_MARKS_HEIGHT,
  COVER_CARD_META_GAP,
  COVER_CARD_TITLE_GAP,
  COVER_CARD_TITLE_LINE,
  coverCardCaptionHeight,
  coverLip,
  coverRadius,
  textLineBox,
} from './PictureCover';

// ─────────────────────────────────────────────────────────────
// The shared pulse
// ─────────────────────────────────────────────────────────────

/** Lowest opacity of a breath; text bones on the canvas stay visible at it. */
export const SKELETON_PULSE_FLOOR = 0.7;

/** The value every `SkeletonPulse` breathes with (1 at rest). */
const pulse = new Animated.Value(1);
let holders = 0;
let loop: Animated.CompositeAnimation | null = null;
let startFrame: number | null = null;

function startPulse(): void {
  startFrame = null;
  const half = DURATION.pulse / 2;
  loop = Animated.loop(
    Animated.sequence([
      Animated.timing(pulse, {
        toValue: SKELETON_PULSE_FLOOR,
        duration: half,
        easing: EASE.symmetric,
        useNativeDriver: true,
      }),
      Animated.timing(pulse, { toValue: 1, duration: half, easing: EASE.symmetric, useNativeDriver: true }),
    ]),
  );
  loop.start();
}

/**
 * One more skeleton on screen; returns its release. The loop starts with the
 * first one and stops with the last one. It starts a frame after the first
 * mount: that first frame is drawn still, and by the next one the system's
 * reduced-motion answer is in, so a skeleton that has to stay still lets go
 * before anything moved.
 */
function holdPulse(): () => void {
  holders += 1;
  if (holders === 1) startFrame = requestAnimationFrame(startPulse);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holders -= 1;
    if (holders > 0) return;
    if (startFrame !== null) cancelAnimationFrame(startFrame);
    startFrame = null;
    loop?.stop();
    loop = null;
    pulse.setValue(1);
  };
}

export interface SkeletonPulseProps {
  /** Screen reader label; default "Yükleniyor...". */
  label?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export const SkeletonPulse: React.FC<SkeletonPulseProps> = ({ label, testID, style, children }) => {
  const { t } = useTranslation('common');
  const reduced = useReducedMotion();
  useEffect(() => (reduced ? undefined : holdPulse()), [reduced]);
  return (
    <Animated.View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t('loading')}
      accessibilityState={{ busy: true }}
      // The shapes are static: drawn once into a layer and faded as one
      // picture, instead of each face and its lip at the pulse's alpha.
      renderToHardwareTextureAndroid
      shouldRasterizeIOS
      style={[{ opacity: reduced ? 1 : pulse }, style]}
    >
      {children}
    </Animated.View>
  );
};

// ─────────────────────────────────────────────────────────────
// FadeIn: the first real content after a skeleton
// ─────────────────────────────────────────────────────────────

export interface FadeInProps {
  /** Show the content at once (it was on screen before, e.g. from a cache). */
  skip?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/** The one fade of the first content: `DURATION.enter`, the standard curve, native driver. */
function enterFade(value: Animated.Value): Animated.CompositeAnimation {
  return Animated.timing(value, {
    toValue: 1,
    duration: DURATION.enter,
    easing: EASE.standard,
    useNativeDriver: true,
  });
}

/**
 * Wraps the first real content that replaces a skeleton: it fades in once
 * (`enterFade`), and later renders never fade it again. The fade starts in
 * the commit that mounts the content (a layout effect), so it is handed to
 * the native driver with the mount: a JS thread still busy drawing the rest
 * of the screen never holds the content at opacity 0 (LA-2, the blank Home
 * after sign-in). Under reduced motion the content is at full opacity as
 * soon as the system's answer is in.
 */
export const FadeIn: React.FC<FadeInProps> = ({ skip, testID, style, children }) => {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(skip ? 1 : 0)).current;
  const shown = useRef(!!skip);
  const fade = useRef<Animated.CompositeAnimation | null>(null);
  useLayoutEffect(() => {
    if (shown.current) return undefined;
    const animation = enterFade(opacity);
    fade.current = animation;
    animation.start(({ finished }) => {
      if (finished) shown.current = true;
    });
    return () => animation.stop();
  }, [opacity]);
  useEffect(() => {
    if (!reduced || shown.current) return;
    fade.current?.stop();
    opacity.stopAnimation();
    opacity.setValue(1);
    shown.current = true;
  }, [opacity, reduced]);
  return (
    <Animated.View
      testID={testID}
      // While it fades, the content is composited as one layer (no lip
      // shows through a face); at full opacity this costs nothing.
      needsOffscreenAlphaCompositing
      style={[{ opacity }, style]}
    >
      {children}
    </Animated.View>
  );
};

// ─────────────────────────────────────────────────────────────
// SkeletonSwap: the skeleton and its content in one slot, cross-faded
// ─────────────────────────────────────────────────────────────

/** What a `SkeletonSwap` draws: the skeleton, both while they cross-fade, then the content. */
export type SkeletonSwapPhase = 'skeleton' | 'fading' | 'content';

export interface SkeletonSwapProps {
  /** The content is on its way: the skeleton holds the slot. */
  loading: boolean;
  /** The skeleton in the content's shape (a `SkeletonPulse` block). */
  skeleton: React.ReactNode;
  /** Show the content at once when it replaces the skeleton (no cross-fade). */
  skip?: boolean;
  /** The slot. Margins only: the skeleton is laid at its top left corner while it fades. */
  style?: StyleProp<ViewStyle>;
  /** The slot's test id; the content wrapper is `${testID}-content` unless `contentTestID` names it. */
  testID?: string;
  contentTestID?: string;
  /** The content, rendered once `loading` is false. */
  children?: React.ReactNode;
}

/**
 * One slot that holds a skeleton until its content is there, then
 * cross-fades the two in place (`enterFade` on one value: the content from 0
 * to 1 over the skeleton, the skeleton from 1 to 0, both on the native
 * driver). The fade starts in the commit that mounts the content, and the
 * skeleton stays mounted until it has ended, at full opacity until the fade
 * moves: whatever keeps the JS thread busy, every frame shows the skeleton,
 * the content or both, never an empty slot (LA-2). While they fade
 * the slot keeps at least the skeleton's height, so nothing under it moves
 * (V5-03). The skeleton takes no touches and is hidden from screen readers
 * once the content is there. Under reduced motion, and with `skip`, the
 * content replaces the skeleton at once.
 */
export const SkeletonSwap: React.FC<SkeletonSwapProps> = ({
  loading,
  skeleton,
  skip = false,
  style,
  testID,
  contentTestID,
  children,
}) => {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<SkeletonSwapPhase>(loading ? 'skeleton' : 'content');
  // The skeleton's height, held by the slot while the content fades in.
  const [skeletonHeight, setSkeletonHeight] = useState(0);
  // 0 to 1 while they cross-fade; the opacities are bound to it only then.
  const progress = useRef(new Animated.Value(0)).current;
  const [skeletonOpacity] = useState(() => progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }));

  // Derived while rendering, so no commit ever draws a phase that is out of
  // date (React renders again at once, before anything is committed).
  let next = phase;
  if (loading) next = 'skeleton';
  else if (phase === 'skeleton') next = skip || reduced ? 'content' : 'fading';
  else if (phase === 'fading' && reduced) next = 'content';
  if (next !== phase) setPhase(next);

  useLayoutEffect(() => {
    if (phase !== 'fading') {
      // Outside the fade both opacities are fixed (1): only the next fade
      // reads the value, and it starts from 0.
      progress.stopAnimation();
      if (phase === 'skeleton') progress.setValue(0);
      return undefined;
    }
    // In the commit that mounts the content: no frame waits for the JS thread.
    const fade = enterFade(progress);
    fade.start(({ finished }) => {
      if (finished) setPhase(current => (current === 'fading' ? 'content' : current));
    });
    return () => fade.stop();
  }, [phase, progress]);

  const onSkeletonLayout = (event: LayoutChangeEvent) => {
    const height = Math.round(event.nativeEvent.layout.height);
    setSkeletonHeight(current => (current === height ? current : height));
  };

  const fading = phase === 'fading';
  return (
    <View testID={testID} style={[style, fading && skeletonHeight > 0 ? { minHeight: skeletonHeight } : null]}>
      {phase !== 'content' ? (
        <Animated.View
          pointerEvents={fading ? 'none' : 'auto'}
          importantForAccessibility={fading ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={fading}
          onLayout={fading ? undefined : onSkeletonLayout}
          testID={testID ? `${testID}-skeleton` : undefined}
          style={fading ? [swapStyles.under, { opacity: skeletonOpacity }] : swapStyles.shown}
        >
          {skeleton}
        </Animated.View>
      ) : null}
      {phase !== 'skeleton' ? (
        <Animated.View
          testID={contentTestID ?? (testID ? `${testID}-content` : undefined)}
          // Composited as one layer while it fades (no lip shows through a face).
          needsOffscreenAlphaCompositing={fading}
          style={fading ? { opacity: progress } : swapStyles.shown}
        >
          {children}
        </Animated.View>
      ) : null}
    </View>
  );
};

const swapStyles = StyleSheet.create({
  shown: { opacity: 1 },
  // The skeleton at the slot's top, under the content fading in over it.
  under: { position: 'absolute', left: 0, right: 0, top: 0 },
});

// ─────────────────────────────────────────────────────────────
// Shapes
// ─────────────────────────────────────────────────────────────

export type BoneTone = 'surface' | 'text' | 'line' | 'raised';

/** The colour of a bone tone. */
export function boneColor(T: Theme, tone: BoneTone): string {
  if (tone === 'line') return T.line;
  if (tone === 'raised' || tone === 'text') return T.surface2;
  return T.surface;
}

export interface BoneProps {
  width?: DimensionValue;
  height: number;
  radius?: number;
  /**
   * 'surface' on the canvas (default: cards, covers and buttons on their
   * lip, in the real card's colour), 'text' for lip-less text lines on the
   * canvas (one step lighter, so they stay visible at the pulse's floor),
   * 'line' on a card, 'raised' in a sheet.
   */
  tone?: BoneTone;
  /** Draw the darker lip under the shape (cards, covers, buttons). */
  lip?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/** One shape. With `lip` it sits on the same lip as the card it stands for. */
export const Bone: React.FC<BoneProps> = ({
  width,
  height,
  radius = RADIUS.xs,
  tone = 'surface',
  lip = 0,
  style,
  children,
}) => {
  const T = useT();
  const color = boneColor(T, tone);
  if (!lip) {
    return <View style={[{ width, height, borderRadius: radius, backgroundColor: color }, style]}>{children}</View>;
  }
  return (
    <View style={[{ width, paddingBottom: lip }, style]}>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: lip,
          bottom: 0,
          borderRadius: radius,
          backgroundColor: T.lip,
        }}
      />
      <View style={{ height, borderRadius: radius, backgroundColor: color }}>{children}</View>
    </View>
  );
};

/** Text lines: a title line and a shorter meta line ('line' on a card, 'text' on the canvas). */
export const TextBones: React.FC<{
  lines?: number;
  tone?: 'surface' | 'text' | 'line';
  style?: StyleProp<ViewStyle>;
}> = ({ lines = 2, tone = 'line', style }) => {
  const styles = stylesFor(useT());
  return (
    <View style={[styles.textBones, style]}>
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} tone={tone} height={i === 0 ? 13 : 10} width={i === 0 ? '62%' : '40%'} radius={RADIUS.xs} />
      ))}
    </View>
  );
};

/** Edge of the round trailing button of a row skeleton. */
const ROW_TRAILING = 42;
/** The 2:3 leading picture of a row skeleton. */
const ROW_COVER_WIDTH = 40;

/**
 * A row card: a leading tile, two text lines and a round trailing button
 * (narrator rows, library rows, notification rows, playlist rows).
 */
export const RowSkeleton: React.FC<{
  height?: number;
  radius?: number;
  lip?: number;
  /** Leading tile: 'square' (avatar, thumbnail), 'cover' (2:3 picture), none. */
  leading?: 'square' | 'cover' | 'none';
  /** Edge and radius of a square leading tile (46 / 16: a narrator avatar). */
  leadingSize?: number;
  leadingRadius?: number;
  trailing?: boolean;
  /** 'raised' inside a sheet, whose own colour is the surface. */
  tone?: 'surface' | 'raised';
  style?: StyleProp<ViewStyle>;
}> = ({
  tone = 'surface',
  // A row card (SheetRow): 46 + 24 tall, the row radius and lip.
  height = 70,
  radius = RADIUS.lg,
  lip = LIP.md,
  leading = 'square',
  leadingSize = 46,
  leadingRadius = RADIUS.md,
  trailing = true,
  style,
}) => {
  const styles = stylesFor(useT());
  return (
    <Bone height={height} radius={radius} lip={lip} tone={tone} style={style}>
      <View style={[styles.row, { minHeight: height }]}>
        {leading === 'square' ? (
          <Bone tone="line" width={leadingSize} height={leadingSize} radius={leadingRadius} />
        ) : null}
        {leading === 'cover' ? (
          <Bone
            tone="line"
            width={ROW_COVER_WIDTH}
            height={Math.round(ROW_COVER_WIDTH * 1.4)}
            radius={coverRadius(ROW_COVER_WIDTH, 'upright')}
          />
        ) : null}
        <TextBones style={styles.rowText} />
        {trailing ? <Bone tone="line" width={ROW_TRAILING} height={ROW_TRAILING} radius={ROW_TRAILING / 2} /> : null}
      </View>
    </Bone>
  );
};

/** Height of a text bone inside its line box (a caption line, a mark). */
const CAPTION_BONE = 12;
/** Widths of the caption lines: the last line of a title runs shorter. */
const CAPTION_LINE_WIDTH: DimensionValue = '90%';
const CAPTION_LAST_LINE_WIDTH: DimensionValue = '60%';
/** The mark bone of the meta row (one or two 16dp icons). */
const CAPTION_MARK_WIDTH = 28;

export interface ShelfSkeletonProps {
  coverWidth: number;
  coverHeight: number;
  covers?: number;
  /** Lines the real titles reserve (Home shelves: 2). */
  titleLines?: number;
  /** The real shelf has a meta row of marks under its titles. */
  marks?: boolean;
  testID?: string;
}

/**
 * A shelf (Home): the heading in a box of the real heading's line height,
 * then 12 below it the covers side by side on their lips, each with the
 * caption block of the real card under it (`coverCardCaptionHeight`): a
 * bone per title line in a box of the real line height, and the meta row's
 * bone with `marks`. At every font scale the skeleton is as tall as the
 * shelf it stands for, so the heading after it lands where the real one
 * does.
 */
export const ShelfSkeleton: React.FC<ShelfSkeletonProps> = ({
  coverWidth,
  coverHeight,
  covers = 3,
  titleLines = 2,
  marks = false,
  testID,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const { fontScale, scale } = useWindowDimensions();
  const headingBox = textLineBox(textStylesFor(T).heading.lineHeight ?? 0, fontScale, scale);
  const lineBox = textLineBox(COVER_CARD_TITLE_LINE, fontScale, scale);
  const captionHeight = coverCardCaptionHeight({ titleLines, marks, fontScale, pixelRatio: scale });
  return (
    <View testID={testID}>
      <View testID={testID ? `${testID}-heading` : undefined} style={[styles.shelfHeading, { height: headingBox }]}>
        <Bone tone="text" width={150} height={20} radius={RADIUS.xs} />
      </View>
      <View style={styles.shelfCovers}>
        {Array.from({ length: covers }, (_, i) => (
          <View key={i} style={{ width: coverWidth }}>
            <Bone
              width={coverWidth}
              height={coverHeight}
              radius={coverRadius(coverWidth, 'upright')}
              lip={coverLip(coverWidth)}
            />
            <View
              testID={testID ? `${testID}-caption-${i}` : undefined}
              style={[styles.shelfCaption, { height: captionHeight - COVER_CARD_TITLE_GAP }]}
            >
              {Array.from({ length: titleLines }, (_, line) => (
                <View
                  key={line}
                  testID={testID ? `${testID}-caption-${i}-line-${line}` : undefined}
                  style={[styles.captionLine, { height: lineBox }]}
                >
                  <Bone
                    tone="text"
                    height={CAPTION_BONE}
                    width={line === titleLines - 1 ? CAPTION_LAST_LINE_WIDTH : CAPTION_LINE_WIDTH}
                    radius={RADIUS.xs}
                  />
                </View>
              ))}
              {marks ? (
                <View testID={testID ? `${testID}-caption-${i}-marks` : undefined} style={styles.captionMarks}>
                  <Bone tone="text" height={CAPTION_BONE} width={CAPTION_MARK_WIDTH} radius={RADIUS.xs} />
                </View>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// LoadingLine
// ─────────────────────────────────────────────────────────────

export interface LoadingLineProps {
  label?: string;
  /** 'row': the spinner before the label (default); 'column': above it, centred (a full screen or sheet). */
  direction?: 'row' | 'column';
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** The platform spinner with a short line, for loads no shape stands for. */
export const LoadingLine: React.FC<LoadingLineProps> = ({ label, direction = 'row', testID, style }) => {
  const T = useT();
  const styles = stylesFor(T);
  const { t } = useTranslation('common');
  const line = label ?? t('loading');
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={line}
      accessibilityState={{ busy: true }}
      style={[styles.loadingLine, direction === 'column' ? styles.loadingColumn : null, style]}
    >
      <Spinner color={T.text2} />
      <Text style={[textStylesFor(T).meta, direction === 'column' ? styles.loadingColumnText : null]}>{line}</Text>
    </View>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    textBones: { gap: T.space.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: T.space.md,
      paddingHorizontal: T.space.md,
    },
    rowText: { flex: 1, minWidth: 0 },
    shelfHeading: { marginHorizontal: T.screenPadH, justifyContent: 'center' },
    shelfCovers: {
      flexDirection: 'row',
      gap: T.space.md,
      marginTop: T.space.md,
      paddingHorizontal: T.screenPadH,
      overflow: 'hidden',
    },
    // The caption block of the real card: 8 under the cover, line boxes, then the marks 2 lower.
    shelfCaption: { marginTop: COVER_CARD_TITLE_GAP },
    captionLine: { justifyContent: 'center' },
    captionMarks: {
      marginTop: COVER_CARD_META_GAP,
      height: COVER_CARD_MARKS_HEIGHT,
      justifyContent: 'center',
    },
    loadingLine: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: T.space.sm,
      minHeight: T.touch,
    },
    loadingColumn: { flexDirection: 'column', gap: T.space.md },
    loadingColumnText: { textAlign: 'center' },
  });

const stylesFor = themedStyles(makeStyles);
