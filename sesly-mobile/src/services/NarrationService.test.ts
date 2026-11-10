import { apiErrorFromResponse } from './ApiError';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();

jest.mock('./ApiClient', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

// Imported after the mock so the service picks up the mocked client.
import NarrationService, {
  NarrationAlreadyExistsError,
  toNarrationConflict,
} from './NarrationService';

describe('toNarrationConflict', () => {
  const conflict = (extra: Record<string, unknown>) =>
    apiErrorFromResponse(409, {
      statusCode: 409,
      message: 'Bu masal bu sesle zaten seslendirilmiş.',
      ...extra,
    });

  it('maps 409 NARRATION_EXISTS with existingNarrationId', () => {
    const result = toNarrationConflict(
      conflict({ code: 'NARRATION_EXISTS', existingNarrationId: 'n-1', status: 'READY' }),
    );
    expect(result).toBeInstanceOf(NarrationAlreadyExistsError);
    expect(result?.existingNarrationId).toBe('n-1');
    expect(result?.isReady).toBe(true);
    expect(result?.isInProgress).toBe(false);
  });

  it('flags GENERATING as in progress', () => {
    const result = toNarrationConflict(
      conflict({ code: 'NARRATION_EXISTS', existingNarrationId: 'n-2', status: 'GENERATING' }),
    );
    expect(result?.isInProgress).toBe(true);
  });

  it('still accepts the legacy NARRATION_ALREADY_EXISTS code', () => {
    expect(
      toNarrationConflict(
        conflict({ code: 'NARRATION_ALREADY_EXISTS', existingNarrationId: 'n-3', status: 'READY' }),
      ),
    ).not.toBeNull();
  });

  it('ignores other errors', () => {
    expect(toNarrationConflict(conflict({ code: 'SOMETHING_ELSE', existingNarrationId: 'x' }))).toBeNull();
    expect(toNarrationConflict(conflict({ code: 'NARRATION_EXISTS' }))).toBeNull();
    expect(toNarrationConflict(apiErrorFromResponse(403, { message: 'Limit' }))).toBeNull();
    expect(toNarrationConflict(new Error('x'))).toBeNull();
  });
});

describe('NarrationService', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('createNarration throws NarrationAlreadyExistsError on 409', async () => {
    mockPost.mockRejectedValue(
      apiErrorFromResponse(409, {
        message: 'Zaten var.',
        code: 'NARRATION_EXISTS',
        existingNarrationId: 'n-9',
        status: 'READY',
      }),
    );
    await expect(
      NarrationService.createNarration('s-1', 'v-1'),
    ).rejects.toBeInstanceOf(NarrationAlreadyExistsError);
  });

  it('createNarration only sends replace when true', async () => {
    mockPost.mockResolvedValue({ id: 'n-1', storyId: 's-1', status: 'PENDING' });
    await NarrationService.createNarration('s-1', 'v-1');
    expect(mockPost).toHaveBeenLastCalledWith('/narrations', {
      storyId: 's-1',
      voiceProfileId: 'v-1',
    });
    await NarrationService.createNarration('s-1', 'v-1', { replace: true });
    expect(mockPost).toHaveBeenLastCalledWith('/narrations', {
      storyId: 's-1',
      voiceProfileId: 'v-1',
      replace: true,
    });
  });

  it('getMyNarrations omits an empty search param', async () => {
    mockGet.mockResolvedValue({ data: [], page: 1, limit: 20, total: 0, totalPages: 0 });
    await NarrationService.getMyNarrations({ page: 1, limit: 20, search: '' });
    expect(mockGet).toHaveBeenLastCalledWith('/narrations', {
      params: { page: 1, limit: 20 },
    });
    await NarrationService.getMyNarrations({ page: 1, limit: 20, search: '  ' });
    expect(mockGet).toHaveBeenLastCalledWith('/narrations', {
      params: { page: 1, limit: 20 },
    });
    await NarrationService.getMyNarrations({ page: 2, limit: 20, search: 'kral' });
    expect(mockGet).toHaveBeenLastCalledWith('/narrations', {
      params: { page: 2, limit: 20, search: 'kral' },
    });
  });

  it('getMyNarrations returns an empty page on 404', async () => {
    mockGet.mockRejectedValue(apiErrorFromResponse(404, {}));
    const res = await NarrationService.getMyNarrations({ page: 1, limit: 20 });
    expect(res.data).toEqual([]);
    expect(res.meta.total).toBe(0);
  });
});

// ============================================================================
// Extended coverage
// ============================================================================

