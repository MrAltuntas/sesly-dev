/**
 * SteppedSlider: a slider that is a list of choices (the speed sheet).
 *
 * Drawn like the player's progress (design v4 playful, frame d): a fat 12dp
 * track in the line colour, the action fill and the white knob on its lip.
 * The stops sit at equal distances whatever their values; the knob snaps to
 * the nearest one and there is nothing in between. Under each stop a tick
 * and a label, the selected label in the action colour; one stop can be
 * marked (the "Normal" speed): its tick is twice as tall and lighter, and a
 * small note stays under its label whichever stop is selected.
 *
 * Dragging the thumb, tapping the track and tapping a label all select a
 * stop. Screen readers get one adjustable control with increment and
 * decrement.
 *
 * Motion (docs/release-pass/SPEC-design.md 1.7 and 3.9): the knob and the
 * fill move on one native-driven value (transforms only, the fill drawn like
 * `AnimatedFill`): a tap glides in `DURATION.base`, each stop a drag passes
 * in `DURATION.fast`; under reduced motion the knob jumps.
 *
 * The labels block has a fixed height from the font scale (capped at 1.3,
 * like every text in it), so the "Normal" note never runs into the text
 * under the slider.
 */

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
import { Theme, themedStyles, useT } from '../../theme/theme';
import { animateTo, useReducedMotion, type MotionKind } from '../../theme/motion';

/** Distance from the edge of the control to the first and the last stop. */
export const SLIDER_EDGE = 16;
const THUMB = 24;
const THUMB_LIP = 2;
/** The fat track of the player (`.track`, 12dp). */
const RAIL = 12;
const TRACK_BOX = 32;
const LABEL_WIDTH = 46;
const TICK_WIDTH = 3;
/** Line heights of a label and of the note, and the gap between them. */
const LABEL_LINE = 18;
const NOTE_GAP = 2;
const NOTE_LINE = 15;
/** Texts of the slider grow with the font scale up to this much. */
export const SLIDER_MAX_FONT_SCALE = 1.3;

/** Position of stop `index` in a control `width` wide. */
export function stopPosition(index: number, count: number, width: number): number {
  if (count <= 1) return SLIDER_EDGE;
  return SLIDER_EDGE + (index / (count - 1)) * Math.max(0, width - 2 * SLIDER_EDGE);
}

/** The stop nearest to `x` in a control `width` wide. */
export function stopIndexAtX(x: number, count: number, width: number): number {
  const span = width - 2 * SLIDER_EDGE;
  if (count <= 1 || span <= 0) return 0;
  const index = Math.round(((x - SLIDER_EDGE) / span) * (count - 1));
  return Math.min(count - 1, Math.max(0, index));
}

/** Height of the labels block (a label, the gap and the note) at a font scale. */
export function labelsBlockHeight(fontScale: number): number {
  const scale = Math.min(Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1, SLIDER_MAX_FONT_SCALE);
  return Math.ceil((LABEL_LINE + NOTE_GAP + NOTE_LINE) * scale);
}

export interface SteppedSliderProps {
  /** One label per stop, in order. */
  labels: readonly string[];
  /** Selected stop. */
  index: number;
  onChange: (index: number) => void;
  /** Stop with the tall tick and the note. */
  markedIndex?: number;
  /** Note under the marked stop's label ("Normal"). */
  markedNote?: string;
  accessibilityLabel: string;
  testID?: string;
}

