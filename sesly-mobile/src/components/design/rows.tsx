/**
 * Structural pieces of the playful design: Avatar, IconButton, TopAppBar,
 * ListRow, FieldFrame, TextField and StateView (empty and error states).
 *
 * Press rules (docs/release-pass/SPEC-design.md 1.3): a face with a visible
 * lip sinks by exactly that lip (Tactile, the lipped Avatar, the tactile and
 * glass icon buttons, card rows); everything without one (plain icon
 * buttons, the cover badge, plain rows, a bare avatar) never moves and dims
 * while pressed (`usePressTint`). Neutral faces take their colour from the
 * level they sit on (`useSurfaceLevel`), never the container's own colour.
 *
 * A top bar over a scrolling list takes `scrolled` from `useScrollEdge()`:
 * a short canvas fade then hangs under it while rows pass beneath.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityValue,
  Animated,
  Insets,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LIP, RADIUS, SPACE, Theme, lipFor, themedStyles, useT, useTextStyles } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { PRESS_DELAY_MS, animateTo, useReducedMotion } from '../../theme/motion';
import { SurfaceLevel, glassRing, insetFace, raisedFace } from '../../theme/surfaces';
import { Icon, IconName } from './Icon';
import { Button } from './Button';
import { SeslyMark } from './SeslyMark';
import { useSurfaceLevel } from './SurfaceLevel';
import { Tactile, usePressSink, usePressTint } from './Tactile';

/** Opacity of a disabled faceless target (a glyph or a plain row). */
const DISABLED_OPACITY = 0.5;

/** Level of the face one step above `level`, or null above surface2 (line). */
const LEVEL_ABOVE: Record<SurfaceLevel, SurfaceLevel | null> = { bg: 'surface', surface: 'surface2', surface2: null };

// ─────────────────────────────────────────────────────────────
// Avatar: an initial or an icon on a colour (`.nr .av`, `.own .av`)
// ─────────────────────────────────────────────────────────────