// Backend narration shape (narrations.service.ts toResponse): list-item story,
// public voice profile, totalDuration / duration / progress / audioStatus.
const backendNarration = (overrides: Record<string, unknown> = {}) => ({
  id: 'nar-1',
  userId: 'u-1',
  title: 'Kirmizi Baslikli Kiz',
  status: 'READY',
  storyId: 's-1',
  voiceProfileId: 'vp-1',
  audioId: 'aud-1',
  story: {
    id: 's-1',
    title: 'Kirmizi Baslikli Kiz',
    description: 'Bir varmis bir yokmus...',
    ageGroup: 'THREE_TO_SIX',
    category: 'WORLD_CLASSICS',
    language: 'tr',
    estimatedDuration: 8,
    coverImageUrl: null,
    isPremium: false,
    hasPreGeneratedNarration: false,
    isFavorite: false,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  },
  voiceProfile: {
    id: 'vp-1',
    userId: 'u-1',
    name: 'Annemin sesi',
    profileIcon: null,
    provider: 'CARTESIA',
    kind: 'CLONE',
    voiceId: 'cartesia-voice-1',
    language: 'tr',
    status: 'READY',
    isPremium: true,
    errorMessage: null,
    errorReason: null,
    sampleAudioUrl: null,
    consentAt: '2026-09-20T10:05:00.000Z',
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
  },
  errorMessage: null,
  totalDuration: 312.5,
  duration: 312.5,
  progress: 100,
  audioStatus: 'READY',
  createdAt: '2026-09-25T18:00:00.000Z',
  updatedAt: '2026-09-25T18:05:00.000Z',
  completedAt: '2026-09-25T18:05:00.000Z',
  ...overrides,
});

