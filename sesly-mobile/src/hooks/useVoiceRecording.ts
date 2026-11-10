/**
 * Voice Recording Store (own-voice clone flow).
 *
 * Records the reference take for a Cartesia instant clone with expo-audio:
 *   iOS:     LPCM WAV (.wav), 44.1 kHz, mono, 16-bit little-endian integer,
 *            AudioQuality.MAX. Uploaded as audio/wav.
 *   Android: AAC in MPEG-4 (.m4a), 48 kHz, mono, 256 kbps, VOICE_RECOGNITION
 *            audio source (AGC / noise suppression are off by default for
 *            that source). Uploaded as audio/m4a.
 *
 * The backend only transcodes to 44.1 kHz mono 16-bit WAV (no filters),
 * trims the lead-in before the uploaded speech-start anchor
 * (`speechStartMs`) and caps the clip at 60 s. It does not normalize or
 * denoise.
 *
 * Timing: the native recorder starts immediately (no lost first syllable)
 * but the user-facing timer counts speech-elapsed seconds from the first
 * detected speech. Durations (min / target / max) come from the clone config:
 * stopping is allowed from `minSeconds`, the recorder auto-stops at
 * `maxSeconds`, and shorter takes are rejected with a message in the UI
 * language.
 *
 * The session is switched to recording mode only while recording and is put
 * back to the player's playback mode (restorePlaybackAudioMode) afterwards.
 * A restart during a take keeps the recording mode between the two takes.
 *
 * The microphone permission is re-read when the app comes back to the
 * foreground (`refreshMicrophonePermission`), so a grant in the system
 * settings takes effect at once; `canAskPermissionAgain` tells a first
 * denial (the system dialog can still be shown) from a permanent one.
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { useMemo } from 'react';
import { Platform } from 'react-native';
import {
  AudioModule,
  AudioQuality,
  IOSOutputFormat,
  setAudioModeAsync,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  type AudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import VoiceProfileService from '../services/VoiceProfileService';
import { hasApiStatus } from '../services/ApiError';
import { getVoiceProfileStore } from './useVoiceProfile';
import { restorePlaybackAudioMode } from './useAudioPlayer';
import { VoiceProfile } from '../models/VoiceProfile';
import type { PlanId } from '../models/Plans';
import {
  CloneDurations,
  CloneErrorInfo,
  FALLBACK_CLONE_DURATIONS,
  InputLevel,
  canStopRecording,
  classifyInputLevel,
  describeCloneError,
  evaluateTake,
  shouldAutoStop,
  shouldDiscardPendingProfile,
} from '../models/VoiceClone';
import { TTSProvider, VoiceProfileStatus } from '../types/enums';
import { VOICE_CLONING } from '../config/constants';
import { showToast } from '../utils/toast';
import i18n from '../i18n';
import { msg } from '../i18n/messages';

// ============================================================================
// Recorder configuration
// ============================================================================

/**
 * Platform-flattened recorder options. The native AudioRecorder constructor
 * expects the flattened shape (common fields + one platform's fields), which
 * is what expo-audio's own `useAudioRecorder` builds via createRecordingOptions.
 * Passing the nested `{ ios, android }` object straight to the constructor
 * silently drops every platform field (format, encoder, quality, source).
 */
const IOS_CLONE_RECORDING_OPTIONS = {
  extension: '.wav',
  sampleRate: 44100,
  numberOfChannels: 1,
  // Required by the native record; ignored by AVAudioRecorder for LPCM.
  bitRate: 256000,
  isMeteringEnabled: true,
  outputFormat: IOSOutputFormat.LINEARPCM,
  audioQuality: AudioQuality.MAX,
  linearPCMBitDepth: 16,
  linearPCMIsBigEndian: false,
  linearPCMIsFloat: false,
} as const;

