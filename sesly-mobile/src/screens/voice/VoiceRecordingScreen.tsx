/**
 * VoiceRecordingScreen (playful design, in the system of frames e and f):
 * read-aloud step of the own-voice clone flow.
 *
 *   - Back app bar "Ses kaydı", the flow's step segments (3 of 3).
 *   - Microphone permission, when it is missing, in a card above everything
 *     else: "İzin ver" while the system dialog can still be shown, "Ayarlara
 *     git" after a permanent denial. Coming back to the app re-reads the
 *     permission, so a grant in the settings frees the record button at once.
 *   - Tips before the first take, in a card with icon tiles: clone-config
 *     `recordingTips` (icon key + text) when served in the app's language,
 *     else the three built-in tips (the script alone follows the voice
 *     language). Gone once a take was started, so the script keeps the whole
 *     scroll area (also after a rejected take).
 *   - Reading card: clone-config `scriptTitle` (Baloo 2) + `script` in large
 *     Nunito type on a surface card, scrolling with the page, fading out at
 *     the bottom edge. It never re-renders while a take runs.
 *   - Pinned panel, a calm surface card with round top corners: the level
 *     meter (rounded segments) with its state in words (too quiet / good /
 *     too loud), the fat speech-elapsed bar with the minimum and ideal
 *     notches, one hint line of a fixed two-line height (refusals such as
 *     "too short" flash in it for a moment), then restart / the big round
 *     record button / clock. Stop is accepted only after `minSeconds`
 *     (before that the button stays tappable to explain why, but reads as
 *     disabled to screen readers); auto-stop at `maxSeconds`. Only this panel
 *     follows the 10-a-second level and timer updates.
 *   - After a take the panel becomes the review: listen back, "Baştan
 *     başla" (asks first: the take is deleted), "Sesimi oluştur" (upload
 *     with the accepted consent version, a progress bar in a slot that is
 *     always there), then Processing.
 *   - The screen stays on while a take runs or uploads.
 *
 * All recording rules (thresholds, timer, state machine, upload and error
 * mapping) live in `useVoiceRecording` / `models/VoiceClone`; this file only
 * draws them. The audio session is switched to recording only while a take
 * runs and is handed back to playback after stop / on unmount.
 * `returnToStoryId` is passed on to Processing.
 */

import React, { MutableRefObject, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  BackHandler,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { observer } from 'mobx-react-lite';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useTranslation } from 'react-i18next';