export interface AvatarProps {
  initial?: string;
  /** An icon instead of the initial (own voice: wave or mic). */
  icon?: IconName;
  size?: number;
  /** Fill; default the own-voice colour. Text is dark on it. */
  color?: string;
  textColor?: string;
  /** 'circle' (default) or 'rounded' (a soft square, narrator rows). */
  shape?: 'circle' | 'rounded';
  /**
   * A lip under the avatar (the top-bar profile button, the own-voice card):
   * a separate layer `avatarLip(size)` below the bubble (2 up to 48dp, like
   * the bell beside it, 3 for the 52dp own-voice avatar), which sinks onto
   * it when the avatar is pressable.
   */
  lipColor?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const Avatar: React.FC<AvatarProps> = props => {
  if (props.onPress) return <AvatarButton {...props} onPress={props.onPress} />;
  const { size = 36, lipColor, testID, style } = props;
  const bubble = <AvatarBubble {...props} testID={testID} style={lipColor ? undefined : style} />;
  if (!lipColor) return bubble;
  return (
    <View style={[{ width: size, paddingBottom: avatarLip(size) }, style]}>
      <AvatarLip {...props} lipColor={lipColor} />
      {bubble}
    </View>
  );
};

/** The bubble itself: the fill, the initial or the icon. */
const AvatarBubble: React.FC<
  AvatarProps & { animatedStyle?: Animated.WithAnimatedValue<StyleProp<ViewStyle>> }
> = ({ initial, icon, size = 36, color, textColor, shape = 'circle', testID, style, animatedStyle }) => {
  const T = useT();
  const ink = textColor ?? T.onCat;
  const glyph = icon ? (
    <Icon name={icon} size={Math.round(size * 0.5)} color={ink} />
  ) : (
    <Text
      style={{
        fontFamily: T.fontDisplay,
        fontSize: Math.round(size * 0.44),
        lineHeight: Math.ceil(size * 0.44 * 1.3),
        color: ink,
      }}
    >
      {initial}
    </Text>
  );
  const bubbleStyle: ViewStyle = {
    width: size,
    height: size,
    borderRadius: avatarRadius(size, shape),
    backgroundColor: color ?? T.own,
    alignItems: 'center',
    justifyContent: 'center',
  };
  if (animatedStyle) {
    return (
      <Animated.View testID={testID} style={[bubbleStyle, animatedStyle, style]}>
        {glyph}
      </Animated.View>
    );
  }
  return (
    <View testID={testID} style={[bubbleStyle, style]}>
      {glyph}
    </View>
  );
};

const AvatarLip: React.FC<AvatarProps & { lipColor: string }> = ({ size = 36, shape = 'circle', lipColor, testID }) => (
  <View
    pointerEvents="none"
    testID={testID ? `${testID}-lip` : undefined}
    style={[layerStyles.layer, { top: avatarLip(size), borderRadius: avatarRadius(size, shape), backgroundColor: lipColor }]}
  />
);

/** Lip of an avatar by its size (`lipFor`): 2 up to 48dp, 3 to 71dp, 4 above. */
export function avatarLip(size: number): number {
  return lipFor(size);
}

/**
 * Corner of an avatar: a circle, or a rounded square on the radius roles
 * (40dp tiles 12, picture tiles up to 63dp 16, larger 20).
 */
export function avatarRadius(size: number, shape: 'circle' | 'rounded'): number {
  if (shape === 'circle') return size / 2;
  return size <= 40 ? RADIUS.sm : size < 64 ? RADIUS.md : RADIUS.lg;
}

/** A pressable avatar: with a lip it sinks onto it, without one it dims. */
const AvatarButton: React.FC<AvatarProps & { onPress: () => void }> = props => {
  const { size = 36, lipColor, onPress, accessibilityLabel, testID, style } = props;
  const T = useT();
  const lip = lipColor ? avatarLip(size) : 0;
  const sink = usePressSink(lip, !!lipColor);
  const tint = usePressTint(!!lipColor);
  const faceID = testID ? `${testID}-face` : undefined;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={lipColor ? sink.onPressIn : tint.onPressIn}
      onPressOut={lipColor ? sink.onPressOut : tint.onPressOut}
      unstable_pressDelay={PRESS_DELAY_MS}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[
        {
          width: Math.max(size, T.touch),
          height: Math.max(size + lip, T.touch),
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {lipColor ? (
        <View style={{ width: size, paddingBottom: lip }}>
          <AvatarLip {...props} lipColor={lipColor} />
          <AvatarBubble {...props} testID={faceID} style={undefined} animatedStyle={{ transform: [{ translateY: sink.translateY }] }} />
        </View>
      ) : (
        <AvatarBubble {...props} testID={faceID} style={undefined} animatedStyle={{ opacity: tint.opacity }} />
      )}
    </Pressable>
  );
};

// ─────────────────────────────────────────────────────────────
// IconButton
// ─────────────────────────────────────────────────────────────

/** Edge of the cover badge (`variant="badge"`), its glyph and its hit slop. */
export const ICON_BADGE_SIZE = 28;
const BADGE_GLYPH = 16;
const BADGE_HIT_SLOP = 10;

/** Edge of the count bubble on an icon button (`badgeCount`). */
const COUNT_SIZE = 18;

export type IconButtonVariant = 'plain' | 'tactile' | 'glass' | 'badge';

export interface IconButtonProps {
  icon: IconName;
  onPress?: () => void;
  accessibilityLabel: string;
  /**
   * 'plain': the glyph in a 48dp target (inside rows and sheets); dims while pressed.
   * 'tactile': a 44dp rounded card one step above its container, on a 2dp
   *   lip (`.iconbtn`: top bars, dock); sinks.
   * 'glass': the same card in the surface colour with a 1dp ring, over
   *   artwork (player top bar); sinks.
   * 'badge': a 28dp surface circle with the ring, no lip, on a cover (the
   *   bookmark); dims while pressed.
   */
  variant?: IconButtonVariant;
  color?: string;
  /** Glyph size (24, 16 on a badge). */
  size?: number;
  /** The glyph's filled twin (an "on" state, such as a queued story). Plain buttons. */
  filled?: boolean;
  /** Edge of a tactile or glass button (default 44). */
  box?: number;
  disabled?: boolean;
  /**
   * Touch slop. Plain: none by default (the target is already 48dp);
   * badge: 10; tactile and glass: what brings face and lip to 48dp.
   */
  hitSlop?: Insets | number;
  /** A count bubble in the corner (the queue length); hidden at 0. */
  badgeCount?: number;
  /**
   * The label already says the count ("Sıradakiler, 3 masal"): screen
   * readers hear it once, so the count is never set as the button's value.
   * Without it the count is the value ("Sıra", "3").
   */
  countInLabel?: boolean;
  /** Delay before the sink or tint starts (default 100 ms; 0 outside scrolling content). */
  pressDelay?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const IconButton: React.FC<IconButtonProps> = props => {
  switch (props.variant) {
    case 'tactile':
    case 'glass':
      return <CardIconButton {...props} />;
    case 'badge':
      return <BadgeIconButton {...props} />;
    case 'plain':
    default:
      return <PlainIconButton {...props} />;
  }
};

/** The value of a button whose count went back to 0 (see `useCountValue`). */
const NO_COUNT_VALUE: AccessibilityValue = { text: '' };

/**
 * Screen readers hear the count as the value of the button. Once a count
 * was set, a count of 0 (or none) sets an explicit empty value, never none:
 * Android keeps the last value a view was given when the prop goes away, so
 * a cleared queue still said "Sıradakiler, 4" (NL-06). A button that never
 * had a count sets no value, and one whose label says the count
 * (`countInLabel`) never sets it at all.
 */
function useCountValue(count: number | undefined, countInLabel: boolean | undefined): AccessibilityValue | undefined {
  const announced = useRef(false);
  if (!countInLabel && count && count > 0) {
    announced.current = true;
    return { text: String(count) };
  }
  return announced.current ? NO_COUNT_VALUE : undefined;
}

const CardIconButton: React.FC<IconButtonProps> = ({
  icon,
  onPress,
  accessibilityLabel,
  variant,
  color,
  size,
  box = 44,
  disabled,
  hitSlop,
  badgeCount,
  countInLabel,
  pressDelay,
  testID,
  style,
}) => {
  const T = useT();
  const level = useSurfaceLevel();
  const countValue = useCountValue(badgeCount, countInLabel);
  const glass = variant === 'glass';
  const lip = LIP.sm;
  const slopV = Math.max(0, (T.touch - box - lip) / 2);
  const slopH = Math.max(0, (T.touch - box) / 2);
  return (
    <Tactile
      // Glass over artwork: opaque surface with a ring, so the lip behind
      // the face never shows through it and the shape holds on any picture.
      color={glass ? T.surface : raisedFace(T, level)}
      lipColor={T.lip}
      lip={lip}
      radius={box >= 44 ? RADIUS.md : RADIUS.sm}
      borderColor={glass ? ringsFor(T).glass : undefined}
      borderWidth={glass ? T.hairline : undefined}
      onPress={onPress}
      disabled={disabled}
      pressDelay={pressDelay}
      hitSlop={hitSlop ?? (slopV || slopH ? { top: slopV, bottom: slopV, left: slopH, right: slopH } : undefined)}
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={countValue}
      testID={testID}
      style={style}
      faceStyle={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name={icon} size={size ?? 24} color={color ?? T.text} />
      <CountBubble count={badgeCount} testID={testID ? `${testID}-count` : undefined} />
    </Tactile>
  );
};

const PlainIconButton: React.FC<IconButtonProps> = ({
  icon,
  onPress,
  accessibilityLabel,
  color,
  size,
  filled,
  disabled,
  hitSlop,
  badgeCount,
  countInLabel,
  pressDelay = PRESS_DELAY_MS,
  testID,
  style,
}) => {
  const T = useT();
  const { opacity, onPressIn, onPressOut } = usePressTint(!!disabled);
  const countValue = useCountValue(badgeCount, countInLabel);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      unstable_pressDelay={pressDelay}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      accessibilityValue={countValue}
      // A dimmed glyph with a count over it fades as one group on Android.
      needsOffscreenAlphaCompositing={!!disabled && !!badgeCount && badgeCount > 0}
      testID={testID}
      style={[
        {
          width: T.touch,
          height: T.touch,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? DISABLED_OPACITY : 1,
        },
        style,
      ]}
    >
      {/* The count sits on the glyph's corner and dims with it: the whole
          target answers the press, and the 48dp box has no edge to pin it to. */}
      <Animated.View testID={testID ? `${testID}-glyph` : undefined} style={{ opacity }}>
        <Icon name={icon} size={size ?? 24} color={color ?? T.text} filled={filled} />
        <CountBubble count={badgeCount} onGlyph testID={testID ? `${testID}-count` : undefined} />
      </Animated.View>
    </Pressable>
  );
};

const BadgeIconButton: React.FC<IconButtonProps> = ({
  icon,
  onPress,
  accessibilityLabel,
  color,
  size,
  disabled,
  hitSlop = BADGE_HIT_SLOP,
  pressDelay = PRESS_DELAY_MS,
  testID,
  style,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const { opacity, onPressIn, onPressOut } = usePressTint(!!disabled);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      unstable_pressDelay={pressDelay}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      style={[styles.badgeBox, disabled ? { opacity: DISABLED_OPACITY } : null, style]}
    >
      <Animated.View testID={testID ? `${testID}-face` : undefined} style={[styles.badgeFace, { opacity }]}>
        <Icon name={icon} size={size ?? BADGE_GLYPH} color={color ?? T.text} />
      </Animated.View>
    </Pressable>
  );
};

/**
 * The count in the corner of an icon button, in the action colour: on the
 * face's corner, or on the glyph's corner of a plain button (`onGlyph`).
 */
const CountBubble: React.FC<{ count?: number; onGlyph?: boolean; testID?: string }> = ({ count, onGlyph, testID }) => {
  const T = useT();
  const styles = stylesFor(T);
  if (!count || count <= 0) return null;
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      testID={testID}
      style={[styles.count, onGlyph ? styles.countOnGlyph : null]}
    >
      <Text maxFontSizeMultiplier={1.3} style={styles.countText}>
        {count > 99 ? '99+' : String(count)}
      </Text>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// TopAppBar
// ─────────────────────────────────────────────────────────────

/** Size of the app mark next to the wordmark (dp). */
export const BRAND_MARK_SIZE = 30;

/** Height of the canvas fade under a top bar while content scrolls beneath it (dp). */
export const APP_BAR_EDGE_FADE = SPACE.md;
/** Scroll offset past which the content counts as under the bar (dp). */
export const SCROLL_EDGE_OFFSET = SPACE.xs;

export interface ScrollEdge {
  /** The content has scrolled under the bar. */
  scrolled: boolean;
  /** For the list's `onScroll` (with `scrollEventThrottle={16}`). */
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

/**
 * Whether a list has scrolled under its top bar, for `TopAppBar scrolled`.
 * The state changes only when the offset crosses `SCROLL_EDGE_OFFSET`, so a
 * scroll re-renders the screen at most once each way.
 *
 *   const edge = useScrollEdge();
 *   <TopAppBar variant="back" title={...} scrolled={edge.scrolled} />
 *   <ScrollView onScroll={edge.onScroll} scrollEventThrottle={16}>...
 */
export function useScrollEdge(): ScrollEdge {
  const [scrolled, setScrolled] = useState(false);
  // The last value handed to React: a scroll event that changes nothing
  // never schedules a render (an equal setState can still render once).
  const last = useRef(false);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const under = event.nativeEvent.contentOffset.y > SCROLL_EDGE_OFFSET;
    if (under === last.current) return;
    last.current = under;
    setScrolled(under);
  }, []);
  return useMemo(() => ({ scrolled, onScroll }), [scrolled, onScroll]);
}

/**
 * The fade that hangs under a top bar: the canvas colour to transparent,
 * over the first 12dp of the content, shown only while something scrolls beneath
 * (a cross-fade in `DURATION.fast`). It takes no touches and no space.
 */
const AppBarEdge: React.FC<{ visible: boolean; color: string }> = ({ visible, color }) => {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const last = useRef(visible);
  useEffect(() => {
    if (last.current === visible) return;
    last.current = visible;
    animateTo(opacity, visible ? 1 : 0, 'fast', reduced, { fade: true });
  }, [visible, reduced, opacity]);
  useEffect(() => () => opacity.stopAnimation(), [opacity]);
  return (
    <Animated.View pointerEvents="none" testID="appbar-edge" style={[layerStyles.edge, { opacity }]}>
      <LinearGradient
        colors={[color, withAlpha(color, 0)]}
        style={StyleSheet.absoluteFill}
        testID="appbar-edge-fade"
      />
    </Animated.View>
  );
};

export interface TopAppBarProps {
  /**
   * 'brand': the app mark and the "sesly" wordmark (home).
   * 'tab': a big Baloo 2 title (Keşfet, Kütüphane, Sesim).
   * 'back': a tactile back button and a title (pushed screens).
   */
  variant?: 'brand' | 'tab' | 'back';
  title?: string;
  /** Line under a tab title ("Masalları kimin anlatacağını buradan seçersin."). */
  subtitle?: string;
  onBack?: () => void;
  /** Right side: avatar, icon buttons or a text action. */
  trailing?: React.ReactNode;
  /** Skip the status bar inset when a parent already applied it. */
  noInset?: boolean;
  /**
   * Content scrolls under the bar (`useScrollEdge`): while true a short fade
   * in the canvas colour hangs below the bar, so a row never cuts flush
   * under it. Leave it out where nothing scrolls beneath.
   */
  scrolled?: boolean;
  /**
   * Drawn over the title row after everything else (Keşfet's search field,
   * which opens over the title). The caller places it absolutely inside the
   * row (the row is 8dp of top padding, then the content line); it never
   * changes the bar's height.
   */
  overlay?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const TopAppBar: React.FC<TopAppBarProps> = ({
  variant = 'back',
  title,
  subtitle,
  onBack,
  trailing,
  noInset,
  scrolled,
  overlay,
  style,
}) => {
  const T = useT();
  const { t } = useTranslation('common');
  const insets = useSafeAreaInsets();
  const text = useTextStyles();
  const edge = scrolled !== undefined;
  return (
    <View
      style={[
        { paddingTop: noInset ? 0 : insets.top, backgroundColor: T.bg },
        // The fade hangs over the list below, so the bar draws above it.
        edge ? layerStyles.above : null,
        style,
      ]}
    >
      <View
        style={{
          minHeight: variant === 'tab' ? 64 : 60,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: T.screenPadH,
          paddingTop: 8,
          gap: 12,
        }}
      >
        {variant === 'back' ? (
          <IconButton
            variant="tactile"
            icon="back"
            onPress={onBack}
            accessibilityLabel={t('back')}
            testID="appbar-back"
          />
        ) : null}
        {variant === 'brand' ? (
          // The app mark, then the wordmark; the mark is decorative, the
          // word next to it is the name.
          <View testID="appbar-brand" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <SeslyMark size={BRAND_MARK_SIZE} decorative testID="appbar-mark" />
            <Text accessibilityRole="header" style={[text.displayM, { flexShrink: 1 }]}>
              sesly
            </Text>
          </View>
        ) : variant === 'tab' ? (
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* A long title (Kütüphane next to the trailing buttons at a
                large font scale) shrinks a little instead of truncating. */}
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.15}
              minimumFontScale={0.8}
              style={text.displayL}
            >
              {title}
            </Text>
          </View>
        ) : (
          <Text
            accessibilityRole={title ? 'header' : undefined}
            numberOfLines={1}
            style={[text.heading, { flex: 1, minWidth: 0 }]}
          >
            {title ?? ''}
          </Text>
        )}
        {trailing}
        {overlay}
      </View>
      {subtitle ? (
        <Text style={[text.bodySmall, { paddingHorizontal: T.screenPadH, marginTop: 2 }]}>{subtitle}</Text>
      ) : null}
      {edge ? <AppBarEdge visible={!!scrolled} color={T.bg} /> : null}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// ListRow
// ─────────────────────────────────────────────────────────────

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Lines the subtitle may take before it ends in three dots (all by default). */
  subtitleLines?: number;
  /** Leading icon from the family, in a small rounded tile. */
  icon?: IconName;
  /** Leading custom node (cover, avatar). Wins over `icon`. */
  leading?: React.ReactNode;
  /** Short value at the right ("2 yeni"). */
  value?: string;
  /** Trailing custom node (switch, segmented control, button). */
  trailing?: React.ReactNode;
  /** Chevron at the far right: the row opens something. */
  chevron?: boolean;
  tone?: 'default' | 'danger';
  /** A card of its own on a lip (`.nr`) instead of a plain row. */
  card?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const ListRow: React.FC<ListRowProps> = ({
  title,
  subtitle,
  subtitleLines,
  icon,
  leading,
  value,
  trailing,
  chevron,
  tone = 'default',
  card,
  onPress,
  disabled,
  testID,
  style,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const level = useSurfaceLevel();
  const { opacity, onPressIn, onPressOut } = usePressTint(!onPress || !!disabled || !!card);
  const danger = tone === 'danger';
  // A card row is one step above its container; its icon tile one more.
  const tileLevel = card ? LEVEL_ABOVE[level] : level;
  const tileColor = tileLevel ? raisedFace(T, tileLevel) : insetFace(T, 'surface2');
  const content = (
    <>
      {leading ??
        (icon ? (
          <View testID={testID ? `${testID}-tile` : undefined} style={[styles.rowIcon, { backgroundColor: tileColor }]}>
            <Icon name={icon} size={20} color={danger ? T.error : T.text2} />
          </View>
        ) : null)}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: danger ? T.error : T.text }]}>{title}</Text>
        {subtitle ? (
          <Text numberOfLines={subtitleLines} style={styles.rowSubtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {trailing}
      {chevron ? <Icon name="chevronRight" size={20} color={T.text3} /> : null}
    </>
  );
  const label = [title, subtitle, value].filter(Boolean).join(', ');

  if (card) {
    return (
      <Tactile
        color={raisedFace(T, level)}
        lipColor={T.lip}
        radius={RADIUS.lg}
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        accessibilityLabel={onPress ? label : undefined}
        testID={testID}
        style={style}
        faceStyle={[styles.row, styles.rowCard]}
      >
        {content}
      </Tactile>
    );
  }
  if (!onPress) {
    return (
      <View testID={testID} style={[styles.row, style]}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      unstable_pressDelay={PRESS_DELAY_MS}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      style={[{ opacity: disabled ? DISABLED_OPACITY : 1 }, style]}
    >
      <Animated.View testID={testID ? `${testID}-content` : undefined} style={[styles.row, { opacity }]}>
        {content}
      </Animated.View>
    </Pressable>
  );
};

// ─────────────────────────────────────────────────────────────
// FieldFrame: the face and lip of a text or search field
// ─────────────────────────────────────────────────────────────

export interface FieldFrameProps {
  /** The 2dp ring: transparent at rest, `text2` focused, `error` with an error. */
  ringColor: string;
  /** The face is `${testID}-face`, the lip `${testID}-lip`. */
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** Extra face layout (the face already lays its children out in a row). */
  faceStyle?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * The field shape: an inset face (one ladder step below its container, so a
 * field in a sheet is the canvas colour) on a lip layer drawn like Tactile's,
 * so the lip keeps its full height at the rounded corners. Fields never sink.
 */
export const FieldFrame: React.FC<FieldFrameProps> = ({ ringColor, testID, style, faceStyle, children }) => {
  const T = useT();
  const styles = stylesFor(T);
  const level = useSurfaceLevel();
  return (
    <View style={[styles.frame, style]}>
      <View pointerEvents="none" testID={testID ? `${testID}-lip` : undefined} style={styles.frameLip} />
      <View
        testID={testID ? `${testID}-face` : undefined}
        style={[styles.frameFace, { backgroundColor: insetFace(T, level), borderColor: ringColor }, faceStyle]}
      >
        {children}
      </View>
    </View>
  );
};

/** Ring of a field: the error wins over the focus; transparent at rest. */
export function fieldRingColor(T: Theme, focused: boolean, hasError: boolean): string {
  if (hasError) return T.error;
  return focused ? T.text2 : 'transparent';
}

// ─────────────────────────────────────────────────────────────
// TextField: label above, a 52dp field on its lip, helper or error below
// ─────────────────────────────────────────────────────────────

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Helper line under the field ("En az 6 karakter"). Hidden while an error shows. */
  helper?: string;
  error?: string | null;
  /** Password field: masks the text and adds the show / hide toggle. */
  secure?: boolean;
  /** The input itself (focus it from a sheet's onOpened, chain return keys). */
  ref?: React.Ref<TextInput>;
  style?: StyleProp<ViewStyle>;
}

/**
 * `testID` goes on the input; the field frame is `${testID}-field` (its face
 * `${testID}-field-face`, its lip `${testID}-field-lip`).
 */
export const TextField: React.FC<TextFieldProps> = ({
  label,
  helper,
  error,
  secure,
  ref,
  style,
  ...inputProps
}) => {
  const T = useT();
  const { t } = useTranslation('common');
  const styles = stylesFor(T);
  const [shown, setShown] = useState(false);
  const [focused, setFocused] = useState(false);
  const hasError = !!error;
  return (
    <View style={style}>
      <Text style={[styles.fieldLabel, hasError && { color: T.error }]}>{label}</Text>
      <FieldFrame
        ringColor={fieldRingColor(T, focused, hasError)}
        testID={inputProps.testID ? `${inputProps.testID}-field` : undefined}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={T.text3}
          selectionColor={T.action}
          selectionHandleColor={T.action}
          cursorColor={T.action}
          underlineColorAndroid="transparent"
          autoCorrect={false}
          {...inputProps}
          onFocus={e => {
            setFocused(true);
            inputProps.onFocus?.(e);
          }}
          onBlur={e => {
            setFocused(false);
            inputProps.onBlur?.(e);
          }}
          secureTextEntry={secure ? !shown : inputProps.secureTextEntry}
          style={styles.fieldInput}
        />
        {secure ? (
          <IconButton
            icon={shown ? 'eyeOff' : 'eye'}
            color={T.text2}
            size={22}
            onPress={() => setShown(s => !s)}
            pressDelay={0}
            accessibilityLabel={shown ? t('a11y.hidePassword') : t('a11y.showPassword')}
          />
        ) : null}
      </FieldFrame>
      {hasError ? (
        <Text accessibilityLiveRegion="polite" style={[styles.fieldHelper, { color: T.error }]}>
          {error}
        </Text>
      ) : helper ? (
        <Text style={styles.fieldHelper}>{helper}</Text>
      ) : null}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// StateView: one icon, one title, one sentence, one action
// ─────────────────────────────────────────────────────────────

export interface StateViewProps {
  icon?: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const StateView: React.FC<StateViewProps> = ({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  testID,
  style,
}) => {
  const text = useTextStyles();
  return (
    // Paddings of 32 keep the lines of a centred state short.
    <View
      testID={testID}
      style={[{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 32 }, style]}
    >
      {icon ? <StateIcon icon={icon} /> : null}
      <Text style={[text.heading, { marginTop: icon ? 20 : 0, textAlign: 'center', maxWidth: 300 }]}>{title}</Text>
      {message ? (
        <Text style={[text.bodySmall, { marginTop: 8, textAlign: 'center', maxWidth: 300 }]}>{message}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} size="md" onPress={onAction} style={{ marginTop: 24, alignSelf: 'center' }} />
      ) : null}
    </View>
  );
};

/** The round icon badge of an empty or error state, on a `LIP.lg` lip. */
export const StateIcon: React.FC<{ icon: IconName; color?: string; size?: number; testID?: string }> = ({
  icon,
  color,
  size = 76,
  testID,
}) => {
  const T = useT();
  return (
    <View
      testID={testID}
      style={{
        width: size,
        height: size + LIP.lg,
        borderRadius: size / 2,
        backgroundColor: T.surface2,
        borderBottomWidth: LIP.lg,
        borderBottomColor: T.lip,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={Math.round(size * 0.42)} color={color ?? T.text2} />
    </View>
  );
};

const layerStyles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  above: { zIndex: 1 },
  edge: { position: 'absolute', left: 0, right: 0, top: '100%', height: APP_BAR_EDGE_FADE },
});

/** Colours that depend only on the palette, computed once per palette. */
const ringsFor = themedStyles((T: Theme) => ({ glass: glassRing(T) }));

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    badgeBox: { width: ICON_BADGE_SIZE, height: ICON_BADGE_SIZE },
    badgeFace: {
      width: ICON_BADGE_SIZE,
      height: ICON_BADGE_SIZE,
      borderRadius: ICON_BADGE_SIZE / 2,
      backgroundColor: T.surface,
      borderWidth: T.hairline,
      borderColor: glassRing(T),
      alignItems: 'center',
      justifyContent: 'center',
    },
    count: {
      position: 'absolute',
      top: -4,
      right: -4,
      minWidth: COUNT_SIZE,
      minHeight: COUNT_SIZE,
      borderRadius: COUNT_SIZE / 2,
      paddingHorizontal: 4,
      backgroundColor: T.action,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Overlaps the glyph's top right corner and stays inside the 48dp target.
    countOnGlyph: { top: -6, right: -8 },
    countText: { fontFamily: T.fontLabel, fontSize: 11, lineHeight: 15, color: T.onAction },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 56,
      paddingVertical: 8,
      paddingHorizontal: T.screenPadH,
    },
    rowCard: { minHeight: 64, paddingHorizontal: 12, paddingVertical: 12 },
    rowIcon: {
      width: 40,
      height: 40,
      borderRadius: RADIUS.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { fontFamily: T.fontLabel, fontSize: 15, lineHeight: 21 },
    rowSubtitle: {
      fontFamily: T.fontBody,
      fontSize: 12.5,
      lineHeight: 17,
      color: T.text3,
      marginTop: 2,
    },
    rowValue: { fontFamily: T.fontLabel, fontSize: 13, lineHeight: 18, color: T.text2 },

    frame: { paddingBottom: LIP.md },
    frameLip: {
      ...layerStyles.layer,
      top: LIP.md,
      borderRadius: RADIUS.lg,
      backgroundColor: T.lip,
    },
    frameFace: {
      minHeight: 52,
      borderRadius: RADIUS.lg,
      borderWidth: T.ring,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingLeft: 16,
      paddingRight: 8,
    },

    fieldLabel: {
      fontFamily: T.fontLabel,
      fontSize: 13,
      lineHeight: 18,
      color: T.text2,
      marginBottom: 8,
    },
    fieldInput: {
      flex: 1,
      minWidth: 0,
      fontFamily: T.fontBody,
      fontSize: 15,
      color: T.text,
      paddingVertical: 12,
      paddingLeft: 0,
      paddingRight: 8,
    },
    fieldHelper: {
      fontFamily: T.fontBody,
      fontSize: 12.5,
      lineHeight: 17,
      color: T.text3,
      marginTop: 6,
    },
  });

const stylesFor = themedStyles(makeStyles);
