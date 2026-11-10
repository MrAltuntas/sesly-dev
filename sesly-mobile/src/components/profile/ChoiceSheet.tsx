/**
 * ChoiceSheet: a bottom sheet with a single choice list. The profile uses it
 * for "Masal dili" when more than three content languages are enabled (a
 * segmented control would not fit the row).
 *
 * The list sits in the sheet's own scrolling container (`scrollable`), so a
 * long list or a large font scrolls like every other sheet. Each option is a
 * raised card on its lip; the current one carries the action ring and a
 * check in an action-coloured circle.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RADIUS, SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { BottomSheet, Card, Icon } from '../design';

export interface ChoiceOption<V extends string> {
  value: V;
  label: string;
}

export interface ChoiceSheetProps<V extends string> {
  visible: boolean;
  title: string;
  options: readonly ChoiceOption<V>[];
  value: V | null;
  onSelect: (value: V) => void;
  onClose: () => void;
  testID?: string;
}

export function ChoiceSheet<V extends string>({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
  testID,
}: ChoiceSheetProps<V>): React.ReactElement {
  const T = useT();
  const styles = stylesFor(T);
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} scrollable testID={testID}>
      <View accessibilityRole="radiogroup" style={styles.list}>
        {options.map(option => {
          const selected = option.value === value;
          return (
            <Card
              key={option.value}
              tone="raised"
              radius={RADIUS.lg}
              selected={selected}
              onPress={() => {
                if (!selected) onSelect(option.value);
                onClose();
              }}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              testID={testID ? `${testID}-${option.value}` : undefined}
              contentStyle={styles.option}
            >
              <Text style={styles.label}>{option.label}</Text>
              {selected ? (
                <View style={styles.check}>
                  <Icon name="check" size={16} color={T.onAction} />
                </View>
              ) : null}
            </Card>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    list: { gap: SPACE.md },
    // A row card (SPEC-design 1.4): 12 inside the card's 2dp ring, a label
    // without a leading tile is at least a plain row tall.
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.md,
      minHeight: 56,
      paddingVertical: SPACE.md,
      paddingHorizontal: SPACE.md,
    },
    label: { flex: 1, fontFamily: T.fontLabel, fontSize: 15, lineHeight: 21, color: T.text },
    check: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: T.action,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

const stylesFor = themedStyles(makeStyles);

export default ChoiceSheet;