import {
  Button,
  Card,
  Icon,
  IconName,
  LoadingLine,
  ProgressBar,
  StateView,
  SurfaceLevelProvider,
  TopAppBar,
} from '../../components/design';
import { withAlpha } from '../../theme/color';
import {
  CLONE_FLOW_STEPS,
  FlowSteps,
  LevelMeter,
  RecordButton,
  SamplePlayer,
  StatusLine,
  TakeProgress,
  formatClock,
  levelColor,
  zonedMeterFraction,
} from '../../components/voiceflow';
import { useAddNarrator } from '../../components/voice/useAddNarrator';
import { SPACE, Theme, dockBottom, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { useVoiceRecording } from '../../hooks/useVoiceRecording';
import { useVoiceProfile } from '../../hooks/useVoiceProfile';
import { useSubscription } from '../../hooks/useSubscription';
import { useAudioPlayer as useAppAudioPlayer } from '../../hooks/useAudioPlayer';
import { useDialog } from '../../hooks/useDialog';
import { RootStackParamList } from '../../navigation/RootNavigator';
import {
  CloneErrorInfo,
  InputLevel,
  RecordingTipIcon,
  levelThresholds,
  markerFraction,
  recordingProgress,
  splitParagraphs,
} from '../../models/VoiceClone';
import { languageCodeOf } from '../../models/VoiceProfile';
import { currentLanguage } from '../../i18n/text';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'VoiceRecording'>;

/** Backend tip icon keys; unknown keys (icon: null) get TIP_ICON_GENERIC. */
const TIP_ICONS: Record<RecordingTipIcon, IconName> = {
  quiet: 'info',
  distance: 'phone',
  calm: 'book',
  pauses: 'clock',
};
const TIP_ICON_GENERIC: IconName = 'info';

/** The keep-awake tag of a take or an upload (the screen must not turn off). */
export const KEEP_AWAKE_TAG = 'voice-recording';
/** How long a refusal ("too short", "start reading") stays in the hint line (ms). */
export const HINT_FLASH_MS = 2500;
/** Line height of the hint; the line always holds two of them (dp). */
const HINT_LINE = 18;
/** The hint grows with the system font only this far. */
const HINT_MAX_SCALE = 1.3;
/** Upload progress bar under the review buttons (dp). */
const UPLOAD_BAR = 6;

interface Tip {
  icon: IconName;
  text: string;
}

/** Keep the screen on, or let it go. A missing or failing native module is ignored. */
function setKeepAwake(on: boolean): void {
  try {
    const pending = on ? activateKeepAwakeAsync(KEEP_AWAKE_TAG) : deactivateKeepAwake(KEEP_AWAKE_TAG);
    void Promise.resolve(pending).catch(() => undefined);
  } catch {
    // Not available (a build without the module): the take still works.
  }
}

export const VoiceRecordingScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const insets = useSafeAreaInsets();
  const recordingStore = useVoiceRecording();
  const voiceProfileStore = useVoiceProfile();
  const subscriptionStore = useSubscription();
  const appAudioPlayer = useAppAudioPlayer();
  const { showDialog } = useDialog();
  const { showBlock } = useAddNarrator();
  const { t } = useTranslation('voiceFlow');
  const T = useT();
  const text = textStylesFor(T);
  const styles = stylesFor(T);

  const profileName = route.params?.name ?? t('defaultName');
  const consentVersion = route.params?.consentVersion ?? null;
  const resumeTake = route.params?.resumeTake ?? false;
  const returnToStoryId = route.params?.returnToStoryId;
  // The voice language was chosen on the intro step and is fixed here: the
  // script, the accepted consent version and the created voice all use it.
  const language = route.params?.language;
  const config = voiceProfileStore.cloneConfigFor(language);
  const script = config?.script ?? '';
  const scriptParagraphs = useMemo(() => splitParagraphs(script), [script]);

  // ─── Listen-back player for the saved take ───
  // useAudioPlayer creates a new native player whenever the source changes,
  // so nothing here may depend on the player identity for store resets.
  const playbackSource = useMemo(() => {
    const uri = recordingStore.recordedFilePath;
    return uri ? { uri } : null;
  }, [recordingStore.recordedFilePath]);
  const player = useAudioPlayer(playbackSource);
  const playerStatus = useAudioPlayerStatus(player);
  const isPlayingBack = !!playerStatus?.playing;

  const isRecording = recordingStore.isRecording;
  const isProcessing = recordingStore.isProcessing;

  // A take was started on this screen (or is kept from before a re-consent):
  // the tips do not come back after it.
  const [attempted, setAttempted] = useState(() => resumeTake && recordingStore.hasTake);
  // "İzin ver" only asks for the microphone; a second tap while the system
  // dialog is up does nothing.
  const askingPermission = useRef(false);
  // "Baştan başla" during a take: the take stays drawn as live until the
  // next one records.
  const [restarting, setRestarting] = useState(false);
  const restartingRef = useRef(false);
  // A refusal shown in the hint line instead of a snackbar over the button.
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The last level measured in the take (written by the panel), announced
  // once after it.
  const lastLevel = useRef<InputLevel>('idle');
  const wasRecording = useRef(false);

  const stopListenBack = () => {
    try {
      if (playerStatus?.playing) player.pause();
    } catch {
      // Player may already be released.
    }
  };

  const clearFlash = () => {
    if (flashTimer.current) {
      clearTimeout(flashTimer.current);
      flashTimer.current = null;
    }
    setFlash(null);
  };

  const showFlash = (message: string) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(message);
    flashTimer.current = setTimeout(() => {
      flashTimer.current = null;
      setFlash(null);
    }, HINT_FLASH_MS);
  };

  // ─── Mount / unmount ───
  useEffect(() => {
    // Keep the saved take only when coming back from a re-consent.
    if (!(resumeTake && recordingStore.hasTake)) {
      recordingStore.reset();
    }
    // Durations + name are applied by the config effect below (it runs
    // right after this one, and again whenever the config changes).
    if (!voiceProfileStore.cloneConfigFor(language) && !voiceProfileStore.isLoadingCloneConfig) {
      voiceProfileStore.loadCloneConfig(language);
    }
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      // Stops a running take and hands the audio session back to playback.
      recordingStore.cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply config durations once they arrive (or change after a refetch).
  useEffect(() => {
    if (!config) return;
    recordingStore.configure(
      {
        minSeconds: config.minSeconds,
        targetSeconds: config.targetSeconds,
        maxSeconds: config.maxSeconds,
      },
      profileName,
    );
  }, [config, profileName, recordingStore]);

  // Pause listen-back when the player instance is replaced or unmounted.
  useEffect(() => {
    return () => {
      try {
        player.pause();
      } catch {
        // Released already.
      }
    };
  }, [player]);

  // Rewind after natural end so the next listen starts from the top.
  useEffect(() => {
    if (playerStatus?.didJustFinish) {
      player.seekTo(0).catch(() => undefined);
    }
  }, [playerStatus?.didJustFinish, player]);

  // App backgrounded mid-take: stop it (a long-enough take is kept). Back in
  // the foreground: the user may have granted the microphone in the settings.
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'background' && recordingStore.isRecording) {
        void recordingStore.stopRecording('interrupted');
      } else if (next === 'active' && recordingStore.isPermissionDenied) {
        void recordingStore.refreshMicrophonePermission();
      }
    });
    return () => sub.remove();
  }, [recordingStore]);

  // The screen stays on while the user reads (they do not touch it) and
  // while the take uploads: a screen timeout would cut the take short.
  useEffect(() => {
    if (!isRecording && !isProcessing) return undefined;
    setKeepAwake(true);
    return () => setKeepAwake(false);
  }, [isRecording, isProcessing]);

  // A take starts or ends.
  useEffect(() => {
    if (isRecording) {
      setAttempted(true);
      lastLevel.current = 'idle';
    } else {
      // The level once, after the take (the meter is no live region while
      // the microphone is open). A restart is not the end of a take.
      if (wasRecording.current && !restartingRef.current && lastLevel.current !== 'idle') {
        AccessibilityInfo.announceForAccessibility(
          t('recording.level.a11y', { state: t(`recording.level.${lastLevel.current}`) }),
        );
      }
      lastLevel.current = 'idle';
      if (flashTimer.current) clearFlash();
    }
    wasRecording.current = isRecording;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  // Android hardware back follows the same confirm rules as the app bar.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Handlers ───
  // The screen leaves once; after a confirmed "Çık" back does nothing more.
  const leftRef = useRef(false);
  const leavingRef = useRef(false);
  const leave = () => {
    if (leftRef.current) return;
    leftRef.current = true;
    leavingRef.current = true;
    stopListenBack();
    nav.goBack();
  };

  // The leave dialogs drop the take in `onPress` and go back only once the
  // dialog's window is gone (`afterClose`): the screen and the closing
  // dialog never leave in one commit (VR-01).
  const handleBack = () => {
    if (recordingStore.isProcessing || leavingRef.current) return;
    if (recordingStore.isRecording) {
      let cancelled: Promise<void> = Promise.resolve();
      showDialog({
        title: t('recording.leave.title'),
        message: t('recording.leave.running'),
        buttons: [
          {
            text: t('recording.leave.confirm'),
            style: 'destructive',
            onPress: () => {
              leavingRef.current = true;
              cancelled = recordingStore.cancelRecording();
            },
            afterClose: () => {
              // The microphone is closed before the screen goes.
              void cancelled.then(leave, leave);
            },
          },
          { text: t('recording.leave.keepRecording'), style: 'cancel' },
        ],
      });
      return;
    }
    if (recordingStore.hasTake) {
      showDialog({
        title: t('recording.leave.title'),
        message: t('recording.leave.unsent'),
        buttons: [
          {
            text: t('recording.leave.confirm'),
            style: 'destructive',
            onPress: () => {
              leavingRef.current = true;
              recordingStore.discardTake();
            },
            afterClose: leave,
          },
          { text: t('common:cancel'), style: 'cancel' },
        ],
      });
      return;
    }
    leave();
  };

  const handleRecordPress = async () => {
    if (recordingStore.isStarting || recordingStore.isProcessing) return;

    if (recordingStore.isRecording) {
      if (!recordingStore.requestStop()) {
        // Right above the button: a snackbar would cover it and eat the tap.
        showFlash(
          recordingStore.isAwaitingSpeech
            ? t('recording.toastAwaiting')
            : t('recording.toastTooShort', {
                min: Math.ceil(recordingStore.durations.minSeconds),
              }),
        );
      }
      return;
    }

    stopListenBack();
    // A story playing in the background would end up in the take.
    if (appAudioPlayer.isPlaying) {
      await appAudioPlayer.pause();
    }
    // Asks for the microphone first while the system dialog can be shown.
    await recordingStore.startRecording();
  };

  const handleRestart = async () => {
    if (restartingRef.current) return;
    restartingRef.current = true;
    setRestarting(true);
    try {
      await recordingStore.restartRecording();
    } finally {
      restartingRef.current = false;
      setRestarting(false);
    }
  };

  const handleTogglePlayback = () => {
    if (!recordingStore.recordedFilePath) return;
    try {
      if (isPlayingBack) {
        player.pause();
      } else {
        const duration = playerStatus?.duration ?? 0;
        const position = playerStatus?.currentTime ?? 0;
        if (duration > 0 && position >= duration - 0.25) {
          player.seekTo(0).catch(() => undefined);
        }
        player.play();
      }
    } catch (error) {
      console.warn('Playback toggle failed:', error);
    }
  };

  // A finished take is only dropped after a yes.
  const handleReRecord = () => {
    showDialog({
      title: t('review.restartConfirm.title'),
      message: t('review.restartConfirm.message'),
      buttons: [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('review.restartConfirm.confirm'),
          style: 'destructive',
          onPress: () => {
            stopListenBack();
            recordingStore.discardTake();
          },
        },
      ],
    });
  };

  const goToConsent = () => {
    nav.popTo('VoiceConsent', {
      name: profileName,
      resumeTake: true,
      language,
      ...(returnToStoryId ? { returnToStoryId } : null),
    });
  };

  const openProcessing = (profileId: string) => {
    nav.replace('Processing', { profileId, ...(returnToStoryId ? { returnToStoryId } : null) });
  };

  const handleSubmitError = async (error: CloneErrorInfo, profileId?: string) => {
    switch (error.action) {
      case 'reconsent':
        // New consent version: refetch, then accept it again. The take is
        // kept (resumeTake) so the user does not have to read again.
        await voiceProfileStore.refreshCloneConfigForReconsent();
        showDialog({
          title: error.title,
          message: error.message,
          cancelable: false,
          // Back to consent once the dialog is gone (VR-01).
          buttons: [{ text: t('toConsent'), afterClose: goToConsent }],
        });
        return;
      case 'paywall':
        // The plan block dialog of the whole app: [Vazgeç, Planları gör].
        showBlock(error.title, error.message, true);
        return;
      case 'track':
        showDialog({
          title: error.title,
          message: error.message,
          cancelable: false,
          buttons: [
            {
              text: t('common:ok'),
              onPress: () => {
                if (profileId) voiceProfileStore.trackVoiceProfile(profileId);
              },
              // The screen goes once the dialog is gone (VR-01).
              afterClose: () => {
                if (profileId) openProcessing(profileId);
                else nav.goBack();
              },
            },
          ],
        });
        return;
      case 'retry':
        showDialog({
          title: error.title,
          message: error.message,
          buttons: [
            { text: t('common:retry'), onPress: () => void handleSubmit() },
            { text: t('common:cancel'), style: 'cancel' },
          ],
        });
        return;
      default:
        showDialog({
          title: error.title,
          message: error.message,
          buttons: [{ text: t('common:ok') }],
        });
    }
  };

  const handleSubmit = async () => {
    if (!recordingStore.hasTake || recordingStore.isProcessing) return;
    if (!consentVersion) {
      goToConsent();
      return;
    }
    stopListenBack();

    const result = await recordingStore.submitClone(
      consentVersion,
      subscriptionStore.planId,
      // The locale of the language the script and the consent were shown in.
      config?.locale,
    );
    if (result.ok) {
      voiceProfileStore.loadVoiceProfiles();
      voiceProfileStore.loadVoiceSlots();
      voiceProfileStore.trackVoiceProfile(result.profileId);
      openProcessing(result.profileId);
      return;
    }
    await handleSubmitError(result.error, result.profileId);
  };

  const handleOpenSettings = () => {
    Linking.openSettings().catch(() => undefined);
  };

  // The card's "İzin ver": the system dialog only. A grant must not open the
  // microphone for a take the user has not started (the record button does).
  const handleAskPermission = async () => {
    if (askingPermission.current) return;
    askingPermission.current = true;
    try {
      await recordingStore.requestMicrophonePermission();
    } finally {
      askingPermission.current = false;
    }
  };

  // ─── Guards: config + consent are preconditions for recording ───
  if (!config) {
    const loading =
      voiceProfileStore.isLoadingCloneConfig ||
      (!voiceProfileStore.cloneConfig && !voiceProfileStore.cloneConfigError);
    return (
      <View style={styles.container}>
        <TopAppBar variant="back" title={t('recording.bar')} onBack={leave} />
        <View style={styles.center}>
          {loading ? (
            <LoadingLine label={t('recording.loading')} direction="column" testID="recording-loading" />
          ) : (
            <StateView
              icon="alert"
              title={t('recording.configErrorTitle')}
              message={voiceProfileStore.cloneConfigError ?? undefined}
              actionLabel={t('common:retry')}
              onAction={() => voiceProfileStore.loadCloneConfig(language)}
              testID="recording-config-error"
            />
          )}
        </View>
      </View>
    );
  }

  if (!consentVersion) {
    return (
      <View style={styles.container}>
        <TopAppBar variant="back" title={t('recording.bar')} onBack={leave} />
        <View style={styles.center}>
          <StateView
            icon="document"
            title={t('recording.consentTitle')}
            message={t('recording.consentMessage')}
            actionLabel={t('toConsent')}
            onAction={goToConsent}
            testID="recording-consent-needed"
          />
        </View>
      </View>
    );
  }

  // ─── Derived state (only what changes a few times per take) ───
  const hasTake = recordingStore.hasTake;
  const permissionDenied = recordingStore.isPermissionDenied;
  // The system dialog can no longer be shown: only the settings help.
  const permissionPermanent = permissionDenied && !recordingStore.canAskPermissionAgain;
  // Before the first take only, so the reading script gets the scroll area
  // from the tap on record on (and after a rejected take too).
  const showGuidance =
    !attempted &&
    !isRecording &&
    !recordingStore.isStarting &&
    !hasTake &&
    !permissionDenied &&
    !recordingStore.takeRejectionMessage;
  // Served tips only in the app's language (they come in the voice language).
  const servedTips =
    languageCodeOf(config.language) === currentLanguage() ? config.recordingTips : null;
  const tips: Tip[] = servedTips
    ? servedTips.map(tip => ({
        icon: tip.icon ? TIP_ICONS[tip.icon] : TIP_ICON_GENERIC,
        text: tip.text,
      }))
    : [
        { icon: 'phone', text: t('recording.tips.distance') },
        { icon: 'book', text: t('recording.tips.calm') },
        { icon: 'clock', text: t('recording.tips.pauses') },
      ];

  const listenDuration = playerStatus?.duration ?? 0;
  const listenProgress =
    listenDuration > 0 ? Math.min((playerStatus?.currentTime ?? 0) / listenDuration, 1) : 0;

  // ─── Render ───
  return (
    <View style={styles.container}>
      <TopAppBar variant="back" title={t('recording.bar')} onBack={handleBack} />

      <View style={styles.scrollWrap}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
          testID="recording-scroll"
        >
          <FlowSteps
            total={CLONE_FLOW_STEPS}
            current={3}
            accessibilityLabel={t('stepsA11y', { current: 3, total: CLONE_FLOW_STEPS })}
            testID="recording-steps"
            style={styles.steps}
          />

          {/* The permission comes first: below the tips it was off screen. */}
          {permissionDenied ? (
            <Card testID="recording-permission" style={styles.block}>
              <View style={styles.permissionHead}>
                <View style={styles.permissionIcon}>
                  <Icon name="mic" size={20} color={T.error} />
                </View>
                <Text style={[text.subheading, styles.permissionTitle]}>
                  {t('recording.permissionTitle')}
                </Text>
              </View>
              <Text style={[text.bodySmall, styles.permissionBody]}>
                {permissionPermanent ? t('recording.permissionBody') : t('recording.permissionBodyAsk')}
              </Text>
              <Button
                label={permissionPermanent ? t('recording.permissionAction') : t('recording.permissionAsk')}
                variant="secondary"
                onPress={permissionPermanent ? handleOpenSettings : () => void handleAskPermission()}
                style={styles.permissionAction}
                testID="recording-permission-action"
              />
            </Card>
          ) : null}

          {showGuidance ? (
            <Card testID="recording-tips" style={styles.block} contentStyle={styles.tips}>
              {tips.map((tip, index) => (
                <View key={`${index}-${tip.text}`} style={styles.tip}>
                  <View style={styles.tipIcon}>
                    <Icon name={tip.icon} size={20} color={T.text} />
                  </View>
                  <Text style={styles.tipText}>{tip.text}</Text>
                </View>
              ))}
            </Card>
          ) : null}

          <ScriptCard
            eyebrow={t('recording.scriptEyebrow')}
            title={config.scriptTitle}
            paragraphs={scriptParagraphs}
          />
        </ScrollView>
        <LinearGradient
          pointerEvents="none"
          colors={[withAlpha(T.bg, 0), T.bg]}
          style={styles.fade}
        />
      </View>

      {/* ─── Pinned panel: the calm card that holds the recorder ─── */}
      <SurfaceLevelProvider level="surface">
        <View style={[styles.panel, { paddingBottom: dockBottom(insets.bottom) }]} testID="recording-panel">
          {hasTake ? (
            <ReviewPanel
              isPlayingBack={isPlayingBack}
              listenProgress={listenProgress}
              onTogglePlayback={handleTogglePlayback}
              onRestart={handleReRecord}
              onSubmit={() => void handleSubmit()}
            />
          ) : (
            <RecorderPanel
              flash={flash}
              restarting={restarting}
              onRecordPress={() => void handleRecordPress()}
              onRestart={() => void handleRestart()}
              levelRef={lastLevel}
            />
          )}
        </View>
      </SurfaceLevelProvider>
    </View>
  );
});

