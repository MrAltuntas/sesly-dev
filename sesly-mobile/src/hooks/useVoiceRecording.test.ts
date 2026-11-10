/**
 * Recording-duration gating in VoiceRecordingStore with a fake expo-audio
 * recorder: speech detection anchor, stop refused before minSeconds,
 * auto-stop at maxSeconds, short / silent takes rejected, and the audio
 * session handed back to playback after every take.
 */

interface MockRecorder {
  uri: string | null;
  prepareToRecordAsync: jest.Mock;
  record: jest.Mock;
  stop: jest.Mock;
  release: jest.Mock;
  getStatus: () => { durationMillis: number; metering: number; isRecording?: boolean };
}

const mockState = {
  durationMillis: 0,
  metering: -160,
  constructed: [] as Array<Record<string, unknown>>,
  // Failure injection for the native recorder (null = behave normally).
  recorders: [] as MockRecorder[],
  uri: '/tmp/recording-1.wav' as string | null,
  prepareGate: null as Promise<void> | null,
  /** Called when prepareToRecordAsync starts (records store state mid-start). */
  onPrepare: null as (() => void) | null,
  prepareError: null as Error | null,
  recordError: null as Error | null,
  stopError: null as Error | null,
  statusError: null as Error | null,
  /** What the native recorder says about itself (undefined: not reported). */
  nativeRecording: undefined as boolean | undefined,
};

jest.mock('expo-audio', () => ({
  AudioModule: {
    AudioRecorder: jest.fn().mockImplementation((options: Record<string, unknown>) => {
      mockState.constructed.push(options);
      const recorder = {
        uri: mockState.uri,
        prepareToRecordAsync: jest.fn(() => {
          mockState.onPrepare?.();
          return (mockState.prepareGate ?? Promise.resolve()).then(() => {
            if (mockState.prepareError) throw mockState.prepareError;
          });
        }),
        record: jest.fn(() => {
          if (mockState.recordError) throw mockState.recordError;
        }),
        stop: jest.fn(() =>
          mockState.stopError ? Promise.reject(mockState.stopError) : Promise.resolve(),
        ),
        release: jest.fn(),
        getStatus: () => {
          if (mockState.statusError) throw mockState.statusError;
          return {
            durationMillis: mockState.durationMillis,
            metering: mockState.metering,
            isRecording: mockState.nativeRecording,
          };
        },
      };
      mockState.recorders.push(recorder);
      return recorder;
    }),
  },
  AudioQuality: { MAX: 127 },
  IOSOutputFormat: { LINEARPCM: 'lpcm' },
  setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
  requestRecordingPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  getRecordingPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
}));

const mockRestore = jest.fn().mockResolvedValue(undefined);
jest.mock('./useAudioPlayer', () => ({
  restorePlaybackAudioMode: () => mockRestore(),
}));
interface MockVoiceStore {
  loadVoiceProfiles: jest.Mock;
  loadVoiceSlots: jest.Mock;
  markPendingDiscard: jest.Mock;
  unmarkPendingDiscard: jest.Mock;
}
const mockVoiceStore = {
  current: null as null | MockVoiceStore,
};
const makeMockVoiceStore = (): MockVoiceStore => ({
  loadVoiceProfiles: jest.fn(),
  loadVoiceSlots: jest.fn(),
  markPendingDiscard: jest.fn(),
  unmarkPendingDiscard: jest.fn(),
});
jest.mock('./useVoiceProfile', () => ({
  getVoiceProfileStore: () => mockVoiceStore.current,
}));
const mockCreateVoiceProfile = jest.fn();
const mockUploadCloneSample = jest.fn();
const mockDeleteVoiceProfile = jest.fn();
jest.mock('../services/VoiceProfileService', () => ({
  __esModule: true,
  default: {
    createVoiceProfile: (...args: unknown[]) => mockCreateVoiceProfile(...args),
    uploadCloneSample: (...args: unknown[]) => mockUploadCloneSample(...args),
    deleteVoiceProfile: (...args: unknown[]) => mockDeleteVoiceProfile(...args),
  },
}));
jest.mock('../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { Platform } from 'react-native';
import { autorun } from 'mobx';
import { renderHook } from '@testing-library/react-native';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import i18n from '../i18n';
import { PAUSED_POLLS_TO_STOP, VoiceRecordingStore, useVoiceRecording } from './useVoiceRecording';
import { VOICE_CLONING } from '../config/constants';
import { FALLBACK_CLONE_DURATIONS } from '../models/VoiceClone';
import type { VoiceProfile } from '../models/VoiceProfile';
import { apiErrorFromResponse } from '../services/ApiError';
import { TTSProvider, VoiceProfileStatus } from '../types/enums';
import { showToast } from '../utils/toast';

const TICK = 100;
const durations = { minSeconds: 15, targetSeconds: 30, maxSeconds: 60 };

const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
};

/** Advance the recorder clock and run one status poll. */
const tick = async (durationMillis: number, metering: number) => {
  mockState.durationMillis = durationMillis;
  mockState.metering = metering;
  jest.advanceTimersByTime(TICK);
  await flush();
};

/** Start a take and speak from `speechAtMs`; returns the speech anchor. */
const startAndSpeak = async (store: VoiceRecordingStore, speechAtMs = 1000) => {
  mockState.durationMillis = 0;
  mockState.metering = -160;
  await store.startRecording();
  await tick(speechAtMs - TICK, -60); // ambient noise, still waiting
  await tick(speechAtMs, -20);
  await tick(speechAtMs + TICK, -18); // 2 loud samples in a row: speech
  return speechAtMs + TICK - VOICE_CLONING.VOICE_DETECT_CONSECUTIVE_SAMPLES * TICK;
};

