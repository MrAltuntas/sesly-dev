/**
 * PasswordResetSheet: asks for an email address and asks the backend for
 * the password reset mail in the UI language through
 * `useAuth().resetPassword()` (POST /auth/password-reset). Success closes
 * the sheet with the "if an account exists, we sent a link" toast.
 *
 * The field takes focus once the sheet has risen (not while it moves, so
 * the keyboard does not race the enter) and "send" on the keyboard sends.
 * A failure is shown once: under the field when it is about the address,
 * otherwise (no connection, too many attempts) in the line above the button;
 * never as a snackbar over the sheet. The sheet closes on success, on the
 * scrim, the handle and back; it needs no "Vazgeç".
 */

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '../design/BottomSheet';
import { Button } from '../design/Button';
import { TextField } from '../design/rows';
import { SPACE, Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { useAuth } from '../../hooks/useAuth';
import { validateEmail } from '../../utils/authValidation';
import { FormErrorLine } from './authParts';

interface PasswordResetSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Optional pre-fill, typically the email typed on Login. */
  initialEmail?: string;
}

export const PasswordResetSheet: React.FC<PasswordResetSheetProps> = observer(
  ({ visible, onClose, initialEmail }) => {
    const T = useT();
    const { t } = useTranslation('auth');
    const styles = stylesFor(T);
    const text = textStylesFor(T);
    const authStore = useAuth();
    const inputRef = useRef<TextInput>(null);

    const [email, setEmail] = useState(initialEmail ?? '');
    const [emailError, setEmailError] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    // Counts the openings: the answer to a request sent before the sheet was
    // closed and opened again belongs to the old one and is dropped (it must
    // not close the new one or end its busy state).
    const opening = useRef(0);

    useEffect(() => {
      if (visible) opening.current += 1;
    }, [visible]);

    useEffect(() => {
      if (visible) {
        setEmail(initialEmail ?? '');
        setEmailError(null);
        setFormError(null);
        setSubmitting(false);
      }
    }, [visible, initialEmail]);

    const handleSubmit = async () => {
      if (submitting) return;
      const trimmed = email.trim();
      const invalid = validateEmail(trimmed);
      setFormError(null);
      if (invalid) {
        setEmailError(t(invalid));
        return;
      }

      const sentIn = opening.current;
      setSubmitting(true);
      const ok = await authStore.resetPassword(trimmed);
      if (sentIn !== opening.current) return;
      setSubmitting(false);

      if (ok) {
        onClose();
        return;
      }
      const message = authStore.errorMessage;
      if (!message) return;
      if (authStore.errorField === 'email') setEmailError(message);
      else setFormError(message);
    };

    return (
      <BottomSheet
        visible={visible}
        onClose={onClose}
        title={t('reset.title')}
        scrollable
        onOpened={() => inputRef.current?.focus()}
        testID="password-reset-sheet"
      >
        <Text style={[text.bodySmall, styles.body]}>{t('reset.body')}</Text>
        <TextField
          ref={inputRef}
          label={t('email')}
          value={email}
          onChangeText={next => {
            setEmail(next);
            if (emailError) setEmailError(null);
            if (formError) setFormError(null);
          }}
          error={emailError}
          placeholder={t('emailPlaceholder')}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="send"
          onSubmitEditing={() => void handleSubmit()}
          editable={!submitting}
          testID="reset-email"
          style={styles.field}
        />
        <View style={styles.submit}>
          <FormErrorLine message={formError} testID="reset-form-error" />
          <Button
            label={t('reset.submit')}
            size="md"
            block
            onPress={() => void handleSubmit()}
            loading={submitting}
            testID="reset-submit"
          />
        </View>
      </BottomSheet>
    );
  },
);

const makeStyles = (_T: Theme) =>
  StyleSheet.create({
    body: { marginTop: SPACE.tight },
    field: { marginTop: SPACE.lg },
    // Last field to the submit, or to the error line above it (SPEC-design 1.1).
    submit: { marginTop: SPACE.xl },
  });

const stylesFor = themedStyles(makeStyles);

export default PasswordResetSheet;
