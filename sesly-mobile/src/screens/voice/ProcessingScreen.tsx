/**
 * ProcessingScreen (playful design): the voice is being prepared.
 *
 *   - No app bar and no back: the only way out is "Arka planda devam et".
 *   - The big own-voice badge with the initial of the voice, a Baloo 2
 *     display title, then a card with a fat INDETERMINATE bar in the action
 *     colour (the backend sends no percentage for cloning) and two status
 *     lines mapped to the real states: the sample is uploaded, the voice is
 *     being created. A step that has not started yet waits quietly, so only
 *     one line spins at a time.
 *   - Observes the ONE training tracker in `useVoiceProfile` (socket
 *     voice_status + single 5 s status poll, 20 min cap). This screen does
 *     not poll by itself.
 *   - READY: the "Sesin oluşturuldu" check shows for a moment, then
 *     VoiceSuccess replaces this screen. FAILED: a dialog with "Yeniden
 *     kaydet" (the failed voice is removed and the flow starts again) or
 *     "Sesim'e dön". Timeout: recoverable state with "Tekrar kontrol et" or
 *     leave it in the background.
 *   - "Arka planda devam et": back to Main on the Sesim tab, where the voice
 *     shows as being prepared; the tracker keeps running and the user is told
 *     when the voice is ready.
 *
 * `returnToStoryId` is passed on to VoiceSuccess (and to a new recording).
 */