// ─────────────────────────────────────────────────────────────
// The script: drawn once, never again while a take runs
// ─────────────────────────────────────────────────────────────

interface ScriptCardProps {
  eyebrow: string;
  title: string;
  paragraphs: readonly string[];
}

export const ScriptCard = React.memo<ScriptCardProps>(({ eyebrow, title, paragraphs }) => {
  const T = useT();
  const text = textStylesFor(T);
  const styles = stylesFor(T);
  return (
    <Card testID="recording-script" radius={28} style={styles.block} contentStyle={styles.script}>
      <Text style={text.eyebrow}>{eyebrow}</Text>
      <Text style={[text.heading, styles.scriptTitle]}>{title}</Text>
      {paragraphs.map((paragraph, index) => (
        <Text key={index} style={[styles.scriptText, index > 0 && styles.scriptGap]}>
          {paragraph}
        </Text>
      ))}
    </Card>
  );
});
ScriptCard.displayName = 'ScriptCard';

// ─────────────────────────────────────────────────────────────
// The recorder: the only part that follows the level and the timer
// ─────────────────────────────────────────────────────────────

interface RecorderPanelProps {
  /** A refusal to show in the hint line for a moment. */
  flash: string | null;
  /** "Baştan başla" is between two takes: draw the take as still live. */
  restarting: boolean;
  onRecordPress: () => void;
  onRestart: () => void;
  /** Receives the last level measured in the take. */
  levelRef: MutableRefObject<InputLevel>;
}

