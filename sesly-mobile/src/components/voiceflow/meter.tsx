/**
 * Recording panel meters (playful design): the segmented input level meter
 * (rounded pill segments, no hairlines) with its three labelled zones, and
 * the fat reading-time bar with the "minimum" and "ideal" notches.
 *
 * Both are drawings of values the recording store measures; no threshold or
 * rule lives here.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { RADIUS, Theme, themedStyles, useT } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { Icon } from '../design';
import type { InputLevel } from '../../models/VoiceClone';

/** Small labels under the meters grow with the system font only this far. */
export const METER_LABEL_MAX_SCALE = 1.3;

// ─────────────────────────────────────────────────────────────
// Level meter
// ─────────────────────────────────────────────────────────────

/** Segments of the meter and how many belong to each zone (10 / 14 / 8). */
export const METER_SEGMENTS = 32;
export const METER_ZONES = { quiet: 10, good: 14, loud: 8 } as const;

const METER_FLOOR_DBFS = -60;
const QUIET_END = METER_ZONES.quiet / METER_SEGMENTS;
const GOOD_END = (METER_ZONES.quiet + METER_ZONES.good) / METER_SEGMENTS;

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

/**
 * Position of a dBFS reading on the meter, 0 to 1, so that the fill ends in
 * the zone the reading belongs to: below `quiet` in "Kısık", between the two
 * thresholds in "İyi aralık", above `loud` in "Yüksek". The thresholds are
 * the platform's own (`levelThresholds`), so the drawing agrees with the
 * classification the store makes.
 */
export function zonedMeterFraction(
  dbfs: number,
  thresholds: { quiet: number; loud: number },
): number {
  if (!Number.isFinite(dbfs) || dbfs <= METER_FLOOR_DBFS) return 0;
  const { quiet, loud } = thresholds;
  if (dbfs < quiet) {
    const span = Math.max(quiet - METER_FLOOR_DBFS, 0.001);
    return clamp01((dbfs - METER_FLOOR_DBFS) / span) * QUIET_END;
  }
  if (dbfs < loud) {
    const span = Math.max(loud - quiet, 0.001);
    return QUIET_END + clamp01((dbfs - quiet) / span) * (GOOD_END - QUIET_END);
  }
  const span = Math.max(0 - loud, 0.001);
  return GOOD_END + clamp01((dbfs - loud) / span) * (1 - GOOD_END);
}

/** Colour that stands for a measured level. */
export function levelColor(T: Theme, level: InputLevel): string {
  switch (level) {
    case 'good':
      return T.success;
    case 'quiet':
      return T.catDunya;
    case 'loud':
      return T.error;
    default:
      return T.text2;
  }
}

export interface LevelMeterProps {
  /** "Ses seviyesi". */
  label: string;
  /** State in words at the right ("İyi", "Kayıt başlayınca ölçülür"). */
  stateLabel: string;
  /** Classified level; 'idle' draws an empty meter. */
  level: InputLevel;
  /** A take is running and speech is being measured. */
  active: boolean;
  /** Fill, 0 to 1 (see `zonedMeterFraction`). */
  fraction: number;
  zoneLabels: { quiet: string; good: string; loud: string };
  accessibilityLabel?: string;
  testID?: string;
}

