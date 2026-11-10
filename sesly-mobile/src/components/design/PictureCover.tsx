/**
 * PictureCover: the story cover of the playful design (`.cv`).
 *
 * The picture fills a rounded card (20 to 32dp corners) that sits on its
 * lip, with a 1dp ring one step lighter than the surface so the night-blue
 * art does not melt into the canvas (`--cover-ring`; none in orijinal).
 * Covers carry their own small badges: the duration as a glass chip at the
 * bottom left (`.dur`), the AI translation mark (the sparkles) on the same
 * glass at the bottom right, the language level at the top left (`.lvl`)
 * and, for a story the plan does not play, a lock on glass at the top
 * right: 22dp pills 6dp in from the edges. The title is never drawn on the picture; it
 * sits under the cover (`CoverCard`) or next to it.
 *
 * A story with its own image shows only the plain backdrop while the image
 * loads, then the image fades in; the placeholder illustration is drawn only
 * for a story without an image or when its image fails, so a cover never
 * shows an unrelated picture first.
 *
 * - upright: 2:3 by default (shelves, grid, detail, player artwork).
 * - square: the upper part of the picture (mini player, list rows).
 * - wide: a given height (the home hero).
 */

import React, { useMemo, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { LIP, SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { DURATION, PRESS_DELAY_MS } from '../../theme/motion';
import { CoverSubject, assignCoverIndices, resolveCover } from './covers';
import {
  COVER_MARK_HEIGHT,
  MarkLabelProvider,
  TranslationBadge,
  TranslationKind,
  useMarkLabels,
} from './storyMarks';
import { Icon } from './Icon';
import { usePressSink } from './Tactile';

/** Height of the level and duration pills (and the marks) on a cover. */
const COVER_BADGE_HEIGHT = COVER_MARK_HEIGHT;
/** The pills keep their 22dp at large font sizes (the box grows, never clips). */
const COVER_BADGE_MAX_FONT_SCALE = 1.3;
/** The category dot of `CoverMeta`. */
const META_DOT = 9;

/** Default corner radius for a cover of this width and shape. */
export function coverRadius(width: number, shape: 'upright' | 'square' | 'wide'): number {
  if (shape === 'square') return Math.max(8, Math.round(width * 0.3));
  if (shape === 'wide') return 28;
  if (width >= 200) return 32;
  if (width >= 130) return 24;
  if (width >= 96) return 20;
  return Math.max(10, Math.round(width * 0.19));
}

/**
 * Lip under a cover of this width: 4 for covers 130dp and wider (the hero,
 * the detail and the player art), 3 for shelf and grid covers.
 */
export function coverLip(width: number): number {
  return width >= 130 ? LIP.lg : LIP.md;
}

// ─────────────────────────────────────────────────────────────
// CoverCard geometry: one source for the card, the lists that hold it
// and the skeletons that stand for it
// ─────────────────────────────────────────────────────────────

/** From the cover to the title under it (`cardTitle` margin). */
export const COVER_CARD_TITLE_GAP = SPACE.sm;
/** Line height of a cover card title (Nunito 800 13.5). */
export const COVER_CARD_TITLE_LINE = 18;
/** From the title to the meta row (`cardMeta` margin). */
export const COVER_CARD_META_GAP = SPACE.xxs;
/** A meta row of marks only (the lock, the translation icon): 16dp icons. */
export const COVER_CARD_MARKS_HEIGHT = 16;

/**
 * The height a line of text takes on screen: its line height at the system
 * font scale, rounded up to whole device pixels as the platform draws it
 * (Android makes every line ceil(lineHeight px) tall: an 18dp line is 48px,
 * 18.29dp, at 2.625x).
 */
export function textLineBox(lineHeight: number, fontScale = 1, pixelRatio = 1): number {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  // The epsilon keeps a whole number of pixels (72.0000001) from gaining one.
  return Math.ceil(lineHeight * scale * ratio - 1e-6) / ratio;
}

export interface CoverCardMetrics {
  /** Lines the title may take (default 3, as `CoverCard`). */
  titleLines?: number;
  /** A meta row of marks under the title (lock, translation icon). */
  marks?: boolean;
  /** The system font scale and the device pixel ratio (`useWindowDimensions`). */
  fontScale?: number;
  pixelRatio?: number;
}

/**
 * Everything of a cover card under its cover: the gap, `titleLines` lines
 * of the title and, with `marks`, the meta row. A list that reserves this
 * never grows when a longer title or a mark scrolls in.
 */
export function coverCardCaptionHeight({
  titleLines = 3,
  marks = false,
  fontScale,
  pixelRatio,
}: CoverCardMetrics = {}): number {
  return (
    COVER_CARD_TITLE_GAP +
    titleLines * textLineBox(COVER_CARD_TITLE_LINE, fontScale, pixelRatio) +
    (marks ? COVER_CARD_META_GAP + COVER_CARD_MARKS_HEIGHT : 0)
  );
}

/** The tallest a cover card can be: cover, lip and caption (`coverCardCaptionHeight`). */
export function coverCardHeight({
  width,
  coverHeight,
  ...caption
}: CoverCardMetrics & { width: number; coverHeight?: number }): number {
  const face = coverHeight ?? Math.round(width * 1.5);
  return face + coverLip(width) + coverCardCaptionHeight(caption);
}

export interface PictureCoverProps {
  /** Story identity, optional remote cover and category. */
  story: CoverSubject;
  /**
   * Title for the accessibility label ("Uykulu Ay kapağı"). Not drawn.
   * Without one the cover is decoration (inside a card button that names
   * the story) and no screen reader stop.
   */
  title?: string;
  width: number;
  /** Height of a 'wide' cover; others derive it from the width. */
  height?: number;
  shape?: 'upright' | 'square' | 'wide';
  radius?: number;
  /**
   * Placeholder picture chosen by the list this cover is in (see
   * `useCoverSpread`). Without one the tale shows its picture of the
   * session, the one its shelves show.
   */
  placeholderIndex?: number;
  /** No lip and no ring (inside another card, the mini player). */
  flat?: boolean;
  /** Duration chip at the bottom left ("5 dk"). */
  durationLabel?: string;
  /** Level badge at the top left ("A2"). */
  levelLabel?: string;
  /**
   * The translation mark at the bottom right, on glass
   * (`getStoryTranslationKind`: only an AI translation has one). Inside a
   * card button it is read as part of the card's label.
   */
  translation?: TranslationKind | null;
  /**
   * A lock on glass at the top right: a premium story the plan does not
   * play. Decoration: the card's label says it.
   */
  locked?: boolean;
  /** Which part of the picture shows. Default 'top' (the subject is high). */
  focus?: 'top' | 'center';
  /** Offset of the picture while its card is pressed (CoverCard). */
  sink?: Animated.AnimatedInterpolation<number>;
  /** Drawn on the picture, clipped to its corners. */
  children?: React.ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const PictureCover: React.FC<PictureCoverProps> = ({
  story,
  title,
  width,
  height: givenHeight,
  shape = 'upright',
  radius,
  placeholderIndex,
  flat,
  durationLabel,
  levelLabel,
  translation,
  locked,
  focus = 'top',
  sink,
  children,
  testID,
  style,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const { t } = useTranslation('story');
  const height =
    shape === 'square' ? width : shape === 'wide' ? givenHeight ?? Math.round(width * 0.56) : givenHeight ?? Math.round(width * 1.5);
  const corner = radius ?? coverRadius(width, shape);
  const lip = flat ? 0 : coverLip(width);
  const cover = useMemo(
    () => resolveCover(story, placeholderIndex),
    [story.id, story.translationGroupId, story.coverImageUrl, placeholderIndex], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // The address that failed; a new address (a re-signed URL) tries again.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const remoteFailed = cover.kind === 'remote' && failedUri === cover.uri;
  const showRemote = cover.kind === 'remote' && !remoteFailed;
  const showPlaceholder = cover.kind === 'placeholder' || remoteFailed;
  const placeholder = cover.kind === 'remote' ? cover.fallback : cover.source;
  const position = focus === 'top' ? 'top' : 'center';
  const decorative = !title;

  return (
    <View
      testID={testID}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : t('coverOf', { title })}
      style={[{ width, height: height + lip }, style]}
    >
      {lip > 0 ? (
        <View
          testID={testID ? `${testID}-lip` : 'cover-lip'}
          style={[styles.layer, { top: lip, height, borderRadius: corner, backgroundColor: T.lip }]}
        />
      ) : null}
      <Animated.View
        testID={testID ? `${testID}-picture` : undefined}
        style={[
          styles.layer,
          styles.picture,
          {
            height,
            borderRadius: corner,
            transform: sink ? [{ translateY: sink }] : undefined,
          },
        ]}
      >
        {showPlaceholder ? (
          <ExpoImage
            testID={`cover-placeholder-${cover.placeholderIndex + 1}`}
            source={placeholder}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition={position}
          />
        ) : null}
        {showRemote && cover.kind === 'remote' ? (
          <ExpoImage
            testID="cover-remote"
            source={{ uri: cover.uri, cacheKey: cover.cacheKey }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition={position}
            transition={DURATION.base}
            cachePolicy="memory-disk"
            onError={() => setFailedUri(cover.uri)}
          />
        ) : null}
        {children}
        {levelLabel ? (
          <View style={styles.level} testID="cover-level">
            <Text style={styles.levelText} maxFontSizeMultiplier={COVER_BADGE_MAX_FONT_SCALE}>
              {levelLabel}
            </Text>
          </View>
        ) : null}
        {durationLabel ? (
          <View style={styles.duration} testID="cover-duration">
            <Text style={styles.durationText} maxFontSizeMultiplier={COVER_BADGE_MAX_FONT_SCALE}>
              {durationLabel}
            </Text>
          </View>
        ) : null}
        {translation ? (
          <View style={styles.mark} testID="cover-translation">
            <TranslationBadge kind={translation} iconOnly glass />
          </View>
        ) : null}
        {locked ? (
          <View style={styles.lock} testID="cover-lock" importantForAccessibility="no-hide-descendants">
            <Icon name="lock" size={16} color={T.text} />
          </View>
        ) : null}
        {flat ? null : (
          <View
            pointerEvents="none"
            testID="cover-ring"
            style={[StyleSheet.absoluteFill, { borderRadius: corner, borderWidth: T.hairline, borderColor: T.coverRing }]}
          />
        )}
      </Animated.View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// Spread: no two neighbours with the same placeholder picture
// ─────────────────────────────────────────────────────────────

/**
 * Placeholder picture for each story of a shelf or list, in display order,
 * keyed by story id. Pass `spread.get(story.id)` as `placeholderIndex`. A
 * tale keeps the picture it got first for the whole session (`assignSpread`),
 * so it looks the same on every shelf and on its detail.
 */
export function useCoverSpread(
  stories: readonly Pick<CoverSubject, 'id' | 'translationGroupId'>[],
): Map<string, number> {
  const signature = stories.map(story => `${story.id}:${story.translationGroupId ?? ''}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => assignCoverIndices(stories), [signature]);
}

// ─────────────────────────────────────────────────────────────
// CoverCard: a cover with its title and meta under it (shelves, grid)
// ─────────────────────────────────────────────────────────────

export interface CoverCardProps {
  story: CoverSubject;
  title: string;
  /** Width of the cover (and the card). */
  width: number;
  /** Cover height; default 2:3. */
  coverHeight?: number;
  placeholderIndex?: number;
  durationLabel?: string;
  levelLabel?: string;
  /** The translation mark on the cover (`PictureCover.translation`). */
  translation?: TranslationKind | null;
  /** The lock on the cover (`PictureCover.locked`). */
  locked?: boolean;
  /** Lines the title may take (default 3, as the mockup lets titles run). */
  titleLines?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  /**
   * The card's label for a screen reader (default the title). The marks in
   * the meta row (translation, language codes) are read after it.
   */
  accessibilityLabel?: string;
  /**
   * Drawn over the cover (the bookmark), positioned inside the cover's box.
   * It is a sibling of the card button, so it keeps its own touches and its
   * own screen reader stop, and it sinks with the cover.
   */
  overlay?: React.ReactNode;
  /** Wait before the sink starts (default `PRESS_DELAY_MS`: covers sit in scrolling lists). */
  pressDelay?: number;
  /** The meta row under the title (category dot and duration, badges). */
  children?: React.ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const CoverCard: React.FC<CoverCardProps> = ({
  story,
  title,
  width,
  coverHeight,
  placeholderIndex,
  durationLabel,
  levelLabel,
  translation,
  locked,
  titleLines = 3,
  onPress,
  onLongPress,
  accessibilityLabel,
  overlay,
  pressDelay = PRESS_DELAY_MS,
  children,
  testID,
  style,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const interactive = !!(onPress || onLongPress);
  const { translateY, onPressIn, onPressOut } = usePressSink(coverLip(width), interactive);
  const { sink: markSink, words: markWords } = useMarkLabels();
  const faceHeight = coverHeight ?? Math.round(width * 1.5);
  const body = (
    <>
      <PictureCover
        story={story}
        width={width}
        height={coverHeight}
        placeholderIndex={placeholderIndex}
        durationLabel={durationLabel}
        levelLabel={levelLabel}
        translation={translation}
        locked={locked}
        sink={interactive ? translateY : undefined}
        testID={testID ? `${testID}-cover` : undefined}
      />
      <Text numberOfLines={titleLines} style={styles.cardTitle}>
        {title}
      </Text>
      {children ? (
        <View testID={testID ? `${testID}-meta` : undefined} style={styles.cardMeta}>
          {children}
        </View>
      ) : null}
    </>
  );
  // Over the cover's face (not its lip), moving with it.
  const overlayLayer = overlay ? (
    <Animated.View
      pointerEvents="box-none"
      testID={testID ? `${testID}-overlay` : 'cover-card-overlay'}
      style={[
        styles.overlay,
        { width, height: faceHeight, transform: interactive ? [{ translateY }] : undefined },
      ]}
    >
      {overlay}
    </Animated.View>
  ) : null;

  if (!interactive) {
    return (
      <View testID={testID} style={[{ width }, style]}>
        {body}
        {overlayLayer}
      </View>
    );
  }
  const card = (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      unstable_pressDelay={pressDelay}
      accessibilityRole="button"
      accessibilityLabel={[accessibilityLabel ?? title, ...markWords].join(', ')}
      testID={testID}
      style={overlay ? { width } : [{ width }, style]}
    >
      <MarkLabelProvider value={markSink}>{body}</MarkLabelProvider>
    </Pressable>
  );
  if (!overlayLayer) return card;
  return (
    <View style={[{ width }, style]}>
      {card}
      {overlayLayer}
    </View>
  );
};

/** The meta line of a cover card: a category dot and a short text. */
export const CoverMeta: React.FC<{ dotColor?: string; label?: string; children?: React.ReactNode }> = ({
  dotColor,
  label,
  children,
}) => {
  const styles = stylesFor(useT());
  return (
    <View style={styles.meta}>
      {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
      {label ? (
        <Text numberOfLines={1} style={styles.metaText}>
          {label}
        </Text>
      ) : null}
      {children}
    </View>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    layer: { position: 'absolute', left: 0, right: 0 },
    // Behind the picture while it loads, and under a remote cover's fade-in.
    picture: { top: 0, overflow: 'hidden', backgroundColor: T.surface2 },
    overlay: { position: 'absolute', left: 0, top: 0 },
    level: {
      position: 'absolute',
      left: T.space.tight,
      top: T.space.tight,
      minWidth: 30,
      minHeight: COVER_BADGE_HEIGHT,
      paddingHorizontal: T.space.tight,
      borderRadius: COVER_BADGE_HEIGHT / 2,
      backgroundColor: T.badge,
      alignItems: 'center',
      justifyContent: 'center',
    },
    levelText: { fontFamily: T.fontLabel, fontSize: 11.5, lineHeight: 15, color: T.onBadge },
    duration: {
      position: 'absolute',
      left: T.space.tight,
      bottom: T.space.tight,
      minHeight: COVER_BADGE_HEIGHT,
      paddingHorizontal: T.space.tight,
      borderRadius: COVER_BADGE_HEIGHT / 2,
      backgroundColor: T.glass,
      alignItems: 'center',
      justifyContent: 'center',
    },
    durationText: { fontFamily: T.fontLabel, fontSize: 11.5, lineHeight: 15, color: T.text },
    // The marks: the duration's glass and its 6dp insets, at the right.
    mark: { position: 'absolute', right: T.space.tight, bottom: T.space.tight },
    lock: {
      position: 'absolute',
      right: T.space.tight,
      top: T.space.tight,
      width: COVER_BADGE_HEIGHT,
      height: COVER_BADGE_HEIGHT,
      borderRadius: COVER_BADGE_HEIGHT / 2,
      backgroundColor: T.glass,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardTitle: {
      fontFamily: T.fontLabel,
      fontSize: 13.5,
      lineHeight: COVER_CARD_TITLE_LINE,
      color: T.text,
      marginTop: COVER_CARD_TITLE_GAP,
    },
    cardMeta: { marginTop: COVER_CARD_META_GAP },
    meta: { flexDirection: 'row', alignItems: 'center', gap: T.space.tight },
    dot: { width: META_DOT, height: META_DOT, borderRadius: META_DOT / 2 },
    metaText: { fontFamily: T.fontBody, fontSize: 12, lineHeight: 16, color: T.text3, flexShrink: 1 },
  });

const stylesFor = themedStyles(makeStyles);
