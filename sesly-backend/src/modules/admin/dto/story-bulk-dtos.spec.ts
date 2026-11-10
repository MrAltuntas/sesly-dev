import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminStoriesQueryDto, AdminStoryIdsQueryDto } from './admin-stories-query.dto';
import {
  BulkDeleteDto,
  BulkPublishDto,
  BulkReviewDto,
  CoverMatchDto,
  ReviewStoryDto,
  SetCoverDto,
  StoryIdsDto,
} from './story-bulk.dto';
import { ImportStoriesDto } from './import-stories.dto';

/** Same options as the global ValidationPipe in main.ts. */
async function check<T extends object>(cls: new () => T, plain: Record<string, any>) {
  const instance = plainToInstance(cls, plain);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return { instance, invalid: errors.map((e) => e.property) };
}

describe('admin story list: review filters', () => {
  it('imported / reviewed accept true, false, 1, 0; blank is no filter; anything else is refused', async () => {
    expect((await check(AdminStoriesQueryDto, { imported: 'true', reviewed: '0' })).instance).toMatchObject({
      imported: true,
      reviewed: false,
    });
    expect((await check(AdminStoriesQueryDto, { imported: 'FALSE', reviewed: '1' })).instance).toMatchObject({
      imported: false,
      reviewed: true,
    });
    const blank = await check(AdminStoriesQueryDto, { imported: ' ' });
    expect(blank.invalid).toEqual([]);
    expect(blank.instance.imported).toBeUndefined();
    expect((await check(AdminStoriesQueryDto, { imported: 'yes', reviewed: 3 })).invalid).toEqual(['imported', 'reviewed']);
    expect((await check(AdminStoriesQueryDto, { imported: true })).invalid).toEqual([]);
  });

  it('limit: 1 to 200 rows per page (the base pagination stops at 100)', async () => {
    const big = await check(AdminStoriesQueryDto, { limit: '200', page: '2' });
    expect(big.invalid).toEqual([]);
    expect(big.instance).toMatchObject({ limit: 200, page: 2 });
    expect((await check(AdminStoriesQueryDto, {})).instance.limit).toBe(20);
    expect((await check(AdminStoriesQueryDto, { limit: '201' })).invalid).toEqual(['limit']);
    expect((await check(AdminStoriesQueryDto, { limit: '0' })).invalid).toEqual(['limit']);
    expect((await check(AdminStoriesQueryDto, { limit: '2.5' })).invalid).toEqual(['limit']);
  });

  it('the id list takes the list filters and view list or review', async () => {
    const res = await check(AdminStoryIdsQueryDto, { view: 'review', importBatch: 'a.json', reviewed: 'false', limit: '200' });
    expect(res.invalid).toEqual([]);
    expect(res.instance).toMatchObject({ view: 'review', importBatch: 'a.json', reviewed: false });
    expect((await check(AdminStoryIdsQueryDto, { view: 'list' })).invalid).toEqual([]);
    expect((await check(AdminStoryIdsQueryDto, { view: 'all', extra: 1 })).invalid.sort()).toEqual(['extra', 'view']);
  });

  it('importBatch is a short text; createdFrom / createdTo are calendar days', async () => {
    expect(
      (await check(AdminStoriesQueryDto, { importBatch: 'import-batch1.json', createdFrom: '2026-09-01', createdTo: '2026-09-30' }))
        .invalid,
    ).toEqual([]);
    expect(
      (await check(AdminStoriesQueryDto, { importBatch: 'x'.repeat(121), createdFrom: '2026-13-01', createdTo: '27.09.2026' }))
        .invalid,
    ).toEqual(['importBatch', 'createdFrom', 'createdTo']);
  });
});

