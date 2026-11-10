/**
 * RegistrationScreen (design v4 playful; no frame of its own, drawn in the
 * system of frame f).
 *
 * The tactile back button, a Baloo 2 headline, one name field, email and
 * password with its hint (all on lipped fields), the consent checkbox with
 * links, the primary button, then Google (and Apple on iOS) as neutral card
 * buttons under "ya da" with the legal line under them. Uses the active
 * palette like every other screen.
 *
 * Behaviour:
 *   - the keyboard: as on Login; "next", "next", then "go" creates the
 *     account;
 *   - the button is always enabled: pressed with something missing, it says
 *     what (field errors, and "Devam etmek için şartları kabul et." under the
 *     checkbox) and does not call the store;
 *   - a failed registration shows the message once, under its field or in
 *     the line above the button, never as a snackbar;
 *   - the pressed button spins at full colour, the others and the fields
 *     wait;
 *   - only the checkbox toggles the consent; the links open the documents,
 *     whose "Anladım" ticks it;
 *   - Google and Apple start at once; the legal line under them covers the
 *     terms for that path; Apple is iOS only;
 *   - success resets the stack to Main (Sesim after "Sesimi kaydet");
 *   - an auth notice from the store is a dialog;
 *   - "Giriş yap" pops back to the Login below (or replaces this screen when
 *     it is the only one), so Login never stacks twice; that Login keeps its
 *     params, so a first-run one still says "Hoş geldin".
 */

import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { observer } from 'mobx-react-lite';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { SPACE, Theme, dockBottom, textStylesFor, themedStyles, useT } from '../../theme/theme';
import {
  AppleMark,
  Button,
  Checkbox,
  GoogleMark,
  TextField,
  TopAppBar,
} from '../../components/design';
import LegalSheet, { type LegalSheetContext } from '../../components/design/LegalSheet';
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
import { RegistrationErrors, RegistrationForm, validateRegistration } from '../../utils/authValidation';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { enterAppAfterSignIn } from './enterApp';

type RegistrationScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'Registration'
>;

/** The button that started the running attempt. */
type Pending = 'email' | 'google' | 'apple' | null;

type FieldErrors = Partial<Record<keyof RegistrationErrors, string | null>>;

/** The focused field plus this stays above the keyboard. */
const KEYBOARD_BOTTOM_OFFSET = SPACE.xxl;

