/**
 * VoiceConsentScreen (playful design): explicit-consent step of the
 * clone flow.
 *
 * Sits between CreateVoiceProfile (name, voice language) and VoiceRecording.
 * Shows the REAL consent title and text served by
 * GET /voice-profiles/clone-config for the chosen voice language in a
 * scrollable surface card (never a summary written in the app), the
 * checkbox "Metni okudum, açık rızamı veriyorum." in a card of its own
 * (ringed in the action colour once checked), the step segments (2 of 3)
 * and a pinned primary button enabled only when it is checked. The accepted `consentVersion` is passed to
 * VoiceRecording and sent with the upload. The text fades out at both edges
 * of its card, so a line scrolled under an edge is never cut flush. A voice
 * language other than the app's gets one line in the app's language that
 * says which language the text is in.
 *
 * No config (or no consent text) means no recording: the screen shows an
 * error state with retry instead. `returnToStoryId` is passed on.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { observer } from 'mobx-react-lite';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import { Button, Card, Checkbox, LoadingLine, StateView, TopAppBar } from '../../components/design';
import { withAlpha } from '../../theme/color';
import { CLONE_FLOW_STEPS, FlowDock, FlowSteps } from '../../components/voiceflow';
import { SPACE, Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { useVoiceProfile } from '../../hooks/useVoiceProfile';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { splitParagraphs } from '../../models/VoiceClone';
import { languageCodeOf } from '../../models/VoiceProfile';
import { currentLanguage } from '../../i18n/text';
import { contentLanguageLabel } from '../../hooks/useContentLanguage';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'VoiceConsent'>;

/** Padding of the consent text in its card, and the fades that match it (dp). */
const TEXT_PAD = SPACE.lg;
const BOTTOM_FADE = SPACE.xxxl;

