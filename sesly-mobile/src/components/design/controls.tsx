/**
 * Selection controls of the playful design: Chip (filter and choice, `.fc`),
 * Tag (a static marker, `.chip`), SegmentedControl, Switch, SwitchRow and
 * Checkbox.
 *
 * Selected means the action colour: a selected chip or segment is filled
 * with it and sits on the action lip. Idle chips are the `line` colour on
 * their own lip. Only a face with a visible lip sinks when pressed (chips);
 * segments, switch rows and the checkbox dim instead, and no label ever moves
 * inside its face (docs/release-pass/SPEC-design.md 1.3, 3.8).
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { LIP, Theme, themedStyles, useT } from '../../theme/theme';
import { PRESS_DELAY_MS, SPRING_SNAPPY, animateTo, useReducedMotion } from '../../theme/motion';
import { insetFace } from '../../theme/surfaces';
import { Icon, IconName } from './Icon';
import { useSurfaceLevel } from './SurfaceLevel';
import { Tactile } from './Tactile';
import { usePressTint } from './usePressTint';

/** A control label grows with the system font only so far: past this it would not fit beside its row label. */
const CONTROL_MAX_FONT_SCALE = 1.3;

// ─────────────────────────────────────────────────────────────
// Chip (`.fc`)
// ─────────────────────────────────────────────────────────────

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** A second action (rename or delete a playlist). */
  onLongPress?: () => void;
  /**
   * 'filter' opens a picker and shows a caret (Keşfet: "Dil", "Seviye").
   * 'choice' is one of several options (default).
   */
  kind?: 'filter' | 'choice';
  /**
   * How a choice chip announces itself: 'radio' (one of several, default),
   * 'checkbox' (one of a multi-select group: languages, levels) or 'button'
   * (a plain action such as a timer quick pick: no selection state).
   */
  role?: 'radio' | 'checkbox' | 'button';
  /** Small node before the label (a language code badge). */
  leading?: React.ReactNode;
  /** Small node after the label (a count). */
  trailing?: React.ReactNode;
  /** Leading icon from the family. */
  icon?: IconName;
  /** A square chip for a short value ("A1"). */
  square?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const Chip: React.FC<ChipProps> = ({
  label,
  selected = false,
  onPress,
  onLongPress,
  kind = 'choice',
  role = 'radio',
  leading,
  trailing,
  icon,
  square,
  disabled,
  accessibilityLabel,
  testID,
  style,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const color = selected ? T.onAction : T.text;
  const button = kind === 'filter' || role === 'button';
  return (
    <Tactile
      color={selected ? T.action : T.line}
      lipColor={selected ? T.actionLip : T.lineLip}
      lip={LIP.sm}
      radius={T.r.sm}
      onPress={onPress ?? noop}
      onLongPress={onLongPress}
      disabled={disabled}
      // 34dp visible plus the lip, 48dp target.
      hitSlop={{ top: 6, bottom: 6 }}
      accessibilityRole={button ? 'button' : role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={
        kind === 'filter'
          ? { expanded: false }
          : role === 'button'
            ? undefined
            : role === 'checkbox'
              ? { checked: selected }
              : { selected }
      }
      testID={testID}
      style={[{ alignSelf: 'flex-start' }, style]}
      faceStyle={[styles.chip, square && styles.chipSquare]}
    >
      {leading}
      {icon ? <Icon name={icon} size={16} color={color} /> : null}
      <Text numberOfLines={1} style={[styles.chipLabel, { color }]}>
        {label}
      </Text>
      {trailing}
      {kind === 'filter' ? (
        <View style={styles.chipCaret} testID="chip-caret">
          <Icon name="caret" size={16} color={color} />
        </View>
      ) : null}
    </Tactile>
  );
};

function noop() {}

// ─────────────────────────────────────────────────────────────
// Tag (`.chip`): a static marker. Not tappable.
// ─────────────────────────────────────────────────────────────

export type TagTone = 'dim' | 'glass' | 'ok' | 'act' | 'line';

/** Minimum heights of the two tag sizes (dp); the radius is half of it. */
const TAG_HEIGHT = { md: 28, sm: 24 } as const;

export interface TagProps {
  label: string;
  /**
   * 'dim' surface and text-2 (detail meta), 'glass' translucent canvas over
   * a picture, 'ok' the "Hazır" tint, 'act' the "Varsayılan" tint, 'line'
   * the idle chip colour.
   */
  tone?: TagTone;
  /** A fill colour of its own (category) with its text colour. */
  color?: string;
  textColor?: string;
  icon?: IconName;
  /** 'md' 28dp (default), 'sm' 24dp; both grow with the label. */
  size?: 'sm' | 'md';
  /** How far the label follows the system font (default 1.3). */
  maxFontSizeMultiplier?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function tagColors(T: Theme, tone: TagTone): { background: string; text: string } {
  switch (tone) {
    case 'glass':
      return { background: T.glass, text: T.text };
    case 'ok':
      return { background: T.chipOkBg, text: T.chipOkFg };
    case 'act':
      return { background: T.chipActBg, text: T.chipActFg };
    case 'line':
      return { background: T.line, text: T.text2 };
    case 'dim':
    default:
      return { background: T.surface, text: T.text2 };
  }
}

export const Tag: React.FC<TagProps> = ({
  label,
  tone = 'dim',
  color,
  textColor,
  icon,
  size = 'md',
  maxFontSizeMultiplier = CONTROL_MAX_FONT_SCALE,
  testID,
  style,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const base = tagColors(T, tone);
  const fg = textColor ?? (color ? T.onCat : base.text);
  const small = size === 'sm';
  return (
    <View
      testID={testID}
      style={[
        styles.tag,
        small && styles.tagSmall,
        { backgroundColor: color ?? base.background },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={small ? 14 : 16} color={fg} /> : null}
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        style={[styles.tagLabel, small && styles.tagLabelSmall, { color: fg }]}
      >
        {label}
      </Text>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// SegmentedControl: one inset well, one sliding action pill
// ─────────────────────────────────────────────────────────────

export interface Segment<V extends string> {
  value: V;
  label: string;
}

export interface SegmentedControlProps<V extends string> {
  segments: readonly Segment<V>[];
  value: V;
  /**
   * Called in the frame after the press: the pill moves at once and the
   * (possibly heavy) re-render of the caller comes one frame later. After a
   * plain return the control shows `value` again (a caller that refused the
   * change gets its own value back). An async change returns its promise:
   * the choice then stays shown until `value` changes or the promise
   * settles (a failed change puts the pill back).
   */
  onChange: (value: V) => void | PromiseLike<unknown>;
  /** Compact: hugs its labels (inside a settings row). Default: full width. */
  compact?: boolean;
  /**
   * The pill's position in segment index units, owned by the caller (created
   * at the index of `value`). The control moves it at the press, so a caller
   * can drive what belongs to each choice (a body under it) from the same
   * native value, in the same frame as the pill (LR-3R).
   */
  position?: Animated.Value;
  accessibilityLabel?: string;
  /**
   * The well. Segments are `${testID}-${value}`, their label layers
   * `${testID}-${value}-label` (the one read by screen readers and queries)
   * and `${testID}-${value}-label-alt`, the pill `${testID}-pill` (compact or
   * before the first layout: `${testID}-${value}-pill`).
   */
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Well padding and the gap between segments (dp). */
const WELL_PAD = 4;
const SEGMENT_GAP = 4;

function isThenable(result: unknown): result is PromiseLike<unknown> {
  return !!result && typeof (result as PromiseLike<unknown>).then === 'function';
}

export function SegmentedControl<V extends string>({
  segments,
  value,
  onChange,
  compact = false,
  position,
  accessibilityLabel,
  testID,
  style,
}: SegmentedControlProps<V>): React.ReactElement {
  const T = useT();
  const styles = stylesFor(T);
  const level = useSurfaceLevel();
  const reduced = useReducedMotion();

  // Optimistic choice (SPEC-design 2.4): shown at the press, handed to the
  // caller in the next frame, dropped when `value` changes or the caller has
  // answered (see `onChange`).
  const [pending, setPending] = useState<V | null>(null);
  const [seenValue, setSeenValue] = useState(value);
  if (seenValue !== value) {
    setSeenValue(value);
    if (pending !== null) setPending(null);
  }
  const shown = pending ?? value;
  const shownIndex = segments.findIndex(segment => segment.value === shown);

  const frame = useRef<number | null>(null);
  const scheduled = useRef<(() => void) | null>(null);
  /** onChange ran for a value the `value` prop has not caught up with. */
  const handedOver = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    handedOver.current = false;
  }, [value]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // A choice made in the last frame before unmounting still reaches the caller.
      if (frame.current != null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
        scheduled.current?.();
      }
    };
  }, []);

  const pick = (next: V) => {
    if (next === shown) return;
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (next === value && !handedOver.current) {
      // Back to the value the caller holds before it heard of the other one.
      setPending(null);
      return;
    }
    setPending(next);
    const run = () => {
      scheduled.current = null;
      handedOver.current = true;
      const settle = () => {
        if (alive.current) setPending(current => (current === next ? null : current));
      };
      const result = onChange(next);
      // A promise: the choice stays shown while the caller works on it. A
      // plain return: the caller has answered (its state update renders in
      // the same batch), so from now on the control shows its value, also
      // when it refused the change.
      if (isThenable(result)) result.then(settle, settle);
      else settle();
    };
    scheduled.current = run;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      run();
    });
  };

  // Fill mode: one pill on one value in index units, sprung on the native driver.
  const ownPos = useRef(new Animated.Value(Math.max(0, shownIndex))).current;
  const pos = position ?? ownPos;
  // A caller's value starts where this control does (it may have moved while
  // the control was not mounted, a sheet that was closed).
  useLayoutEffect(() => {
    if (!position || shownIndex < 0) return;
    position.stopAnimation();
    position.setValue(shownIndex);
    // Mount only: later changes slide below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);
  const lastIndex = useRef(shownIndex);
  useEffect(() => {
    const from = lastIndex.current;
    lastIndex.current = shownIndex;
    if (shownIndex < 0 || from === shownIndex) return;
    // Nothing to slide from (no choice before), compact mode or reduced motion: in place.
    if (from < 0 || compact || reduced) {
      pos.stopAnimation();
      pos.setValue(shownIndex);
      return;
    }
    Animated.spring(pos, { toValue: shownIndex, ...SPRING_SNAPPY, useNativeDriver: true }).start();
  }, [shownIndex, reduced, compact, pos]);
  useEffect(() => () => pos.stopAnimation(), [pos]);

  const [wellWidth, setWellWidth] = useState(0);
  const count = segments.length;
  const segmentWidth =
    wellWidth > 0 ? (wellWidth - 2 * WELL_PAD - SEGMENT_GAP * (count - 1)) / count : 0;
  const measured = !compact && segmentWidth > 0;
  // Clamped to the first and the last segment: the spring's overshoot never
  // carries the pill past the well's inner edge (RC-5).
  const lastSlot = Math.max(1, count - 1);
  const translateX = useMemo(
    () =>
      pos.interpolate({
        inputRange: [0, lastSlot],
        outputRange: [0, lastSlot * (segmentWidth + SEGMENT_GAP)],
        extrapolate: 'clamp',
      }),
    [pos, segmentWidth, lastSlot],
  );
  const onLayout = compact
    ? undefined
    : (e: LayoutChangeEvent) => {
        const width = e.nativeEvent.layout.width;
        if (width !== wellWidth) setWellWidth(width);
      };

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onLayout={onLayout}
      style={[
        styles.seg,
        { backgroundColor: insetFace(T, level) },
        { alignSelf: compact ? 'flex-start' : 'stretch', maxWidth: '100%' },
        style,
      ]}
    >
      {measured && shownIndex >= 0 ? (
        <Animated.View
          pointerEvents="none"
          testID={testID ? `${testID}-pill` : undefined}
          style={[styles.pillShared, { width: segmentWidth, transform: [{ translateX }] }]}
        >
          <PillLayers styles={styles} testID={testID ? `${testID}-pill` : undefined} />
        </Animated.View>
      ) : null}
      {segments.map((segment, i) => (
        <SegmentItem
          key={segment.value}
          label={segment.label}
          index={i}
          selected={i === shownIndex}
          compact={compact}
          // Before the first layout the selected segment draws the pill
          // itself, in the same place, so there is never a frame without one.
          inlinePill={!compact && !measured && i === shownIndex}
          pos={shownIndex >= 0 ? pos : null}
          reduced={reduced}
          onPress={() => pick(segment.value)}
          testID={testID ? `${testID}-${segment.value}` : undefined}
          styles={styles}
          T={T}
        />
      ))}
    </View>
  );
}

/** The action face on its lip, filling its parent (`${testID}-lip`, `${testID}-face`). */
const PillLayers: React.FC<{ styles: Styles; testID?: string }> = ({ styles, testID }) => (
  <>
    <View testID={testID ? `${testID}-lip` : undefined} style={styles.pillLip} />
    <View testID={testID ? `${testID}-face` : undefined} style={styles.pillFace} />
  </>
);

/** A segment label copy is either the one read (screen readers, queries) or hidden from them. */
function labelExposure(read: boolean): {
  accessibilityElementsHidden: boolean;
  importantForAccessibility: 'auto' | 'no-hide-descendants';
} {
  return read
    ? { accessibilityElementsHidden: false, importantForAccessibility: 'auto' }
    : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' };
}

/** `${testID}-label` names the copy that is read, `${testID}-label-alt` the other. */
function labelTestID(testID: string | undefined, read: boolean): string | undefined {
  if (!testID) return undefined;
  return read ? `${testID}-label` : `${testID}-label-alt`;
}

const SegmentItem: React.FC<{
  label: string;
  index: number;
  selected: boolean;
  compact: boolean;
  inlinePill: boolean;
  /** Pill position in index units (fill mode); null when nothing is selected. */
  pos: Animated.Value | null;
  reduced: boolean;
  onPress: () => void;
  testID?: string;
  styles: Styles;
  T: Theme;
}> = ({ label, index, selected, compact, inlinePill, pos, reduced, onPress, testID, styles, T }) => {
  const tint = usePressTint();

  // Compact mode: each segment fades its own pill (unequal widths cannot
  // slide one pill on the native driver).
  const fade = useRef(new Animated.Value(selected ? 1 : 0)).current;
  const lastSelected = useRef(selected);
  useEffect(() => {
    if (lastSelected.current === selected) return;
    lastSelected.current = selected;
    if (compact) animateTo(fade, selected ? 1 : 0, 'fast', reduced, { fade: true });
    else fade.setValue(selected ? 1 : 0);
  }, [selected, compact, reduced, fade]);

  // How much of the dark ink on the pill shows (1 on the pill, 0 on the well).
  const onPill = useMemo<Animated.Value | Animated.AnimatedInterpolation<number>>(() => {
    if (compact || !pos) return fade;
    return pos.interpolate({
      inputRange: [index - 1, index, index + 1],
      outputRange: [0, 1, 0],
      extrapolate: 'clamp',
    });
  }, [compact, pos, fade, index]);
  const onWell = useMemo(
    () => onPill.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' }),
    [onPill],
  );

  // Two stacked copies of the label, cross-faded from the pill's own value:
  // the one in the flow is always text2 at `onWell`, the one laid exactly
  // over it always onAction at `onPill`. Neither ink nor opacity binding ever
  // moves between the copies: a swap at the press re-binds the native-driven
  // opacities while the spring runs, and until it ended the pill showed its
  // label in the pill's own colour and the well dark ink on the dark well
  // (neither label could be read). Only which copy
  // screen readers and queries read follows the choice (the one in the ink
  // of the current state, `${testID}-label`); that changes no pixel.
  const pillCopyRead = selected;

  // A press that picks this segment lifts its dimming at once. A quick tap
  // gets its press-out up to 130 ms late, from a timer that the caller's
  // re-render could hold back: the label stayed dim on the pill (a muted
  // brown on the action colour) until the heavy commit was done (LR-3R).
  const press = () => {
    if (!selected) tint.reset();
    onPress();
  };

  return (
    <Pressable
      onPress={press}
      onPressIn={tint.onPressIn}
      onPressOut={tint.onPressOut}
      unstable_pressDelay={PRESS_DELAY_MS}
      // 34dp segment (32 face + the pill's 2dp lip) plus 7 + 7: a 48dp target.
      hitSlop={{ top: 7, bottom: 7 }}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      testID={testID}
      style={compact ? styles.segItemCompact : styles.segItemFill}
    >
      {compact ? (
        <Animated.View
          pointerEvents="none"
          testID={testID ? `${testID}-pill` : undefined}
          style={[styles.pillInline, { opacity: fade }]}
        >
          <PillLayers styles={styles} testID={testID ? `${testID}-pill` : undefined} />
        </Animated.View>
      ) : inlinePill ? (
        <View pointerEvents="none" testID={testID ? `${testID}-pill` : undefined} style={styles.pillInline}>
          <PillLayers styles={styles} testID={testID ? `${testID}-pill` : undefined} />
        </View>
      ) : null}
      <Animated.View
        testID={testID ? `${testID}-labels` : undefined}
        style={[compact ? styles.segFaceCompact : styles.segFace, { opacity: tint.opacity }]}
      >
        <View style={styles.segLabelBox}>
          <Animated.Text
            numberOfLines={1}
            maxFontSizeMultiplier={CONTROL_MAX_FONT_SCALE}
            {...labelExposure(!pillCopyRead)}
            testID={labelTestID(testID, !pillCopyRead)}
            style={[styles.segLabel, { color: T.text2, opacity: onWell }]}
          >
            {label}
          </Animated.Text>
          <Animated.Text
            numberOfLines={1}
            maxFontSizeMultiplier={CONTROL_MAX_FONT_SCALE}
            {...labelExposure(pillCopyRead)}
            testID={labelTestID(testID, pillCopyRead)}
            style={[styles.segLabel, styles.segLabelAlt, { color: T.onAction, opacity: onPill }]}
          >
            {label}
          </Animated.Text>
        </View>
      </Animated.View>
    </Pressable>
  );
};

// ─────────────────────────────────────────────────────────────
// Switch and SwitchRow
// ─────────────────────────────────────────────────────────────

/** How far the knob travels: track 52, knob 22 at 4 from either end. */
const KNOB_TRAVEL = 22;

export interface SwitchProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** The pressable; the knob is `${testID}-thumb`. */
  testID?: string;
}

/**
 * The track and knob, drawn for a value. One native value `v` (0 off, 1 on)
 * slides the knob and cross-fades the on track and the on knob over the off
 * ones, in `DURATION.base`; under reduced motion it jumps.
 */
const SwitchFace: React.FC<{ value: boolean; testID?: string }> = ({ value, testID }) => {
  const T = useT();
  const styles = stylesFor(T);
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(value ? 1 : 0)).current;
  const last = useRef(value);
  useEffect(() => {
    if (last.current === value) return;
    last.current = value;
    animateTo(v, value ? 1 : 0, 'base', reduced);
  }, [value, reduced, v]);
  useEffect(() => () => v.stopAnimation(), [v]);
  const translateX = useMemo(
    () => v.interpolate({ inputRange: [0, 1], outputRange: [0, KNOB_TRAVEL], extrapolate: 'clamp' }),
    [v],
  );
  const thumb = testID ? `${testID}-thumb` : undefined;
  return (
    <View style={styles.sw} testID={testID ? `${testID}-track` : undefined}>
      <View style={[styles.swLayer, styles.swLayerOff]} />
      <Animated.View
        testID={testID ? `${testID}-track-on` : undefined}
        style={[styles.swLayer, styles.swLayerOn, { opacity: v }]}
      />
      <Animated.View testID={thumb} style={[styles.swThumb, { transform: [{ translateX }] }]}>
        <View testID={thumb ? `${thumb}-off` : undefined} style={[styles.swDisc, styles.swDiscOff]} />
        <Animated.View
          testID={thumb ? `${thumb}-on` : undefined}
          style={[styles.swDisc, styles.swDiscOn, { opacity: v }]}
        />
      </Animated.View>
    </View>
  );
};

export const Switch: React.FC<SwitchProps> = ({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
  testID,
}) => (
  <Pressable
    onPress={disabled ? undefined : () => onValueChange(!value)}
    disabled={disabled}
    hitSlop={{ top: 8, bottom: 8 }}
    accessibilityRole="switch"
    accessibilityLabel={accessibilityLabel}
    accessibilityState={{ checked: value, disabled: !!disabled }}
    testID={testID}
    // Dimmed as one group, so the off layers never show through the on ones.
    needsOffscreenAlphaCompositing={!!disabled}
    style={disabled ? { opacity: 0.5 } : undefined}
  >
    <SwitchFace value={value} testID={testID} />
  </Pressable>
);

export interface SwitchRowProps {
  label: string;
  /** Second line under the label. */
  detail?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  /** The row; its label block is `${testID}-text`, the knob `${testID}-thumb`. */
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** A list row whose whole surface toggles the switch. It never moves; the label block dims while pressed. */
export const SwitchRow: React.FC<SwitchRowProps> = ({
  label,
  detail,
  value,
  onValueChange,
  disabled,
  testID,
  style,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const tint = usePressTint(!!disabled);
  return (
    <Pressable
      onPress={disabled ? undefined : () => onValueChange(!value)}
      onPressIn={tint.onPressIn}
      onPressOut={tint.onPressOut}
      unstable_pressDelay={PRESS_DELAY_MS}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      testID={testID}
      needsOffscreenAlphaCompositing={!!disabled}
      style={[styles.swRow, disabled && { opacity: 0.5 }, style]}
    >
      <Animated.View
        testID={testID ? `${testID}-text` : undefined}
        style={[styles.swRowText, { opacity: tint.opacity }]}
      >
        <Text style={styles.swRowLabel}>{label}</Text>
        {detail ? <Text style={styles.swRowDetail}>{detail}</Text> : null}
      </Animated.View>
      {/* Visual only: the row is the control. */}
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <SwitchFace value={value} testID={testID} />
      </View>
    </Pressable>
  );
};

// ─────────────────────────────────────────────────────────────
// Checkbox (one-time agreement, not a setting)
// ─────────────────────────────────────────────────────────────

export interface CheckboxProps {
  checked: boolean;
  onToggle: () => void;
  accessibilityLabel?: string;
  /** The 48dp target; the box is `${testID}-box`. */
  testID?: string;
}

/**
 * A 24dp box with the same geometry in both states: idle a 2dp `text3` ring
 * on no face, checked the action face with an action ring on an `actionLip`
 * bottom edge. It dims while pressed and never moves.
 */
export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onToggle,
  accessibilityLabel,
  testID,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const tint = usePressTint();
  return (
    <Pressable
      onPress={onToggle}
      onPressIn={tint.onPressIn}
      onPressOut={tint.onPressOut}
      // Consent and deletion forms scroll: a swipe over the box never dims it.
      unstable_pressDelay={PRESS_DELAY_MS}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked }}
      testID={testID}
      style={styles.cbTarget}
    >
      <Animated.View
        testID={testID ? `${testID}-box` : undefined}
        style={[styles.cb, checked && styles.cbOn, { opacity: tint.opacity }]}
      >
        {checked ? <Icon name="check" size={16} color={T.onAction} /> : null}
      </Animated.View>
    </Pressable>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    chip: {
      minHeight: 34,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    chipSquare: { minWidth: 36, paddingHorizontal: 6 },
    chipLabel: { fontFamily: T.fontLabel, fontSize: 13, lineHeight: 18 },
    chipCaret: { marginRight: -4 },

    tag: {
      minHeight: TAG_HEIGHT.md,
      borderRadius: TAG_HEIGHT.md / 2,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      alignSelf: 'flex-start',
    },
    tagSmall: { minHeight: TAG_HEIGHT.sm, borderRadius: TAG_HEIGHT.sm / 2, paddingHorizontal: 8 },
    tagLabel: { fontFamily: T.fontLabel, fontSize: 12.5, lineHeight: 17 },
    tagLabelSmall: { fontSize: 11.5, lineHeight: 16 },

    // Well: 4 + pill 32 + its lip 2 + 4 = 42dp.
    seg: {
      flexDirection: 'row',
      borderRadius: T.r.md,
      padding: WELL_PAD,
      gap: SEGMENT_GAP,
    },
    segItemFill: { flex: 1 },
    segItemCompact: { flexShrink: 1 },
    // The label sits on the pill's face; the pill's lip is the 2dp below it.
    segFace: {
      minHeight: 32 + LIP.sm,
      paddingBottom: LIP.sm,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segFaceCompact: {
      minHeight: 32 + LIP.sm,
      paddingBottom: LIP.sm,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Sized by the label in the flow; the other copy fills it exactly.
    segLabelBox: { maxWidth: '100%' },
    segLabel: { fontFamily: T.fontLabel, fontSize: 13, lineHeight: 18 },
    segLabelAlt: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    pillShared: { position: 'absolute', top: WELL_PAD, bottom: WELL_PAD, left: WELL_PAD },
    pillInline: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
    pillLip: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: LIP.sm,
      bottom: 0,
      borderRadius: T.r.sm,
      backgroundColor: T.actionLip,
    },
    pillFace: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: LIP.sm,
      borderRadius: T.r.sm,
      backgroundColor: T.action,
    },

    // Track 52 x 32 with its 2dp lip at the bottom; the knob sits 4 from
    // the top and the left, above the lip.
    sw: {
      width: 52,
      height: 32,
      borderRadius: 32 / 2,
      paddingBottom: LIP.sm,
      justifyContent: 'center',
    },
    swLayer: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      borderRadius: 32 / 2,
      borderBottomWidth: LIP.sm,
    },
    swLayerOff: { backgroundColor: T.line, borderBottomColor: T.lineLip },
    swLayerOn: { backgroundColor: T.action, borderBottomColor: T.actionLip },
    swThumb: { width: 22, height: 22, marginLeft: 4 },
    swDisc: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 22 / 2 },
    swDiscOff: { backgroundColor: T.text3 },
    swDiscOn: { backgroundColor: T.onAction },

    swRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 56,
      paddingVertical: 8,
      paddingHorizontal: T.screenPadH,
    },
    swRowText: { flex: 1, minWidth: 0 },
    swRowLabel: { fontFamily: T.fontLabel, fontSize: 15, lineHeight: 21, color: T.text },
    swRowDetail: {
      fontFamily: T.fontBody,
      fontSize: 12.5,
      lineHeight: 17,
      color: T.text3,
      marginTop: 2,
    },

    cbTarget: { width: T.touch, height: T.touch, alignItems: 'center', justifyContent: 'center' },
    cb: {
      width: 24,
      height: 24,
      borderRadius: T.r.xs,
      borderWidth: T.ring,
      borderColor: T.text3,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    cbOn: { backgroundColor: T.action, borderColor: T.action, borderBottomColor: T.actionLip },
  });

type Styles = ReturnType<typeof makeStyles>;
const stylesFor = themedStyles(makeStyles);
