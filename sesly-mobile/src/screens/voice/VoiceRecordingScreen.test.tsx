/**
 * VoiceRecordingScreen (playful design): read-aloud step of
 * the clone flow.
 *
 * The VoiceRecordingStore is replaced by a plain object so each test pins
 * the exact recording state (isRecording / canStop / hasTake ...) it renders.
 * Tests that follow a change make the fields they move observable
 * (`observe`), so the observer screen re-renders like with the real store.
 */

import React from 'react';
import {
  AccessibilityInfo,
  AppState,
  BackHandler,
  Dimensions,
  Linking,
  Modal,
} from 'react-native';
import { act, fireEvent, screen, userEvent, waitFor, within } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import { observable, runInAction } from 'mobx';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import {
  CloneConfig,
  CloneDurations,
  InputLevel,
  parseCloneConfigFromJSON,
} from '../../models/VoiceClone';
import type { DialogOptions } from '../../hooks/useDialog';
import { DISMISS_FALLBACK_MS } from '../../components/design/usePresence';
import { showToast } from '../../utils/toast';
import { HINT_FLASH_MS, KEEP_AWAKE_TAG, VoiceRecordingScreen } from './VoiceRecordingScreen';

// The first render in a cold Jest cache lazily transforms React Native
// internals (plus coverage instrumentation); on a loaded machine that took
// well over the 5 s default (and once over 30 s) in parallel runs.
// Warm runs stay well under 1 s per test.
jest.setTimeout(60000);

// --- Store mocks ---

interface RecordingStoreMock {
  isRecording: boolean;
  isStarting: boolean;
  isAwaitingSpeech: boolean;
  isProcessing: boolean;
  isPermissionDenied: boolean;
  canAskPermissionAgain: boolean;
  hasTake: boolean;
  canStop: boolean;
  reachedTarget: boolean;
  recordedFilePath: string;
  recordedDurationSeconds: number;
  recordingDurationSeconds: number;
  currentLevelDbfs: number;
  inputLevel: InputLevel;
  takeRejectionMessage: string | null;
  processingProgress: number;
  durations: CloneDurations;
  reset: jest.Mock;
  cleanup: jest.Mock;
  configure: jest.Mock;
  requestStop: jest.Mock;
  startRecording: jest.Mock;
  restartRecording: jest.Mock;
  stopRecording: jest.Mock;
  cancelRecording: jest.Mock;
  discardTake: jest.Mock;
  submitClone: jest.Mock;
  refreshMicrophonePermission: jest.Mock;
  requestMicrophonePermission: jest.Mock;
}

interface VoiceStoreMock {
  cloneConfig: CloneConfig | null;
  cloneConfigFor: jest.Mock;
  isLoadingCloneConfig: boolean;
  cloneConfigError: string | null;
  loadCloneConfig: jest.Mock;
  refreshCloneConfigForReconsent: jest.Mock;
  loadVoiceProfiles: jest.Mock;
  loadVoiceSlots: jest.Mock;
  trackVoiceProfile: jest.Mock;
  voiceProfiles: unknown[];
}

let mockRecordingStore: RecordingStoreMock;
let mockVoiceStore: VoiceStoreMock;
const mockShowDialog = jest.fn();
/** Use the real dialog (and its Android back handling) instead of the spy. */
let mockRealDialog = false;
const mockAppPlayer = { isPlaying: false, pause: jest.fn() };
/** Counts the renders of the reading card (it must not follow the meter). */
const mockScriptRenders = jest.fn();

jest.mock('../../hooks/useVoiceRecording', () => ({
  useVoiceRecording: () => mockRecordingStore,
}));
jest.mock('../../hooks/useVoiceProfile', () => ({
  useVoiceProfile: () => mockVoiceStore,
}));
jest.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => ({ planId: 'free' }),
}));
jest.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => mockAppPlayer,
}));
jest.mock('../../hooks/useDialog', () => {
  const actual = jest.requireActual('../../hooks/useDialog');
  return {
    ...actual,
    useDialog: () =>
      mockRealDialog ? actual.useDialog() : { showDialog: mockShowDialog, hideDialog: jest.fn() },
  };
});
jest.mock('../../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));
jest.mock('../../components/design', () => {
  const actual = jest.requireActual('../../components/design');
  const ReactActual = jest.requireActual('react');
  return {
    ...actual,
    Card: (props: { testID?: string }) => {
      if (props.testID === 'recording-script') mockScriptRenders();
      return ReactActual.createElement(actual.Card, props);
    },
  };
});

// The global expo-audio mock is the obsolete expo-av shape; the screen uses
// the hook API for listen-back.
const mockListenPlayer = {
  play: jest.fn(),
  pause: jest.fn(),
  seekTo: jest.fn(() => Promise.resolve()),
};
let mockListenStatus = { playing: false, didJustFinish: false, duration: 0, currentTime: 0 };
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => mockListenPlayer,
  useAudioPlayerStatus: () => mockListenStatus,
}));

const mockNav = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  replace: jest.fn(),
  popTo: jest.fn(),
};
let mockRouteParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockRouteParams }),
}));

// --- Fixtures ---

// Non-fallback durations (fallback is 15 / 30 / 60) so the copy provably
// comes from the served config.
const DURATIONS: CloneDurations = { minSeconds: 20, targetSeconds: 45, maxSeconds: 90 };

const CONFIG = parseCloneConfigFromJSON({
  enabled: true,
  ...DURATIONS,
  scriptTitle: 'Kirmizi Baslikli Kiz',
  script: 'Evvel zaman icinde, kalbur saman icinde.',
  consentVersion: 'kvkk-2026-09',
  consentText: 'Onay metni.',
});