const ANDROID_CLONE_RECORDING_OPTIONS = {
  extension: '.m4a',
  sampleRate: 48000,
  numberOfChannels: 1,
  bitRate: 256000,
  isMeteringEnabled: true,
  outputFormat: 'mpeg4',
  audioEncoder: 'aac',
  audioSource: 'voice_recognition',
} as const;

function buildCloneRecordingOptions(): Partial<RecordingOptions> {
  const flattened =
    Platform.OS === 'ios' ? IOS_CLONE_RECORDING_OPTIONS : ANDROID_CLONE_RECORDING_OPTIONS;
  return flattened as unknown as Partial<RecordingOptions>;
}

// How often we sample the recorder's duration + metering.
const TIMER_POLL_MS = 100;
/** Polls without a running native recorder before the take counts as interrupted. */
export const PAUSED_POLLS_TO_STOP = 3;

type StopReason = 'user' | 'auto' | 'interrupted' | 'no_speech_timeout' | 'cancel';

export type SubmitCloneResult =
  | { readonly ok: true; readonly profileId: string }
  | {
      readonly ok: false;
      readonly error: CloneErrorInfo;
      /** Set when the sample is already on the backend (VOICE_ALREADY_UPLOADED). */
      readonly profileId?: string;
    };

// ============================================================================
// Voice Recording Store (MobX)
// ============================================================================

/** The language a clone is created in when the flow names none. */
const DEFAULT_CLONE_LOCALE = 'tr-TR';

class VoiceRecordingStore {
  // --- Recording state ---
  isRecording = false;
  isStarting = false;
  /**
   * `true` between tapping record and the first detected speech. The native
   * recorder already runs, but the timer stays at 0 and the auto-stop is
   * paused until metering crosses VOICE_DETECT_THRESHOLD_DBFS for
   * VOICE_DETECT_CONSECUTIVE_SAMPLES polls in a row.
   */
  isAwaitingSpeech = false;
  speechDetected = false;
  /** Latest dBFS reading (-160 = silence, 0 = full scale). */
  currentLevelDbfs = -160;
  /** Rolling-window classification for the "too quiet / good / too loud" hint. */
  inputLevel: InputLevel = 'idle';
  /** Speech-elapsed seconds of the running take. */
  recordingDurationSeconds = 0;

  // --- Saved take ---
  recordedFilePath = '';
  recordedDurationSeconds = 0;
  /** ms offset of the first detected speech inside the saved file. */
  takeSpeechStartMs: number | null = null;
  /** Why the last take was not kept (too short, no speech). */
  takeRejectionMessage: string | null = null;

  // --- Config for the active flow ---
  durations: CloneDurations = FALLBACK_CLONE_DURATIONS;
  profileName: string | null = null;

  // --- Upload state ---
  isProcessing = false;
  processingProgress = 0; // 0-100
  createdProfile: VoiceProfile | null = null;
  lastError: CloneErrorInfo | null = null;

  // --- Errors ---
  recordingError: string | null = null;
  isPermissionDenied = false;
  /**
   * Whether the system permission dialog can still be shown. False after a
   * permanent denial: only the system settings can grant it then.
   */
  canAskPermissionAgain = true;

  // --- Native handles / internals (not observable) ---
  private recorder: AudioRecorder | null = null;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private isStopping = false;
  private speechStartMs: number | null = null;
  private consecutiveLoudSamples = 0;
  /** Polls in a row in which the native recorder said it is not recording. */
  private pausedPolls = 0;
  private levelWindow: number[] = [];
  private recordingModeActive = false;
  private startToken = 0;

  constructor() {
    makeAutoObservable<
      this,
      | 'recorder'
      | 'timerHandle'
      | 'isStopping'
      | 'speechStartMs'
      | 'consecutiveLoudSamples'
      | 'pausedPolls'
      | 'levelWindow'
      | 'recordingModeActive'
      | 'startToken'
    >(this, {
      recorder: false,
      timerHandle: false,
      isStopping: false,
      speechStartMs: false,
      consecutiveLoudSamples: false,
      pausedPolls: false,
      levelWindow: false,
      recordingModeActive: false,
      startToken: false,
    });
  }

