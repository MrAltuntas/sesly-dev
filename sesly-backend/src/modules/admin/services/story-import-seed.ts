import * as fs from 'fs';
import * as path from 'path';
import { StoryStatus } from '../../../common/enums/prisma.enums';
import { missingPublishFields } from '../../stories/story-publish.rules';
import { IMPORT_MAX_STORIES } from '../dto/import-stories.dto';
import type { ImportResult } from './admin-story-import.service';

/**
 * Development seed of the story catalogue from an import file
 * (`npm run seed:stories -- --file <path>`, prisma/seed-stories.ts).
 *
 * It goes through AdminStoryImportService, the same code as the panel's
 * "Toplu aktarım", so a seeded database holds exactly what an import would
 * write: DRAFT stories, no LLM and no TTS call, idempotent (a second run
 * skips what is there). `--publish` then publishes the created stories that
 * pass the publish rule (CC BY needs attribution and licence name), which a
 * development database needs to show anything in the app; production goes
 * through the review view instead.
 */
export interface SeedArgs {
  file: string;
  dryRun: boolean;
  publish: boolean;
  batch: string | null;
  allowRemote: boolean;
}

export const SEED_USAGE =
  'Kullanım: npm run seed:stories -- --file <aktarım.json> [--dry-run] [--publish] [--batch <etiket>] [--allow-remote]';

export class SeedArgsError extends Error {}

/** Arguments after `--`. Unknown ones stop the script (a typo must not seed). */
export function parseSeedArgs(argv: string[]): SeedArgs {
  const args: SeedArgs = { file: '', dryRun: false, publish: false, batch: null, allowRemote: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new SeedArgsError(`${arg} bir değer bekliyor. ${SEED_USAGE}`);
      i += 1;
      return next;
    };
    if (arg === '--file') args.file = value();
    else if (arg.startsWith('--file=')) args.file = arg.slice('--file='.length);
    else if (arg === '--batch') args.batch = value();
    else if (arg.startsWith('--batch=')) args.batch = arg.slice('--batch='.length);
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--publish') args.publish = true;
    else if (arg === '--allow-remote') args.allowRemote = true;
    else throw new SeedArgsError(`Bilinmeyen argüman: ${arg}. ${SEED_USAGE}`);
  }
  if (!args.file) throw new SeedArgsError(`--file zorunlu. ${SEED_USAGE}`);
  return args;
}

/** True for a database on this machine (the docker-compose one is localhost:5439). */
export function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return ['localhost', '127.0.0.1', '::1'].includes(host) || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/** Stories of an import file: an array, or `{ "stories": [...] }` (the panel's format). */
export function readImportFile(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) throw new SeedArgsError(`Dosya bulunamadı: ${file}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new SeedArgsError(`${path.basename(file)}: geçerli bir JSON değil (${(e as Error).message})`);
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { stories?: unknown }).stories)
      ? (parsed as { stories: unknown[] }).stories
      : null;
  if (!list) throw new SeedArgsError(`${path.basename(file)}: bir masal dizisi ya da { "stories": [...] } olmalı.`);
  if (list.length === 0) throw new SeedArgsError(`${path.basename(file)}: dosyada masal yok.`);
  return list as Record<string, unknown>[];
}

interface ImportRunner {
  importStories(dto: { stories: Record<string, unknown>[]; dryRun?: boolean; batch?: string }, adminLabel?: string | null): Promise<ImportResult>;
}

interface StoryWriter {
  story: {
    findMany(args: any): Promise<any[]>;
    updateMany(args: any): Promise<{ count: number }>;
  };
}

export interface SeedSummary {
  total: number;
  created: number;
  valid: number;
  skipped: number;
  errors: number;
  published: number;
  /** Created stories `--publish` left as drafts, with the reason. */
  notPublished: Array<{ storyId: string; title: string; missing: string[] }>;
  errorItems: Array<{ index: number; title: string | null; message?: string; problems?: string[] }>;
}

/** Imports the stories in requests of at most IMPORT_MAX_STORIES, then publishes when asked. */
export async function runImportFileSeed(
  prisma: StoryWriter,
  importer: ImportRunner,
  stories: Record<string, unknown>[],
  options: { dryRun: boolean; publish: boolean; batch: string },
): Promise<SeedSummary> {
  const summary: SeedSummary = {
    total: 0,
    created: 0,
    valid: 0,
    skipped: 0,
    errors: 0,
    published: 0,
    notPublished: [],
    errorItems: [],
  };
  const createdIds: string[] = [];
  for (let start = 0; start < stories.length; start += IMPORT_MAX_STORIES) {
    const result = await importer.importStories(
      { stories: stories.slice(start, start + IMPORT_MAX_STORIES), dryRun: options.dryRun, batch: options.batch },
      'seed:stories',
    );
    summary.total += result.total;
    summary.created += result.created;
    summary.skipped += result.skipped;
    summary.errors += result.errors;
    for (const item of result.items) {
      if (item.status === 'valid') summary.valid += 1;
      if (item.status === 'created' && item.storyId) createdIds.push(item.storyId);
      if (item.status === 'error') {
        summary.errorItems.push({ index: item.index + start, title: item.title, message: item.message, problems: item.problems });
      }
    }
  }

  if (options.publish && !options.dryRun && createdIds.length > 0) {
    const rows = await prisma.story.findMany({
      where: { id: { in: createdIds } },
      select: {
        id: true,
        title: true,
        origin: true,
        textFidelity: true,
        rightsBasis: true,
        sourceUrl: true,
        sourceName: true,
        authorName: true,
        collectorName: true,
        attribution: true,
        licenseName: true,
      },
    });
    const publishable: string[] = [];
    for (const row of rows) {
      const missing = missingPublishFields(row);
      if (missing.length === 0) publishable.push(row.id);
      else summary.notPublished.push({ storyId: row.id, title: row.title, missing: missing.map((m) => m.label) });
    }
    if (publishable.length > 0) {
      const res = await prisma.story.updateMany({
        where: { id: { in: publishable }, status: StoryStatus.DRAFT },
        data: { status: StoryStatus.PUBLISHED, publishedAt: new Date() },
      });
      summary.published = res.count;
    }
  }
  return summary;
}
