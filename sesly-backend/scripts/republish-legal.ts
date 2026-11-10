/* eslint-disable no-console */
/**
 * Republish the Turkish legal documents from the content files.
 *
 * The `LegalDocumentsSeeder` only inserts a document that does not exist, so
 * once v1 is in the database an edit to `content/<slug>.tr.md` is NOT picked
 * up. This script closes that gap. For each canonical slug (tos, privacy,
 * data-deletion) it compares the published Turkish version with
 * `src/modules/legal-documents/content/<slug>.tr.md`, the same file the
 * seeder reads (one source, never edit the prose here). When they differ it
 * publishes the file as a new version (currentVersion + 1, a new immutable
 * version row), like a publish from the admin legal editor; a missing
 * document is created and published as v1. The logic lives in
 * `src/modules/legal-documents/legal-republish.ts`.
 *
 * Turkish only. English is reviewed and published from the admin panel.
 *
 * Caution: a Turkish text edited and published in the admin panel is
 * replaced by the file when they differ. Copy panel edits into the content
 * file first, or do not run this script. Run with --dry-run first: it reads
 * and reports, and writes nothing.
 *
 * Idempotent: a second run with no file changes is a no-op.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/republish-legal.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register scripts/republish-legal.ts
 */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import {
  LegalRepublishResult,
  REPUBLISH_LANGUAGE,
  republishTurkishLegalDocuments,
} from '../src/modules/legal-documents/legal-republish';

const USAGE = 'Usage: republish-legal.ts [--dry-run]';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
};

/** Unknown arguments stop the script: a mistyped --dry-run must never write. */
function parseArgs(argv: string[]): { dryRun: boolean } {
  const unknown = argv.filter((arg) => arg !== '--dry-run');
  if (unknown.length) {
    console.error(`Unknown argument(s): ${unknown.join(' ')}\n${USAGE}`);
    process.exit(1);
  }
  return { dryRun: argv.includes('--dry-run') };
}

function describeResult(result: LegalRepublishResult, dryRun: boolean): string {
  const slug = result.slug.padEnd(15);
  const would = dryRun ? 'would be ' : '';
  switch (result.action) {
    case 'created':
      return `${colors.green}created${colors.reset}   ${slug} v1 (was missing, ${would}published)`;
    case 'bumped': {
      const draft = result.replacesDraft ? ', replaces an unpublished draft' : '';
      return `${colors.yellow}bumped${colors.reset}    ${slug} v${result.fromVersion} to v${result.toVersion} (${would}published${draft})`;
    }
    default:
      return `${colors.dim}unchanged${colors.reset} ${slug} v${result.toVersion}`;
  }
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const now = new Date();
  const mode = dryRun ? 'DRY RUN, nothing is written' : 'writing';

  console.log(`\nRepublish legal documents (${REPUBLISH_LANGUAGE}), ${now.toISOString()}, ${mode}\n`);

  try {
    const results = await republishTurkishLegalDocuments(prisma, { dryRun, now });
    for (const result of results) {
      console.log(describeResult(result, dryRun));
    }
    const count = (action: LegalRepublishResult['action']) =>
      results.filter((r) => r.action === action).length;
    console.log(
      `\n${dryRun ? 'Dry run' : 'Done'}: ${count('bumped')} bumped, ${count('created')} created, ${count('unchanged')} unchanged.\n`,
    );
    if (results[0]) {
      console.log(`${colors.dim}Source: ${results[0].path.replace(/[^/\\]+$/, '')}${colors.reset}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`${colors.red}republish-legal failed:${colors.reset}`, err);
  process.exit(1);
});