describe('VoiceRecordingStore duration gating', () => {
  let store: VoiceRecordingStore;

  beforeEach(() => {
    mockRestore.mockClear();
    (setAudioModeAsync as jest.Mock).mockClear();
    mockState.constructed = [];
    mockState.nativeRecording = undefined;
    store = new VoiceRecordingStore();
    store.configure(durations, 'Annem');
  });

  afterEach(() => {
    store.reset();
  });

  it('records with the iOS LPCM WAV options in recording audio mode', async () => {
    await store.startRecording();
    expect(setAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsRecording: true }),
    );
    expect(mockState.constructed[0]).toEqual(
      expect.objectContaining({
        extension: '.wav',
        sampleRate: 44100,
        numberOfChannels: 1,
        outputFormat: 'lpcm',
        audioQuality: 127,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
        isMeteringEnabled: true,
      }),
    );
    expect(store.isRecording).toBe(true);
    expect(store.isAwaitingSpeech).toBe(true);
  });

  it('keeps the timer at 0 until speech, then counts speech-elapsed time', async () => {
    const anchor = await startAndSpeak(store, 3000);
    expect(store.isAwaitingSpeech).toBe(false);
    expect(store.speechDetected).toBe(true);

    await tick(anchor + 10_000, -20);
    expect(store.recordingDurationSeconds).toBeCloseTo(10, 5);
  });

  it('refuses to stop before minSeconds and accepts afterwards', async () => {
    const anchor = await startAndSpeak(store);
    await tick(anchor + 14_000, -20);
    expect(store.canStop).toBe(false);
    expect(store.requestStop()).toBe(false);
    expect(store.isRecording).toBe(true);

    await tick(anchor + 20_000, -20);
    expect(store.canStop).toBe(true);
    expect(store.requestStop()).toBe(true);
    await flush();

    expect(store.isRecording).toBe(false);
    expect(store.hasTake).toBe(true);
    expect(store.recordedFilePath).toBe('file:///tmp/recording-1.wav');
    expect(store.recordedDurationSeconds).toBeCloseTo(20, 5);
    expect(store.takeSpeechStartMs).toBe(anchor);
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });

  it('auto-stops at maxSeconds and keeps the take', async () => {
    const anchor = await startAndSpeak(store);
    await tick(anchor + 30_000, -20);
    expect(store.reachedTarget).toBe(true);
    expect(store.isRecording).toBe(true);

    await tick(anchor + 60_000, -20);
    await flush();
    expect(store.isRecording).toBe(false);
    expect(store.hasTake).toBe(true);
    expect(store.recordedDurationSeconds).toBeCloseTo(60, 5);
    expect(mockRestore).toHaveBeenCalled();
  });

  it('rejects a take interrupted under minSeconds with a Turkish message', async () => {
    const anchor = await startAndSpeak(store);
    await tick(anchor + 5_000, -20);
    await store.stopRecording('interrupted');

    expect(store.hasTake).toBe(false);
    expect(store.takeRejectionMessage).toContain('15 saniye');
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });

  it('stops an armed recorder that never hears speech', async () => {
    mockState.durationMillis = 0;
    await store.startRecording();
    await tick(VOICE_CLONING.SPEECH_WAIT_TIMEOUT_SECONDS * 1000, -60);
    await flush();

    expect(store.isRecording).toBe(false);
    expect(store.hasTake).toBe(false);
    expect(store.takeRejectionMessage).toContain('duyamadık');
    expect(mockRestore).toHaveBeenCalled();
  });

  it('cancel discards the take without a rejection message', async () => {
    const anchor = await startAndSpeak(store);
    await tick(anchor + 25_000, -20);
    await store.cancelRecording();

    expect(store.hasTake).toBe(false);
    expect(store.takeRejectionMessage).toBeNull();
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });

  it('classifies the live input level', async () => {
    await startAndSpeak(store);
    expect(store.inputLevel).toBe('good');
    for (let i = 0; i < VOICE_CLONING.LEVEL_WINDOW_SAMPLES; i++) {
      await tick(20_000 + i * TICK, -55);
    }
    expect(store.inputLevel).toBe('quiet');
  });
});

// ============================================================================
// Shared setup for the blocks below
// ============================================================================

const resetRecorderState = () => {
  mockState.durationMillis = 0;
  mockState.metering = -160;
  mockState.constructed = [];
  mockState.recorders = [];
  mockState.uri = '/tmp/recording-1.wav';
  mockState.prepareGate = null;
  mockState.onPrepare = null;
  mockState.prepareError = null;
  mockState.recordError = null;
  mockState.stopError = null;
  mockState.statusError = null;
  mockVoiceStore.current = null;
};

const lastRecorder = (): MockRecorder => mockState.recorders[mockState.recorders.length - 1];

/** Record an accepted take of `seconds` speech and stop it like the user would. */
const recordTake = async (store: VoiceRecordingStore, seconds = 32, speechAtMs = 2500) => {
  const anchor = await startAndSpeak(store, speechAtMs);
  await tick(anchor + seconds * 1000, -20);
  expect(store.requestStop()).toBe(true);
  await flush();
  expect(store.hasTake).toBe(true);
  return anchor;
};

const setupStore = () => {
  jest.clearAllTimers();
  resetRecorderState();
  mockRestore.mockClear();
  (setAudioModeAsync as jest.Mock).mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const store = new VoiceRecordingStore();
  store.configure(durations, 'Annem');
  return store;
};

const teardownStore = async (store: VoiceRecordingStore) => {
  store.reset();
  await flush();
  resetRecorderState();
};

// ============================================================================
// Failure paths and the audio session
// ============================================================================

