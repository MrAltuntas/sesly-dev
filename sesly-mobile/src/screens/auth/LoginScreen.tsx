/**
 * LoginScreen (design v4 playful; no frame of its own, drawn in the system of
 * frame f).
 *
 * The brand bar (mark and wordmark), a Baloo 2 headline, the email form on
 * lipped fields, the primary button, then Google (and Apple on iOS) as
 * neutral card buttons under "ya da". Uses the active palette like every
 * other screen.
 *
 * Behaviour:
 *   - the keyboard: KeyboardAwareScrollView keeps the focused field 24dp
 *     above it and leaves nothing behind when it closes; "next" on the email
 *     moves to the password, "go" on the password signs in;
 *   - inline validation per field, cleared as the user types;
 *   - a failed sign in shows the message once: under the field it belongs
 *     to, or (no connection, too many attempts) in the line above the
 *     button; never as a snackbar;
 *   - the pressed button spins at full colour, the others and the fields
 *     wait; nothing is busy while the launch checks the session;
 *   - Google and Apple start at once (their own system sheets say what is
 *     shared, the legal line covers the terms); Apple is iOS only;
 *   - success resets the stack to Main (Sesim after "Sesimi kaydet");
 *   - reached from onboarding (`firstRun`) the title is "Hoş geldin";
 *   - "Şifremi unuttum" opens the reset sheet with the typed email;
 *   - an auth notice from the store (email already in use) is a dialog;
 *   - the terms and privacy links open the documents, prefetched on mount.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { observer } from 'mobx-react-lite';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { SPACE, Theme, dockBottom, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { AppleMark, Button, GoogleMark, TextField, TopAppBar } from '../../components/design';
import LegalSheet from '../../components/design/LegalSheet';
import PasswordResetSheet from '../../components/auth/PasswordResetSheet';
import {
  FormErrorLine,
  LegalLinksText,
  OrDivider,
  useAuthNoticeDialog,
} from '../../components/auth/authParts';
import { LegalSlug } from '../../models/Legal';
import legalService from '../../services/LegalService';
import { currentLanguage } from '../../i18n/text';
import { useAuth } from '../../hooks/useAuth';
import { validateLogin } from '../../utils/authValidation';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { enterAppAfterSignIn } from './enterApp';

type LoginScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Login'>;

/** The button that started the running attempt. */
type Pending = 'email' | 'google' | 'apple' | null;

/** The focused field plus this stays above the keyboard. */
const KEYBOARD_BOTTOM_OFFSET = SPACE.xxl;

