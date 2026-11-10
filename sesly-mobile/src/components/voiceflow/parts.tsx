/**
 * Shared pieces of the voice creation flow and the narration wait screen,
 * in the playful design (design/v4/playful: frame e "Sesim", frame f
 * onboarding): the step segments, the big round record button, the sample
 * player, the pinned dock, the own-voice badge, a numbered step and a
 * status line.
 */

import React from 'react';
import { LayoutChangeEvent, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LIP, RADIUS, Theme, dockBottom, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { mix, withAlpha } from '../../theme/color';
import { CircleButton, Icon, IconName, Spinner, Tactile, Waveform } from '../design';

/** "0:18", "1:00". */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────
// Step segments (onboarding `.segs`)
// ─────────────────────────────────────────────────────────────

/** Screens of the clone flow that show the segments: intro, consent, recording. */
export const CLONE_FLOW_STEPS = 3;

export interface FlowStepsProps {
  /** Steps of the flow. */
  total: number;
  /** The current step, 1-based. Done and current steps are filled. */
  current: number;
  /** "Adım 2 / 3" in words; the segments themselves are a drawing. */
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const FlowSteps: React.FC<FlowStepsProps> = ({
  total,
  current,
  accessibilityLabel,
  testID = 'flow-steps',
  style,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  return (
    <View
      testID={testID}
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      style={[styles.segs, style]}
    >
      {Array.from({ length: Math.max(0, total) }, (_, index) => {
        const on = index < current;
        return (
          <View
            key={index}
            testID={on ? `${testID}-on` : `${testID}-off`}
            style={[styles.seg, { backgroundColor: on ? T.action : T.line }]}
          />
        );
      })}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// Record button: one large round button in the recording colour, on its lip
// ─────────────────────────────────────────────────────────────

/** Face of the record button (dp); with its lip and halo the block is 95dp. */
export const RECORD_SIZE = 80;
/** Objects 72dp and taller sit on the large lip (SPEC-design 1.3). */
const RECORD_LIP = LIP.lg;
/** The soft ring of the recording colour around the face while a take runs. */
const RECORD_HALO = 6;

/** The darker under-edge of the record button (the palettes carry no rec lip). */
export function recordLip(T: Theme): string {
  return mix(T.rec, 0.62, T.lip);
}

export interface RecordButtonProps {
  /** A take runs: the glyph is the stop square, otherwise the microphone. */
  recording: boolean;
  onPress: () => void;
  /** Hard block: the press does nothing (microphone starting, no permission). */
  disabled?: boolean;
  /** Draw the hard block as unavailable (no permission). */
  dimmed?: boolean;
  /**
   * Soft block: announced as disabled, but the press still reaches the
   * handler so it can explain why (stop before the minimum).
   */
  softLocked?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
}

export const RecordButton: React.FC<RecordButtonProps> = ({
  recording,
  onPress,
  disabled,
  dimmed,
  softLocked,
  accessibilityLabel,
  accessibilityHint,
  testID = 'record-button',
}) => {
  const T = useT();
  const styles = stylesFor(T);
  return (
    // A soft ring of the recording colour while a take runs.
    <View testID={`${testID}-halo`} style={[styles.recHalo, recording && styles.recHaloOn]}>
      <Tactile
        color={T.rec}
        lipColor={recordLip(T)}
        lip={RECORD_LIP}
        radius={RECORD_SIZE / 2}
        onPress={onPress}
        // Pinned under the script, not in scrolling content: it answers at
        // touch-down.
        pressDelay={0}
        // Pressable lets a non-null `disabled` override
        // accessibilityState.disabled, so it is only set for the hard block.
        disabled={disabled ? true : undefined}
        // Never dimmed while a take runs: the button must not read as broken.
        dimWhenDisabled={!!dimmed}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: !!disabled || !!softLocked }}
        testID={testID}
        faceStyle={styles.recFace}
      >
        {recording ? (
          <View testID={`${testID}-stop`} style={styles.recStop} />
        ) : (
          <Icon name="mic" size={32} color={T.onRec} testID={`${testID}-mic`} />
        )}
      </Tactile>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// Sample player: round play button, waveform, time
// ─────────────────────────────────────────────────────────────

export interface SamplePlayerProps {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  /** Played share, 0 to 1. */
  progress?: number;
  /** "0:31" or "0:04 / 0:12"; left out when the length is not known. */
  timeLabel?: string | null;
  busy?: boolean;
  disabled?: boolean;
  bars?: number;
  seed?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const SamplePlayer: React.FC<SamplePlayerProps> = ({
  icon,
  onPress,
  accessibilityLabel,
  progress = 0,
  timeLabel,
  busy,
  disabled,
  bars = 40,
  seed = 7,
  testID = 'sample-player',
  style,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  return (
    <View testID={testID} style={[styles.player, style]}>
      <CircleButton
        icon={icon}
        variant="action"
        size={52}
        onPress={onPress}
        busy={busy}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel}
        testID={`${testID}-button`}
      />
      <Waveform
        bars={bars}
        height={40}
        progress={progress}
        seed={seed}
        playedColor={T.action}
        testID={`${testID}-wave`}
      />
      {timeLabel ? (
        <Text testID={`${testID}-time`} style={styles.playerTime}>
          {timeLabel}
        </Text>
      ) : null}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// Dock: the pinned bottom area
// ─────────────────────────────────────────────────────────────

export interface FlowDockProps {
  /**
   * 'surface': the canvas colour, so scrolled content never shows through
   * (intro, consent). 'plain': transparent (processing, success).
   * Neither draws a line: the playful design has no hairlines.
   */
  variant?: 'surface' | 'plain';
  children: React.ReactNode;
  /** The measured dock (a keyboard-aware scroll keeps the field above it). */
  onLayout?: (event: LayoutChangeEvent) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** The dock rule: 8 above the buttons, `dockBottom` under them (SPEC-design 1.1). */
export const FlowDock: React.FC<FlowDockProps> = ({
  variant = 'surface',
  children,
  onLayout,
  testID,
  style,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const insets = useSafeAreaInsets();
  return (
    <View
      testID={testID}
      onLayout={onLayout}
      style={[
        styles.dock,
        { paddingBottom: dockBottom(insets.bottom) },
        variant === 'surface' ? styles.dockSurface : null,
        style,
      ]}
    >
      {children}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// Own-voice badge: the initial or the wave on the own colour, on its lip
// ─────────────────────────────────────────────────────────────

/** Default face of the own-voice badge (dp); with its halo and lip 99dp tall. */
export const FLOW_AVATAR_SIZE = 72;
const FLOW_AVATAR_HALO = 12;

export interface FlowAvatarProps {
  /** Initial of the voice. */
  initial?: string;
  /** A glyph instead of the initial (the ready voice: wave). Wins over `initial`. */
  icon?: IconName;
  size?: number;
  testID?: string;
}

export const FlowAvatar: React.FC<FlowAvatarProps> = ({
  initial,
  icon,
  size = FLOW_AVATAR_SIZE,
  testID = 'flow-avatar',
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const fontSize = Math.round(size * 0.42);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={`${testID}-halo`}
      style={[styles.avatarHalo, { borderRadius: size / 2 + FLOW_AVATAR_HALO }]}
    >
      <Tactile
        color={T.own}
        lipColor={T.ownLip}
        lip={LIP.lg}
        radius={size / 2}
        testID={testID}
        faceStyle={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      >
        {icon ? (
          <Icon name={icon} size={Math.round(size * 0.46)} color={T.onCat} testID={`${testID}-icon`} />
        ) : (
          <Text
            style={{
              fontFamily: T.fontDisplay,
              fontSize,
              lineHeight: Math.ceil(fontSize * 1.32),
              color: T.onCat,
            }}
          >
            {initial}
          </Text>
        )}
      </Tactile>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// Numbered step (intro)
// ─────────────────────────────────────────────────────────────

export const StepRow: React.FC<{ index: number; title: string; body: string; testID?: string }> = ({
  index,
  title,
  body,
  testID,
}) => {
  const T = useT();
  const text = textStylesFor(T);
  const styles = stylesFor(T);
  return (
    <View testID={testID} style={styles.step}>
      <View testID={testID ? `${testID}-badge` : undefined} style={styles.stepBadge}>
        <Text style={styles.stepNumber}>{index}</Text>
      </View>
      <View style={styles.stepText}>
        <Text style={text.subheading}>{title}</Text>
        <Text style={[text.bodySmall, styles.stepBody]}>{body}</Text>
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// Status and check lines (processing, review)
// ─────────────────────────────────────────────────────────────

/**
 * 'done': check in the good colour. 'active': spinner in the action colour,
 * muted text. 'pending': a step that has not started yet (a quiet dot, the
 * faintest text), so two lines in a row never spin at once.
 */
export type StatusLineState = 'done' | 'active' | 'pending';

export interface StatusLineProps {
  state: StatusLineState;
  label: string;
  /** Compact: the smaller check lines of the review panel. */
  compact?: boolean;
  testID?: string;
}

/** The centre dot of a pending status line (dp). */
const PENDING_DOT = 6;

export const StatusLine: React.FC<StatusLineProps> = ({ state, label, compact, testID }) => {
  const T = useT();
  const styles = stylesFor(T);
  const dot = compact ? 24 : 30;
  const iconSize = compact ? 14 : 17;
  const done = state === 'done';
  const sub = (part: string) => (testID ? `${testID}-${part}` : undefined);
  return (
    <View testID={testID} style={[styles.status, compact && styles.statusCompact]}>
      <View
        testID={sub('dot')}
        style={[
          styles.statusDot,
          {
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: done ? withAlpha(T.success, 0.18) : T.surface2,
          },
        ]}
      >
        {done ? (
          <Icon name="check" size={iconSize} color={T.success} testID={sub('check')} />
        ) : state === 'active' ? (
          <Spinner size={iconSize} color={T.action} testID={sub('spinner')} />
        ) : (
          <View testID={sub('pending')} style={styles.statusPending} />
        )}
      </View>
      <Text
        style={[
          compact ? styles.statusLabelCompact : styles.statusLabel,
          state === 'active' ? { color: T.text2 } : state === 'pending' ? { color: T.text3 } : null,
        ]}
      >
        {label}
      </Text>
    </View>
  );
};

const STEP_BADGE = 40;
const SEG_HEIGHT = 9;

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    segs: { flexDirection: 'row', gap: T.space.tight },
    seg: { width: 30, height: SEG_HEIGHT, borderRadius: SEG_HEIGHT / 2 },

    recHalo: {
      alignSelf: 'center',
      padding: RECORD_HALO,
      borderRadius: (RECORD_SIZE + 2 * RECORD_HALO) / 2,
    },
    recHaloOn: { backgroundColor: withAlpha(T.rec, 0.2) },
    recFace: {
      width: RECORD_SIZE,
      height: RECORD_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
    },
    recStop: { width: 26, height: 26, borderRadius: RADIUS.xs, backgroundColor: T.onRec },

    player: { flexDirection: 'row', alignItems: 'center', gap: T.space.md },
    playerTime: {
      fontFamily: T.fontLabel,
      fontSize: 12.5,
      lineHeight: 17,
      color: T.text2,
      fontVariant: ['tabular-nums'],
    },

    dock: { paddingHorizontal: T.screenPadH, paddingTop: T.space.sm },
    dockSurface: { backgroundColor: T.bg },

    avatarHalo: {
      padding: FLOW_AVATAR_HALO,
      backgroundColor: withAlpha(T.own, 0.14),
      alignSelf: 'center',
    },

    step: { flexDirection: 'row', alignItems: 'flex-start', gap: T.space.md },
    stepBadge: {
      width: STEP_BADGE,
      height: STEP_BADGE,
      borderRadius: T.r.sm,
      backgroundColor: T.own,
      borderBottomWidth: T.lipSize.sm,
      borderBottomColor: T.ownLip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepNumber: { fontFamily: T.fontDisplay, fontSize: 18, lineHeight: 24, color: T.onCat },
    stepText: { flex: 1, minWidth: 0, paddingTop: T.space.xxs },
    stepBody: { marginTop: T.space.xxs },

    status: { flexDirection: 'row', alignItems: 'center', gap: T.space.md, minHeight: 34 },
    statusCompact: { gap: T.space.sm, minHeight: 26 },
    statusDot: { alignItems: 'center', justifyContent: 'center' },
    statusPending: {
      width: PENDING_DOT,
      height: PENDING_DOT,
      borderRadius: PENDING_DOT / 2,
      backgroundColor: T.text3,
    },
    statusLabel: { flex: 1, fontFamily: T.fontLabel, fontSize: 14.5, lineHeight: 20, color: T.text },
    statusLabelCompact: { flex: 1, fontFamily: T.fontBody, fontSize: 13.5, lineHeight: 19, color: T.text },
  });

const stylesFor = themedStyles(makeStyles);
