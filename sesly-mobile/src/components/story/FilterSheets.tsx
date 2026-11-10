/**
 * The picker sheets of Keşfet: language (multi, used once the catalogue has
 * more languages than fit as chips on the filter card) and sort (single).
 *
 * The playful mockup does not draw them, so they follow its sheet: a
 * Baloo 2 title, rounded option rows inside the sheet's gutter (a picked row
 * is raised and carries a check in an action-coloured disc; a held row dims,
 * it never moves), and every tap applies at once. There is no "Uygula" or
 * "Vazgeç"; the sheet closes on the scrim, the handle or the back button. A
 * single choice closes the sheet itself, a multi choice stays open. Level
 * and age are picked with chips on the filter card.
 */

import React from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BottomSheet, Icon, usePressTint } from '../design';
import { RADIUS, SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import type { StorySort } from '../../services/StoryService';
import type { CatalogueLanguage } from '../../models/Story';
import i18n from '../../i18n';

// ─────────────────────────────────────────────────────────────
// OptionSheet
// ─────────────────────────────────────────────────────────────

export interface SheetOption {
  value: string;
  label: string;
}

export interface OptionSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: readonly SheetOption[];
  /** Picked values. A single choice holds one. */
  selected: readonly string[];
  onSelect: (value: string) => void;
  /** Several rows can be picked; the sheet stays open. */
  multiple?: boolean;
  testID?: string;
}

export const OptionSheet: React.FC<OptionSheetProps> = ({
  visible,
  onClose,
  title,
  options,
  selected,
  onSelect,
  multiple,
  testID = 'option-sheet',
}) => {
  const styles = stylesFor(useT());
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} testID={testID}>
      <ScrollView
        accessibilityRole={multiple ? undefined : 'radiogroup'}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      >
        {options.map(option => (
          <OptionRow
            key={option.value}
            label={option.label}
            picked={selected.includes(option.value)}
            multiple={!!multiple}
            onPress={() => {
              onSelect(option.value);
              if (!multiple) onClose();
            }}
            testID={`${testID}-${option.value || 'none'}`}
          />
        ))}
      </ScrollView>
    </BottomSheet>
  );
};

/** One option: a flat row, raised once picked, that dims while held. */
const OptionRow: React.FC<{
  label: string;
  picked: boolean;
  multiple: boolean;
  onPress: () => void;
  testID: string;
}> = ({ label, picked, multiple, onPress, testID }) => {
  const T = useT();
  const styles = stylesFor(T);
  const { opacity, onPressIn, onPressOut } = usePressTint();
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole={multiple ? 'checkbox' : 'radio'}
      accessibilityLabel={label}
      accessibilityState={multiple ? { checked: picked } : { selected: picked }}
      testID={testID}
      style={[styles.row, picked && styles.rowPicked]}
    >
      <Animated.View testID={`${testID}-body`} style={[styles.rowBody, { opacity }]}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        {picked ? (
          <View style={styles.check} testID={`${testID}-check`}>
            <Icon name="check" size={16} color={T.onAction} />
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
};

// ─────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────

const SORT_KEYS: Record<StorySort, string> = {
  newest: 'sort.newest',
  oldest: 'sort.oldest',
  title: 'sort.byTitle',
  duration: 'sort.duration',
  level: 'sort.level',
};

/** Name of a sort order; the default order is "Önerilen". */
export function sortLabel(sort: StorySort | null): string {
  return i18n.t(`discover:${sort ? SORT_KEYS[sort] : 'sort.recommended'}`);
}

/** Chip label: the bare name, or "Dil: Türkçe, English" once something is picked. */
export function filterChipLabel(name: string, picked: readonly string[]): string {
  if (picked.length === 0) return name;
  return `${name}: ${picked.join(', ')}`;
}

// ─────────────────────────────────────────────────────────────
// The sheets
// ─────────────────────────────────────────────────────────────

interface SheetBase {
  visible: boolean;
  onClose: () => void;
}

export const LanguageFilterSheet: React.FC<
  SheetBase & {
    languages: readonly Pick<CatalogueLanguage, 'code' | 'nativeName'>[];
    selected: readonly string[];
    onToggle: (code: string) => void;
  }
> = ({ visible, onClose, languages, selected, onToggle }) => {
  const { t } = useTranslation('discover');
  return (
    <OptionSheet
      visible={visible}
      onClose={onClose}
      title={t('filters.language')}
      options={languages.map(language => ({ value: language.code, label: language.nativeName }))}
      selected={selected}
      onSelect={onToggle}
      multiple
      testID="language-sheet"
    />
  );
};

export const SortSheet: React.FC<
  SheetBase & {
    sorts: readonly (StorySort | null)[];
    selected: StorySort | null;
    onSelect: (sort: StorySort | null) => void;
  }
> = ({ visible, onClose, sorts, selected, onSelect }) => {
  const { t } = useTranslation('discover');
  return (
    <OptionSheet
      visible={visible}
      onClose={onClose}
      title={t('sort.title')}
      options={sorts.map(sort => ({ value: sort ?? '', label: sortLabel(sort) }))}
      selected={[selected ?? '']}
      onSelect={value => onSelect(sorts.find(sort => sort === value) ?? null)}
      testID="sort-sheet"
    />
  );
};

/** Edge of the check disc of a picked row (the checkbox size). */
const CHECK_SIZE = 24;
/** A plain row (SPEC-design 1.4). */
export const OPTION_ROW_MIN_HEIGHT = 56;

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    list: { gap: SPACE.tight, paddingBottom: SPACE.xs },
    // A plain row (minHeight 56, sides 16, gap 12) inside the sheet's gutter
    // like the rows of the other sheets, so a picked row's fill never runs to
    // the screen edge.
    row: {
      minHeight: OPTION_ROW_MIN_HEIGHT,
      justifyContent: 'center',
      paddingHorizontal: SPACE.lg,
      paddingVertical: SPACE.sm,
      borderRadius: RADIUS.md,
    },
    rowPicked: { backgroundColor: T.surface2 },
    rowBody: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
    label: {
      flex: 1,
      minWidth: 0,
      fontFamily: T.fontLabel,
      fontSize: 15,
      lineHeight: 21,
      color: T.text,
    },
    check: {
      width: CHECK_SIZE,
      height: CHECK_SIZE,
      borderRadius: CHECK_SIZE / 2,
      backgroundColor: T.action,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

const stylesFor = themedStyles(makeStyles);