export const VoiceConsentScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const voiceProfileStore = useVoiceProfile();
  const { t } = useTranslation('voiceFlow');
  const T = useT();
  const text = textStylesFor(T);
  const styles = stylesFor(T);

  const name = route.params?.name ?? t('defaultName');
  const resumeTake = route.params?.resumeTake ?? false;
  const returnToStoryId = route.params?.returnToStoryId;
  // The voice language chosen on the intro step. The consent shown, and the
  // version accepted, are the ones of this language.
  const language = route.params?.language;

  const config = voiceProfileStore.cloneConfigFor(language);
  const [accepted, setAccepted] = useState(false);

  // Load the config if the flow entry prefetch has not landed (or failed).
  useEffect(() => {
    if (!voiceProfileStore.cloneConfigFor(language) && !voiceProfileStore.isLoadingCloneConfig) {
      voiceProfileStore.loadCloneConfig(language);
    }
  }, [voiceProfileStore, language]);

  // A new consent version (refetched after CONSENT_REQUIRED) must be
  // accepted again.
  useEffect(() => {
    setAccepted(false);
  }, [config?.consentVersion]);

  const paragraphs = useMemo(
    () => (config ? splitParagraphs(config.consentText) : []),
    [config],
  );
  // The consent and its version belong to the voice language. When that is
  // not the app's language, one line in the app's language says so (V7; a
  // consent text in the app's language needs the backend). Inside the
  // sentence the language is named in the app's language ("İngilizce").
  const voiceLanguage = config ? languageCodeOf(config.language) : '';
  const otherLanguage =
    voiceLanguage && voiceLanguage !== currentLanguage() ? contentLanguageLabel(voiceLanguage) : '';

  const handleBack = () => {
    nav.goBack();
  };

  const handleRetry = () => {
    voiceProfileStore.loadCloneConfig(language);
  };

  const handleContinue = () => {
    if (!config || !accepted) return;
    nav.navigate('VoiceRecording', {
      name,
      consentVersion: config.consentVersion,
      resumeTake,
      language: config.language,
      ...(returnToStoryId ? { returnToStoryId } : null),
    });
  };

  const bar = <TopAppBar variant="back" title={t('consent.bar')} onBack={handleBack} />;

  // ─── Loading / error / disabled states ───
  if (!config) {
    // A config of another language (the chosen one could not be loaded) is
    // not shown: that is the error state with retry.
    const loading =
      voiceProfileStore.isLoadingCloneConfig ||
      (!voiceProfileStore.cloneConfig && !voiceProfileStore.cloneConfigError);
    return (
      <View style={styles.container}>
        {bar}
        <View style={styles.center}>
          {loading ? (
            <LoadingLine label={t('consent.loading')} direction="column" testID="consent-loading" />
          ) : (
            <StateView
              icon="alert"
              title={t('consent.errorTitle')}
              message={voiceProfileStore.cloneConfigError ?? t('consent.errorMessage')}
              actionLabel={t('common:retry')}
              onAction={handleRetry}
              testID="consent-error"
            />
          )}
        </View>
      </View>
    );
  }

  if (!config.enabled) {
    return (
      <View style={styles.container}>
        {bar}
        <View style={styles.center}>
          <StateView
            icon="mic"
            title={t('consent.closedTitle')}
            message={t('consent.closedMessage')}
            actionLabel={t('goBack')}
            onAction={handleBack}
            testID="consent-closed"
          />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.container}>
      {bar}

      <View style={styles.head}>
        <FlowSteps
          total={CLONE_FLOW_STEPS}
          current={2}
          accessibilityLabel={t('stepsA11y', { current: 2, total: CLONE_FLOW_STEPS })}
          testID="consent-steps"
        />
        <Text style={[text.body, styles.lead]}>{t('consent.lead')}</Text>
        {otherLanguage ? (
          <Text style={[text.bodySmall, styles.languageNote]} testID="consent-language-note">
            {t('consent.languageNote', { language: otherLanguage })}
          </Text>
        ) : null}
      </View>

      {/* The served consent document, scrollable inside its card. The
          system scrollbar shows only while scrolling: a persistent one read
          as a notch cut into the card edge. */}
      <Card testID="consent-card" style={styles.card} contentStyle={styles.cardFace} clip>
        <ScrollView
          contentContainerStyle={styles.cardContent}
          showsVerticalScrollIndicator
          testID="consent-scroll"
        >
          <Text accessibilityRole="header" style={text.heading}>
            {config.consentTitle}
          </Text>
          {paragraphs.map((paragraph, index) => (
            <Text key={index} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
        </ScrollView>
        <LinearGradient
          pointerEvents="none"
          colors={[T.surface, withAlpha(T.surface, 0)]}
          style={styles.cardFadeTop}
          testID="consent-fade-top"
        />
        <LinearGradient
          pointerEvents="none"
          colors={[withAlpha(T.surface, 0), T.surface]}
          style={styles.cardFade}
          testID="consent-fade-bottom"
        />
      </Card>

      {/* The agreement: a card of its own that rings in the action colour once checked. */}
      <Card
        testID="consent-check"
        selected={accepted}
        style={styles.checkCard}
        contentStyle={styles.checkRow}
      >
        <Checkbox
          checked={accepted}
          onToggle={() => setAccepted(value => !value)}
          accessibilityLabel={t('consent.check')}
          testID="consent-checkbox"
        />
        {/* The label toggles too; the checkbox is the accessible control. */}
        <Pressable
          onPress={() => setAccepted(value => !value)}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={styles.checkLabelWrap}
        >
          <Text style={styles.checkLabel}>{t('consent.check')}</Text>
        </Pressable>
      </Card>

      <FlowDock testID="consent-dock">
        <Button
          label={t('consent.accept')}
          size="lg"
          block
          pressDelay={0}
          disabled={!accepted}
          onPress={handleContinue}
          testID="consent-accept"
        />
      </FlowDock>
    </View>
  );
});

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    head: { paddingHorizontal: T.screenPadH, paddingTop: T.space.sm },
    lead: { marginTop: T.space.md },
    languageNote: { marginTop: T.space.sm },
    card: { flex: 1, marginTop: T.space.lg, marginHorizontal: T.screenPadH },
    cardFace: { flex: 1, padding: 0 },
    // The bottom padding equals the bottom fade: the last line ends clear of it.
    cardContent: { padding: TEXT_PAD, paddingBottom: BOTTOM_FADE },
    cardFadeTop: { position: 'absolute', left: 0, right: 0, top: 0, height: TEXT_PAD },
    cardFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: BOTTOM_FADE },
    paragraph: {
      fontFamily: T.fontBody,
      fontSize: 14,
      lineHeight: 21,
      color: T.text2,
      marginTop: T.space.md,
    },
    checkCard: { marginTop: T.space.md, marginHorizontal: T.screenPadH },
    checkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: T.space.sm,
      paddingLeft: T.space.tight,
      paddingRight: T.space.lg,
    },
    checkLabelWrap: { flex: 1, minHeight: T.touch, justifyContent: 'center' },
    checkLabel: { fontFamily: T.fontLabel, fontSize: 14.5, lineHeight: 20, color: T.text },
  });

const stylesFor = themedStyles(makeStyles);

export default VoiceConsentScreen;
