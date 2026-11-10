import {
  TRANSLATION_READY_TYPE,
  TranslationRequestsService,
  translationReadyBody,
  translationReadyTitle,
} from './translation-requests.service';
import { renderMessage } from '../../test-utils/i18n';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';

const USER = 'user-1';
const T0 = new Date('2026-10-01T10:00:00.000Z');
const T1 = new Date('2026-10-05T10:00:00.000Z');
const T2 = new Date('2026-10-09T10:00:00.000Z');

const storyRef = (over: Record<string, any> = {}) => ({
  id: 's-tr',
  title: 'Bremen Mızıkacıları',
  language: 'tr',
  status: 'PUBLISHED',
  translationGroupId: null,
  originalLanguage: null,
  translatedFromId: null,
  createdAt: T0,
  ...over,
});

const coded = async (promise: Promise<unknown>) => {
  const error: any = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e) => e,
  );
  // The body as a Turkish client gets it (HttpExceptionFilter renders the key).
  const { messageArgs, ...rest } = (error.getResponse?.() ?? {}) as Record<string, any>;
  void messageArgs;
  return {
    status: error.getStatus?.(),
    body: { ...rest, message: renderMessage(error) } as Record<string, any>,
  };
};

describe('TranslationRequestsService', () => {
  let prisma: MockPrismaService;
  let notifications: { sendNotification: jest.Mock };
  let settings: SettingsStub;
  let service: TranslationRequestsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    notifications = { sendNotification: jest.fn().mockResolvedValue({ notificationId: 'n1', pushSent: true }) };
    settings = createSettingsStub({ 'content.enabledLanguages': ['tr', 'en', 'de'] });
    service = new TranslationRequestsService(prisma as any, notifications as any, settings as any);

    prisma.story.findUnique.mockResolvedValue(storyRef());
    prisma.story.findFirst.mockResolvedValue(null);
    prisma.story.findMany.mockResolvedValue([]);
    prisma.storyTranslationRequest.findFirst.mockResolvedValue(null);
    prisma.storyTranslationRequest.findMany.mockResolvedValue([]);
    prisma.storyTranslationRequest.upsert.mockResolvedValue({});
    prisma.storyTranslationRequest.deleteMany.mockResolvedValue({ count: 0 });
    prisma.storyTranslationRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.storyTranslationRequest.groupBy.mockResolvedValue([]);
  });

  // ---------------------------------------------------------------------
  describe('request (POST /stories/:id/translation-requests)', () => {
    it('stores the request on the story and answers with the open requests of the caller', async () => {
      prisma.storyTranslationRequest.findMany.mockResolvedValue([{ language: 'de' }, { language: 'en' }]);

      const result = await service.request(USER, 's-tr', 'en');

      expect(prisma.storyTranslationRequest.upsert).toHaveBeenCalledWith({
        where: { userId_storyId_language: { userId: USER, storyId: 's-tr', language: 'en' } },
        create: { userId: USER, storyId: 's-tr', language: 'en' },
        update: { fulfilledAt: null, fulfilledStoryId: null, createdAt: expect.any(Date) },
      });
      expect(result).toEqual({
        storyId: 's-tr',
        language: 'en',
        requested: true,
        requestedLanguages: ['en', 'de'],
      });
    });

    it('a story without a group only looks at its own requests and has no sibling to check', async () => {
      await service.request(USER, 's-tr', 'en');

      expect(prisma.story.findFirst).not.toHaveBeenCalled();
      expect(prisma.storyTranslationRequest.findFirst).toHaveBeenCalledWith({
        where: { userId: USER, language: 'en', fulfilledAt: null, storyId: 's-tr' },
        select: { id: true },
      });
    });

    it('is idempotent across the tale: an open request made from another language version is reused', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRef({ translationGroupId: 'g1' }));
      prisma.storyTranslationRequest.findFirst.mockResolvedValue({ id: 'req-1' });
      prisma.storyTranslationRequest.findMany.mockResolvedValue([{ language: 'de' }]);

      const result = await service.request(USER, 's-tr', 'de');

      expect(prisma.storyTranslationRequest.findFirst).toHaveBeenCalledWith({
        where: {
          userId: USER,
          language: 'de',
          fulfilledAt: null,
          OR: [{ storyId: 's-tr' }, { story: { translationGroupId: 'g1' } }],
        },
        select: { id: true },
      });
      expect(prisma.storyTranslationRequest.upsert).not.toHaveBeenCalled();
      expect(result).toMatchObject({ requested: true, requestedLanguages: ['de'] });
    });

    it('409 TRANSLATION_ALREADY_AVAILABLE for the language the story itself is in', async () => {
      const { status, body } = await coded(service.request(USER, 's-tr', 'tr'));

      expect(status).toBe(409);
      expect(body).toEqual({
        code: 'TRANSLATION_ALREADY_AVAILABLE',
        message: 'Bu masal zaten Türkçe olarak var.',
        storyId: 's-tr',
      });
      expect(prisma.storyTranslationRequest.upsert).not.toHaveBeenCalled();
    });

    it('409 with the id of the published version when the tale already has that language', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRef({ translationGroupId: 'g1' }));
      prisma.story.findFirst.mockResolvedValue({ id: 's-en' });

      const { status, body } = await coded(service.request(USER, 's-tr', 'en'));

      expect(prisma.story.findFirst).toHaveBeenCalledWith({
        where: { translationGroupId: 'g1', language: 'en', status: 'PUBLISHED' },
        select: { id: true },
      });
      expect(status).toBe(409);
      expect(body).toMatchObject({
        code: 'TRANSLATION_ALREADY_AVAILABLE',
        message: 'Bu masal zaten İngilizce olarak var.',
        storyId: 's-en',
      });
    });

    it('a draft version in that language does not block the request (only published ones count)', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRef({ translationGroupId: 'g1' }));
      prisma.story.findFirst.mockResolvedValue(null);

      await expect(service.request(USER, 's-tr', 'en')).resolves.toMatchObject({ requested: true });
      expect(prisma.storyTranslationRequest.upsert).toHaveBeenCalled();
    });

    it('404 STORY_NOT_FOUND for a missing story and for a draft; an archived story can be asked for', async () => {
      prisma.story.findUnique.mockResolvedValue(null);
      expect(await coded(service.request(USER, 'nope', 'en'))).toEqual({
        status: 404,
        body: { code: 'STORY_NOT_FOUND', message: 'Masal bulunamadı.' },
      });

      prisma.story.findUnique.mockResolvedValue(storyRef({ status: 'DRAFT' }));
      expect((await coded(service.request(USER, 's-tr', 'en'))).status).toBe(404);

      prisma.story.findUnique.mockResolvedValue(storyRef({ status: 'ARCHIVED' }));
      await expect(service.request(USER, 's-tr', 'en')).resolves.toMatchObject({ requested: true });
    });
  });

  // ---------------------------------------------------------------------
  describe('withdraw (DELETE /stories/:id/translation-requests/:language)', () => {
    it('deletes the open request of the caller on the whole tale and reports what is left', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRef({ translationGroupId: 'g1' }));
      prisma.storyTranslationRequest.deleteMany.mockResolvedValue({ count: 1 });
      prisma.storyTranslationRequest.findMany.mockResolvedValue([{ language: 'de' }]);

      const result = await service.withdraw(USER, 's-tr', 'en');

      expect(prisma.storyTranslationRequest.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: USER,
          language: 'en',
          fulfilledAt: null,
          OR: [{ storyId: 's-tr' }, { story: { translationGroupId: 'g1' } }],
        },
      });
      expect(result).toEqual({ storyId: 's-tr', language: 'en', requested: false, requestedLanguages: ['de'] });
    });

    it('is idempotent (nothing to delete is not an error) and 404s for an unknown story', async () => {
      await expect(service.withdraw(USER, 's-tr', 'en')).resolves.toMatchObject({
        requested: false,
        requestedLanguages: [],
      });

      prisma.story.findUnique.mockResolvedValue(null);
      expect((await coded(service.withdraw(USER, 'nope', 'en'))).body.code).toBe('STORY_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------
  describe('requestedLanguages (story detail)', () => {
    it('open requests of the caller, without duplicates, catalogue order', async () => {
      prisma.storyTranslationRequest.findMany.mockResolvedValue([
        { language: 'de' },
        { language: 'en' },
        { language: 'de' },
      ]);

      await expect(
        service.requestedLanguages(USER, { id: 's-tr', translationGroupId: 'g1' }),
      ).resolves.toEqual(['en', 'de']);
      expect(prisma.storyTranslationRequest.findMany).toHaveBeenCalledWith({
        where: {
          userId: USER,
          fulfilledAt: null,
          OR: [{ storyId: 's-tr' }, { story: { translationGroupId: 'g1' } }],
        },
        select: { language: true },
      });
    });

    it('an anonymous caller has none and no query is made', async () => {
      await expect(service.requestedLanguages(undefined, { id: 's-tr' })).resolves.toEqual([]);
      await expect(service.requestedLanguages(null, { id: 's-tr' })).resolves.toEqual([]);
      expect(prisma.storyTranslationRequest.findMany).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  describe('fulfilForStory (a version was published)', () => {
    const published = storyRef({ id: 's-en', title: 'The Bremen Town Musicians', language: 'en', translationGroupId: 'g1' });
    const open = [
      { id: 'r1', userId: 'u1', story: { title: 'Bremen Mızıkacıları' } },
      { id: 'r2', userId: 'u2', story: { title: 'Die Bremer Stadtmusikanten' } },
    ];

    beforeEach(() => {
      prisma.story.findUnique.mockResolvedValue(published);
      prisma.storyTranslationRequest.findMany.mockResolvedValue(open);
    });

    it('marks every open request for that language on the tale fulfilled and keeps the rows', async () => {
      await service.fulfilForStory('s-en');

      expect(prisma.storyTranslationRequest.findMany).toHaveBeenCalledWith({
        where: { language: 'en', fulfilledAt: null, story: { translationGroupId: 'g1' } },
        select: { id: true, userId: true, story: { select: { title: true } } },
        orderBy: { createdAt: 'asc' },
      });
      expect(prisma.storyTranslationRequest.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.storyTranslationRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', fulfilledAt: null },
        data: { fulfilledAt: expect.any(Date), fulfilledStoryId: 's-en' },
      });
      expect(prisma.storyTranslationRequest.deleteMany).not.toHaveBeenCalled();
    });

    it('sends each requester the in-app plus push notification, in Turkish, naming the story they asked from', async () => {
      await service.fulfilForStory('s-en');

      expect(notifications.sendNotification).toHaveBeenCalledTimes(2);
      expect(notifications.sendNotification).toHaveBeenNthCalledWith(1, 'u1', {
        type: 'TRANSLATION_READY',
        title: 'Çeviri hazır',
        body: 'Bremen Mızıkacıları artık İngilizce dinlenebilir.',
        data: { storyId: 's-en', language: 'en' },
      });
      expect(notifications.sendNotification).toHaveBeenNthCalledWith(
        2,
        'u2',
        expect.objectContaining({ body: 'Die Bremer Stadtmusikanten artık İngilizce dinlenebilir.' }),
      );
    });

    it('each requester gets the notification in their stored UI language', async () => {
      (prisma as any).userPreferences.findMany.mockResolvedValue([{ userId: 'u2', uiLanguage: 'en' }]);

      await service.fulfilForStory('s-en');

      expect((prisma as any).userPreferences.findMany).toHaveBeenCalledWith({
        where: { userId: { in: ['u1', 'u2'] } },
        select: { userId: true, uiLanguage: true },
      });
      expect(notifications.sendNotification).toHaveBeenNthCalledWith(
        1,
        'u1',
        expect.objectContaining({ title: 'Çeviri hazır' }),
      );
      expect(notifications.sendNotification).toHaveBeenNthCalledWith(2, 'u2', {
        type: 'TRANSLATION_READY',
        title: 'Translation ready',
        body: 'Die Bremer Stadtmusikanten is now available in English.',
        data: { storyId: 's-en', language: 'en' },
      });
    });

    it('one notification per user, also when the user has two open rows on the tale', async () => {
      prisma.storyTranslationRequest.findMany.mockResolvedValue([
        open[0],
        { id: 'r3', userId: 'u1', story: { title: 'The other version' } },
      ]);

      await service.fulfilForStory('s-en');

      expect(prisma.storyTranslationRequest.updateMany).toHaveBeenCalledTimes(2);
      expect(notifications.sendNotification).toHaveBeenCalledTimes(1);
    });

    it('a request another call already claimed is not notified again', async () => {
      prisma.storyTranslationRequest.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      await service.fulfilForStory('s-en');

      expect(notifications.sendNotification).toHaveBeenCalledTimes(1);
      expect(notifications.sendNotification).toHaveBeenCalledWith('u2', expect.anything());
    });

    it('a failing notification does not stop the others', async () => {
      notifications.sendNotification.mockRejectedValueOnce(new Error('db down'));

      await expect(service.fulfilForStory('s-en')).resolves.toBeUndefined();
      expect(notifications.sendNotification).toHaveBeenCalledTimes(2);

      notifications.sendNotification.mockReset().mockRejectedValue('plain string');
      await expect(service.fulfilForStory('s-en')).resolves.toBeUndefined();
    });

    it('does nothing for a missing story, an unpublished one and a story without a group', async () => {
      for (const row of [
        null,
        { ...published, status: 'DRAFT' },
        { ...published, status: 'ARCHIVED' },
        { ...published, translationGroupId: null },
      ]) {
        prisma.story.findUnique.mockResolvedValue(row);
        await service.fulfilForStory('s-en');
      }

      expect(prisma.storyTranslationRequest.findMany).not.toHaveBeenCalled();
      expect(notifications.sendNotification).not.toHaveBeenCalled();
    });

    it('nothing open: no write, no notification', async () => {
      prisma.storyTranslationRequest.findMany.mockResolvedValue([]);

      await service.fulfilForStory('s-en');

      expect(prisma.storyTranslationRequest.updateMany).not.toHaveBeenCalled();
      expect(notifications.sendNotification).not.toHaveBeenCalled();
    });

    it('never throws: a database failure is swallowed (callers do not await it)', async () => {
      prisma.story.findUnique.mockRejectedValue(new Error('connection lost'));
      await expect(service.fulfilForStory('s-en')).resolves.toBeUndefined();

      prisma.story.findUnique.mockRejectedValue('plain string');
      await expect(service.fulfilForStory('s-en')).resolves.toBeUndefined();
    });

    it('the notification copy follows the workspace rules', () => {
      expect(TRANSLATION_READY_TYPE).toBe('TRANSLATION_READY');
      const copy = `${translationReadyTitle()} ${translationReadyBody('Keloğlan', 'de')}`;
      expect(copy).toBe('Çeviri hazır Keloğlan artık Almanca dinlenebilir.');
      const english = `${translationReadyTitle('en')} ${translationReadyBody('Keloğlan', 'de', 'en')}`;
      expect(english).toBe('Translation ready Keloğlan is now available in German.');
      expect(copy).not.toMatch(/[—–…→•]|\p{Extended_Pictographic}/u);
    });
  });

  // ---------------------------------------------------------------------
  describe('listForAdmin (GET /admin/stories/translation-requests)', () => {
    const group = (storyId: string, language: string, count: number, latest: Date | null) => ({
      storyId,
      language,
      _count: { _all: count },
      _max: { createdAt: latest },
    });

    it('aggregates by tale and language, most requested first, then the most recent', async () => {
      prisma.storyTranslationRequest.groupBy.mockResolvedValue([
        group('a-tr', 'de', 2, T0),
        group('a-en', 'de', 3, T2), // same tale as a-tr: counted together
        group('solo', 'en', 5, T1),
        group('b-tr', 'en', 5, T2),
        group('gone', 'en', 9, T2), // story deleted meanwhile
      ]);
      const stories = [
        storyRef({ id: 'a-tr', title: 'Parmak Kız', translationGroupId: 'a' }),
        storyRef({ id: 'a-en', title: 'Thumbelina', language: 'en', translationGroupId: 'a', translatedFromId: 'a-tr' }),
        storyRef({ id: 'solo', title: 'Keloğlan' }),
        storyRef({ id: 'b-tr', title: 'Uykulu Ay', translationGroupId: 'b' }),
        storyRef({ id: 'b-en', title: 'Sleepy Moon', language: 'en', status: 'DRAFT', translationGroupId: 'b' }),
      ];
      prisma.story.findMany
        .mockResolvedValueOnce(stories.filter((s) => s.id !== 'b-en'))
        .mockResolvedValueOnce(stories);

      const page = await service.listForAdmin({});

      expect(prisma.storyTranslationRequest.groupBy).toHaveBeenCalledWith({
        by: ['storyId', 'language'],
        where: { fulfilledAt: null },
        _count: { _all: true },
        _max: { createdAt: true },
      });
      expect(page).toMatchObject({ total: 3, page: 1, limit: 20, totalPages: 1 });
      expect(page.data.map((row) => [row.groupKey, row.language, row.requestCount])).toEqual([
        ['a', 'de', 5], // 2 + 3 from both language versions, latest T2
        ['b', 'en', 5], // same count and date: by key
        ['solo', 'en', 5], // same count, older latest request
      ]);
      expect(page.data[0].latestRequestedAt).toEqual(T2);
    });

    it('each row names the story to translate from, the languages of the tale and an existing version', async () => {
      prisma.storyTranslationRequest.groupBy.mockResolvedValue([group('b-tr', 'en', 4, T1), group('a-en', 'de', 1, T0)]);
      const members = [
        storyRef({ id: 'b-tr', title: 'Uykulu Ay', translationGroupId: 'b' }),
        storyRef({ id: 'b-en', title: 'Sleepy Moon', language: 'en', status: 'DRAFT', translationGroupId: 'b' }),
        storyRef({ id: 'a-tr', title: 'Parmak Kız', status: 'DRAFT', translationGroupId: 'a' }),
        storyRef({ id: 'a-en', title: 'Thumbelina', language: 'en', translationGroupId: 'a', translatedFromId: 'a-tr' }),
      ];
      prisma.story.findMany.mockResolvedValueOnce([members[0], members[3]]).mockResolvedValueOnce(members);

      const page = await service.listForAdmin({ page: 1, limit: 10 });

      expect(prisma.story.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { OR: [{ translationGroupId: { in: ['b', 'a'] } }, { id: { in: ['b', 'a'] } }] },
        }),
      );
      expect(page.data[0]).toEqual({
        groupKey: 'b',
        language: 'en',
        languageName: 'İngilizce',
        requestCount: 4,
        latestRequestedAt: T1,
        story: { id: 'b-tr', title: 'Uykulu Ay', language: 'tr', status: 'PUBLISHED' },
        groupLanguages: ['tr', 'en'],
        // A draft translation is already waiting for review.
        existingVersion: { id: 'b-en', title: 'Sleepy Moon', status: 'DRAFT' },
      });
      // The published version is the source, not the draft original.
      expect(page.data[1]).toMatchObject({
        groupKey: 'a',
        language: 'de',
        languageName: 'Almanca',
        story: { id: 'a-en', status: 'PUBLISHED' },
        existingVersion: null,
      });
    });

    it('falls back to an unpublished source, and to no source when the tale has no other language', async () => {
      prisma.storyTranslationRequest.groupBy.mockResolvedValue([group('solo', 'en', 1, null), group('odd', 'tr', 1, T0)]);
      const solo = storyRef({ id: 'solo', title: 'Keloğlan', status: 'ARCHIVED' });
      const odd = storyRef({ id: 'odd', title: 'Tek', language: 'tr' });
      prisma.story.findMany.mockResolvedValueOnce([solo, odd]).mockResolvedValueOnce([solo, odd]);

      const page = await service.listForAdmin();

      const byKey = Object.fromEntries(page.data.map((row) => [row.groupKey, row]));
      expect(byKey.solo.story).toEqual({ id: 'solo', title: 'Keloğlan', language: 'tr', status: 'ARCHIVED' });
      expect(byKey.solo.latestRequestedAt).toBeNull();
      // Requested in the language the only story is in: nothing to translate from.
      expect(byKey.odd.story).toBeNull();
      expect(byKey.odd.existingVersion).toEqual({ id: 'odd', title: 'Tek', status: 'PUBLISHED' });
    });

    it('status and language narrow the query; pages are cut after sorting', async () => {
      prisma.storyTranslationRequest.groupBy.mockResolvedValue([
        group('s1', 'en', 3, T0),
        group('s2', 'en', 2, T0),
        group('s3', 'en', 1, T0),
      ]);
      const stories = ['s1', 's2', 's3'].map((id) => storyRef({ id, title: id }));
      prisma.story.findMany.mockResolvedValue(stories);

      const page = await service.listForAdmin({ status: 'fulfilled', language: 'en', page: 2, limit: 2 });

      expect(prisma.storyTranslationRequest.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { fulfilledAt: { not: null }, language: 'en' } }),
      );
      expect(page).toMatchObject({ total: 3, page: 2, limit: 2, totalPages: 2 });
      expect(page.data.map((row) => row.groupKey)).toEqual(['s3']);
    });

    it('ties on count and date are ordered by key so pages are stable', async () => {
      prisma.storyTranslationRequest.groupBy.mockResolvedValue([
        group('s2', 'en', 1, T0),
        group('s1', 'en', 1, T0),
        group('s1', 'de', 1, T0),
        group('s3', 'en', 1, null),
        group('s4', 'en', 1, null),
      ]);
      prisma.story.findMany.mockResolvedValue(['s1', 's2', 's3', 's4'].map((id) => storyRef({ id })));

      const page = await service.listForAdmin({});

      expect(page.data.map((row) => `${row.groupKey}:${row.language}`)).toEqual([
        's1:de',
        's1:en',
        's2:en',
        's3:en',
        's4:en',
      ]);
    });

    it('no requests: an empty page and no second story query', async () => {
      const page = await service.listForAdmin({});

      expect(page).toEqual({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
      expect(prisma.story.findMany).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------
  describe('summaryForStories (badge on admin story rows)', () => {
    it('counts open requests for the whole tale of every row, most requested language first', async () => {
      prisma.storyTranslationRequest.findMany.mockResolvedValue([
        { storyId: 'a-tr', language: 'en', story: { translationGroupId: 'a' } },
        { storyId: 'a-de', language: 'en', story: { translationGroupId: 'a' } }, // made from a sibling
        { storyId: 'a-tr', language: 'fr', story: { translationGroupId: 'a' } },
        { storyId: 'solo', language: 'de', story: { translationGroupId: null } },
        { storyId: 'solo', language: 'ar', story: { translationGroupId: null } },
      ]);

      const summaries = await service.summaryForStories([
        { id: 'a-tr', translationGroupId: 'a' },
        { id: 'solo', translationGroupId: null },
        { id: 'quiet' },
      ]);

      expect(prisma.storyTranslationRequest.findMany).toHaveBeenCalledWith({
        where: {
          fulfilledAt: null,
          OR: [{ storyId: { in: ['a-tr', 'solo', 'quiet'] } }, { story: { translationGroupId: { in: ['a'] } } }],
        },
        select: { storyId: true, language: true, story: { select: { translationGroupId: true } } },
      });
      expect(summaries.get('a-tr')).toEqual({
        total: 3,
        languages: [
          { language: 'en', count: 2 },
          { language: 'fr', count: 1 },
        ],
      });
      // Equal counts: by language code.
      expect(summaries.get('solo')).toEqual({
        total: 2,
        languages: [
          { language: 'ar', count: 1 },
          { language: 'de', count: 1 },
        ],
      });
      expect(summaries.has('quiet')).toBe(false);
    });

    it('rows without a group need no group filter; an empty page makes no query', async () => {
      await service.summaryForStories([{ id: 's1' }]);
      expect(prisma.storyTranslationRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { fulfilledAt: null, OR: [{ storyId: { in: ['s1'] } }] } }),
      );

      prisma.storyTranslationRequest.findMany.mockClear();
      await expect(service.summaryForStories([])).resolves.toEqual(new Map());
      expect(prisma.storyTranslationRequest.findMany).not.toHaveBeenCalled();
    });
  });
});
