/**
 * SettingRow and SettingsGroup: the settings of the profile screen
 * (design/v4/playful, in the system of the `.nr` rows; the setting row of
 * docs/release-pass/SPEC-design.md 1.4).
 *
 * A group is one surface card on its lip; its rows have the icon in a
 * rounded tile, a Nunito 800 label, then a short value, a control
 * (segmented control) or a chevron. A row has no lip of its own, so a press
 * dims it (`usePressTint`) and never moves it, after the scroll press delay.
 * Rows without an icon can be indented to line up with the labels of the
 * rows that have one (`indent`).
 */

import React from 'react';
import { Animated, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { RADIUS, SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { PRESS_DELAY_MS } from '../../theme/motion';
import { withAlpha } from '../../theme/color';
import { Card, Icon, IconName, usePressTint } from '../design';

/** Side padding of a row inside its card (dp). */
export const ROW_PAD_H = SPACE.md;
/** Edge of the icon tile (dp). */
export const ROW_ICON_TILE = 40;
/** Space between the tile and the label (dp). */
export const ROW_GAP = SPACE.md;
/** Left inset of content that lines up with the labels of rows with an icon. */
export const ROW_LABEL_INSET = ROW_PAD_H + ROW_ICON_TILE + ROW_GAP;
/** A label keeps at least this much before the control wraps under it (dp). */
export const LABEL_MIN_WIDTH = 72;
/** Height of a row with one line of label (dp). */
export const SETTING_ROW_MIN_HEIGHT = 56;
/** Opacity of a disabled row. */
const DISABLED_OPACITY = 0.5;

export interface SettingRowProps {
  label: string;
  icon?: IconName;
  /** Short value before the chevron ("2 yeni", "12,4 MB"). */
  value?: string;
  /** Control at the right (segmented control, spinner). */
  trailing?: React.ReactNode;
  /** The row opens something. */
  chevron?: boolean;
  tone?: 'default' | 'danger';
  /** No icon, label aligned with the labels of rows that have one. */
  indent?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const SettingRow: React.FC<SettingRowProps> = ({
  label,
  icon,
  value,
  trailing,
  chevron,
  tone = 'default',
  indent,
  onPress,
  disabled,
  testID,
  style,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const tint = usePressTint(!onPress || !!disabled);
  const danger = tone === 'danger';
  const content = (
    <>
      {icon ? (
        <View
          style={[styles.tile, danger && { backgroundColor: withAlpha(T.error, 0.14) }]}
          testID={testID ? `${testID}-tile` : undefined}
        >
          <Icon name={icon} size={20} color={danger ? T.error : T.text2} />
        </View>
      ) : null}
      <View style={styles.middle} testID={testID ? `${testID}-label` : undefined}>
        <Text style={[styles.label, danger && { color: T.error }]}>{label}</Text>
      </View>
      {value ? (
        <Text numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {trailing ? (
        <View style={styles.trailing} testID={testID ? `${testID}-trailing` : undefined}>
          {trailing}
        </View>
      ) : null}
      {chevron ? <Icon name="chevronRight" size={20} color={T.text3} /> : null}
    </>
  );
  const rowStyle = [styles.row, indent && styles.indent, style];
  if (!onPress) {
    return (
      <View testID={testID} style={rowStyle}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={tint.onPressIn}
      onPressOut={tint.onPressOut}
      // Inside the scrolling profile: a swipe never dims a row.
      unstable_pressDelay={PRESS_DELAY_MS}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      style={disabled ? styles.disabled : undefined}
    >
      <Animated.View
        testID={testID ? `${testID}-face` : undefined}
        style={[...rowStyle, { opacity: tint.opacity }]}
      >
        {content}
      </Animated.View>
    </Pressable>
  );
};

export interface SettingsGroupProps {
  children: React.ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** One card of settings rows (`.card`, 24dp corners on the neutral lip). */
export const SettingsGroup: React.FC<SettingsGroupProps> = ({ children, testID, style }) => {
  const styles = stylesFor(useT());
  return (
    <Card testID={testID} style={[styles.group, style]} contentStyle={styles.groupContent}>
      {children}
    </Card>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    // The row never grows past the card: the label gives way first, and a
    // control that still does not fit (a segmented control with a large
    // font) wraps under the label instead of running off the right edge.
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      columnGap: ROW_GAP,
      rowGap: SPACE.tight,
      minHeight: SETTING_ROW_MIN_HEIGHT,
      paddingVertical: SPACE.sm,
      paddingHorizontal: ROW_PAD_H,
    },
    indent: { paddingLeft: ROW_LABEL_INSET },
    disabled: { opacity: DISABLED_OPACITY },
    tile: {
      width: ROW_ICON_TILE,
      height: ROW_ICON_TILE,
      borderRadius: RADIUS.sm,
      backgroundColor: T.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    middle: { flexGrow: 1, flexShrink: 1, flexBasis: LABEL_MIN_WIDTH, minWidth: LABEL_MIN_WIDTH },
    // Right-aligned on either line, never wider than the row.
    trailing: { flexShrink: 1, maxWidth: '100%', marginLeft: 'auto' },
    label: { fontFamily: T.fontLabel, fontSize: 15, lineHeight: 21, color: T.text },
    value: { fontFamily: T.fontLabel, fontSize: 13, lineHeight: 18, color: T.text2 },

    group: { marginHorizontal: T.screenPadH, marginBottom: SPACE.lg },
    groupContent: { paddingHorizontal: 0, paddingVertical: SPACE.xs },
  });

const stylesFor = themedStyles(makeStyles);

export default SettingRow;