export const RegistrationScreen = observer(() => {
  const navigation = useNavigation<RegistrationScreenNavigationProp>();
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

  const [form, setForm] = useState<RegistrationForm>({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [legalSlug, setLegalSlug] = useState<LegalSlug | null>(null);
  // Kept while the sheet leaves, so its button does not change on the way out.
  const [legalContext, setLegalContext] = useState<LegalSheetContext>('profile');
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const setField = (field: keyof RegistrationForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: null }));
    if (formError) setFormError(null);
  };

  const setConsent = (next: boolean) => {
    setAccepted(next);
    if (next && errors.consent) setErrors(prev => ({ ...prev, consent: null }));
  };

  // From the consent sentence the document's "Anladım" ticks the box; from
  // the legal line under Google and Apple it only reads.
  const openLegal = (slug: LegalSlug, context: LegalSheetContext) => {
    setLegalContext(context);
    setLegalSlug(slug);
  };

  const handleRegister = async () => {
    if (pending) return;

    const found = validateRegistration(form, accepted);
    const translated: FieldErrors = {};
    (Object.keys(found) as (keyof RegistrationErrors)[]).forEach(field => {
      const key = found[field];
      translated[field] = key ? t(key) : null;
    });
    setErrors(translated);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    setPending('email');
    try {
      const success = await authStore.registerWithEmail(
        form.email.trim(),
        form.password,
        form.name.trim(),
      );
      if (success) {
        await enterAppAfterSignIn(navigation);
        return;
      }
      // Empty after a quiet outcome (the EMAIL_IN_USE dialog).
      const message = authStore.errorMessage;
      if (!message) return;
      const field = authStore.errorField;
      if (field) setErrors(prev => ({ ...prev, [field]: message }));
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

  const showApple = Platform.OS === 'ios';
  const editable = pending === null;
  const busyOther = (kind: Exclude<Pending, null>) => pending !== null && pending !== kind;

  return (
    <View style={styles.container}>
      <TopAppBar variant="back" onBack={() => navigation.goBack()} />

      <KeyboardAwareScrollView
        bottomOffset={KEYBOARD_BOTTOM_OFFSET}
        contentContainerStyle={[styles.scroll, { paddingBottom: dockBottom(insets.bottom) }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <Text accessibilityRole="header" style={[text.displayL, styles.title]}>
          {t('register.title')}
        </Text>

        <TextField
          label={t('register.name')}
          value={form.name}
          onChangeText={v => setField('name', v)}
          error={errors.name}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => emailRef.current?.focus()}
          editable={editable}
          testID="register-name"
          style={styles.firstField}
        />
        <TextField
          ref={emailRef}
          label={t('email')}
          value={form.email}
          onChangeText={v => setField('email', v)}
          error={errors.email}
          placeholder={t('emailPlaceholder')}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={editable}
          testID="register-email"
          style={styles.field}
        />
        <TextField
          ref={passwordRef}
          label={t('password')}
          value={form.password}
          onChangeText={v => setField('password', v)}
          error={errors.password}
          helper={t('register.passwordHint')}
          secure
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void handleRegister()}
          editable={editable}
          testID="register-password"
          style={styles.field}
        />

        <View style={styles.consentRow}>
          <Checkbox
            checked={accepted}
            onToggle={() => setConsent(!accepted)}
            accessibilityLabel={t('register.consentShort')}
            testID="register-consent"
          />
          <View style={styles.consentBody}>
            {/* Only the box toggles; the links open the documents. */}
            <LegalLinksText
              i18nKey="register.consent"
              onOpen={slug => openLegal(slug, 'consent')}
              style={styles.consentText}
              linkStyle={styles.consentLink}
              testID="register-consent-text"
            />
            <FormErrorLine
              message={errors.consent ?? null}
              textStyle={styles.consentError}
              testID="register-consent-error"
            />
          </View>
        </View>

        <View style={styles.submit}>
          <FormErrorLine message={formError} testID="register-form-error" />
          <Button
            label={t('register.submit')}
            size="lg"
            block
            onPress={() => void handleRegister()}
            loading={pending === 'email'}
            disabled={busyOther('email')}
            testID="register-submit"
          />
        </View>

        <OrDivider testID="register-or" />

        {showApple ? (
          // Two short buttons side by side, as in the mockup.
          <View style={styles.socialRow}>
            <Button
              label={t('googleShort')}
              accessibilityLabel={t('google')}
              variant="secondary"
              size="md"
              leading={<GoogleMark />}
              onPress={() => void handleSocialContinue('google')}
              loading={pending === 'google'}
              disabled={busyOther('google')}
              testID="register-google"
              style={styles.socialHalf}
            />
            <Button
              label={t('appleShort')}
              accessibilityLabel={t('apple')}
              variant="secondary"
              size="md"
              leading={<AppleMark color={T.text} />}
              onPress={() => void handleSocialContinue('apple')}
              loading={pending === 'apple'}
              disabled={busyOther('apple')}
              testID="register-apple"
              style={styles.socialHalf}
            />
          </View>
        ) : (
          <Button
            label={t('google')}
            variant="secondary"
            size="md"
            block
            leading={<GoogleMark />}
            onPress={() => void handleSocialContinue('google')}
            loading={pending === 'google'}
            disabled={busyOther('google')}
            testID="register-google"
          />
        )}

        {/* Google and Apple skip the checkbox: this line covers the terms. */}
        <LegalLinksText
          i18nKey="login.legal"
          onOpen={slug => openLegal(slug, 'profile')}
          style={styles.legal}
          linkStyle={styles.legalLink}
          testID="register-legal"
        />

        <View style={styles.spacer} />

        <View style={styles.alt}>
          <Text style={[text.bodySmall, styles.altText]}>{t('register.hasAccount')}</Text>
          <Button
            label={t('register.login')}
            variant="text"
            // Back to the Login below; replaces this screen when it is the root.
            // merge keeps that Login's params: without it popTo drops
            // `firstRun` and a new user would read "Tekrar hoş geldin".
            onPress={() => navigation.popTo('Login', undefined, { merge: true })}
            testID="register-login"
            style={styles.altButton}
          />
        </View>
      </KeyboardAwareScrollView>

      <LegalSheet
        slug={legalSlug}
        onClose={() => setLegalSlug(null)}
        context={legalContext}
        onAccept={() => setConsent(true)}
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
    consentRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      // The 48dp target around the 24dp box: the box lines up with the fields.
      marginLeft: -SPACE.md,
      marginTop: SPACE.xs,
    },
    consentBody: {
      flex: 1,
      paddingTop: 14, // geometry: the first 20dp line centred on the 24dp box
      paddingBottom: SPACE.sm,
    },
    consentText: {
      fontFamily: T.fontBody,
      fontSize: 13.5,
      lineHeight: 20,
      color: T.text2,
    },
    consentLink: { fontFamily: T.fontLabel, color: T.text, textDecorationLine: 'underline' },
    consentError: {
      fontFamily: T.fontBody,
      fontSize: 12.5,
      lineHeight: 17,
      color: T.error,
      marginTop: SPACE.tight,
    },
    // With the consent text's own 8 below it, 20 from the consent row to the
    // submit (or to the error line above it).
    submit: { marginTop: SPACE.md },
    socialRow: { flexDirection: 'row', gap: SPACE.md },
    // A block button would stretch vertically in a row.
    socialHalf: { flex: 1, alignSelf: 'center' },
    legal: {
      fontFamily: T.fontBody,
      fontSize: 12.5,
      lineHeight: 18,
      color: T.text3,
      textAlign: 'center',
      marginTop: SPACE.md,
    },
    legalLink: { fontFamily: T.fontLabel, color: T.text2, textDecorationLine: 'underline' },
    spacer: { flexGrow: 1, minHeight: SPACE.xl },
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

export default RegistrationScreen;