describe('VoiceRecordingStore failure paths and audio session', () => {
  let store: VoiceRecordingStore;

  beforeEach(() => {
    store = setupStore();
  });

  afterEach(async () => {
    await teardownStore(store);
  });

  it('permission denied: stays idle and never switches the audio mode', async () => {
    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });

    await store.startRecording();

    expect(store.isPermissionDenied).toBe(true);
    expect(store.isRecording).toBe(false);
    expect(store.isStarting).toBe(false);
    expect(setAudioModeAsync).not.toHaveBeenCalled();
    expect(mockState.constructed).toHaveLength(0);
    // The session was never switched, so there is nothing to hand back.
    expect(mockRestore).not.toHaveBeenCalled();

    // Granting on the next attempt clears the flag.
    await store.startRecording();
    expect(store.isPermissionDenied).toBe(false);
    expect(store.isRecording).toBe(true);
  });

  it('a failing permission check counts as denied and toasts', async () => {
    (requestRecordingPermissionsAsync as jest.Mock).mockRejectedValueOnce(
      new Error('ExpoAudio native module missing'),
    );

    expect(await store.requestMicrophonePermission()).toBe(false);

    expect(store.isPermissionDenied).toBe(true);
    expect(showToast.error).toHaveBeenCalledWith('Mikrofon izni kontrol edilemedi');
  });

  it('the permission-check toast follows the UI language', async () => {
    await i18n.changeLanguage('en');
    (requestRecordingPermissionsAsync as jest.Mock).mockRejectedValueOnce(new Error('missing'));
    await store.requestMicrophonePermission();
    expect(showToast.error).toHaveBeenCalledWith('Could not check the microphone permission');
  });

  it('a first denial can still be asked again, a permanent one cannot', async () => {
    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
    });
    await store.startRecording();
    expect(store.isPermissionDenied).toBe(true);
    expect(store.canAskPermissionAgain).toBe(true);

    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
      canAskAgain: false,
    });
    await store.startRecording();
    expect(store.isPermissionDenied).toBe(true);
    expect(store.canAskPermissionAgain).toBe(false);

    // A fresh flow forgets the denial (the next tap asks the system again).
    store.reset();
    expect(store.isPermissionDenied).toBe(false);
    expect(store.canAskPermissionAgain).toBe(true);
  });

  it('refreshMicrophonePermission picks up a grant made in the system settings', async () => {
    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
      canAskAgain: false,
    });
    await store.startRecording();
    expect(store.isPermissionDenied).toBe(true);

    (getRecordingPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: true,
      canAskAgain: true,
    });
    await store.refreshMicrophonePermission();

    expect(store.isPermissionDenied).toBe(false);
    expect(store.canAskPermissionAgain).toBe(true);
    // Only read, never asked: no system dialog, no recording started.
    expect(requestRecordingPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(store.isRecording).toBe(false);
  });

  it('refreshMicrophonePermission keeps a denial that is still in place, and the last state on failure', async () => {
    (getRecordingPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
      canAskAgain: false,
    });
    await store.refreshMicrophonePermission();
    expect(store.isPermissionDenied).toBe(true);
    expect(store.canAskPermissionAgain).toBe(false);

    (getRecordingPermissionsAsync as jest.Mock).mockRejectedValueOnce(new Error('no module'));
    await store.refreshMicrophonePermission();
    expect(store.isPermissionDenied).toBe(true);
    expect(store.canAskPermissionAgain).toBe(false);
    expect(showToast.error).not.toHaveBeenCalled();
  });

  it('prepareToRecordAsync failing releases the recorder and restores playback mode', async () => {
    mockState.prepareError = new Error('AVAudioSession setActive failed');

    await store.startRecording();

    expect(store.isRecording).toBe(false);
    expect(store.isAwaitingSpeech).toBe(false);
    expect(store.isStarting).toBe(false);
    expect(store.recordingError).toBe('Kayıt başlatılamadı. Lütfen tekrar dene.');
    expect(showToast.error).toHaveBeenCalledWith('Kayıt başlatılamadı');
    expect(lastRecorder().release).toHaveBeenCalledTimes(1);
    expect(mockRestore).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('record() throwing takes the same cleanup path', async () => {
    mockState.recordError = new Error('recorder not prepared');

    await store.startRecording();

    expect(store.isRecording).toBe(false);
    expect(store.recordingError).toBe('Kayıt başlatılamadı. Lütfen tekrar dene.');
    expect(lastRecorder().release).toHaveBeenCalledTimes(1);
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });

  it('a failing audio mode switch does not restore a mode that was never applied', async () => {
    (setAudioModeAsync as jest.Mock).mockRejectedValueOnce(new Error('session busy'));

    await store.startRecording();

    expect(store.recordingError).toBe('Kayıt başlatılamadı. Lütfen tekrar dene.');
    expect(mockState.constructed).toHaveLength(0);
    expect(mockRestore).not.toHaveBeenCalled();
    expect(store.isStarting).toBe(false);
  });

  it('stop() throwing still releases the recorder, restores playback and allows a retry', async () => {
    const anchor = await startAndSpeak(store);
    await tick(anchor + 20_000, -20);
    const recorder = lastRecorder();
    mockState.stopError = new Error('stop failed');

    await store.stopRecording('user');

    expect(store.recordingError).toBe('Kayıt durdurulamadı. Lütfen yeniden kaydet.');
    expect(store.isRecording).toBe(false);
    expect(store.isAwaitingSpeech).toBe(false);
    expect(store.inputLevel).toBe('idle');
    expect(store.hasTake).toBe(false);
    expect(recorder.release).toHaveBeenCalledTimes(1);
    expect(mockRestore).toHaveBeenCalledTimes(1);

    mockState.stopError = null;
    await store.startRecording();
    expect(store.isRecording).toBe(true);
    expect(store.recordingError).toBeNull();
    expect(mockState.recorders).toHaveLength(2);
  });

  it('concurrent stop requests stop the native recorder only once', async () => {
    const anchor = await startAndSpeak(store);
    await tick(anchor + 20_000, -20);
    const recorder = lastRecorder();

    await Promise.all([store.stopRecording('user'), store.stopRecording('interrupted')]);

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(recorder.release).toHaveBeenCalledTimes(1);
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });

  it('ignores a second start while the first is still starting or recording', async () => {
    const first = store.startRecording();
    const second = store.startRecording();
    await Promise.all([first, second]);
    expect(mockState.constructed).toHaveLength(1);

    await store.startRecording();
    expect(mockState.constructed).toHaveLength(1);
  });

  it('requestStop is refused while idle and while still waiting for speech', async () => {
    expect(store.requestStop()).toBe(false);

    await store.startRecording();
    mockState.durationMillis = 30_000;
    expect(store.isAwaitingSpeech).toBe(true);
    expect(store.canStop).toBe(false);
    expect(store.requestStop()).toBe(false);
    expect(store.isRecording).toBe(true);
  });

  it('cancel after a stopped take only discards it (no second audio mode restore)', async () => {
    await recordTake(store);
    expect(mockRestore).toHaveBeenCalledTimes(1);

    await store.cancelRecording();

    expect(store.hasTake).toBe(false);
    expect(store.takeSpeechStartMs).toBeNull();
    expect(store.recordedDurationSeconds).toBe(0);
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });

  it('reset() while recording releases the recorder, restores playback and forgets the flow', async () => {
    const anchor = await startAndSpeak(store);
    await tick(anchor + 20_000, -20);
    const recorder = lastRecorder();

    store.reset();
    await flush();

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(recorder.release).toHaveBeenCalledTimes(1);
    expect(mockRestore).toHaveBeenCalledTimes(1);
    expect(store.isRecording).toBe(false);
    expect(store.hasTake).toBe(false);
    expect(store.takeRejectionMessage).toBeNull();
    expect(store.durations).toEqual(FALLBACK_CLONE_DURATIONS);
    expect(store.profileName).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a take the system paused (iOS call, Siri) stops as interrupted and keeps a long-enough take', async () => {
    mockState.nativeRecording = undefined;
    const anchor = await startAndSpeak(store);
    await tick(anchor + 20_000, -20);
    mockState.nativeRecording = false;
    for (let i = 1; i < PAUSED_POLLS_TO_STOP; i++) {
      await tick(anchor + 20_000, -160);
      expect(store.isRecording).toBe(true);
    }
    await tick(anchor + 20_000, -160);
    await flush();

    expect(store.isRecording).toBe(false);
    expect(store.hasTake).toBe(true);
    expect(store.recordedDurationSeconds).toBeCloseTo(20, 5);
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });

  it('a single poll without a running recorder does not stop the take', async () => {
    mockState.nativeRecording = undefined;
    const anchor = await startAndSpeak(store);
    mockState.nativeRecording = false;
    await tick(anchor + 1_000, -20);
    mockState.nativeRecording = true;
    for (let i = 0; i < PAUSED_POLLS_TO_STOP; i++) await tick(anchor + 1_100 + i * TICK, -20);
    expect(store.isRecording).toBe(true);
  });

  it('cleanup() while recording keeps a long-enough take', async () => {
    const anchor = await startAndSpeak(store);
    await tick(anchor + 20_000, -20);

    store.cleanup();
    await flush();

    expect(store.isRecording).toBe(false);
    expect(store.hasTake).toBe(true);
    expect(store.recordedDurationSeconds).toBeCloseTo(20, 5);
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });

  it('cleanup() while idle does not touch the audio session', async () => {
    store.cleanup();
    await flush();
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('a recorder status error stops the poll instead of crashing', async () => {
    await store.startRecording();
    expect(jest.getTimerCount()).toBe(1);
    mockState.statusError = new Error('SharedObject already released');

    jest.advanceTimersByTime(TICK);
    await flush();

    expect(jest.getTimerCount()).toBe(0);
    expect(console.warn).toHaveBeenCalled();

    // The take can still be cancelled cleanly.
    await store.cancelRecording();
    expect(store.isRecording).toBe(false);
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });

  it('rejects the take when the recorder reports no file', async () => {
    mockState.uri = null;
    const anchor = await startAndSpeak(store);
    await tick(anchor + 20_000, -20);

    await store.stopRecording('user');

    expect(store.hasTake).toBe(false);
    expect(store.takeRejectionMessage).toBe('Kayıt kaydedilemedi. Lütfen yeniden kaydet.');
    expect(store.takeSpeechStartMs).toBeNull();
  });

  it('keeps a recorder uri that already has the file:// scheme', async () => {
    mockState.uri = 'file:///var/mobile/Containers/Data/recording-2.wav';
    await recordTake(store);
    expect(store.recordedFilePath).toBe('file:///var/mobile/Containers/Data/recording-2.wav');
  });

  // Regression (fixed 2026-09-28, was BUG): src/hooks/useVoiceRecording.ts:278-284 + 615-622 - cleanup() (and
  // reset()) only act on `isRecording`; they cannot cancel a start that is
  // still in flight (permission granted, audio mode switched, recorder being
  // prepared). If the recording screen unmounts in that window, cleanup()
  // restores playback mode, then the start finishes anyway: record() runs,
  // isRecording becomes true and the timer starts with the screen gone. The
  // microphone stays live until the 20 s no-speech timeout, and that stop
  // does not restore the audio mode again (recordingModeActive is false).
  it('cleanup() during an in-flight start cancels the start', async () => {
    let openGate!: () => void;
    mockState.prepareGate = new Promise<void>(resolve => {
      openGate = resolve;
    });

    const start = store.startRecording();
    await flush();
    expect(setAudioModeAsync).toHaveBeenCalled();
    expect(store.isStarting).toBe(true);

    store.cleanup(); // screen unmounts while the recorder is being prepared
    openGate();
    await start;

    expect(lastRecorder().record).not.toHaveBeenCalled();
    expect(store.isRecording).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });
});

// ============================================================================
// Durations from the clone config + speech anchor
// ============================================================================

// ============================================================================
// Restart during a take ("Baştan başla")
// ============================================================================

describe('VoiceRecordingStore.restartRecording', () => {
  let store: VoiceRecordingStore;
  const settle = async () => {
    for (let i = 0; i < 30; i++) {
      await Promise.resolve();
    }
  };

  beforeEach(() => {
    store = setupStore();
  });

  afterEach(async () => {
    await teardownStore(store);
  });

  it('keeps isStarting true at every await until the new take records', async () => {
    const anchor = await startAndSpeak(store);
    await tick(anchor + 8_000, -20);
    const first = lastRecorder();
    const seen: Array<{ step: string; isStarting: boolean }> = [];
    first.stop.mockImplementation(() => {
      seen.push({ step: 'stop', isStarting: store.isStarting });
      return Promise.resolve();
    });
    (requestRecordingPermissionsAsync as jest.Mock).mockImplementationOnce(() => {
      seen.push({ step: 'permission', isStarting: store.isStarting });
      return Promise.resolve({ granted: true });
    });
    mockState.onPrepare = () => seen.push({ step: 'prepare', isStarting: store.isStarting });
    // Never idle in between: recording, or starting the next take.
    const idleStates: string[] = [];
    const dispose = autorun(() => {
      if (!store.isRecording && !store.isStarting) idleStates.push('idle');
    });

    await store.restartRecording();
    dispose();

    expect(seen).toEqual([
      { step: 'stop', isStarting: true },
      { step: 'permission', isStarting: true },
      { step: 'prepare', isStarting: true },
    ]);
    expect(idleStates).toEqual([]);
    expect(store.isRecording).toBe(true);
    expect(store.isStarting).toBe(false);
    expect(store.isAwaitingSpeech).toBe(true);
    expect(store.recordingDurationSeconds).toBe(0);
    expect(store.hasTake).toBe(false);
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(mockState.recorders).toHaveLength(2);
  });

  it('keeps the recording mode between the two takes (no switch back and forth)', async () => {
    await startAndSpeak(store);
    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);

    await store.restartRecording();

    // Playback mode was never restored, and recording mode not applied twice.
    expect(mockRestore).not.toHaveBeenCalled();
    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(setAudioModeAsync).not.toHaveBeenCalledWith(
      expect.objectContaining({ allowsRecording: false }),
    );

    // The new take ends like any other: playback mode comes back once.
    await store.cancelRecording();
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });

  it('drops the replaced take without a rejection message and counts the new one from 0', async () => {
    const anchor = await startAndSpeak(store);
    await tick(anchor + 20_000, -20);
    expect(store.recordingDurationSeconds).toBeCloseTo(20, 5);

    await store.restartRecording();

    expect(store.takeRejectionMessage).toBeNull();
    expect(store.recordedFilePath).toBe('');
    // The new recorder starts its own clock: speech again after 1 s.
    const nextAnchor = await (async () => {
      await tick(900, -60);
      await tick(1000, -20);
      await tick(1100, -18);
      return 1100 - VOICE_CLONING.VOICE_DETECT_CONSECUTIVE_SAMPLES * TICK;
    })();
    await tick(nextAnchor + 3_000, -20);
    expect(store.recordingDurationSeconds).toBeCloseTo(3, 5);
  });

  it('ignores a second tap while the restart is still starting', async () => {
    await startAndSpeak(store);
    let release!: () => void;
    mockState.prepareGate = new Promise<void>(resolve => {
      release = resolve;
    });

    const restart = store.restartRecording();
    await flush();
    await store.restartRecording();
    await store.startRecording();
    release();
    await restart;

    // One replaced recorder plus one new one.
    expect(mockState.recorders).toHaveLength(2);
    expect(store.isRecording).toBe(true);
  });

  it('a restart while idle just starts a take', async () => {
    await store.restartRecording();
    expect(store.isRecording).toBe(true);
    expect(store.isStarting).toBe(false);
    expect(mockState.recorders).toHaveLength(1);
  });

  it('cleanup during the restart releases everything and hands playback back', async () => {
    await startAndSpeak(store);
    let release!: () => void;
    mockState.prepareGate = new Promise<void>(resolve => {
      release = resolve;
    });

    const restart = store.restartRecording();
    await settle();
    // The new recorder is preparing when the screen goes away.
    expect(mockState.recorders).toHaveLength(2);
    store.cleanup();
    release();
    await restart;
    await flush();

    expect(store.isRecording).toBe(false);
    expect(store.isStarting).toBe(false);
    expect(lastRecorder().record).not.toHaveBeenCalled();
    expect(lastRecorder().release).toHaveBeenCalled();
    expect(mockRestore).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a permission lost before the new take restores playback mode', async () => {
    await startAndSpeak(store);
    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
      canAskAgain: false,
    });

    await store.restartRecording();

    expect(store.isRecording).toBe(false);
    expect(store.isStarting).toBe(false);
    expect(store.isPermissionDenied).toBe(true);
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });
});

