/**
 * Checks run on LLM output before it is saved: typography normalisation
 * (workspace content rules: no em dash, no emoji, no unicode ellipsis) and
 * the guards that decide whether a machine translation is safe to store.
 * Pure functions, no I/O.
 */

/**
 * The model answered, but the answer cannot be used (malformed, or a
 * translation that failed a guard). The message is Turkish and is shown to
 * the admin as the reason the task failed. Retrying the provider call does
 * not help by itself, so the queue treats it as permanent.
 */
export class LlmOutputRejectedError extends Error {
  constructor(
    public readonly reason: 'INVALID_ANSWER' | 'TRANSLATION_GUARD',
    message: string,
  ) {
    super(message);
    this.name = 'LlmOutputRejectedError';
  }
}

// =============================================================================
// PARAGRAPHS
// =============================================================================

export interface ParagraphSplit {
  paragraphs: string[];
  /** What the paragraphs were separated by, used to put a translation back together. */
  separator: '\n\n' | '\n';
}

/**
 * Paragraphs of a story text. A text that uses blank lines is split on them;
 * a text that only has single line breaks is split on those.
 */
export function splitParagraphs(text: string): ParagraphSplit {
  const normalised = (text ?? '').replace(/\r\n?/g, '\n').trim();
  const blankLines = /\n[ \t]*\n/.test(normalised);
  const separator: ParagraphSplit['separator'] = blankLines ? '\n\n' : '\n';
  const paragraphs = normalised
    .split(blankLines ? /\n(?:[ \t]*\n)+/ : /\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return { paragraphs, separator };
}

// =============================================================================
// TYPOGRAPHY
// =============================================================================

/** Em dash and horizontal bar (both used as a dialogue or parenthetical dash). */
const LONG_DASH = '[\\u2014\\u2015]';
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/gu;
/** Variation selector 16, zero width joiner and the keycap mark, left over once an emoji is removed. */
const EMOJI_GLUE = /[\uFE0F\u200D\u20E3]/g;

/**
 * Applies the workspace content rules to model output:
 * - an em dash that opens a line of dialogue becomes "- ", any other em dash " - "
 * - the unicode ellipsis becomes three full stops
 * - emoji are removed
 * Line breaks are kept; runs of spaces left behind are collapsed.
 */
export function normaliseTypography(text: string): string {
  return (text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u2026/g, '...')
    .replace(new RegExp(`^[ \\t]*${LONG_DASH}[ \\t]*`, 'gm'), '- ')
    .replace(new RegExp(`[ \\t]*${LONG_DASH}[ \\t]*`, 'g'), ' - ')
    .replace(EMOJI, '')
    .replace(EMOJI_GLUE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/^[ \t]+/gm, '')
    .trim();
}

// =============================================================================
// TRANSLATION GUARDS
// =============================================================================

/** Paragraphs a translation may differ from its source by: none below 10, then one per 10. */
export function allowedParagraphDrift(sourceParagraphs: number): number {
  return Math.floor(sourceParagraphs / 10);
}

/** Bounds of translated length / source length (characters without whitespace). */
export const TRANSLATION_RATIO_MIN = 0.4;
export const TRANSLATION_RATIO_MAX = 2.5;
/** Looser bounds for a very short text, where a few words move the ratio a lot. */
export const TRANSLATION_SHORT_TEXT_CHARS = 200;
export const TRANSLATION_SHORT_RATIO_MIN = 0.25;
export const TRANSLATION_SHORT_RATIO_MAX = 4;
/** Share of paragraphs that may come back word for word (names, sound words, one-word lines). */
export const TRANSLATION_MAX_UNTRANSLATED_SHARE = 0.3;
/** Shorter paragraphs are not counted as "left untranslated" (a name, "Tik tak."). */
const UNTRANSLATED_MIN_CHARS = 25;

const TRANSLATOR_NOTE =
  /(translator'?s?\s+note|\bT\.?\s?N\.?\s*:|çevirmen(in)?\s+notu|ç\.\s?n\.|note\s+du\s+traducteur|n\.\s?d\.\s?t\.|anm(erkung)?\.?\s+d(es|\.)\s+übers|nota\s+del\s+traductor|n\.\s?del\s+t\.|nota\s+do\s+tradutor|nota\s+del\s+traduttore|noot\s+van\s+de\s+vertaler|примечание\s+переводчика|прим\.\s*пер)/i;

const compact = (s: string) => s.replace(/\s+/g, '');
const comparable = (s: string) => s.replace(/\s+/g, ' ').trim().toLocaleLowerCase();

export interface TranslationShape {
  title: string;
  paragraphs: string[];
}

export interface TranslationCheck {
  sourceParagraphs: number;
  translatedParagraphs: number;
  /** Translated length / source length, rounded to two decimals. */
  lengthRatio: number;
}

const reject = (detail: string): never => {
  throw new LlmOutputRejectedError('TRANSLATION_GUARD', `Çeviri reddedildi: ${detail}`);
};

/**
 * Throws LlmOutputRejectedError unless the translation has a title, as many
 * non-empty paragraphs as the source (within the small tolerance), a length
 * in sane proportion to the source, real translated text (not the source
 * handed back) and no translator's note. Call it on normalised text.
 */
export function checkTranslation(
  source: TranslationShape,
  translated: TranslationShape,
): TranslationCheck {
  if (!translated.title.trim()) reject('başlık boş döndü.');

  const sourceCount = source.paragraphs.length;
  const translatedCount = translated.paragraphs.length;

  const emptyIndex = translated.paragraphs.findIndex((p) => !p.trim());
  if (emptyIndex !== -1) reject(`${emptyIndex + 1}. paragraf boş döndü.`);

  if (Math.abs(sourceCount - translatedCount) > allowedParagraphDrift(sourceCount)) {
    reject(
      `paragraf sayısı tutmuyor (kaynak ${sourceCount}, çeviri ${translatedCount}). ` +
        'Metin eksik ya da fazla çevrilmiş olabilir.',
    );
  }

  const sourceText = source.paragraphs.join('\n');
  const translatedText = translated.paragraphs.join('\n');

  if (comparable(sourceText) === comparable(translatedText)) {
    reject('metin çevrilmeden geri döndü.');
  }

  const sourceLength = compact(sourceText).length;
  const ratio = compact(translatedText).length / sourceLength;
  const short = sourceLength < TRANSLATION_SHORT_TEXT_CHARS;
  const min = short ? TRANSLATION_SHORT_RATIO_MIN : TRANSLATION_RATIO_MIN;
  const max = short ? TRANSLATION_SHORT_RATIO_MAX : TRANSLATION_RATIO_MAX;
  if (ratio < min) {
    reject(
      `çeviri kaynağa göre çok kısa (uzunluk oranı ${ratio.toFixed(2)}, en az ${min}). ` +
        'Metnin bir bölümü atlanmış olabilir.',
    );
  }
  if (ratio > max) {
    reject(
      `çeviri kaynağa göre çok uzun (uzunluk oranı ${ratio.toFixed(2)}, en fazla ${max}). ` +
        'Metne ekleme yapılmış olabilir.',
    );
  }

  if (sourceCount === translatedCount) {
    const untranslated = source.paragraphs.filter(
      (paragraph, i) =>
        paragraph.length >= UNTRANSLATED_MIN_CHARS &&
        comparable(paragraph) === comparable(translated.paragraphs[i]),
    ).length;
    if (untranslated >= 2 && untranslated / sourceCount > TRANSLATION_MAX_UNTRANSLATED_SHARE) {
      reject(`${untranslated} paragraf çevrilmeden bırakılmış.`);
    }
  }

  if (TRANSLATOR_NOTE.test(translatedText) && !TRANSLATOR_NOTE.test(sourceText)) {
    reject('metne çevirmen notu eklenmiş.');
  }

  return {
    sourceParagraphs: sourceCount,
    translatedParagraphs: translatedCount,
    lengthRatio: Math.round(ratio * 100) / 100,
  };
}