export const LevelMeter: React.FC<LevelMeterProps> = ({
  label,
  stateLabel,
  level,
  active,
  fraction,
  zoneLabels,
  accessibilityLabel,
  testID = 'level-meter',
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const measured = active && level !== 'idle';
  const color = levelColor(T, level);
  const filled = active ? Math.round(clamp01(fraction) * METER_SEGMENTS) : 0;
  const zoneOn = (zone: InputLevel) => measured && level === zone;

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel ?? `${label}: ${stateLabel}`}
      // Never a live region during a take: TalkBack would speak every level
      // change next to the open microphone. The screen announces the level
      // once, after the take.
      accessibilityLiveRegion={active ? 'none' : 'polite'}
    >
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.state}>
          {measured && level === 'good' ? (
            <Icon name="check" size={16} color={color} />
          ) : null}
          <Text
            testID={`${testID}-state`}
            style={[styles.label, measured && { color, fontFamily: T.fontLabel }]}
          >
            {stateLabel}
          </Text>
        </View>
      </View>

      <View style={styles.segments}>
        {Array.from({ length: METER_SEGMENTS }, (_, index) => {
          const on = index < filled;
          return (
            <View
              key={index}
              testID={on ? `${testID}-on` : `${testID}-off`}
              style={[styles.segment, { backgroundColor: on ? color : T.line }]}
            />
          );
        })}
      </View>

      <View style={styles.zones}>
        <Zone flex={METER_ZONES.quiet} label={zoneLabels.quiet} color={zoneOn('quiet') ? T.catDunya : null} styles={styles} />
        <Zone flex={METER_ZONES.good} label={zoneLabels.good} color={zoneOn('good') ? T.success : null} styles={styles} />
        <Zone flex={METER_ZONES.loud} label={zoneLabels.loud} color={zoneOn('loud') ? T.error : null} styles={styles} />
      </View>
    </View>
  );
};

/** A zone label under its share of the meter; the measured zone becomes a tinted pill. */
const Zone: React.FC<{
  flex: number;
  label: string;
  color: string | null;
  styles: ReturnType<typeof makeStyles>;
}> = ({ flex, label, color, styles }) => (
  <View style={[styles.zone, { flex }]}>
    <View style={[styles.zonePill, color ? { backgroundColor: withAlpha(color, 0.18) } : null]}>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={METER_LABEL_MAX_SCALE}
        style={[styles.zoneLabel, color ? [styles.zoneLabelOn, { color }] : null]}
      >
        {label}
      </Text>
    </View>
  </View>
);

// ─────────────────────────────────────────────────────────────
// Reading-time bar
// ─────────────────────────────────────────────────────────────

/** Height of the reading-time track and width of its notches (dp). */
const TRACK = 12;
const MARKER = 8;

