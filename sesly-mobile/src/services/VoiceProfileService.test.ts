import { apiErrorFromResponse } from './ApiError';
import { CloneConfigError, FALLBACK_CLONE_DURATIONS } from '../models/VoiceClone';
import { VOICE_CLONING } from '../config/constants';
import { TTSProvider, VoiceProfileStatus } from '../types/enums';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();
const mockUpload = jest.fn();

jest.mock('./ApiClient', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    upload: (...args: unknown[]) => mockUpload(...args),
  },
}));

// Imported after the mock so the service picks up the mocked client.
import VoiceProfileService from './VoiceProfileService';

// ----------------------------------------------------------------------------
// Fixtures (shapes taken from the backend: voice-profile.mapper.ts,
// clone-config.constants.ts, clone-quota.ts, voice-profiles.service.ts)
// ----------------------------------------------------------------------------

const CONSENT_TEXT =
  'Sesly, masallari senin sesinle anlatabilmek icin ses kaydindan sesinin yapay bir kopyasini olusturur.\n\nOnayladiginda acik riza vermis olursun.';

const cloneConfigResponse = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  provider: 'CARTESIA',
  language: 'tr',
  minSeconds: 15,
  targetSeconds: 30,
  maxSeconds: 60,
  scriptTitle: 'Yildizli Bir Gece',
  script: 'Aksam olunca koyun ustune yumusak bir sessizlik coker.',
  consentVersion: '2026-09-v1',
  consentTitle: 'Sesin icin acik riza',
  consentText: CONSENT_TEXT,
  ...overrides,
});

const publicProfile = (overrides: Record<string, unknown> = {}) => ({
  id: 'vp-1',
  userId: 'u-1',
  name: 'Annemin sesi',
  profileIcon: null,
  provider: 'CARTESIA',
  kind: 'CLONE',
  voiceId: 'pending-abc',
  language: 'tr',
  status: 'PENDING',
  isPremium: true,
  errorMessage: null,
  errorReason: null,
  sampleAudioUrl: null,
  consentAt: null,
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
  ...overrides,
});