import React, { useEffect, useRef } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { observer } from 'mobx-react-lite';
import {
  useNavigation,
  useRoute,
  RouteProp,
  CommonActions,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { Button, Card, ProgressBar, StateView } from '../../components/design';
import { FlowAvatar, FlowDock, StatusLine } from '../../components/voiceflow';
import { useAddNarrator } from '../../components/voice/useAddNarrator';
import { Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { initialOf } from '../../i18n/text';
import { useVoiceProfile } from '../../hooks/useVoiceProfile';
import { useVoiceRecording } from '../../hooks/useVoiceRecording';
import { useSubscription } from '../../hooks/useSubscription';
import { useDialog } from '../../hooks/useDialog';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { VoiceProfileStatus } from '../../types/enums';
import { ensurePushPermission } from '../../services/PushNotificationService';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'Processing'>;

/** How long the "Sesin oluşturuldu" check stays before VoiceSuccess opens (ms). */
export const READY_HOLD_MS = 600;

export const ProcessingScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const insets = useSafeAreaInsets();
  const voiceProfileStore = useVoiceProfile();
  const recordingStore = useVoiceRecording();
  const subscriptionStore = useSubscription();
  const { showDialog } = useDialog();
  const { showBlock } = useAddNarrator();
  const { t } = useTranslation('voiceFlow');
  const T = useT();
  const text = textStylesFor(T);
  const styles = stylesFor(T);

  const profileId =
    route.params?.profileId ?? recordingStore.createdProfile?.id ?? null;
  const returnToStoryId = route.params?.returnToStoryId;

  // READY/FAILED can surface from the tracker state and the list patch in
  // the same tick; resolve exactly once.
  const resolvedRef = useRef(false);
  // The hold between the ready check and VoiceSuccess.
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReadyTimer = () => {
    if (readyTimer.current) {
      clearTimeout(readyTimer.current);
      readyTimer.current = null;
    }
  };

  // ─── Derived status (store is the single source of truth) ───
  const profile = profileId
    ? voiceProfileStore.voiceProfiles.find(p => p.id === profileId) ?? null
    : null;
  const track = voiceProfileStore.getTrackState(profileId);
  const isReady =
    profile?.status === VoiceProfileStatus.READY || track?.phase === 'ready';
  const isFailed =
    !isReady &&
    (profile?.status === VoiceProfileStatus.FAILED || track?.phase === 'failed');
  const failureMessage = track?.errorMessage ?? profile?.errorMessage ?? null;
  const isTimeout = !isReady && !isFailed && track?.phase === 'timeout';
  // PENDING means the profile exists but its sample is not in yet. The flow
  // only opens this screen after a successful upload, so an unknown profile
  // (list not refreshed yet) counts as uploaded.
  const isUploaded = profile ? profile.status !== VoiceProfileStatus.PENDING : true;

  const voiceName =
    profile?.name ??
    (recordingStore.createdProfile?.id === profileId
      ? recordingStore.createdProfile?.name
      : null) ??
    recordingStore.profileName;

  // Start (or keep) tracking this profile; mark it observed so the store
  // does not also toast the result while this screen shows it.
  useEffect(() => {
    if (!profileId) return;
    const state = voiceProfileStore.getTrackState(profileId);
    if (!state || state.phase === 'waiting') {
      voiceProfileStore.trackVoiceProfile(profileId);
    }
    voiceProfileStore.setTrackingObserved(profileId);
    // In-context push permission ask (system dialog only the first time), so
    // "Arka planda devam et" can end with a "sesin hazır" notification.
    void ensurePushPermission();
    return () => {
      if (voiceProfileStore.trackingObservedId === profileId) {
        voiceProfileStore.setTrackingObserved(null);
      }
    };
  }, [profileId, voiceProfileStore]);

  // Hardware back: "keep waiting in the background".
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBackground();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the screen drops a pending hand-over to VoiceSuccess.
  useEffect(() => clearReadyTimer, []);

  const resetToVoices = () => {
    nav.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Main', params: { screen: 'Voices' } }],
      }),
    );
  };

  /** "Yeniden kaydet": the failed voice goes, a new recording starts. */
  const recordAgain = async () => {
    if (!profileId) return;
    if (!(await voiceProfileStore.checkCanCreate('clone'))) {
      // No new recording allowed: Sesim, with the reason (and the plans)
      // over it, instead of a waiting screen for a voice that failed.
      const block = voiceProfileStore.slotBlock('clone', subscriptionStore.planId);
      resetToVoices();
      showBlock(block.title, block.message, block.showPaywall);
      return;
    }
    // The failed voice holds no place, but it would stay on Sesim as failed.
    await voiceProfileStore.deleteVoiceProfile(profileId);
    recordingStore.reset();
    // Back to the intro still in the stack (its name and language kept), or
    // a new one in place of this screen when the flow was opened elsewhere.
    nav.popTo('CreateVoiceProfile', returnToStoryId ? { returnToStoryId } : undefined);
  };

  // React to the store's final status.
  useEffect(() => {
    if (!profileId || resolvedRef.current) return;
    if (isReady) {
      resolvedRef.current = true;
      // The check of the last line paints before the screen changes.
      readyTimer.current = setTimeout(() => {
        readyTimer.current = null;
        nav.replace('VoiceSuccess', {
          profileId,
          ...(returnToStoryId ? { returnToStoryId } : null),
        });
      }, READY_HOLD_MS);
    } else if (isFailed) {
      resolvedRef.current = true;
      showDialog({
        title: t('processing.failedTitle'),
        message: failureMessage || t('processing.failedMessage'),
        // Not dismissable: the only ways out are the buttons below.
        cancelable: false,
        buttons: [
          { text: t('success.backToVoices'), style: 'cancel', onPress: resetToVoices },
          { text: t('processing.recordAgain'), onPress: () => void recordAgain() },
        ],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, isFailed, profileId]);

  const handleBackground = () => {
    clearReadyTimer();
    // Sesim shows the voice as being prepared.
    resetToVoices();
  };

  const handleGoBack = () => {
    if (nav.canGoBack()) {
      nav.goBack();
    } else {
      handleBackground();
    }
  };

  const handleRetry = () => {
    if (profileId) {
      voiceProfileStore.restartTracking(profileId);
    }
  };

  // No profile to track: recoverable error with a way back.
  if (!profileId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.center}>
          <StateView
            icon="alert"
            title={t('processing.missingTitle')}
            message={t('processing.missingMessage')}
            actionLabel={t('goBack')}
            onAction={handleGoBack}
            testID="processing-missing"
          />
        </View>
      </View>
    );
  }

  // Not resolved within the tracker's 20 minute window. The primary action
  // tops the dock, over the way out.
  if (isTimeout) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.center}>
          <StateView
            icon="clock"
            title={t('processing.timeoutTitle')}
            message={t('processing.timeoutMessage')}
            testID="processing-timeout"
          />
        </View>
        <FlowDock variant="plain" style={styles.dockStack} testID="processing-dock">
          <Button
            label={t('processing.checkAgain')}
            size="md"
            block
            pressDelay={0}
            onPress={handleRetry}
            testID="processing-retry"
          />
          <Button
            label={t('background')}
            variant="secondary"
            size="md"
            block
            pressDelay={0}
            onPress={handleBackground}
            testID="processing-background"
          />
        </FlowDock>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Scrolls on a short phone at a large font instead of clipping. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <FlowAvatar initial={initialOf(voiceName)} />
        <Text accessibilityRole="header" style={[text.displayL, styles.title]}>
          {t('processing.title')}
        </Text>
        <Text style={[text.body, styles.lead]}>{t('processing.body')}</Text>

        <Card testID="processing-card" radius={28} style={styles.card}>
          <ProgressBar
            height={12}
            color={T.action}
            accessibilityLabel={t('processing.progressA11y')}
            testID="processing-bar"
          />
          <View style={styles.status}>
            <StatusLine
              state={isUploaded ? 'done' : 'active'}
              label={isUploaded ? t('processing.uploaded') : t('processing.uploading')}
              testID="processing-upload"
            />
            <StatusLine
              state={isReady ? 'done' : isUploaded ? 'active' : 'pending'}
              label={isReady ? t('processing.created') : t('processing.creating')}
              testID="processing-create"
            />
          </View>
        </Card>
      </ScrollView>

      <FlowDock variant="plain" testID="processing-dock">
        <Text style={[text.bodySmall, styles.note]}>{t('backgroundNote')}</Text>
        <Button
          label={t('background')}
          variant="secondary"
          size="md"
          block
          pressDelay={0}
          onPress={handleBackground}
          testID="processing-background"
        />
      </FlowDock>
    </View>
  );
});

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll: { flex: 1 },
    body: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: T.screenPadH,
      paddingBottom: T.space.xxl,
    },
    title: { marginTop: T.space.xl, textAlign: 'center' },
    lead: { marginTop: T.space.sm, textAlign: 'center' },
    card: { marginTop: T.space.xxl },
    status: { marginTop: T.space.lg, gap: T.space.sm },
    note: { textAlign: 'center', marginBottom: T.space.md },
    // Stacked dock buttons.
    dockStack: { gap: T.space.md },
  });

const stylesFor = themedStyles(makeStyles);

export default ProcessingScreen;
