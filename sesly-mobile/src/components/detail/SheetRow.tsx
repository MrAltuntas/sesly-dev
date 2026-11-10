/**
 * Rows of the detail sheets (narrator sheet, translation requests, story
 * options): the `.nr` card of design/v4/playful, raised on the sheet.
 *
 * A sheet is the surface colour, so its rows are surface-2 on their lip; a
 * selected row colours the action ring and the action lip. The 2dp ring is
 * always there (transparent while not selected), so selecting a row never
 * moves its content. A dimmed row (another row is busy) fades as one layer.
 * `SampleButton` is the round play / pause button of a row (`.pb`): its face
 * is the sheet's surface colour so it stands out on a surface-2 row, and the
 * action colour while its sample plays.
 *
 * Both are memoised: a long sheet re-renders only the rows whose props
 * changed (V3-02), as long as the caller passes stable callbacks.
 */

import React from 'react';
import { AccessibilityRole, AccessibilityState, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { LIP, RADIUS, SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { CircleButton, Icon, Tactile } from '../design';

/** Least face height of a row: a 40dp leading tile plus the 12dp padding (SPEC-design 1.4). */
export const SHEET_ROW_MIN_HEIGHT = 64;

export interface SheetRowProps {
  title: string;
  subtitle?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** Dim the row while another row is busy (without disabling its look). */
  dimmed?: boolean;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const SheetRowBase: React.FC<SheetRowProps> = ({
  title,
  subtitle,
  leading,
  trailing,
  selected = false,
  onPress,
  disabled,
  dimmed,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityState,
  testID,
  style,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  return (
    <Tactile
      color={T.surface2}
      lipColor={selected ? T.actionLip : T.lip}
      borderColor={selected ? T.action : 'transparent'}
      borderWidth={T.ring}
      radius={RADIUS.lg}
      lip={LIP.md}
      onPress={onPress}
      disabled={disabled}
      dimWhenDisabled={false}
      dimmed={dimmed}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(', ')}
      accessibilityState={accessibilityState}
      testID={testID}
      style={style}
      faceStyle={styles.row}
    >
      {leading}
      <View style={styles.text}>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Tactile>
  );
};

export const SheetRow = React.memo(SheetRowBase);
SheetRow.displayName = 'SheetRow';

/** The small check badge of a selected row or card (`.nc .ok`). */
export const CheckBadge: React.FC<{ size?: number; testID?: string; style?: StyleProp<ViewStyle> }> = ({
  size = 22,
  testID,
  style,
}) => {
  const T = useT();
  return (
    <View
      testID={testID}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: T.action,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Icon name="check" size={Math.round(size * 0.7)} color={T.onAction} />
    </View>
  );
};

/** Diameter of a row's sample button (`.nr .pb`). */
export const SAMPLE_BUTTON_SIZE = 42;

/**
 * Face height of a row whose tallest part is `content` dp tall: the 12dp
 * padding and the 2dp ring around it, never under the row minimum. A
 * skeleton of the row uses it, so the real row lands on the same height.
 */
export function sheetRowHeight(content: number, ring: number): number {
  return Math.max(SHEET_ROW_MIN_HEIGHT, content + 2 * SPACE.md + 2 * ring);
}

export interface SampleButtonProps {
  playing: boolean;
  busy?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  /** Visible diameter (default `SAMPLE_BUTTON_SIZE`). */
  size?: number;
  /** 'surface' on a surface-2 row (default), 'neutral' (surface-2) on a surface card. */
  variant?: 'surface' | 'neutral';
  testID?: string;
}

const SampleButtonBase: React.FC<SampleButtonProps> = ({
  playing,
  busy = false,
  onPress,
  accessibilityLabel,
  size = SAMPLE_BUTTON_SIZE,
  variant = 'surface',
  testID,
}) => (
  <CircleButton
    icon={playing ? 'pause' : 'play'}
    variant={playing ? 'action' : variant}
    size={size}
    busy={busy}
    onPress={onPress}
    accessibilityLabel={accessibilityLabel}
    testID={testID}
  />
);

export const SampleButton = React.memo(SampleButtonBase);
SampleButton.displayName = 'SampleButton';

const stylesFor = themedStyles((T: Theme) =>
  StyleSheet.create({
    // The row-card padding inside the 2dp ring, the same in both states.
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.md,
      minHeight: SHEET_ROW_MIN_HEIGHT,
      paddingVertical: SPACE.md,
      paddingHorizontal: SPACE.md,
    },
    text: { flex: 1, minWidth: 0 },
    title: { fontFamily: T.fontLabel, fontSize: 15, lineHeight: 21, color: T.text },
    // Never text-3 on surface-2.
    subtitle: { fontFamily: T.fontBody, fontSize: 12.5, lineHeight: 17, color: T.text2, marginTop: SPACE.xxs },
  }),
);