describe('VoiceRecordingStore configured durations and speech anchor', () => {
  let store: VoiceRecordingStore;

  beforeEach(() => {
    store = setupStore();
  });

  afterEach(async () => {
    await teardownStore(store);
  });

  it('respects custom min / target / max durations', async () => {
    store.configure({ minSeconds: 5, targetSeconds: 8, maxSeconds: 10 }, 'Babam');
    const anchor = await startAndSpeak(store);

    await tick(anchor + 4_000, -20);
    expect(store.canStop).toBe(false);

    await tick(anchor + 5_000, -20);
    expect(store.canStop).toBe(true);
    expect(store.reachedTarget).toBe(false);

    await tick(anchor + 8_000, -20);
    expect(store.reachedTarget).toBe(true);
    expect(store.isRecording).toBe(true);

    await tick(anchor + 10_000, -20);
    await flush();
    expect(store.isRecording).toBe(false);
    expect(store.hasTake).toBe(true);
    expect(store.recordedDurationSeconds).toBeCloseTo(10, 5);
  });

  it('rejects a take under a custom minimum with that minimum in the message', async () => {
    store.configure({ minSeconds: 20, targetSeconds: 30, maxSeconds: 45 }, 'Babam');
    const anchor = await startAndSpeak(store);
    await tick(anchor + 17_000, -20);

    await store.stopRecording('interrupted');

    expect(store.hasTake).toBe(false);
    expect(store.takeRejectionMessage).toContain('20 saniye');
  });

  it('a single loud click does not arm the timer', async () => {
    mockState.durationMillis = 0;
    await store.startRecording();

    await tick(1000, -20);
    await tick(1100, -60); // click was followed by silence: counter resets
    await tick(1200, -20);
    expect(store.isAwaitingSpeech).toBe(true);
    expect(store.recordingDurationSeconds).toBe(0);

    await tick(1300, -20);
    expect(store.isAwaitingSpeech).toBe(false);
    await tick(21_100, -20);
    // Anchor = 1300 - 2 samples * 100 ms = 1100 ms.
    expect(store.recordingDurationSeconds).toBeCloseTo(20, 5);
  });

  it('clamps the speech anchor to 0 when the user speaks immediately', async () => {
    mockState.durationMillis = 0;
    await store.startRecording();
    await tick(50, -20);
    await tick(100, -20);
    expect(store.speechDetected).toBe(true);

    await tick(16_000, -20);
    await store.stopRecording('user');

    expect(store.takeSpeechStartMs).toBe(0);
    expect(store.recordedDurationSeconds).toBeCloseTo(16, 5);
  });
});