describe('bulk story DTOs', () => {
  it('storyIds: 1 to 200 texts', async () => {
    expect((await check(StoryIdsDto, { storyIds: ['a'] })).invalid).toEqual([]);
    expect((await check(StoryIdsDto, { storyIds: [] })).invalid).toEqual(['storyIds']);
    expect((await check(StoryIdsDto, { storyIds: Array.from({ length: 201 }, (_, i) => `s${i}`) })).invalid).toEqual([
      'storyIds',
    ]);
    expect((await check(StoryIdsDto, { storyIds: [5] })).invalid).toEqual(['storyIds']);
    expect((await check(StoryIdsDto, { storyIds: ['a'], extra: 1 })).invalid).toEqual(['extra']);
  });

  it('bulk publish: requireReviewed is optional and boolean', async () => {
    expect((await check(BulkPublishDto, { storyIds: ['a'], requireReviewed: true })).invalid).toEqual([]);
    expect((await check(BulkPublishDto, { storyIds: ['a'], requireReviewed: 'yes' })).invalid).toEqual(['requireReviewed']);
  });

  it('bulk delete needs the confirmed count and the word SİL (dotted or dotless, any case)', async () => {
    for (const word of ['SİL', 'sil', ' Sil ', 'SIL']) {
      expect((await check(BulkDeleteDto, { storyIds: ['a'], expectedCount: 1, confirm: word })).invalid).toEqual([]);
    }
    expect((await check(BulkDeleteDto, { storyIds: ['a'], expectedCount: 1, confirm: 'evet' })).invalid).toEqual(['confirm']);
    expect((await check(BulkDeleteDto, { storyIds: ['a'], confirm: 'SİL' })).invalid).toEqual(['expectedCount']);
    expect((await check(BulkDeleteDto, { storyIds: ['a'], expectedCount: 0, confirm: 'SİL' })).invalid).toEqual([
      'expectedCount',
    ]);
  });

  it('bulk review: 1 to 1000 ids and the reviewed flag', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => `s${i}`);
    expect((await check(BulkReviewDto, { storyIds: many, reviewed: true })).invalid).toEqual([]);
    expect((await check(BulkReviewDto, { storyIds: [...many, 'x'], reviewed: true })).invalid).toEqual(['storyIds']);
    expect((await check(BulkReviewDto, { storyIds: [], reviewed: false })).invalid).toEqual(['storyIds']);
    expect((await check(BulkReviewDto, { storyIds: ['a'] })).invalid).toEqual(['reviewed']);
    expect((await check(BulkReviewDto, { storyIds: ['a'], reviewed: 'yes' })).invalid).toEqual(['reviewed']);
    expect((await check(BulkReviewDto, { storyIds: ['x'.repeat(65)], reviewed: true })).invalid).toEqual(['storyIds']);
  });

  it('review toggle, cover match and cover upload fields', async () => {
    expect((await check(ReviewStoryDto, { reviewed: false })).invalid).toEqual([]);
    expect((await check(ReviewStoryDto, {})).invalid).toEqual(['reviewed']);
    expect((await check(CoverMatchDto, { keys: ['tattercoats'] })).invalid).toEqual([]);
    expect((await check(CoverMatchDto, { keys: [] })).invalid).toEqual(['keys']);
    expect((await check(CoverMatchDto, { keys: ['x'.repeat(201)] })).invalid).toEqual(['keys']);
    const cover = await check(SetCoverDto, { coverCredit: '{"illustrator":"Ada"}', applyCoverToTale: 'false' });
    expect(cover.invalid).toEqual([]);
    expect(cover.instance.applyCoverToTale).toBe(false);
    expect((await check(SetCoverDto, { applyCoverToTale: 'true' })).instance.applyCoverToTale).toBe(true);
    expect((await check(SetCoverDto, { applyCoverToTale: 'maybe', coverCredit: 5 })).invalid).toEqual([
      'coverCredit',
      'applyCoverToTale',
    ]);
  });

  it('the import takes an optional batch label of at most 120 characters', async () => {
    const story = { title: 'T', language: 'tr', text: 'x', category: 'BEDTIME', ageGroup: 'THREE_TO_SIX' };
    expect((await check(ImportStoriesDto, { stories: [story], batch: 'import-batch1.json' })).invalid).toEqual([]);
    expect((await check(ImportStoriesDto, { stories: [story], batch: 'x'.repeat(121) })).invalid).toEqual(['batch']);
    expect((await check(ImportStoriesDto, { stories: [story], batch: 3 })).invalid).toEqual(['batch']);
  });
});