function makeRecordingStore(overrides: Partial<RecordingStoreMock> = {}): RecordingStoreMock {
  return {
    isRecording: false,
    isStarting: false,
    isAwaitingSpeech: false,
    isProcessing: false,
    isPermissionDenied: false,
    canAskPermissionAgain: true,
    hasTake: false,
    canStop: false,
    reachedTarget: false,
    recordedFilePath: '',
    recordedDurationSeconds: 0,
    recordingDurationSeconds: 0,
    currentLevelDbfs: -160,
    inputLevel: 'idle',
    takeRejectionMessage: null,
    processingProgress: 0,
    durations: DURATIONS,
    reset: jest.fn(),
    cleanup: jest.fn(),
    configure: jest.fn(),
    requestStop: jest.fn(() => false),
    startRecording: jest.fn(() => Promise.resolve()),
    restartRecording: jest.fn(() => Promise.resolve()),
    stopRecording: jest.fn(() => Promise.resolve()),
    cancelRecording: jest.fn(() => Promise.resolve()),
    discardTake: jest.fn(),
    submitClone: jest.fn(),
    refreshMicrophonePermission: jest.fn(() => Promise.resolve()),
    requestMicrophonePermission: jest.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

/**
 * Turns the listed fields of the plain store into observable ones (set them
 * like plain fields; each write is an action), so the screen follows them.
 */
function observe<K extends keyof RecordingStoreMock>(store: RecordingStoreMock, fields: K[]): void {
  const state = observable(
    Object.fromEntries(fields.map(field => [field, store[field]])) as Pick<RecordingStoreMock, K>,
  );
  for (const field of fields) {
    Object.defineProperty(store, field, {
      configurable: true,
      enumerable: true,
      get: () => state[field],
      set: (value: RecordingStoreMock[K]) =>
        runInAction(() => {
          state[field] = value;
        }),
    });
  }
}

function makeVoiceStore(overrides: Partial<VoiceStoreMock> = {}): VoiceStoreMock {
  const store: VoiceStoreMock = {
    cloneConfig: CONFIG,
    // The store's rule: a config is only handed out for its own language.
    cloneConfigFor: jest.fn((language?: string | null) =>
      store.cloneConfig && (!language || store.cloneConfig.language === language)
        ? store.cloneConfig
        : null,
    ),
    isLoadingCloneConfig: false,
    cloneConfigError: null,
    loadCloneConfig: jest.fn(() => Promise.resolve(null)),
    refreshCloneConfigForReconsent: jest.fn(() => Promise.resolve(null)),
    loadVoiceProfiles: jest.fn(),
    loadVoiceSlots: jest.fn(),
    trackVoiceProfile: jest.fn(),
    voiceProfiles: [],
    ...overrides,
  };
  return store;
}

const ENGLISH_CONFIG = parseCloneConfigFromJSON({
  enabled: true,
  ...DURATIONS,
  language: 'en',
  locale: 'en-US',
  supportedLanguages: [
    { code: 'tr', locale: 'tr-TR', nativeName: 'Türkçe', englishName: 'Turkish' },
    { code: 'en', locale: 'en-US', nativeName: 'English', englishName: 'English' },
  ],
  scriptTitle: 'Little Red Riding Hood',
  script: 'Once upon a time there was a little girl.',
  consentVersion: 'en-2026-10',
  consentText: 'Consent text.',
});

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

// Renders and lets the mount-time async work settle
// inside act (otherwise the first sync test logs an act() warning).
async function renderScreen(
  theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi',
  options: { withDialog?: boolean } = {},
) {
  const utils = renderWithProviders(<VoiceRecordingScreen />, { theme, ...options });
  await act(async () => undefined);
  return utils;
}

const HIDDEN = { includeHiddenElements: true };
const RECORD_START = 'Kaydı başlat';
const RECORD_STOP = 'Kaydı durdur';
const SUBMIT = 'Sesimi oluştur';
const RESTART = 'Baştan başla';
const PERMISSION_HINT = 'Kayda başlamak için mikrofon iznini aç.';
const T = themes['gece-mavisi'];

const TAKE = {
  hasTake: true,
  recordedFilePath: 'file:///take.wav',
  recordedDurationSeconds: 31,
};

function lastDialog(): DialogOptions {
  const calls = mockShowDialog.mock.calls;
  return calls[calls.length - 1][0] as DialogOptions;
}

/** Order of the testIDs in the rendered tree (depth first). */
function treeOrder(ids: string[]): string[] {
  const found: string[] = [];
  const walk = (node: { props?: { testID?: string }; children?: unknown[] }) => {
    const id = node.props?.testID;
    if (id && ids.includes(id) && !found.includes(id)) found.push(id);
    for (const child of node.children ?? []) {
      if (child && typeof child === 'object') walk(child as typeof node);
    }
  };
  walk(screen.getByTestId('recording-scroll') as unknown as Parameters<typeof walk>[0]);
  return found;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRealDialog = false;
  mockAppPlayer.isPlaying = false;
  mockListenStatus = { playing: false, didJustFinish: false, duration: 0, currentTime: 0 };
  mockRouteParams = { name: 'Annem', consentVersion: 'kvkk-2026-09' };
  mockRecordingStore = makeRecordingStore();
  mockVoiceStore = makeVoiceStore();
});

describe('VoiceRecordingScreen', () => {
  describe('before a take', () => {
    it('applies the served durations and shows the script and the idle panel', async () => {
      await renderScreen();

      expect(mockRecordingStore.reset).toHaveBeenCalled();
      expect(mockRecordingStore.configure).toHaveBeenCalledWith(DURATIONS, 'Annem');

      expect(screen.getByRole('header', { name: 'Ses kaydı' })).toBeOnTheScreen();
      expect(screen.getByText('Okuma metni')).toBeOnTheScreen();
      expect(screen.getByText('Kirmizi Baslikli Kiz')).toBeOnTheScreen();
      expect(screen.getByText('Evvel zaman icinde, kalbur saman icinde.')).toBeOnTheScreen();

      expect(screen.getByText('Ses seviyesi')).toBeOnTheScreen();
      expect(screen.getByText('Kayıt başlayınca ölçülür')).toBeOnTheScreen();
      expect(screen.getByText('Kısık')).toBeOnTheScreen();
      expect(screen.getByText('İyi aralık')).toBeOnTheScreen();
      expect(screen.getByText('Yüksek')).toBeOnTheScreen();
      // Markers say what they mean, with the served numbers.
      expect(screen.getByText('En az 20 sn')).toBeOnTheScreen();
      expect(screen.getByText('İdeal 45 sn')).toBeOnTheScreen();
      expect(
        screen.getByText('Hazır olunca dokun ve oku. Süre, konuşunca başlar.'),
      ).toBeOnTheScreen();
      expect(screen.getByTestId('recording-clock')).toHaveTextContent('0:00');
      expect(screen.getByText('/ 1:30')).toBeOnTheScreen();

      expect(screen.getByRole('button', { name: RECORD_START })).toBeEnabled();
      expect(screen.getByTestId('record-button-mic', HIDDEN)).toBeOnTheScreen();
      // No take yet: nothing to restart, and the meter is empty.
      expect(screen.queryByRole('button', { name: RESTART })).toBeNull();
      expect(screen.queryAllByTestId('level-meter-on')).toHaveLength(0);
      // No caption under the button: its words are the button's own label.
      expect(within(screen.getByTestId('recording-panel')).queryByText(RECORD_START, HIDDEN)).toBeNull();
    });

    it('starts a take when the record button is pressed', async () => {
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: RECORD_START }));

      await waitFor(() => expect(mockRecordingStore.startRecording).toHaveBeenCalledTimes(1));
      expect(mockRecordingStore.requestStop).not.toHaveBeenCalled();
      expect(mockAppPlayer.pause).not.toHaveBeenCalled();
    });

    it('pauses a story that is playing before the take starts', async () => {
      mockAppPlayer.isPlaying = true;
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: RECORD_START }));

      await waitFor(() => expect(mockRecordingStore.startRecording).toHaveBeenCalledTimes(1));
      expect(mockAppPlayer.pause).toHaveBeenCalledTimes(1);
    });

    it('shows why the previous take was rejected in the hint line, without the tips', async () => {
      mockRecordingStore = makeRecordingStore({
        takeRejectionMessage:
          'Kayıt çok kısa. En az 20 saniye okuman gerekiyor, lütfen yeniden kaydet.',
      });
      await renderScreen();

      const hint = screen.getByTestId('recording-hint');
      expect(hint).toHaveTextContent(
        'Kayıt çok kısa. En az 20 saniye okuman gerekiyor, lütfen yeniden kaydet.',
      );
      expect(flatStyle(hint).color).toBe(T.error);
      // No extra banner block: the panel keeps its height.
      expect(screen.queryByTestId('recording-rejection')).toBeNull();
      // The script keeps the scroll area.
      expect(screen.queryByTestId('recording-tips')).toBeNull();
    });

    it('leaves at once from the app bar and from the hardware back button', async () => {
      const addListener = jest.spyOn(BackHandler, 'addEventListener');
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
      expect(mockShowDialog).not.toHaveBeenCalled();
      expect(mockNav.goBack).toHaveBeenCalledTimes(1);

      // The same screen never leaves twice.
      const handler = addListener.mock.calls[addListener.mock.calls.length - 1][1];
      expect(handler()).toBe(true);
      expect(mockNav.goBack).toHaveBeenCalledTimes(1);
    });

    it('the hardware back button leaves at once too', async () => {
      const addListener = jest.spyOn(BackHandler, 'addEventListener');
      await renderScreen();
      const handler = addListener.mock.calls[addListener.mock.calls.length - 1][1];
      expect(handler()).toBe(true);
      expect(mockShowDialog).not.toHaveBeenCalled();
      expect(mockNav.goBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('microphone permission', () => {
    it('after a permanent denial: the settings card first, the record button blocked, the hint in the error colour', async () => {
      const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
      mockRecordingStore = makeRecordingStore({
        isPermissionDenied: true,
        canAskPermissionAgain: false,
      });
      await renderScreen();

      expect(screen.getByText('Mikrofon izni gerekli')).toBeOnTheScreen();
      expect(
        screen.getByText('Sesini kaydedebilmemiz için ayarlardan mikrofon iznini açman gerekiyor.'),
      ).toBeOnTheScreen();
      // The permission card is the first thing in the scroll area, before
      // the script; the tips are not shown at all.
      expect(screen.queryByTestId('recording-tips')).toBeNull();
      expect(treeOrder(['recording-permission', 'recording-tips', 'recording-script'])).toEqual([
        'recording-permission',
        'recording-script',
      ]);
      // The hint says the same thing, in the error colour, not "tap and read".
      const hint = screen.getByTestId('recording-hint');
      expect(hint).toHaveTextContent(PERMISSION_HINT);
      expect(flatStyle(hint).color).toBe(T.error);

      const record = screen.getByRole('button', { name: RECORD_START });
      expect(record).toBeDisabled();
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      await user.press(record);
      expect(mockRecordingStore.startRecording).not.toHaveBeenCalled();

      fireEvent.press(screen.getByRole('button', { name: 'Ayarlara git' }));
      expect(openSettings).toHaveBeenCalledTimes(1);
    });

    it('after a first denial: record stays pressable and asks again, the card offers "İzin ver"', async () => {
      mockRecordingStore = makeRecordingStore({
        isPermissionDenied: true,
        canAskPermissionAgain: true,
      });
      await renderScreen();

      expect(screen.getByText('Sesini kaydedebilmemiz için mikrofon iznine ihtiyacımız var.')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Ayarlara git' })).toBeNull();
      expect(screen.getByTestId('recording-hint')).toHaveTextContent(PERMISSION_HINT);

      const record = screen.getByRole('button', { name: RECORD_START });
      expect(record).toBeEnabled();
      // Not drawn as unavailable.
      expect(record).toHaveStyle({ opacity: 1 });
      fireEvent.press(record);
      await waitFor(() => expect(mockRecordingStore.startRecording).toHaveBeenCalledTimes(1));

    });

    it('"İzin ver" only asks for the microphone: a grant does not start a take', async () => {
      mockRecordingStore = makeRecordingStore({
        isPermissionDenied: true,
        canAskPermissionAgain: true,
      });
      observe(mockRecordingStore, ['isPermissionDenied']);
      let answer: (granted: boolean) => void = () => undefined;
      mockRecordingStore.requestMicrophonePermission.mockImplementation(
        () =>
          new Promise<boolean>(resolve => {
            answer = granted => {
              mockRecordingStore.isPermissionDenied = !granted;
              resolve(granted);
            };
          }),
      );
      await renderScreen();

      const ask = screen.getByRole('button', { name: 'İzin ver' });
      fireEvent.press(ask);
      // A second tap while the system dialog is up asks nothing more.
      fireEvent.press(ask);
      expect(mockRecordingStore.requestMicrophonePermission).toHaveBeenCalledTimes(1);

      await act(async () => {
        answer(true);
      });
      expect(mockRecordingStore.startRecording).not.toHaveBeenCalled();
      expect(screen.queryByTestId('recording-permission')).toBeNull();
      expect(screen.getByTestId('recording-hint')).toHaveTextContent(
        'Hazır olunca dokun ve oku. Süre, konuşunca başlar.',
      );
      expect(screen.getByRole('button', { name: RECORD_START })).toBeEnabled();
    });

    it('frees the record button when the user comes back with the microphone granted', async () => {
      const addListener = jest.spyOn(AppState, 'addEventListener');
      mockRecordingStore = makeRecordingStore({
        isPermissionDenied: true,
        canAskPermissionAgain: false,
      });
      observe(mockRecordingStore, ['isPermissionDenied', 'canAskPermissionAgain']);
      mockRecordingStore.refreshMicrophonePermission.mockImplementation(async () => {
        // The grant made in the system settings.
        mockRecordingStore.isPermissionDenied = false;
        mockRecordingStore.canAskPermissionAgain = true;
      });
      await renderScreen();
      expect(screen.getByRole('button', { name: RECORD_START })).toBeDisabled();

      const handler = addListener.mock.calls[addListener.mock.calls.length - 1][1];
      await act(async () => {
        handler('active');
      });

      expect(mockRecordingStore.refreshMicrophonePermission).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: RECORD_START })).toBeEnabled();
      expect(screen.queryByTestId('recording-permission')).toBeNull();
      expect(screen.getByTestId('recording-hint')).toHaveTextContent(
        'Hazır olunca dokun ve oku. Süre, konuşunca başlar.',
      );
    });

    it('does not re-read the permission when nothing was denied', async () => {
      const addListener = jest.spyOn(AppState, 'addEventListener');
      await renderScreen();

      const handler = addListener.mock.calls[addListener.mock.calls.length - 1][1];
      handler('active');
      expect(mockRecordingStore.refreshMicrophonePermission).not.toHaveBeenCalled();
    });
  });

  describe('during a take', () => {
    it('refuses to stop before minSeconds (canStop false) and explains why in the hint line', async () => {
      mockRecordingStore = makeRecordingStore({
        isRecording: true,
        canStop: false,
        recordingDurationSeconds: 8,
        inputLevel: 'good',
        currentLevelDbfs: -20,
        requestStop: jest.fn(() => false),
      });
      await renderScreen();

      const stop = screen.getByRole('button', { name: RECORD_STOP });
      // Full opacity even before the minimum: the button must not read as broken.
      expect(stop).toHaveStyle({ opacity: 1 });
      expect(screen.getByTestId('record-button-stop')).toBeOnTheScreen();
      // No caption repeating the button's label.
      expect(screen.queryByText('Durdur', HIDDEN)).toBeNull();
      expect(screen.getByText('En az 20 saniye oku. Okumaya devam et.')).toBeOnTheScreen();
      expect(screen.getByTestId('recording-clock')).toHaveTextContent('0:08');
      expect(screen.getByText('/ 1:30')).toBeOnTheScreen();
      expect(screen.getByText('İyi')).toBeOnTheScreen();
      expect(screen.queryAllByTestId('level-meter-on').length).toBeGreaterThan(0);

      fireEvent.press(stop);

      expect(mockRecordingStore.requestStop).toHaveBeenCalledTimes(1);
      // In the hint line right above the button, not a snackbar over it.
      expect(showToast.info).not.toHaveBeenCalled();
      const hint = screen.getByTestId('recording-hint');
      expect(hint).toHaveTextContent('En az 20 saniye okuman gerekiyor. Okumaya devam et.');
      expect(flatStyle(hint).color).toBe(T.error);
      expect(mockRecordingStore.startRecording).not.toHaveBeenCalled();

      // The flash goes after a moment and the running hint is back.
      act(() => {
        jest.advanceTimersByTime(HINT_FLASH_MS - 1);
      });
      expect(screen.getByTestId('recording-hint')).toHaveTextContent(
        'En az 20 saniye okuman gerekiyor. Okumaya devam et.',
      );
      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(screen.getByTestId('recording-hint')).toHaveTextContent(
        'En az 20 saniye oku. Okumaya devam et.',
      );
    });

    it('accepts stop once canStop is true and says the take can be stopped', async () => {
      mockRecordingStore = makeRecordingStore({
        isRecording: true,
        canStop: true,
        recordingDurationSeconds: 25,
        inputLevel: 'good',
        requestStop: jest.fn(() => true),
      });
      await renderScreen();

      const stop = screen.getByRole('button', { name: RECORD_STOP });
      expect(stop).toHaveStyle({ opacity: 1 });
      expect(
        screen.getByText('Şimdi durdurabilirsin. 45 saniyeye tamamlarsan sesin daha iyi çıkar.'),
      ).toBeOnTheScreen();

      fireEvent.press(stop);

      expect(mockRecordingStore.requestStop).toHaveBeenCalledTimes(1);
      expect(showToast.info).not.toHaveBeenCalled();
      expect(screen.getByTestId('recording-hint')).toHaveTextContent(
        'Şimdi durdurabilirsin. 45 saniyeye tamamlarsan sesin daha iyi çıkar.',
      );
    });

    it('says the take is long enough once the ideal length is reached', async () => {
      mockRecordingStore = makeRecordingStore({
        isRecording: true,
        canStop: true,
        reachedTarget: true,
        recordingDurationSeconds: 50,
        inputLevel: 'good',
      });
      await renderScreen();

      expect(
        screen.getByText(
          'Bu kadarı yeter. İstersen devam et, 90 saniyede kayıt kendiliğinden durur.',
        ),
      ).toBeOnTheScreen();
      // The ideal notch is green only now that it is reached.
      expect(flatStyle(screen.getByTestId('take-progress-target')).backgroundColor).toBe(T.success);
    });

    it('asks the user to start reading while no speech was detected yet', async () => {
      mockRecordingStore = makeRecordingStore({
        isRecording: true,
        isAwaitingSpeech: true,
        inputLevel: 'quiet',
        requestStop: jest.fn(() => false),
      });
      await renderScreen();

      expect(
        screen.getByText('Seni dinliyoruz. Okumaya başlayınca süre de başlar.'),
      ).toBeOnTheScreen();
      // Nothing is judged before speech starts.
      expect(screen.getByText('Ölçülüyor...')).toBeOnTheScreen();
      // At 0:00 nothing is green yet: the minimum is the mark to reach.
      expect(flatStyle(screen.getByTestId('take-progress-target')).backgroundColor).toBe(T.text2);
      expect(flatStyle(screen.getByTestId('take-progress-min')).backgroundColor).toBe(T.action);

      fireEvent.press(screen.getByRole('button', { name: RECORD_STOP }));

      expect(showToast.info).not.toHaveBeenCalled();
      expect(screen.getByTestId('recording-hint')).toHaveTextContent(
        'Metni sesli okumaya başla. Süre, konuşunca başlar.',
      );
    });

    it.each([
      ['quiet', 'Kısık', 'Sesin kısık geliyor. Biraz daha yüksek oku ya da telefonu yaklaştır.'],
      ['loud', 'Yüksek', 'Sesin çok yüksek geliyor. Telefonu biraz uzaklaştır.'],
    ] as const)('names a %s level in words and says what to do', async (level, word, advice) => {
      mockRecordingStore = makeRecordingStore({
        isRecording: true,
        recordingDurationSeconds: 5,
        inputLevel: level,
      });
      await renderScreen();

      expect(screen.getByTestId('level-meter-state')).toHaveTextContent(word);
      expect(screen.getByTestId('recording-hint')).toHaveTextContent(advice);
      // The meter is no live region while the microphone is open.
      expect(screen.getByTestId('level-meter').props.accessibilityLiveRegion).toBe('none');
    });

    it.each([
      ['the minimum', 'good'],
      ['a quiet level', 'quiet'],
    ] as const)('reserves two lines for the hint before %s, so the panel never jumps', async (_, level) => {
      mockRecordingStore = makeRecordingStore({
        isRecording: true,
        recordingDurationSeconds: 5,
        inputLevel: level,
      });
      await renderScreen();

      const hint = screen.getByTestId('recording-hint');
      expect(hint.props.numberOfLines).toBe(2);
      expect(hint.props.maxFontSizeMultiplier).toBe(1.3);
      const minHeight = flatStyle(hint).minHeight;
      expect(minHeight).toBeGreaterThanOrEqual(36);
      expect(minHeight).toBe(Math.ceil(2 * 18 * Math.min(Dimensions.get('window').fontScale, 1.3)));
    });

    it('restarts the take through the store, never through a cancel and a new start', async () => {
      mockRecordingStore = makeRecordingStore({
        isRecording: true,
        recordingDurationSeconds: 5,
        inputLevel: 'good',
      });
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: RESTART }));

      await waitFor(() => expect(mockRecordingStore.restartRecording).toHaveBeenCalledTimes(1));
      expect(mockRecordingStore.cancelRecording).not.toHaveBeenCalled();
      expect(mockRecordingStore.startRecording).not.toHaveBeenCalled();
    });

    it('never falls back to the idle state between the two takes of a restart', async () => {
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      let finish: () => void = () => undefined;
      mockRecordingStore = makeRecordingStore({
        isRecording: true,
        recordingDurationSeconds: 5,
        inputLevel: 'good',
      });
      observe(mockRecordingStore, ['isRecording', 'isStarting', 'recordingDurationSeconds']);
      mockRecordingStore.restartRecording.mockImplementation(async () => {
        // The store: the old take stops, the new one is starting.
        mockRecordingStore.isRecording = false;
        mockRecordingStore.isStarting = true;
        await new Promise<void>(resolve => {
          finish = resolve;
        });
        mockRecordingStore.isStarting = false;
        mockRecordingStore.recordingDurationSeconds = 0;
        mockRecordingStore.isRecording = true;
      });
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: RESTART }));
      await act(async () => undefined);

      // Between the takes: no tips, no microphone glyph, the restart stays.
      expect(screen.queryByTestId('recording-tips')).toBeNull();
      expect(screen.getByTestId('record-button-stop')).toBeOnTheScreen();
      expect(screen.queryByTestId('record-button-mic', HIDDEN)).toBeNull();
      expect(screen.getByRole('button', { name: RESTART })).toBeDisabled();
      expect(screen.getByTestId('recording-hint')).toHaveTextContent('Mikrofon hazırlanıyor...');
      // A second tap does not start a second restart.
      fireEvent.press(screen.getByRole('button', { name: RESTART }));
      expect(mockRecordingStore.restartRecording).toHaveBeenCalledTimes(1);

      await act(async () => {
        finish();
      });
      expect(screen.getByRole('button', { name: RESTART })).toBeEnabled();
      expect(screen.getByRole('button', { name: RECORD_STOP })).toBeOnTheScreen();
      expect(screen.queryByTestId('recording-tips')).toBeNull();
      // A restart is not the end of a take: nothing is announced.
      expect(announce).not.toHaveBeenCalled();
    });

    it('asks before leaving a running take, and cancels it on confirm', async () => {
      mockRecordingStore = makeRecordingStore({ isRecording: true, inputLevel: 'good' });
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
      expect(mockNav.goBack).not.toHaveBeenCalled();
      const dialog = lastDialog();
      expect(dialog.title).toBe('Kaydı bırakıyor musun?');
      expect(dialog.message).toBe('Kayıt sürüyor. Çıkarsan bu kayıt silinir.');
      expect(dialog.buttons?.map(b => b.text)).toEqual(['Çık', 'Kayda devam et']);

      act(() => dialog.buttons?.[0].onPress?.());
      expect(mockRecordingStore.cancelRecording).toHaveBeenCalledTimes(1);
      // The screen stays until the dialog's window is gone (VR-01).
      expect(mockNav.goBack).not.toHaveBeenCalled();
      await act(async () => {
        dialog.buttons?.[0].afterClose?.();
      });
      expect(mockNav.goBack).toHaveBeenCalledTimes(1);
    });

    it('goes back only after the real leave dialog closed, once, and ignores back meanwhile (VR-01)', async () => {
      mockRealDialog = true;
      const addListener = jest.spyOn(BackHandler, 'addEventListener');
      mockRecordingStore = makeRecordingStore({ isRecording: true, inputLevel: 'good' });
      await renderScreen('gece-mavisi', { withDialog: true });
      fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
      expect(await screen.findByText('Kaydı bırakıyor musun?')).toBeOnTheScreen();

      // From here every animation is held: the dialog's exit ends when the test says.
      const ends: Array<(finished?: boolean) => void> = [];
      jest.spyOn(Reanimated, 'withTiming').mockImplementation(((
        toValue: number,
        _config?: unknown,
        callback?: (finished?: boolean) => void,
      ) => {
        if (callback) ends.push(callback);
        return toValue;
      }) as unknown as typeof Reanimated.withTiming);

      fireEvent.press(screen.getByRole('button', { name: 'Çık' }));
      await act(async () => undefined);
      // The take is dropped at once, the microphone closed, but the screen
      // stays while the dialog leaves: never both in one commit.
      expect(mockRecordingStore.cancelRecording).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('dialog-window', HIDDEN)).toBeOnTheScreen();
      expect(mockNav.goBack).not.toHaveBeenCalled();

      // The hardware back button during the exit opens nothing again.
      const backHandler = addListener.mock.calls[addListener.mock.calls.length - 1][1];
      expect(backHandler()).toBe(true);
      expect(mockNav.goBack).not.toHaveBeenCalled();

      // The exit ends and the window goes (iOS confirms it with onDismiss): then the screen leaves.
      await act(async () => ends.forEach(end => end(true)));
      act(() => fireEvent(screen.UNSAFE_getByType(Modal), 'dismiss'));
      await act(async () => jest.advanceTimersByTime(DISMISS_FALLBACK_MS));
      expect(screen.queryByTestId('dialog-window', HIDDEN)).toBeNull();
      expect(mockNav.goBack).toHaveBeenCalledTimes(1);

      // Back again does not pop a second screen.
      fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
      expect(backHandler()).toBe(true);
      expect(mockNav.goBack).toHaveBeenCalledTimes(1);
    });

    it('stops the take when the app goes to the background', async () => {
      const addListener = jest.spyOn(AppState, 'addEventListener');
      mockRecordingStore = makeRecordingStore({ isRecording: true, inputLevel: 'good' });
      await renderScreen();

      const handler = addListener.mock.calls[addListener.mock.calls.length - 1][1];
      handler('active');
      expect(mockRecordingStore.stopRecording).not.toHaveBeenCalled();
      handler('background');
      expect(mockRecordingStore.stopRecording).toHaveBeenCalledWith('interrupted');
    });

    it('keeps the screen on while a take runs or uploads, and lets it go after', async () => {
      mockRecordingStore = makeRecordingStore();
      observe(mockRecordingStore, ['isRecording', 'isProcessing']);
      const view = await renderScreen();
      expect(activateKeepAwakeAsync).not.toHaveBeenCalled();

      act(() => {
        mockRecordingStore.isRecording = true;
      });
      expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
      expect(activateKeepAwakeAsync).toHaveBeenCalledWith(KEEP_AWAKE_TAG);
      expect(KEEP_AWAKE_TAG).toBe('voice-recording');
      expect(deactivateKeepAwake).not.toHaveBeenCalled();

      act(() => {
        mockRecordingStore.isRecording = false;
      });
      expect(deactivateKeepAwake).toHaveBeenCalledTimes(1);
      expect(deactivateKeepAwake).toHaveBeenCalledWith(KEEP_AWAKE_TAG);

      // The upload keeps it on too, and leaving the screen lets it go.
      act(() => {
        mockRecordingStore.isProcessing = true;
      });
      expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(2);
      view.unmount();
      expect(deactivateKeepAwake).toHaveBeenCalledTimes(2);
    });

    it('never redraws the reading card while the level and the timer move', async () => {
      mockRecordingStore = makeRecordingStore({
        isRecording: true,
        recordingDurationSeconds: 5,
        inputLevel: 'good',
        currentLevelDbfs: -30,
      });
      observe(mockRecordingStore, [
        'recordingDurationSeconds',
        'currentLevelDbfs',
        'inputLevel',
        'canStop',
      ]);
      await renderScreen();
      const renders = mockScriptRenders.mock.calls.length;
      expect(renders).toBeGreaterThan(0);

      // Ten polls a second in the real store.
      for (let tick = 1; tick <= 5; tick += 1) {
        act(() => {
          mockRecordingStore.recordingDurationSeconds = 5 + tick * 0.5;
          mockRecordingStore.currentLevelDbfs = -30 + tick;
          mockRecordingStore.inputLevel = tick % 2 ? 'quiet' : 'good';
        });
      }

      // The panel followed them...
      expect(screen.getByTestId('recording-clock')).toHaveTextContent('0:07');
      expect(screen.getByTestId('level-meter-state')).toHaveTextContent('Kısık');
      // ...the script card did not draw again.
      expect(mockScriptRenders).toHaveBeenCalledTimes(renders);
    });

    it('announces the level once, after the take', async () => {
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      mockRecordingStore = makeRecordingStore({
        isRecording: true,
        canStop: true,
        recordingDurationSeconds: 25,
        inputLevel: 'good',
      });
      observe(mockRecordingStore, ['isRecording', 'inputLevel', 'hasTake', 'recordedFilePath']);
      await renderScreen();

      act(() => {
        mockRecordingStore.inputLevel = 'quiet';
      });
      act(() => {
        mockRecordingStore.inputLevel = 'good';
      });
      // Nothing is spoken into the open microphone.
      expect(announce).not.toHaveBeenCalled();

      act(() => {
        mockRecordingStore.isRecording = false;
        mockRecordingStore.inputLevel = 'idle';
        mockRecordingStore.recordedFilePath = TAKE.recordedFilePath;
        mockRecordingStore.hasTake = true;
      });
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith('Ses seviyesi: İyi');
    });
  });

  describe('review', () => {
    it('shows the take, its real length and no line about the level', async () => {
      mockRecordingStore = makeRecordingStore(TAKE);
      await renderScreen();

      expect(screen.getByRole('header', { name: 'Kaydını dinle' })).toBeOnTheScreen();
      expect(screen.getByText('31 saniye, yeterli uzunlukta')).toBeOnTheScreen();
      expect(screen.getByTestId('review-player-time')).toHaveTextContent('0:31');
      expect(
        screen.getByText(
          'Kayıt şimdilik yalnızca telefonunda. Sesimi oluştur dersen gönderilir.',
        ),
      ).toBeOnTheScreen();
      // The store keeps no level summary of a take, so nothing is claimed.
      expect(screen.queryByText('Ses seviyesi iyi')).toBeNull();
      // The reading card stays, the record controls are gone.
      expect(screen.getByText('Evvel zaman icinde, kalbur saman icinde.')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: RECORD_START })).toBeNull();
      expect(screen.queryByTestId('recording-tips')).toBeNull();
      // The upload slot is there before the upload, empty.
      expect(screen.queryByTestId('review-upload-progress')).toBeNull();
    });

    it('plays the take', async () => {
      mockRecordingStore = makeRecordingStore(TAKE);
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: 'Kaydını dinle' }));
      expect(mockListenPlayer.play).toHaveBeenCalledTimes(1);
      expect(mockListenPlayer.seekTo).not.toHaveBeenCalled();
    });

    it('pauses the take while it plays', async () => {
      mockListenStatus = { playing: true, didJustFinish: false, duration: 31, currentTime: 10 };
      mockRecordingStore = makeRecordingStore(TAKE);
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: 'Dinlemeyi durdur' }));
      expect(mockListenPlayer.pause).toHaveBeenCalledTimes(1);
      expect(mockListenPlayer.play).not.toHaveBeenCalled();
    });

    it('rewinds a finished take before playing it again', async () => {
      mockListenStatus = { playing: false, didJustFinish: true, duration: 31, currentTime: 31 };
      mockRecordingStore = makeRecordingStore(TAKE);
      await renderScreen();

      // Natural end: rewound by the effect.
      expect(mockListenPlayer.seekTo).toHaveBeenCalledWith(0);
      mockListenPlayer.seekTo.mockClear();

      fireEvent.press(screen.getByRole('button', { name: 'Kaydını dinle' }));
      expect(mockListenPlayer.seekTo).toHaveBeenCalledWith(0);
      expect(mockListenPlayer.play).toHaveBeenCalledTimes(1);
    });

    it('uploads the take with the accepted consent version and opens Processing', async () => {
      mockRecordingStore = makeRecordingStore({
        ...TAKE,
        submitClone: jest.fn(() => Promise.resolve({ ok: true, profileId: 'vp-1' })),
      });
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

      await waitFor(() =>
        expect(mockNav.replace).toHaveBeenCalledWith('Processing', { profileId: 'vp-1' }),
      );
      // The voice is created in the language of the config: Turkish here;
      // the limit copy follows the plan.
      expect(mockRecordingStore.submitClone).toHaveBeenCalledWith('kvkk-2026-09', 'free', 'tr-TR');
      expect(mockVoiceStore.trackVoiceProfile).toHaveBeenCalledWith('vp-1');
      expect(mockVoiceStore.loadVoiceProfiles).toHaveBeenCalled();
      expect(mockVoiceStore.loadVoiceSlots).toHaveBeenCalled();
    });

    it('passes the story the flow was started from on to Processing', async () => {
      mockRouteParams = { name: 'Annem', consentVersion: 'kvkk-2026-09', returnToStoryId: 'story-7' };
      mockRecordingStore = makeRecordingStore({
        ...TAKE,
        submitClone: jest.fn(() => Promise.resolve({ ok: true, profileId: 'vp-1' })),
      });
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

      await waitFor(() =>
        expect(mockNav.replace).toHaveBeenCalledWith('Processing', {
          profileId: 'vp-1',
          returnToStoryId: 'story-7',
        }),
      );
    });

    it('keeps a short constant upload label and shows the percentage in a bar', async () => {
      mockRecordingStore = makeRecordingStore({
        ...TAKE,
        isProcessing: true,
        processingProgress: 45,
      });
      await renderScreen();

      // The label never grows into two lines with the number.
      expect(screen.getByRole('button', { name: 'Yükleniyor' })).toBeDisabled();
      expect(screen.queryByText('Yükleniyor %45')).toBeNull();
      const bar = screen.getByTestId('review-upload-progress');
      expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 45 });
      expect(bar.props.accessibilityLabel).toBe('Yükleniyor %45');
      expect(screen.getByRole('button', { name: RESTART })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Kaydını dinle' })).toBeDisabled();

      // Back is ignored while the upload runs.
      fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
      expect(mockShowDialog).not.toHaveBeenCalled();
      expect(mockNav.goBack).not.toHaveBeenCalled();
    });

    it('asks before discarding an unsent take on back', async () => {
      mockRecordingStore = makeRecordingStore(TAKE);
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
      expect(mockNav.goBack).not.toHaveBeenCalled();
      const dialog = lastDialog();
      expect(dialog.message).toBe('Kaydın henüz gönderilmedi. Çıkarsan bu kayıt silinir.');
      const leave = dialog.buttons?.find(b => b.text === 'Çık');
      act(() => leave?.onPress?.());
      expect(mockRecordingStore.discardTake).toHaveBeenCalledTimes(1);
      // The screen goes once the dialog is gone (VR-01).
      expect(mockNav.goBack).not.toHaveBeenCalled();
      act(() => leave?.afterClose?.());
      expect(mockNav.goBack).toHaveBeenCalledTimes(1);
    });

    it('asks before "Baştan başla" deletes a finished take', async () => {
      mockRecordingStore = makeRecordingStore(TAKE);
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: RESTART }));
      expect(mockRecordingStore.discardTake).not.toHaveBeenCalled();

      const dialog = lastDialog();
      expect(dialog.title).toBe('Kayıt silinsin mi?');
      expect(dialog.message).toBe('Baştan başlarsan bu kayıt silinir.');
      expect(dialog.buttons?.map(b => b.text)).toEqual(['Vazgeç', 'Sil ve baştan başla']);
      expect(dialog.buttons?.[0].style).toBe('cancel');
      expect(dialog.buttons?.[1].style).toBe('destructive');

      dialog.buttons?.[0].onPress?.();
      expect(mockRecordingStore.discardTake).not.toHaveBeenCalled();
      dialog.buttons?.[1].onPress?.();
      expect(mockRecordingStore.discardTake).toHaveBeenCalledTimes(1);
    });

    it('keeps the take when coming back from a re-consent', async () => {
      mockRouteParams = { name: 'Annem', consentVersion: 'kvkk-2026-10', resumeTake: true };
      mockRecordingStore = makeRecordingStore(TAKE);
      await renderScreen();

      expect(mockRecordingStore.reset).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: SUBMIT })).toBeOnTheScreen();
    });
  });

  describe('upload errors', () => {
    function failWith(action: string, extra: Record<string, unknown> = {}) {
      mockRecordingStore = makeRecordingStore({
        ...TAKE,
        submitClone: jest.fn(() =>
          Promise.resolve({
            ok: false,
            error: { code: 'X', title: 'Baslik', message: 'Mesaj.', action },
            ...extra,
          }),
        ),
      });
    }

    async function submitAndGetDialog(): Promise<DialogOptions> {
      await renderScreen();
      fireEvent.press(screen.getByRole('button', { name: SUBMIT }));
      await waitFor(() => expect(mockShowDialog).toHaveBeenCalledTimes(1));
      return lastDialog();
    }

    it('routes a paywall refusal to the plans in the shared block dialog', async () => {
      failWith('paywall');
      const dialog = await submitAndGetDialog();

      expect(dialog.title).toBe('Baslik');
      // The way out first, then the plans, as on Sesim and the intro.
      expect(dialog.buttons?.map(b => b.text)).toEqual(['Vazgeç', 'Planları gör']);
      dialog.buttons?.find(b => b.text === 'Planları gör')?.onPress?.();
      expect(mockNav.navigate).toHaveBeenCalledWith('Subscription', { reason: 'voices' }, { pop: true });
      expect(mockNav.replace).not.toHaveBeenCalled();
    });

    it('refetches the config and goes back to consent with the take kept (CONSENT_REQUIRED)', async () => {
      failWith('reconsent');
      const dialog = await submitAndGetDialog();

      expect(mockVoiceStore.refreshCloneConfigForReconsent).toHaveBeenCalledTimes(1);
      expect(dialog.cancelable).toBe(false);
      expect(dialog.buttons?.map(b => b.text)).toEqual(['Onay metnine git']);
      // Back to consent once the dialog is gone (VR-01).
      expect(dialog.buttons?.[0].onPress).toBeUndefined();
      dialog.buttons?.[0].afterClose?.();
      expect(mockNav.popTo).toHaveBeenCalledWith('VoiceConsent', {
        name: 'Annem',
        resumeTake: true,
      });
    });

    it('keeps the re-consent dialog open on the Android back button', async () => {
      mockRealDialog = true;
      failWith('reconsent');
      await renderScreen('gece-mavisi', { withDialog: true });

      fireEvent.press(screen.getByRole('button', { name: SUBMIT }));
      expect(await screen.findByText('Baslik')).toBeOnTheScreen();

      fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
      await act(async () => undefined);
      expect(screen.getByText('Baslik')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Onay metnine git' })).toBeOnTheScreen();
      expect(mockNav.popTo).not.toHaveBeenCalled();

      fireEvent.press(screen.getByRole('button', { name: 'Onay metnine git' }));
      // The test exit ends at once; once the window is gone, the screen goes.
      act(() => fireEvent(screen.UNSAFE_getByType(Modal), 'dismiss'));
      await act(async () => jest.advanceTimersByTime(DISMISS_FALLBACK_MS));
      expect(screen.queryByText('Baslik')).toBeNull();
      expect(mockNav.popTo).toHaveBeenCalledTimes(1);
    });

    it('follows the training when the sample was already uploaded', async () => {
      failWith('track', { profileId: 'vp-9' });
      const dialog = await submitAndGetDialog();

      expect(dialog.cancelable).toBe(false);
      dialog.buttons?.[0].onPress?.();
      expect(mockVoiceStore.trackVoiceProfile).toHaveBeenCalledWith('vp-9');
      expect(mockNav.replace).not.toHaveBeenCalled();
      dialog.buttons?.[0].afterClose?.();
      expect(mockNav.replace).toHaveBeenCalledWith('Processing', { profileId: 'vp-9' });
    });

    it('goes back when an already uploaded sample has no profile id', async () => {
      failWith('track');
      const dialog = await submitAndGetDialog();

      dialog.buttons?.[0].onPress?.();
      expect(mockNav.goBack).not.toHaveBeenCalled();
      dialog.buttons?.[0].afterClose?.();
      expect(mockNav.replace).not.toHaveBeenCalled();
      expect(mockNav.goBack).toHaveBeenCalledTimes(1);
    });

    it('offers to try the upload again after a generic failure', async () => {
      failWith('retry');
      const dialog = await submitAndGetDialog();

      expect(dialog.buttons?.map(b => b.text)).toEqual(['Tekrar dene', 'Vazgeç']);
      await act(async () => {
        dialog.buttons?.[0].onPress?.();
      });
      expect(mockRecordingStore.submitClone).toHaveBeenCalledTimes(2);
    });

    it('only informs for an error without an action', async () => {
      failWith('none');
      const dialog = await submitAndGetDialog();
      expect(dialog.buttons?.map(b => b.text)).toEqual(['Tamam']);
    });
  });

  it('sends the user back to consent when no consent version was accepted', async () => {
    mockRouteParams = { name: 'Annem' };
    await renderScreen();

    expect(screen.getByText('Onay gerekli')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: RECORD_START })).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Onay metnine git' }));
    expect(mockNav.popTo).toHaveBeenCalledWith('VoiceConsent', {
      name: 'Annem',
      resumeTake: true,
    });
  });

  describe('recording tips', () => {
    const FIRST_TIP = 'Telefonu ağzından bir karış uzakta tut.';

    it('renders the three built-in tips when the config carries none', async () => {
      expect(CONFIG.recordingTips).toBeUndefined();
      await renderScreen();

      expect(screen.getByText(FIRST_TIP)).toBeOnTheScreen();
      expect(screen.getByText('Masal okur gibi doğal ve sakin oku.')).toBeOnTheScreen();
      expect(screen.getByText('Uzun süre susma, akıcı oku.')).toBeOnTheScreen();
    });

    it('renders the served recordingTips instead of the built-in ones', async () => {
      mockVoiceStore = makeVoiceStore({
        cloneConfig: parseCloneConfigFromJSON({
          ...DURATIONS,
          scriptTitle: 'Kirmizi Baslikli Kiz',
          script: 'Evvel zaman icinde.',
          consentVersion: 'kvkk-2026-09',
          consentText: 'Onay metni.',
          recordingTips: [
            { icon: 'quiet', text: 'Televizyonu kapat.' },
            { icon: 'headphones', text: 'Kulaklık kullanma.' },
            { icon: 'pauses', text: '' },
          ],
        }),
      });
      await renderScreen();

      expect(screen.getByText('Televizyonu kapat.')).toBeOnTheScreen();
      // Unknown icon key: the text still shows (generic icon).
      expect(screen.getByText('Kulaklık kullanma.')).toBeOnTheScreen();
      expect(screen.queryByText(FIRST_TIP)).toBeNull();
    });

    it('keeps the tips in the app language when the voice is in another one (V7)', async () => {
      const englishWithTips = parseCloneConfigFromJSON({
        enabled: true,
        ...DURATIONS,
        language: 'en',
        locale: 'en-US',
        scriptTitle: 'Little Red Riding Hood',
        script: 'Once upon a time there was a little girl.',
        consentVersion: 'en-2026-10',
        consentText: 'Consent text.',
        recordingTips: [{ icon: 'quiet', text: 'Turn the television off.' }],
      });
      mockRouteParams = { name: 'Mom', consentVersion: 'en-2026-10', language: 'en' };
      mockVoiceStore = makeVoiceStore({ cloneConfig: englishWithTips });
      await renderScreen();
      // The script is the voice's; the tips are the app's.
      expect(screen.getByText('Little Red Riding Hood')).toBeOnTheScreen();
      expect(screen.getByText(FIRST_TIP)).toBeOnTheScreen();
      expect(screen.queryByText('Turn the television off.')).toBeNull();
    });

    it('hides the tips while a take runs so the script gets the space', async () => {
      mockRecordingStore = makeRecordingStore({
        isRecording: true,
        recordingDurationSeconds: 5,
        inputLevel: 'good',
      });
      await renderScreen();

      expect(screen.queryByText(FIRST_TIP)).toBeNull();
      // The screen stays named and the reading script stays.
      expect(screen.getByRole('header', { name: 'Ses kaydı' })).toBeOnTheScreen();
      expect(screen.getByText('Evvel zaman icinde, kalbur saman icinde.')).toBeOnTheScreen();
    });

    it('hides the tips as soon as recording is starting', async () => {
      mockRecordingStore = makeRecordingStore({ isStarting: true });
      await renderScreen();

      expect(screen.queryByText(FIRST_TIP)).toBeNull();
      expect(screen.getByText('Mikrofon hazırlanıyor...')).toBeOnTheScreen();
      // The press is blocked while the microphone starts, but not dimmed.
      const record = screen.getByRole('button', { name: RECORD_START });
      expect(record).toBeDisabled();
      expect(record).toHaveStyle({ opacity: 1 });
    });

    it('keeps the tips away once a take was started, also after it ended', async () => {
      mockRecordingStore = makeRecordingStore();
      observe(mockRecordingStore, ['isRecording', 'takeRejectionMessage']);
      await renderScreen();
      expect(screen.getByText(FIRST_TIP)).toBeOnTheScreen();

      act(() => {
        mockRecordingStore.isRecording = true;
      });
      expect(screen.queryByText(FIRST_TIP)).toBeNull();

      // A take that ended without a rejection (cancelled), then a rejected one:
      // the script keeps the scroll area either way.
      act(() => {
        mockRecordingStore.isRecording = false;
      });
      expect(screen.queryByText(FIRST_TIP)).toBeNull();
      expect(screen.getByRole('button', { name: RECORD_START })).toBeOnTheScreen();
      act(() => {
        mockRecordingStore.takeRejectionMessage = 'Sesini duyamadık.';
      });
      expect(screen.queryByText(FIRST_TIP)).toBeNull();
      expect(screen.getByTestId('recording-hint')).toHaveTextContent('Sesini duyamadık.');
    });

    it('keeps the tips away after a take kept from before a re-consent is dropped', async () => {
      mockRouteParams = { name: 'Annem', consentVersion: 'kvkk-2026-10', resumeTake: true };
      mockRecordingStore = makeRecordingStore(TAKE);
      observe(mockRecordingStore, ['hasTake', 'recordedFilePath']);
      await renderScreen();
      expect(screen.getByRole('button', { name: SUBMIT })).toBeOnTheScreen();

      // "Baştan başla" in the review, confirmed.
      act(() => {
        mockRecordingStore.hasTake = false;
        mockRecordingStore.recordedFilePath = '';
      });
      expect(screen.getByRole('button', { name: RECORD_START })).toBeOnTheScreen();
      expect(screen.queryByText(FIRST_TIP)).toBeNull();
    });
  });

  describe('stop button accessibility', () => {
    it('is announced as disabled before minSeconds but still explains on tap', async () => {
      mockRecordingStore = makeRecordingStore({
        isRecording: true,
        canStop: false,
        recordingDurationSeconds: 8,
        inputLevel: 'good',
        requestStop: jest.fn(() => false),
      });
      await renderScreen();

      const stop = screen.getByRole('button', { name: RECORD_STOP });
      expect(stop.props.accessibilityState?.disabled).toBe(true);
      expect(stop).toBeDisabled();
      expect(stop.props.accessibilityHint).toBe('En az 20 saniye okuyunca durdurabilirsin.');

      // The press still reaches the handler (tap-to-explain).
      fireEvent.press(stop);
      expect(mockRecordingStore.requestStop).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('recording-hint')).toHaveTextContent(
        'En az 20 saniye okuman gerekiyor. Okumaya devam et.',
      );
    });

    it('is announced as disabled while no speech was detected yet', async () => {
      mockRecordingStore = makeRecordingStore({
        isRecording: true,
        isAwaitingSpeech: true,
      });
      await renderScreen();

      expect(screen.getByRole('button', { name: RECORD_STOP })).toBeDisabled();
    });

    it('is enabled once canStop is true', async () => {
      mockRecordingStore = makeRecordingStore({
        isRecording: true,
        canStop: true,
        recordingDurationSeconds: 25,
        inputLevel: 'good',
      });
      await renderScreen();

      const stop = screen.getByRole('button', { name: RECORD_STOP });
      expect(stop).toBeEnabled();
      expect(stop.props.accessibilityState?.disabled).toBe(false);
      expect(stop.props.accessibilityHint).toBeUndefined();
    });

    it('keeps the idle record button enabled', async () => {
      await renderScreen();
      expect(screen.getByRole('button', { name: RECORD_START })).toBeEnabled();
    });
  });

  describe('voice language', () => {
    it('shows the script of the chosen language and creates the voice in it', async () => {
      mockRouteParams = { name: 'Mom', consentVersion: 'en-2026-10', language: 'en' };
      mockVoiceStore = makeVoiceStore({ cloneConfig: ENGLISH_CONFIG });
      mockRecordingStore = makeRecordingStore({
        ...TAKE,
        submitClone: jest.fn(() => Promise.resolve({ ok: true, profileId: 'vp-1' })),
      });
      await renderScreen();

      expect(screen.getByText('Little Red Riding Hood')).toBeOnTheScreen();
      expect(screen.getByText('Once upon a time there was a little girl.')).toBeOnTheScreen();
      expect(mockVoiceStore.loadCloneConfig).not.toHaveBeenCalled();

      fireEvent.press(screen.getByRole('button', { name: SUBMIT }));
      await waitFor(() =>
        expect(mockNav.replace).toHaveBeenCalledWith('Processing', { profileId: 'vp-1' }),
      );
      // The English consent version goes with an English voice.
      expect(mockRecordingStore.submitClone).toHaveBeenCalledWith('en-2026-10', 'free', 'en-US');
    });

    it('never shows the script of another language: it loads the chosen one', async () => {
      // The store still holds the Turkish texts.
      mockRouteParams = { name: 'Mom', consentVersion: 'en-2026-10', language: 'en' };
      mockVoiceStore = makeVoiceStore({ cloneConfig: CONFIG });
      await renderScreen();

      expect(screen.queryByText('Kirmizi Baslikli Kiz')).toBeNull();
      expect(mockVoiceStore.loadCloneConfig).toHaveBeenCalledWith('en');
      expect(mockRecordingStore.configure).not.toHaveBeenCalled();
      // Loaded and still not the chosen language: the retry, not a spinner.
      expect(screen.getByText('Kayıt bilgileri yüklenemedi')).toBeOnTheScreen();
      mockVoiceStore.loadCloneConfig.mockClear();
      fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
      expect(mockVoiceStore.loadCloneConfig).toHaveBeenCalledWith('en');
    });

    it('keeps the language and the story on the way back to the consent step', async () => {
      mockRouteParams = {
        name: 'Mom',
        consentVersion: 'en-2026-10',
        language: 'en',
        returnToStoryId: 'story-7',
      };
      mockVoiceStore = makeVoiceStore({ cloneConfig: ENGLISH_CONFIG });
      mockRecordingStore = makeRecordingStore({
        ...TAKE,
        submitClone: jest.fn(() =>
          Promise.resolve({
            ok: false,
            error: { code: 'CONSENT_REQUIRED', title: 'Baslik', message: 'Mesaj', action: 'reconsent' },
          }),
        ),
      });
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: SUBMIT }));
      await waitFor(() => expect(mockShowDialog).toHaveBeenCalledTimes(1));
      lastDialog().buttons?.[0].afterClose?.();

      expect(mockNav.popTo).toHaveBeenCalledWith('VoiceConsent', {
        name: 'Mom',
        resumeTake: true,
        language: 'en',
        returnToStoryId: 'story-7',
      });
    });
  });

  describe('clone config guards', () => {
    it('loads the clone config when it is missing and shows a preparing line', async () => {
      mockVoiceStore = makeVoiceStore({ cloneConfig: null });
      await renderScreen();

      expect(screen.getByText('Kayıt hazırlanıyor...')).toBeOnTheScreen();
      const loading = screen.getByTestId('recording-loading');
      expect(loading.props.accessibilityRole).toBe('progressbar');
      expect(loading.props.accessibilityState).toMatchObject({ busy: true });
      expect(mockVoiceStore.loadCloneConfig).toHaveBeenCalledTimes(1);
      expect(mockRecordingStore.configure).not.toHaveBeenCalled();
    });

    it('shows the load error with a retry', async () => {
      mockVoiceStore = makeVoiceStore({
        cloneConfig: null,
        cloneConfigError: 'Kayıt bilgileri şu an yüklenemedi.',
      });
      await renderScreen();

      expect(screen.getByText('Kayıt bilgileri yüklenemedi')).toBeOnTheScreen();
      expect(screen.getByText('Kayıt bilgileri şu an yüklenemedi.')).toBeOnTheScreen();
      mockVoiceStore.loadCloneConfig.mockClear();
      fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
      expect(mockVoiceStore.loadCloneConfig).toHaveBeenCalledTimes(1);
    });
  });

  it('stops a running take and hands the audio session back on unmount', async () => {
    const view = await renderScreen();
    view.unmount();
    expect(mockRecordingStore.cleanup).toHaveBeenCalledTimes(1);
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', async scheme => {
    mockRecordingStore = makeRecordingStore({
      isRecording: true,
      canStop: true,
      recordingDurationSeconds: 25,
      inputLevel: 'good',
      currentLevelDbfs: -20,
    });
    await renderScreen(scheme);
    const P = themes[scheme];

    // The recorder sits on a calm surface card with round top corners, no hairline.
    expect(flatStyle(screen.getByTestId('recording-panel'))).toMatchObject({
      backgroundColor: P.surface,
      borderTopLeftRadius: 32,
      borderTopRightRadius: 32,
      paddingTop: 16,
    });
    expect(flatStyle(screen.getByTestId('recording-panel')).borderTopWidth).toBeUndefined();
    // The script in a surface card on its lip, Nunito body type, 16dp inside.
    expect(flatStyle(screen.getByTestId('recording-script-face'))).toMatchObject({
      backgroundColor: P.surface,
      paddingHorizontal: 16,
      paddingTop: 16,
    });
    expect(flatStyle(screen.getByTestId('recording-script-lip')).backgroundColor).toBe(P.lip);
    expect(flatStyle(screen.getByText('Evvel zaman icinde, kalbur saman icinde.'))).toMatchObject({
      fontFamily: P.fontBody,
      color: P.text,
    });
    expect(flatStyle(screen.getByText('Kirmizi Baslikli Kiz')).fontFamily).toBe(P.fontDisplay);
    // Step 3 of 3.
    expect(screen.getAllByTestId('recording-steps-on')).toHaveLength(3);
    expect(flatStyle(screen.getAllByTestId('recording-steps-on')[2]).backgroundColor).toBe(P.action);

    expect(flatStyle(screen.getByTestId('level-meter-state')).color).toBe(P.success);
    expect(flatStyle(screen.getAllByTestId('level-meter-on')[0]).backgroundColor).toBe(P.success);
    expect(flatStyle(screen.getByTestId('take-progress-fill')).backgroundColor).toBe(P.success);
    // One big round record button in the recording colour, its glyph dark.
    expect(screen.getByRole('button', { name: RECORD_STOP })).toBeOnTheScreen();
    expect(flatStyle(screen.getByTestId('record-button-face')).backgroundColor).toBe(P.rec);
    expect(flatStyle(screen.getByTestId('record-button-stop')).backgroundColor).toBe(P.onRec);
    expect(flatStyle(screen.getByTestId('recording-clock'))).toMatchObject({
      color: P.text,
      fontFamily: P.fontDisplay,
    });
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('draws the tips and the review in %s', async scheme => {
    await renderScreen(scheme);
    const P = themes[scheme];
    expect(flatStyle(screen.getByTestId('recording-tips-face')).backgroundColor).toBe(P.surface);
    expect(flatStyle(screen.getByText('Telefonu ağzından bir karış uzakta tut.')).color).toBe(P.text2);

    mockRecordingStore = makeRecordingStore(TAKE);
    screen.unmount();
    await renderScreen(scheme);
    expect(flatStyle(screen.getByTestId('review-player-button-face')).backgroundColor).toBe(P.action);
    expect(flatStyle(screen.getByTestId('review-submit-face')).backgroundColor).toBe(P.action);
    // The panel is a surface: its secondary button is one step up, never
    // the panel's own colour.
    expect(flatStyle(screen.getByTestId('review-restart-face')).backgroundColor).toBe(P.surface2);
    expect(flatStyle(screen.getByText('Kaydını dinle'))).toMatchObject({
      fontFamily: P.fontDisplay,
      color: P.text,
    });
  });

  it('draws the permission action one step above its card', async () => {
    mockRecordingStore = makeRecordingStore({ isPermissionDenied: true, canAskPermissionAgain: false });
    await renderScreen();
    expect(flatStyle(screen.getByTestId('recording-permission-action-face')).backgroundColor).toBe(
      T.surface2,
    );
  });

  it('ends the script scroll at the height of its fade', async () => {
    await renderScreen();
    const scroll = screen.getByTestId('recording-scroll');
    const content = Object.assign({}, ...[scroll.props.contentContainerStyle].flat(4).filter(Boolean));
    expect(content.paddingBottom).toBe(24);
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    await renderScreen();

    expect(screen.getByRole('header', { name: 'Voice recording' })).toBeOnTheScreen();
    expect(screen.getByText('Reading text')).toBeOnTheScreen();
    expect(screen.getByText('Min 20 s')).toBeOnTheScreen();
    expect(screen.getByText('Ideal 45 s')).toBeOnTheScreen();
    expect(screen.getByText('Good range')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeOnTheScreen();
  });

  it('says the permission and the upload in English too', async () => {
    await i18n.changeLanguage('en');
    mockRecordingStore = makeRecordingStore({ isPermissionDenied: true, canAskPermissionAgain: true });
    const view = await renderScreen();
    expect(screen.getByTestId('recording-hint')).toHaveTextContent(
      'Turn on the microphone permission to start recording.',
    );
    expect(screen.getByRole('button', { name: 'Allow' })).toBeOnTheScreen();

    view.unmount();
    mockRecordingStore = makeRecordingStore({ ...TAKE, isProcessing: true, processingProgress: 30 });
    await renderScreen();
    expect(screen.getByRole('button', { name: 'Uploading' })).toBeOnTheScreen();
  });
});
