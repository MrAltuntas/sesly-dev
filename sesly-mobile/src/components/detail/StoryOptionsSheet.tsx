/**
 * StoryOptionsSheet: a short list of `.nr` rows, each one an action on a
 * story. The story detail opens it from its "more" button (change the
 * narrator, add to the queue, ask for another language, report a mistake);
 * a Library row opens it from its visible "more" button, with the story
 * title as the heading. Nothing opens it on a long press.
 *
 * An action that opens something else (a sheet, a dialog, a screen) runs in
 * `onClosed`, after this sheet's exit, never in the tap that closes it.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { RADIUS, SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { BottomSheet, ICON_SIZE_INLINE, Icon } from '../design';
import type { IconName } from '../design';
import { SheetRow } from './SheetRow';

export interface StoryOption {
  readonly key: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly icon: IconName;
  readonly onPress: () => void;
  /** Shown but not tappable (an action that waits for something). */
  readonly disabled?: boolean;
  readonly accessibilityLabel?: string;
}

export interface StoryOptionsSheetProps {
  visible: boolean;
  onClose: () => void;
  options: readonly StoryOption[];
  /** The heading (default "Masal", `detail:more.title`): menus of one story pass its title. */
  title?: string;
  /** Rows of their own after the options (same `SheetRow` geometry). */
  children?: React.ReactNode;
  /** The exit finished: run the action that was picked here. */
  onClosed?: () => void;
  testID?: string;
}

export const StoryOptionsSheet: React.FC<StoryOptionsSheetProps> = ({
  visible,
  onClose,
  options,
  title,
  children,
  onClosed,
  testID = 'story-options-sheet',
}) => {
  const T = useT();
  const { t } = useTranslation('detail');
  const styles = stylesFor(T);
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      title={title ?? t('more.title')}
      testID={testID}
    >
      <View style={styles.list}>
        {options.map(option => (
          <SheetRow
            key={option.key}
            title={option.title}
            subtitle={option.subtitle}
            onPress={option.onPress}
            disabled={option.disabled}
            dimmed={option.disabled}
            accessibilityLabel={option.accessibilityLabel}
            accessibilityState={option.disabled ? { disabled: true } : undefined}
            testID={`story-option-${option.key}`}
            leading={
              <View style={styles.icon} testID={`story-option-${option.key}-tile`}>
                <Icon name={option.icon} size={ICON_SIZE_INLINE} color={T.text} />
              </View>
            }
          />
        ))}
        {children}
      </View>
    </BottomSheet>
  );
};

const stylesFor = themedStyles((T: Theme) =>
  StyleSheet.create({
    list: { gap: SPACE.md, paddingTop: SPACE.xs, paddingBottom: SPACE.xs },
    // The 40dp icon tile of a row card (SPEC-design 1.4), one step below the row.
    icon: {
      width: 40,
      height: 40,
      borderRadius: RADIUS.sm,
      backgroundColor: T.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
  }),
);