const RecorderPanel: React.FC<RecorderPanelProps> = observer(
  ({ flash, restarting, onRecordPress, onRestart, levelRef }) => {
    const recordingStore = useVoiceRecording();
    const { t } = useTranslation('voiceFlow');
    const T = useT();
    const styles = stylesFor(T);
    const { fontScale } = useWindowDimensions();

    const d = recordingStore.durations;
    const isRecording = recordingStore.isRecording;
    const isStarting = recordingStore.isStarting;
    const isAwaitingSpeech = recordingStore.isAwaitingSpeech;
    // Between the two takes of a restart the stop square and the restart
    // button stay: no idle flash in between.
    const takeLive = isRecording || restarting;
    const elapsed = isRecording ? recordingStore.recordingDurationSeconds : 0;
    const stopReady = recordingStore.canStop;
    const permissionDenied = recordingStore.isPermissionDenied;
    const permissionPermanent = permissionDenied && !recordingStore.canAskPermissionAgain;
    // Hard block: the press itself is disabled. While the system dialog can
    // still be shown, a tap on record asks for the microphone.
    const recordBlocked = isStarting || permissionPermanent;
    // Soft block: stop before minSeconds stays tappable (it explains why) but
    // is announced as disabled.
    const stopLocked = isRecording && !stopReady;

    // While no speech was detected the meter moves but nothing is judged yet.
    const level: InputLevel = isRecording && !isAwaitingSpeech ? recordingStore.inputLevel : 'idle';
    useEffect(() => {
      if (level !== 'idle') levelRef.current = level;
    }, [level, levelRef]);
    const levelState = !isRecording
      ? t('recording.level.idle')
      : level === 'idle'
        ? t('recording.level.measuring')
        : t(`recording.level.${level}`);

    const seconds = {
      min: Math.ceil(d.minSeconds),
      target: Math.ceil(d.targetSeconds),
      max: Math.ceil(d.maxSeconds),
    };
    let hint: string;
    let hintColor: string = T.text2;
    if (flash) {
      hint = flash;
      hintColor = T.error;
    } else if (!isRecording) {
      if (isStarting) {
        hint = t('recording.hint.starting');
      } else if (permissionDenied) {
        hint = t('recording.hint.permission');
        hintColor = T.error;
      } else if (recordingStore.takeRejectionMessage) {
        // Why the last take was not kept, in the same line: the panel keeps
        // its height.
        hint = recordingStore.takeRejectionMessage;
        hintColor = T.error;
      } else {
        hint = t('recording.hint.idle');
      }
    } else if (isAwaitingSpeech) {
      hint = t('recording.hint.awaiting');
    } else if (level === 'quiet' || level === 'loud') {
      hint = t(`recording.hint.${level}`);
      hintColor = levelColor(T, level);
    } else if (elapsed < d.minSeconds) {
      hint = t('recording.hint.beforeMin', seconds);
    } else if (elapsed < d.targetSeconds) {
      hint = t('recording.hint.beforeTarget', seconds);
    } else {
      hint = t('recording.hint.afterTarget', seconds);
    }
    // Two lines reserved at any font size up to the cap, so a one-line hint
    // never moves the meter and the panel edge.
    const hintMinHeight = Math.ceil(2 * HINT_LINE * Math.min(fontScale, HINT_MAX_SCALE));

    return (
      <>
        <LevelMeter
          label={t('recording.level.label')}
          stateLabel={levelState}
          level={level}
          active={isRecording}
          fraction={zonedMeterFraction(recordingStore.currentLevelDbfs, levelThresholds(Platform.OS))}
          zoneLabels={{
            quiet: t('recording.level.zoneQuiet'),
            good: t('recording.level.zoneGood'),
            loud: t('recording.level.zoneLoud'),
          }}
          accessibilityLabel={t('recording.level.a11y', { state: levelState })}
        />

        <TakeProgress
          progress={recordingProgress(elapsed, d)}
          minFraction={markerFraction(d.minSeconds, d)}
          targetFraction={markerFraction(d.targetSeconds, d)}
          minLabel={t('recording.markerMin', { seconds: seconds.min })}
          targetLabel={t('recording.markerTarget', { seconds: seconds.target })}
          reachedMin={stopReady}
          reachedTarget={isRecording && recordingStore.reachedTarget}
          active={isRecording}
          accessibilityLabel={t('recording.progressA11y')}
        />

        <Text
          testID="recording-hint"
          numberOfLines={2}
          maxFontSizeMultiplier={HINT_MAX_SCALE}
          style={[styles.hint, { color: hintColor, minHeight: hintMinHeight }]}
        >
          {hint}
        </Text>

        <View style={styles.controls}>
          <View style={styles.side}>
            {takeLive ? (
              <Button
                label={t('recording.restart')}
                variant="text"
                icon="restart"
                onPress={onRestart}
                disabled={restarting || isStarting}
                pressDelay={0}
                style={styles.restart}
                testID="recording-restart"
              />
            ) : null}
          </View>

          <RecordButton
            recording={takeLive}
            onPress={onRecordPress}
            disabled={recordBlocked}
            dimmed={permissionPermanent}
            softLocked={stopLocked}
            accessibilityLabel={takeLive ? t('recording.stopA11y') : t('recording.start')}
            accessibilityHint={
              stopLocked ? t('recording.stopLockedHint', { min: seconds.min }) : undefined
            }
          />

          <View
            style={[styles.side, styles.sideRight]}
            accessible
            accessibilityLabel={t('recording.clockA11y', {
              elapsed: formatClock(elapsed),
              max: formatClock(d.maxSeconds),
            })}
          >
            <Text testID="recording-clock" style={styles.clock}>
              {formatClock(elapsed)}
            </Text>
            {/* Digits only, the same in every language. */}
            <Text style={styles.clockMax}>{`/ ${formatClock(d.maxSeconds)}`}</Text>
          </View>
        </View>
      </>
    );
  },
);

