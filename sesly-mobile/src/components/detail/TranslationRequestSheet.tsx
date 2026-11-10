/**
 * TranslationRequestSheet: "Başka dilde iste".
 *
 * Lists the enabled content languages a tale is not published in, each in
 * its own name. "Çeviri iste" records a request; a requested language shows
 * a check and "İstendi", and tapping it withdraws the request. Changes are
 * optimistic: a failure rolls back and shows a snackbar. A 409
 * TRANSLATION_ALREADY_AVAILABLE means the translation was published in the
 * meantime, so the caller reloads the story.
 *
 * Each language is a `.nr` row of design/v4/playful (its code on a small
 * tile, its own name) with a chunky toggle at the right: "Çeviri iste" on
 * the sheet colour, or "İstendi" on an opaque ready tint with a check (a
 * face is never translucent: its lip would show through it).
 */

import React, { useCallback, useRef } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LIP, RADIUS, SPACE, Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { mix } from '../../theme/color';
import { Avatar, BottomSheet, Icon, Tactile } from '../design';
import { languageCodeLabel } from '../../i18n/text';
import { SheetRow } from './SheetRow';
import StoryService from '../../services/StoryService';
import { isApiError } from '../../services/ApiError';
import { contentLanguageLabel } from '../../hooks/useContentLanguage';
import { showToast } from '../../utils/toast';

export const TRANSLATION_ALREADY_AVAILABLE = 'TRANSLATION_ALREADY_AVAILABLE';

/** The language code tile of a row: the 40dp leading tile of a row card, 12dp corners. */
const LANGUAGE_TILE = 40;

/**
 * Face of a requested toggle: the success colour mixed over surface-2 (an
 * opaque colour, docs/release-pass/SPEC-design.md 1.6.1), so its ready-tint
 * ink stays at 4.5:1 or more. Orijinal keeps its stronger 18 % tint, the
 * alpha of its `chipOkBg`.
 */
export function requestedToggleFace(T: Theme): string {
  return mix(T.success, T.name === 'orijinal' ? 0.18 : 0.12, T.surface2);
}

export interface RequestableLanguage {
  readonly code: string;
  /** The language in its own name ("Deutsch"). */
  readonly nativeName: string;
}

/**
 * The enabled catalogue languages a tale does not exist in yet, catalogue
 * order kept.
 */
export function requestableLanguages<L extends RequestableLanguage>(
  catalogue: readonly L[],
  availableLanguages: readonly string[],
): L[] {
  const published = new Set(availableLanguages.map(code => code.toLowerCase()));
  return catalogue.filter(language => !published.has(language.code.toLowerCase()));
}

export interface TranslationRequestSheetProps {
  visible: boolean;
  onClose: () => void;
  storyId: string;
  /** Languages that can be asked for (see `requestableLanguages`). */
  languages: readonly RequestableLanguage[];
  /** Languages the user already asked for (`story.requestedLanguages`). */
  requestedLanguages: readonly string[];
  /** Called with the new list on every change, including a rollback. */
  onRequestedChange: (requestedLanguages: string[]) => void;
  /** The translation exists already: reload the story. */
  onAlreadyAvailable: (language: string) => void;
}

export const TranslationRequestSheet: React.FC<TranslationRequestSheetProps> = ({
  visible,
  onClose,
  storyId,
  languages,
  requestedLanguages,
  onRequestedChange,
  onAlreadyAvailable,
}) => {
  const T = useT();
  const { t } = useTranslation('detail');
  const styles = stylesFor(T);
  const text = textStylesFor(T);

  // The latest list, so two quick taps on different rows do not overwrite
  // each other and a rollback only touches its own language.
  const latest = useRef<readonly string[]>(requestedLanguages);
  latest.current = requestedLanguages;
  const pending = useRef(new Set<string>());

  const apply = useCallback(
    (code: string, requested: boolean) => {
      const without = latest.current.filter(item => item !== code);
      const next = requested ? [...without, code] : without;
      latest.current = next;
      onRequestedChange(next);
    },
    [onRequestedChange],
  );

  const toggle = useCallback(
    async (code: string) => {
      if (pending.current.has(code)) return;
      const wasRequested = latest.current.includes(code);
      pending.current.add(code);
      apply(code, !wasRequested);
      try {
        if (wasRequested) {
          await StoryService.cancelTranslationRequest(storyId, code);
        } else {
          await StoryService.requestTranslation(storyId, code);
        }
      } catch (error) {
        console.error('Translation request error:', error);
        apply(code, wasRequested);
        if (
          !wasRequested &&
          isApiError(error) &&
          error.status === 409 &&
          error.code === TRANSLATION_ALREADY_AVAILABLE
        ) {
          showToast.info(
            t('requestSheet.alreadyAvailable', { language: contentLanguageLabel(code) }),
          );
          onAlreadyAvailable(code);
        } else {
          showToast.error(t(wasRequested ? 'requestSheet.withdrawFailed' : 'requestSheet.failed'));
        }
      } finally {
        pending.current.delete(code);
      }
    },
    [apply, onAlreadyAvailable, storyId, t],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('requestSheet.title')}
      contentStyle={styles.content}
      testID="translation-request-sheet"
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {languages.map(language => {
          const requested = requestedLanguages.includes(language.code);
          const ink = requested ? T.chipOkFg : T.text;
          return (
            <SheetRow
              key={language.code}
              title={language.nativeName}
              testID={`translation-row-${language.code}`}
              style={styles.row}
              leading={
                <Avatar
                  initial={languageCodeLabel(language.code)}
                  size={LANGUAGE_TILE}
                  shape="rounded"
                  color={T.surface}
                  textColor={T.text2}
                  style={styles.tile}
                />
              }
              trailing={
                <Tactile
                  color={requested ? requestedToggleFace(T) : T.surface}
                  lipColor={T.lip}
                  lip={LIP.sm}
                  radius={RADIUS.sm}
                  onPress={() => void toggle(language.code)}
                  hitSlop={{ top: 4, bottom: 4 }}
                  accessibilityLabel={t(
                    requested ? 'requestSheet.withdrawA11y' : 'requestSheet.requestA11y',
                    { language: language.nativeName },
                  )}
                  accessibilityState={{ selected: requested }}
                  testID={`translation-request-${language.code}`}
                  faceStyle={styles.toggle}
                >
                  <Icon name={requested ? 'check' : 'plus'} size={16} color={ink} />
                  <Text maxFontSizeMultiplier={1.3} style={[styles.toggleLabel, { color: ink }]}>
                    {t(requested ? 'requestSheet.requested' : 'requestSheet.request')}
                  </Text>
                </Tactile>
              }
            />
          );
        })}
        <Text style={[text.bodySmall, styles.note]}>{t('requestSheet.footnote')}</Text>
      </ScrollView>
    </BottomSheet>
  );
};

const stylesFor = themedStyles((T: Theme) =>
  StyleSheet.create({
    content: { paddingHorizontal: 0 },
    scroll: { paddingHorizontal: T.screenPadH, paddingTop: SPACE.xs, paddingBottom: SPACE.xs },
    row: { marginBottom: SPACE.md },
    tile: { borderRadius: RADIUS.sm },
    toggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.tight,
      minHeight: 36,
      paddingHorizontal: SPACE.md,
    },
    toggleLabel: { fontFamily: T.fontLabel, fontSize: 13.5, lineHeight: 18 },
    note: { marginTop: SPACE.tight, marginBottom: SPACE.xs },
  }),
);
