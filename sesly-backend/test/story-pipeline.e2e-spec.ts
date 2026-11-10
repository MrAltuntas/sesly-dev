import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { AdminStoryImportService } from '../src/modules/admin/services/admin-story-import.service';
import { StorySegmentationService } from '../src/modules/story-segmentation/story-segmentation.service';
import { loadStoryPart } from '../src/modules/stories/story-parts';
import { loadStoryTranslationSource } from '../src/modules/stories/story-translation-source';
import { loadTaleStoryIds } from '../src/modules/stories/story-covers';
import { loadStoryGroupInfo } from '../src/modules/stories/story-groups';
import { createSettingsStub } from '../src/test-utils/settings-stub';

/**
 * Bulk import, lazy segmentation and multi-part links against a real
 * Postgres (migration 20261021120000_story_import_segments_parts applied).
 * Uses E2E_DATABASE_URL, or DATABASE_URL from .env, and refuses anything
 * but a local server. Every row it creates carries a source URL under a
 * per-run prefix and is deleted afterwards.
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

describeDb('story pipeline (Postgres)', () => {
  let prisma: PrismaClient;
  const run = `e2e-${Date.now()}`;
  const source = `https://e2e.sesly.test/${run}/book`;

  const base = (overrides: Record<string, unknown> = {}) => ({
    title: 'Tavşan',
    language: 'tr',
    text: 'Bir varmış bir yokmuş.\n\nKüçük bir tavşan varmış.',
    category: 'BEDTIME',
    ageGroup: 'THREE_TO_SIX',
    sourceUrl: source,
    ...overrides,
  });

  beforeAll(() => {
    prisma = new PrismaClient({ datasourceUrl: url });
  });

  afterAll(async () => {
    await prisma.story.deleteMany({ where: { sourceUrl: { startsWith: `https://e2e.sesly.test/${run}/` } } });
    await prisma.$disconnect();
  });

  it('imports a pair and two parts, links them, and a re-import skips everything', async () => {
    const service = new AdminStoryImportService(prisma as any);
    const stories = [
      base({
        pairKey: `${run}-tavsan`,
        partOf: `${run}-tavsan`,
        partNumber: 1,
        segments: [
          { text: 'Bir varmış bir yokmuş.', emotion: 'peaceful', speed: 0.82, pauseAfterMs: 500 },
          { text: 'Küçük bir tavşan varmış.', emotion: 'calm' },
        ],
      }),
      base({
        title: 'Tavşan 2',
        partOf: `${run}-tavsan`,
        partNumber: 2,
        text: 'Tavşan uyudu.',
        contentWarnings: ['LONELINESS', 'SCARY'],
      }),
      base({
        title: 'The Rabbit',
        language: 'en',
        text: 'Once upon a time there was a little rabbit.',
        pairKey: `${run}-tavsan`,
      }),
    ];

    const dry = await service.importStories({ stories, dryRun: true });
    expect(dry.items.map((i) => i.status)).toEqual(['valid', 'valid', 'valid']);
    expect(await prisma.story.count({ where: { sourceUrl: source } })).toBe(0);

    const first = await service.importStories({ stories });
    expect(first).toMatchObject({ created: 3, skipped: 0, errors: 0 });

    const rows = await prisma.story.findMany({ where: { sourceUrl: source } });
    const byTitle = (t: string) => rows.find((r) => r.title === t)!;
    const [rabbit, tr1, tr2] = [byTitle('The Rabbit'), byTitle('Tavşan'), byTitle('Tavşan 2')];
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'DRAFT')).toBe(true);
    expect(rabbit.translationGroupId).toBe(tr1.translationGroupId);
    expect(tr1.translationGroupId).not.toBeNull();
    expect(tr1).toMatchObject({ segmentationVersion: 1, preprocessedModel: 'import', partNumber: 1 });
    expect(tr2).toMatchObject({ segmentationVersion: 0, preprocessedSegments: null, partNumber: 2 });
    expect(tr2.contentWarnings).toEqual(['SCARY', 'LONELINESS']);
    expect(tr1.contentWarnings).toEqual([]);
    expect(tr2.partGroupId).toBe(tr1.partGroupId);
    expect(await prisma.storyChunk.count({ where: { storyId: tr1.id } })).toBe(1);

    // Parts are linked only once published.
    expect(await loadStoryPart(prisma as any, tr1)).toEqual({ number: 1, total: 1, next: null, previous: null });
    await prisma.story.updateMany({ where: { id: { in: [tr1.id, tr2.id] } }, data: { status: 'PUBLISHED' } });
    expect(await loadStoryPart(prisma as any, tr1)).toEqual({
      number: 1,
      total: 2,
      next: { id: tr2.id, title: 'Tavşan 2', number: 2 },
      previous: null,
    });

    const again = await service.importStories({ stories });
    expect(again).toMatchObject({ created: 0, skipped: 3, errors: 0 });
    expect(await prisma.story.count({ where: { sourceUrl: source } })).toBe(3);
  });

  it('an AI translation imported before or after its source is linked to it; the app sees the published original', async () => {
    const service = new AdminStoryImportService(prisma as any);
    const translated = (pairKey: string, title: string) =>
      base({ title, pairKey, translationMethod: 'MACHINE', translatedFrom: 'en', text: 'Bir tilki varmış.' });
    const original = (pairKey: string, title: string) =>
      base({ title, language: 'en', pairKey, text: 'There was a fox.', textFidelity: 'VERBATIM' });

    // Pair 1: the source first, in the same file. Pair 2: the translation in one request, its source in the next.
    await service.importStories({ stories: [original(`${run}-fox`, 'The Fox'), translated(`${run}-fox`, 'Tilki')] });
    await service.importStories({ stories: [translated(`${run}-crow`, 'Karga')] });
    await service.importStories({ stories: [original(`${run}-crow`, 'The Crow')] });

    const rows = await prisma.story.findMany({ where: { sourceUrl: source, title: { in: ['The Fox', 'Tilki', 'Karga', 'The Crow'] } } });
    const by = (t: string) => rows.find((r) => r.title === t)!;
    expect(by('Tilki')).toMatchObject({ translationMethod: 'MACHINE', textFidelity: 'TRANSLATED', translatedFromId: by('The Fox').id });
    expect(by('Karga')).toMatchObject({ translationMethod: 'MACHINE', translatedFromId: by('The Crow').id });
    expect(by('The Fox')).toMatchObject({ translationMethod: null, translatedFromId: null });

    // The original is offered only once it is published.
    expect(await loadStoryTranslationSource(prisma as any, by('Tilki'))).toEqual({
      isMachineTranslation: true,
      method: 'MACHINE',
      fromLanguage: 'en',
      original: null,
    });
    await prisma.story.update({ where: { id: by('The Fox').id }, data: { status: 'PUBLISHED' } });
    expect((await loadStoryTranslationSource(prisma as any, by('Tilki')))?.original).toEqual({
      id: by('The Fox').id,
      title: 'The Fox',
      language: 'en',
    });
  });

  it('one cover serves the whole tale: the closure reaches every language and part, a coverless story borrows', async () => {
    const service = new AdminStoryImportService(prisma as any);
    const key = `${run}-kar`;
    await service.importStories({
      stories: [
        base({ title: 'Kar 1', pairKey: `${key}-1`, partOf: key, partNumber: 1, text: 'Bir.' }),
        base({ title: 'Kar 2', pairKey: `${key}-2`, partOf: key, partNumber: 2, text: 'İki.' }),
        base({ title: 'Snow 1', language: 'en', pairKey: `${key}-1`, partOf: key, partNumber: 1, text: 'One.' }),
        base({ title: 'Snow 2', language: 'en', pairKey: `${key}-2`, partOf: key, partNumber: 2, text: 'Two.' }),
      ],
    });
    const rows = await prisma.story.findMany({ where: { sourceUrl: source, title: { in: ['Kar 1', 'Kar 2', 'Snow 1', 'Snow 2'] } } });
    const by = (t: string) => rows.find((r) => r.title === t)!;

    // From part 1 in Turkish every other story of the tale is reached.
    const tale = await loadTaleStoryIds(prisma as any, by('Kar 1'));
    expect(tale.sort()).toEqual(rows.map((r) => r.id).sort());

    // Only "Kar 1" has a cover: its English version borrows it through the
    // translation group, "Kar 2" through the part group.
    await prisma.story.update({ where: { id: by('Kar 1').id }, data: { coverImageUrl: 'stories/cover/kar.png' } });
    await prisma.story.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: 'PUBLISHED' } });
    const fresh = await prisma.story.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
    const info = await loadStoryGroupInfo(prisma as any, createSettingsStub({ 'content.enabledLanguages': ['tr', 'en'] }) as any, fresh);
    expect(info.get(by('Snow 1').id)?.sharedCoverImageUrl).toBe('stories/cover/kar.png');
    expect(info.get(by('Kar 2').id)?.sharedCoverImageUrl).toBe('stories/cover/kar.png');
    expect(info.get(by('Kar 1').id)?.sharedCoverImageUrl).toBeUndefined();
  });

  it('two simultaneous first narration requests segment the story once', async () => {
    const story = await prisma.story.create({
      data: {
        title: `Eşzamanlı ${run}`,
        content: 'Bir varmış. Bir yokmuş.',
        ageGroup: 'THREE_TO_SIX',
        category: 'BEDTIME',
        estimatedDuration: 1,
        status: 'PUBLISHED',
        sourceUrl: `https://e2e.sesly.test/${run}/concurrency`,
      },
    });

    const llm = {
      isConfigured: () => true,
      preprocessStory: jest.fn(async () => {
        await new Promise((r) => setTimeout(r, 300));
        return {
          segments: [
            { text: 'Bir varmış. ', emotion: 'peaceful', speed: 0.8 },
            { text: 'Bir yokmuş.', emotion: 'calm', speed: 0.8 },
          ],
          modelUsed: 'stub-model',
          warnings: [],
        };
      }),
    };
    const a = new StorySegmentationService(prisma as any, llm as any);
    const b = new StorySegmentationService(prisma as any, llm as any);
    a.pollMs = 50;
    b.pollMs = 50;

    const [ra, rb] = await Promise.all([a.ensureSegments(story.id), b.ensureSegments(story.id)]);

    expect(llm.preprocessStory).toHaveBeenCalledTimes(1);
    expect(ra).toEqual(rb);
    expect(ra).toMatchObject({ version: 1, source: 'stub-model' });
    const stored = await prisma.story.findUnique({ where: { id: story.id } });
    expect(stored).toMatchObject({ segmentationVersion: 1, preprocessedModel: 'stub-model', segmentationLockedUntil: null });
  });
});
