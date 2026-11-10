import { NotFoundException, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { AdminContentController } from './admin-content.controller';
import { AdminJwtAuthGuard } from '../../../common/guards/admin-jwt-auth.guard';
import { AdminRolesGuard } from '../../../common/guards/admin-roles.guard';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { ADMIN_ROLES_KEY } from '../../../common/decorators/admin-roles.decorator';

describe('AdminContentController', () => {
  let stories: Record<string, jest.Mock>;
  let audio: Record<string, jest.Mock>;
  let adminService: Record<string, jest.Mock>;
  let collections: Record<string, jest.Mock>;
  let legal: Record<string, jest.Mock>;
  let llmTasks: Record<string, jest.Mock>;
  let translationRequests: Record<string, jest.Mock>;
  let storyImport: Record<string, jest.Mock>;
  let storySegments: Record<string, jest.Mock>;
  let storyReview: Record<string, jest.Mock>;
  let controller: AdminContentController;

  const ok = (v: any = { ok: true }) => jest.fn().mockResolvedValue(v);

  beforeEach(() => {
    stories = {
      getAllStories: ok(),
      getStoryById: ok(),
      createStory: ok(),
      updateStory: ok(),
      deleteStory: ok({ message: 'Story deleted successfully' }),
      previewSegments: ok(),
      clearPreprocessedSegments: ok(),
      llmFillSegments: ok(),
      getStoriesMeta: jest.fn().mockReturnValue({ languages: {}, enums: {} }),
      linkTranslation: ok(),
      unlinkTranslation: ok(),
      setCover: ok({ appliedTo: 2 }),
    };
    audio = { adminListAudio: ok(), getAudioById: ok(), adminDeleteAudio: ok() };
    adminService = { listVoiceProfilesForModeration: ok(), rejectVoiceProfile: ok() };
    collections = {
      listAdmin: ok(),
      getStoriesAdmin: ok(),
      create: ok(),
      update: ok(),
      remove: ok(),
      addStories: ok(),
      removeStory: ok(),
      reorder: ok(),
    };
    legal = { listAdmin: ok(), getAdminBySlug: ok(), listVersions: ok(), create: ok(), update: ok(), publish: ok() };
    llmTasks = {
      listTasks: ok({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
      requestTranslation: ok({ id: 't1', status: 'PENDING' }),
      requestTranslationBatch: ok({ targetLanguage: 'en', queued: [], skipped: [] }),
      requestLevelAssessment: ok({ id: 't2', status: 'PENDING' }),
      requestLevelAssessmentBatch: ok({ matched: 0, queued: [], skipped: [] }),
      requestAgeGroupAssessment: ok({ id: 't3', status: 'PENDING' }),
    };
    translationRequests = {
      listForAdmin: ok({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
    };
    storyImport = { importStories: ok({ total: 1 }) };
    storySegments = {
      getSegments: ok({ segments: [] }),
      saveSegments: ok({ version: 2 }),
      cacheSummary: ok({ narrations: 0 }),
      clearCache: ok({ removedAudios: 0 }),
    };
    storyReview = {
      reviewList: ok({ data: [] }),
      listImportBatches: ok({ batches: [] }),
      setReviewed: ok({ reviewed: true }),
      listIds: ok({ total: 0, limit: 1000, truncated: false, items: [] }),
      bulkSetReviewed: ok({ reviewed: true, requested: 1, changed: 1, unchanged: 0, missing: [] }),
      bulkPublish: ok({ published: [], skipped: [] }),
      bulkArchive: ok({ archived: [], skipped: [] }),
      deletePreview: ok({ stories: 1 }),
      bulkDelete: ok({ deleted: 1 }),
      matchCovers: ok({ results: [] }),
    };
    controller = new AdminContentController(
      stories as any,
      audio as any,
      adminService as any,
      collections as any,
      legal as any,
      llmTasks as any,
      translationRequests as any,
      storyImport as any,
      storySegments as any,
      storyReview as any,
    );
  });

  describe('route metadata', () => {
    it('bypasses the user JWT guard but stacks the admin JWT + roles guards', () => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, AdminContentController)).toBe(true);
      expect(Reflect.getMetadata(GUARDS_METADATA, AdminContentController)).toEqual([
        AdminJwtAuthGuard,
        AdminRolesGuard,
      ]);
    });

    it.each([
      ['getAllStories', RequestMethod.GET, 'stories'],
      ['getStoriesMeta', RequestMethod.GET, 'stories/meta'],
      ['linkStoryTranslation', RequestMethod.POST, 'stories/:id/link-translation'],
      ['unlinkStoryTranslation', RequestMethod.DELETE, 'stories/:id/translation-link'],
      ['createStory', RequestMethod.POST, 'stories'],
      ['updateStory', RequestMethod.PATCH, 'stories/:id'],
      ['deleteStory', RequestMethod.DELETE, 'stories/:id'],
      ['updateStorySegments', RequestMethod.PATCH, 'stories/:id/segments'],
      ['getStorySegments', RequestMethod.GET, 'stories/:id/segments'],
      ['getNarrationCache', RequestMethod.GET, 'stories/:id/narration-cache'],
      ['clearNarrationCache', RequestMethod.DELETE, 'stories/:id/narration-cache'],
      ['importStories', RequestMethod.POST, 'stories/import'],
      ['clearStorySegments', RequestMethod.DELETE, 'stories/:id/segments'],
      ['llmFillStorySegments', RequestMethod.POST, 'stories/:id/segments/llm-fill'],
      ['listStoryLlmTasks', RequestMethod.GET, 'stories/llm-tasks'],
      ['translateStory', RequestMethod.POST, 'stories/:id/translate'],
      ['translateStoriesBatch', RequestMethod.POST, 'stories/translate-batch'],
      ['assessStoryLevel', RequestMethod.POST, 'stories/:id/level/assess'],
      ['assessStoryLevelsBatch', RequestMethod.POST, 'stories/level/assess-batch'],
      ['deleteAudio', RequestMethod.DELETE, 'audio/:id'],
      ['listVoiceProfilesForModeration', RequestMethod.GET, 'moderation/voice-profiles'],
      ['rejectVoiceProfile', RequestMethod.POST, 'moderation/:id/reject'],
      ['publishLegalDocument', RequestMethod.POST, 'legal/:slug/publish'],
      ['getReviewList', RequestMethod.GET, 'stories/review'],
      ['listImportBatches', RequestMethod.GET, 'stories/import-batches'],
      ['listStoryIds', RequestMethod.GET, 'stories/ids'],
      ['bulkReview', RequestMethod.PATCH, 'stories/bulk/review'],
      ['bulkPublish', RequestMethod.POST, 'stories/bulk/publish'],
      ['bulkArchive', RequestMethod.POST, 'stories/bulk/archive'],
      ['bulkDeletePreview', RequestMethod.POST, 'stories/bulk/delete-preview'],
      ['bulkDelete', RequestMethod.POST, 'stories/bulk/delete'],
      ['matchCovers', RequestMethod.POST, 'stories/covers/match'],
      ['setStoryReviewed', RequestMethod.PATCH, 'stories/:id/review'],
      ['setStoryCover', RequestMethod.POST, 'stories/:id/cover'],
    ])('%s is %s /admin/%s', (method, verb, path) => {
      const handler = (AdminContentController.prototype as any)[method];
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(verb);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    });

    it('there is intentionally no moderation "approve" route', () => {
      const methods = Object.getOwnPropertyNames(AdminContentController.prototype);
      expect(methods.filter((m) => /approve/i.test(m))).toEqual([]);
    });
  });

  describe('review, bulk actions and covers', () => {
    const admin = { id: 'a1', email: 'admin@sesly.io' };

    it('the fixed story paths are declared before stories/:id', () => {
      const order = Object.getOwnPropertyNames(AdminContentController.prototype);
      for (const method of ['getReviewList', 'listImportBatches', 'listStoryIds', 'bulkPublish', 'matchCovers', 'setStoryCover']) {
        expect(order.indexOf(method)).toBeLessThan(order.indexOf('getStoryById'));
      }
      // PATCH stories/bulk/review must not be read as stories/:id/review with the id "bulk".
      expect(order.indexOf('bulkReview')).toBeLessThan(order.indexOf('setStoryReviewed'));
    });

    it('forwards the review list query and the batch list', async () => {
      const query = { importBatch: 'import-batch1.json', reviewed: false } as any;
      await controller.getReviewList(query);
      expect(storyReview.reviewList).toHaveBeenCalledWith(query);
      await expect(controller.listImportBatches()).resolves.toEqual({ batches: [] });
    });

    it('forwards the id list query and the bulk review with the acting admin', async () => {
      const query = { view: 'review', importBatch: 'a.json' } as any;
      await controller.listStoryIds(query);
      expect(storyReview.listIds).toHaveBeenCalledWith(query);
      await controller.bulkReview({ storyIds: ['s1', 's2'], reviewed: true }, admin);
      expect(storyReview.bulkSetReviewed).toHaveBeenCalledWith(['s1', 's2'], true, 'admin@sesly.io');
      await controller.bulkReview({ storyIds: ['s1'], reviewed: false }, { id: 'a1' });
      expect(storyReview.bulkSetReviewed).toHaveBeenLastCalledWith(['s1'], false, 'a1');
      await controller.bulkReview({ storyIds: ['s1'], reviewed: false });
      expect(storyReview.bulkSetReviewed).toHaveBeenLastCalledWith(['s1'], false, null);
    });

    it('bulk publish passes requireReviewed and the acting admin', async () => {
      await controller.bulkPublish({ storyIds: ['s1'], requireReviewed: true }, admin);
      expect(storyReview.bulkPublish).toHaveBeenCalledWith(['s1'], { requireReviewed: true }, 'admin@sesly.io');
      await controller.bulkPublish({ storyIds: ['s2'] });
      expect(storyReview.bulkPublish).toHaveBeenLastCalledWith(['s2'], { requireReviewed: undefined }, null);
    });

    it('bulk archive, delete preview and delete', async () => {
      await controller.bulkArchive({ storyIds: ['s1'] }, { id: 'a1' });
      expect(storyReview.bulkArchive).toHaveBeenCalledWith(['s1'], 'a1');
      await controller.bulkArchive({ storyIds: ['s1'] });
      expect(storyReview.bulkArchive).toHaveBeenLastCalledWith(['s1'], null);
      await controller.bulkDeletePreview({ storyIds: ['s1'] });
      expect(storyReview.deletePreview).toHaveBeenCalledWith(['s1']);
      await controller.bulkDelete({ storyIds: ['s1'], expectedCount: 1, confirm: 'SİL' }, admin);
      expect(storyReview.bulkDelete).toHaveBeenCalledWith(['s1'], 1, 'admin@sesly.io');
      await controller.bulkDelete({ storyIds: ['s1'], expectedCount: 1, confirm: 'SİL' });
      expect(storyReview.bulkDelete).toHaveBeenLastCalledWith(['s1'], 1, null);
    });

    it('cover match, review toggle and cover upload', async () => {
      await controller.matchCovers({ keys: ['tattercoats'] });
      expect(storyReview.matchCovers).toHaveBeenCalledWith(['tattercoats']);
      await controller.setStoryReviewed('s1', { reviewed: true }, admin);
      expect(storyReview.setReviewed).toHaveBeenCalledWith('s1', true, 'admin@sesly.io');
      await controller.setStoryReviewed('s1', { reviewed: false });
      expect(storyReview.setReviewed).toHaveBeenLastCalledWith('s1', false, null);

      const file = { buffer: Buffer.from('x') } as any;
      await controller.setStoryCover('s1', file, { coverCredit: '{"illustrator":"Ada"}', applyCoverToTale: false });
      expect(stories.setCover).toHaveBeenCalledWith('s1', file, {
        coverCredit: '{"illustrator":"Ada"}',
        applyCoverToTale: false,
      });
      await controller.setStoryCover('s1', file, undefined as any);
      expect(stories.setCover).toHaveBeenLastCalledWith('s1', file, { coverCredit: undefined, applyCoverToTale: undefined });
    });
  });

  describe('story LLM tasks (translation, language level)', () => {
    it('llm-tasks is declared before stories/:id and forwards the query', async () => {
      const order = Object.getOwnPropertyNames(AdminContentController.prototype);
      expect(order.indexOf('listStoryLlmTasks')).toBeLessThan(order.indexOf('getStoryById'));

      const query = { page: 2, limit: 10, storyId: 's1', status: 'FAILED', type: 'TRANSLATE' } as any;
      await expect(controller.listStoryLlmTasks(query)).resolves.toMatchObject({ data: [] });
      expect(llmTasks.listTasks).toHaveBeenCalledWith(query);
    });

    it.each(['translateStory', 'translateStoriesBatch', 'assessStoryLevel', 'assessStoryLevelsBatch'])(
      '%s answers 202 and is limited to SUPER_ADMIN and ADMIN',
      (method) => {
        const handler = (AdminContentController.prototype as any)[method];
        expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(202);
        expect(Reflect.getMetadata(ADMIN_ROLES_KEY, handler)).toEqual(['SUPER_ADMIN', 'ADMIN']);
      },
    );

    it('age-group/assess: POST /admin/stories/:id/age-group/assess, 202, SUPER_ADMIN and ADMIN only', async () => {
      const handler = AdminContentController.prototype.assessStoryAgeGroup;
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('stories/:id/age-group/assess');
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(202);
      expect(Reflect.getMetadata(ADMIN_ROLES_KEY, handler)).toEqual(['SUPER_ADMIN', 'ADMIN']);

      await expect(controller.assessStoryAgeGroup('s1', { force: true }, { id: 'admin-1' })).resolves.toMatchObject({
        id: 't3',
      });
      expect(llmTasks.requestAgeGroupAssessment).toHaveBeenCalledWith('s1', { force: true, adminId: 'admin-1' });

      await controller.assessStoryAgeGroup('s1', undefined as any);
      expect(llmTasks.requestAgeGroupAssessment).toHaveBeenLastCalledWith('s1', {
        force: undefined,
        adminId: null,
      });
    });

    it('translation-requests is declared before stories/:id, forwards the query and is readable by every admin role', async () => {
      const handler = AdminContentController.prototype.listTranslationRequests;
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('stories/translation-requests');
      expect(Reflect.getMetadata(ADMIN_ROLES_KEY, handler)).toBeUndefined();
      const order = Object.getOwnPropertyNames(AdminContentController.prototype);
      expect(order.indexOf('listTranslationRequests')).toBeLessThan(order.indexOf('getStoryById'));

      const query = { page: 2, limit: 10, status: 'fulfilled', language: 'en' } as any;
      await expect(controller.listTranslationRequests(query)).resolves.toMatchObject({ data: [] });
      expect(translationRequests.listForAdmin).toHaveBeenCalledWith(query);
    });

    it('listing tasks keeps the class roles (moderators may watch progress)', () => {
      const handler = AdminContentController.prototype.listStoryLlmTasks;
      expect(Reflect.getMetadata(ADMIN_ROLES_KEY, handler)).toBeUndefined();
    });

    it('translate passes the target language, replaceDraft and the acting admin', async () => {
      await expect(
        controller.translateStory('s1', { targetLanguage: 'en', replaceDraft: true }, { id: 'admin-1' }),
      ).resolves.toEqual({ id: 't1', status: 'PENDING' });
      expect(llmTasks.requestTranslation).toHaveBeenCalledWith('s1', 'en', {
        replaceDraft: true,
        adminId: 'admin-1',
      });

      await controller.translateStory('s2', { targetLanguage: 'de' });
      expect(llmTasks.requestTranslation).toHaveBeenLastCalledWith('s2', 'de', {
        replaceDraft: undefined,
        adminId: null,
      });
    });

    it('translate-batch passes the ids, the language and the acting admin', async () => {
      await controller.translateStoriesBatch({ storyIds: ['a', 'b'], targetLanguage: 'en' }, { id: 'admin-1' });
      expect(llmTasks.requestTranslationBatch).toHaveBeenCalledWith(['a', 'b'], 'en', 'admin-1');

      await controller.translateStoriesBatch({ storyIds: ['a'], targetLanguage: 'fr' });
      expect(llmTasks.requestTranslationBatch).toHaveBeenLastCalledWith(['a'], 'fr', null);
    });

    it('level/assess passes force and the acting admin, and tolerates a missing body', async () => {
      await controller.assessStoryLevel('s1', { force: true }, { id: 'admin-1' });
      expect(llmTasks.requestLevelAssessment).toHaveBeenCalledWith('s1', { force: true, adminId: 'admin-1' });

      await controller.assessStoryLevel('s1', undefined as any);
      expect(llmTasks.requestLevelAssessment).toHaveBeenLastCalledWith('s1', { force: undefined, adminId: null });
    });

    it('level/assess-batch passes the filter and tolerates a missing body', async () => {
      await controller.assessStoryLevelsBatch(
        { storyIds: ['a'], language: 'en', onlyMissing: true },
        { id: 'admin-1' },
      );
      expect(llmTasks.requestLevelAssessmentBatch).toHaveBeenCalledWith(
        { storyIds: ['a'], language: 'en', onlyMissing: true },
        'admin-1',
      );

      await controller.assessStoryLevelsBatch(undefined as any);
      expect(llmTasks.requestLevelAssessmentBatch).toHaveBeenLastCalledWith(
        { storyIds: undefined, language: undefined, onlyMissing: undefined },
        null,
      );
    });
  });

  describe('stories', () => {
    it('list forwards the whole filter object (defaults are applied by the service)', async () => {
      await controller.getAllStories({} as any);
      expect(stories.getAllStories).toHaveBeenCalledWith({});

      const query = {
        page: 2,
        limit: 50,
        language: 'en',
        status: 'DRAFT',
        languageLevel: ['A1'],
        category: 'BEDTIME',
        ageGroup: 'TEN_PLUS',
        origin: 'PUBLIC_DOMAIN',
        q: 'wolf',
        missingLanguage: 'de',
        sort: 'title',
      } as any;
      await controller.getAllStories(query);
      expect(stories.getAllStories).toHaveBeenLastCalledWith(query);
    });

    it('stories/meta is declared before stories/:id so "meta" is not read as an id', () => {
      const order = Object.getOwnPropertyNames(AdminContentController.prototype);
      expect(order.indexOf('getStoriesMeta')).toBeLessThan(order.indexOf('getStoryById'));
      expect(controller.getStoriesMeta()).toEqual({ languages: {}, enums: {} });
    });

    it('link / unlink translation use the path id and the body otherStoryId', async () => {
      await controller.linkStoryTranslation('s1', { otherStoryId: 's2' });
      expect(stories.linkTranslation).toHaveBeenCalledWith('s1', 's2');
      await controller.unlinkStoryTranslation('s1');
      expect(stories.unlinkTranslation).toHaveBeenCalledWith('s1');
    });

    it('only SUPER_ADMIN and ADMIN may change translation groups; every admin role reads the meta', () => {
      const roles = (method: string) =>
        Reflect.getMetadata(ADMIN_ROLES_KEY, (AdminContentController.prototype as any)[method]);
      expect(roles('linkStoryTranslation')).toEqual(['SUPER_ADMIN', 'ADMIN']);
      expect(roles('unlinkStoryTranslation')).toEqual(['SUPER_ADMIN', 'ADMIN']);
      expect(roles('getStoriesMeta')).toBeUndefined();
      expect(Reflect.getMetadata(ADMIN_ROLES_KEY, AdminContentController)).toEqual([
        'SUPER_ADMIN',
        'ADMIN',
        'MODERATOR',
      ]);
    });

    it('create / update forward DTO and the uploaded cover file', async () => {
      const file = { originalname: 'c.png' } as Express.Multer.File;
      const dto = { title: 't' } as any;

      await controller.createStory(dto, file);
      expect(stories.createStory).toHaveBeenCalledWith(dto, file, null);

      await controller.updateStory('s1', dto, file);
      expect(stories.updateStory).toHaveBeenCalledWith('s1', dto, file, null);
    });

    it('create / update pass the acting admin (email, else id) for the rights audit', async () => {
      const file = undefined as any;
      const dto = { title: 't' } as any;

      await controller.createStory(dto, file, { id: 'admin-1', email: 'admin@sesly.app' });
      expect(stories.createStory).toHaveBeenLastCalledWith(dto, file, 'admin@sesly.app');

      await controller.updateStory('s1', dto, file, { id: 'admin-1' });
      expect(stories.updateStory).toHaveBeenLastCalledWith('s1', dto, file, 'admin-1');

      await controller.createStory(dto, file, { id: 'admin-1' });
      expect(stories.createStory).toHaveBeenLastCalledWith(dto, file, 'admin-1');

      await controller.updateStory('s1', dto, file, { id: 'admin-1', email: 'admin@sesly.app' });
      expect(stories.updateStory).toHaveBeenLastCalledWith('s1', dto, file, 'admin@sesly.app');
    });

    it('delete / preview / clear / llm-fill use the path id', async () => {
      await expect(controller.deleteStory('s1')).resolves.toEqual({ message: 'Story deleted successfully' });
      expect(stories.deleteStory).toHaveBeenCalledWith('s1');
      await controller.previewStorySegments('s2');
      expect(stories.previewSegments).toHaveBeenCalledWith('s2');
      await controller.clearStorySegments('s3');
      expect(stories.clearPreprocessedSegments).toHaveBeenCalledWith('s3');
      await controller.llmFillStorySegments('s4');
      expect(stories.llmFillSegments).toHaveBeenCalledWith('s4');
      await controller.getStoryById('s5');
      expect(stories.getStoryById).toHaveBeenCalledWith('s5');
    });

    it('segment update forwards the segments and the version the editor loaded', async () => {
      const segments = [{ text: 'a', emotion: 'calm' }];
      await controller.updateStorySegments('s1', { segments, expectedVersion: 3 } as any);
      expect(storySegments.saveSegments).toHaveBeenCalledWith('s1', segments, 3);
    });

    it('segments, cache summary and cache clear use the path id; clear names the admin', async () => {
      await controller.getStorySegments('s1');
      expect(storySegments.getSegments).toHaveBeenCalledWith('s1');
      await controller.getNarrationCache('s2');
      expect(storySegments.cacheSummary).toHaveBeenCalledWith('s2');
      await controller.clearNarrationCache('s3', { id: 'a-1', email: 'admin@sesly.app' });
      expect(storySegments.clearCache).toHaveBeenCalledWith('s3', 'admin@sesly.app');
      await controller.clearNarrationCache('s4');
      expect(storySegments.clearCache).toHaveBeenLastCalledWith('s4', null);
    });

    it('import forwards the body and the admin; writes need SUPER_ADMIN or ADMIN; declared before stories/:id', async () => {
      const dto = { stories: [{ title: 'x' }], dryRun: true } as any;
      await controller.importStories(dto, { id: 'a-1' });
      expect(storyImport.importStories).toHaveBeenCalledWith(dto, 'a-1');
      await controller.importStories(dto);
      expect(storyImport.importStories).toHaveBeenLastCalledWith(dto, null);
      for (const method of ['importStories', 'updateStorySegments', 'clearNarrationCache']) {
        const handler = (AdminContentController.prototype as any)[method];
        expect(Reflect.getMetadata(ADMIN_ROLES_KEY, handler)).toEqual(['SUPER_ADMIN', 'ADMIN']);
      }
      const order = Object.getOwnPropertyNames(AdminContentController.prototype);
      expect(order.indexOf('importStories')).toBeLessThan(order.indexOf('getStoryById'));
    });

    it('a 404 from the service propagates', async () => {
      stories.deleteStory.mockRejectedValue(new NotFoundException('Story not found'));
      await expect(controller.deleteStory('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('audio + moderation', () => {
    it('audio routes use the admin variants of AudioService', async () => {
      const q = { page: 1, limit: 20 } as any;
      await controller.listAllAudio(q);
      expect(audio.adminListAudio).toHaveBeenCalledWith(q);
      await controller.deleteAudio('a1');
      expect(audio.adminDeleteAudio).toHaveBeenCalledWith('a1');
      await controller.getAudio('a2');
      expect(audio.getAudioById).toHaveBeenCalledWith('a2');
    });

    it('moderation list: defaults and status filter', async () => {
      await controller.listVoiceProfilesForModeration({} as any);
      expect(adminService.listVoiceProfilesForModeration).toHaveBeenCalledWith(1, 20, undefined);
      await controller.listVoiceProfilesForModeration({ page: 2, limit: 5, status: 'FAILED' } as any);
      expect(adminService.listVoiceProfilesForModeration).toHaveBeenLastCalledWith(2, 5, 'FAILED');
    });

    it('reject: reason optional (body may be empty)', async () => {
      await controller.rejectVoiceProfile('vp1', { reason: 'gurultu' });
      expect(adminService.rejectVoiceProfile).toHaveBeenCalledWith('vp1', 'gurultu');

      await controller.rejectVoiceProfile('vp2', undefined as any);
      expect(adminService.rejectVoiceProfile).toHaveBeenLastCalledWith('vp2', undefined);
    });
  });

  describe('collections', () => {
    it('list / stories pagination defaults + search', async () => {
      await controller.listCollections({} as any);
      expect(collections.listAdmin).toHaveBeenCalledWith(1, 20, undefined, undefined);
      await controller.listCollections({ page: 3, limit: 10, search: 'uyku', language: 'en' } as any);
      expect(collections.listAdmin).toHaveBeenLastCalledWith(3, 10, 'uyku', 'en');
      await controller.listCollectionStories('c1', {} as any);
      expect(collections.getStoriesAdmin).toHaveBeenCalledWith('c1', 1, 20);
    });

    it('mutations delegate with path ids', async () => {
      const dto = { title: 'x' } as any;
      await controller.createCollection(dto);
      expect(collections.create).toHaveBeenCalledWith(dto);
      await controller.updateCollection('c1', dto);
      expect(collections.update).toHaveBeenCalledWith('c1', dto);
      await controller.deleteCollection('c1');
      expect(collections.remove).toHaveBeenCalledWith('c1');
      await controller.addStoriesToCollection('c1', { storyIds: ['s1'] } as any);
      expect(collections.addStories).toHaveBeenCalledWith('c1', { storyIds: ['s1'] });
      await controller.removeStoryFromCollection('c1', 's1');
      expect(collections.removeStory).toHaveBeenCalledWith('c1', 's1');
      await controller.reorderCollectionStories('c1', { storyIds: ['s2', 's1'] } as any);
      expect(collections.reorder).toHaveBeenCalledWith('c1', { storyIds: ['s2', 's1'] });
    });
  });

  describe('legal documents', () => {
    it('reads / writes delegate; no language (the calls the panel makes today) is passed on as undefined = tr', async () => {
      await controller.listLegalDocuments({});
      expect(legal.listAdmin).toHaveBeenCalledWith(undefined);
      await controller.getLegalDocument('tos', {});
      expect(legal.getAdminBySlug).toHaveBeenCalledWith('tos', undefined);
      await controller.listLegalDocumentVersions('tos', {});
      expect(legal.listVersions).toHaveBeenCalledWith('tos', undefined);
      const dto = { slug: 'kvkk' } as any;
      await controller.createLegalDocument(dto);
      expect(legal.create).toHaveBeenCalledWith(dto);
      await controller.updateLegalDocument('kvkk', dto, {});
      expect(legal.update).toHaveBeenCalledWith('kvkk', dto, undefined);
    });

    it('every per-document route forwards ?language= to the service', async () => {
      await controller.listLegalDocuments({ language: 'all' });
      expect(legal.listAdmin).toHaveBeenLastCalledWith('all');
      await controller.listLegalDocuments({ language: 'en' });
      expect(legal.listAdmin).toHaveBeenLastCalledWith('en');
      await controller.getLegalDocument('tos', { language: 'en' });
      expect(legal.getAdminBySlug).toHaveBeenLastCalledWith('tos', 'en');
      await controller.listLegalDocumentVersions('tos', { language: 'en' });
      expect(legal.listVersions).toHaveBeenLastCalledWith('tos', 'en');
      const patch = { title: 'Terms of Use' } as any;
      await controller.updateLegalDocument('tos', patch, { language: 'en' });
      expect(legal.update).toHaveBeenLastCalledWith('tos', patch, 'en');
      await controller.publishLegalDocument('tos', { email: 'admin@sesly.io' }, { language: 'en' });
      expect(legal.publish).toHaveBeenLastCalledWith('tos', 'admin@sesly.io', 'en');
    });

    it.each([
      [{ id: 'a1', email: 'admin@sesly.app' }, 'admin@sesly.app'],
      [{ id: 'a1' }, 'a1'],
      [undefined, null],
    ])('publish attributes the version to the authenticated admin %p -> %p', async (admin, expected) => {
      await controller.publishLegalDocument('tos', admin as any, {});
      expect(legal.publish).toHaveBeenCalledWith('tos', expected, undefined);
    });

    it('publish: the admin argument is resolved from request.user (@CurrentAdmin), never from the body', () => {
      const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, AdminContentController, 'publishLegalDocument');
      const custom = Object.entries(args).find(([k]) => k.includes('__customRouteArgs__')) as [string, any];
      expect(custom).toBeDefined();
      expect(custom[1].index).toBe(1);
      // No @Body() on this route at all.
      expect(Object.keys(args).some((k) => k.startsWith('3:'))).toBe(false);

      const request = {
        user: { id: 'real-admin', email: 'real@sesly.app' },
        body: { email: 'spoofed@evil.test', id: 'spoofed' },
      };
      const ctx = { switchToHttp: () => ({ getRequest: () => request }) };
      expect(custom[1].factory(custom[1].data, ctx)).toEqual({ id: 'real-admin', email: 'real@sesly.app' });
    });
  });
});
