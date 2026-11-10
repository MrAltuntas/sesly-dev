/* eslint-disable no-console */
/**
 * Live smoke of the story LLM service methods (no server, no database):
 * translates the shortest Turkish story of an import file from Turkish into
 * English and assesses the CEFR level of both texts. Three Gemini calls.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/story-llm-smoke.ts
 *
 * Environment:
 *   GEMINI_API_KEY         required (read from .env when present)
 *   STORY_LLM_ENV_FILE     optional path of another env file that holds the key
 *   STORY_LLM_TARGET       optional target language (default en)
 *   STORY_LLM_IMPORT_FILE  optional import file (default ../stories/batch1/import-batch1.json)
 *   GEMINI_MODEL, GEMINI_TEMPERATURE, GEMINI_THINKING_BUDGET, GEMINI_TIMEOUT_MS
 *                          optional, same fallbacks the settings registry uses
 *
 * The key is never printed.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { LlmPreprocessingService } from '../src/modules/llm-preprocessing/llm-preprocessing.service';
import { getSettingDefinition, validateSettingValue } from '../src/modules/settings/settings.registry';

dotenv.config({ quiet: true } as dotenv.DotenvConfigOptions);
if (process.env.STORY_LLM_ENV_FILE) {
  dotenv.config({ path: process.env.STORY_LLM_ENV_FILE, quiet: true } as dotenv.DotenvConfigOptions);
}

/** Registry value from the environment fallback, else the code default (no database). */
function setting(key: string): unknown {
  const def = getSettingDefinition(key);
  if (!def) throw new Error(`Unknown setting ${key}`);
  const raw = process.env[def.envVar];
  if (raw !== undefined && raw !== '') {
    const checked = validateSettingValue(def, raw);
    if (checked.ok) return checked.value;
  }
  return def.default;
}

interface SampleStory {
  title: string;
  slug: string;
  content: string;
}

/** The shortest Turkish story of an import file (docs/story-pipeline.md section 5). */
function shortestTurkishStory(): SampleStory {
  const file =
    process.env.STORY_LLM_IMPORT_FILE || path.join(__dirname, '..', '..', 'stories', 'batch1', 'import-batch1.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items: Array<{ title: string; language: string; text: string; pairKey?: string }> = Array.isArray(parsed)
    ? parsed
    : parsed.stories;
  const turkish = items.filter((s) => s.language === 'tr' && typeof s.text === 'string');
  if (turkish.length === 0) throw new Error(`${file}: no Turkish story`);
  const pick = turkish.reduce((a, b) => (b.text.length < a.text.length ? b : a));
  return { title: pick.title, slug: pick.pairKey ?? '-', content: pick.text };
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || /TODO/i.test(apiKey)) {
    console.error('GEMINI_API_KEY is not set. Nothing was called.');
    process.exitCode = 2;
    return;
  }

  const config = {
    get: (key: string) =>
      key === 'gemini.apiKey'
        ? apiKey
        : key === 'gemini.apiUrl'
          ? process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com'
          : undefined,
  };
  const service = new LlmPreprocessingService(config as any, { get: setting } as any);

  const target = process.env.STORY_LLM_TARGET || 'en';
  const story = shortestTurkishStory();
  console.log(`Model: ${setting('llm.gemini.model')}`);
  console.log(`Story: "${story.title}" (${story.slug}), ${story.content.length} characters`);

  const translation = await service.translateStory(
    { title: story.title, summary: null, content: story.content, language: 'tr' },
    target,
  );
  console.log(
    `\nTranslation (tr to ${target}) in ${translation.durationMs} ms, ` +
      `paragraphs ${translation.sourceParagraphs} to ${translation.translatedParagraphs}, ` +
      `length ratio ${translation.lengthRatio}`,
  );
  console.log(`Title: ${translation.title}`);
  console.log(`First 300 characters:\n${translation.content.slice(0, 300)}`);

  const sourceLevel = await service.assessLanguageLevel(story.content, 'tr');
  console.log(`\nLevel of the Turkish text: ${sourceLevel.level} (confidence ${sourceLevel.confidence})`);
  console.log(`Note: ${sourceLevel.note}`);

  const targetLevel = await service.assessLanguageLevel(translation.content, target);
  console.log(`\nLevel of the ${target} text: ${targetLevel.level} (confidence ${targetLevel.confidence})`);
  console.log(`Note: ${targetLevel.note}`);
}

main().catch((error) => {
  console.error(`Smoke failed: ${error?.name ?? 'Error'}: ${error?.message ?? error}`);
  process.exitCode = 1;
});
