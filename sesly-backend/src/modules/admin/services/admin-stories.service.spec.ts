import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdminStoriesService } from './admin-stories.service';
import { LlmContentDriftError } from '../../llm-preprocessing/llm-preprocessing.service';
import { createMockPrismaService, MockPrismaService } from '../../../test-utils/prisma-mock';
import { createSettingsStub, SettingsStub } from '../../../test-utils/settings-stub';

const BUCKET_URL = 'https://storage.googleapis.com/sesly-bucket';

const coverFile = (originalname = 'my cover (1).png'): Express.Multer.File =>
  ({
    originalname,
    buffer: Buffer.from('img'),
    mimetype: 'image/png',
  }) as Express.Multer.File;

const words = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`).join(' ');

describe('AdminStoriesService', () => {
  let prisma: MockPrismaService;
  let storage: { uploadFile: jest.Mock; generatePresignedUrl: jest.Mock; deleteFile: jest.Mock };
  let audioService: { splitTextIntoSegments: jest.Mock; adminDeleteAudio: jest.Mock };
  let llm: { preprocessStory: jest.Mock };
  let service: AdminStoriesService;
  let settings: SettingsStub;
  let storyLlmTasks: { triggerAutoAssess: jest.Mock; triggerAutoAssessAgeGroup: jest.Mock };
  let translationRequests: { summaryForStories: jest.Mock; fulfilForStory: jest.Mock };

  const storyRow = (over: Record<string, any> = {}) => ({
    id: 's1',
    title: 'Keloglan',
    content: 'Bir varmis bir yokmus.',
    slug: 'keloglan',
    language: 'tr',
    status: 'DRAFT',
    translationGroupId: null,
    coverImageUrl: null,
    isPremium: false,
    defaultEmotion: null,
    defaultSpeed: null,
    cartesiaPronunciationDictId: null,
    preprocessedSegments: null,
    chunks: [],
    _count: { userProgress: 0, favoritedBy: 0 },
    ...over,
  });

  beforeEach(() => {
    prisma = createMockPrismaService();
    storage = {
      uploadFile: jest.fn(async (_buf: Buffer, key: string) => `${BUCKET_URL}/${key}`),
      generatePresignedUrl: jest.fn(async (key: string) => `signed:${key}`),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    audioService = { splitTextIntoSegments: jest.fn(), adminDeleteAudio: jest.fn().mockResolvedValue({}) };
    llm = { preprocessStory: jest.fn() };
    storyLlmTasks = {
      triggerAutoAssess: jest.fn().mockResolvedValue(undefined),
      triggerAutoAssessAgeGroup: jest.fn().mockResolvedValue(undefined),
    };
    translationRequests = {
      summaryForStories: jest.fn().mockResolvedValue(new Map()),
      fulfilForStory: jest.fn().mockResolvedValue(undefined),
    };
    settings = createSettingsStub();
    service = new AdminStoriesService(
      prisma as any,
      storage as any,
      audioService as any,
      llm as any,
      settings as any,
      storyLlmTasks as any,
      translationRequests as any,
    );
    prisma.story.findFirst.mockResolvedValue(null);

    prisma.story.findUnique.mockResolvedValue(storyRow());
    prisma.story.create.mockImplementation(async ({ data }: any) => ({ id: 's1', ...data }));
    prisma.story.update.mockImplementation(async ({ data }: any) => ({ id: 's1', ...data }));
    prisma.storyChunk.create.mockResolvedValue({});
    prisma.storyChunk.deleteMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  describe('reads', () => {
    it('getAllStories: envelope, skip/take, cover presigned from the stored GCS URL', async () => {
      prisma.story.findMany.mockResolvedValue([
        storyRow({ id: 'a', coverImageUrl: `${BUCKET_URL}/stories/cover/a.png` }),
        storyRow({ id: 'b', coverImageUrl: null }),
      ]);
      prisma.story.count.mockResolvedValue(41);

      const res = await service.getAllStories({ page: 3, limit: 20 });

      expect(prisma.story.findMany.mock.calls[0][0]).toMatchObject({
        where: {},
        skip: 40,
        take: 20,
        orderBy: [{ createdAt: 'desc' }],
        omit: { content: true, preprocessedSegments: true },
      });
      expect(res).toMatchObject({ total: 41, page: 3, limit: 20, totalPages: 3 });
      expect(res.data.map((s: any) => s.coverImageUrl)).toEqual(['signed:stories/cover/a.png', null]);
      expect(storage.generatePresignedUrl).toHaveBeenCalledTimes(1);
    });

    it('getStoryById: 404 when missing', async () => {
      prisma.story.findUnique.mockResolvedValue(null);
      await expect(service.getStoryById('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('getStoryById: chunks in order, presign strips a stale query string', async () => {
      prisma.story.findUnique.mockResolvedValue(
        storyRow({ coverImageUrl: `${BUCKET_URL}/stories/cover/x.png?X-Goog-Signature=old` }),
      );

      const story = await service.getStoryById('s1');

      expect(prisma.story.findUnique.mock.calls[0][0]).toMatchObject({
        where: { id: 's1' },
        include: { chunks: { orderBy: { chunkIndex: 'asc' } } },
      });
      expect(story.coverImageUrl).toBe('signed:stories/cover/x.png');
    });

    // Fixed (was BUG): the presign was returned without `await` inside
    // try/catch, so one rejected presign failed GET /admin/stories(/:id) with 500.
    it('a failing cover presign degrades to coverImageUrl null instead of failing the request', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: `${BUCKET_URL}/stories/cover/x.png` }));
      storage.generatePresignedUrl.mockRejectedValue(new Error('signing failed'));

      await expect(service.getStoryById('s1')).resolves.toMatchObject({ id: 's1', coverImageUrl: null });
    });

    it('an external cover URL is returned as is (never presigned); a non-http foreign value is null', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: 'https://cdn.example.com/c.png' }));
      await expect(service.getStoryById('s1')).resolves.toMatchObject({ coverImageUrl: 'https://cdn.example.com/c.png' });

      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: 'ftp://cdn.example.com/c.png' }));
      await expect(service.getStoryById('s1')).resolves.toMatchObject({ coverImageUrl: null });
      expect(storage.generatePresignedUrl).not.toHaveBeenCalled();
    });

    it('a cover in another GCS bucket is not presigned in ours when the bucket name is known', async () => {
      (storage as any).getBucketName = jest.fn(() => 'sesly-bucket');
      const foreign = 'https://storage.googleapis.com/some-public-bucket/images/cat.png';
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: foreign }));

      await expect(service.getStoryById('s1')).resolves.toMatchObject({ coverImageUrl: foreign });
      expect(storage.generatePresignedUrl).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  describe('createStory', () => {
    const dto = (over: Record<string, any> = {}) =>
      ({
        title: 'Keloglan',
        content: 'Bir varmis bir yokmus.',
        ageGroup: 'THREE_TO_SIX',
        category: 'TURKISH_CLASSICS',
        ...over,
      }) as any;

    it('defaults: language tr, isPremium false, duration from word count (150 wpm, min 1), no upload', async () => {
      await service.createStory(dto({ content: words(301) }), undefined as any);

      const data = prisma.story.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        title: 'Keloglan',
        language: 'tr',
        isPremium: false,
        estimatedDuration: 3,
        content: words(301),
      });
      expect(data.coverImageUrl).toBeUndefined();
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });

    it('one word -> estimatedDuration 1 (never 0)', async () => {
      await service.createStory(dto({ content: 'Merhaba' }), undefined as any);
      expect(prisma.story.create.mock.calls[0][0].data.estimatedDuration).toBe(1);
    });

    it('explicit estimatedDuration / premium / language from the admin win', async () => {
      await service.createStory(
        dto({ content: words(1000), estimatedDuration: 12, isPremium: true, language: 'en' }),
        undefined as any,
      );

      expect(prisma.story.create.mock.calls[0][0].data).toMatchObject({
        estimatedDuration: 12,
        isPremium: true,
        language: 'en',
      });
    });

    it('cover upload: sanitized name under stories/cover/<uuid>-, stored URL saved on the story', async () => {
      await service.createStory(dto(), coverFile('my cover (1).png'));

      expect(storage.uploadFile).toHaveBeenCalledTimes(1);
      const [buf, key, mime] = storage.uploadFile.mock.calls[0];
      expect(buf).toEqual(Buffer.from('img'));
      expect(mime).toBe('image/png');
      expect(key).toMatch(/^stories\/cover\/[0-9a-f-]{36}-my_cover_1\.png$/);
      expect(prisma.story.create.mock.calls[0][0].data.coverImageUrl).toBe(`${BUCKET_URL}/${key}`);
    });

    it('writes one chunk per 5000-char window and returns the fresh story detail', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ title: 'fresh' }));

      const res = await service.createStory(dto({ content: '  Kisa masal.  ' }), undefined as any);

      expect(prisma.storyChunk.create).toHaveBeenCalledTimes(1);
      expect(prisma.storyChunk.create).toHaveBeenCalledWith({
        data: { storyId: 's1', chunkIndex: 0, content: 'Kisa masal.' },
      });
      expect(res).toMatchObject({ title: 'fresh' });
    });

    it('chunking: long text splits at the last sentence end inside the 5000-char window', async () => {
      const first = 'A'.repeat(3000) + '. ' + 'B'.repeat(1500) + '!';
      const second = 'C'.repeat(2000) + '?';
      const content = `${first} ${second}`;

      await service.createStory(dto({ content }), undefined as any);

      const chunks = prisma.storyChunk.create.mock.calls
        .map((c: any[]) => c[0].data)
        .sort((a: any, b: any) => a.chunkIndex - b.chunkIndex);
      expect(chunks.map((c: any) => c.chunkIndex)).toEqual([0, 1]);
      expect(chunks[0].content).toBe(first);
      expect(chunks[1].content).toBe(second);
      for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(5000);
    });

    it('chunking: no punctuation -> split on the last space; no space -> hard split at 5000', async () => {
      const spaced = `${'x'.repeat(4990)} ${'y'.repeat(100)}`;
      await service.createStory(dto({ content: spaced }), undefined as any);
      const a = prisma.storyChunk.create.mock.calls.map((c: any[]) => c[0].data.content);
      expect(a).toEqual(['x'.repeat(4990), 'y'.repeat(100)]);

      prisma.storyChunk.create.mockClear();
      const solid = 'z'.repeat(12000);
      await service.createStory(dto({ content: solid }), undefined as any);
      const b = prisma.storyChunk.create.mock.calls.map((c: any[]) => c[0].data.content);
      expect(b.map((s: string) => s.length)).toEqual([5000, 5000, 2000]);
      expect(b.join('')).toBe(solid);
    });

    // Fixed (was BUG): a coverImageUrl in the DTO was accepted and then
    // overwritten by the local (file-upload) value, i.e. silently dropped.
    it('a coverImageUrl sent in the DTO (no file) is stored', async () => {
      await service.createStory(
        dto({ coverImageUrl: `${BUCKET_URL}/stories/cover/pasted.png` }),
        undefined as any,
      );

      expect(prisma.story.create.mock.calls[0][0].data.coverImageUrl).toBe(
        `${BUCKET_URL}/stories/cover/pasted.png`,
      );
    });

    it('an uploaded file wins over a DTO coverImageUrl; a presigned DTO URL loses its signature', async () => {
      await service.createStory(dto({ coverImageUrl: 'https://cdn.example.com/x.png' }), coverFile('a.png'));
      expect(prisma.story.create.mock.calls[0][0].data.coverImageUrl).toMatch(
        new RegExp(`^${BUCKET_URL}/stories/cover/.+-a\\.png$`),
      );

      prisma.story.create.mockClear();
      await service.createStory(
        dto({ coverImageUrl: `${BUCKET_URL}/stories/cover/p.png?X-Goog-Signature=abc&X-Goog-Expires=60` }),
        undefined as any,
      );
      expect(prisma.story.create.mock.calls[0][0].data.coverImageUrl).toBe(`${BUCKET_URL}/stories/cover/p.png`);

      prisma.story.create.mockClear();
      await service.createStory(dto({ coverImageUrl: '   ' }), undefined as any);
      expect(prisma.story.create.mock.calls[0][0].data.coverImageUrl).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  describe('automatic level assessment triggers', () => {
    const base = { title: 'Keloglan', content: 'Bir varmis bir yokmus.', ageGroup: 'THREE_TO_SIX', category: 'BEDTIME' };

    it('create: a new story without a level is queued for assessment', async () => {
      prisma.story.create.mockResolvedValue(storyRow({ id: 'new-1', languageLevel: null }));
      prisma.story.findUnique.mockResolvedValue(storyRow({ id: 'new-1' }));

      await service.createStory(base as any, undefined as any);

      expect(storyLlmTasks.triggerAutoAssess).toHaveBeenCalledWith('new-1', 'story created');
    });

    it('create: a level typed by the admin is a MANUAL decision, nothing is queued', async () => {
      prisma.story.create.mockResolvedValue(storyRow({ id: 'new-1', languageLevel: 'A2' }));
      prisma.story.findUnique.mockResolvedValue(storyRow({ id: 'new-1' }));

      await service.createStory({ ...base, languageLevel: 'A2' } as any, undefined as any);

      expect(storyLlmTasks.triggerAutoAssess).not.toHaveBeenCalled();
    });

    it('create: the request does not wait for the trigger and does not fail with it', async () => {
      prisma.story.create.mockResolvedValue(storyRow({ id: 'new-1' }));
      prisma.story.findUnique.mockResolvedValue(storyRow({ id: 'new-1' }));
      // Never settles: a request that awaited it would hang.
      storyLlmTasks.triggerAutoAssess.mockReturnValue(new Promise(() => undefined));

      await expect(service.createStory(base as any, undefined as any)).resolves.toMatchObject({ id: 'new-1' });
    });

    it('update: changed content queues a new assessment', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ content: 'eski metin' }));
      prisma.story.update.mockResolvedValue(storyRow());

      await service.updateStory('s1', { content: 'yeni metin' } as any, undefined as any);

      expect(storyLlmTasks.triggerAutoAssess).toHaveBeenCalledWith('s1', 'content changed');
    });

    it('update: the same content re-sent, or no content at all, queues nothing', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ content: 'ayni metin' }));
      prisma.story.update.mockResolvedValue(storyRow());

      await service.updateStory('s1', { content: 'ayni metin' } as any, undefined as any);
      await service.updateStory('s1', { title: 'Yeni baslik' } as any, undefined as any);

      expect(storyLlmTasks.triggerAutoAssess).not.toHaveBeenCalled();
    });

    it('update: the same text moved to another language is assessed again', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ content: 'ayni metin' }));
      prisma.story.update.mockResolvedValue(storyRow());

      await service.updateStory('s1', { content: 'ayni metin', language: 'en' } as any, undefined as any);

      expect(storyLlmTasks.triggerAutoAssess).toHaveBeenCalledWith('s1', 'content changed');
    });
  });

  // ---------------------------------------------------------------------------
  describe('updateStory', () => {
    it('404 when the story does not exist; nothing uploaded or written', async () => {
      prisma.story.findUnique.mockResolvedValue(null);

      await expect(service.updateStory('nope', { title: 'x' } as any, coverFile())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(storage.uploadFile).not.toHaveBeenCalled();
      expect(prisma.story.update).not.toHaveBeenCalled();
    });

    it('metadata-only (premium flag off): keeps cover, chunks and preprocessed segments', async () => {
      prisma.story.findUnique.mockResolvedValue(
        storyRow({ isPremium: true, coverImageUrl: `${BUCKET_URL}/stories/cover/old.png` }),
      );

      await service.updateStory('s1', { isPremium: false, title: 'Yeni' } as any, undefined as any);

      expect(prisma.story.update).toHaveBeenCalledTimes(1);
      const { where, data } = prisma.story.update.mock.calls[0][0];
      expect(where).toEqual({ id: 's1' });
      expect(data).toEqual({
        isPremium: false,
        title: 'Yeni',
        coverImageUrl: `${BUCKET_URL}/stories/cover/old.png`,
      });
      expect(prisma.storyChunk.deleteMany).not.toHaveBeenCalled();
      expect(storage.deleteFile).not.toHaveBeenCalled();
    });

    it('a DTO coverImageUrl (no file) replaces the stored cover, blank clears it; nothing is deleted', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: `${BUCKET_URL}/stories/cover/old.png` }));

      await service.updateStory('s1', { coverImageUrl: 'https://cdn.example.com/new.png' } as any, undefined as any);
      expect(prisma.story.update.mock.calls[0][0].data.coverImageUrl).toBe('https://cdn.example.com/new.png');

      prisma.story.update.mockClear();
      await service.updateStory('s1', { coverImageUrl: '' } as any, undefined as any);
      expect(prisma.story.update.mock.calls[0][0].data.coverImageUrl).toBeNull();

      expect(storage.deleteFile).not.toHaveBeenCalled();
    });

    it('a new cover file replacing a pasted external cover never deletes a same-named object of ours', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: 'https://cdn.example.com/old.png' }));

      await service.updateStory('s1', {} as any, coverFile('n.png'));

      expect(storage.deleteFile).not.toHaveBeenCalled();
      expect(storage.uploadFile).toHaveBeenCalledTimes(1);
    });

    it('changed content: invalidates preprocessed segments, recalculates duration, rebuilds chunks', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ content: 'eski metin' }));
      const content = words(450);

      await service.updateStory('s1', { content } as any, undefined as any);

      const first = prisma.story.update.mock.calls[0][0].data;
      expect(first.preprocessedSegments).toBe(Prisma.JsonNull);
      expect(first.preprocessedAt).toBeNull();
      expect(first.preprocessedModel).toBeNull();
      expect(first.estimatedDuration).toBe(3);
      expect(prisma.storyChunk.deleteMany).toHaveBeenCalledWith({ where: { storyId: 's1' } });
      expect(prisma.storyChunk.create).toHaveBeenCalledWith({
        data: { storyId: 's1', chunkIndex: 0, content },
      });
      expect(prisma.story.update).toHaveBeenLastCalledWith({ where: { id: 's1' }, data: { content } });
    });

    it('same content re-sent: preprocessed segments survive (only real drift invalidates them)', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ content: 'ayni metin' }));

      await service.updateStory('s1', { content: 'ayni metin', estimatedDuration: 9 } as any, undefined as any);

      const first = prisma.story.update.mock.calls[0][0].data;
      expect(first).not.toHaveProperty('preprocessedSegments');
      expect(first).not.toHaveProperty('preprocessedModel');
      expect(first.estimatedDuration).toBe(9);
    });

    it('new cover: deletes the previous object by key, then uploads the new one', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: `${BUCKET_URL}/stories/cover/old.png` }));

      await service.updateStory('s1', {} as any, coverFile('yeni.jpg'));

      expect(storage.deleteFile).toHaveBeenCalledWith('stories/cover/old.png');
      const key = storage.uploadFile.mock.calls[0][1];
      expect(key).toMatch(/^stories\/cover\/[0-9a-f-]{36}-yeni\.jpg$/);
      expect(prisma.story.update.mock.calls[0][0].data.coverImageUrl).toBe(`${BUCKET_URL}/${key}`);
    });

    it('new cover: a failing delete of the old cover does not block the update', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: `${BUCKET_URL}/stories/cover/old.png` }));
      storage.deleteFile.mockRejectedValue(new Error('gcs down'));

      await expect(service.updateStory('s1', {} as any, coverFile('yeni.jpg'))).resolves.toBeDefined();
      expect(storage.uploadFile).toHaveBeenCalledTimes(1);
    });

    it('new cover on a story without one: nothing to delete', async () => {
      await service.updateStory('s1', {} as any, coverFile('ilk.png'));
      expect(storage.deleteFile).not.toHaveBeenCalled();
      expect(storage.uploadFile).toHaveBeenCalledTimes(1);
    });

    it('new cover: an old cover another story of the tale still shows is kept', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: `${BUCKET_URL}/stories/cover/old.png` }));
      prisma.story.count.mockResolvedValue(2);
      await service.updateStory('s1', {} as any, coverFile('yeni.jpg'));
      expect(prisma.story.count).toHaveBeenCalledWith({ where: { coverImageUrl: `${BUCKET_URL}/stories/cover/old.png` } });
      expect(storage.deleteFile).not.toHaveBeenCalled();
    });

    it('"Bu kapağı tüm dillere ve bölümlere uygula": the new cover goes to the whole tale, unused old covers are removed', async () => {
      prisma.story.findUnique.mockResolvedValue(
        storyRow({ coverImageUrl: null, translationGroupId: 'g1', partGroupId: 'p1' }),
      );
      // The tale: s1 (g1, p1), en (g1), tr part 2 (p1).
      prisma.story.findMany.mockImplementation(async (args: any) => {
        if (args?.select?.partGroupId) {
          return [
            { id: 's1', translationGroupId: 'g1', partGroupId: 'p1' },
            { id: 'en', translationGroupId: 'g1', partGroupId: null },
            { id: 'tr-2', translationGroupId: null, partGroupId: 'p1' },
          ];
        }
        return [{ coverImageUrl: `${BUCKET_URL}/stories/cover/en-old.png` }];
      });
      prisma.story.update.mockImplementation(async ({ data }: any) =>
        storyRow({ ...data, translationGroupId: 'g1', partGroupId: 'p1' }),
      );
      prisma.story.count.mockResolvedValue(0);

      await service.updateStory(
        's1',
        { applyCoverToTale: true, coverCredit: '{"illustrator":"Ada","licence":"CC BY 4.0"}' } as any,
        coverFile('kapak.png'),
      );

      const newUrl = prisma.story.update.mock.calls[0][0].data.coverImageUrl;
      expect(prisma.story.update.mock.calls[0][0].data).not.toHaveProperty('applyCoverToTale');
      // The credit goes with the picture, to the story and to the tale.
      expect(prisma.story.update.mock.calls[0][0].data.coverCredit).toEqual({ illustrator: 'Ada', licenseName: 'CC BY 4.0' });
      expect(prisma.story.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['en', 'tr-2'] } },
        data: { coverImageUrl: newUrl, coverCredit: { illustrator: 'Ada', licenseName: 'CC BY 4.0' } },
      });
      expect(storage.deleteFile).toHaveBeenCalledWith('stories/cover/en-old.png');
    });

    it('a new cover without a credit clears the old credit (it described the old picture)', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: null, coverCredit: { illustrator: 'Eski' } }));
      prisma.story.findMany.mockResolvedValue([]);
      await service.updateStory('s1', {} as any, coverFile('kapak.png'));
      expect(prisma.story.update.mock.calls[0][0].data.coverCredit).toBe(Prisma.JsonNull);
    });

    it('a credit without a file goes to every story showing the same picture; a bad credit writes nothing', async () => {
      const cover = `${BUCKET_URL}/stories/cover/a.png`;
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: cover }));
      await service.updateStory('s1', { coverCredit: '{"attribution":"Illustration: Ada, CC BY 4.0"}' } as any, undefined as any);
      expect(prisma.story.update.mock.calls[0][0].data.coverCredit).toEqual({ attribution: 'Illustration: Ada, CC BY 4.0' });
      expect(prisma.story.updateMany).toHaveBeenCalledWith({
        where: { coverImageUrl: cover, id: { not: 's1' } },
        data: { coverCredit: { attribution: 'Illustration: Ada, CC BY 4.0' } },
      });

      prisma.story.update.mockClear();
      prisma.story.updateMany.mockClear();
      await service.updateStory('s1', { coverCredit: '' } as any, undefined as any);
      expect(prisma.story.update.mock.calls[0][0].data.coverCredit).toBe(Prisma.JsonNull);

      prisma.story.update.mockClear();
      await expect(service.updateStory('s1', { coverCredit: '{bad' } as any, undefined as any)).rejects.toMatchObject({
        response: { code: 'COVER_CREDIT_INVALID' },
      });
      expect(prisma.story.update).not.toHaveBeenCalled();

      // No cover: nothing else to update.
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: null }));
      prisma.story.updateMany.mockClear();
      await service.updateStory('s1', { coverCredit: '{"illustrator":"Ada"}' } as any, undefined as any);
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
    });

    it('without the flag only this story gets the new cover', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: null, translationGroupId: 'g1' }));
      prisma.story.findMany.mockResolvedValue([]);
      await service.updateStory('s1', { applyCoverToTale: false } as any, coverFile('kapak.png'));
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
    });

    it('a new story with the flag shares its cover too; a tale of one story writes nothing', async () => {
      prisma.story.create.mockImplementation(async ({ data }: any) => storyRow({ ...data, id: 'new', translationGroupId: null }));
      prisma.story.findUnique.mockResolvedValue(storyRow({ id: 'new' }));
      await service.createStory(
        { title: 'T', content: 'Metin.', category: 'BEDTIME', applyCoverToTale: true } as any,
        coverFile('kapak.png'),
      );
      expect(prisma.story.create.mock.calls[0][0].data).not.toHaveProperty('applyCoverToTale');
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
    });

    it('a new story stores the credit of its uploaded cover, and ignores a credit without a cover', async () => {
      prisma.story.create.mockImplementation(async ({ data }: any) => storyRow({ ...data, id: 'new' }));
      prisma.story.findUnique.mockResolvedValue(storyRow({ id: 'new' }));
      await service.createStory(
        { title: 'T', content: 'Metin.', category: 'BEDTIME', coverCredit: '{"illustrator":"Ada"}' } as any,
        coverFile('kapak.png'),
      );
      expect(prisma.story.create.mock.calls[0][0].data.coverCredit).toEqual({ illustrator: 'Ada' });
      expect(prisma.story.create.mock.calls[0][0].data).not.toHaveProperty('applyCoverToTale');

      prisma.story.create.mockClear();
      await service.createStory(
        { title: 'T', content: 'Metin.', category: 'BEDTIME', coverCredit: '{"illustrator":"Ada"}' } as any,
        undefined as any,
      );
      expect(prisma.story.create.mock.calls[0][0].data).not.toHaveProperty('coverCredit');
    });
  });

  // ---------------------------------------------------------------------------
  describe('setCover (POST /admin/stories/:id/cover)', () => {
    const tale = () =>
      prisma.story.findMany.mockImplementation(async (args: any) => {
        if (args?.select?.partGroupId) {
          return [
            { id: 's1', translationGroupId: 'g1', partGroupId: null },
            { id: 'en', translationGroupId: 'g1', partGroupId: null },
          ];
        }
        return [{ coverImageUrl: `${BUCKET_URL}/stories/cover/en-old.png` }];
      });

    it('uploads, writes cover and credit to the whole tale by default, removes covers nothing shows', async () => {
      prisma.story.findUnique.mockResolvedValue({
        id: 's1',
        coverImageUrl: `${BUCKET_URL}/stories/cover/s1-old.png`,
        translationGroupId: 'g1',
        partGroupId: null,
      });
      tale();
      prisma.story.count.mockResolvedValue(0);

      const res = await service.setCover('s1', coverFile('Kapak Resmi.png'), {
        coverCredit: { illustrator: 'Ada', licence: 'CC BY 4.0', width: 10 },
      });

      const key = storage.uploadFile.mock.calls[0][1];
      expect(key).toMatch(/^stories\/cover\/[0-9a-f-]{36}-Kapak_Resmi\.png$/);
      expect(prisma.story.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { coverImageUrl: `${BUCKET_URL}/${key}`, coverCredit: { illustrator: 'Ada', licenseName: 'CC BY 4.0' } },
      });
      expect(prisma.story.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['en'] } },
        data: { coverImageUrl: `${BUCKET_URL}/${key}`, coverCredit: { illustrator: 'Ada', licenseName: 'CC BY 4.0' } },
      });
      expect(storage.deleteFile).toHaveBeenCalledWith('stories/cover/s1-old.png');
      expect(storage.deleteFile).toHaveBeenCalledWith('stories/cover/en-old.png');
      expect(res).toEqual({
        storyId: 's1',
        coverImageUrl: `signed:${key}`,
        coverCredit: { illustrator: 'Ada', licenseName: 'CC BY 4.0' },
        storyIds: ['s1', 'en'],
        appliedTo: 2,
      });
    });

    it('applyCoverToTale false: only this story, no credit stored as null; a cover still shown elsewhere is kept', async () => {
      prisma.story.findUnique.mockResolvedValue({
        id: 's1',
        coverImageUrl: `${BUCKET_URL}/stories/cover/shared.png`,
        translationGroupId: 'g1',
        partGroupId: null,
      });
      prisma.story.count.mockResolvedValue(1);
      const res = await service.setCover('s1', coverFile('k.jpg'), { applyCoverToTale: false });
      expect(prisma.story.update.mock.calls[0][0].data.coverCredit).toBe(Prisma.JsonNull);
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
      expect(storage.deleteFile).not.toHaveBeenCalled();
      expect(res).toMatchObject({ storyIds: ['s1'], appliedTo: 1, coverCredit: null });
    });

    it.each([
      [undefined, 'COVER_FILE_REQUIRED'],
      [{ buffer: Buffer.alloc(0), mimetype: 'image/png' }, 'COVER_FILE_REQUIRED'],
      [{ buffer: Buffer.from('x'), mimetype: 'image/gif', originalname: 'a.gif' }, 'COVER_FILE_TYPE'],
      [{ buffer: Buffer.alloc(10 * 1024 * 1024 + 1), mimetype: 'image/jpeg', originalname: 'a.jpg' }, 'COVER_FILE_TOO_LARGE'],
    ])('refuses a bad file (%#) before anything is written', async (file, code) => {
      await expect(service.setCover('s1', file as any)).rejects.toMatchObject({ response: { code } });
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });

    it('refuses a bad credit and an unknown story before uploading', async () => {
      await expect(service.setCover('s1', coverFile('a.png'), { coverCredit: '{x' })).rejects.toMatchObject({
        response: { code: 'COVER_CREDIT_INVALID' },
      });
      prisma.story.findUnique.mockResolvedValue(null);
      await expect(service.setCover('nope', coverFile('a.png'))).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  describe('deleteStory', () => {
    it('404 when missing; nothing deleted', async () => {
      prisma.story.findUnique.mockResolvedValue(null);

      await expect(service.deleteStory('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.story.delete).not.toHaveBeenCalled();
      expect(storage.deleteFile).not.toHaveBeenCalled();
    });

    it('deletes the cover object and the row', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: `${BUCKET_URL}/stories/cover/c.png` }));

      const res = await service.deleteStory('s1');

      expect(storage.deleteFile).toHaveBeenCalledWith('stories/cover/c.png');
      expect(prisma.story.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
      expect(res).toEqual({ message: 'Story deleted successfully' });
    });

    it('a cover other stories of the tale still show is not deleted with the story', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: `${BUCKET_URL}/stories/cover/c.png` }));
      prisma.story.count.mockResolvedValue(1);
      await service.deleteStory('s1');
      expect(prisma.story.count).toHaveBeenCalledWith({
        where: { coverImageUrl: `${BUCKET_URL}/stories/cover/c.png`, id: { not: 's1' } },
      });
      expect(storage.deleteFile).not.toHaveBeenCalled();
      expect(prisma.story.delete).toHaveBeenCalled();
    });

    it('cover delete failure is non-fatal; story without cover skips storage', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: `${BUCKET_URL}/stories/cover/c.png` }));
      storage.deleteFile.mockRejectedValue(new Error('gcs down'));
      await expect(service.deleteStory('s1')).resolves.toEqual({ message: 'Story deleted successfully' });

      storage.deleteFile.mockClear();
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: null }));
      await service.deleteStory('s2');
      expect(storage.deleteFile).not.toHaveBeenCalled();
    });

    it('removes the shared ready-made voice audios of the story first (a failure is only logged)', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ coverImageUrl: null }));
      prisma.audio.findMany.mockResolvedValue([{ id: 'shared-1' }, { id: 'shared-2' }]);
      audioService.adminDeleteAudio.mockRejectedValueOnce(new Error('gone')).mockResolvedValueOnce({});

      await expect(service.deleteStory('s1')).resolves.toEqual({ message: 'Story deleted successfully' });

      expect(prisma.audio.findMany).toHaveBeenCalledWith({ where: { storyId: 's1', shared: true }, select: { id: true } });
      expect(audioService.adminDeleteAudio.mock.calls.map((c: any[]) => c[0])).toEqual(['shared-1', 'shared-2']);
      expect(audioService.adminDeleteAudio.mock.invocationCallOrder[1]).toBeLessThan(
        prisma.story.delete.mock.invocationCallOrder[0],
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe('segment editor', () => {
    it('previewSegments: 404 when missing', async () => {
      prisma.story.findUnique.mockResolvedValue(null);
      await expect(service.previewSegments('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(audioService.splitTextIntoSegments).not.toHaveBeenCalled();
    });

    it('previewSegments: uses the audio pipeline splitter and exposes story defaults, persists nothing', async () => {
      prisma.story.findUnique.mockResolvedValue(
        storyRow({ content: 'A. B.', defaultEmotion: 'calm', defaultSpeed: 0.9 }),
      );
      audioService.splitTextIntoSegments.mockReturnValue(['A.', 'B.']);

      const res = await service.previewSegments('s1');

      expect(audioService.splitTextIntoSegments).toHaveBeenCalledWith('A. B.');
      expect(res).toEqual({
        storyId: 's1',
        defaultEmotion: 'calm',
        defaultSpeed: 0.9,
        cartesiaPronunciationDictId: null,
        segments: [{ text: 'A.' }, { text: 'B.' }],
      });
      expect(prisma.story.update).not.toHaveBeenCalled();
    });

    it('clearPreprocessedSegments: 404 when missing; otherwise resets the three columns', async () => {
      prisma.story.findUnique.mockResolvedValueOnce(null);
      await expect(service.clearPreprocessedSegments('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.story.update).not.toHaveBeenCalled();

      await service.clearPreprocessedSegments('s1');
      expect(prisma.story.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { preprocessedSegments: Prisma.JsonNull, preprocessedAt: null, preprocessedModel: null },
      });
    });

    it('llmFillSegments: 404 when missing, LLM not called', async () => {
      prisma.story.findUnique.mockResolvedValue(null);
      await expect(service.llmFillSegments('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(llm.preprocessStory).not.toHaveBeenCalled();
    });

    it('llmFillSegments: returns the proposal without persisting it', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ content: 'Metin.' }));
      llm.preprocessStory.mockResolvedValue({
        modelUsed: 'gemini-x',
        durationMs: 1200,
        usage: { inputTokens: 10 },
        warnings: ['w'],
        segments: [{ text: 'Metin.', emotion: 'calm' }],
        extra: 'not exposed',
      });

      const res = await service.llmFillSegments('s1');

      expect(llm.preprocessStory).toHaveBeenCalledWith('Metin.', 'tr');
      expect(res).toEqual({
        storyId: 's1',
        modelUsed: 'gemini-x',
        durationMs: 1200,
        usage: { inputTokens: 10 },
        warnings: ['w'],
        segments: [{ text: 'Metin.', emotion: 'calm' }],
      });
      expect(prisma.story.update).not.toHaveBeenCalled();
    });

    it('llmFillSegments: the story language picks the prompt', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ content: 'Once upon a time.', language: 'en' }));
      llm.preprocessStory.mockResolvedValue({
        segments: [],
        rawSegments: [],
        modelUsed: 'm',
        durationMs: 1,
        warnings: [],
      });

      await service.llmFillSegments('s1');

      expect(llm.preprocessStory).toHaveBeenCalledWith('Once upon a time.', 'en');
    });

    it('llmFillSegments: content drift and provider errors propagate unchanged', async () => {
      const drift = new LlmContentDriftError('drift', 42, '...');
      llm.preprocessStory.mockRejectedValueOnce(drift);
      await expect(service.llmFillSegments('s1')).rejects.toBe(drift);

      const outage = new ServiceUnavailableException('gemini down');
      llm.preprocessStory.mockRejectedValueOnce(outage);
      await expect(service.llmFillSegments('s1')).rejects.toBe(outage);
      expect(prisma.story.update).not.toHaveBeenCalled();
    });
  });
});
