import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PlaylistsService } from './playlists.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createSettingsStub } from '../../test-utils/settings-stub';

const USER = 'user-1';
const OTHER_USER = 'user-2';
const PL = 'pl-1';
const NOW = new Date('2026-09-28T12:00:00.000Z');

const PLAYLIST_KEYS = ['createdAt', 'id', 'isDefault', 'itemCount', 'name', 'updatedAt', 'userId'].sort();
const ITEM_KEYS = [
  'availableLanguages',
  'createdAt',
  'language',
  'id',
  'narration',
  'narrationId',
  'playlistId',
  'position',
  'story',
  'storyId',
  'voiceProfile',
  'voiceProfileId',
].sort();

const ITEM_INCLUDE = {
  narration: {
    select: {
      id: true,
      status: true,
      storyId: true,
      audio: { select: { duration: true, audioUrl: true } },
      story: { select: { id: true, language: true, translationGroupId: true } },
    },
  },
  story: {
    select: {
      id: true,
      title: true,
      coverImageUrl: true,
      category: true,
      estimatedDuration: true,
      language: true,
      translationGroupId: true,
    },
  },
  voiceProfile: {
    select: { id: true, name: true, sampleAudioUrl: true },
  },
};

function playlistRow(overrides: Partial<any> = {}) {
  return {
    id: PL,
    userId: USER,
    name: 'Bu gece',
    isDefault: false,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-02T00:00:00Z'),
    _count: { items: 2 },
    ...overrides,
  };
}

function storyItem(overrides: Partial<any> = {}) {
  return {
    id: 'item-s',
    playlistId: PL,
    narrationId: null,
    storyId: 'story-1',
    voiceProfileId: 'voice-1',
    position: 0,
    createdAt: new Date('2026-09-03T00:00:00Z'),
    narration: null,
    story: {
      id: 'story-1',
      title: 'Keloglan',
      coverImageUrl: 'https://storage.googleapis.com/bucket/stories/covers/story-1.png',
      category: 'TURKISH_CLASSICS',
      estimatedDuration: 5,
      language: 'tr',
      translationGroupId: 'g1',
    },
    voiceProfile: { id: 'voice-1', name: 'Anne', sampleAudioUrl: null },
    ...overrides,
  };
}

function narrationItem(overrides: Partial<any> = {}) {
  return {
    id: 'item-n',
    playlistId: PL,
    narrationId: 'narr-1',
    storyId: null,
    voiceProfileId: null,
    position: 1,
    createdAt: new Date('2026-09-03T00:00:00Z'),
    narration: {
      id: 'narr-1',
      status: 'READY',
      storyId: 'story-1',
      audio: { duration: 312, audioUrl: 'audio/narr-1/final.mp3' },
      story: { id: 'story-9', language: 'en', translationGroupId: null },
    },
    story: null,
    voiceProfile: null,
    ...overrides,
  };
}

