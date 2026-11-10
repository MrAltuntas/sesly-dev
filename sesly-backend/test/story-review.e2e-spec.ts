import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { AdminStoryImportService } from '../src/modules/admin/services/admin-story-import.service';
import { AdminStoriesService } from '../src/modules/admin/services/admin-stories.service';
import { AdminStoryReviewService } from '../src/modules/admin/services/admin-story-review.service';
import { createSettingsStub } from '../src/test-utils/settings-stub';

/**
 * Review before publishing, bulk publish / archive / delete and the cover
 * matching against a real Postgres (migration
 * 20261022090000_story_review_cover_credit applied). Storage is a stub: no
 * file is uploaded or deleted anywhere. Uses E2E_DATABASE_URL, or
 * DATABASE_URL from .env, and refuses anything but a local server. Every
 * row it creates carries a source URL under a per-run prefix and is
 * deleted afterwards.
 */
function databaseUrl(): string | undefined {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const envFile = path.join(__dirname, '../.env');
  if (!fs.existsSync(envFile)) return undefined;
  return dotenv.parse(fs.readFileSync(envFile)).DATABASE_URL;
}

const url = databaseUrl();
const isLocal = !!url && /@(localhost|127\.0\.0\.1|\[::1\]):\d+\//.test(url);
const describeDb = isLocal ? describe : describe.skip;