// ─────────────────────────────────────────────────────────────
// The review of a kept take
// ─────────────────────────────────────────────────────────────

interface ReviewPanelProps {
  isPlayingBack: boolean;
  listenProgress: number;
  onTogglePlayback: () => void;
  /** Asks, then drops the take. */
  onRestart: () => void;
  onSubmit: () => void;
}

const ReviewPanel: React.FC<ReviewPanelProps> = observer(
  ({ isPlayingBack, listenProgress, onTogglePlayback, onRestart, onSubmit }) => {
    const recordingStore = useVoiceRecording();
    const { t } = useTranslation('voiceFlow');
    const T = useT();
    const text = textStylesFor(T);
    const styles = stylesFor(T);
    const isProcessing = recordingStore.isProcessing;
    const percent = recordingStore.processingProgress;

    return (
      <>
        <Text accessibilityRole="header" style={text.heading}>
          {t('review.title')}
        </Text>
        <SamplePlayer
          icon={isPlayingBack ? 'pause' : 'play'}
          onPress={onTogglePlayback}
          disabled={isProcessing}
          accessibilityLabel={isPlayingBack ? t('review.pause') : t('review.play')}
          progress={listenProgress}
          timeLabel={formatClock(recordingStore.recordedDurationSeconds)}
          bars={44}
          seed={11}
          testID="review-player"
          style={styles.reviewPlayer}
        />
        <View style={styles.reviewChecks}>
          {/* A take is only kept once it reached the minimum, so this
              line is a fact. The store keeps no level summary of the
              take, so no line about the level is shown. */}
          <StatusLine
            compact
            state="done"
            label={t('review.length', {
              seconds: Math.ceil(recordingStore.recordedDurationSeconds),
            })}
            testID="review-length"
          />
        </View>
        <Text style={[styles.hint, styles.reviewNote]}>{t('review.note')}</Text>
        <View style={styles.reviewActions}>
          <Button
            label={t('review.restart')}
            variant="secondary"
            onPress={onRestart}
            disabled={isProcessing}
            pressDelay={0}
            style={styles.reviewAction}
            testID="review-restart"
          />
          <Button
            // Short and constant: the percentage is the bar's.
            label={isProcessing ? t('review.uploadingShort') : t('review.submit')}
            onPress={onSubmit}
            loading={isProcessing}
            pressDelay={0}
            style={styles.reviewAction}
            testID="review-submit"
          />
        </View>
        {/* Always there, so nothing moves when the upload starts. */}
        <View style={styles.uploadSlot}>
          {isProcessing ? (
            <ProgressBar
              value={percent / 100}
              height={UPLOAD_BAR}
              accessibilityLabel={t('review.uploading', { percent })}
              testID="review-upload-progress"
            />
          ) : null}
        </View>
      </>
    );
  },
);