describe('PlaylistsService', () => {
  let prisma: MockPrismaService;
  let storage: { getReadUrl: jest.Mock };
  let service: PlaylistsService;

  beforeAll(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout', 'setInterval'],
    });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    prisma = createMockPrismaService();
    storage = {
      getReadUrl: jest.fn(async (value: string | null | undefined) => (value ? `signed:${value}` : null)),
    };
    service = new PlaylistsService(prisma as any, storage as any, createSettingsStub() as any);

    // No other language version is published unless a test says so.
    prisma.story.findMany.mockResolvedValue([]);

    // Ownership check succeeds by default (owned, non-default playlist).
    prisma.playlist.findFirst.mockResolvedValue({ id: PL, isDefault: false });
    // Array-form transactions: return each op's (already resolved) value.
    prisma.$transaction.mockImplementation(async (ops: any[]) => Promise.all(ops));
    prisma.playlist.updateMany.mockResolvedValue({ count: 1 });
    prisma.playlist.update.mockResolvedValue(playlistRow());
    prisma.playlist.create.mockImplementation(async ({ data }: any) => playlistRow({ ...data, _count: { items: 0 } }));
  });

  function expectOwnershipLookup(userId = USER, playlistId = PL) {
    expect(prisma.playlist.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: playlistId, userId } }),
    );
  }

  // -----------------------------------------------------------------
  // Playlists
  // -----------------------------------------------------------------
  describe('list', () => {
    it('lists only the caller\'s playlists, recently updated first, with itemCount', async () => {
      prisma.playlist.findMany.mockResolvedValue([playlistRow(), playlistRow({ id: 'pl-2', _count: undefined })]);

      const res = await service.list(USER);

      expect(prisma.playlist.findMany).toHaveBeenCalledWith({
        where: { userId: USER },
        orderBy: { updatedAt: 'desc' },
        include: { _count: { select: { items: true } } },
      });
      expect(res).toHaveLength(2);
      expect(Object.keys(res[0]).sort()).toEqual(PLAYLIST_KEYS);
      expect(res[0].itemCount).toBe(2);
      expect(res[1].itemCount).toBe(0);
      expect(res[0]).not.toHaveProperty('_count');
    });
  });

  describe('create', () => {
    it('non-default: plain create owned by the caller, no transaction', async () => {
      const res = await service.create(USER, { name: 'Yeni' });

      expect(prisma.playlist.create).toHaveBeenCalledWith({
        data: { userId: USER, name: 'Yeni', isDefault: false },
        include: { _count: { select: { items: true } } },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.playlist.updateMany).not.toHaveBeenCalled();
      expect(Object.keys(res).sort()).toEqual(PLAYLIST_KEYS);
      expect(res).toMatchObject({ userId: USER, name: 'Yeni', isDefault: false, itemCount: 0 });
    });

    it('isDefault false is treated as non-default', async () => {
      await service.create(USER, { name: 'Yeni', isDefault: false });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.playlist.create.mock.calls[0][0].data.isDefault).toBe(false);
    });

    it('default: demotes the caller\'s other defaults and creates in one transaction', async () => {
      const res = await service.create(USER, { name: 'Varsayilan', isDefault: true });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
      expect(prisma.playlist.updateMany).toHaveBeenCalledWith({
        where: { userId: USER, isDefault: true },
        data: { isDefault: false },
      });
      expect(prisma.playlist.create).toHaveBeenCalledWith({
        data: { userId: USER, name: 'Varsayilan', isDefault: true },
        include: { _count: { select: { items: true } } },
      });
      expect(res.isDefault).toBe(true);
      expect(res.name).toBe('Varsayilan');
    });
  });

  describe('getOne', () => {
    it('returns the caller\'s playlist (lookup scoped by userId)', async () => {
      prisma.playlist.findFirst.mockResolvedValue(playlistRow());

      const res = await service.getOne(USER, PL);

      expect(prisma.playlist.findFirst).toHaveBeenCalledWith({
        where: { id: PL, userId: USER },
        include: { _count: { select: { items: true } } },
      });
      expect(Object.keys(res).sort()).toEqual(PLAYLIST_KEYS);
    });

    it('404 for a missing playlist or one owned by another user (no existence leak)', async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);

      const err = await service.getOne(OTHER_USER, PL).catch((e) => e);

      expect(err).toBeInstanceOf(NotFoundException);
      expectOwnershipLookup(OTHER_USER);
    });
  });

  describe('update', () => {
    it('404 when not owned; nothing is written', async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);

      await expect(service.update(OTHER_USER, PL, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
      expectOwnershipLookup(OTHER_USER);
      expect(prisma.playlist.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rename only: plain update of the name', async () => {
      await service.update(USER, PL, { name: 'Yeni ad' });

      expect(prisma.playlist.update).toHaveBeenCalledWith({
        where: { id: PL },
        data: { name: 'Yeni ad' },
        include: { _count: { select: { items: true } } },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('promote to default: demote siblings (excluding self) + update in one transaction', async () => {
      prisma.playlist.update.mockResolvedValue(playlistRow({ isDefault: true }));

      const res = await service.update(USER, PL, { isDefault: true });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.playlist.updateMany).toHaveBeenCalledWith({
        where: { userId: USER, isDefault: true, NOT: { id: PL } },
        data: { isDefault: false },
      });
      expect(prisma.playlist.update).toHaveBeenCalledWith({
        where: { id: PL },
        data: { isDefault: true },
        include: { _count: { select: { items: true } } },
      });
      expect(res.isDefault).toBe(true);
    });

    it('already default + isDefault true: no sibling demotion transaction', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: PL, isDefault: true });

      await service.update(USER, PL, { isDefault: true });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.playlist.updateMany).not.toHaveBeenCalled();
      expect(prisma.playlist.update.mock.calls[0][0].data).toEqual({ isDefault: true });
    });

    it('un-default is allowed and touches no siblings', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: PL, isDefault: true });

      await service.update(USER, PL, { isDefault: false });

      expect(prisma.playlist.updateMany).not.toHaveBeenCalled();
      expect(prisma.playlist.update.mock.calls[0][0].data).toEqual({ isDefault: false });
    });

    it('returns the playlist response shape', async () => {
      const res = await service.update(USER, PL, { name: 'x' });

      expect(Object.keys(res).sort()).toEqual(PLAYLIST_KEYS);
    });
  });

  describe('remove', () => {
    it('404 when not owned; nothing is deleted', async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);

      await expect(service.remove(OTHER_USER, PL)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.playlist.delete).not.toHaveBeenCalled();
    });

    it('deletes by id after the ownership check', async () => {
      prisma.playlist.delete.mockResolvedValue({});

      await expect(service.remove(USER, PL)).resolves.toBeUndefined();
      expectOwnershipLookup();
      expect(prisma.playlist.delete).toHaveBeenCalledWith({ where: { id: PL } });
    });
  });

  // -----------------------------------------------------------------
  // Items
  // -----------------------------------------------------------------
  describe('listItems', () => {
    it('404 when not owned; items are never read', async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);

      await expect(service.listItems(OTHER_USER, PL, {})).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.playlistItem.findMany).not.toHaveBeenCalled();
    });

    it('reads items ordered by position, paginated (normalized), with narrow relation selects', async () => {
      prisma.playlistItem.findMany.mockResolvedValue([]);
      prisma.playlistItem.count.mockResolvedValue(0);

      const res = await service.listItems(USER, PL, { page: 2, limit: 500 });

      expect(prisma.playlistItem.findMany).toHaveBeenCalledWith({
        where: { playlistId: PL },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        skip: 100,
        take: 100,
        include: ITEM_INCLUDE,
      });
      expect(prisma.playlistItem.count).toHaveBeenCalledWith({ where: { playlistId: PL } });
      expect(res).toEqual({ data: [], total: 0, page: 2, limit: 100, totalPages: 0 });
    });

    it('maps story and narration items to the item DTO', async () => {
      prisma.playlistItem.findMany.mockResolvedValue([storyItem(), narrationItem()]);
      prisma.playlistItem.count.mockResolvedValue(2);
      prisma.story.findMany.mockResolvedValue([
        { id: 'story-1', language: 'tr', translationGroupId: 'g1' },
        { id: 'story-1-en', language: 'en', translationGroupId: 'g1' },
      ]);

      const res = await service.listItems(USER, PL, { page: 1, limit: 20 });

      expect(res).toMatchObject({ total: 2, page: 1, limit: 20, totalPages: 1 });
      for (const item of res.data) {
        expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
      }
      const [s, n] = res.data;
      expect(s).toEqual({
        id: 'item-s',
        playlistId: PL,
        position: 0,
        narrationId: null,
        storyId: 'story-1',
        voiceProfileId: 'voice-1',
        // The tale of the story exists in two languages; its own comes first.
        language: 'tr',
        availableLanguages: ['tr', 'en'],
        narration: null,
        story: {
          id: 'story-1',
          title: 'Keloglan',
          // Readable URL (was the raw stored GCS URL before the fix).
          coverImageUrl: `signed:${storyItem().story.coverImageUrl}`,
          category: 'TURKISH_CLASSICS',
          estimatedDuration: 5,
        },
        voiceProfile: { id: 'voice-1', name: 'Anne', sampleAudioUrl: null },
        createdAt: storyItem().createdAt,
      });
      expect(n.narration).toEqual({
        id: 'narr-1',
        status: 'READY',
        duration: 312,
        finalAudioUrl: 'signed:audio/narr-1/final.mp3',
        storyId: 'story-1',
      });
      expect(n.story).toBeNull();
      expect(n.voiceProfile).toBeNull();
      // A narration item takes its language from the story it was made from.
      expect(n.language).toBe('en');
      expect(n.availableLanguages).toEqual(['en']);
      // One group query for the whole page.
      expect(prisma.story.findMany).toHaveBeenCalledTimes(1);
    });

    it('an item whose story is gone, or was read without a language, has no language and an empty list', async () => {
      prisma.playlistItem.findMany.mockResolvedValue([
        narrationItem({ narration: { id: 'narr-1', status: 'READY', storyId: 'story-1', audio: null, story: null } }),
        storyItem({ story: { id: 'story-1', title: 'Keloglan', coverImageUrl: null, category: 'BEDTIME', estimatedDuration: 5 } }),
      ]);
      prisma.playlistItem.count.mockResolvedValue(2);

      const res = await service.listItems(USER, PL, { page: 1, limit: 20 });

      expect(res.data.map((item) => [item.language, item.availableLanguages])).toEqual([
        [null, []],
        [null, []],
      ]);
      expect(prisma.story.findMany).not.toHaveBeenCalled();
    });

    it('a story of a group whose other versions are not published lists only its own language', async () => {
      prisma.playlistItem.findMany.mockResolvedValue([storyItem()]);
      prisma.playlistItem.count.mockResolvedValue(1);
      prisma.story.findMany.mockResolvedValue([]);

      const res = await service.listItems(USER, PL, { page: 1, limit: 20 });

      expect(res.data[0]).toMatchObject({ language: 'tr', availableLanguages: ['tr'] });
    });

    it('narration without audio yet maps duration/finalAudioUrl to null', async () => {
      prisma.playlistItem.findMany.mockResolvedValue([
        narrationItem({ narration: { id: 'narr-1', status: 'GENERATING', storyId: 'story-1', audio: null } }),
      ]);
      prisma.playlistItem.count.mockResolvedValue(1);

      const res = await service.listItems(USER, PL, {});

      expect(res.data[0].narration).toEqual({
        id: 'narr-1',
        status: 'GENERATING',
        duration: null,
        finalAudioUrl: null,
        storyId: 'story-1',
      });
    });

    it('filters ghost items (both FKs nulled) after pagination; total stays the raw count', async () => {
      prisma.playlistItem.findMany.mockResolvedValue([
        storyItem({ id: 'keep-1' }),
        storyItem({ id: 'ghost', storyId: null, story: null, narrationId: null, narration: null }),
        narrationItem({ id: 'keep-2' }),
      ]);
      prisma.playlistItem.count.mockResolvedValue(3);

      const res = await service.listItems(USER, PL, { page: 1, limit: 20 });

      expect(res.data.map((i) => i.id)).toEqual(['keep-1', 'keep-2']);
      expect(res.total).toBe(3);
    });

    // Fixed (was BUG): playlist items returned the raw stored GCS URLs (cover,
    // narration audio, voice sample), which the private bucket does not serve.
    // They now go through StorageService.getReadUrl like every other shape.
    it('story cover on playlist items is presigned like every other story shape', async () => {
      prisma.playlistItem.findMany.mockResolvedValue([storyItem()]);
      prisma.playlistItem.count.mockResolvedValue(1);

      const res = await service.listItems(USER, PL, {});

      expect(res.data[0].story!.coverImageUrl).not.toBe(storyItem().story.coverImageUrl);
      expect(storage.getReadUrl).toHaveBeenCalledWith(storyItem().story.coverImageUrl);
    });

    it('voice sample URL is readable too; missing URLs stay null', async () => {
      prisma.playlistItem.findMany.mockResolvedValue([
        storyItem({ voiceProfile: { id: 'voice-1', name: 'Anne', sampleAudioUrl: 'voice-samples/u/v/test-sample.mp3' } }),
        storyItem({ id: 'no-cover', story: { ...storyItem().story, coverImageUrl: null } }),
      ]);
      prisma.playlistItem.count.mockResolvedValue(2);

      const res = await service.listItems(USER, PL, {});

      expect(res.data[0].voiceProfile!.sampleAudioUrl).toBe('signed:voice-samples/u/v/test-sample.mp3');
      expect(res.data[1].story!.coverImageUrl).toBeNull();
    });
  });

  describe('addItem', () => {
    beforeEach(() => {
      prisma.story.findUnique.mockResolvedValue({ id: 'story-1' });
      prisma.storyNarration.findFirst.mockResolvedValue({ id: 'narr-1' });
      prisma.voiceProfile.findFirst.mockResolvedValue({ id: 'voice-1' });
      prisma.playlistItem.findFirst.mockResolvedValue({ position: 4 });
      prisma.playlistItem.create.mockImplementation(async ({ data }: any) =>
        data.narrationId
          ? narrationItem({ ...data, id: 'new-item' })
          : storyItem({ ...data, id: 'new-item', voiceProfile: data.voiceProfileId ? storyItem().voiceProfile : null }),
      );
    });

    it('404 when the playlist is not owned; nothing is created', async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);

      await expect(service.addItem(OTHER_USER, PL, { storyId: 'story-1' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expectOwnershipLookup(OTHER_USER);
      expect(prisma.playlistItem.create).not.toHaveBeenCalled();
    });

    it.each([
      ['neither narrationId nor storyId', {}],
      ['both narrationId and storyId', { narrationId: 'narr-1', storyId: 'story-1' }],
    ])('400 when %s is given (XOR)', async (_label, dto) => {
      await expect(service.addItem(USER, PL, dto as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.playlistItem.create).not.toHaveBeenCalled();
    });

    it('narration item: 404 when the narration belongs to someone else (lookup scoped by userId)', async () => {
      prisma.storyNarration.findFirst.mockResolvedValue(null);

      await expect(service.addItem(USER, PL, { narrationId: 'narr-x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.storyNarration.findFirst).toHaveBeenCalledWith({
        where: { id: 'narr-x', userId: USER },
        select: { id: true },
      });
      expect(prisma.playlistItem.create).not.toHaveBeenCalled();
    });

    it('story item: 404 when the story does not exist', async () => {
      prisma.story.findUnique.mockResolvedValue(null);

      await expect(service.addItem(USER, PL, { storyId: 'ghost' })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.playlistItem.create).not.toHaveBeenCalled();
    });

    it('story item: 404 when the voice profile is not owned by the caller', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(null);

      await expect(
        service.addItem(USER, PL, { storyId: 'story-1', voiceProfileId: 'voice-x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.voiceProfile.findFirst).toHaveBeenCalledWith({
        where: { id: 'voice-x', userId: USER },
        select: { id: true },
      });
      expect(prisma.playlistItem.create).not.toHaveBeenCalled();
    });

    it('story item with owned voice: appends at max position + 1 and bumps playlist updatedAt', async () => {
      const res = await service.addItem(USER, PL, { storyId: 'story-1', voiceProfileId: 'voice-1', position: 0 });

      expect(prisma.playlistItem.findFirst).toHaveBeenCalledWith({
        where: { playlistId: PL },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      expect(prisma.playlistItem.create).toHaveBeenCalledWith({
        data: {
          playlistId: PL,
          narrationId: null,
          storyId: 'story-1',
          voiceProfileId: 'voice-1',
          position: 5, // dto.position is ignored: always append
        },
        include: ITEM_INCLUDE,
      });
      expect(prisma.playlist.update).toHaveBeenCalledWith({
        where: { id: PL },
        data: { updatedAt: NOW },
      });
      expect(Object.keys(res).sort()).toEqual(ITEM_KEYS);
      expect(res.id).toBe('new-item');
    });

    it('story item without a voice profile stores voiceProfileId null', async () => {
      await service.addItem(USER, PL, { storyId: 'story-1' });

      expect(prisma.voiceProfile.findFirst).not.toHaveBeenCalled();
      expect(prisma.playlistItem.create.mock.calls[0][0].data.voiceProfileId).toBeNull();
    });

    it('narration item drops voiceProfileId without looking it up', async () => {
      const res = await service.addItem(USER, PL, { narrationId: 'narr-1', voiceProfileId: 'voice-1' });

      expect(prisma.voiceProfile.findFirst).not.toHaveBeenCalled();
      expect(prisma.story.findUnique).not.toHaveBeenCalled();
      expect(prisma.playlistItem.create.mock.calls[0][0].data).toEqual({
        playlistId: PL,
        narrationId: 'narr-1',
        storyId: null,
        voiceProfileId: null,
        position: 5,
      });
      expect(res.narrationId).toBe('narr-1');
      expect(res.narration).not.toBeNull();
    });

    it('first item in an empty playlist gets position 0', async () => {
      prisma.playlistItem.findFirst.mockResolvedValue(null);

      await service.addItem(USER, PL, { storyId: 'story-1' });

      expect(prisma.playlistItem.create.mock.calls[0][0].data.position).toBe(0);
    });
  });

  describe('removeItem', () => {
    it('404 when the playlist is not owned; nothing is deleted', async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);

      await expect(service.removeItem(OTHER_USER, PL, 'item-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.playlistItem.delete).not.toHaveBeenCalled();
    });

    it('404 when the item is not in this playlist (lookup scoped by playlistId)', async () => {
      prisma.playlistItem.findFirst.mockResolvedValue(null);

      await expect(service.removeItem(USER, PL, 'foreign-item')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.playlistItem.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-item', playlistId: PL },
        select: { id: true },
      });
      expect(prisma.playlistItem.delete).not.toHaveBeenCalled();
    });

    it('deletes the item and bumps playlist updatedAt', async () => {
      prisma.playlistItem.findFirst.mockResolvedValue({ id: 'item-1' });
      prisma.playlistItem.delete.mockResolvedValue({});

      await expect(service.removeItem(USER, PL, 'item-1')).resolves.toBeUndefined();
      expect(prisma.playlistItem.delete).toHaveBeenCalledWith({ where: { id: 'item-1' } });
      expect(prisma.playlist.update).toHaveBeenCalledWith({ where: { id: PL }, data: { updatedAt: NOW } });
    });
  });

  describe('reorderItems', () => {
    beforeEach(() => {
      prisma.playlistItem.findMany
        .mockResolvedValueOnce([{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }])
        .mockResolvedValueOnce([
          storyItem({ id: 'i3', position: 0 }),
          storyItem({ id: 'i1', position: 1 }),
          narrationItem({ id: 'i2', position: 2 }),
        ]);
      prisma.playlistItem.update.mockImplementation((args: any) => ({ __op: 'item.update', args }));
      prisma.playlist.update.mockImplementation((args: any) => ({ __op: 'playlist.update', args }));
      prisma.$transaction.mockImplementation(async (ops: any[]) => ops);
    });

    it('404 when the playlist is not owned', async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);

      await expect(service.reorderItems(OTHER_USER, PL, { itemIds: ['i1'] })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['a missing item', ['i1', 'i2']],
      ['an extra item', ['i1', 'i2', 'i3', 'i4']],
      ['a duplicate item', ['i1', 'i1', 'i2']],
      ['a foreign item', ['i1', 'i2', 'other-playlist-item']],
    ])('400 for %s; nothing is written', async (_label, itemIds) => {
      await expect(service.reorderItems(USER, PL, { itemIds })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('assigns index positions + bumps updatedAt in one transaction, returns items in the new order', async () => {
      const res = await service.reorderItems(USER, PL, { itemIds: ['i3', 'i1', 'i2'] });

      expect(prisma.playlistItem.findMany).toHaveBeenNthCalledWith(1, {
        where: { playlistId: PL },
        select: { id: true },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const ops = prisma.$transaction.mock.calls[0][0];
      expect(ops.map((o: any) => [o.__op, o.args])).toEqual([
        ['item.update', { where: { id: 'i3' }, data: { position: 0 } }],
        ['item.update', { where: { id: 'i1' }, data: { position: 1 } }],
        ['item.update', { where: { id: 'i2' }, data: { position: 2 } }],
        ['playlist.update', { where: { id: PL }, data: { updatedAt: NOW } }],
      ]);
      expect(prisma.playlistItem.findMany).toHaveBeenNthCalledWith(2, {
        where: { playlistId: PL },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        include: ITEM_INCLUDE,
      });
      expect(res.map((i) => [i.id, i.position])).toEqual([
        ['i3', 0],
        ['i1', 1],
        ['i2', 2],
      ]);
      for (const item of res) {
        expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
      }
    });
  });
});