describe('NarrationService extended', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockDelete.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('createNarration', () => {
    it('parses the created narration from the backend response', async () => {
      mockPost.mockResolvedValue(
        backendNarration({
          status: 'PENDING',
          progress: 0,
          completedAt: null,
          totalDuration: 0,
          duration: null,
        }),
      );
      const narration = await NarrationService.createNarration('s-1', 'vp-1');
      expect(narration).toMatchObject({
        id: 'nar-1',
        storyId: 's-1',
        voiceProfileId: 'vp-1',
        status: 'PENDING',
        totalDuration: 0,
        completedAt: null,
      });
      expect(narration.story?.id).toBe('s-1');
      expect(narration.voiceProfile?.kind).toBe('CLONE');
    });

    it('sends the title option only when non-empty', async () => {
      mockPost.mockResolvedValue(backendNarration());
      await NarrationService.createNarration('s-1', 'vp-1', { title: 'Gece masali' });
      expect(mockPost).toHaveBeenLastCalledWith('/narrations', {
        storyId: 's-1',
        voiceProfileId: 'vp-1',
        title: 'Gece masali',
      });
      await NarrationService.createNarration('s-1', 'vp-1', { title: '', replace: false });
      expect(mockPost).toHaveBeenLastCalledWith('/narrations', {
        storyId: 's-1',
        voiceProfileId: 'vp-1',
      });
    });

    it('validates storyId and voiceProfileId', async () => {
      await expect(NarrationService.createNarration('', 'vp-1')).rejects.toThrow(
        'Story ID and Voice Profile ID are required',
      );
      await expect(NarrationService.createNarration('s-1', '')).rejects.toThrow(
        'Story ID and Voice Profile ID are required',
      );
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('rethrows non-409 errors unchanged', async () => {
      const quota = apiErrorFromResponse(403, {
        code: 'PREMIUM_STORY',
        message: 'Bu masal Sesly Pro ile dinlenebilir.',
      });
      mockPost.mockRejectedValue(quota);
      await expect(NarrationService.createNarration('s-1', 'vp-1')).rejects.toBe(quota);

      const network = apiErrorFromResponse(undefined, null);
      mockPost.mockRejectedValue(network);
      await expect(NarrationService.createNarration('s-1', 'vp-1')).rejects.toBe(network);
    });

    it('rethrows a 409 that is not the structured conflict unchanged', async () => {
      const other = apiErrorFromResponse(409, { message: 'Baska bir cakisma.' });
      mockPost.mockRejectedValue(other);
      await expect(NarrationService.createNarration('s-1', 'vp-1')).rejects.toBe(other);
    });

    it('rejects when the backend body is not an object', async () => {
      mockPost.mockResolvedValue(null);
      await expect(NarrationService.createNarration('s-1', 'vp-1')).rejects.toThrow(
        /expected object/,
      );
    });
  });

  describe('getMyNarrations', () => {
    it('uses default paging and parses the paginated backend payload', async () => {
      mockGet.mockResolvedValue({
        data: [
          backendNarration(),
          backendNarration({ id: 'nar-2', status: 'GENERATING', progress: 40 }),
        ],
        total: 7,
        page: 1,
        limit: 20,
        totalPages: 1,
      });

      const res = await NarrationService.getMyNarrations();

      expect(mockGet).toHaveBeenCalledWith('/narrations', { params: { page: 1, limit: 20 } });
      expect(res.data.map(n => n.id)).toEqual(['nar-1', 'nar-2']);
      expect(res.data[0].totalDuration).toBe(312.5);
      expect(res.data[0].updatedAt).toEqual(new Date('2026-09-25T18:05:00.000Z'));
      expect(res.meta).toEqual({ page: 1, limit: 20, total: 7, totalPages: 1 });
    });

    it('falls back to the requested paging and item count when meta is missing', async () => {
      mockGet.mockResolvedValue({ data: [backendNarration()] });

      const res = await NarrationService.getMyNarrations({ page: 3, limit: 5 });

      expect(res.meta).toEqual({ page: 3, limit: 5, total: 1, totalPages: 1 });
    });

    it('skips unparseable items instead of failing the page', async () => {
      mockGet.mockResolvedValue({
        data: [null, 'nar-x', backendNarration({ id: 'nar-3' }), 42],
        total: 4,
        page: 1,
        limit: 20,
        totalPages: 1,
      });

      const res = await NarrationService.getMyNarrations();

      expect(res.data.map(n => n.id)).toEqual(['nar-3']);
      expect(res.meta.total).toBe(4);
    });

    it('returns an empty page when data is not an array', async () => {
      mockGet.mockResolvedValue({ items: [backendNarration()], total: 1 });
      const res = await NarrationService.getMyNarrations();
      expect(res.data).toEqual([]);
      expect(res.meta.total).toBe(1);
    });

    it('throws on a non-object body and rethrows non-404 errors', async () => {
      mockGet.mockResolvedValue('nope');
      await expect(NarrationService.getMyNarrations()).rejects.toThrow(
        'Invalid response: expected paginated object',
      );

      const error = apiErrorFromResponse(500, {});
      mockGet.mockRejectedValue(error);
      await expect(NarrationService.getMyNarrations()).rejects.toBe(error);
    });

    it('returns an empty page on 404 with the requested paging', async () => {
      mockGet.mockRejectedValue(apiErrorFromResponse(404, {}));
      await expect(NarrationService.getMyNarrations({ page: 4, limit: 10 })).resolves.toEqual({
        data: [],
        meta: { page: 4, limit: 10, total: 0, totalPages: 0 },
      });
    });
  });

  describe('getNarrationsByStory', () => {
    it('GETs /narrations/story/:storyId and parses the array', async () => {
      mockGet.mockResolvedValue([backendNarration(), backendNarration({ id: 'nar-2' })]);
      const list = await NarrationService.getNarrationsByStory('s-1');
      expect(mockGet).toHaveBeenCalledWith('/narrations/story/s-1');
      expect(list.map(n => n.id)).toEqual(['nar-1', 'nar-2']);
    });

    it('requires an array body', async () => {
      mockGet.mockResolvedValue({ data: [backendNarration()] });
      await expect(NarrationService.getNarrationsByStory('s-1')).rejects.toThrow(
        'Invalid response: expected array',
      );
    });

    it('returns [] on 404 and rethrows other errors', async () => {
      mockGet.mockRejectedValue(apiErrorFromResponse(404, {}));
      await expect(NarrationService.getNarrationsByStory('s-1')).resolves.toEqual([]);

      const error = apiErrorFromResponse(403, {});
      mockGet.mockRejectedValue(error);
      await expect(NarrationService.getNarrationsByStory('s-1')).rejects.toBe(error);
    });

    it('validates the story id', async () => {
      await expect(NarrationService.getNarrationsByStory('')).rejects.toThrow(
        'Story ID is required',
      );
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('fills in the story id the route leaves out, and keeps one it sends', async () => {
      // findByStory answers without storyId (narrations.service.ts).
      const withoutStory = { ...backendNarration({ id: 'nar-3' }) } as Record<string, unknown>;
      delete withoutStory.storyId;
      mockGet.mockResolvedValue([withoutStory, backendNarration({ id: 'nar-4', storyId: 's-9' })]);

      const list = await NarrationService.getNarrationsByStory('s-1');

      expect(list.map(n => [n.id, n.storyId])).toEqual([
        ['nar-3', 's-1'],
        ['nar-4', 's-9'],
      ]);
    });

    it('skips an item that cannot be parsed and keeps the rest', async () => {
      mockGet.mockResolvedValue([null, backendNarration({ id: 'nar-5' })]);
      const list = await NarrationService.getNarrationsByStory('s-1');
      expect(list.map(n => n.id)).toEqual(['nar-5']);
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('getNarrationById', () => {
    it('GETs /narrations/:id and parses it', async () => {
      mockGet.mockResolvedValue(backendNarration({ totalDuration: 0, duration: 250 }));
      const narration = await NarrationService.getNarrationById('nar-1');
      expect(mockGet).toHaveBeenCalledWith('/narrations/nar-1');
      expect(narration.id).toBe('nar-1');
      // totalDuration 0 means unknown: falls back to duration.
      expect(narration.totalDuration).toBe(250);
    });

    it('validates the id and rethrows errors (including 404)', async () => {
      await expect(NarrationService.getNarrationById('')).rejects.toThrow(
        'Narration ID is required',
      );
      const error = apiErrorFromResponse(404, {});
      mockGet.mockRejectedValue(error);
      await expect(NarrationService.getNarrationById('nar-x')).rejects.toBe(error);
    });
  });

  describe('getNarrationStatus', () => {
    it('GETs /narrations/:id/status and returns the snapshot', async () => {
      mockGet.mockResolvedValue({
        status: 'READY',
        progress: 100,
        audioUrl: 'https://storage.googleapis.com/sesly/audio/aud-1/final.mp3',
        errorMessage: null,
        extra: 'ignored',
      });
      await expect(NarrationService.getNarrationStatus('nar-1')).resolves.toEqual({
        status: 'READY',
        progress: 100,
        audioUrl: 'https://storage.googleapis.com/sesly/audio/aud-1/final.mp3',
        errorMessage: null,
      });
      expect(mockGet).toHaveBeenCalledWith('/narrations/nar-1/status');
    });

    it('defaults missing or invalid fields', async () => {
      mockGet.mockResolvedValue({ status: 7, progress: '50', audioUrl: '', errorMessage: '' });
      await expect(NarrationService.getNarrationStatus('nar-1')).resolves.toEqual({
        status: 'PENDING',
        progress: 0,
        audioUrl: null,
        errorMessage: null,
      });
    });

    it('keeps a FAILED error message', async () => {
      mockGet.mockResolvedValue({
        status: 'FAILED',
        progress: 35,
        errorMessage: 'Masal hazirlanamadi.',
      });
      const snapshot = await NarrationService.getNarrationStatus('nar-1');
      expect(snapshot).toMatchObject({
        status: 'FAILED',
        progress: 35,
        errorMessage: 'Masal hazirlanamadi.',
      });
    });

    it('throws on a non-object body, a missing id, and rethrows errors', async () => {
      mockGet.mockResolvedValue(null);
      await expect(NarrationService.getNarrationStatus('nar-1')).rejects.toThrow(
        'Invalid narration status response',
      );
      await expect(NarrationService.getNarrationStatus('')).rejects.toThrow(
        'Narration ID is required',
      );
      const error = apiErrorFromResponse(404, {});
      mockGet.mockRejectedValue(error);
      await expect(NarrationService.getNarrationStatus('nar-x')).rejects.toBe(error);
    });
  });

  describe('generateAudio', () => {
    it('POSTs /narrations/:id/generate', async () => {
      mockPost.mockResolvedValue({ status: 'GENERATING' });
      await expect(NarrationService.generateAudio('nar-1')).resolves.toBeUndefined();
      expect(mockPost).toHaveBeenCalledWith('/narrations/nar-1/generate');
    });

    it('validates the id and rethrows errors', async () => {
      await expect(NarrationService.generateAudio('')).rejects.toThrow(
        'Narration ID is required',
      );
      const error = apiErrorFromResponse(429, {});
      mockPost.mockRejectedValue(error);
      await expect(NarrationService.generateAudio('nar-1')).rejects.toBe(error);
    });
  });

  describe('deleteNarration', () => {
    it('DELETEs /narrations/:id', async () => {
      mockDelete.mockResolvedValue({ success: true });
      await expect(NarrationService.deleteNarration('nar-1')).resolves.toBeUndefined();
      expect(mockDelete).toHaveBeenCalledWith('/narrations/nar-1');
    });

    it('validates the id and rethrows errors', async () => {
      await expect(NarrationService.deleteNarration('')).rejects.toThrow(
        'Narration ID is required',
      );
      expect(mockDelete).not.toHaveBeenCalled();
      const error = apiErrorFromResponse(404, {});
      mockDelete.mockRejectedValue(error);
      await expect(NarrationService.deleteNarration('nar-x')).rejects.toBe(error);
    });
  });

  describe('NarrationAlreadyExistsError', () => {
    it('has a default message and flags PENDING as in progress', () => {
      const error = new NarrationAlreadyExistsError('nar-1', 'PENDING');
      expect(error.message).toBeTruthy();
      expect(error.name).toBe('NarrationAlreadyExistsError');
      expect(error.isInProgress).toBe(true);
      expect(error.isReady).toBe(false);
    });

    it('maps a 409 without a status to UNKNOWN', () => {
      const result = toNarrationConflict(
        apiErrorFromResponse(409, { existingNarrationId: 'n-7' }),
      );
      expect(result?.existingStatus).toBe('UNKNOWN');
      expect(result?.isReady).toBe(false);
      expect(result?.isInProgress).toBe(false);
    });
  });
});