/** Top corners of the pinned recorder panel (a sheet-like calm card). */
const PANEL_RADIUS = 32;
/** The bottom fade of the script, and the scroll padding it covers (dp). */
const SCRIPT_FADE = SPACE.xxl;

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    scrollWrap: { flex: 1 },
    scrollContent: { paddingHorizontal: T.screenPadH, paddingTop: T.space.sm, paddingBottom: SCRIPT_FADE },
    fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: SCRIPT_FADE },
    steps: { marginBottom: T.space.tight },
    block: { marginTop: T.space.md },

    tips: { padding: T.space.md, gap: T.space.sm },
    tip: { flexDirection: 'row', alignItems: 'center', gap: T.space.md },
    tipIcon: {
      width: 34,
      height: 34,
      borderRadius: T.r.sm,
      backgroundColor: T.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tipText: {
      flex: 1,
      fontFamily: T.fontBody,
      fontSize: 13.5,
      lineHeight: 19,
      color: T.text2,
    },

    permissionHead: { flexDirection: 'row', alignItems: 'center', gap: T.space.md },
    permissionIcon: {
      width: 40,
      height: 40,
      borderRadius: T.r.sm,
      backgroundColor: withAlpha(T.error, 0.16),
      alignItems: 'center',
      justifyContent: 'center',
    },
    permissionTitle: { flex: 1 },
    permissionBody: { marginTop: T.space.sm },
    permissionAction: { marginTop: T.space.md },

    script: { paddingHorizontal: T.space.lg, paddingTop: T.space.lg, paddingBottom: T.space.xxxl },
    scriptTitle: { marginTop: T.space.xs, marginBottom: T.space.md },
    scriptText: {
      fontFamily: T.fontBody,
      fontSize: 19,
      lineHeight: 30,
      color: T.text,
    },
    scriptGap: { marginTop: T.space.md },

    panel: {
      paddingHorizontal: T.screenPadH,
      paddingTop: T.space.lg,
      backgroundColor: T.surface,
      borderTopLeftRadius: PANEL_RADIUS,
      borderTopRightRadius: PANEL_RADIUS,
    },
    hint: {
      fontFamily: T.fontBody,
      fontSize: 12.5,
      lineHeight: HINT_LINE,
      color: T.text2,
      marginTop: T.space.xs,
    },
    controls: { flexDirection: 'row', alignItems: 'center', marginTop: T.space.tight },
    side: { flex: 1, alignItems: 'flex-start' },
    sideRight: { alignItems: 'flex-end' },
    restart: { marginLeft: -T.space.md },
    clock: {
      fontFamily: T.fontDisplay,
      fontSize: 28,
      lineHeight: 37,
      color: T.text,
      fontVariant: ['tabular-nums'],
    },
    clockMax: {
      fontFamily: T.fontBody,
      fontSize: 12,
      lineHeight: 16,
      color: T.text2,
      fontVariant: ['tabular-nums'],
    },

    reviewPlayer: { marginTop: T.space.md },
    reviewChecks: { marginTop: T.space.md },
    reviewNote: { marginTop: T.space.sm },
    reviewActions: { flexDirection: 'row', gap: T.space.md, marginTop: T.space.lg },
    // A block button sharing a row: flex 1, and centred so it never stretches
    // vertically (SPEC-design 1.4).
    reviewAction: { flex: 1, alignSelf: 'center' },
    uploadSlot: { height: UPLOAD_BAR, marginTop: T.space.sm },
  });

const stylesFor = themedStyles(makeStyles);

export default VoiceRecordingScreen;
