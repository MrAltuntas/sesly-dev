/**
 * Snackbar: one short line at the bottom of the screen with an optional
 * action (frame 26). It replaces the toast that used to drop from the top;
 * `showToast` in utils/toast.ts now routes here.
 *
 *   snackbar.show({ message: 'Parmak Kız kaydedildi', actionLabel: 'Göster', onAction });
 *
 * One snackbar at a time: a new one replaces the current one in place. It
 * sits above the mini player and the navigation bar; the Main shell reports
 * how much room they take through `snackbar.setBottomInset`.
 *
 * A `tone` marks what the message is: a check for 'success', an alert for
 * 'error' and 'warning', each in its colour on a tinted disc before the
 * text, so a confirmation never reads as one more list row. 'neutral' (the
 * default) has no mark.
 *
 * Motion (docs/release-pass/SPEC-design.md 1.7): it rises 16dp into place
 * while it fades in (`DURATION.enter`) and sinks 8dp while it fades out
 * (`DURATION.exit`); the last message stays drawn until it has left. Under
 * reduced motion only the fades run. A leaving bar still takes the touches
 * on its area (its action is off), so a tap aimed at it never lands on the
 * row under it.
 */

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LIP, SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { mix } from '../../theme/color';
import { animateTo, useReducedMotion } from '../../theme/motion';
import { Icon, IconName } from './Icon';

export type SnackbarTone = 'neutral' | 'success' | 'error' | 'warning';

export interface SnackbarOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Milliseconds on screen. Default 4000, or 6000 with an action. */
  duration?: number;
  /** What kind of message it is (the leading mark); default 'neutral', no mark. */
  tone?: SnackbarTone;
}

export interface SnackbarEntry extends SnackbarOptions {
  id: number;
  duration: number;
}

/** Edge of the tinted disc behind a tone's mark, and its glyph (dp). */
export const SNACKBAR_MARK_SIZE = 28;
const MARK_GLYPH = 16;

/** Share of the tone colour in the mark's disc, over the bar's surface-2. */
export const SNACKBAR_MARK_TINT = 0.18;

export interface SnackbarMark {
  icon: IconName;
  /** The glyph: the tone's status colour. */
  ink: string;
  /** The opaque disc behind it. */
  disc: string;
}

/** The leading mark of a tone, or null for a neutral message. */
export function snackbarMark(T: Theme, tone: SnackbarTone | undefined): SnackbarMark | null {
  if (!tone || tone === 'neutral') return null;
  const ink = tone === 'success' ? T.success : tone === 'error' ? T.error : T.warning;
  return { icon: tone === 'success' ? 'check' : 'alert', ink, disc: mix(ink, SNACKBAR_MARK_TINT, T.surface2) };
}

export const SNACKBAR_DURATION = 4000;
export const SNACKBAR_DURATION_WITH_ACTION = 6000;

/** Where the bar rises from (dp below its place) and where it sinks to while leaving. */
export const SNACKBAR_ENTER_OFFSET = 16;
export const SNACKBAR_EXIT_OFFSET = 8;

/** The bar's smallest height, its lip included (one line, or the action's touch height). */
export const SNACKBAR_MIN_HEIGHT = 52;
/** Between the bar and what it stays above (the bottom chrome, the gesture area). */
const SNACKBAR_GAP = 8;
/** The message: one line box and the padding above and below it. */
const MESSAGE_LINE = 20;
const MESSAGE_PAD_V = 12;

/**
 * The bar's `bottom`, dp above the window's bottom edge: above the bottom
 * chrome the Main shell reported, else (and always in a sheet) above the
 * gesture area.
 */
export function snackbarBottom(inSheet: boolean, chromeInset: number, safeBottom: number): number {
  return (!inSheet && chromeInset > 0 ? chromeInset : safeBottom + SNACKBAR_GAP) + SNACKBAR_GAP;
}

/**
 * How far above the window's bottom edge the bar in a sheet reaches, with a
 * gap above it, for a one-line message at this font scale. Sheet content
 * that must stay in reach while a message shows (the queue's empty state
 * after "Sırayı temizle") ends above this.
 */
export function sheetSnackbarClearance(safeBottom: number, fontScale = 1): number {
  const bar = Math.max(
    SNACKBAR_MIN_HEIGHT,
    Math.ceil(MESSAGE_LINE * fontScale) + 2 * MESSAGE_PAD_V + LIP.md,
  );
  return snackbarBottom(true, 0, safeBottom) + bar + SNACKBAR_GAP;
}

interface SnackbarState {
  current: SnackbarEntry | null;
  /** Height of bottom chrome (mini player, navigation bar) to stay above. */
  bottomInset: number;
}

let state: SnackbarState = { current: null, bottomInset: 0 };
let nextId = 1;
const listeners = new Set<() => void>();

function setState(patch: Partial<SnackbarState>): void {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
}