  // ============================================================================
  // Getters
  // ============================================================================

  /** The user may stop the running take (minimum reached). */
  get canStop(): boolean {
    return (
      this.isRecording &&
      !this.isAwaitingSpeech &&
      canStopRecording(this.recordingDurationSeconds, this.durations)
    );
  }

  get hasTake(): boolean {
    return !this.isRecording && this.recordedFilePath.length > 0;
  }

  get reachedTarget(): boolean {
    return this.recordingDurationSeconds >= this.durations.targetSeconds;
  }

  // ============================================================================
  // Setup
  // ============================================================================

  /** Apply the clone config durations and the profile name for this flow. */
  configure(durations: CloneDurations, profileName: string): void {
    this.durations = durations;
    this.profileName = profileName;
  }

  private applyPermission(response: { granted: boolean; canAskAgain?: boolean }): void {
    this.isPermissionDenied = !response.granted;
    // A response without the field (older module) is treated as askable.
    this.canAskPermissionAgain = response.granted || response.canAskAgain !== false;
  }

  /** Ask for the microphone (shows the system dialog while it can be asked). */
  async requestMicrophonePermission(): Promise<boolean> {
    try {
      const response = await requestRecordingPermissionsAsync();
      runInAction(() => {
        this.applyPermission(response);
      });
      return response.granted;
    } catch (error) {
      console.error('Permission request error:', error);
      showToast.error(msg('recording.permissionCheckFailed'));
      runInAction(() => {
        this.isPermissionDenied = true;
      });
      return false;
    }
  }

  /**
   * Re-read the permission without asking (the app came back from the
   * system settings). A failed check keeps the last known state.
   */
  async refreshMicrophonePermission(): Promise<void> {
    try {
      const response = await getRecordingPermissionsAsync();
      runInAction(() => {
        this.applyPermission(response);
      });
    } catch (error) {
      console.warn('Permission check error:', error);
    }
  }

  // ============================================================================
  // Recording
  // ============================================================================

  async startRecording(): Promise<void> {
    if (this.isRecording || this.isStarting) return;
    this.isStarting = true;
    // cleanup() / reset() / cancelRecording() bump startToken while a start
    // is in flight; every await in beginTake re-checks it so an unmounted
    // screen never ends up with a live microphone.
    const token = ++this.startToken;
    await this.beginTake(token);
  }

  /**
   * "Baştan başla" during a take: drop it and start a new one at once.
   * `isStarting` stays true from the tap until the new take records, so the
   * screen never falls back to its idle state in between, and the session
   * keeps its recording mode across the two takes (no native mode switch
   * back and forth).
   */
  async restartRecording(): Promise<void> {
    if (this.isStarting || this.isStopping) return;
    this.isStarting = true;
    const token = ++this.startToken;
    if (this.isRecording) {
      await this.stop('cancel', { keepRecordingMode: true });
    }
    if (token !== this.startToken) {
      // cleanup() / reset() / cancelRecording() ran meanwhile.
      await this.restoreAudioMode();
      return;
    }
    this.discardTake();
    await this.beginTake(token);
  }

  /** Permission, recording mode, a fresh recorder, record. `isStarting` is set. */
  private async beginTake(token: number): Promise<void> {
    const cancelled = () => token !== this.startToken;

    try {
      const granted = await this.requestMicrophonePermission();
      if (!granted || cancelled()) {
        // A restart may hold the recording mode already.
        await this.restoreAudioMode();
        return;
      }

      // Recording category for this take only; restored after stop. A
      // restart still has it from the take it replaced.
      if (!this.recordingModeActive) {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          interruptionMode: 'doNotMix',
          shouldPlayInBackground: false,
        });
        this.recordingModeActive = true;
      }
      if (cancelled()) {
        await this.restoreAudioMode();
        return;
      }