describeDb('story review and bulk actions (Postgres)', () => {
  let prisma: PrismaClient;
  let review: AdminStoryReviewService;
  let stories: AdminStoriesService;
  const storage = {
    uploadFile: jest.fn(async (_b: Buffer, key: string) => key),
    deleteFile: jest.fn(async () => undefined),
    generatePresignedUrl: jest.fn(async (key: string) => `signed:${key}`),
    getBucketName: () => 'e2e-bucket',
  };
  const run = `e2e-review-${Date.now()}`;
  const source = `https://e2e.sesly.test/${run}/book`;
  const batch = `${run}.json`;

  const item = (overrides: Record<string, unknown> = {}) => ({
    title: 'Tilki',
    language: 'tr',
    text: 'Bir varmış bir yokmuş.\n\nKüçük bir tilki varmış.',
    category: 'BEDTIME',
    ageGroup: 'THREE_TO_SIX',
    sourceUrl: source,
    origin: 'LICENSED',
    rightsBasis: 'CC_BY',
    author: 'Yazar',
    licence: 'CC BY 4.0',
    attribution: 'Tilki, Yazar, CC BY 4.0',
    pairKey: `${run}-tilki`,
    segments: [
      { text: 'Bir varmış bir yokmuş.', emotion: 'calm' },
      { text: 'Küçük bir tilki varmış.', emotion: 'happy' },
    ],
    ...overrides,
  });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    const translationRequests = {
      summaryForStories: jest.fn(async () => new Map()),
      fulfilForStory: jest.fn(async () => undefined),
    };
    stories = new AdminStoriesService(
      prisma as any,
      storage as any,
      { adminDeleteAudio: jest.fn(async () => ({})) } as any,
      {} as any,
      createSettingsStub() as any,
      {} as any,
      translationRequests as any,
    );
    review = new AdminStoryReviewService(prisma as any, stories, translationRequests as any);
    const result = await new AdminStoryImportService(prisma as any).importStories({
      batch,
      stories: [
        item(),
        // A CC BY text without its attribution: never publishable.
        item({ title: 'The Fox', language: 'en', text: 'Once there was a fox.', attribution: undefined, segments: undefined }),
      ],
    });
    expect(result).toMatchObject({ batch, created: 2, errors: 0 });
  });

  afterAll(async () => {
    await prisma.story.deleteMany({ where: { sourceUrl: { startsWith: `https://e2e.sesly.test/${run}/` } } });
    await prisma.$disconnect();
  });

  const ids = async () => {
    const rows = await prisma.story.findMany({ where: { sourceUrl: source }, select: { id: true, language: true } });
    return { tr: rows.find((r) => r.language === 'tr')!.id, en: rows.find((r) => r.language === 'en')!.id };
  };

  it('the batch is listed and its drafts come back as review cards', async () => {
    const { batches } = await review.listImportBatches();
    expect(batches.find((b) => b.batch === batch)).toMatchObject({ total: 2, drafts: 2, reviewed: 0, published: 0 });

    const res = await review.reviewList({ importBatch: batch } as any);
    expect(res.total).toBe(2);
    const [tr, en] = res.data;
    expect(tr).toMatchObject({
      title: 'Tilki',
      language: 'tr',
      licenseName: 'CC BY 4.0',
      attribution: 'Tilki, Yazar, CC BY 4.0',
      segments: { count: 2, source: 'import', version: 1 },
      translations: [{ language: 'en', title: 'The Fox' }],
      reviewed: false,
      publishable: true,
    });
    expect(tr.segments.emotions.map((e: any) => e.emotion).sort()).toEqual(['calm', 'happy']);
    expect(en).toMatchObject({ publishable: false });
    expect(en.publishMissing.map((m: any) => m.field)).toEqual(['ccAttribution']);
  });

  it('pages of 200, the id list of both views and the story list without texts', async () => {
    const { tr, en } = await ids();
    const page = await review.reviewList({ importBatch: batch, limit: 200 } as any);
    expect(page).toMatchObject({ total: 2, limit: 200, totalPages: 1 });

    const reviewIds = await review.listIds({ view: 'review', importBatch: batch } as any);
    expect(reviewIds).toMatchObject({ total: 2, limit: 1000, truncated: false });
    expect(reviewIds.items).toEqual([
      { id: tr, title: 'Tilki', language: 'tr', status: 'DRAFT', reviewed: false, publishable: true },
      { id: en, title: 'The Fox', language: 'en', status: 'DRAFT', reviewed: false, publishable: false },
    ]);
    // The list view has no review defaults: a published filter finds nothing yet.
    expect((await review.listIds({ importBatch: batch, status: 'PUBLISHED' } as any)).total).toBe(0);
    expect((await review.listIds({ importBatch: batch } as any)).items.map((i) => i.id).sort()).toEqual([tr, en].sort());

    const list = await stories.getAllStories({ importBatch: batch, limit: 200 } as any);
    expect(list.total).toBe(2);
    expect(list.data[0]).not.toHaveProperty('content');
    expect(list.data[0]).not.toHaveProperty('preprocessedSegments');
    expect(list.data[0]).toHaveProperty('title');
  });

  it('bulk review marks and unmarks many stories, keeping who marked first', async () => {
    const { tr, en } = await ids();
    let res = await review.bulkSetReviewed([tr], true, 'first@sesly.test');
    expect(res).toEqual({ reviewed: true, requested: 1, changed: 1, unchanged: 0, missing: [] });
    const missingId = '00000000-0000-4000-8000-000000000000';
    res = await review.bulkSetReviewed([tr, en, missingId], true, 'second@sesly.test');
    expect(res).toEqual({ reviewed: true, requested: 3, changed: 1, unchanged: 1, missing: [missingId] });
    let rows = await prisma.story.findMany({ where: { id: { in: [tr, en] } }, select: { id: true, reviewedBy: true, reviewedAt: true } });
    expect(rows.find((r) => r.id === tr)!.reviewedBy).toBe('first@sesly.test');
    expect(rows.find((r) => r.id === en)!.reviewedBy).toBe('second@sesly.test');
    expect((await review.listIds({ view: 'review', importBatch: batch, reviewed: true } as any)).total).toBe(2);

    res = await review.bulkSetReviewed([tr, en], false, 'second@sesly.test');
    expect(res).toMatchObject({ reviewed: false, changed: 2, unchanged: 0 });
    rows = await prisma.story.findMany({ where: { id: { in: [tr, en] } }, select: { id: true, reviewedBy: true, reviewedAt: true } });
    expect(rows.every((r) => r.reviewedAt === null && r.reviewedBy === null)).toBe(true);
  });

  it('bulk publish needs the review mark and refuses CC BY without its attribution', async () => {
    const { tr, en } = await ids();
    let res = await review.bulkPublish([tr, en], { requireReviewed: true });
    expect(res.published).toEqual([]);
    expect(res.skipped.map((s) => s.reason)).toEqual(['İncelendi olarak işaretlenmedi.', 'İncelendi olarak işaretlenmedi.']);

    await review.setReviewed(tr, true, 'e2e@sesly.test');
    await review.setReviewed(en, true, 'e2e@sesly.test');
    res = await review.bulkPublish([tr, en], { requireReviewed: true });
    expect(res.published.map((p) => p.id)).toEqual([tr]);
    expect(res.skipped[0]).toMatchObject({ storyId: en, missing: ['ccAttribution'] });

    const rows = await prisma.story.findMany({ where: { id: { in: [tr, en] } }, select: { id: true, status: true, publishedAt: true, reviewedBy: true } });
    expect(rows.find((r) => r.id === tr)).toMatchObject({ status: 'PUBLISHED', reviewedBy: 'e2e@sesly.test' });
    expect(rows.find((r) => r.id === tr)!.publishedAt).toBeInstanceOf(Date);
    expect(rows.find((r) => r.id === en)!.status).toBe('DRAFT');

    // The single PATCH path refuses it too.
    await expect(stories.updateStory(en, { status: 'PUBLISHED' } as any, undefined as any)).rejects.toMatchObject({
      response: { code: 'STORY_PUBLISH_REQUIREMENTS', missing: ['ccAttribution'] },
    });
  });

  it('a file named after the pairKey finds the tale; a cover upload with its credit reaches both languages', async () => {
    const { tr, en } = await ids();
    const { results } = await review.matchCovers([`${run}-tilki.jpg`, `${run}-yok.png`]);
    expect(results[0]).toMatchObject({ status: 'matched', via: 'pairKey', tale: { storyId: tr, languages: ['tr', 'en'] } });
    expect(results[1].status).toBe('none');

    const res = await stories.setCover(
      tr,
      { buffer: Buffer.from('img'), mimetype: 'image/jpeg', originalname: 'tilki.jpg' } as any,
      { coverCredit: JSON.stringify({ illustrator: 'Ada', licence: 'CC BY 4.0', width: 10 }) },
    );
    expect(res.appliedTo).toBe(2);
    const rows = await prisma.story.findMany({ where: { id: { in: [tr, en] } }, select: { coverImageUrl: true, coverCredit: true } });
    expect(new Set(rows.map((r) => r.coverImageUrl)).size).toBe(1);
    expect(rows.every((r) => JSON.stringify(r.coverCredit) === JSON.stringify({ illustrator: 'Ada', licenseName: 'CC BY 4.0' }))).toBe(
      true,
    );
  });

  it('bulk archive, then a bulk delete that goes through the single delete path', async () => {
    const { tr, en } = await ids();
    expect((await review.bulkArchive([tr])).archived.map((s) => s.id)).toEqual([tr]);
    const preview = await review.deletePreview([tr, en]);
    expect(preview).toMatchObject({ stories: 2, narrations: 0, coverFiles: 1 });
    await expect(review.bulkDelete([tr, en], 3)).rejects.toMatchObject({ response: { code: 'BULK_DELETE_COUNT_MISMATCH' } });
    const res = await review.bulkDelete([tr, en], 2);
    expect(res).toMatchObject({ deleted: 2, failed: [] });
    expect(await prisma.story.count({ where: { sourceUrl: source } })).toBe(0);
    // The shared cover went once its last story did (stub storage, nothing real).
    expect(storage.deleteFile).toHaveBeenCalledTimes(1);
  });
});