export interface TakeProgressProps {
  /** Speech-elapsed share of the maximum, 0 to 1. */
  progress: number;
  /** Position of the minimum on the same scale. */
  minFraction: number;
  /** Position of the ideal length on the same scale. */
  targetFraction: number;
  minLabel: string;
  targetLabel: string;
  /** The minimum is reached: the fill and the minimum notch turn to the "good" colour. */
  reachedMin: boolean;
  /** The ideal length is reached: its notch turns to the "good" colour too. */
  reachedTarget?: boolean;
  /** A take is running: the next mark to reach is highlighted in the action colour. */
  active: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

type MarkState = 'reached' | 'next' | 'idle';

export const TakeProgress: React.FC<TakeProgressProps> = ({
  progress,
  minFraction,
  targetFraction,
  minLabel,
  targetLabel,
  reachedMin,
  reachedTarget = false,
  active,
  accessibilityLabel,
  testID = 'take-progress',
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const value = clamp01(progress);
  const minAt = clamp01(minFraction);
  const targetLeft = `${clamp01(targetFraction) * 100}%` as const;
  // Green only once a mark is reached; while a take runs the next mark to
  // reach is the action colour (a green "ideal" at 0:00 read as reached).
  const minState: MarkState = reachedMin ? 'reached' : active ? 'next' : 'idle';
  const targetState: MarkState = reachedTarget
    ? 'reached'
    : active && reachedMin
      ? 'next'
      : 'idle';
  const markColor = (state: MarkState) =>
    state === 'reached' ? T.success : state === 'next' ? T.action : T.text2;
  const labelStyle = (state: MarkState) =>
    state === 'idle' ? null : { color: markColor(state), fontFamily: T.fontLabel };

  return (
    <View testID={testID} style={styles.progress}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
        style={styles.track}
      >
        <View
          testID={`${testID}-fill`}
          style={[
            styles.fill,
            { width: `${value * 100}%`, backgroundColor: reachedMin ? T.success : T.action },
          ]}
        />
        <View
          testID={`${testID}-min`}
          style={[styles.marker, { left: `${minAt * 100}%`, backgroundColor: markColor(minState) }]}
        />
        <View
          testID={`${testID}-target`}
          style={[styles.marker, { left: targetLeft, backgroundColor: markColor(targetState) }]}
        />
      </View>
      {/* Each label hangs from its own notch, the minimum's ending at it and
          the ideal's starting at it, so the two never meet at any font size. */}
      <View style={styles.markerLabels}>
        {/* The labels are absolute: this blank line holds their height at
            the user's font size. */}
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          maxFontSizeMultiplier={METER_LABEL_MAX_SCALE}
          style={styles.markerSizer}
        >
          {' '}
        </Text>
        <Text
          testID={`${testID}-min-label`}
          numberOfLines={1}
          maxFontSizeMultiplier={METER_LABEL_MAX_SCALE}
          style={[
            styles.markerLabel,
            styles.minLabel,
            { right: `${(1 - minAt) * 100}%` },
            labelStyle(minState),
          ]}
        >
          {minLabel}
        </Text>
        <Text
          testID={`${testID}-target-label`}
          numberOfLines={1}
          maxFontSizeMultiplier={METER_LABEL_MAX_SCALE}
          style={[styles.markerLabel, styles.targetLabel, { left: targetLeft }, labelStyle(targetState)]}
        >
          {targetLabel}
        </Text>
      </View>
    </View>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: T.space.md },
    state: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs, flexShrink: 1 },
    label: { fontFamily: T.fontLabel, fontSize: 13, lineHeight: 18, color: T.text2 },
    segments: { flexDirection: 'row', gap: T.space.xs, height: 16, marginTop: T.space.sm },
    segment: { flex: 1, borderRadius: 4 }, // geometry: a 16dp pill segment
    zones: { flexDirection: 'row', gap: T.space.xs, marginTop: T.space.tight },
    zone: { alignItems: 'center' },
    zonePill: {
      borderRadius: RADIUS.pill,
      paddingHorizontal: T.space.sm,
      paddingVertical: T.space.xxs,
      maxWidth: '100%',
    },
    zoneLabel: {
      fontFamily: T.fontBody,
      fontSize: 11.5,
      lineHeight: 16,
      color: T.text3,
      textAlign: 'center',
    },
    zoneLabelOn: { fontFamily: T.fontLabel },

    progress: { marginTop: T.space.lg },
    track: { height: TRACK, borderRadius: TRACK / 2, backgroundColor: T.line },
    fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: TRACK / 2 },
    // A rounded notch standing on the track, ringed in the panel colour.
    marker: {
      position: 'absolute',
      top: -5, // geometry: the notch stands 5dp above and below the track
      width: MARKER,
      height: TRACK + 10,
      marginLeft: -MARKER / 2,
      borderRadius: MARKER / 2,
      borderWidth: 2,
      borderColor: T.surface,
      backgroundColor: T.text2,
    },
    markerLabels: { marginTop: T.space.sm },
    markerSizer: { fontFamily: T.fontBody, fontSize: 11.5, lineHeight: 17, opacity: 0 },
    markerLabel: {
      position: 'absolute',
      top: 0,
      fontFamily: T.fontBody,
      fontSize: 11.5,
      lineHeight: 17,
      color: T.text2,
    },
    // Ends at the minimum notch.
    minLabel: { marginRight: T.space.xs, textAlign: 'right' },
    // Starts at the ideal notch.
    targetLabel: { marginLeft: T.space.xs, textAlign: 'left' },
  });

const stylesFor = themedStyles(makeStyles);