const slotsResponse = (overrides: Record<string, unknown> = {}) => ({
  plan: 'FREE',
  totalSlots: 4,
  usedSlots: 2,
  availableSlots: 2,
  extraSlots: 0,
  canCreate: true,
  preset: { used: 1, limit: 3, canCreate: true },
  clone: { used: 1, limit: 1, canCreate: false, monthlyCreated: 1, monthlyLimit: 2 },
  ...overrides,
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
  mockUpload.mockReset();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

// ============================================================================
// getCloneConfig
// ============================================================================

describe('VoiceProfileService.getCloneConfig', () => {
  it('GETs /voice-profiles/clone-config and parses the backend config', async () => {
    mockGet.mockResolvedValue(cloneConfigResponse());

    const config = await VoiceProfileService.getCloneConfig();

    expect(mockGet).toHaveBeenCalledWith('/voice-profiles/clone-config');
    expect(config).toEqual({
      enabled: true,
      provider: 'CARTESIA',
      language: 'tr',
      locale: 'tr-TR',
      supportedLanguages: [],
      minSeconds: 15,
      targetSeconds: 30,
      maxSeconds: 60,
      scriptTitle: 'Yildizli Bir Gece',
      script: 'Aksam olunca koyun ustune yumusak bir sessizlik coker.',
      consentVersion: '2026-09-v1',
      consentTitle: 'Sesin icin acik riza',
      consentText: CONSENT_TEXT,
    });
  });

  it('falls back to local durations and script but keeps served consent', async () => {
    mockGet.mockResolvedValue({
      consentVersion: '2026-09-v1',
      consentText: CONSENT_TEXT,
      minSeconds: 'abc',
      maxSeconds: -5,
      unknownField: 'ignored',
    });

    const config = await VoiceProfileService.getCloneConfig();

    expect(config.minSeconds).toBe(FALLBACK_CLONE_DURATIONS.minSeconds);
    expect(config.targetSeconds).toBe(FALLBACK_CLONE_DURATIONS.targetSeconds);
    expect(config.maxSeconds).toBe(FALLBACK_CLONE_DURATIONS.maxSeconds);
    expect(config.script).toBe(VOICE_CLONING.FALLBACK_SCRIPT_TR);
    expect(config.scriptTitle).toBe(VOICE_CLONING.FALLBACK_SCRIPT_TITLE_TR);
    expect(config.enabled).toBe(true);
    expect(config.provider).toBe('CARTESIA');
    expect(config.consentVersion).toBe('2026-09-v1');
    expect(config).not.toHaveProperty('unknownField');
  });

  it('clamps an out of range target and accepts numeric strings', async () => {
    mockGet.mockResolvedValue(
      cloneConfigResponse({ minSeconds: '20', targetSeconds: 90, maxSeconds: '45' }),
    );
    const config = await VoiceProfileService.getCloneConfig();
    expect(config.minSeconds).toBe(20);
    expect(config.maxSeconds).toBe(45);
    expect(config.targetSeconds).toBe(45);
  });

  it('rejects when the consent version is missing', async () => {
    mockGet.mockResolvedValue(cloneConfigResponse({ consentVersion: undefined }));
    await expect(VoiceProfileService.getCloneConfig()).rejects.toBeInstanceOf(
      CloneConfigError,
    );
  });

  it('rejects when the consent text is blank', async () => {
    mockGet.mockResolvedValue(cloneConfigResponse({ consentText: '   ' }));
    await expect(VoiceProfileService.getCloneConfig()).rejects.toThrow(
      /missing consent text or version/,
    );
  });

  it('rejects non-object payloads', async () => {
    mockGet.mockResolvedValue([cloneConfigResponse()]);
    await expect(VoiceProfileService.getCloneConfig()).rejects.toBeInstanceOf(
      CloneConfigError,
    );
    mockGet.mockResolvedValue(null);
    await expect(VoiceProfileService.getCloneConfig()).rejects.toBeInstanceOf(
      CloneConfigError,
    );
  });

  it('propagates ApiErrors from the client unchanged', async () => {
    const error = apiErrorFromResponse(503, { message: 'Bakimdayiz.' });
    mockGet.mockRejectedValue(error);
    await expect(VoiceProfileService.getCloneConfig()).rejects.toBe(error);
  });
});

// ============================================================================
// uploadCloneSample
// ============================================================================

describe('VoiceProfileService.uploadCloneSample', () => {
  let appendSpy: jest.SpyInstance;

  /** The RN file part and string fields exactly as passed to FormData.append. */
  const appended = (): Record<string, unknown> =>
    Object.fromEntries(appendSpy.mock.calls.map(([k, v]) => [k, v]));

  beforeEach(() => {
    appendSpy = jest.spyOn(FormData.prototype, 'append');
    mockUpload.mockResolvedValue({ id: 'vp-1', status: 'PROCESSING' });
  });

  it('posts a wav take to /voice-profiles/:id/upload-samples with every field', async () => {
    await VoiceProfileService.uploadCloneSample('vp-1', {
      fileUri: 'file:///data/rec/take.wav',
      consentVersion: '2026-09-v1',
      speechStartMs: 1234.4,
    });

    expect(mockUpload).toHaveBeenCalledTimes(1);
    const [path, formData, progressCb] = mockUpload.mock.calls[0];
    expect(path).toBe('/voice-profiles/vp-1/upload-samples');
    expect(formData).toBeInstanceOf(FormData);
    expect(typeof progressCb).toBe('function');

    expect(appendSpy.mock.calls.map(([k]) => k)).toEqual([
      'referenceAudio',
      'consentVersion',
      'speechStartMs',
    ]);
    const fields = appended();
    expect(fields.referenceAudio).toEqual({
      uri: 'file:///data/rec/take.wav',
      type: 'audio/wav',
      name: expect.stringMatching(/^reference_\d+\.wav$/),
    });
    expect(fields.consentVersion).toBe('2026-09-v1');
    expect(fields.speechStartMs).toBe('1234');
  });

  it('uses audio/m4a for an Android AAC take', async () => {
    await VoiceProfileService.uploadCloneSample('vp-2', {
      fileUri: 'file:///cache/Audio/recording-123.m4a',
      consentVersion: '2026-09-v1',
    });
    expect(appended().referenceAudio).toEqual({
      uri: 'file:///cache/Audio/recording-123.m4a',
      type: 'audio/m4a',
      name: expect.stringMatching(/^reference_\d+\.m4a$/),
    });
  });

  it('detects .WAV case-insensitively and ignores a query string', async () => {
    await VoiceProfileService.uploadCloneSample('vp-3', {
      fileUri: 'file:///tmp/TAKE.WAV?cache=1',
      consentVersion: '2026-09-v1',
    });
    const part = appended().referenceAudio as { type: string; name: string };
    expect(part.type).toBe('audio/wav');
    expect(part.name).toMatch(/\.wav$/);
  });

  it('rounds speechStartMs and sends 0 as "0"', async () => {
    await VoiceProfileService.uploadCloneSample('vp-1', {
      fileUri: 'file:///take.wav',
      consentVersion: 'v1',
      speechStartMs: 0,
    });
    expect(appended().speechStartMs).toBe('0');

    appendSpy.mockClear();
    await VoiceProfileService.uploadCloneSample('vp-1', {
      fileUri: 'file:///take.wav',
      consentVersion: 'v1',
      speechStartMs: 899.5,
    });
    expect(appended().speechStartMs).toBe('900');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative', -1],
  ])('omits speechStartMs when it is %s', async (_label, speechStartMs) => {
    await VoiceProfileService.uploadCloneSample('vp-1', {
      fileUri: 'file:///take.m4a',
      consentVersion: 'v1',
      speechStartMs,
    });
    expect(appendSpy.mock.calls.map(([k]) => k)).toEqual([
      'referenceAudio',
      'consentVersion',
    ]);
  });

  it('forwards upload progress as a rounded percentage', async () => {
    const onProgress = jest.fn();
    await VoiceProfileService.uploadCloneSample(
      'vp-1',
      { fileUri: 'file:///take.wav', consentVersion: 'v1' },
      onProgress,
    );
    const progressCb = mockUpload.mock.calls[0][2] as (e: {
      loaded: number;
      total?: number;
    }) => void;

    progressCb({ loaded: 1, total: 3 });
    progressCb({ loaded: 2048, total: 2048 });
    progressCb({ loaded: 10 }); // total unknown: ignored
    progressCb({ loaded: 10, total: 0 }); // zero total: ignored

    expect(onProgress.mock.calls).toEqual([[33], [100]]);
  });

  it('does not fail when no progress callback is given', async () => {
    await VoiceProfileService.uploadCloneSample('vp-1', {
      fileUri: 'file:///take.wav',
      consentVersion: 'v1',
    });
    const progressCb = mockUpload.mock.calls[0][2] as (e: {
      loaded: number;
      total?: number;
    }) => void;
    expect(() => progressCb({ loaded: 5, total: 10 })).not.toThrow();
  });

  it('validates profileId, fileUri and consentVersion before any request', async () => {
    await expect(
      VoiceProfileService.uploadCloneSample('', {
        fileUri: 'file:///take.wav',
        consentVersion: 'v1',
      }),
    ).rejects.toThrow('Voice profile ID is required');
    await expect(
      VoiceProfileService.uploadCloneSample('vp-1', {
        fileUri: '',
        consentVersion: 'v1',
      }),
    ).rejects.toThrow('Reference audio file path is required');
    await expect(
      VoiceProfileService.uploadCloneSample('vp-1', {
        fileUri: 'file:///take.wav',
        consentVersion: '',
      }),
    ).rejects.toThrow('Consent version is required');
    expect(mockUpload).not.toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('rethrows backend errors (e.g. 400 CONSENT_REQUIRED) unchanged', async () => {
    const error = apiErrorFromResponse(400, {
      statusCode: 400,
      code: 'CONSENT_REQUIRED',
      message: 'Acik riza metnini yeniden onaylaman gerekiyor.',
    });
    mockUpload.mockRejectedValue(error);
    await expect(
      VoiceProfileService.uploadCloneSample('vp-1', {
        fileUri: 'file:///take.wav',
        consentVersion: 'old-version',
      }),
    ).rejects.toBe(error);
    expect(error.code).toBe('CONSENT_REQUIRED');
  });
});

// ============================================================================
// Slots
// ============================================================================

describe('VoiceProfileService.getVoiceSlots', () => {
  it('parses the backend slots response with preset / clone sub-objects', async () => {
    mockGet.mockResolvedValue(slotsResponse());

    const slots = await VoiceProfileService.getVoiceSlots();

    expect(mockGet).toHaveBeenCalledWith('/voice-profiles/slots');
    expect(slots).toEqual({
      used: 2,
      limit: 4,
      available: 2,
      plan: 'free',
      canCreate: true,
      message: null,
      preset: { used: 1, limit: 3, canCreate: true, message: null },
      clone: {
        used: 1,
        limit: 1,
        canCreate: false,
        message: null,
        monthlyCreated: 1,
        monthlyLimit: 2,
        creations: null,
      },
    });
  });

  it('reads the clone creation allowance with its period and renewal date', async () => {
    mockGet.mockResolvedValue(
      slotsResponse({
        plan: 'MINI',
        clone: {
          used: 1,
          limit: 1,
          canCreate: false,
          monthlyCreated: 2,
          monthlyLimit: 2,
          creations: {
            used: 2,
            limit: 2,
            period: 'month',
            renewsAt: '2026-11-01T00:00:00.000Z',
            canCreate: false,
          },
        },
      }),
    );

    const slots = await VoiceProfileService.getVoiceSlots();

    expect(slots.plan).toBe('mini');
    expect(slots.clone?.creations).toEqual({
      used: 2,
      limit: 2,
      period: 'month',
      renewsAt: new Date('2026-11-01T00:00:00.000Z'),
      canCreate: false,
    });
  });

  it('tolerates an older backend without the preset / clone split', async () => {
    mockGet.mockResolvedValue({
      plan: 'PREMIUM',
      used: '1',
      limit: '5',
      available: 4,
      message: '  Bir ses daha ekleyebilirsin.  ',
    });
    const slots = await VoiceProfileService.getVoiceSlots();
    expect(slots.used).toBe(1);
    expect(slots.limit).toBe(5);
    expect(slots.plan).toBe('premium');
    expect(slots.canCreate).toBe(true); // derived from available > 0
    expect(slots.message).toBe('Bir ses daha ekleyebilirsin.');
    expect(slots.preset).toBeNull();
    expect(slots.clone).toBeNull();
  });

  it('derives sub-slot canCreate and tolerates missing monthly fields', async () => {
    mockGet.mockResolvedValue(
      slotsResponse({
        preset: { used: 3, limit: 3 },
        clone: { used: 0, limit: 1, canCreate: true },
      }),
    );
    const slots = await VoiceProfileService.getVoiceSlots();
    expect(slots.preset?.canCreate).toBe(false);
    expect(slots.clone).toEqual({
      used: 0,
      limit: 1,
      canCreate: true,
      message: null,
      monthlyCreated: null,
      monthlyLimit: null,
      creations: null,
    });
  });

  it('throws on non-numeric slot counts and on a non-object body', async () => {
    mockGet.mockResolvedValue(slotsResponse({ usedSlots: 'many' }));
    await expect(VoiceProfileService.getVoiceSlots()).rejects.toThrow(
      /numeric values are invalid/,
    );
    mockGet.mockResolvedValue(null);
    await expect(VoiceProfileService.getVoiceSlots()).rejects.toThrow(
      /expected object/,
    );
  });

  it('rethrows client errors', async () => {
    const error = apiErrorFromResponse(401, {});
    mockGet.mockRejectedValue(error);
    await expect(VoiceProfileService.getVoiceSlots()).rejects.toBe(error);
  });
});

// ============================================================================
// Profile CRUD
// ============================================================================

describe('VoiceProfileService.getMyVoiceProfiles', () => {
  it('GETs /voice-profiles and parses every public profile', async () => {
    mockGet.mockResolvedValue([
      publicProfile({
        status: 'READY',
        voiceId: 'cartesia-voice-1',
        sampleAudioUrl: 'https://storage.googleapis.com/sesly/sample.mp3',
        consentAt: '2026-09-20T10:05:00.000Z',
      }),
      publicProfile({
        id: 'vp-2',
        name: 'Anlatici Deniz',
        provider: 'GOOGLE',
        kind: 'PRESET',
        voiceId: 'tr-TR-Wavenet-A',
        status: 'READY',
        language: 'tr-TR',
      }),
    ]);

    const profiles = await VoiceProfileService.getMyVoiceProfiles();

    expect(mockGet).toHaveBeenCalledWith('/voice-profiles');
    expect(profiles).toHaveLength(2);
    expect(profiles[0]).toMatchObject({
      id: 'vp-1',
      status: VoiceProfileStatus.READY,
      provider: TTSProvider.CARTESIA,
      kind: 'CLONE',
      sampleAudioUrl: 'https://storage.googleapis.com/sesly/sample.mp3',
      errorMessage: null,
    });
    expect(profiles[0].consentAt).toEqual(new Date('2026-09-20T10:05:00.000Z'));
    expect(profiles[0].createdAt).toEqual(new Date('2026-09-20T10:00:00.000Z'));
    expect(profiles[1]).toMatchObject({ kind: 'PRESET', voiceId: 'tr-TR-Wavenet-A' });
    // Extra backend fields (userId, profileIcon, isPremium) are not surfaced.
    expect(profiles[1]).not.toHaveProperty('isPremium');
    // No `contentLanguage` in this (older) response: every voice is Turkish.
    expect(profiles.map(p => p.contentLanguage)).toEqual(['tr', 'tr']);
  });

  it('reads the content language of every voice and can ask for one language', async () => {
    mockGet.mockResolvedValue([
      publicProfile({ status: 'READY', language: 'en-US', contentLanguage: 'en' }),
    ]);

    const profiles = await VoiceProfileService.getMyVoiceProfiles('en');

    expect(mockGet).toHaveBeenCalledWith('/voice-profiles', { params: { language: 'en' } });
    expect(profiles[0].contentLanguage).toBe('en');
  });

  it('throws when the body is not an array', async () => {
    mockGet.mockResolvedValue({ data: [] });
    await expect(VoiceProfileService.getMyVoiceProfiles()).rejects.toThrow(
      'Invalid response: expected array',
    );
  });

  it('throws when one profile is invalid (strict parse)', async () => {
    mockGet.mockResolvedValue([publicProfile(), publicProfile({ voiceId: '' })]);
    await expect(VoiceProfileService.getMyVoiceProfiles()).rejects.toThrow(
      /voiceId/,
    );
  });
});

describe('VoiceProfileService.createVoiceProfile', () => {
  const presetRequest = {
    name: 'Anlatici Deniz',
    provider: TTSProvider.GOOGLE,
    voiceId: 'tr-TR-Wavenet-A',
    language: 'tr-TR',
  };

  it('POSTs /voice-profiles/v2 and returns the profile from the envelope', async () => {
    mockPost.mockResolvedValue({
      profile: publicProfile({
        id: 'vp-9',
        name: 'Anlatici Deniz',
        provider: 'GOOGLE',
        kind: 'PRESET',
        voiceId: 'tr-TR-Wavenet-A',
        status: 'READY',
      }),
      availableVoices: [],
    });

    const profile = await VoiceProfileService.createVoiceProfile(presetRequest);

    expect(mockPost).toHaveBeenCalledWith('/voice-profiles/v2', {
      name: 'Anlatici Deniz',
      provider: 'GOOGLE',
      voiceId: 'tr-TR-Wavenet-A',
      language: 'tr-TR',
    });
    expect(profile.id).toBe('vp-9');
    expect(profile.status).toBe(VoiceProfileStatus.READY);
  });

  it('starts a clone with the placeholder voice id', async () => {
    mockPost.mockResolvedValue({ profile: publicProfile(), availableVoices: [] });
    const profile = await VoiceProfileService.createVoiceProfile({
      name: 'Annemin sesi',
      provider: TTSProvider.CARTESIA,
      voiceId: 'custom-cloning-pending',
      language: 'tr',
    });
    expect(mockPost.mock.calls[0][1]).toMatchObject({
      provider: 'CARTESIA',
      voiceId: 'custom-cloning-pending',
    });
    expect(profile.status).toBe(VoiceProfileStatus.PENDING);
  });

  it.each([
    ['a bare profile (no envelope)', publicProfile()],
    ['null', null],
    ['a string', 'ok'],
  ])('throws on an invalid envelope: %s', async (_label, body) => {
    mockPost.mockResolvedValue(body);
    await expect(
      VoiceProfileService.createVoiceProfile(presetRequest),
    ).rejects.toThrow(/Invalid response format/);
  });

  it('validates required fields without calling the backend', async () => {
    await expect(
      VoiceProfileService.createVoiceProfile({ ...presetRequest, name: '' }),
    ).rejects.toThrow('Missing required field: name');
    await expect(
      VoiceProfileService.createVoiceProfile({
        ...presetRequest,
        provider: '' as TTSProvider,
      }),
    ).rejects.toThrow('Missing required field: provider');
    await expect(
      VoiceProfileService.createVoiceProfile({ ...presetRequest, voiceId: '' }),
    ).rejects.toThrow('Missing required field: voiceId');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('rethrows slot-limit errors with their code', async () => {
    const error = apiErrorFromResponse(403, {
      code: 'PRESET_SLOT_LIMIT',
      limit: 3,
      message: 'Hazir ses hakkin doldu.',
    });
    mockPost.mockRejectedValue(error);
    await expect(
      VoiceProfileService.createVoiceProfile(presetRequest),
    ).rejects.toMatchObject({ status: 403, code: 'PRESET_SLOT_LIMIT' });
  });
});

describe('VoiceProfileService.deleteVoiceProfile', () => {
  it('DELETEs /voice-profiles/:id', async () => {
    mockDelete.mockResolvedValue({ success: true });
    await expect(VoiceProfileService.deleteVoiceProfile('vp-1')).resolves.toBeUndefined();
    expect(mockDelete).toHaveBeenCalledWith('/voice-profiles/vp-1');
  });

  it('requires an id and rethrows errors', async () => {
    await expect(VoiceProfileService.deleteVoiceProfile('')).rejects.toThrow(
      'Voice profile ID is required',
    );
    const error = apiErrorFromResponse(404, { message: 'Ses profili bulunamadi.' });
    mockDelete.mockRejectedValue(error);
    await expect(VoiceProfileService.deleteVoiceProfile('vp-x')).rejects.toBe(error);
  });
});

// ============================================================================
// Available voices + preview
// ============================================================================

describe('VoiceProfileService.getAvailableVoices', () => {
  it('asks for the narrators of a content language', async () => {
    mockGet.mockResolvedValue([
      {
        provider: 'GOOGLE',
        voices: [
          {
            id: 'en-US-Chirp3-HD-Achernar',
            name: 'Achernar',
            languageCode: 'en-US',
            contentLanguage: 'en',
            gender: 'female',
          },
        ],
      },
    ]);

    const voices = await VoiceProfileService.getAvailableVoices('en');

    expect(mockGet).toHaveBeenCalledWith('/voice-profiles/available-voices', {
      params: { language: 'en' },
    });
    expect(voices.cartesia).toEqual([]);
    expect(voices.google).toHaveLength(1);
    expect(voices.google[0]).toMatchObject({
      voiceId: 'en-US-Chirp3-HD-Achernar',
      name: 'Achernar',
      contentLanguage: 'en',
      gender: 'female',
    });
  });

  it('without a language sends no query, and keeps only Chirp 3 voices with bare names', async () => {
    mockGet.mockResolvedValue({
      google: [
        { id: 'tr-TR-Wavenet-A', name: 'Deniz', provider: 'GOOGLE', isPremium: true },
        { id: 'tr-TR-Standard-B', name: 'Ali', provider: 'GOOGLE', isPremium: false },
        { id: 'tr-TR-Chirp3-HD-Kore', name: 'Chirp3 Kore (HD)', provider: 'GOOGLE', isPremium: true },
        { name: 'no id' },
      ],
    });

    const voices = await VoiceProfileService.getAvailableVoices();

    expect(mockGet).toHaveBeenCalledWith('/voice-profiles/available-voices', undefined);
    expect(voices.google.map(v => [v.id, v.name])).toEqual([['tr-TR-Chirp3-HD-Kore', 'Kore']]);
  });

  it('rethrows client errors', async () => {
    const error = apiErrorFromResponse(undefined, null);
    mockGet.mockRejectedValue(error);
    await expect(VoiceProfileService.getAvailableVoices()).rejects.toBe(error);
  });
});

describe('VoiceProfileService.previewVoice', () => {
  it('POSTs voiceId + provider and returns the preview payload', async () => {
    const body = {
      audioUrl: 'https://storage.googleapis.com/sesly/voice-previews/a.mp3',
      voiceId: 'tr-TR-Wavenet-A',
      provider: 'GOOGLE',
      cached: true,
    };
    mockPost.mockResolvedValue(body);

    await expect(
      VoiceProfileService.previewVoice('tr-TR-Wavenet-A', 'GOOGLE'),
    ).resolves.toEqual(body);
    expect(mockPost).toHaveBeenCalledWith('/voice-profiles/preview', {
      voiceId: 'tr-TR-Wavenet-A',
      provider: 'GOOGLE',
    });
  });

  it('rethrows 403 PREVIEW_NOT_ALLOWED', async () => {
    const error = apiErrorFromResponse(403, {
      code: 'PREVIEW_NOT_ALLOWED',
      message: 'Bu ses icin onizleme yapilamaz.',
    });
    mockPost.mockRejectedValue(error);
    await expect(
      VoiceProfileService.previewVoice('someone-elses-clone', 'CARTESIA'),
    ).rejects.toBe(error);
  });
});

// ============================================================================
// Status + sample
// ============================================================================

describe('VoiceProfileService.getVoiceProfileStatus', () => {
  it('GETs /voice-profiles/:id/status and parses the backend status shape', async () => {
    mockGet.mockResolvedValue({
      id: 'vp-1',
      name: 'Annemin sesi',
      status: 'READY',
      progress: 100,
      provider: 'CARTESIA',
      kind: 'CLONE',
      voiceId: 'cartesia-voice-1',
      sampleAudioUrl: 'gs://bucket/sample.mp3',
      consentAt: '2026-09-20T10:05:00.000Z',
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:06:00.000Z',
      errorMessage: null,
    });

    const status = await VoiceProfileService.getVoiceProfileStatus('vp-1');

    expect(mockGet).toHaveBeenCalledWith('/voice-profiles/vp-1/status');
    expect(status).toEqual({
      id: 'vp-1',
      name: 'Annemin sesi',
      status: VoiceProfileStatus.READY,
      progress: 100,
      provider: TTSProvider.CARTESIA,
      voiceId: 'cartesia-voice-1',
      // A backend that does not send the voice language yet.
      contentLanguage: null,
      createdAt: new Date('2026-09-20T10:00:00.000Z'),
      updatedAt: new Date('2026-09-20T10:06:00.000Z'),
      errorMessage: null,
    });
  });

  it('reads the voice language of a status response', async () => {
    mockGet.mockResolvedValue({ id: 'vp-1', status: 'PROCESSING', contentLanguage: 'EN' });
    const status = await VoiceProfileService.getVoiceProfileStatus('vp-1');
    expect(status.contentLanguage).toBe('en');
  });

  it('tolerates a sparse training payload', async () => {
    mockGet.mockResolvedValue({
      voiceProfileId: 'vp-2',
      status: 'PROCESSING',
      error: 'Kayit kisa',
    });
    const status = await VoiceProfileService.getVoiceProfileStatus('vp-2');
    expect(status).toMatchObject({
      id: 'vp-2',
      name: '',
      status: VoiceProfileStatus.PROCESSING,
      progress: 0,
      provider: 'GOOGLE',
      voiceId: '',
      errorMessage: 'Kayit kisa',
    });
  });

  it('throws "not found" when the body is a 404 error envelope', async () => {
    mockGet.mockResolvedValue({
      statusCode: 404,
      message: 'Ses profili bulunamadi.',
      success: false,
    });
    await expect(VoiceProfileService.getVoiceProfileStatus('vp-x')).rejects.toThrow(
      'Voice profile not found',
    );
  });

  it('throws with the HTTP status for other error envelopes', async () => {
    mockGet.mockResolvedValue({ statusCode: 500, message: 'boom' });
    await expect(VoiceProfileService.getVoiceProfileStatus('vp-x')).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it('requires an id and rethrows client errors', async () => {
    await expect(VoiceProfileService.getVoiceProfileStatus('')).rejects.toThrow(
      'Voice profile ID is required',
    );
    const error = apiErrorFromResponse(404, { message: 'Ses profili bulunamadi.' });
    mockGet.mockRejectedValue(error);
    await expect(VoiceProfileService.getVoiceProfileStatus('vp-x')).rejects.toBe(error);
  });
});

describe('VoiceProfileService.getVoiceSample', () => {
  it('returns only the audioUrl from the backend payload', async () => {
    mockGet.mockResolvedValue({
      audioUrl: 'https://storage.googleapis.com/sesly/sample.mp3?sig=1',
      cached: true,
    });
    await expect(VoiceProfileService.getVoiceSample('vp-1')).resolves.toEqual({
      audioUrl: 'https://storage.googleapis.com/sesly/sample.mp3?sig=1',
    });
    expect(mockGet).toHaveBeenCalledWith('/voice-profiles/vp-1/sample');
  });

  it.each([
    ['audioUrl null (backend preview failed)', { audioUrl: null, message: 'Preview generation failed.' }],
    ['empty audioUrl', { audioUrl: '' }],
    ['missing audioUrl', { cached: false }],
    ['null body', null],
    ['string body', 'https://x'],
  ])('returns null for %s', async (_label, body) => {
    mockGet.mockResolvedValue(body);
    await expect(VoiceProfileService.getVoiceSample('vp-1')).resolves.toBeNull();
  });

  it('returns null instead of throwing on client errors', async () => {
    mockGet.mockRejectedValue(apiErrorFromResponse(404, {}));
    await expect(VoiceProfileService.getVoiceSample('vp-1')).resolves.toBeNull();
  });

  it('still requires an id', async () => {
    await expect(VoiceProfileService.getVoiceSample('')).rejects.toThrow(
      'Voice profile ID is required',
    );
    expect(mockGet).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Voice languages: clone config per language
// ============================================================================

describe('VoiceProfileService.getCloneConfig in a voice language', () => {
  const englishConfig = {
    enabled: true,
    language: 'en',
    locale: 'en-US',
    supportedLanguages: [
      { code: 'tr', locale: 'tr-TR', nativeName: 'Türkçe', englishName: 'Turkish' },
      { code: 'en', locale: 'en-US', nativeName: 'English', englishName: 'English' },
    ],
    scriptTitle: 'The Sleepy Bear',
    script: 'Once upon a time.',
    consentVersion: 'en-2026-10',
    consentTitle: 'Voice recording consent',
    consentText: 'First paragraph.',
  };

  it('sends the language and reads the texts, the locale and the supported languages', async () => {
    mockGet.mockResolvedValue(englishConfig);

    const config = await VoiceProfileService.getCloneConfig('en');

    expect(mockGet).toHaveBeenCalledWith('/voice-profiles/clone-config', {
      params: { language: 'en' },
    });
    expect(config.language).toBe('en');
    expect(config.locale).toBe('en-US');
    expect(config.consentVersion).toBe('en-2026-10');
    expect(config.supportedLanguages.map(language => language.nativeName)).toEqual([
      'Türkçe',
      'English',
    ]);
  });

  it('asks without a parameter when no language is given', async () => {
    mockGet.mockResolvedValue({ ...englishConfig, language: 'tr', locale: 'tr-TR' });
    await VoiceProfileService.getCloneConfig(null);
    expect(mockGet).toHaveBeenCalledWith('/voice-profiles/clone-config');
  });

  it('passes a refused language on to the caller', async () => {
    const error = apiErrorFromResponse(400, {
      statusCode: 400,
      code: 'VOICE_LANGUAGE_NOT_SUPPORTED',
      message: 'Bu dilde ses kaydı desteklenmiyor.',
    });
    mockGet.mockRejectedValue(error);
    await expect(VoiceProfileService.getCloneConfig('de')).rejects.toBe(error);
  });
});