      this.speechStartMs = null;
      this.consecutiveLoudSamples = 0;
      this.pausedPolls = 0;
      this.levelWindow = [];
      runInAction(() => {
        this.recordingDurationSeconds = 0;
        this.recordedFilePath = '';
        this.recordedDurationSeconds = 0;
        this.takeSpeechStartMs = null;
        this.takeRejectionMessage = null;
        this.recordingError = null;
        this.isPermissionDenied = false;
        this.speechDetected = false;
        this.currentLevelDbfs = -160;
        this.inputLevel = 'idle';
        this.isAwaitingSpeech = true;
      });

      // Fresh recorder per attempt; a stopped/released one is not reusable.
      const recorder = new AudioModule.AudioRecorder(buildCloneRecordingOptions());
      this.recorder = recorder;
      await recorder.prepareToRecordAsync();
      if (cancelled()) {
        this.disposeRecorder();
        runInAction(() => {
          this.isAwaitingSpeech = false;
        });
        await this.restoreAudioMode();
        return;
      }
      recorder.record();

      runInAction(() => {
        this.isRecording = true;
      });
      this.startTimer();
    } catch (error) {
      if (cancelled()) {
        this.disposeRecorder();
        await this.restoreAudioMode();
        return;
      }
      console.error('Recording start error:', error);
      runInAction(() => {
        this.recordingError = msg('recording.startFailedLong');
        this.isRecording = false;
        this.isAwaitingSpeech = false;
      });
      showToast.error(msg('recording.startFailed'));
      this.disposeRecorder();
      await this.restoreAudioMode();
    } finally {
      if (!cancelled()) {
        runInAction(() => {
          this.isStarting = false;
        });
      }
    }
  }

  /** Abandon a start that is still in flight (see startRecording). */
  private cancelPendingStart(): void {
    if (!this.isStarting) return;
    this.startToken += 1;
    this.isStarting = false;
  }

  /**
   * User tapped stop. Refused (returns false) until `minSeconds` of speech
   * have been recorded; the screen then explains why.
   */
  requestStop(): boolean {
    if (!this.canStop) return false;
    void this.stopRecording('user');
    return true;
  }

  async stopRecording(reason: StopReason = 'user'): Promise<void> {
    await this.stop(reason);
  }

  /**
   * @param options.keepRecordingMode leave the session in recording mode
   *   (a restart starts the next take right away).
   */
  private async stop(
    reason: StopReason,
    options: { keepRecordingMode?: boolean } = {},
  ): Promise<void> {
    // Guard against re-entrant calls (timer auto-stop + user tap + unmount).
    if (!this.isRecording || this.isStopping || !this.recorder) return;
    this.isStopping = true;
    const recorder = this.recorder;

    try {
      this.stopTimer();
      await recorder.stop();
      const rawUri = recorder.uri ?? '';
      const uri = !rawUri || rawUri.startsWith('file://') ? rawUri : `file://${rawUri}`;
      this.finishTake(uri, reason);
    } catch (error) {
      console.error(`Stop recording error (${reason}):`, error);
      runInAction(() => {
        this.recordingError = msg('recording.stopFailed');
        this.isRecording = false;
        this.isAwaitingSpeech = false;
        this.inputLevel = 'idle';
      });
    } finally {
      this.disposeRecorder();
      this.isStopping = false;
      if (!options.keepRecordingMode) await this.restoreAudioMode();
    }
  }

  /** Stop without keeping anything (back / cancel). */
  async cancelRecording(): Promise<void> {
    this.cancelPendingStart();
    if (this.isRecording) {
      await this.stopRecording('cancel');
    }
    this.discardTake();
  }

  /** Drop the saved take so the user can record again. */
  discardTake(): void {
    this.recordedFilePath = '';
    this.recordedDurationSeconds = 0;
    this.takeSpeechStartMs = null;
    this.takeRejectionMessage = null;
    this.recordingDurationSeconds = 0;
    this.speechDetected = false;
    this.inputLevel = 'idle';
    this.currentLevelDbfs = -160;
    this.lastError = null;
  }

  private finishTake(uri: string, reason: StopReason): void {
    this.isRecording = false;
    this.isAwaitingSpeech = false;
    this.inputLevel = 'idle';
    this.currentLevelDbfs = -160;

    if (reason === 'cancel') {
      this.recordedFilePath = '';
      return;
    }

    const verdict = evaluateTake(
      this.recordingDurationSeconds,
      this.speechDetected,
      this.durations,
    );
    if (verdict.ok && uri) {
      this.recordedFilePath = uri;
      this.recordedDurationSeconds = this.recordingDurationSeconds;
      this.takeSpeechStartMs = this.speechStartMs;
      this.takeRejectionMessage = null;
    } else {
      this.recordedFilePath = '';
      this.recordedDurationSeconds = 0;
      this.takeSpeechStartMs = null;
      this.takeRejectionMessage = verdict.ok
        ? msg('recording.saveFailed')
        : verdict.message;
    }
  }

  // ============================================================================
  // Timer (JS-driven poll of recorder status)
  // ============================================================================

  private startTimer(): void {
    this.stopTimer();
    this.timerHandle = setInterval(() => this.onTick(), TIMER_POLL_MS);
  }

  private stopTimer(): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private onTick(): void {
    const recorder = this.recorder;
    if (!recorder || !this.isRecording) return;

    let durationMs = 0;
    let meteringDbfs = -160;
    let nativeRecording = true;
    try {
      const status = recorder.getStatus();
      durationMs = status?.durationMillis ?? 0;
      nativeRecording = status?.isRecording !== false;
      meteringDbfs = typeof status?.metering === 'number' ? status.metering : -160;
    } catch (error) {
      // getStatus() can throw if the native recorder was already released.
      console.warn('Recorder status poll skipped:', error);
      this.stopTimer();
      return;
    }

    // iOS pauses the recorder natively on an interruption (a call, Siri, an
    // alarm) without telling JS: the duration freezes while the screen still
    // says recording. Stop the take like any interruption (a long enough take
    // is kept). Two polls in a row, so the start-up moment never trips it.
    if (!nativeRecording && !this.isStopping) {
      this.pausedPolls += 1;
      if (this.pausedPolls >= PAUSED_POLLS_TO_STOP) {
        void this.stopRecording('interrupted');
        return;
      }
    } else {
      this.pausedPolls = 0;
    }

    this.currentLevelDbfs = meteringDbfs;
    this.levelWindow.push(meteringDbfs);
    if (this.levelWindow.length > VOICE_CLONING.LEVEL_WINDOW_SAMPLES) {
      this.levelWindow.shift();
    }
    this.inputLevel = classifyInputLevel(this.levelWindow, Platform.OS);

    // Phase 1: armed, waiting for the user to actually speak.
    if (this.isAwaitingSpeech) {
      if (meteringDbfs >= VOICE_CLONING.VOICE_DETECT_THRESHOLD_DBFS) {
        this.consecutiveLoudSamples += 1;
      } else {
        this.consecutiveLoudSamples = 0;
      }

      if (this.consecutiveLoudSamples >= VOICE_CLONING.VOICE_DETECT_CONSECUTIVE_SAMPLES) {
        // Backdate by the detection window so the first syllable counts.
        const backdateMs = VOICE_CLONING.VOICE_DETECT_CONSECUTIVE_SAMPLES * TIMER_POLL_MS;
        this.speechStartMs = Math.max(0, durationMs - backdateMs);
        this.isAwaitingSpeech = false;
        this.speechDetected = true;
      } else if (durationMs / 1000 >= VOICE_CLONING.SPEECH_WAIT_TIMEOUT_SECONDS) {
        void this.stopRecording('no_speech_timeout');
      }
      this.recordingDurationSeconds = 0;
      return;
    }

    // Phase 2: speech-elapsed timer.
    const anchor = this.speechStartMs ?? 0;
    const elapsedSeconds = Math.max(0, durationMs - anchor) / 1000;
    this.recordingDurationSeconds = elapsedSeconds;

    if (shouldAutoStop(elapsedSeconds, this.durations)) {
      void this.stopRecording('auto');
    }
  }

  private disposeRecorder(): void {
    const recorder = this.recorder;
    this.recorder = null;
    if (!recorder) return;
    try {
      // SharedObject: free the native recorder now instead of waiting for GC.
      recorder.release();
    } catch {
      // Already released.
    }
  }

  private async restoreAudioMode(): Promise<void> {
    if (!this.recordingModeActive) return;
    this.recordingModeActive = false;
    await restorePlaybackAudioMode();
  }

  // ============================================================================
  // Clone creation (create PENDING profile + upload the take)
  // ============================================================================

  /**
   * Create the PENDING clone profile and upload the saved take with the
   * accepted consent version. On any upload failure the PENDING profile is
   * deleted (it would otherwise hold a slot), except VOICE_ALREADY_UPLOADED.
   *
   * When that delete failed too (offline), the PENDING profile is kept and
   * the next submit uploads to it again instead of creating a second one,
   * which the backend would refuse (the placeholder holds the clone slot).
   *
   * @param plan the user's plan for the limit dialogs (`SubscriptionStore.planId`).
   */
  async submitClone(
    consentVersion: string,
    plan: PlanId,
    language: string = DEFAULT_CLONE_LOCALE,
  ): Promise<SubmitCloneResult> {
    if (!this.recordedFilePath) {
      const error: CloneErrorInfo = {
        code: null,
        title: msg('recording.missingTitle'),
        message: msg('recording.missingMessage'),
        action: 'none',
      };
      this.lastError = error;
      return { ok: false, error };
    }
    if (this.isProcessing) {
      return {
        ok: false,
        error: {
          code: null,
          title: msg('recording.uploadingTitle'),
          message: msg('recording.uploadingMessage'),
          action: 'none',
        },
      };
    }

    this.isProcessing = true;
    this.processingProgress = 0;
    this.lastError = null;

    let profile: VoiceProfile | null = null;
    try {
      const reuse =
        this.createdProfile?.status === VoiceProfileStatus.PENDING ? this.createdProfile : null;
      if (reuse) {
        // Claimed for this upload: the voice store must not sweep it away.
        getVoiceProfileStore()?.unmarkPendingDiscard(reuse.id);
        profile = reuse;
        runInAction(() => {
          this.processingProgress = 10;
        });
        try {
          await this.uploadTake(reuse.id, consentVersion);
        } catch (error) {
          // The placeholder is gone after all (swept, or the backend's 24 h
          // clean-up): start over with a new one, once.
          if (!hasApiStatus(error, 404)) throw error;
          runInAction(() => {
            this.createdProfile = null;
          });
          profile = null;
          profile = await this.createPendingProfile(language);
          await this.uploadTake(profile.id, consentVersion);
        }
      } else {
        profile = await this.createPendingProfile(language);
        await this.uploadTake(profile.id, consentVersion);
      }
      const uploaded = profile;

      runInAction(() => {
        this.processingProgress = 100;
        this.isProcessing = false;
      });
      // The voice list must show the new voice (PROCESSING now), even when a
      // list load asked before the upload is still on its way.
      void getVoiceProfileStore()?.loadVoiceProfiles({ fresh: true });
      return { ok: true, profileId: uploaded.id };
    } catch (error) {
      console.error('Clone submit error:', error);
      const info = describeCloneError(error, plan);
      if (profile && shouldDiscardPendingProfile(error)) {
        await this.discardPendingProfile(profile.id);
      }
      runInAction(() => {
        this.lastError = info;
        this.isProcessing = false;
      });
      if (info.action === 'track' && profile) {
        return { ok: false, error: info, profileId: profile.id };
      }
      return { ok: false, error: info };
    }
  }

  /** The PENDING clone profile the take is uploaded to. */
  private async createPendingProfile(language: string): Promise<VoiceProfile> {
    const created = await VoiceProfileService.createVoiceProfile({
      // i18n.t, not msg(): the name lives in the voiceFlow namespace.
      name: this.profileName || i18n.t('voiceFlow:defaultName'),
      provider: TTSProvider.CARTESIA,
      voiceId: 'custom-cloning-pending',
      language: language || DEFAULT_CLONE_LOCALE,
    });
    runInAction(() => {
      this.createdProfile = created;
      this.processingProgress = 10;
    });
    return created;
  }

  private async uploadTake(profileId: string, consentVersion: string): Promise<void> {
    await VoiceProfileService.uploadCloneSample(
      profileId,
      {
        fileUri: this.recordedFilePath,
        consentVersion,
        speechStartMs: this.takeSpeechStartMs,
      },
      progress => {
        runInAction(() => {
          this.processingProgress = 10 + Math.floor(progress * 0.9);
        });
      },
    );
  }

  /**
   * Delete the PENDING profile of a failed upload. If that fails too, the
   * profile stays as `createdProfile` (the next submit reuses it) and the
   * voice store deletes it after its next successful list load.
   */
  private async discardPendingProfile(profileId: string): Promise<void> {
    const voiceStore = getVoiceProfileStore();
    try {
      await VoiceProfileService.deleteVoiceProfile(profileId);
    } catch (deleteError) {
      console.warn(`Could not discard PENDING voice profile ${profileId}:`, deleteError);
      voiceStore?.markPendingDiscard(profileId);
      return;
    }
    runInAction(() => {
      if (this.createdProfile?.id === profileId) {
        this.createdProfile = null;
      }
    });
    // Keep the voice list + slot counter in sync if the store is alive (a
    // list load already running may still name the deleted profile).
    if (voiceStore) {
      void voiceStore.loadVoiceProfiles({ fresh: true });
      void voiceStore.loadVoiceSlots();
    }
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  clearLastError(): void {
    this.lastError = null;
  }

  /** Full reset for a fresh flow (keeps nothing). */
  reset(): void {
    this.cancelPendingStart();
    if (this.isRecording) {
      void this.stopRecording('cancel');
    }
    this.stopTimer();
    this.discardTake();
    this.isAwaitingSpeech = false;
    this.isProcessing = false;
    this.processingProgress = 0;
    this.createdProfile = null;
    this.recordingError = null;
    this.isPermissionDenied = false;
    this.canAskPermissionAgain = true;
    this.durations = FALLBACK_CLONE_DURATIONS;
    this.profileName = null;
  }

  /**
   * Screen unmount / app background: stop a running take (it is evaluated
   * like a normal stop, so a long-enough take survives) and always hand the
   * audio session back to playback.
   */
  cleanup(): void {
    this.cancelPendingStart();
    if (this.isRecording) {
      void this.stopRecording('interrupted');
    } else {
      this.stopTimer();
      void this.restoreAudioMode();
    }
  }
}

// ============================================================================
// Hook Export (Singleton Pattern)
// ============================================================================

let voiceRecordingStoreInstance: VoiceRecordingStore | null = null;

export function useVoiceRecording(): VoiceRecordingStore {
  const store = useMemo(() => {
    if (!voiceRecordingStoreInstance) {
      voiceRecordingStoreInstance = new VoiceRecordingStore();
    }
    return voiceRecordingStoreInstance;
  }, []);

  return store;
}

// Export for testing or direct access
export { VoiceRecordingStore };
