/**
 * Full-screen states (design v4 playful, in the system of `StateView`).
 *
 * `StateBody` is the centred block: the round `StateIcon` badge on its lip,
 * a Baloo 2 title, one Nunito sentence, one button, and an optional small
 * line under it (`note`, a way forward when there is no button). Unlike
 * `StateView` it takes the button variant and a loading flag.
 *
 * `FullScreenState` is the whole screen: the brand bar (Sesly mark and
 * wordmark) at the top, then the block. Used when the app cannot go on
 * (offline, update required), so there is no back button.
 */

import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SPACE, textStylesFor, useT } from '../../theme/theme';
import { Button, ButtonVariant } from '../design/Button';
import { IconName } from '../design/Icon';
import { StateIcon, TopAppBar } from '../design/rows';

export interface StateAction {
  label: string;
  onPress: () => void;
  /** Default 'primary'; the empty notification list uses 'secondary'. */
  variant?: ButtonVariant;
  /** Leading icon of the button. */
  icon?: IconName;
  loading?: boolean;
  testID?: string;
}

export interface StateBodyProps {
  icon: IconName;
  title: string;
  message?: string;
  action?: StateAction;
  /** A small line under the block (bodySmall, text2). */
  note?: string;
  noteTestID?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const StateBody: React.FC<StateBodyProps> = ({
  icon,
  title,
  message,
  action,
  note,
  noteTestID,
  testID,
  style,
}) => {
  const text = textStylesFor(useT());
  return (
    <View testID={testID} style={[styles.body, style]}>
      <StateIcon icon={icon} />
      <Text accessibilityRole="header" style={[text.heading, styles.title]}>
        {title}
      </Text>
      {message ? <Text style={[text.body, styles.message]}>{message}</Text> : null}
      {action ? (
        <Button
          label={action.label}
          onPress={action.onPress}
          variant={action.variant ?? 'primary'}
          icon={action.icon}
          loading={action.loading}
          testID={action.testID}
          style={styles.action}
        />
      ) : null}
      {note ? (
        <Text testID={noteTestID} style={[text.bodySmall, styles.note]}>
          {note}
        </Text>
      ) : null}
    </View>
  );
};

export interface FullScreenStateProps extends StateBodyProps {}

export const FullScreenState: React.FC<FullScreenStateProps> = ({ testID, style, ...body }) => {
  const T = useT();
  const insets = useSafeAreaInsets();
  return (
    <View testID={testID} style={[{ flex: 1, backgroundColor: T.bg, paddingBottom: insets.bottom }, style]}>
      <TopAppBar variant="brand" />
      <StateBody {...body} />
    </View>
  );
};

// No colours here (they come from the text styles), so one sheet serves every palette.
const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // Line length of a centred state; the block sits 16dp above the centre
    // (32 more padding below than above).
    paddingHorizontal: SPACE.xxxl,
    paddingTop: 0,
    paddingBottom: SPACE.xxxl,
  },
  title: { marginTop: SPACE.xl, textAlign: 'center' },
  message: { marginTop: SPACE.sm, maxWidth: 300, textAlign: 'center' },
  action: { marginTop: SPACE.xxl, alignSelf: 'center', minWidth: 180 },
  note: { marginTop: SPACE.lg, maxWidth: 300, textAlign: 'center' },
});

export default FullScreenState;
