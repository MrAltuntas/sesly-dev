/**
 * Small pieces the auth screens and the reset sheet share: the form-level
 * error line, the "ya da" divider, the sentence with the Terms and Privacy
 * links, and the EMAIL_IN_USE dialog.
 *
 * Errors are shown once (docs/release-pass/SPEC-startup.md 7.4): a field
 * error under its field, anything without a field (no connection, too many
 * attempts) in the one form-level line directly above the submit button.
 */

import React, { useEffect } from 'react';
import {
  AccessibilityInfo,
  Platform,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
} from 'react-native';
import { Trans, useTranslation } from 'react-i18next';
import { SPACE, Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { LegalSlug } from '../../models/Legal';
import { useDialog } from '../../hooks/useDialog';

// ─────────────────────────────────────────────────────────────
// Form-level error line
// ─────────────────────────────────────────────────────────────

interface FormErrorLineProps {
  message: string | null;
  /**
   * `login-form-error`, `register-form-error`, `reset-form-error`,
   * `register-consent-error` (the text; its region is `${testID}-region`).
   */
  testID: string;
  /** Replaces the line's text style (the consent error under the checkbox). */
  textStyle?: StyleProp<TextStyle>;
}

/**
 * Nothing visible without a message; read out politely when one appears.
 * The live region stays mounted: Android reads out a change inside a live
 * region, not a view that arrives with one. iOS has no live regions, so the
 * new message is announced.
 */
export const FormErrorLine: React.FC<FormErrorLineProps> = ({ message, testID, textStyle }) => {
  const T = useT();
  const styles = stylesFor(T);
  useEffect(() => {
    if (message && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  return (
    <View accessibilityLiveRegion="polite" collapsable={false} testID={`${testID}-region`}>
      {message ? (
        <Text style={textStyle ?? styles.formError} testID={testID}>
          {message}
        </Text>
      ) : null}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// "ya da" divider
// ─────────────────────────────────────────────────────────────

export const OrDivider: React.FC<{ testID?: string }> = ({ testID }) => {
  const T = useT();
  const { t } = useTranslation('auth');
  const styles = stylesFor(T);
  const text = textStylesFor(T);
  return (
    <View style={styles.or} testID={testID}>
      <View style={styles.orLine} />
      <Text style={text.meta}>{t('or')}</Text>
      <View style={styles.orLine} />
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// Sentence with the Terms and Privacy links
// ─────────────────────────────────────────────────────────────

interface LegalLinksTextProps {
  /** `login.legal` (the notice line) or `register.consent` (the checkbox sentence). */
  i18nKey: 'login.legal' | 'register.consent';
  onOpen: (slug: LegalSlug) => void;
  style: StyleProp<TextStyle>;
  linkStyle: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * The sentence itself does nothing when pressed; each link is its own
 * accessibility link (RN exposes nested spans only with the link role), so
 * a screen reader opens the document instead of reading one long text.
 */
export const LegalLinksText: React.FC<LegalLinksTextProps> = ({
  i18nKey,
  onOpen,
  style,
  linkStyle,
  testID,
}) => {
  const { t } = useTranslation('auth');
  return (
    <Text style={style} testID={testID}>
      <Trans
        t={t}
        i18nKey={i18nKey}
        components={{
          tos: <Text accessibilityRole="link" style={linkStyle} onPress={() => onOpen('tos')} />,
          privacy: (
            <Text accessibilityRole="link" style={linkStyle} onPress={() => onOpen('privacy')} />
          ),
        }}
      />
    </Text>
  );
};

// ─────────────────────────────────────────────────────────────
// EMAIL_IN_USE and similar notices
// ─────────────────────────────────────────────────────────────

interface AuthNoticeSource {
  authNotice: { title: string; message: string } | null;
  clearAuthNotice: () => void;
}

/** 409 EMAIL_IN_USE and similar notices: explained in a dialog, not a snackbar. */
export function useAuthNoticeDialog(authStore: AuthNoticeSource): void {
  const { showDialog } = useDialog();
  const { t } = useTranslation('auth');
  const authNotice = authStore.authNotice;
  useEffect(() => {
    if (!authNotice) return;
    showDialog({
      title: authNotice.title,
      message: authNotice.message,
      buttons: [{ text: t('common:ok') }],
    });
    authStore.clearAuthNotice();
  }, [authNotice, authStore, showDialog, t]);
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    formError: { ...textStylesFor(T).bodySmall, color: T.error, marginBottom: SPACE.sm },
    // Form rhythm (SPEC-design 1.1): 40 high with 4 above and below, the
    // hairlines centred between the buttons.
    or: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.md,
      minHeight: 40,
      marginVertical: SPACE.xs,
    },
    orLine: { flex: 1, height: T.hairline, backgroundColor: T.line },
  });

const stylesFor = themedStyles(makeStyles);
