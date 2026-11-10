/**
 * MachineTranslationNote: the story page's note under the summary for a text
 * we translated with AI. It says so with the language of the original
 * ("Bu metin İngilizce aslından yapay zekâ ile çevrildi.") and, when the
 * original is published in the same tale, a button that opens it
 * ("Orijinalini aç: The Fox (İngilizce)").
 *
 * The badge in the tags says the same in a few words; this note is the one
 * a reader can act on.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '../design/Button';
import { Icon } from '../design/Icon';
import { SPACE, Theme, themedStyles, useT, useTextStyles } from '../../theme/theme';
import { contentLanguageLabel } from '../../hooks/useContentLanguage';
import i18n from '../../i18n';
import type { StoryTranslationRef } from '../../models/Story';

export interface MachineTranslationNoteProps {
  /** Language of the original (ISO code), when known. */
  fromLanguage: string | null;
  /** The published original in the same tale, when there is one. */
  original: StoryTranslationRef | null;
  /** The original is being opened (the button shows progress). */
  opening?: boolean;
  /** Another language version is being opened. */
  disabled?: boolean;
  onOpenOriginal: (original: StoryTranslationRef) => void;
  testID?: string;
}

/** The sentence of the note, in the UI language. */
export function machineTranslationText(fromLanguage: string | null): string {
  return fromLanguage
    ? i18n.t('detail:machineTranslation.from', { language: contentLanguageLabel(fromLanguage) })
    : i18n.t('detail:machineTranslation.plain');
}

/** "Orijinalini aç: The Fox (İngilizce)". */
export function openOriginalLabel(original: StoryTranslationRef): string {
  return i18n.t('detail:machineTranslation.openOriginal', {
    title: original.title,
    language: contentLanguageLabel(original.language),
  });
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    root: { marginTop: SPACE.md, gap: SPACE.sm },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm },
    // Centred on the first 19dp line of the text.
    icon: { height: 19, justifyContent: 'center' },
    text: { flex: 1, color: T.text2 },
    open: { alignSelf: 'flex-start' },
  });
const stylesFor = themedStyles(makeStyles);

export const MachineTranslationNote: React.FC<MachineTranslationNoteProps> = ({
  fromLanguage,
  original,
  opening,
  disabled,
  onOpenOriginal,
  testID = 'machine-translation-note',
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const text = useTextStyles();
  // Re-render when the UI language changes.
  useTranslation('detail');
  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.row}>
        <View style={styles.icon}>
          <Icon name="aiTranslation" size={16} color={T.warning} />
        </View>
        <Text style={[text.bodySmall, styles.text]} testID={`${testID}-text`}>
          {machineTranslationText(fromLanguage)}
        </Text>
      </View>
      {original ? (
        <Button
          label={openOriginalLabel(original)}
          variant="secondary"
          size="sm"
          icon="language"
          loading={opening}
          disabled={disabled && !opening}
          onPress={() => onOpenOriginal(original)}
          style={styles.open}
          testID={`${testID}-open-original`}
        />
      ) : null}
    </View>
  );
};