// ============================================================================
// Android recorder options
// ============================================================================

describe('VoiceRecordingStore on Android', () => {
  let store: VoiceRecordingStore;

  beforeEach(() => {
    store = setupStore();
  });

  afterEach(async () => {
    await teardownStore(store);
  });

  it('records AAC in MPEG-4 with the voice_recognition source', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      await store.startRecording();

      expect(mockState.constructed[0]).toEqual({
        extension: '.m4a',
        sampleRate: 48000,
        numberOfChannels: 1,
        bitRate: 256000,
        isMeteringEnabled: true,
        outputFormat: 'mpeg4',
        audioEncoder: 'aac',
        audioSource: 'voice_recognition',
      });
    } finally {
      os.restore();
    }
  });

  it('uses the Android peak thresholds for the input level hint', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      await startAndSpeak(store);
      // -32 dBFS peaks are fine on iOS (average power) but quiet on Android.
      for (let i = 0; i < VOICE_CLONING.LEVEL_WINDOW_SAMPLES; i++) {
        await tick(5_000 + i * TICK, -32);
      }
      expect(store.inputLevel).toBe('quiet');
    } finally {
      os.restore();
    }
  });

  it('the same levels read as good on iOS', async () => {
    await startAndSpeak(store);
    for (let i = 0; i < VOICE_CLONING.LEVEL_WINDOW_SAMPLES; i++) {
      await tick(5_000 + i * TICK, -32);
    }
    expect(store.inputLevel).toBe('good');
  });

  it('flags clipping as loud', async () => {
    await startAndSpeak(store);
    await tick(3_000, -2);
    await tick(3_100, -1);
    expect(store.inputLevel).toBe('loud');
  });
});

