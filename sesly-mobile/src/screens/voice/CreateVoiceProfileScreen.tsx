/**
 * CreateVoiceProfileScreen (playful design, in the system of frames e and f):
 * intro step of the own-voice clone flow.
 *
 *   - Back app bar "Kendi sesin", the flow's step segments (1 of 3), a
 *     Baloo 2 display title.
 *   - "Konuşacağın dil" (in a card): the language the user will read in, one of the
 *     clone config's `supportedLanguages` (default: the content language
 *     when it is offered, else Turkish). Choosing another one reloads the
 *     steps, tips, consent and reading script in it. Not shown when only one
 *     language is offered. This is the only place the language is chosen:
 *     the consent and recording steps receive it and keep it.
 *   - Numbered steps in a card, each number on an own-voice badge: always the
 *     app's own three steps in the UI language (the backend's CLONE_INTRO_STEPS
 *     word for word; their 15 / 30 second figures come from the clone config).
 *     The served `introSteps` come in the voice language, so they are not
 *     used: choosing another voice language never changes the steps or the
 *     card's height (V7: only the reading script follows the voice). While the
 *     first config load runs the card is a skeleton of itself, so the figures
 *     are never swapped.
 *   - On the free plan, what it allows (live numbers from GET /usage, the
 *     plan constant until it answers) with "Planları gör".
 *   - Name field with the default name. The content scrolls with the keyboard
 *     and the dock rides on it, so the field and "Devam" stay visible.
 *   - Pinned "Devam": checks the clone slots (clone.canCreate + the creation
 *     allowance), then goes to the consent step (VoiceConsent) before
 *     recording. A full allowance is explained in the plan block dialog.
 *   - Cloning switched off (config `enabled: false`): only the closed state.
 *
 * Prefetches GET /voice-profiles/clone-config (in the default language) on
 * entry so the consent text and durations are ready by the next step.
 * `returnToStoryId` (started from a story) travels to the last step.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { observer } from 'mobx-react-lite';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import {
  BUTTON_METRICS,
  Bone,
  Button,
  Card,
  SegmentedControl,
  SkeletonPulse,
  StateView,
  TextBones,
  TextField,
  TopAppBar,
} from '../../components/design';
import { CLONE_FLOW_STEPS, FlowDock, FlowSteps, StepRow } from '../../components/voiceflow';
import { useAddNarrator } from '../../components/voice/useAddNarrator';
import { LIP, RADIUS, SPACE, Theme, dockBottom, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { navigateSingleton } from '../../navigation/navigateSingleton';
import { useVoiceProfile } from '../../hooks/useVoiceProfile';
import { useSubscription } from '../../hooks/useSubscription';
import { useContentLanguage } from '../../hooks/useContentLanguage';
import { FALLBACK_CLONE_DURATIONS } from '../../models/VoiceClone';
import { DEFAULT_VOICE_LANGUAGE } from '../../models/VoiceProfile';
import { PLANS } from '../../models/Plans';
import type { UsageSummary } from '../../models/Quota';
import { showToast } from '../../utils/toast';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'CreateVoiceProfile'>;

const MIN_NAME_LENGTH = 2;

/** Keyboard open: the dock keeps 12dp under its button instead of the system inset. */
const DOCK_OPEN_BOTTOM = 12;
/** Gap between the focused field and the top of the dock riding on the keyboard. */
const FIELD_TO_DOCK = SPACE.lg;

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * What the free plan allows for an own voice, from GET /usage when it has
 * answered, else from the plan constant. One-variants instead of plurals
 * (Hermes has no Intl.PluralRules).
 */
export function freePlanLine(
  t: Translate,
  usage: Pick<UsageSummary, 'buckets'> | null | undefined,
): string {
  const voices =
    usage?.buckets.cloneCreations.limit ?? PLANS.free.cloneCreations.amount ?? 1;
  const stories =
    usage?.buckets.cloneNarrations.limit ?? PLANS.free.clonedNarrations.amount ?? 1;
  if (voices === 1) {
    return stories === 1
      ? t('voiceFlow:intro.freePlanOnceOne')
      : t('voiceFlow:intro.freePlanOnce', { stories });
  }
  return stories === 1
    ? t('voiceFlow:intro.freePlanStoryOne', { voices })
    : t('voiceFlow:intro.freePlan', { voices, stories });
}