export const LoginScreen = observer(() => {
  const navigation = useNavigation<LoginScreenNavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, 'Login'>>();
  const authStore = useAuth();
  const insets = useSafeAreaInsets();
  const T = useT();
  const { t } = useTranslation('auth');
  const styles = stylesFor(T);
  const text = textStylesFor(T);

  useAuthNoticeDialog(authStore);

  // The documents open from a link here; have them ready (in the UI
  // language) before the tap.
  useEffect(() => {
    const language = currentLanguage();
    void legalService.prefetch('tos', language);
    void legalService.prefetch('privacy', language);
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [legalSlug, setLegalSlug] = useState<LegalSlug | null>(null);
  const [resetSheetOpen, setResetSheetOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const passwordRef = useRef<TextInput>(null);

  // Shown under the field, cleared as soon as the user edits it. A message
  // without a field goes into the line above the button.
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (pending) return;
    const errors = validateLogin({ email, password });
    setEmailError(errors.email ? t(errors.email) : null);
    setPasswordError(errors.password ? t(errors.password) : null);
    setFormError(null);
    if (errors.email || errors.password) return;

    setPending('email');
    try {
      if (await authStore.signInWithEmail(email.trim(), password)) {
        await enterAppAfterSignIn(navigation);
        return;
      }
      // Empty after a quiet outcome (the EMAIL_IN_USE dialog).
      const message = authStore.errorMessage;
      if (!message) return;
      if (authStore.errorField === 'email') setEmailError(message);
      else if (authStore.errorField === 'password') setPasswordError(message);
      else setFormError(message);
    } finally {
      setPending(null);
    }
  };

  // Google and Apple report their own failures (no field to attach to).
  const handleSocialContinue = async (kind: 'google' | 'apple') => {
    if (pending) return;
    setFormError(null);
    setPending(kind);
    try {
      const success =
        kind === 'apple' ? await authStore.signInWithApple() : await authStore.signInWithGoogle();
      if (success) await enterAppAfterSignIn(navigation);
    } finally {
      setPending(null);
    }
  };

  const editable = pending === null;
  const firstRun = route.params?.firstRun === true;

  return (
    <View style={styles.container}>
      <TopAppBar variant="brand" />
      <KeyboardAwareScrollView
        bottomOffset={KEYBOARD_BOTTOM_OFFSET}
        contentContainerStyle={[styles.scroll, { paddingBottom: dockBottom(insets.bottom) }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <Text accessibilityRole="header" style={[text.displayL, styles.title]}>
          {firstRun ? t('login.titleFirstRun') : t('login.title')}
        </Text>

        <TextField
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
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={editable}
          testID="login-email"
          style={styles.firstField}
        />
        <TextField
          ref={passwordRef}
          label={t('password')}
          value={password}
          onChangeText={next => {
            setPassword(next);
            if (passwordError) setPasswordError(null);
            if (formError) setFormError(null);
          }}
          error={passwordError}
          secure
          autoCapitalize="none"
          autoComplete="password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void handleLogin()}
          editable={editable}
          testID="login-password"
          style={styles.field}
        />

        <Button
          label={t('login.forgot')}
          variant="text"
          onPress={() => setResetSheetOpen(true)}
          testID="login-forgot"
          style={styles.forgot}
        />

        <FormErrorLine message={formError} testID="login-form-error" />
        <Button
          label={t('login.submit')}
          size="lg"
          block
          onPress={() => void handleLogin()}
          loading={pending === 'email'}
          disabled={pending !== null && pending !== 'email'}
          testID="login-submit"
        />

        <OrDivider testID="login-or" />

        <Button
          label={t('google')}
          variant="secondary"
          size="md"
          block
          leading={<GoogleMark />}
          onPress={() => void handleSocialContinue('google')}
          loading={pending === 'google'}
          disabled={pending !== null && pending !== 'google'}
          testID="login-google"
        />
        {/* Sign in with Apple is iOS only (AuthService rejects it elsewhere). */}
        {Platform.OS === 'ios' ? (
          <Button
            label={t('apple')}
            variant="secondary"
            size="md"
            block
            leading={<AppleMark color={T.text} />}
            onPress={() => void handleSocialContinue('apple')}
            loading={pending === 'apple'}
            disabled={pending !== null && pending !== 'apple'}
            testID="login-apple"
            style={styles.stacked}
          />
        ) : null}

        <View style={styles.spacer} />

        <LegalLinksText
          i18nKey="login.legal"
          onOpen={setLegalSlug}
          style={styles.legal}
          linkStyle={styles.legalLink}
          testID="login-legal"
        />

        <View style={styles.alt}>
          <Text style={[text.bodySmall, styles.altText]}>{t('login.noAccount')}</Text>
          <Button
            label={t('login.register')}
            variant="text"
            onPress={() => navigation.navigate('Registration')}
            testID="login-register"
            style={styles.altButton}
          />
        </View>
      </KeyboardAwareScrollView>

      <LegalSheet slug={legalSlug} onClose={() => setLegalSlug(null)} context="profile" />
      <PasswordResetSheet
        visible={resetSheetOpen}
        onClose={() => setResetSheetOpen(false)}
        initialEmail={email}
      />
    </View>
  );
});

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    scroll: { flexGrow: 1, paddingHorizontal: T.screenPadH },
    // Form rhythm (SPEC-design 1.1).
    title: { marginTop: SPACE.md },
    firstField: { marginTop: SPACE.xl },
    field: { marginTop: SPACE.lg },
    // The text button's own 48dp height is the gap to the submit; its 12dp
    // padding lines the label up with the field edge.
    forgot: { alignSelf: 'flex-end', marginRight: -SPACE.md },
    stacked: { marginTop: SPACE.md },
    spacer: { flexGrow: 1, minHeight: SPACE.xl },
    legal: {
      fontFamily: T.fontBody,
      fontSize: 12.5,
      lineHeight: 18,
      color: T.text3,
      textAlign: 'center',
    },
    legalLink: { fontFamily: T.fontLabel, color: T.text2, textDecorationLine: 'underline' },
    alt: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: T.touch,
    },
    altText: { flexShrink: 1 },
    // About 4dp of visible gap; the 48dp target stays.
    altButton: { marginLeft: -SPACE.sm },
  });

const stylesFor = themedStyles(makeStyles);

export default LoginScreen;