export const snackbar = {
  show(options: SnackbarOptions): number {
    const message = options.message.trim();
    if (!message) return -1;
    const id = nextId++;
    const duration =
      options.duration ??
      (options.actionLabel ? SNACKBAR_DURATION_WITH_ACTION : SNACKBAR_DURATION);
    setState({ current: { ...options, message, id, duration } });
    return id;
  },
  /** Dismiss the current snackbar, or only the one with `id`. */
  dismiss(id?: number): void {
    if (!state.current) return;
    if (id != null && state.current.id !== id) return;
    setState({ current: null });
  },
  setBottomInset(bottomInset: number): void {
    if (state.bottomInset !== bottomInset) setState({ bottomInset });
  },
  getState(): SnackbarState {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/**
 * Mount once, above the navigator (App.tsx).
 *
 * `inSheet`: the copy a BottomSheet mounts inside its own Modal. A Modal is a
 * separate window above the app, so a message shown while a sheet is open
 * (a sample that could not be played) would otherwise sit behind it, unseen.
 */
export const SnackbarHost: React.FC<{ inSheet?: boolean }> = ({ inSheet = false }) => {
  const T = useT();
  const styles = stylesFor(T);
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { current, bottomInset } = useSyncExternalStore(
    snackbar.subscribe,
    snackbar.getState,
    snackbar.getState,
  );

  // The entry on screen: the current one, or the last one while it leaves.
  const [shown, setShown] = useState<SnackbarEntry | null>(current);
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    if (current) setShown(current);
  }

  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(SNACKBAR_ENTER_OFFSET)).current;
  /** The bar is drawn (entering, resting or leaving). */
  const onScreen = useRef(false);

  useEffect(() => {
    if (current) {
      // A fresh bar rises from below; one caught leaving turns back from where it is.
      if (!onScreen.current) {
        translateY.setValue(SNACKBAR_ENTER_OFFSET);
        opacity.setValue(0);
      }
      onScreen.current = true;
      animateTo(translateY, 0, 'enter', reduced);
      animateTo(opacity, 1, 'enter', reduced, { fade: true });
      return;
    }
    if (!onScreen.current) return;
    // Under reduced motion the bar only fades: a sink set at once would jump.
    if (!reduced) animateTo(translateY, SNACKBAR_EXIT_OFFSET, 'exit', reduced);
    animateTo(opacity, 0, 'exit', reduced, {
      fade: true,
      onDone: finished => {
        // Interrupted by a new message: that one takes over the bar.
        if (!finished) return;
        onScreen.current = false;
        setShown(null);
      },
    });
  }, [current, reduced, opacity, translateY]);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => snackbar.dismiss(current.id), current.duration);
    return () => clearTimeout(timer);
  }, [current]);

  useEffect(
    () => () => {
      opacity.stopAnimation();
      translateY.stopAnimation();
    },
    [opacity, translateY],
  );

  if (!shown) return null;

  // Without bottom chrome the snackbar still clears the gesture area.
  const bottom = snackbarBottom(inSheet, bottomInset, insets.bottom);
  // A leaving bar runs no action (it already ran or expired) but still
  // takes the touches on its area, so they never reach the row beneath.
  const leaving = current?.id !== shown.id;
  const mark = snackbarMark(T, shown.tone);
  const id = inSheet ? 'sheet-snackbar' : 'snackbar';

  return (
    <View
      pointerEvents="box-none"
      testID={inSheet ? 'sheet-snackbar-host' : 'snackbar-host'}
      style={[styles.host, { bottom }]}
    >
      <Animated.View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        pointerEvents="auto"
        onStartShouldSetResponder={swallowTouch}
        testID={id}
        style={[styles.bar, { opacity, transform: [{ translateY }] }]}
      >
        {mark ? (
          <View testID={`${id}-mark`} style={[styles.mark, { backgroundColor: mark.disc }]}>
            <Icon name={mark.icon} size={MARK_GLYPH} color={mark.ink} />
          </View>
        ) : null}
        <Text style={[styles.message, shown.actionLabel ? null : styles.messageAlone]}>{shown.message}</Text>
        {shown.actionLabel ? (
          <Pressable
            onPress={() => {
              if (leaving) return;
              const { onAction, id: entryId } = shown;
              snackbar.dismiss(entryId);
              onAction?.();
            }}
            accessibilityRole="button"
            accessibilityLabel={shown.actionLabel}
            testID={`${id}-action`}
            style={styles.action}
          >
            <Text style={styles.actionLabel}>{shown.actionLabel}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
};

/** The bar answers every touch on it itself, so none passes through to what lies under it. */
function swallowTouch(): boolean {
  return true;
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    // The host keeps its elevation: it has no background, so it casts no
    // shadow, and it is what keeps the bar above elevated siblings on Android.
    host: { position: 'absolute', left: T.screenPadH, right: T.screenPadH, zIndex: 100, elevation: 12 },
    // A raised card on its lip, like the mini player (no system shadow:
    // the lip carries the depth).
    bar: {
      minHeight: SNACKBAR_MIN_HEIGHT,
      borderRadius: T.r.md,
      backgroundColor: T.surface2,
      borderBottomWidth: LIP.md,
      borderBottomColor: T.lip,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: SPACE.lg,
      paddingRight: SPACE.xs,
    },
    mark: {
      width: SNACKBAR_MARK_SIZE,
      height: SNACKBAR_MARK_SIZE,
      borderRadius: SNACKBAR_MARK_SIZE / 2,
      marginRight: SPACE.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    message: {
      flex: 1,
      fontFamily: T.fontBody,
      fontSize: 14,
      lineHeight: MESSAGE_LINE,
      color: T.text,
      paddingVertical: MESSAGE_PAD_V,
    },
    // Without an action the text keeps the same 16dp to the right edge as
    // to the left (the bar's own 4dp is the action's inset).
    messageAlone: { paddingRight: SPACE.md },
    action: {
      minHeight: 48,
      minWidth: 48,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionLabel: {
      fontFamily: T.fontLabel,
      fontSize: 14,
      lineHeight: 20,
      color: T.action,
    },
  });

const stylesFor = themedStyles(makeStyles);
