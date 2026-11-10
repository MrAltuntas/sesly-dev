import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Migration 20261022120000_story_content_warning_enum against a real
 * Postgres, on a table WITH data (production may hold imported stories with
 * the old Turkish keys). The migration SQL runs unchanged inside a scratch
 * schema (search_path) of a transaction that is always rolled back, so the
 * real "stories" table is never touched. Uses E2E_DATABASE_URL, or
 * DATABASE_URL from .env, and refuses anything but a local server.
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

const MIGRATION = path.join(
  __dirname,
  '../prisma/migrations/20261022120000_story_content_warning_enum/migration.sql',
);

/** Splits the migration into statements; a `$$ ... $$` body stays whole. */
function statements(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let inBody = false;
  for (const line of sql.replace(/\r\n/g, '\n').split('\n')) {
    if (!inBody && /^\s*--/.test(line)) continue;
    current += `${line}\n`;
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inBody = !inBody;
    if (!inBody && /;\s*$/.test(line)) {
      out.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

class Rollback extends Error {}

describeDb('content warning enum migration (Postgres)', () => {
  let prisma: PrismaClient;
  const sql = statements(fs.readFileSync(MIGRATION, 'utf8'));

  beforeAll(() => {
    prisma = new PrismaClient({ datasourceUrl: url });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** A scratch "stories" table with the old TEXT[] column, then the migration. */
  async function migrate(tx: Prisma.TransactionClient, rows: Array<[number, string[] | null]>) {
    await tx.$executeRawUnsafe('CREATE SCHEMA cw_migration_test');
    await tx.$executeRawUnsafe('SET LOCAL search_path TO cw_migration_test');
    await tx.$executeRawUnsafe(
      'CREATE TABLE "stories" ("id" INT PRIMARY KEY, "contentWarnings" TEXT[] DEFAULT ARRAY[]::TEXT[])',
    );
    for (const [id, values] of rows) {
      await tx.$executeRawUnsafe('INSERT INTO "stories" ("id", "contentWarnings") VALUES ($1, $2)', id, values);
    }
    for (const statement of sql) await tx.$executeRawUnsafe(statement);
  }

  it('has the expected statements', () => {
    expect(sql[0]).toMatch(/^CREATE TYPE "ContentWarning"/);
    expect(sql.some((s) => s.startsWith('DO $$') && s.includes('RAISE EXCEPTION'))).toBe(true);
    expect(sql[sql.length - 1]).toMatch(/SET DEFAULT ARRAY\[\]::"ContentWarning"\[\];$/);
  });

  it('converts every stored value with the mapping, keeps empty rows empty', async () => {
    let result: Array<{ id: number; warnings: string[] }> = [];
    let columnType = '';
    await expect(
      prisma.$transaction(
        async (tx) => {
          await migrate(tx, [
            [1, ['yalniz-ayrilik', 'olum', 'korkutucu', 'olum']],
            [2, ['siddet', 'uzucu-son', 'kotu-ornek', 'eski-dil']],
            [3, []],
            [4, null],
            [5, ['SCARY', 'korkutucu', 'LONELINESS']],
          ]);
          result = await tx.$queryRawUnsafe(
            'SELECT "id", "contentWarnings"::TEXT[] AS "warnings" FROM "stories" ORDER BY "id"',
          );
          const [column] = await tx.$queryRawUnsafe<Array<{ udt: string; def: string }>>(
            `SELECT udt_name AS "udt", column_default AS "def" FROM information_schema.columns
             WHERE table_schema = 'cw_migration_test' AND table_name = 'stories' AND column_name = 'contentWarnings'`,
          );
          columnType = `${column.udt} ${column.def}`;
          throw new Rollback();
        },
        { timeout: 20000 },
      ),
    ).rejects.toBeInstanceOf(Rollback);

    expect(result).toEqual([
      { id: 1, warnings: ['SCARY', 'DEATH', 'LONELINESS'] },
      { id: 2, warnings: ['VIOLENCE', 'SAD_ENDING', 'BAD_EXAMPLE', 'OLD_LANGUAGE'] },
      { id: 3, warnings: [] },
      { id: 4, warnings: [] },
      { id: 5, warnings: ['SCARY', 'LONELINESS'] },
    ]);
    expect(columnType).toBe('_ContentWarning ARRAY[]::"ContentWarning"[]');
  });

  it('stops with an error naming a value outside the mapping', async () => {
    await expect(
      prisma.$transaction(
        async (tx) => {
          await migrate(tx, [
            [1, ['korkutucu']],
            [2, ['zombi', 'olum']],
          ]);
          throw new Rollback();
        },
        { timeout: 20000 },
      ),
    ).rejects.toThrow(/outside the content warning mapping: 'zombi'/);
  });
});
