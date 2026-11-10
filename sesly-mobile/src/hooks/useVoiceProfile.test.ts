const mockGetMyVoiceProfiles = jest.fn();
const mockGetVoiceProfileStatus = jest.fn();
const mockGetVoiceSlots = jest.fn();
const mockGetAvailableVoices = jest.fn();
const mockGetCloneConfig = jest.fn();
const mockCreateVoiceProfile = jest.fn();
const mockDeleteVoiceProfile = jest.fn();
const mockGetVoiceSample = jest.fn();

jest.mock('../services/VoiceProfileService', () => ({
  __esModule: true,
  default: {
    getMyVoiceProfiles: (...args: unknown[]) => mockGetMyVoiceProfiles(...args),
    getVoiceProfileStatus: (...args: unknown[]) => mockGetVoiceProfileStatus(...args),
    getVoiceSlots: (...args: unknown[]) => mockGetVoiceSlots(...args),
    getAvailableVoices: (...args: unknown[]) => mockGetAvailableVoices(...args),
    getCloneConfig: (...args: unknown[]) => mockGetCloneConfig(...args),
    createVoiceProfile: (...args: unknown[]) => mockCreateVoiceProfile(...args),
    deleteVoiceProfile: (...args: unknown[]) => mockDeleteVoiceProfile(...args),
    getVoiceSample: (...args: unknown[]) => mockGetVoiceSample(...args),
  },
}));
jest.mock('../services/WebSocketService', () => ({
  __esModule: true,
  default: {
    addVoiceStatusListener: jest.fn(),
    setVoiceStatusFallback: jest.fn(),
  },
}));
jest.mock('../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));
const mockRemoveByVoice = jest.fn();
jest.mock('../stores/QueueStore', () => ({
  queueStore: { removeByVoice: (...args: unknown[]) => mockRemoveByVoice(...args) },
}));

import * as fs from 'fs';
import * as path from 'path';
import { renderHook } from '@testing-library/react-native';
import i18n from '../i18n';
import { runSessionEndHandlers } from '../stores/session';
import {
  VoiceProfileStore,
  describeSlotBlock,
  getVoiceProfileStore,
  useVoiceProfile,
} from './useVoiceProfile';
import WebSocketService from '../services/WebSocketService';
import { CloneConfigError, parseCloneConfigFromJSON } from '../models/VoiceClone';
import { parseVoiceSlotInfoFromJSON, VoiceProfile } from '../models/VoiceProfile';
import { apiErrorFromResponse } from '../services/ApiError';
import { TTSProvider, VoiceProfileStatus } from '../types/enums';
import { VOICE_CLONING } from '../config/constants';
import { showToast } from '../utils/toast';

const profile = (id: string, status: VoiceProfileStatus): VoiceProfile => ({
  id,
  name: 'Annem',
  status,
  provider: TTSProvider.CARTESIA,
  voiceId: 'v',
  language: 'tr-TR',
  contentLanguage: 'tr',
  sampleAudioUrl: null,
  errorMessage: null,
  voiceModelId: null,
  kind: 'CLONE',
  consentAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const statusResponse = (id: string, status: VoiceProfileStatus, errorMessage: string | null = null) => ({
  id,
  name: '',
  status,
  progress: 0,
  provider: TTSProvider.CARTESIA,
  voiceId: '',
  createdAt: new Date(),
  updatedAt: new Date(),
  errorMessage,
});

// Let queued promise callbacks run between fake-timer steps.
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

describe('describeSlotBlock', () => {
  const info = parseVoiceSlotInfoFromJSON({
    plan: 'FREE',
    totalSlots: 4,
    usedSlots: 2,
    availableSlots: 2,
    canCreate: true,
    preset: { used: 3, limit: 3, canCreate: false },
    clone: { used: 1, limit: 1, canCreate: false, monthlyCreated: 1, monthlyLimit: 2 },
  });

  it('explains a full clone slot with usage and a paywall for FREE', () => {
    const block = describeSlotBlock(info, 'clone', 'free');
    expect(block.message).toContain('(1/1)');
    expect(block.showPaywall).toBe(true);
    expect(describeSlotBlock(info, 'clone', 'premium').showPaywall).toBe(false);
  });

  it('explains a used-up monthly creation allowance with the quota copy', () => {
    const monthly = parseVoiceSlotInfoFromJSON({
      canCreate: true,
      clone: { used: 0, limit: 3, canCreate: true, monthlyCreated: 2, monthlyLimit: 2 },
    });
    const block = describeSlotBlock(monthly, 'clone', 'premium');
    expect(block.title).toBe('Bu ayki yeni ses hakkın doldu');
    expect(block.message).toBe('Planında ayda 2 yeni ses kaydı var.');
    expect(block.showPaywall).toBe(false);
  });

  it('uses the preset numbers for ready-made voices', () => {
    expect(describeSlotBlock(info, 'preset', 'free').message).toContain('(3/3)');
  });

  it('prefers backend messages', () => {
    const withMessage = parseVoiceSlotInfoFromJSON({
      canCreate: false,
      clone: { used: 1, limit: 1, canCreate: false, message: 'Sunucudan gelen açıklama.' },
    });
    expect(describeSlotBlock(withMessage, 'clone', 'free').message).toBe(
      'Sunucudan gelen açıklama.',
    );
  });

  it('in English, keeps a backend sentence only when it is English', async () => {
    const i18n = jest.requireActual('../i18n').default;
    const slotsWith = (message: string) =>
      parseVoiceSlotInfoFromJSON({
        canCreate: false,
        clone: { used: 1, limit: 1, canCreate: false, message },
      });
    await i18n.changeLanguage('en');
    try {
      // A Turkish sentence (an older backend): the English copy instead.
      const turkish = describeSlotBlock(slotsWith('Planın en fazla 1 kendi ses kaydına izin veriyor.'), 'clone', 'free');
      expect(turkish.message).not.toContain('Planın');
      expect(turkish.message).toContain('(1/1)');
      // A localised sentence: shown as sent.
      const english = describeSlotBlock(slotsWith('Your plan allows 1 recorded voice.'), 'clone', 'free');
      expect(english.message).toBe('Your plan allows 1 recorded voice.');
    } finally {
      await i18n.changeLanguage('tr');
    }
  });
});

describe('VoiceProfileStore training tracker', () => {
  beforeEach(() => {
    mockGetMyVoiceProfiles.mockReset();
    mockGetVoiceProfileStatus.mockReset();
    mockGetVoiceSlots.mockReset();
    mockGetMyVoiceProfiles.mockResolvedValue([profile('p1', VoiceProfileStatus.PROCESSING)]);
    mockGetVoiceSlots.mockResolvedValue(
      parseVoiceSlotInfoFromJSON({ totalSlots: 4, usedSlots: 1, availableSlots: 3, canCreate: true }),
    );
  });

  const makeStore = async () => {
    const store = new VoiceProfileStore();
    await flush();
    return store;
  };

  it('auto-tracks PROCESSING profiles and resolves READY from the poll', async () => {
    mockGetVoiceProfileStatus.mockResolvedValue(statusResponse('p1', VoiceProfileStatus.PROCESSING));
    const store = await makeStore();
    expect(store.getTrackState('p1')?.phase).toBe('waiting');

    mockGetVoiceProfileStatus.mockResolvedValue(statusResponse('p1', VoiceProfileStatus.READY));
    jest.advanceTimersByTime(VOICE_CLONING.STATUS_POLL_INTERVAL_MS);
    await flush();

    expect(store.getTrackState('p1')?.phase).toBe('ready');
    expect(store.voiceProfiles[0].status).toBe(VoiceProfileStatus.READY);
    // Not observed by a screen, so the user is told.
    expect(showToast.success).toHaveBeenCalled();
    store.cleanup();
  });

  it('resolves FAILED from a socket event without waiting for the poll', async () => {
    mockGetVoiceProfileStatus.mockResolvedValue(statusResponse('p1', VoiceProfileStatus.PROCESSING));
    const store = await makeStore();
    store.setTrackingObserved('p1');

    store.applyRealtimeVoiceStatus({
      voiceProfileId: 'p1',
      status: VoiceProfileStatus.FAILED,
      errorMessage: 'Kayıt çok gürültülü.',
    });

    expect(store.getTrackState('p1')).toEqual({
      phase: 'failed',
      errorMessage: 'Kayıt çok gürültülü.',
    });
    expect(store.voiceProfiles[0].errorMessage).toBe('Kayıt çok gürültülü.');
    // The observing screen shows the result itself.
    expect(showToast.error).not.toHaveBeenCalled();

    // No further polling once resolved.
    mockGetVoiceProfileStatus.mockClear();
    jest.advanceTimersByTime(VOICE_CLONING.STATUS_POLL_INTERVAL_MS * 3);
    await flush();
    expect(mockGetVoiceProfileStatus).not.toHaveBeenCalled();
    store.cleanup();
  });

  it('gives up after the 20 minute cap', async () => {
    mockGetVoiceProfileStatus.mockResolvedValue(statusResponse('p1', VoiceProfileStatus.PROCESSING));
    const store = await makeStore();
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now + VOICE_CLONING.STATUS_TRACK_TIMEOUT_MS + 1);

    jest.advanceTimersByTime(VOICE_CLONING.STATUS_POLL_INTERVAL_MS);
    await flush();

    expect(store.getTrackState('p1')?.phase).toBe('timeout');
    spy.mockRestore();
    store.cleanup();
  });

  it('marks a vanished profile (404) as failed', async () => {
    mockGetVoiceProfileStatus.mockRejectedValue(apiErrorFromResponse(404, { message: 'Yok' }));
    const store = await makeStore();
    await flush();
    expect(store.getTrackState('p1')?.phase).toBe('failed');
    store.cleanup();
  });

  it('keeps polling through transient errors', async () => {
    mockGetVoiceProfileStatus.mockRejectedValue(apiErrorFromResponse(undefined, null));
    const store = await makeStore();
    jest.advanceTimersByTime(VOICE_CLONING.STATUS_POLL_INTERVAL_MS);
    await flush();
    expect(store.getTrackState('p1')?.phase).toBe('waiting');
    store.cleanup();
  });

  it('does not poll PENDING profiles that never got a sample', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([profile('p2', VoiceProfileStatus.PENDING)]);
    const store = await makeStore();
    expect(store.getTrackState('p2')).toBeNull();
    expect(mockGetVoiceProfileStatus).not.toHaveBeenCalled();
    store.cleanup();
  });
});

// ============================================================================
// Shared fixtures for the blocks below
// ============================================================================

const { PENDING, PROCESSING, READY, FAILED } = VoiceProfileStatus;
const DEFAULT_FAILED_TEXT =
  'Sesin hazırlanırken bir sorun oluştu. Lütfen yeniden kaydetmeyi dene.';

/** Enough microtask turns for a two-id poll tick plus MobX reactions. */
const settle = async () => {
  for (let i = 0; i < 25; i++) {
    await Promise.resolve();
  }
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

/** GET /voice-profiles/slots as built by backend buildVoiceSlotInfo (FREE plan). */
const FREE_SLOTS_JSON = {
  plan: 'FREE',
  totalSlots: 4,
  usedSlots: 1,
  availableSlots: 3,
  extraSlots: 0,
  canCreate: true,
  preset: { used: 1, limit: 3, canCreate: true },
  clone: {
    used: 0,
    limit: 1,
    canCreate: true,
    monthlyCreated: 0,
    monthlyLimit: 1,
    creations: { used: 0, limit: 1, period: 'lifetime', renewsAt: null, canCreate: true },
  },
};

/** GET /voice-profiles/clone-config (backend clone-config.constants.ts). */
const CLONE_CONFIG_JSON = {
  enabled: true,
  provider: 'CARTESIA',
  language: 'tr',
  minSeconds: 15,
  targetSeconds: 30,
  maxSeconds: 60,
  scriptTitle: 'Yıldızlı Bir Gece',
  script: 'Akşam olunca köyün üstüne yumuşak bir sessizlik çöker.',
  consentVersion: '2026-09-v1',
  consentTitle: 'Sesin için açık rıza',
  consentText: 'Ses kaydın yalnızca masallarını seslendirmek için kullanılır.',
};

const presetProfile = (id: string): VoiceProfile => ({
  ...profile(id, READY),
  name: 'Anlatıcı',
  provider: TTSProvider.GOOGLE,
  voiceId: 'tr-TR-Chirp3-HD-Achernar',
  kind: 'PRESET',
});

const resetServiceMocks = () => {
  jest.clearAllTimers();
  mockGetMyVoiceProfiles.mockReset().mockResolvedValue([]);
  mockGetVoiceProfileStatus
    .mockReset()
    .mockImplementation((id: string) => Promise.resolve(statusResponse(id, PROCESSING)));
  mockGetVoiceSlots.mockReset().mockResolvedValue(parseVoiceSlotInfoFromJSON(FREE_SLOTS_JSON));
  mockGetAvailableVoices.mockReset();
  mockGetCloneConfig.mockReset();
  mockCreateVoiceProfile.mockReset();
  mockDeleteVoiceProfile.mockReset();
  mockGetVoiceSample.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
};

const liveStores: VoiceProfileStore[] = [];
const createStore = async () => {
  const store = new VoiceProfileStore();
  liveStores.push(store);
  await settle();
  return store;
};
const cleanupStores = () => {
  liveStores.splice(0).forEach(s => s.cleanup());
};

// ============================================================================
// Training tracker lifecycle
// ============================================================================

describe('VoiceProfileStore tracker lifecycle', () => {
  beforeEach(resetServiceMocks);
  afterEach(cleanupStores);

  it('runs a single 5 s poll no matter how often tracking is started', async () => {
    const store = await createStore();
    expect(jest.getTimerCount()).toBe(0);

    store.trackVoiceProfile('p1');
    store.trackVoiceProfile('p1');
    store.trackVoiceProfile('p2');
    expect(jest.getTimerCount()).toBe(1);
    await settle();

    mockGetVoiceProfileStatus.mockClear();
    jest.advanceTimersByTime(VOICE_CLONING.STATUS_POLL_INTERVAL_MS - 1);
    await settle();
    expect(mockGetVoiceProfileStatus).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await settle();
    expect(mockGetVoiceProfileStatus.mock.calls.map(c => c[0])).toEqual(['p1', 'p2']);
    expect(store.getTrackState('p1')?.phase).toBe('waiting');
    expect(store.getTrackState('p2')?.phase).toBe('waiting');
  });

  it('skips interval ticks while the previous status request is still pending', async () => {
    mockGetVoiceProfileStatus.mockReturnValue(new Promise(() => undefined));
    const store = await createStore();

    store.trackVoiceProfile('p1');
    jest.advanceTimersByTime(VOICE_CLONING.STATUS_POLL_INTERVAL_MS * 3);
    await settle();

    expect(mockGetVoiceProfileStatus).toHaveBeenCalledTimes(1);
  });

  it('READY from the socket stops the poll, patches list + current profile, refreshes slots', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([
      { ...profile('p1', PROCESSING), errorMessage: 'Önceki deneme başarısız oldu.' },
    ]);
    const store = await createStore();
    store.setCurrentProfile(store.voiceProfiles[0]);
    expect(store.getTrackState('p1')?.phase).toBe('waiting');
    expect(jest.getTimerCount()).toBe(1);
    mockGetVoiceSlots.mockClear();

    store.applyRealtimeVoiceStatus({ voiceProfileId: 'p1', status: READY, errorMessage: null });

    expect(store.getTrackState('p1')).toEqual({ phase: 'ready', errorMessage: null });
    expect(store.voiceProfiles[0].status).toBe(READY);
    expect(store.voiceProfiles[0].errorMessage).toBeNull();
    expect(store.currentProfile?.status).toBe(READY);
    expect(store.readyProfiles.map(p => p.id)).toEqual(['p1']);
    expect(jest.getTimerCount()).toBe(0);
    expect(mockGetVoiceSlots).toHaveBeenCalledTimes(1);
    expect(showToast.success).toHaveBeenCalledWith(
      'Artık masalları kendi sesinle dinleyebilirsin.',
      'Sesin hazır',
    );

    mockGetVoiceProfileStatus.mockClear();
    jest.advanceTimersByTime(VOICE_CLONING.STATUS_POLL_INTERVAL_MS * 2);
    await settle();
    expect(mockGetVoiceProfileStatus).not.toHaveBeenCalled();
  });

  it('FAILED from the poll without a message surfaces the default text', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([profile('p1', PROCESSING)]);
    mockGetVoiceProfileStatus.mockResolvedValue(statusResponse('p1', FAILED, null));

    const store = await createStore();
    await settle();

    expect(store.getTrackState('p1')).toEqual({ phase: 'failed', errorMessage: DEFAULT_FAILED_TEXT });
    expect(store.voiceProfiles[0].status).toBe(FAILED);
    expect(showToast.error).toHaveBeenCalledWith(DEFAULT_FAILED_TEXT, 'Ses hazırlanamadı');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('FAILED from the poll with a backend message stores it on the profile', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([profile('p1', PROCESSING)]);
    const store = await createStore();

    mockGetVoiceProfileStatus.mockResolvedValue(
      statusResponse('p1', FAILED, 'Kayıtta yeterli konuşma bulunamadı.'),
    );
    jest.advanceTimersByTime(VOICE_CLONING.STATUS_POLL_INTERVAL_MS);
    await settle();

    expect(store.getTrackState('p1')?.errorMessage).toBe('Kayıtta yeterli konuşma bulunamadı.');
    expect(store.voiceProfiles[0].errorMessage).toBe('Kayıtta yeterli konuşma bulunamadı.');
  });

  it('takes the voice language a status answer names, and keeps its own without one', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([profile('p1', PROCESSING), profile('p2', PROCESSING)]);
    mockGetVoiceProfileStatus.mockImplementation((id: string) =>
      Promise.resolve({
        ...statusResponse(id, READY, null),
        contentLanguage: id === 'p1' ? 'en' : null,
      }),
    );

    const store = await createStore();
    await settle();

    expect(store.voiceProfiles.map(p => p.contentLanguage)).toEqual(['en', 'tr']);
  });

  it('ignores a poll answer that lands after the socket already resolved the profile', async () => {
    const pending = deferred<ReturnType<typeof statusResponse>>();
    mockGetVoiceProfileStatus.mockReturnValue(pending.promise);
    mockGetMyVoiceProfiles.mockResolvedValue([profile('p1', PROCESSING)]);
    const store = await createStore();
    store.setTrackingObserved('p1');

    store.applyRealtimeVoiceStatus({ voiceProfileId: 'p1', status: READY, errorMessage: null });
    pending.resolve(statusResponse('p1', PROCESSING));
    await settle();

    expect(store.getTrackState('p1')?.phase).toBe('ready');
    expect(store.voiceProfiles[0].status).toBe(READY);
    // The observing screen shows the result itself.
    expect(showToast.success).not.toHaveBeenCalled();
  });

  it('starts tracking when the socket reports PROCESSING for an untracked profile', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([profile('p1', PENDING)]);
    const store = await createStore();
    expect(store.getTrackState('p1')).toBeNull();
    expect(jest.getTimerCount()).toBe(0);

    store.applyRealtimeVoiceStatus({ voiceProfileId: 'p1', status: PROCESSING, errorMessage: null });

    expect(store.getTrackState('p1')?.phase).toBe('waiting');
    expect(store.voiceProfiles[0].status).toBe(PROCESSING);
    expect(jest.getTimerCount()).toBe(1);
    expect(mockGetVoiceProfileStatus).toHaveBeenCalledWith('p1');
  });

  it('a final socket status for an untracked profile only refreshes the slots', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([profile('p1', READY)]);
    const store = await createStore();
    mockGetVoiceSlots.mockClear();
    mockGetMyVoiceProfiles.mockClear();

    store.applyRealtimeVoiceStatus({
      voiceProfileId: 'p1',
      status: FAILED,
      errorMessage: 'Kayıt çok kısa.',
    });

    expect(store.getTrackState('p1')).toBeNull();
    expect(store.voiceProfiles[0].errorMessage).toBe('Kayıt çok kısa.');
    expect(mockGetVoiceSlots).toHaveBeenCalledTimes(1);
    expect(mockGetMyVoiceProfiles).not.toHaveBeenCalled();
    expect(showToast.error).not.toHaveBeenCalled();
  });

  it('reloads the list when the socket mentions a profile it does not know', async () => {
    const store = await createStore();
    mockGetMyVoiceProfiles.mockClear();

    store.applyRealtimeVoiceStatus({ voiceProfileId: 'p-new', status: READY, errorMessage: null });

    expect(mockGetMyVoiceProfiles).toHaveBeenCalledTimes(1);
  });

  it('ignores legacy socket events without a profile id', async () => {
    const store = await createStore();
    mockGetMyVoiceProfiles.mockClear();
    mockGetVoiceSlots.mockClear();

    store.applyRealtimeVoiceStatus({ voiceProfileId: null, status: FAILED, errorMessage: 'x' });

    expect(mockGetMyVoiceProfiles).not.toHaveBeenCalled();
    expect(mockGetVoiceSlots).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps the original start time when tracking is started again (20 min cap)', async () => {
    const store = await createStore();
    const t0 = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    store.trackVoiceProfile('p1');
    await settle();

    now.mockReturnValue(t0 + VOICE_CLONING.STATUS_TRACK_TIMEOUT_MS - 1000);
    store.trackVoiceProfile('p1');
    await settle();
    expect(store.getTrackState('p1')?.phase).toBe('waiting');

    mockGetVoiceSlots.mockClear();
    now.mockReturnValue(t0 + VOICE_CLONING.STATUS_TRACK_TIMEOUT_MS);
    jest.advanceTimersByTime(VOICE_CLONING.STATUS_POLL_INTERVAL_MS);
    await settle();

    expect(store.getTrackState('p1')).toEqual({ phase: 'timeout', errorMessage: null });
    expect(jest.getTimerCount()).toBe(0);
    // A timeout is silent and does not touch the slots.
    expect(showToast.success).not.toHaveBeenCalled();
    expect(showToast.error).not.toHaveBeenCalled();
    expect(mockGetVoiceSlots).not.toHaveBeenCalled();
  });

  it('restartTracking opens a fresh 20 minute window', async () => {
    const store = await createStore();
    const t0 = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    store.trackVoiceProfile('p1');
    await settle();

    now.mockReturnValue(t0 + VOICE_CLONING.STATUS_TRACK_TIMEOUT_MS - 1000);
    store.restartTracking('p1');
    await settle();

    now.mockReturnValue(t0 + VOICE_CLONING.STATUS_TRACK_TIMEOUT_MS + 1);
    mockGetVoiceProfileStatus.mockClear();
    jest.advanceTimersByTime(VOICE_CLONING.STATUS_POLL_INTERVAL_MS);
    await settle();
    expect(store.getTrackState('p1')?.phase).toBe('waiting');
    expect(mockGetVoiceProfileStatus).toHaveBeenCalledWith('p1');

    now.mockReturnValue(t0 + 2 * VOICE_CLONING.STATUS_TRACK_TIMEOUT_MS);
    jest.advanceTimersByTime(VOICE_CLONING.STATUS_POLL_INTERVAL_MS);
    await settle();
    expect(store.getTrackState('p1')?.phase).toBe('timeout');
  });

  it('stopTracking forgets the profile and stops the poll', async () => {
    const store = await createStore();
    store.trackVoiceProfile('p1');
    await settle();

    store.stopTracking('p1');

    expect(store.getTrackState('p1')).toBeNull();
    expect(store.getTrackState(null)).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    mockGetVoiceProfileStatus.mockClear();
    jest.advanceTimersByTime(VOICE_CLONING.STATUS_POLL_INTERVAL_MS * 2);
    await settle();
    expect(mockGetVoiceProfileStatus).not.toHaveBeenCalled();
  });

  it('keeps the poll alive until every tracked profile is resolved', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([
      profile('p1', PROCESSING),
      profile('p2', PROCESSING),
    ]);
    const store = await createStore();
    expect(jest.getTimerCount()).toBe(1);

    store.applyRealtimeVoiceStatus({ voiceProfileId: 'p1', status: READY, errorMessage: null });
    expect(jest.getTimerCount()).toBe(1);

    store.applyRealtimeVoiceStatus({ voiceProfileId: 'p2', status: READY, errorMessage: null });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cleanup tears the poll loop down', async () => {
    const store = await createStore();
    store.trackVoiceProfile('p1');
    store.trackVoiceProfile('p2');
    await settle();

    store.cleanup();

    expect(jest.getTimerCount()).toBe(0);
    mockGetVoiceProfileStatus.mockClear();
    jest.advanceTimersByTime(VOICE_CLONING.STATUS_POLL_INTERVAL_MS * 2);
    await settle();
    expect(mockGetVoiceProfileStatus).not.toHaveBeenCalled();
  });

  it('a list reload resolves a tracked profile the list already shows as final', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([profile('p1', PROCESSING)]);
    const store = await createStore();
    expect(store.getTrackState('p1')?.phase).toBe('waiting');

    mockGetMyVoiceProfiles.mockResolvedValue([
      { ...profile('p1', FAILED), errorMessage: 'Ses modeli oluşturulamadı.' },
    ]);
    await store.refresh();

    expect(store.getTrackState('p1')).toEqual({
      phase: 'failed',
      errorMessage: 'Ses modeli oluşturulamadı.',
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a 404 for a profile missing from the list fails it and reloads the list', async () => {
    mockGetVoiceProfileStatus.mockRejectedValue(apiErrorFromResponse(404, { message: 'Yok' }));
    const store = await createStore();
    mockGetMyVoiceProfiles.mockClear();

    store.trackVoiceProfile('p9');
    await settle();

    expect(store.getTrackState('p9')).toEqual({
      phase: 'failed',
      errorMessage: 'Ses profili bulunamadı. Lütfen yeniden kaydetmeyi dene.',
    });
    expect(mockGetMyVoiceProfiles).toHaveBeenCalledTimes(1);
  });

  it('ignores an empty profile id', async () => {
    const store = await createStore();
    store.trackVoiceProfile('');
    expect(jest.getTimerCount()).toBe(0);
    expect(mockGetVoiceProfileStatus).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Hook singleton + legacy socket fallback
// ============================================================================

describe('useVoiceProfile singleton wiring', () => {
  beforeEach(resetServiceMocks);

  it('registers the store as voice_status listener and the fallback reloads the list', async () => {
    const ws = WebSocketService as unknown as {
      addVoiceStatusListener: jest.Mock;
      setVoiceStatusFallback: jest.Mock;
    };
    expect(getVoiceProfileStore()).toBeNull();

    const first = renderHook(() => useVoiceProfile());
    const second = renderHook(() => useVoiceProfile());
    const store = first.result.current;
    await settle();

    expect(second.result.current).toBe(store);
    expect(getVoiceProfileStore()).toBe(store);
    expect(ws.addVoiceStatusListener).toHaveBeenCalledTimes(1);
    expect(ws.addVoiceStatusListener).toHaveBeenCalledWith(store);
    expect(ws.setVoiceStatusFallback).toHaveBeenCalledTimes(1);

    // Legacy FAILED payloads without an id trigger the fallback reload.
    const fallback = ws.setVoiceStatusFallback.mock.calls[0][0] as () => void;
    mockGetMyVoiceProfiles.mockClear();
    fallback();
    await settle();
    expect(mockGetMyVoiceProfiles).toHaveBeenCalledTimes(1);
    store.cleanup();
  });

  it('sign-out resets the shared store through the session end handlers', async () => {
    const store = renderHook(() => useVoiceProfile()).result.current;
    mockGetMyVoiceProfiles.mockResolvedValueOnce([presetProfile('g1')]);
    await store.loadVoiceProfiles();
    expect(store.voiceProfiles.map(p => p.id)).toEqual(['g1']);
    expect(store.hasLoadedProfiles).toBe(true);

    await runSessionEndHandlers();

    expect(getVoiceProfileStore()).toBe(store);
    expect(store.voiceProfiles).toEqual([]);
    expect(store.hasLoadedProfiles).toBe(false);
    store.cleanup();
  });
});

// ============================================================================
// Slot gating
// ============================================================================

describe('VoiceProfileStore slot gating', () => {
  beforeEach(resetServiceMocks);
  afterEach(cleanupStores);

  it('derives canCreatePreset / canCreateClone from the per-kind flags', async () => {
    mockGetVoiceSlots.mockResolvedValue(
      parseVoiceSlotInfoFromJSON({
        ...FREE_SLOTS_JSON,
        usedSlots: 2,
        availableSlots: 2,
        preset: { used: 1, limit: 3, canCreate: true },
        clone: { used: 1, limit: 1, canCreate: false, monthlyCreated: 1, monthlyLimit: 2 },
      }),
    );
    const store = await createStore();

    await store.loadVoiceSlots();

    expect(store.isLoadingSlots).toBe(false);
    expect(store.canCreatePreset).toBe(true);
    expect(store.canCreateClone).toBe(false);
    const block = store.slotBlock('clone', 'free');
    expect(block.title).toBe('Kendi ses hakkın doldu');
    expect(block.message).toContain('(1/1)');
    expect(block.showPaywall).toBe(true);
    expect(store.slotBlock('clone', 'premium').showPaywall).toBe(false);
  });

  it('the monthly clone cap blocks cloning even with a free clone slot', async () => {
    mockGetVoiceSlots.mockResolvedValue(
      parseVoiceSlotInfoFromJSON({
        plan: 'PRO',
        totalSlots: 13,
        usedSlots: 1,
        availableSlots: 12,
        extraSlots: 0,
        canCreate: true,
        preset: { used: 0, limit: 10, canCreate: true },
        // Client-side cap check even if a stale flag still says canCreate.
        clone: { used: 1, limit: 3, canCreate: true, monthlyCreated: 5, monthlyLimit: 5 },
      }),
    );
    const store = await createStore();

    await store.loadVoiceSlots();

    expect(store.canCreateClone).toBe(false);
    expect(store.canCreatePreset).toBe(true);
    const block = store.slotBlock('clone', 'premium');
    expect(block.title).toBe('Bu ayki yeni ses hakkın doldu');
    expect(block.message).toContain('ayda 5 yeni ses');
    expect(block.showPaywall).toBe(false);
  });

  it('older backends without the preset/clone split use the shared canCreate', async () => {
    mockGetVoiceSlots.mockResolvedValue(
      parseVoiceSlotInfoFromJSON({ totalSlots: 2, usedSlots: 2, availableSlots: 0, canCreate: false }),
    );
    const store = await createStore();

    await store.loadVoiceSlots();

    expect(store.canCreateClone).toBe(false);
    expect(store.canCreatePreset).toBe(false);
    expect(store.slotBlock('preset', 'free').message).toContain('(2/2)');
  });

  it('lets the attempt through while the slots are unknown', async () => {
    const store = await createStore();
    expect(store.voiceSlotInfo).toBeNull();
    expect(store.canCreateClone).toBe(true);
    expect(store.canCreatePreset).toBe(true);
  });

  it('checkCanCreate refetches the slots right before the action', async () => {
    const store = await createStore();
    mockGetVoiceSlots.mockResolvedValueOnce(parseVoiceSlotInfoFromJSON(FREE_SLOTS_JSON));
    expect(await store.checkCanCreate('clone')).toBe(true);

    mockGetVoiceSlots.mockResolvedValueOnce(
      parseVoiceSlotInfoFromJSON({
        ...FREE_SLOTS_JSON,
        preset: { used: 3, limit: 3, canCreate: false },
        clone: { used: 1, limit: 1, canCreate: false, monthlyCreated: 1, monthlyLimit: 2 },
      }),
    );
    expect(await store.checkCanCreate('preset')).toBe(false);
    expect(store.canCreateClone).toBe(false);
    expect(mockGetVoiceSlots).toHaveBeenCalledTimes(2);
  });

  it('a failed slots load keeps the previous snapshot', async () => {
    const store = await createStore();
    await store.loadVoiceSlots();
    const snapshot = store.voiceSlotInfo;
    expect(snapshot).not.toBeNull();

    mockGetVoiceSlots.mockRejectedValue(apiErrorFromResponse(undefined, null));
    expect(await store.checkCanCreate('clone')).toBe(true);

    expect(store.voiceSlotInfo).toBe(snapshot);
    expect(store.isLoadingSlots).toBe(false);
  });

  it('a failed first slots load leaves the gate open (the backend still enforces)', async () => {
    mockGetVoiceSlots.mockRejectedValue(apiErrorFromResponse(500, {}));
    const store = await createStore();

    expect(await store.checkCanCreate('clone')).toBe(true);
    expect(await store.checkCanCreate('preset')).toBe(true);
    expect(store.voiceSlotInfo).toBeNull();
  });
});

describe('VoiceProfileStore optimistic ready-made places (VR-03, VR-04)', () => {
  beforeEach(resetServiceMocks);
  afterEach(cleanupStores);

  function deferredOf<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  const kore = {
    name: 'Kore',
    provider: TTSProvider.GOOGLE,
    voiceId: 'tr-TR-Chirp3-HD-Kore',
    language: 'tr-TR',
  };
  const koreProfile = (): VoiceProfile => ({ ...presetProfile('vp-kore'), name: 'Kore', voiceId: kore.voiceId });

  async function loadedStore(slots: Record<string, unknown> = FREE_SLOTS_JSON) {
    mockGetMyVoiceProfiles.mockResolvedValue([presetProfile('vp-1')]);
    mockGetVoiceSlots.mockResolvedValue(parseVoiceSlotInfoFromJSON(slots));
    const store = await createStore();
    await store.loadVoiceSlots();
    return store;
  }

  it('an add is marked and counted in the tap, before the backend answers', async () => {
    const store = await loadedStore();
    expect(store.presetSlots?.used).toBe(1);
    expect(store.canAddPresetNow).toBe(true);
    const answer = deferredOf<VoiceProfile>();
    mockCreateVoiceProfile.mockReturnValueOnce(answer.promise);

    const pending = store.createVoiceProfile(kore);
    // Synchronously: the row says "Eklendi" and the count moved.
    expect(store.isAddingPreset(kore.voiceId)).toBe(true);
    expect(store.presetSlots?.used).toBe(2);
    expect(store.presetSlots?.canCreate).toBe(true);
    // The snapshot itself is the backend's, untouched.
    expect(store.voiceSlotInfo?.preset?.used).toBe(1);

    // The backend answers: the real row replaces the mark, the count stays.
    let usedWhenListed: number | undefined;
    mockGetVoiceSlots.mockImplementationOnce(() => {
      usedWhenListed = store.presetSlots?.used;
      return Promise.resolve(
        parseVoiceSlotInfoFromJSON({ ...FREE_SLOTS_JSON, preset: { used: 2, limit: 3, canCreate: true } }),
      );
    });
    answer.resolve(koreProfile());
    await pending;
    expect(store.isAddingPreset(kore.voiceId)).toBe(false);
    expect(store.voiceProfiles.map(p => p.id)).toEqual(['vp-1', 'vp-kore']);
    expect(usedWhenListed).toBe(2);
    await settle();
    // The fresh answer counts it itself: still 2, not 3.
    expect(store.voiceSlotInfo?.preset?.used).toBe(2);
    expect(store.presetSlots?.used).toBe(2);
  });

  it('the last free place: a second add is held back while the first is on its way', async () => {
    const store = await loadedStore({ ...FREE_SLOTS_JSON, preset: { used: 2, limit: 3, canCreate: true } });
    mockCreateVoiceProfile.mockReturnValueOnce(new Promise(() => undefined));

    void store.createVoiceProfile(kore);

    expect(store.presetSlots).toMatchObject({ used: 3, limit: 3, canCreate: false });
    expect(store.canCreatePreset).toBe(false);
    expect(store.canAddPresetNow).toBe(false);
    expect(store.slotBlock('preset', 'free').message).toContain('(3/3)');
  });

  it('a refused add rolls the mark and the count back', async () => {
    const store = await loadedStore();
    const answer = deferredOf<VoiceProfile>();
    mockCreateVoiceProfile.mockReturnValueOnce(answer.promise);

    const pending = store.createVoiceProfile(kore);
    expect(store.presetSlots?.used).toBe(2);
    answer.reject(apiErrorFromResponse(403, { statusCode: 403, code: 'PRESET_SLOT_LIMIT', limit: 3 }));
    const result = await pending;

    expect(result.profile).toBeNull();
    expect(store.isAddingPreset(kore.voiceId)).toBe(false);
    expect(store.presetSlots?.used).toBe(1);
    expect(store.voiceProfiles.map(p => p.id)).toEqual(['vp-1']);
  });

  it('a removal drops the count in the confirm, and puts it back when the delete fails', async () => {
    const store = await loadedStore();
    const answer = deferredOf<void>();
    mockDeleteVoiceProfile.mockReturnValueOnce(answer.promise);

    const pending = store.deleteVoiceProfile('vp-1');
    expect(store.presetSlots?.used).toBe(0);

    answer.reject(apiErrorFromResponse(500, {}));
    expect(await pending).toBe(false);
    expect(store.presetSlots?.used).toBe(1);
    expect(store.voiceProfiles.map(p => p.id)).toEqual(['vp-1']);
  });

  it('a removal that went through stays counted until the next slot answer', async () => {
    const store = await loadedStore();
    mockDeleteVoiceProfile.mockResolvedValueOnce(undefined);
    // The refresh after the delete has not answered yet.
    const refresh = deferredOf<ReturnType<typeof parseVoiceSlotInfoFromJSON>>();
    mockGetVoiceSlots.mockReturnValueOnce(refresh.promise);

    const pending = store.deleteVoiceProfile('vp-1');
    expect(store.presetSlots?.used).toBe(0);
    expect(await pending).toBe(true);
    expect(store.voiceProfiles).toEqual([]);
    expect(store.presetSlots?.used).toBe(0);

    refresh.resolve(
      parseVoiceSlotInfoFromJSON({ ...FREE_SLOTS_JSON, preset: { used: 0, limit: 3, canCreate: true } }),
    );
    await settle();
    expect(store.presetSlots?.used).toBe(0);
    expect(store.voiceSlotInfo?.preset?.used).toBe(0);
  });

  it('an own voice changes nothing in the ready-made count', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([presetProfile('vp-1'), profile('vp-own', READY)]);
    const store = await createStore();
    await store.loadVoiceSlots();
    mockDeleteVoiceProfile.mockReturnValueOnce(new Promise(() => undefined));

    void store.deleteVoiceProfile('vp-own');

    expect(store.presetSlots?.used).toBe(1);
  });

  it('without known slots or before the list loaded, nothing is added without asking', async () => {
    mockGetVoiceSlots.mockRejectedValue(apiErrorFromResponse(500, {}));
    const store = await createStore();
    expect(store.voiceSlotInfo).toBeNull();
    expect(store.presetSlots).toBeNull();
    expect(store.canAddPresetNow).toBe(false);
  });

  it('sign-out forgets the marks and the changes', async () => {
    const store = await loadedStore();
    mockCreateVoiceProfile.mockReturnValueOnce(new Promise(() => undefined));
    void store.createVoiceProfile(kore);

    store.reset();

    expect(store.isAddingPreset(kore.voiceId)).toBe(false);
    expect(store.presetChanges).toEqual([]);
    expect(store.presetSlots).toBeNull();
  });
});

describe('describeSlotBlock copy variants', () => {
  const full = parseVoiceSlotInfoFromJSON({
    ...FREE_SLOTS_JSON,
    preset: { used: 3, limit: 3, canCreate: false },
    clone: { used: 1, limit: 1, canCreate: false, monthlyCreated: 1, monthlyLimit: 2 },
  });

  it('preset: Premium and Mini are told to remove one, Free gets the plans', () => {
    const pro = describeSlotBlock(full, 'preset', 'premium');
    expect(pro.title).toBe('Hazır ses hakkın doldu');
    // A narrator row's action is 'Kaldır': the copy says remove, never delete.
    expect(pro.message).toContain('mevcut hazır seslerinden birini kaldırabilirsin');
    expect(pro.message).not.toContain('silebilir');
    expect(pro.showPaywall).toBe(false);

    // Mini has as many narrator places as Premium: no plan would help.
    expect(describeSlotBlock(full, 'preset', 'mini')).toEqual(pro);

    const free = describeSlotBlock(full, 'preset', 'free');
    expect(free.message).toContain('Birini kaldırabilir');
    expect(free.message).toContain('Mini veya Premium');
    expect(free.showPaywall).toBe(true);
  });

  it('clone: Premium deletes, Mini deletes or upgrades, Free only upgrades', () => {
    const premium = describeSlotBlock(full, 'clone', 'premium');
    expect(premium.message).toContain('mevcut seslerinden birini silebilirsin');
    expect(premium.showPaywall).toBe(false);

    const mini = describeSlotBlock(full, 'clone', 'mini');
    expect(mini.message).toBe(
      'Kendi ses hakkının tamamını kullandın (1/1). Yeni bir kayıt için mevcut sesini silebilir ya da Premium planla daha fazla kendi ses ekleyebilirsin.',
    );
    expect(mini.showPaywall).toBe(true);

    const free = describeSlotBlock(full, 'clone', 'free');
    // The free-plan copy only on Free; a delete never gives its voice back.
    expect(free.message).toContain('Premium planla daha fazla kendi ses');
    expect(free.message).not.toContain('silebilir');
    expect(free.showPaywall).toBe(true);
    expect(free.message).not.toBe(mini.message);
  });

  it('a used-up lifetime allowance (Free) never mentions a new month', () => {
    const lifetime = parseVoiceSlotInfoFromJSON({
      ...FREE_SLOTS_JSON,
      clone: {
        used: 0,
        limit: 1,
        canCreate: false,
        monthlyCreated: 1,
        monthlyLimit: 1,
        creations: { used: 1, limit: 1, period: 'lifetime', renewsAt: null, canCreate: false },
      },
    });
    const block = describeSlotBlock(lifetime, 'clone', 'free');
    expect(block.title).toBe('Kendi ses hakkını kullandın');
    expect(block.message).toBe(
      'Ücretsiz planda kendi sesini bir kez kaydedebilirsin. Bu hak yenilenmez, sesi silmek de yeni hak vermez. Yeni bir ses için Mini ya da Premium plana geçebilirsin.',
    );
    expect(block.message).not.toMatch(/yeni ay|ayki|month/i);
    expect(block.showPaywall).toBe(true);
  });

  it('a used-up monthly allowance names its renewal date; Mini is offered Premium', () => {
    const mini = parseVoiceSlotInfoFromJSON({
      ...FREE_SLOTS_JSON,
      plan: 'MINI',
      clone: {
        used: 0,
        limit: 1,
        canCreate: false,
        creations: {
          used: 2,
          limit: 2,
          period: 'month',
          renewsAt: '2026-11-01T12:00:00.000Z',
          canCreate: false,
        },
      },
    });
    const block = describeSlotBlock(mini, 'clone', 'mini');
    expect(block.title).toBe('Bu ayki yeni ses hakkın doldu');
    expect(block.message).toBe(
      "Planında ayda 2 yeni ses kaydı var. 1 Kasım'da yenilenir. Premium planda daha fazlası var.",
    );
    expect(block.showPaywall).toBe(true);
    expect(describeSlotBlock(mini, 'clone', 'premium').showPaywall).toBe(false);
  });

  it('the English UI never shows the backend sentence', async () => {
    await i18n.changeLanguage('en');
    const info = parseVoiceSlotInfoFromJSON({
      ...FREE_SLOTS_JSON,
      clone: { used: 1, limit: 1, canCreate: false, message: 'Kendi ses hakkın doldu.' },
    });
    const block = describeSlotBlock(info, 'clone', 'free');
    expect(block.title).toBe('You have used your own voices');
    expect(block.message).not.toContain('Kendi ses');
  });

  it('uses the backend preset message when present', () => {
    const info = parseVoiceSlotInfoFromJSON({
      ...FREE_SLOTS_JSON,
      preset: { used: 3, limit: 3, canCreate: false, message: 'En fazla 3 hazır ses ekleyebilirsin.' },
    });
    expect(describeSlotBlock(info, 'preset', 'free').message).toBe(
      'En fazla 3 hazır ses ekleyebilirsin.',
    );
  });

  it('falls back to the shared counters and message on older backends', () => {
    const legacy = parseVoiceSlotInfoFromJSON({
      totalSlots: 2,
      usedSlots: 2,
      availableSlots: 0,
      canCreate: false,
      message: 'Ses profili limitine ulaştın.',
    });
    expect(describeSlotBlock(legacy, 'clone', 'free').message).toBe('Ses profili limitine ulaştın.');
    expect(describeSlotBlock(legacy, 'preset', 'premium').message).toBe('Ses profili limitine ulaştın.');
  });

  it('omits the usage suffix when nothing is known about the limit', () => {
    const block = describeSlotBlock(null, 'clone', 'free');
    expect(block.message).not.toContain('(');
    expect(block.showPaywall).toBe(true);
    expect(describeSlotBlock(null, 'preset', 'free').message).not.toContain('(');
  });

  it('a used-up allowance is explained by the app copy, not the backend text', () => {
    const info = parseVoiceSlotInfoFromJSON({
      canCreate: true,
      clone: {
        used: 0,
        limit: 1,
        canCreate: false,
        monthlyCreated: 2,
        monthlyLimit: 2,
        message: 'Bu ay en fazla 2 ses oluşturabilirsin.',
      },
    });
    const block = describeSlotBlock(info, 'clone', 'mini');
    expect(block.title).toBe('Bu ayki yeni ses hakkın doldu');
    expect(block.message).toBe('Planında ayda 2 yeni ses kaydı var. Premium planda daha fazlası var.');
  });
});

// ============================================================================
// Profile CRUD, catalogue and clone config
// ============================================================================

describe('VoiceProfileStore profiles, catalogue and clone config', () => {
  beforeEach(resetServiceMocks);
  afterEach(cleanupStores);

  it('a failed list load sets the error and toasts', async () => {
    mockGetMyVoiceProfiles.mockRejectedValue(apiErrorFromResponse(500, {}));
    const store = await createStore();

    expect(store.errorMessage).toBe('Ses profilleri yüklenemedi');
    expect(showToast.error).toHaveBeenCalledWith('Ses profilleri yüklenemedi');
    expect(store.isLoading).toBe(false);
  });

  it('a reload refreshes the current profile or drops it when it is gone', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([presetProfile('g1'), presetProfile('g2')]);
    const store = await createStore();
    store.setCurrentProfile(store.voiceProfiles[0]);

    mockGetMyVoiceProfiles.mockResolvedValue([{ ...presetProfile('g1'), name: 'Masalcı' }]);
    await store.loadVoiceProfiles();
    expect(store.currentProfile?.name).toBe('Masalcı');

    mockGetMyVoiceProfiles.mockResolvedValue([presetProfile('g2')]);
    await store.loadVoiceProfiles();
    expect(store.currentProfile).toBeNull();
  });

  it('setCurrentProfile / clearCurrentProfile', async () => {
    const store = await createStore();
    store.setCurrentProfile(presetProfile('g1'));
    expect(store.currentProfile?.id).toBe('g1');
    store.clearCurrentProfile();
    expect(store.currentProfile).toBeNull();
  });

  const catalogueVoice = (name: string, locale: string) => ({
    id: `${locale}-Chirp3-HD-${name}`,
    voiceId: `${locale}-Chirp3-HD-${name}`,
    name,
    language: locale === 'tr-TR' ? 'Turkish' : 'English',
    languageCode: locale,
    contentLanguage: locale.slice(0, 2),
    gender: 'female',
    description: '',
    provider: 'GOOGLE',
  });

  it('loadAvailableVoices stores the catalogue and toasts on failure', async () => {
    const catalogue = { cartesia: [], google: [catalogueVoice('Achernar', 'tr-TR')] };
    mockGetAvailableVoices.mockResolvedValueOnce(catalogue);
    const store = await createStore();

    await store.loadAvailableVoices();
    expect(mockGetAvailableVoices).toHaveBeenLastCalledWith(undefined);
    expect(store.availableVoices).toEqual(catalogue);
    expect(store.catalogueFor(null)).toEqual(catalogue.google);
    expect(store.isLoadingVoices).toBe(false);

    mockGetAvailableVoices.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
    await store.loadAvailableVoices();
    expect(store.availableVoices).toEqual(catalogue);
    expect(showToast.error).toHaveBeenCalledWith('Sesler yüklenemedi');
    expect(store.isLoadingVoices).toBe(false);
  });

  it('loads the narrators of one content language and keeps them per language', async () => {
    const store = await createStore();
    expect(store.catalogueFor('en')).toBeNull();

    mockGetAvailableVoices.mockResolvedValueOnce({
      cartesia: [],
      google: [catalogueVoice('Achernar', 'en-US')],
    });
    // A locale, a code and any casing are one catalogue.
    await store.loadAvailableVoices('en-US');
    expect(mockGetAvailableVoices).toHaveBeenLastCalledWith('en');
    expect(store.catalogueFor('EN')?.map(v => v.name)).toEqual(['Achernar']);
    expect(store.catalogueFor('tr')).toBeNull();

    mockGetAvailableVoices.mockResolvedValueOnce({
      cartesia: [],
      google: [catalogueVoice('Kore', 'tr-TR')],
    });
    await store.loadAvailableVoices('tr');
    expect(store.catalogueFor('tr')?.map(v => v.name)).toEqual(['Kore']);
    // The English ones are still there.
    expect(store.catalogueFor('en')?.map(v => v.name)).toEqual(['Achernar']);
  });

  it('filters by language itself while the backend still answers with its whole list', async () => {
    mockGetAvailableVoices.mockResolvedValueOnce({
      cartesia: [],
      google: [catalogueVoice('Kore', 'tr-TR'), catalogueVoice('Puck', 'tr-TR')],
    });
    const store = await createStore();
    await store.loadAvailableVoices('en');
    // Turkish voices do not read an English story.
    expect(store.catalogueFor('en')).toEqual([]);
    expect(store.availableVoices?.google).toEqual([]);
  });

  it('a quiet load (the narrator sheet) fails without a snackbar', async () => {
    mockGetAvailableVoices.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
    const store = await createStore();
    await store.loadAvailableVoices('tr', { quiet: true });
    expect(showToast.error).not.toHaveBeenCalled();
    expect(store.catalogueFor('tr')).toBeNull();
    expect(store.isLoadingVoices).toBe(false);
  });

  it('loadCloneConfig caches the served config', async () => {
    const config = parseCloneConfigFromJSON(CLONE_CONFIG_JSON);
    mockGetCloneConfig.mockResolvedValue(config);
    const store = await createStore();

    const result = await store.loadCloneConfig();

    expect(result).toBe(config);
    expect(store.cloneConfig).toEqual(config);
    expect(store.cloneConfigError).toBeNull();
    expect(store.isLoadingCloneConfig).toBe(false);
  });

  it('a config without consent maps to the consent error and keeps the previous config', async () => {
    const config = parseCloneConfigFromJSON(CLONE_CONFIG_JSON);
    mockGetCloneConfig.mockResolvedValueOnce(config);
    const store = await createStore();
    await store.loadCloneConfig();

    mockGetCloneConfig.mockRejectedValueOnce(
      new CloneConfigError('Invalid clone config: missing consent text or version'),
    );
    const result = await store.loadCloneConfig();

    expect(result).toBeNull();
    expect(store.cloneConfig).toEqual(config);
    expect(store.cloneConfigError).toBe(
      'Onay metni şu an yüklenemedi. Lütfen biraz sonra tekrar dene.',
    );
  });

  it('loadCloneConfig shows the API message, or a fallback for other errors', async () => {
    const store = await createStore();

    mockGetCloneConfig.mockRejectedValueOnce(
      apiErrorFromResponse(403, { message: 'Ses klonlama şu an kapalı.' }),
    );
    await store.loadCloneConfig();
    expect(store.cloneConfigError).toBe('Ses klonlama şu an kapalı.');

    mockGetCloneConfig.mockRejectedValueOnce(new TypeError('boom'));
    await store.loadCloneConfig();
    expect(store.cloneConfigError).toBe('Kayıt bilgileri yüklenemedi. Lütfen tekrar dene.');
  });

  describe('clone config per voice language', () => {
    const LANGUAGES = [
      { code: 'tr', locale: 'tr-TR', nativeName: 'Türkçe', englishName: 'Turkish' },
      { code: 'en', locale: 'en-US', nativeName: 'English', englishName: 'English' },
    ];
    const turkish = () =>
      parseCloneConfigFromJSON({
        ...CLONE_CONFIG_JSON,
        language: 'tr',
        locale: 'tr-TR',
        supportedLanguages: LANGUAGES,
      });
    const english = () =>
      parseCloneConfigFromJSON({
        ...CLONE_CONFIG_JSON,
        language: 'en',
        locale: 'en-US',
        supportedLanguages: LANGUAGES,
        consentVersion: 'en-2026-10',
        script: 'Once upon a time.',
      });

    it('asks for Turkish without a parameter, which every backend understands', async () => {
      mockGetCloneConfig.mockResolvedValue(turkish());
      const store = await createStore();

      await store.loadCloneConfig('tr');
      expect(mockGetCloneConfig).toHaveBeenLastCalledWith();
      await store.loadCloneConfig('tr-TR');
      expect(mockGetCloneConfig).toHaveBeenLastCalledWith();
      await store.loadCloneConfig(null);
      expect(mockGetCloneConfig).toHaveBeenLastCalledWith();
      expect(store.cloneLanguage).toBe('tr');
    });

    it('asks for another language by its code and keeps it for later reloads', async () => {
      mockGetCloneConfig.mockResolvedValue(english());
      const store = await createStore();

      const config = await store.loadCloneConfig('en-US');

      expect(mockGetCloneConfig).toHaveBeenLastCalledWith('en');
      expect(config?.consentVersion).toBe('en-2026-10');
      expect(store.cloneLanguage).toBe('en');
      // The config is only handed out for its own language.
      expect(store.cloneConfigFor('en')).toBe(store.cloneConfig);
      expect(store.cloneConfigFor('en-US')).toBe(store.cloneConfig);
      expect(store.cloneConfigFor(undefined)).toBe(store.cloneConfig);
      expect(store.cloneConfigFor('tr')).toBeNull();

      // A retry, or the refetch after CONSENT_REQUIRED, stays in English.
      mockGetCloneConfig.mockClear();
      await store.loadCloneConfig();
      expect(mockGetCloneConfig).toHaveBeenCalledWith('en');
      mockGetCloneConfig.mockClear();
      await store.refreshCloneConfigForReconsent();
      expect(mockGetCloneConfig).toHaveBeenCalledWith('en');
    });

    it('hands out no config while none is loaded', async () => {
      const store = await createStore();
      expect(store.cloneConfigFor('tr')).toBeNull();
      expect(store.cloneConfigFor(null)).toBeNull();
    });

    it.each([
      ['a language that is not offered', { code: 'VOICE_LANGUAGE_NOT_SUPPORTED', message: 'x' }],
      ['a backend that does not know the parameter', { message: ['property language should not exist'] }],
    ])('falls back to the default texts for %s (400)', async (_label, body) => {
      const store = await createStore();
      mockGetCloneConfig
        .mockRejectedValueOnce(apiErrorFromResponse(400, body))
        .mockResolvedValueOnce(turkish());

      const config = await store.loadCloneConfig('de');

      expect(mockGetCloneConfig).toHaveBeenNthCalledWith(1, 'de');
      expect(mockGetCloneConfig).toHaveBeenNthCalledWith(2);
      expect(config?.language).toBe('tr');
      // The flow continues in the language it got.
      expect(store.cloneLanguage).toBe('tr');
      expect(store.cloneConfigError).toBeNull();
      expect(store.cloneConfigFor('de')).toBeNull();
    });

    it('does not fall back on other failures: the previous language stays', async () => {
      const store = await createStore();
      mockGetCloneConfig.mockResolvedValueOnce(turkish());
      await store.loadCloneConfig('tr');

      mockGetCloneConfig.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
      expect(await store.loadCloneConfig('en')).toBeNull();

      expect(mockGetCloneConfig).toHaveBeenCalledTimes(2);
      expect(store.cloneConfig?.language).toBe('tr');
      expect(store.cloneLanguage).toBe('tr');
      expect(store.cloneConfigError).not.toBeNull();
      expect(store.isLoadingCloneConfig).toBe(false);
    });

    it('keeps the wanted language for the retry when nothing was loaded yet', async () => {
      const store = await createStore();
      mockGetCloneConfig.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
      await store.loadCloneConfig('en');
      expect(store.cloneConfig).toBeNull();
      expect(store.cloneLanguage).toBe('en');
    });

    it('applies only the answer to the last request when the language is switched twice', async () => {
      const store = await createStore();
      let resolveEnglish: (config: unknown) => void = () => undefined;
      mockGetCloneConfig
        .mockImplementationOnce(() => new Promise(resolve => (resolveEnglish = resolve)))
        .mockResolvedValueOnce(turkish());

      const first = store.loadCloneConfig('en');
      // The control answers at once: the store already names the language.
      expect(store.cloneLanguage).toBe('en');
      expect(store.isLoadingCloneConfig).toBe(true);
      const second = await store.loadCloneConfig('tr');
      expect(second?.language).toBe('tr');
      expect(store.isLoadingCloneConfig).toBe(false);

      resolveEnglish(english());
      expect(await first).toBeNull();
      expect(store.cloneConfig?.language).toBe('tr');
      expect(store.cloneLanguage).toBe('tr');
      expect(store.isLoadingCloneConfig).toBe(false);
    });

    it('drops the failure of a request that was overtaken', async () => {
      const store = await createStore();
      let rejectEnglish: (error: unknown) => void = () => undefined;
      mockGetCloneConfig
        .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectEnglish = reject)))
        .mockResolvedValueOnce(turkish());

      const first = store.loadCloneConfig('en');
      await store.loadCloneConfig('tr');
      rejectEnglish(apiErrorFromResponse(500, {}));

      expect(await first).toBeNull();
      expect(store.cloneConfigError).toBeNull();
      expect(store.cloneConfig?.language).toBe('tr');
    });
  });

  it('refreshCloneConfigForReconsent keeps a fresh config and drops an outdated one on failure', async () => {
    const oldConfig = parseCloneConfigFromJSON(CLONE_CONFIG_JSON);
    const newConfig = parseCloneConfigFromJSON({ ...CLONE_CONFIG_JSON, consentVersion: '2026-10-v2' });
    const store = await createStore();
    mockGetCloneConfig.mockResolvedValueOnce(oldConfig);
    await store.loadCloneConfig();

    mockGetCloneConfig.mockResolvedValueOnce(newConfig);
    expect(await store.refreshCloneConfigForReconsent()).toBe(newConfig);
    expect(store.cloneConfig?.consentVersion).toBe('2026-10-v2');

    mockGetCloneConfig.mockRejectedValueOnce(apiErrorFromResponse(undefined, null));
    expect(await store.refreshCloneConfigForReconsent()).toBeNull();
    expect(store.cloneConfig).toBeNull();
    expect(store.cloneConfigError).not.toBeNull();
  });

  it('createVoiceProfile validates the name before calling the backend', async () => {
    const store = await createStore();
    const base = {
      provider: TTSProvider.GOOGLE,
      voiceId: 'tr-TR-Chirp3-HD-Achernar',
      language: 'tr-TR',
    };

    expect(await store.createVoiceProfile({ ...base, name: ' a ' })).toEqual({
      profile: null,
      error: null,
    });
    expect(showToast.error).toHaveBeenLastCalledWith('Profil adı en az 2 karakter olmalı');

    expect(await store.createVoiceProfile({ ...base, name: 'x'.repeat(51) })).toEqual({
      profile: null,
      error: null,
    });
    expect(showToast.error).toHaveBeenLastCalledWith('Profil adı çok uzun (en fazla 50 karakter)');
    expect(mockCreateVoiceProfile).not.toHaveBeenCalled();
  });

  it('createVoiceProfile adds a ready-made voice without tracking it and refreshes slots', async () => {
    const created = presetProfile('g1');
    mockCreateVoiceProfile.mockResolvedValue(created);
    const store = await createStore();
    mockGetVoiceSlots.mockClear();

    const result = await store.createVoiceProfile({
      name: 'Anlatıcı',
      provider: TTSProvider.GOOGLE,
      voiceId: 'tr-TR-Chirp3-HD-Achernar',
      language: 'tr-TR',
    });

    expect(result).toEqual({ profile: created, error: null });
    expect(store.voiceProfiles.map(p => p.id)).toEqual(['g1']);
    expect(store.currentProfile?.id).toBe('g1');
    expect(store.getTrackState('g1')).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    expect(mockGetVoiceSlots).toHaveBeenCalledTimes(1);
    expect(store.isLoading).toBe(false);
  });

  it('createVoiceProfile starts tracking a PROCESSING profile', async () => {
    mockCreateVoiceProfile.mockResolvedValue(profile('c1', PROCESSING));
    const store = await createStore();

    await store.createVoiceProfile({
      name: 'Annem',
      provider: TTSProvider.CARTESIA,
      voiceId: 'custom-cloning-pending',
      language: 'tr-TR',
    });

    expect(store.getTrackState('c1')?.phase).toBe('waiting');
    expect(jest.getTimerCount()).toBe(1);
  });

  it('createVoiceProfile hands the backend refusal back to the screen', async () => {
    const refusal = apiErrorFromResponse(403, {
      success: false,
      statusCode: 403,
      code: 'PRESET_SLOT_LIMIT',
      limit: 3,
      message: 'En fazla 3 hazır ses ekleyebilirsin.',
    });
    mockCreateVoiceProfile.mockRejectedValue(refusal);
    const store = await createStore();
    mockGetVoiceSlots.mockClear();

    const result = await store.createVoiceProfile({
      name: 'Anlatıcı',
      provider: TTSProvider.GOOGLE,
      voiceId: 'tr-TR-Chirp3-HD-Achernar',
      language: 'tr-TR',
    });

    expect(result.profile).toBeNull();
    expect(result.error).toBe(refusal);
    expect(store.errorMessage).toBe('En fazla 3 hazır ses ekleyebilirsin.');
    expect(mockGetVoiceSlots).toHaveBeenCalledTimes(1);
    expect(store.isLoading).toBe(false);
  });

  it('getVoiceSample returns the url, null without a sample, and null with a toast on failure', async () => {
    const store = await createStore();

    mockGetVoiceSample.mockResolvedValueOnce({
      audioUrl: 'https://storage.googleapis.com/sesly-voices/samples/g1.mp3',
    });
    expect(await store.getVoiceSample('g1')).toBe(
      'https://storage.googleapis.com/sesly-voices/samples/g1.mp3',
    );

    mockGetVoiceSample.mockResolvedValueOnce(null);
    expect(await store.getVoiceSample('g1')).toBeNull();
    expect(showToast.error).not.toHaveBeenCalled();

    mockGetVoiceSample.mockRejectedValueOnce(apiErrorFromResponse(404, {}));
    expect(await store.getVoiceSample('g1')).toBeNull();
    expect(showToast.error).toHaveBeenCalledWith('Ses örneği alınamadı');
  });

  it('deleteVoiceProfile removes the profile, stops tracking it and refreshes slots', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([profile('c1', PROCESSING), presetProfile('g1')]);
    mockDeleteVoiceProfile.mockResolvedValue(undefined);
    const store = await createStore();
    store.setCurrentProfile(store.voiceProfiles[0]);
    expect(jest.getTimerCount()).toBe(1);
    mockGetVoiceSlots.mockClear();

    expect(await store.deleteVoiceProfile('c1')).toBe(true);

    expect(mockDeleteVoiceProfile).toHaveBeenCalledWith('c1');
    // Its narrations leave the local queue.
    expect(mockRemoveByVoice).toHaveBeenCalledWith('c1');
    expect(store.voiceProfiles.map(p => p.id)).toEqual(['g1']);
    expect(store.currentProfile).toBeNull();
    expect(store.getTrackState('c1')).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    expect(mockGetVoiceSlots).toHaveBeenCalledTimes(1);
    expect(store.isLoading).toBe(false);
  });

  it('deleteVoiceProfile failure keeps the list and toasts the backend message', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([presetProfile('g1')]);
    mockDeleteVoiceProfile.mockRejectedValue(
      apiErrorFromResponse(409, { message: 'Bu ses bir anlatımda kullanılıyor.' }),
    );
    const store = await createStore();
    store.setCurrentProfile(store.voiceProfiles[0]);

    expect(await store.deleteVoiceProfile('g1')).toBe(false);

    expect(store.voiceProfiles.map(p => p.id)).toEqual(['g1']);
    expect(store.currentProfile?.id).toBe('g1');
    expect(showToast.error).toHaveBeenCalledWith('Bu ses bir anlatımda kullanılıyor.');
    expect(mockRemoveByVoice).not.toHaveBeenCalled();
    expect(store.isLoading).toBe(false);
    expect(store.isMutating).toBe(false);
  });

  it('deleteVoiceProfile treats a 404 as already gone (e.g. swept meanwhile)', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([profile('c1', PENDING), presetProfile('g1')]);
    mockDeleteVoiceProfile.mockRejectedValueOnce(
      apiErrorFromResponse(404, { message: 'Ses profili bulunamadı' }),
    );
    const store = await createStore();
    mockGetVoiceSlots.mockClear();

    expect(await store.deleteVoiceProfile('c1')).toBe(true);

    expect(store.voiceProfiles.map(p => p.id)).toEqual(['g1']);
    expect(showToast.error).not.toHaveBeenCalled();
    expect(mockRemoveByVoice).toHaveBeenCalledWith('c1');
    expect(mockGetVoiceSlots).toHaveBeenCalledTimes(1);
    expect(store.isMutating).toBe(false);
  });

  it('deleteVoiceProfile names the failure in the UI language when there is no server text', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([presetProfile('g1')]);
    mockDeleteVoiceProfile.mockRejectedValue(new Error('Invalid response'));
    const store = await createStore();

    expect(await store.deleteVoiceProfile('g1')).toBe(false);
    expect(showToast.error).toHaveBeenLastCalledWith('Ses profili silinemedi');

    await i18n.changeLanguage('en');
    expect(await store.deleteVoiceProfile('g1')).toBe(false);
    expect(showToast.error).toHaveBeenLastCalledWith('The voice could not be deleted');
  });

  it('a delete still succeeds when the queue cannot be updated', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([presetProfile('g1')]);
    mockDeleteVoiceProfile.mockResolvedValue(undefined);
    mockRemoveByVoice.mockImplementationOnce(() => {
      throw new Error('storage full');
    });
    const store = await createStore();

    expect(await store.deleteVoiceProfile('g1')).toBe(true);
    expect(store.voiceProfiles).toEqual([]);
    expect(showToast.error).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Loading states: single-flight, first load, mutations, catalogue errors
// ============================================================================

describe('VoiceProfileStore loading states', () => {
  beforeEach(() => {
    resetServiceMocks();
    mockRemoveByVoice.mockReset();
  });
  afterEach(cleanupStores);

  it('three concurrent loads make one request and, offline, one snackbar', async () => {
    const store = await createStore();
    mockGetMyVoiceProfiles.mockClear();
    const answer = deferred<VoiceProfile[]>();
    mockGetMyVoiceProfiles.mockReturnValueOnce(answer.promise);

    const loads = [store.loadVoiceProfiles(), store.loadVoiceProfiles(), store.refresh()];
    expect(mockGetMyVoiceProfiles).toHaveBeenCalledTimes(1);
    expect(store.isLoading).toBe(true);
    answer.resolve([presetProfile('g1')]);
    await Promise.all(loads);
    expect(store.voiceProfiles.map(p => p.id)).toEqual(['g1']);

    // Offline: still one request and one snackbar.
    mockGetMyVoiceProfiles.mockClear();
    let fail!: (error: unknown) => void;
    mockGetMyVoiceProfiles.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const offline = [store.loadVoiceProfiles(), store.loadVoiceProfiles(), store.loadVoiceProfiles()];
    fail(apiErrorFromResponse(undefined, null));
    await Promise.all(offline);
    expect(mockGetMyVoiceProfiles).toHaveBeenCalledTimes(1);
    expect(showToast.error).toHaveBeenCalledTimes(1);
    expect(showToast.error).toHaveBeenCalledWith('Ses profilleri yüklenemedi');

    // Once settled, the next call asks again.
    await store.loadVoiceProfiles();
    expect(mockGetMyVoiceProfiles).toHaveBeenCalledTimes(2);
  });

  it('a fresh call while a load runs queues one more request after it', async () => {
    const store = await createStore();
    mockGetMyVoiceProfiles.mockClear();
    const stale = deferred<VoiceProfile[]>();
    mockGetMyVoiceProfiles.mockReturnValueOnce(stale.promise);
    mockGetMyVoiceProfiles.mockResolvedValueOnce([presetProfile('g1'), presetProfile('g2')]);

    const running = store.loadVoiceProfiles();
    // An upload and a socket event both ask for a list asked after them.
    const fresh = [store.loadVoiceProfiles({ fresh: true }), store.loadVoiceProfiles({ fresh: true })];
    // A plain caller still joins the running load.
    expect(store.loadVoiceProfiles()).toBe(running);
    expect(mockGetMyVoiceProfiles).toHaveBeenCalledTimes(1);

    stale.resolve([presetProfile('g1')]);
    await Promise.all(fresh);
    expect(mockGetMyVoiceProfiles).toHaveBeenCalledTimes(2);
    expect(store.voiceProfiles.map(p => p.id)).toEqual(['g1', 'g2']);

    // With nothing running a fresh call is one ordinary load.
    mockGetMyVoiceProfiles.mockResolvedValueOnce([presetProfile('g1')]);
    await store.loadVoiceProfiles({ fresh: true });
    expect(mockGetMyVoiceProfiles).toHaveBeenCalledTimes(3);
  });

  it('a socket event for an unknown voice during an older load still lists it', async () => {
    const store = await createStore();
    mockGetMyVoiceProfiles.mockClear();
    const stale = deferred<VoiceProfile[]>();
    mockGetMyVoiceProfiles.mockReturnValueOnce(stale.promise);
    mockGetMyVoiceProfiles.mockResolvedValueOnce([presetProfile('g-new')]);

    const running = store.loadVoiceProfiles();
    store.applyRealtimeVoiceStatus({ voiceProfileId: 'g-new', status: READY, errorMessage: null });
    stale.resolve([]);
    await running;
    await settle();

    expect(mockGetMyVoiceProfiles).toHaveBeenCalledTimes(2);
    expect(store.voiceProfiles.map(p => p.id)).toEqual(['g-new']);
  });

  it('the constructor load is shared with a mount-time call', async () => {
    mockGetMyVoiceProfiles.mockClear();
    const store = new VoiceProfileStore();
    liveStores.push(store);
    void store.loadVoiceProfiles();
    await settle();
    expect(mockGetMyVoiceProfiles).toHaveBeenCalledTimes(1);
  });

  it('hasLoadedProfiles is false until the first load settles, also after a failure', async () => {
    const answer = deferred<VoiceProfile[]>();
    let fail!: (error: unknown) => void;
    mockGetMyVoiceProfiles.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const store = new VoiceProfileStore();
    liveStores.push(store);
    expect(store.hasLoadedProfiles).toBe(false);
    expect(store.isLoading).toBe(true);

    fail(apiErrorFromResponse(500, {}));
    await settle();
    // Not stuck on a skeleton: the list is known to be unknown (error state).
    expect(store.hasLoadedProfiles).toBe(true);
    expect(store.voiceProfiles).toEqual([]);
    expect(store.errorMessage).toBe('Ses profilleri yüklenemedi');

    // A later load keeps it true while it runs.
    mockGetMyVoiceProfiles.mockReturnValueOnce(answer.promise);
    const reload = store.loadVoiceProfiles();
    expect(store.hasLoadedProfiles).toBe(true);
    answer.resolve([]);
    await reload;
    expect(store.hasLoadedProfiles).toBe(true);
  });

  it('a create or delete runs under isMutating and never flips the loading state', async () => {
    const store = await createStore();
    const created = deferred<VoiceProfile>();
    mockCreateVoiceProfile.mockReturnValueOnce(created.promise);
    const seen: Array<[boolean, boolean, boolean]> = [];

    const create = store.createVoiceProfile({
      name: 'Anlatıcı',
      provider: TTSProvider.GOOGLE,
      voiceId: 'tr-TR-Chirp3-HD-Achernar',
      language: 'tr-TR',
    });
    seen.push([store.isLoading, store.isMutating, store.hasLoadedProfiles]);
    created.resolve(presetProfile('g1'));
    await create;
    seen.push([store.isLoading, store.isMutating, store.hasLoadedProfiles]);

    const deleted = deferred<void>();
    mockDeleteVoiceProfile.mockReturnValueOnce(deleted.promise);
    const remove = store.deleteVoiceProfile('g1');
    seen.push([store.isLoading, store.isMutating, store.hasLoadedProfiles]);
    deleted.resolve();
    expect(await remove).toBe(true);
    seen.push([store.isLoading, store.isMutating, store.hasLoadedProfiles]);

    expect(seen).toEqual([
      [false, true, true],
      [false, false, true],
      [false, true, true],
      [false, false, true],
    ]);
  });

  it('a failed catalogue sets catalogueErrorFor; a retry clears it while it loads', async () => {
    const store = await createStore();
    mockGetAvailableVoices.mockRejectedValueOnce(apiErrorFromResponse(undefined, null));

    await store.loadAvailableVoices('tr');

    expect(store.catalogueFor('tr')).toBeNull();
    expect(store.catalogueErrorFor('tr')).toBe('Sesler yüklenemedi');
    expect(store.catalogueErrorFor('tr-TR')).toBe('Sesler yüklenemedi');
    // Another language is not affected.
    expect(store.catalogueErrorFor('en')).toBeNull();

    const answer = deferred<{ cartesia: never[]; google: never[] }>();
    mockGetAvailableVoices.mockReturnValueOnce(answer.promise);
    const retry = store.loadAvailableVoices('tr');
    expect(store.catalogueErrorFor('tr')).toBeNull();
    expect(store.isLoadingVoices).toBe(true);
    answer.resolve({ cartesia: [], google: [] });
    await retry;

    expect(store.catalogueErrorFor('tr')).toBeNull();
    expect(store.catalogueFor('tr')).toEqual([]);
  });

  it('a quiet catalogue failure still records the error without a snackbar', async () => {
    const store = await createStore();
    mockGetAvailableVoices.mockRejectedValueOnce(apiErrorFromResponse(500, {}));

    await store.loadAvailableVoices('en', { quiet: true });

    expect(store.catalogueErrorFor('en')).toBe('Sesler yüklenemedi');
    expect(showToast.error).not.toHaveBeenCalled();
  });

  it('a language asked for while it loads shares the one request; another language keeps the store loading (NEW-2)', async () => {
    const store = await createStore();
    const tr = deferred<{ cartesia: never[]; google: never[] }>();
    let failEnglish!: (error: unknown) => void;
    const en = new Promise<never>((_resolve, reject) => {
      failEnglish = reject;
    });
    mockGetAvailableVoices.mockReturnValueOnce(tr.promise).mockReturnValueOnce(en);

    // The story page's prefetch, then the narrator sheet opening in the same second.
    const prefetch = store.loadAvailableVoices('tr', { quiet: true });
    const open = store.loadAvailableVoices('tr-TR', { quiet: true });
    const other = store.loadAvailableVoices('en');
    expect(mockGetAvailableVoices).toHaveBeenCalledTimes(2);
    expect(store.isLoadingVoices).toBe(true);

    tr.resolve({ cartesia: [], google: [] });
    await Promise.all([prefetch, open]);
    expect(store.catalogueFor('tr')).toEqual([]);
    // English is still on its way.
    expect(store.isLoadingVoices).toBe(true);

    failEnglish(apiErrorFromResponse(500, {}));
    await other;
    expect(store.isLoadingVoices).toBe(false);
    // Only the caller that was not quiet says so.
    expect(showToast.error).toHaveBeenCalledTimes(1);

    // Settled: the next ask is a new request.
    mockGetAvailableVoices.mockResolvedValueOnce({ cartesia: [], google: [] });
    await store.loadAvailableVoices('en');
    expect(mockGetAvailableVoices).toHaveBeenCalledTimes(3);
    expect(store.catalogueFor('en')).toEqual([]);
  });
});

// ============================================================================
// Sign-out reset and orphaned PENDING clones
// ============================================================================

describe('VoiceProfileStore reset and orphaned PENDING clones', () => {
  beforeEach(() => {
    resetServiceMocks();
    mockRemoveByVoice.mockReset();
  });
  afterEach(cleanupStores);

  it('reset forgets the user and drops an answer still on its way', async () => {
    mockGetMyVoiceProfiles.mockResolvedValue([profile('c1', PROCESSING)]);
    const store = await createStore();
    await store.loadVoiceSlots();
    expect(store.voiceProfiles).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(1);

    const late = deferred<VoiceProfile[]>();
    mockGetMyVoiceProfiles.mockReturnValueOnce(late.promise);
    const load = store.loadVoiceProfiles();

    store.reset();
    expect(store.voiceProfiles).toEqual([]);
    expect(store.hasLoadedProfiles).toBe(false);
    expect(store.isLoading).toBe(false);
    expect(store.voiceSlotInfo).toBeNull();
    expect(store.getTrackState('c1')).toBeNull();
    expect(jest.getTimerCount()).toBe(0);

    late.resolve([presetProfile('someone-else')]);
    await load;
    expect(store.voiceProfiles).toEqual([]);
    expect(store.hasLoadedProfiles).toBe(false);

    // The next account loads normally (a new request, not the dropped one).
    mockGetMyVoiceProfiles.mockResolvedValueOnce([presetProfile('g2')]);
    await store.loadVoiceProfiles();
    expect(store.voiceProfiles.map(p => p.id)).toEqual(['g2']);
    expect(store.hasLoadedProfiles).toBe(true);
  });

  it('a fresh follow-up queued before sign-out never loads for the next account', async () => {
    const store = await createStore();
    mockGetMyVoiceProfiles.mockClear();
    const late = deferred<VoiceProfile[]>();
    mockGetMyVoiceProfiles.mockReturnValueOnce(late.promise);

    const load = store.loadVoiceProfiles();
    const fresh = store.loadVoiceProfiles({ fresh: true });
    store.reset();
    late.resolve([presetProfile('someone-else')]);
    await load;
    await fresh;

    expect(mockGetMyVoiceProfiles).toHaveBeenCalledTimes(1);
    expect(store.voiceProfiles).toEqual([]);
    expect(store.hasLoadedProfiles).toBe(false);
  });

  it('a narrator add answered after sign-out is not listed for the next account', async () => {
    const store = await createStore();
    const created = deferred<VoiceProfile>();
    mockCreateVoiceProfile.mockReturnValueOnce(created.promise);

    const create = store.createVoiceProfile({
      name: 'Anlatıcı',
      provider: TTSProvider.GOOGLE,
      voiceId: 'tr-TR-Chirp3-HD-Achernar',
      language: 'tr-TR',
    });
    store.reset();
    created.resolve(presetProfile('g1'));

    expect(await create).toEqual({ profile: null, error: null });
    expect(store.voiceProfiles).toEqual([]);
    expect(store.currentProfile).toBeNull();
    expect(store.isMutating).toBe(false);
  });

  it('a sweep skips a profile claimed back for a retry while it runs', async () => {
    const store = await createStore();
    store.markPendingDiscard('c1');
    store.markPendingDiscard('c2');
    mockGetMyVoiceProfiles.mockResolvedValueOnce([profile('c1', PENDING), profile('c2', PENDING)]);
    const first = deferred<void>();
    mockDeleteVoiceProfile.mockReturnValueOnce(first.promise);

    await store.loadVoiceProfiles();
    expect(mockDeleteVoiceProfile).toHaveBeenCalledWith('c1');
    // The recording flow re-uploads to c2 while c1 is being deleted.
    store.unmarkPendingDiscard('c2');
    first.resolve();
    await settle();

    expect(mockDeleteVoiceProfile).toHaveBeenCalledTimes(1);
    expect(store.voiceProfiles.map(p => p.id)).toEqual(['c2']);
  });

  it('a PENDING clone whose discard failed is deleted after the next successful load', async () => {
    const store = await createStore();
    store.markPendingDiscard('c1');
    mockGetMyVoiceProfiles.mockResolvedValueOnce([profile('c1', PENDING), presetProfile('g1')]);
    mockDeleteVoiceProfile.mockResolvedValueOnce(undefined);
    mockGetVoiceSlots.mockClear();

    await store.loadVoiceProfiles();
    await settle();

    expect(mockDeleteVoiceProfile).toHaveBeenCalledWith('c1');
    expect(store.voiceProfiles.map(p => p.id)).toEqual(['g1']);
    expect(mockGetVoiceSlots).toHaveBeenCalledTimes(1);

    // Done once: the next load does not delete again.
    mockGetMyVoiceProfiles.mockResolvedValueOnce([presetProfile('g1')]);
    await store.loadVoiceProfiles();
    await settle();
    expect(mockDeleteVoiceProfile).toHaveBeenCalledTimes(1);
  });

  it('keeps trying after a failed sweep, and leaves a profile whose sample arrived', async () => {
    const store = await createStore();
    store.markPendingDiscard('c1');
    store.markPendingDiscard('c2');
    mockGetMyVoiceProfiles.mockResolvedValueOnce([profile('c1', PENDING), profile('c2', PROCESSING)]);
    mockDeleteVoiceProfile.mockRejectedValueOnce(apiErrorFromResponse(undefined, null));

    await store.loadVoiceProfiles();
    await settle();
    expect(mockDeleteVoiceProfile).toHaveBeenCalledTimes(1);
    expect(mockDeleteVoiceProfile).toHaveBeenCalledWith('c1');
    expect(store.voiceProfiles.map(p => p.id)).toEqual(['c1', 'c2']);

    mockGetMyVoiceProfiles.mockResolvedValueOnce([profile('c1', PENDING), profile('c2', PROCESSING)]);
    mockDeleteVoiceProfile.mockResolvedValueOnce(undefined);
    await store.loadVoiceProfiles();
    await settle();
    expect(mockDeleteVoiceProfile).toHaveBeenCalledTimes(2);
    expect(mockDeleteVoiceProfile).not.toHaveBeenCalledWith('c2');
    expect(store.voiceProfiles.map(p => p.id)).toEqual(['c2']);
  });

  it('a profile claimed back for a retry is not swept', async () => {
    const store = await createStore();
    store.markPendingDiscard('c1');
    store.unmarkPendingDiscard('c1');
    mockGetMyVoiceProfiles.mockResolvedValueOnce([profile('c1', PENDING)]);

    await store.loadVoiceProfiles();
    await settle();

    expect(mockDeleteVoiceProfile).not.toHaveBeenCalled();
    expect(store.voiceProfiles.map(p => p.id)).toEqual(['c1']);
  });

  it('a failed load never sweeps', async () => {
    const store = await createStore();
    store.markPendingDiscard('c1');
    mockGetMyVoiceProfiles.mockRejectedValueOnce(apiErrorFromResponse(undefined, null));

    await store.loadVoiceProfiles();
    await settle();

    expect(mockDeleteVoiceProfile).not.toHaveBeenCalled();
  });
});

// ============================================================================
// No hard-coded snackbar text in stores and services (voice-9)
// ============================================================================

describe('snackbar copy in hooks and services', () => {
  const ROOTS = [path.join(__dirname), path.join(__dirname, '../services')];

  function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  it('every showToast call passes translated text, never a string literal', () => {
    const offenders: string[] = [];
    for (const file of ROOTS.flatMap(sources)) {
      fs.readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .forEach((line, index) => {
          // Doc comments may show an example call.
          if (/^\s*(\*|\/\/)/.test(line)) return;
          if (/showToast\.(error|info|success)\(\s*['"`]/.test(line)) {
            offenders.push(`${path.relative(ROOTS[0], file)}:${index + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