export const CreateVoiceProfileScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const insets = useSafeAreaInsets();
  const { showBlock } = useAddNarrator();
  const { t } = useTranslation('voiceFlow');
  const T = useT();
  const text = textStylesFor(T);
  const styles = stylesFor(T);

  const voiceProfileStore = useVoiceProfile();
  const subscriptionStore = useSubscription();
  const contentLanguage = useContentLanguage();

  const returnToStoryId = route.params?.returnToStoryId;
  const defaultName = t('defaultName');
  const [name, setName] = useState(defaultName);
  const [checkingSlots, setCheckingSlots] = useState(false);
  // The dock as measured; until then its size from the button metrics.
  const [dockHeight, setDockHeight] = useState(
    SPACE.sm + BUTTON_METRICS.lg.height + BUTTON_METRICS.lg.lip + dockBottom(insets.bottom),
  );

  // Fresh clone config for this flow (consent version may have changed), in
  // the language the user most likely speaks: their content language. The
  // store falls back to Turkish when that one is not offered for a voice.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await contentLanguage.load();
      if (!cancelled) void voiceProfileStore.loadCloneConfig(contentLanguage.effective);
    })();
    return () => {
      cancelled = true;
    };
  }, [voiceProfileStore, contentLanguage]);

  // The free-plan line shows the live allowance.
  useEffect(() => {
    void subscriptionStore.loadUsageIfStale();
  }, [subscriptionStore]);

  const config = voiceProfileStore.cloneConfig;
  const durations = config ?? FALLBACK_CLONE_DURATIONS;
  // The first load: the steps card is a skeleton until the durations are
  // known, so their figures never swap under the reader.
  const configPending = !config && !voiceProfileStore.cloneConfigError;

  // The voice language. While another one is loading the store already
  // names it, so the control answers the tap at once.
  const languages = config?.supportedLanguages ?? [];
  const selectedLanguage =
    voiceProfileStore.cloneLanguage ?? config?.language ?? DEFAULT_VOICE_LANGUAGE;
  const showLanguageStep = languages.length > 1;
  const switchingLanguage =
    voiceProfileStore.isLoadingCloneConfig && !!config && config.language !== selectedLanguage;

  const handleLanguageChange = async (code: string) => {
    if (code === selectedLanguage) return;
    await voiceProfileStore.loadCloneConfig(code);
    // A newer choice is on its way: that one reports.
    if (voiceProfileStore.isLoadingCloneConfig) return;
    if (voiceProfileStore.cloneConfig?.language !== code) {
      showToast.error(t('intro.languageFailed'));
    }
  };

  // One source in the UI language, whatever voice language is picked (V7:
  // only the reading script follows the voice). The served `introSteps` come
  // in the voice language, so a switch would swap them for other wording and
  // move everything under the card; the durations are the same for every
  // voice language.
  const steps: ReadonlyArray<{ title: string; body: string }> = [
    { title: t('intro.steps.roomTitle'), body: t('intro.steps.roomBody') },
    {
      title: t('intro.steps.readTitle', { target: Math.ceil(durations.targetSeconds) }),
      body: t('intro.steps.readBody', { min: Math.ceil(durations.minSeconds) }),
    },
    { title: t('intro.steps.readyTitle'), body: t('intro.steps.readyBody') },
  ];

  const handleBack = () => {
    nav.goBack();
  };

  const openPlans = () => navigateSingleton(nav, 'Subscription', { reason: 'voices' });

  const canContinue =
    name.trim().length >= MIN_NAME_LENGTH && !checkingSlots && !switchingLanguage;

  const handleStart = async () => {
    if (checkingSlots) return;
    const trimmed = name.trim().length > 0 ? name.trim() : defaultName;
    // Fresh GET /voice-profiles/slots before the user records, so a used-up
    // allowance is reported up front instead of after a wasted recording.
    setCheckingSlots(true);
    let allowed = true;
    try {
      allowed = await voiceProfileStore.checkCanCreate('clone');
    } finally {
      setCheckingSlots(false);
    }
    if (!allowed) {
      const block = voiceProfileStore.slotBlock('clone', subscriptionStore.planId);
      // The same dialog as on the Sesim tab: [Vazgeç, Planları gör].
      showBlock(block.title, block.message, block.showPaywall);
      return;
    }
    nav.navigate('VoiceConsent', {
      name: trimmed,
      language: voiceProfileStore.cloneLanguage ?? config?.language,
      ...(returnToStoryId ? { returnToStoryId } : null),
    });
  };

  const bar = <TopAppBar variant="back" title={t('intro.bar')} onBack={handleBack} />;

  // Cloning is switched off on the backend: say so before anything is typed.
  if (config && !config.enabled) {
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
            testID="intro-closed"
          />
        </View>
      </View>
    );
  }

  const openOffset = dockBottom(insets.bottom) - DOCK_OPEN_BOTTOM;

  return (
    <View style={styles.container}>
      {bar}

      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        // The part of the dock that stays above the keyboard, plus a gap.
        bottomOffset={Math.max(0, dockHeight - openOffset) + FIELD_TO_DOCK}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        testID="voice-intro-scroll"
      >
        <FlowSteps
          total={CLONE_FLOW_STEPS}
          current={1}
          accessibilityLabel={t('stepsA11y', { current: 1, total: CLONE_FLOW_STEPS })}
          testID="voice-intro-steps"
        />

        <Text accessibilityRole="header" style={[text.displayL, styles.title]}>
          {t('intro.title')}
        </Text>

        {showLanguageStep ? (
          <Card testID="voice-language-step" style={styles.card}>
            <Text accessibilityRole="header" style={text.subheading}>
              {t('intro.languageLabel')}
            </Text>
            <SegmentedControl
              segments={languages.map(language => ({
                value: language.code,
                label: language.nativeName,
              }))}
              value={selectedLanguage}
              onChange={code => void handleLanguageChange(code)}
              accessibilityLabel={t('intro.languageLabel')}
              testID="voice-language"
              style={styles.languageControl}
            />
            <Text style={[text.bodySmall, styles.languageHint]}>{t('intro.languageHint')}</Text>
          </Card>
        ) : null}

        {configPending ? (
          <SkeletonPulse testID="voice-intro-steps-loading" style={styles.card}>
            <Bone height={STEPS_BONE_HEIGHT} lip={LIP.md} radius={RADIUS.xl}>
              <View style={styles.stepBones}>
                {[0, 1, 2].map(index => (
                  <View key={index} style={styles.stepBone}>
                    <Bone tone="line" width={STEP_BADGE_BONE} height={STEP_BADGE_BONE} radius={RADIUS.sm} />
                    <TextBones tone="line" style={styles.stepBoneText} />
                  </View>
                ))}
              </View>
            </Bone>
          </SkeletonPulse>
        ) : (
          // Not dimmed while another voice language loads: the steps stay as
          // they are.
          <Card testID="voice-intro-steps-card" style={styles.card} contentStyle={styles.stepsCard}>
            {steps.map((step, index) => (
              <StepRow
                key={`${index}-${step.title}`}
                index={index + 1}
                title={step.title}
                body={step.body}
                testID={`voice-intro-step-${index + 1}`}
              />
            ))}
          </Card>
        )}

        {subscriptionStore.planId === 'free' ? (
          <Card testID="voice-intro-free-plan" style={styles.card} contentStyle={styles.planCard}>
            <Text style={text.bodySmall}>{freePlanLine(t, subscriptionStore.usage)}</Text>
            <Button
              label={t('voices:dialogs.seePlans')}
              variant="text"
              onPress={openPlans}
              style={styles.planAction}
              testID="voice-intro-plans"
            />
          </Card>
        ) : null}

        <TextField
          label={t('intro.nameLabel')}
          value={name}
          onChangeText={setName}
          placeholder={defaultName}
          maxLength={50}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (canContinue) void handleStart();
          }}
          testID="voice-name-field"
          style={styles.field}
        />
      </KeyboardAwareScrollView>

      {/* Rides on the keyboard; with it open the dock keeps 12dp under its
          button instead of the navigation inset. */}
      <KeyboardStickyView offset={{ closed: 0, opened: openOffset }} testID="voice-intro-sticky">
        <FlowDock
          testID="voice-intro-dock"
          onLayout={event => setDockHeight(event.nativeEvent.layout.height)}
        >
          <Button
            label={t('intro.continue')}
            size="lg"
            block
            pressDelay={0}
            onPress={handleStart}
            disabled={name.trim().length < MIN_NAME_LENGTH || switchingLanguage}
            loading={checkingSlots}
            testID="voice-intro-continue"
          />
        </FlowDock>
      </KeyboardStickyView>
    </View>
  );
});

/** The steps skeleton: card padding, three step rows and their gaps (dp). */
const STEP_BADGE_BONE = 40;
const STEPS_BONE_HEIGHT = 2 * SPACE.lg + 3 * 64 + 2 * SPACE.lg;

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll: { flex: 1 },
    content: { paddingHorizontal: T.screenPadH, paddingTop: T.space.sm, paddingBottom: T.space.xxl },
    title: { marginTop: T.space.lg },
    card: { marginTop: T.space.lg },
    languageControl: { marginTop: T.space.md },
    languageHint: { marginTop: T.space.sm },
    stepsCard: { gap: T.space.lg },
    stepBones: { padding: T.space.lg, gap: T.space.lg },
    stepBone: { flexDirection: 'row', alignItems: 'center', gap: T.space.md, minHeight: 64 },
    stepBoneText: { flex: 1 },
    planCard: { paddingBottom: T.space.xs },
    // The text button's own padding lines its label up with the sentence.
    planAction: { marginLeft: -T.space.md, marginTop: T.space.xs },
    field: { marginTop: T.space.xl },
  });

const stylesFor = themedStyles(makeStyles);

export default CreateVoiceProfileScreen;