export const SteppedSlider: React.FC<SteppedSliderProps> = ({
  labels,
  index,
  onChange,
  markedIndex,
  markedNote,
  accessibilityLabel,
  testID = 'stepped-slider',
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const reduced = useReducedMotion();
  const count = labels.length;
  const [width, setWidth] = useState(0);

  // The knob's centre in dp from the control's left edge. The fill and the
  // knob both follow it on the native driver.
  const knobX = useRef(new Animated.Value(0)).current;
  // How the next index change moves the knob: a tap glides, a drag steps.
  const motion = useRef<MotionKind>('base');
  // The width the knob was placed for; a new width places it without motion.
  const placedWidth = useRef(0);

  // The responder is created once; it reads the latest values from here.
  const live = useRef({ width, count, index, onChange });
  live.current = { width, count, index, onChange };
  const dragStartX = useRef(0);

  const selectAt = (x: number, kind: MotionKind) => {
    const { width: w, count: c, index: current, onChange: emit } = live.current;
    if (w <= 0) return;
    const next = stopIndexAtX(x, c, w);
    if (next === current) return;
    motion.current = kind;
    emit(next);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: event => {
        dragStartX.current = event.nativeEvent.locationX;
        selectAt(dragStartX.current, 'base');
      },
      onPanResponderMove: (_event, gesture) => {
        selectAt(dragStartX.current + gesture.dx, 'fast');
      },
    }),
  ).current;

  const select = (next: number) => {
    if (next === index) return;
    motion.current = 'base';
    onChange(next);
  };

  const step = (delta: number) => select(Math.min(count - 1, Math.max(0, index + delta)));

  // Before the frame is drawn: the first layout (and a new width) places
  // the knob at once, every later change of the stop moves it.
  useLayoutEffect(() => {
    if (width <= 0) return;
    const target = stopPosition(index, count, width);
    if (placedWidth.current !== width) {
      placedWidth.current = width;
      knobX.stopAnimation();
      knobX.setValue(target);
      return;
    }
    const kind = motion.current;
    motion.current = 'base';
    animateTo(knobX, target, kind, reduced);
  }, [index, count, width, knobX, reduced]);

  useLayoutEffect(() => () => knobX.stopAnimation(), [knobX]);

  // The fill is as wide as the track and slides in from the left inside the
  // clipped rail; its right edge is the knob's centre (translateX = x - width).
  const fillX = useMemo(
    () => knobX.interpolate({ inputRange: [0, 1], outputRange: [-width, 1 - width] }),
    [knobX, width],
  );
  const fontScale = PixelRatio.getFontScale();

  return (
    <View testID={testID} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <View
        {...pan.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min: 0, max: count - 1, now: index, text: labels[index] }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'increment') step(1);
          if (event.nativeEvent.actionName === 'decrement') step(-1);
        }}
        testID={`${testID}-track`}
        style={styles.touch}
      >
        <View pointerEvents="none" style={styles.track}>
          <View style={styles.rail} testID={`${testID}-rail`}>
            {width > 0 ? (
              <Animated.View
                testID={`${testID}-fill`}
                style={[styles.fill, { width, transform: [{ translateX: fillX }] }]}
              />
            ) : null}
          </View>
          {width > 0 ? (
            <>
              <Animated.View
                style={[styles.thumbLip, { transform: [{ translateX: knobX }] }]}
                testID={`${testID}-thumb-lip`}
              />
              <Animated.View
                style={[styles.thumb, { transform: [{ translateX: knobX }] }]}
                testID={`${testID}-thumb`}
              />
            </>
          ) : null}
        </View>
        <View pointerEvents="none" style={styles.ticks}>
          {width > 0
            ? labels.map((label, i) => (
                <View
                  key={label}
                  testID={`${testID}-tick-${i}`}
                  style={[
                    styles.tick,
                    i === markedIndex && styles.tickMarked,
                    { left: stopPosition(i, count, width) - TICK_WIDTH / 2 },
                  ]}
                />
              ))
            : null}
        </View>
      </View>

      <View style={[styles.labels, { height: labelsBlockHeight(fontScale) }]} testID={`${testID}-labels`}>
        {labels.map((label, i) => (
          <Pressable
            key={label}
            onPress={() => select(i)}
            hitSlop={{ top: 6, bottom: 6 }}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: i === index }}
            testID={`${testID}-label-${i}`}
            style={[
              styles.label,
              width > 0
                ? { left: stopPosition(i, count, width) - LABEL_WIDTH / 2 }
                : { left: `${(i / Math.max(1, count - 1)) * 100}%`, opacity: 0 },
            ]}
          >
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={SLIDER_MAX_FONT_SCALE}
              style={[styles.labelText, i === index && styles.labelTextOn]}
            >
              {label}
            </Text>
            {i === markedIndex && markedNote ? (
              <Text numberOfLines={1} maxFontSizeMultiplier={SLIDER_MAX_FONT_SCALE} style={styles.note}>
                {markedNote}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    touch: { paddingTop: T.space.xs },
    track: { height: TRACK_BOX, justifyContent: 'center' },
    rail: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: (TRACK_BOX - RAIL) / 2,
      height: RAIL,
      borderRadius: RAIL / 2,
      backgroundColor: T.line,
      overflow: 'hidden',
    },
    fill: {
      position: 'absolute',
      left: 0,
      top: 0,
      height: RAIL,
      borderRadius: RAIL / 2,
      backgroundColor: T.action,
    },
    // The player's knob: a white disc on its own lip, centred on the value.
    thumbLip: {
      position: 'absolute',
      left: -THUMB / 2,
      top: (TRACK_BOX - THUMB) / 2 + THUMB_LIP,
      width: THUMB,
      height: THUMB,
      borderRadius: THUMB / 2,
      backgroundColor: T.knobLip,
    },
    thumb: {
      position: 'absolute',
      left: -THUMB / 2,
      top: (TRACK_BOX - THUMB) / 2,
      width: THUMB,
      height: THUMB,
      borderRadius: THUMB / 2,
      backgroundColor: T.knob,
    },
    ticks: { height: 14, marginTop: T.space.xs },
    tick: {
      position: 'absolute',
      top: 0,
      width: TICK_WIDTH,
      height: 6,
      borderRadius: TICK_WIDTH / 2,
      backgroundColor: T.line,
    },
    tickMarked: { height: 12, backgroundColor: T.text2 },
    labels: { marginTop: T.space.xxs },
    label: { position: 'absolute', top: 0, width: LABEL_WIDTH, alignItems: 'center' },
    labelText: {
      fontFamily: T.fontBody,
      fontSize: 13,
      lineHeight: LABEL_LINE,
      color: T.text3,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
    },
    labelTextOn: { fontFamily: T.fontLabel, color: T.action },
    note: {
      fontFamily: T.fontBody,
      fontSize: 11.5,
      lineHeight: NOTE_LINE,
      color: T.text2,
      marginTop: NOTE_GAP,
      // Wider than the label on purpose; it stays centred under it.
      width: 96,
      textAlign: 'center',
    },
  });

const stylesFor = themedStyles(makeStyles);

export default SteppedSlider;