// ============================================================================
// Clone submit (create PENDING profile + upload)
// ============================================================================

describe('VoiceRecordingStore.submitClone', () => {
  const CONSENT_VERSION = '2026-09-v1';
  const pendingProfile: VoiceProfile = {
    id: 'vp-clone-1',
    name: 'Annem',
    status: VoiceProfileStatus.PENDING,
    provider: TTSProvider.CARTESIA,
    voiceId: 'custom-cloning-pending',
    language: 'tr-TR',
    contentLanguage: 'tr',
    sampleAudioUrl: null,
    errorMessage: null,
    voiceModelId: null,
    kind: 'CLONE',
    consentAt: null,
    createdAt: new Date('2026-09-28T19:00:00.000Z'),
    updatedAt: new Date('2026-09-28T19:00:00.000Z'),
  };

  let store: VoiceRecordingStore;

  beforeEach(() => {
    store = setupStore();
    mockCreateVoiceProfile.mockReset().mockResolvedValue(pendingProfile);
    mockUploadCloneSample.mockReset().mockResolvedValue(undefined);
    mockDeleteVoiceProfile.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await teardownStore(store);
  });

  it('uploads the take with the accepted consent version and the detected speech anchor', async () => {
    const progressSeen: number[] = [];
    mockUploadCloneSample.mockImplementation(
      (_id: string, _sample: unknown, onProgress: (progress: number) => void) => {
        progressSeen.push(store.processingProgress);
        onProgress(50);
        progressSeen.push(store.processingProgress);
        return Promise.resolve();
      },
    );
    const anchor = await recordTake(store);
    expect(store.takeSpeechStartMs).toBe(anchor);

    const result = await store.submitClone(CONSENT_VERSION, 'free');

    expect(result).toEqual({ ok: true, profileId: 'vp-clone-1' });
    expect(mockCreateVoiceProfile).toHaveBeenCalledWith({
      name: 'Annem',
      provider: TTSProvider.CARTESIA,
      voiceId: 'custom-cloning-pending',
      language: 'tr-TR',
    });
    expect(mockUploadCloneSample).toHaveBeenCalledWith(
      'vp-clone-1',
      {
        fileUri: 'file:///tmp/recording-1.wav',
        consentVersion: CONSENT_VERSION,
        speechStartMs: anchor,
      },
      expect.any(Function),
    );
    // 10 after create, then 10 + 90% of the upload progress.
    expect(progressSeen).toEqual([10, 55]);
    expect(store.processingProgress).toBe(100);
    expect(store.isProcessing).toBe(false);
    expect(store.createdProfile?.id).toBe('vp-clone-1');
    expect(store.lastError).toBeNull();
  });

  it('a successful upload asks the voice store for a fresh list', async () => {
    mockVoiceStore.current = makeMockVoiceStore();
    await recordTake(store);

    const result = await store.submitClone(CONSENT_VERSION, 'free');

    expect(result).toEqual({ ok: true, profileId: 'vp-clone-1' });
    // A list load asked before the upload would not have the new voice yet.
    expect(mockVoiceStore.current.loadVoiceProfiles).toHaveBeenCalledWith({ fresh: true });
    expect(mockVoiceStore.current.markPendingDiscard).not.toHaveBeenCalled();
    expect(mockDeleteVoiceProfile).not.toHaveBeenCalled();
  });

  it('creates the voice in the language the take was read in, with that consent version', async () => {
    await recordTake(store);

    const result = await store.submitClone('en-2026-10', 'free', 'en-US');

    expect(result).toEqual({ ok: true, profileId: 'vp-clone-1' });
    expect(mockCreateVoiceProfile).toHaveBeenCalledWith(
      expect.objectContaining({ provider: TTSProvider.CARTESIA, language: 'en-US' }),
    );
    expect(mockUploadCloneSample).toHaveBeenCalledWith(
      'vp-clone-1',
      expect.objectContaining({ consentVersion: 'en-2026-10' }),
      expect.any(Function),
    );
  });

  it('falls back to Turkish when the flow names an empty language', async () => {
    await recordTake(store);
    await store.submitClone(CONSENT_VERSION, 'free', '');
    expect(mockCreateVoiceProfile).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'tr-TR' }),
    );
  });

  it('names the profile "Benim Sesim" when the flow has no name', async () => {
    store.configure(durations, '');
    await recordTake(store);

    await store.submitClone(CONSENT_VERSION, 'free');

    expect(mockCreateVoiceProfile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Benim Sesim' }),
    );
  });

  it('the default name follows the UI language', async () => {
    await i18n.changeLanguage('en');
    store.configure(durations, '');
    await recordTake(store);

    await store.submitClone(CONSENT_VERSION, 'free');

    expect(mockCreateVoiceProfile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My voice' }),
    );
  });

  it('refuses to submit without a take', async () => {
    const result = await store.submitClone(CONSENT_VERSION, 'free');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.title).toBe('Kayıt bulunamadı');
    }
    expect(store.lastError?.title).toBe('Kayıt bulunamadı');
    expect(mockCreateVoiceProfile).not.toHaveBeenCalled();
  });

  it('refuses a second submit while the upload is running', async () => {
    let finishUpload!: () => void;
    mockUploadCloneSample.mockReturnValue(
      new Promise<void>(resolve => {
        finishUpload = resolve;
      }),
    );
    await recordTake(store);

    const first = store.submitClone(CONSENT_VERSION, 'free');
    await flush();
    const second = await store.submitClone(CONSENT_VERSION, 'free');

    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.title).toBe('Yükleniyor');
    }
    finishUpload();
    expect((await first).ok).toBe(true);
    expect(mockCreateVoiceProfile).toHaveBeenCalledTimes(1);
  });

  it('a failed upload deletes the PENDING profile and refreshes the voice store', async () => {
    mockVoiceStore.current = makeMockVoiceStore();
    mockUploadCloneSample.mockRejectedValue(apiErrorFromResponse(413, {}));
    await recordTake(store);

    const result = await store.submitClone(CONSENT_VERSION, 'free');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.action).toBe('retry');
      expect(result.profileId).toBeUndefined();
      expect(store.lastError).toEqual(result.error);
    }
    expect(mockDeleteVoiceProfile).toHaveBeenCalledWith('vp-clone-1');
    expect(store.createdProfile).toBeNull();
    expect(store.isProcessing).toBe(false);
    // Fresh: a list load already running may still name the deleted profile.
    expect(mockVoiceStore.current.loadVoiceProfiles).toHaveBeenCalledTimes(1);
    expect(mockVoiceStore.current.loadVoiceProfiles).toHaveBeenCalledWith({ fresh: true });
    expect(mockVoiceStore.current.loadVoiceSlots).toHaveBeenCalledTimes(1);
    // The take survives so the user can retry the upload.
    expect(store.hasTake).toBe(true);
  });

  it('VOICE_ALREADY_UPLOADED keeps the profile and hands it back for tracking', async () => {
    mockUploadCloneSample.mockRejectedValue(
      apiErrorFromResponse(409, {
        code: 'VOICE_ALREADY_UPLOADED',
        message: 'Bu ses için kayıt zaten yüklendi.',
      }),
    );
    await recordTake(store);

    const result = await store.submitClone(CONSENT_VERSION, 'premium');

    expect(result).toEqual({
      ok: false,
      profileId: 'vp-clone-1',
      error: {
        code: 'VOICE_ALREADY_UPLOADED',
        title: 'Kayıt zaten gönderildi',
        message:
          'Bu ses için kayıt daha önce gönderildi. Sesin hazırlanıyor, hazır olunca haber vereceğiz.',
        action: 'track',
      },
    });
    expect(mockDeleteVoiceProfile).not.toHaveBeenCalled();
    expect(store.createdProfile?.id).toBe('vp-clone-1');
  });

  it('CONSENT_REQUIRED asks for re-consent and discards the PENDING profile', async () => {
    mockUploadCloneSample.mockRejectedValue(
      apiErrorFromResponse(403, {
        code: 'CONSENT_REQUIRED',
        message: 'Güncel açık rıza metnini onaylaman gerekiyor.',
      }),
    );
    await recordTake(store);

    const result = await store.submitClone('2026-01-v0', 'free');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.action).toBe('reconsent');
      // App copy, never the backend sentence of a known code.
      expect(result.error.message).toBe(
        'Sesini kaydedebilmemiz için açık rıza metnini yeniden onaylaman gerekiyor.',
      );
    }
    expect(mockDeleteVoiceProfile).toHaveBeenCalledWith('vp-clone-1');
  });

  it('a slot refusal on create never uploads; Free and Mini get the plans, Premium does not', async () => {
    mockCreateVoiceProfile.mockRejectedValue(
      apiErrorFromResponse(403, {
        code: 'CLONE_SLOT_LIMIT',
        limit: 1,
        message: 'En fazla 1 kendi sesini ekleyebilirsin.',
      }),
    );
    await recordTake(store);

    const free = await store.submitClone(CONSENT_VERSION, 'free');
    const mini = await store.submitClone(CONSENT_VERSION, 'mini');
    const premium = await store.submitClone(CONSENT_VERSION, 'premium');

    expect(free.ok || mini.ok || premium.ok).toBe(false);
    if (!free.ok && !mini.ok && !premium.ok) {
      expect(free.error.action).toBe('paywall');
      expect(mini.error.action).toBe('paywall');
      expect(premium.error.action).toBe('none');
      // App copy: Free is offered Premium, never told a delete would help.
      expect(free.error.message).toMatch(/^Kendi ses hakkının tamamını kullandın\./);
      expect(free.error.message).toContain('Premium');
      expect(free.error.message).not.toContain('silebilir');
      expect(free.error.message).not.toContain('En fazla 1 kendi sesini');
    }
    expect(mockUploadCloneSample).not.toHaveBeenCalled();
    expect(mockDeleteVoiceProfile).not.toHaveBeenCalled();
  });

  it('an upload refused with CLONE_CREATION_LIMIT offers the plans, never a retry', async () => {
    mockUploadCloneSample.mockRejectedValue(
      apiErrorFromResponse(403, {
        statusCode: 403,
        code: 'CLONE_CREATION_LIMIT',
        plan: 'FREE',
        limit: 1,
        used: 1,
        period: 'lifetime',
        renewsAt: null,
        message: 'Kendi ses hakkın doldu.',
      }),
    );
    await recordTake(store);

    const result = await store.submitClone(CONSENT_VERSION, 'free');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CLONE_CREATION_LIMIT');
      expect(result.error.action).toBe('paywall');
      expect(result.error.title).toBe('Kendi ses hakkını kullandın');
    }
    // The placeholder is deleted: it would hold the clone slot.
    expect(mockDeleteVoiceProfile).toHaveBeenCalledWith('vp-clone-1');
  });

  it('still reports the upload error when discarding the PENDING profile fails', async () => {
    mockVoiceStore.current = makeMockVoiceStore();
    mockUploadCloneSample.mockRejectedValue(apiErrorFromResponse(undefined, null));
    mockDeleteVoiceProfile.mockRejectedValue(apiErrorFromResponse(undefined, null));
    await recordTake(store);

    const result = await store.submitClone(CONSENT_VERSION, 'free');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.action).toBe('retry');
    expect(console.warn).toHaveBeenCalled();
    // Kept for the retry, and handed to the voice store to clean up later.
    expect(store.createdProfile?.id).toBe('vp-clone-1');
    expect(mockVoiceStore.current.markPendingDiscard).toHaveBeenCalledWith('vp-clone-1');
    // Offline: no list reload that could only fail and toast again.
    expect(mockVoiceStore.current.loadVoiceProfiles).not.toHaveBeenCalled();
    expect(store.isProcessing).toBe(false);

    store.clearLastError();
    expect(store.lastError).toBeNull();
  });

  describe('retrying an orphaned PENDING clone', () => {
    const offline = () => apiErrorFromResponse(undefined, null);

    const failOnce = async () => {
      mockUploadCloneSample.mockRejectedValueOnce(offline());
      mockDeleteVoiceProfile.mockRejectedValueOnce(offline());
      await recordTake(store);
      const first = await store.submitClone(CONSENT_VERSION, 'free');
      expect(first.ok).toBe(false);
    };

    it('uploads to the same profile and creates no second one', async () => {
      mockVoiceStore.current = makeMockVoiceStore();
      await failOnce();

      const second = await store.submitClone(CONSENT_VERSION, 'free');

      expect(second).toEqual({ ok: true, profileId: 'vp-clone-1' });
      expect(mockCreateVoiceProfile).toHaveBeenCalledTimes(1);
      expect(mockUploadCloneSample).toHaveBeenCalledTimes(2);
      expect(mockUploadCloneSample.mock.calls.map(call => call[0])).toEqual([
        'vp-clone-1',
        'vp-clone-1',
      ]);
      // Claimed back from the voice store's clean-up before the upload.
      expect(mockVoiceStore.current.unmarkPendingDiscard).toHaveBeenCalledWith('vp-clone-1');
      expect(store.processingProgress).toBe(100);
    });

    it('a placeholder that is gone (404) is replaced once by a new one', async () => {
      await failOnce();
      mockUploadCloneSample.mockRejectedValueOnce(apiErrorFromResponse(404, {}));
      mockCreateVoiceProfile.mockResolvedValueOnce({ ...pendingProfile, id: 'vp-clone-2' });

      const second = await store.submitClone(CONSENT_VERSION, 'free');

      expect(second).toEqual({ ok: true, profileId: 'vp-clone-2' });
      expect(mockCreateVoiceProfile).toHaveBeenCalledTimes(2);
      expect(mockUploadCloneSample.mock.calls.map(call => call[0])).toEqual([
        'vp-clone-1',
        'vp-clone-1',
        'vp-clone-2',
      ]);
      expect(store.createdProfile?.id).toBe('vp-clone-2');
    });

    it('another failure on the reused profile discards it like a first upload', async () => {
      await failOnce();
      mockUploadCloneSample.mockRejectedValueOnce(apiErrorFromResponse(413, {}));

      const second = await store.submitClone(CONSENT_VERSION, 'free');

      expect(second.ok).toBe(false);
      expect(mockDeleteVoiceProfile).toHaveBeenLastCalledWith('vp-clone-1');
      expect(store.createdProfile).toBeNull();
      expect(mockCreateVoiceProfile).toHaveBeenCalledTimes(1);
    });

    it('a profile that already trains is not reused', async () => {
      await failOnce();
      store.createdProfile = { ...pendingProfile, status: VoiceProfileStatus.PROCESSING };
      mockCreateVoiceProfile.mockResolvedValueOnce({ ...pendingProfile, id: 'vp-clone-3' });

      const second = await store.submitClone(CONSENT_VERSION, 'free');

      expect(second).toEqual({ ok: true, profileId: 'vp-clone-3' });
      expect(mockCreateVoiceProfile).toHaveBeenCalledTimes(2);
    });

    it('a fresh flow (reset) never reuses the previous flow\'s profile', async () => {
      await failOnce();
      store.reset();
      store.configure(durations, 'Annem');
      mockCreateVoiceProfile.mockResolvedValueOnce({ ...pendingProfile, id: 'vp-clone-4' });
      await recordTake(store);

      const next = await store.submitClone(CONSENT_VERSION, 'free');

      expect(next).toEqual({ ok: true, profileId: 'vp-clone-4' });
    });
  });
});

describe('useVoiceRecording singleton', () => {
  it('returns the same store across renders', () => {
    const first = renderHook(() => useVoiceRecording());
    const second = renderHook(() => useVoiceRecording());
    expect(first.result.current).toBeInstanceOf(VoiceRecordingStore);
    expect(second.result.current).toBe(first.result.current);
  });
});
