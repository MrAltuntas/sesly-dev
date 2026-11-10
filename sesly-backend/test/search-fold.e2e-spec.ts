import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import { narrationSearchIdsQuery, storySearchIdsQuery } from '../src/common/utils/search-fold';

/**
 * Turkish-aware search against a real Postgres (V5-01 / VR-02): the migration
 * 20261020120000_story_search_fold must be applied. Uses E2E_DATABASE_URL, or
 * DATABASE_URL from .env. Refuses anything but a local server, and every
 * fixture lives inside a transaction that is rolled back, so nothing is left
 * behind.
 */
function databaseUrl(): string | undefined {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const envFile = path.join(__dirname, '../.env');
  if (!fs.existsSync(envFile)) return undefined;
  return dotenv.parse(fs.readFileSync(envFile)).DATABASE_URL;
}

const url = databaseUrl();
const isLocal = !!url && /@(localhost|127\.0\.0\.1|\[::1\]):\d+\//.test(url);

class Rollback extends Error {}

const describeDb = isLocal ? describe : describe.skip;

describeDb('Turkish-aware search (Postgres)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({ datasourceUrl: url });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Runs `body` with fixtures in a transaction that is always rolled back. */
  async function withFixtures(body: (tx: Prisma.TransactionClient) => Promise<void>) {
    await expect(
      prisma.$transaction(
        async (tx) => {
          await body(tx);
          throw new Rollback();
        },
        { timeout: 20000 },
      ),
    ).rejects.toBeInstanceOf(Rollback);
  }

  const story = (tx: Prisma.TransactionClient, title: string, extra: Partial<Prisma.StoryCreateInput> = {}) =>
    tx.story.create({
      data: {
        title,
        content: 'Bir varmış bir yokmuş, gökyüzünde uyuyamayan bir yıldız varmış.',
        ageGroup: 'THREE_TO_SIX',
        category: 'EDUCATIONAL',
        estimatedDuration: 3,
        status: 'PUBLISHED',
        ...extra,
      },
    });

  const ids = async (tx: Prisma.TransactionClient, query: Prisma.Sql) =>
    (await tx.$queryRaw<{ id: string }[]>(query)).map((r) => r.id);

  it('sesly_search_fold folds Turkish letters, accents and case to one form', async () => {
    const rows = await prisma.$queryRaw<{ folded: string }[]>`
      SELECT sesly_search_fold(t) AS folded
      FROM unnest(ARRAY['Uyuyamayan Küçük Yıldız', 'YILDIZ', 'İSTANBUL ŞEHRİ', 'ğüşıöç ĞÜŞIÖÇ', 'Kâğıt Façade']) WITH ORDINALITY AS v(t, i)
      ORDER BY i`;
    expect(rows.map((r) => r.folded)).toEqual([
      'uyuyamayan kucuk yildiz',
      'yildiz',
      'istanbul sehri',
      'gusioc gusioc',
      'kagit facade',
    ]);
  });

  it('story search: yildiz, YILDIZ, yıldız and kucuk all find "Uyuyamayan Küçük Yıldız"', async () => {
    await withFixtures(async (tx) => {
      const target = await story(tx, 'Uyuyamayan Küçük Yıldız');

      for (const term of ['yildiz', 'YILDIZ', 'yıldız', 'Yıldız', 'kucuk', 'KÜÇÜK', 'kucuk yildiz', 'UYUYAMAYAN']) {
        expect({ term, found: (await ids(tx, storySearchIdsQuery(term))).includes(target.id) }).toEqual({
          term,
          found: true,
        });
      }
      expect(await ids(tx, storySearchIdsQuery('yildizlar ve gunes zzqx'))).not.toContain(target.id);
    });
  });

  it('story search also matches the content, skips drafts and follows a title edit', async () => {
    await withFixtures(async (tx) => {
      const published = await story(tx, 'Ay Dede', { content: 'Çoban köpeği Şirin gece nöbet tutarmış.' });
      const draft = await story(tx, 'Taslak Çoban Şirin', { status: 'DRAFT' });

      expect(await ids(tx, storySearchIdsQuery('coban kopegi sirin'))).toContain(published.id);
      expect(await ids(tx, storySearchIdsQuery('taslak coban'))).not.toContain(draft.id);

      // searchText is a generated column: an edit is searchable at once.
      await tx.story.update({ where: { id: published.id }, data: { title: 'Gökkuşağı Ülkesi zqv' } });
      expect(await ids(tx, storySearchIdsQuery('GOKKUSAGI ULKESI ZQV'))).toEqual([published.id]);
    });
  });

  it('LIKE wildcards in the term are literal', async () => {
    await withFixtures(async (tx) => {
      const plain = await story(tx, '100 masal zqw');
      const percent = await story(tx, '100% masal zqw');

      const found = await ids(tx, storySearchIdsQuery('100% masal zqw'));
      expect(found).toContain(percent.id);
      expect(found).not.toContain(plain.id);
      expect(await ids(tx, storySearchIdsQuery('1_0 masal zqw'))).toEqual([]);
    });
  });

  it("narration search: the user's narrations by folded narration or story title, never another user's", async () => {
    await withFixtures(async (tx) => {
      const suffix = Date.now().toString(36);
      const me = await tx.user.create({ data: { email: `search-me-${suffix}@example.test` } });
      const other = await tx.user.create({ data: { email: `search-other-${suffix}@example.test` } });
      const myVoice = await tx.voiceProfile.create({
        data: { userId: me.id, name: 'Anne', voiceId: 'tr-TR-Chirp3-HD-Achernar' },
      });
      const otherVoice = await tx.voiceProfile.create({
        data: { userId: other.id, name: 'Baba', voiceId: 'tr-TR-Chirp3-HD-Achernar' },
      });
      const star = await story(tx, 'Uyuyamayan Küçük Yıldız');
      const fox = await story(tx, 'Kurnaz Tilki');

      const byStoryTitle = await tx.storyNarration.create({
        data: { userId: me.id, storyId: star.id, voiceProfileId: myVoice.id, title: null },
      });
      const byOwnTitle = await tx.storyNarration.create({
        data: { userId: me.id, storyId: fox.id, voiceProfileId: myVoice.id, title: 'Işıl ışıl gece' },
      });
      await tx.storyNarration.create({
        data: { userId: other.id, storyId: star.id, voiceProfileId: otherVoice.id },
      });

      for (const term of ['yildiz', 'YILDIZ', 'yıldız', 'kucuk']) {
        expect({ term, ids: await ids(tx, narrationSearchIdsQuery(me.id, term)) }).toEqual({
          term,
          ids: [byStoryTitle.id],
        });
      }
      expect(await ids(tx, narrationSearchIdsQuery(me.id, 'ISIL ISIL'))).toEqual([byOwnTitle.id]);
      expect(await ids(tx, narrationSearchIdsQuery(me.id, 'aslan'))).toEqual([]);
    });
  });
});
