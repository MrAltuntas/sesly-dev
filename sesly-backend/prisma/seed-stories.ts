/* eslint-disable no-console */
/**
 * Seeds a DEVELOPMENT database with stories from an import file, through
 * the same import service the admin panel uses ("Toplu aktarım"):
 * every story becomes a DRAFT, no LLM and no TTS call, and a second run
 * skips what is already there. The file format is docs/story-pipeline.md
 * section 5 (the batch files under stories/batch1 are ready to use).
 *
 *   npm run seed:stories -- --file ../stories/batch1/import-batch1.json
 *   npm run seed:stories -- --file <file> --dry-run      # check only, write nothing
 *   npm run seed:stories -- --file <file> --publish      # also publish what passes the publish rule
 *   npm run seed:stories -- --file <file> --batch <label> # import label (default: the file name)
 *
 * Covers are not part of the file: upload them in the panel (Hikayeler,
 * "Toplu kapak yükle"). The old AI-written seed batches (prisma/seed-data)
 * were removed: a fresh database no longer gets those stories.
 *
 * A database that is not on this machine is refused unless --allow-remote
 * is given. Needs DATABASE_URL (.env) and the database up
 * (docker-compose up -d).
 */
import 'reflect-metadata';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { AdminStoryImportService } from '../src/modules/admin/services/admin-story-import.service';
import {
  SeedArgsError,
  isLocalDatabaseUrl,
  parseSeedArgs,
  readImportFile,
  runImportFileSeed,
} from '../src/modules/admin/services/story-import-seed';

dotenv.config({ quiet: true } as dotenv.DotenvConfigOptions);

async function main() {
  const args = parseSeedArgs(process.argv.slice(2));
  if (!isLocalDatabaseUrl(process.env.DATABASE_URL) && !args.allowRemote) {
    throw new SeedArgsError(
      'DATABASE_URL bu makinedeki bir veritabanı değil. Geliştirme veritabanı için localhost kullanın ya da bilerek --allow-remote verin.',
    );
  }
  const file = path.resolve(process.cwd(), args.file);
  const stories = readImportFile(file);
  const batch = args.batch ?? path.basename(file);
  console.log(`[seed:stories] ${stories.length} masal, etiket "${batch}"${args.dryRun ? ', yalnızca kontrol' : ''}`);

  const prisma = new PrismaClient();
  try {
    const importer = new AdminStoryImportService(prisma as any);
    const summary = await runImportFileSeed(prisma, importer, stories, {
      dryRun: args.dryRun,
      publish: args.publish,
      batch,
    });
    for (const item of summary.errorItems) {
      console.log(`  HATA #${item.index + 1} ${item.title ?? '(başlıksız)'}: ${item.message ?? ''}`);
      for (const problem of item.problems ?? []) console.log(`    - ${problem}`);
    }
    for (const item of summary.notPublished) {
      console.log(`  TASLAK KALDI ${item.title}: ${item.missing.join(', ')}`);
    }
    console.log(
      `[seed:stories] ${summary.total} masal: ${args.dryRun ? `${summary.valid} eklenebilir` : `${summary.created} eklendi`}, ` +
        `${summary.skipped} zaten vardı, ${summary.errors} hatalı` +
        (args.publish ? `, ${summary.published} yayınlandı` : ''),
    );
    if (summary.errors > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[seed:stories] BAŞARISIZ:', e?.message ?? e);
  process.exitCode = 1;
});
