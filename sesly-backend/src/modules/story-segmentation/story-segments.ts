/**
 * The segment model of a story (`Story.preprocessedSegments`).
 *
 * A segment is a piece of the story text plus the delivery tags the TTS
 * layer understands: a Cartesia Sonic 3 emotion, a speed and a volume
 * (both Cartesia generation_config ranges) and an optional pause after it.
 * Google Chirp 3 HD has no emotion or per-request style: it only honours
 * the pause (as a markup pause tag); speed stays the global speaking rate.
 *
 * Pure functions only (no Nest, no Prisma): shared by the import, the
 * admin editor, the lazy segmentation and the audio pipeline.
 */
import {
  SONIC3_BEDTIME_EMOTIONS,
  SONIC3_EMOTION_LABELS_TR,
  SONIC3_EXTENDED_EMOTIONS,
  SONIC3_SPEED_MAX,
  SONIC3_SPEED_MIN,
  SONIC3_VOLUME_MAX,
  SONIC3_VOLUME_MIN,
  isValidSonic3Emotion,
} from '../tts-providers/cartesia/cartesia-emotions.constants';

export interface StorySegment {
  /** What the TTS reads aloud. */
  text: string;
  /** Cartesia Sonic 3 emotion (SONIC3_EXTENDED_EMOTIONS). */
  emotion?: string;
  /** Cartesia speed, 0.6 to 1.5. */
  speed?: number;
  /** Cartesia volume, 0.5 to 2.0. */
  volume?: number;
  /** Silence after the segment, 0 to 3000 ms. */
  pauseAfterMs?: number;
}

/** Who wrote the stored segments (Story.preprocessedModel). A Gemini model id otherwise. */
export const SEGMENTATION_SOURCE = {
  IMPORT: 'import',
  MANUAL: 'manual',
  FALLBACK: 'fallback-split',
} as const;

/** Longest segment text accepted (characters). */
export const SEGMENT_MAX_CHARS = 1500;
/**
 * Longest segment text in UTF-8 bytes. Google accepts 5000 bytes per
 * request; the rest is room for pause markup.
 */
export const SEGMENT_MAX_BYTES = 4500;
/** Most segments a story may have. */
export const SEGMENTS_MAX_COUNT = 1000;
export const PAUSE_AFTER_MAX_MS = 3000;
/** Target length of a segment cut by the deterministic splitter. */
export const FALLBACK_SEGMENT_TARGET_CHARS = 400;

export const utf8Bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Stored JSON to segments. Anything unusable (not an array, an entry
 * without text, a field of the wrong type) is dropped, never thrown on:
 * the column may hold rows written by older code.
 */
export function normalizeStoredSegments(raw: unknown): StorySegment[] {
  if (!Array.isArray(raw)) return [];
  const out: StorySegment[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    if (typeof v.text !== 'string' || v.text.trim().length === 0) continue;
    const segment: StorySegment = { text: v.text };
    if (typeof v.emotion === 'string' && v.emotion.length > 0) segment.emotion = v.emotion;
    if (isFiniteNumber(v.speed)) segment.speed = v.speed;
    if (isFiniteNumber(v.volume)) segment.volume = v.volume;
    if (isFiniteNumber(v.pauseAfterMs) && v.pauseAfterMs > 0) {
      segment.pauseAfterMs = Math.round(v.pauseAfterMs);
    }
    out.push(segment);
  }
  return out;
}

/** The shape written to the database: only the fields that are set. */
export function toStoredSegments(segments: StorySegment[]): StorySegment[] {
  return segments.map((s) => ({
    text: s.text,
    ...(s.emotion ? { emotion: s.emotion } : {}),
    ...(isFiniteNumber(s.speed) ? { speed: s.speed } : {}),
    ...(isFiniteNumber(s.volume) ? { volume: s.volume } : {}),
    ...(isFiniteNumber(s.pauseAfterMs) && s.pauseAfterMs > 0
      ? { pauseAfterMs: Math.round(s.pauseAfterMs) }
      : {}),
  }));
}

/**
 * Every problem of a segment list, in Turkish (the panel and the import
 * report show them). Empty when the list is usable.
 */
export function segmentProblems(segments: StorySegment[]): string[] {
  const problems: string[] = [];
  if (!Array.isArray(segments) || segments.length === 0) {
    return ['En az bir segment gerekir.'];
  }
  if (segments.length > SEGMENTS_MAX_COUNT) {
    problems.push(`En fazla ${SEGMENTS_MAX_COUNT} segment olabilir (${segments.length} var).`);
  }
  segments.forEach((s, i) => {
    const tag = `Segment ${i + 1}`;
    if (!s || typeof s.text !== 'string' || s.text.trim().length === 0) {
      problems.push(`${tag}: metin boş olamaz.`);
      return;
    }
    if (s.text.length > SEGMENT_MAX_CHARS || utf8Bytes(s.text) > SEGMENT_MAX_BYTES) {
      problems.push(`${tag}: en fazla ${SEGMENT_MAX_CHARS} karakter olabilir, bölün.`);
    }
    if (s.emotion !== undefined && s.emotion !== null && !isValidSonic3Emotion(s.emotion)) {
      problems.push(`${tag}: "${s.emotion}" desteklenen bir duygu değil.`);
    }
    if (s.speed !== undefined && s.speed !== null) {
      if (!isFiniteNumber(s.speed) || s.speed < SONIC3_SPEED_MIN || s.speed > SONIC3_SPEED_MAX) {
        problems.push(`${tag}: hız ${SONIC3_SPEED_MIN} ile ${SONIC3_SPEED_MAX} arasında olmalı.`);
      }
    }
    if (s.volume !== undefined && s.volume !== null) {
      if (!isFiniteNumber(s.volume) || s.volume < SONIC3_VOLUME_MIN || s.volume > SONIC3_VOLUME_MAX) {
        problems.push(`${tag}: ses düzeyi ${SONIC3_VOLUME_MIN} ile ${SONIC3_VOLUME_MAX} arasında olmalı.`);
      }
    }
    if (s.pauseAfterMs !== undefined && s.pauseAfterMs !== null) {
      if (!isFiniteNumber(s.pauseAfterMs) || s.pauseAfterMs < 0 || s.pauseAfterMs > PAUSE_AFTER_MAX_MS) {
        problems.push(`${tag}: ara 0 ile ${PAUSE_AFTER_MAX_MS} ms arasında olmalı.`);
      }
    }
  });
  return problems;
}

const stripWhitespace = (s: string): string => s.replace(/\s+/g, '');

/**
 * Whether the segments read exactly the story text (whitespace ignored).
 * `diff` shows the first difference when they do not.
 */
export function compareSegmentsWithContent(
  segments: StorySegment[],
  content: string,
): { matches: boolean; diff?: string } {
  const joined = stripWhitespace(segments.map((s) => s.text).join(''));
  const original = stripWhitespace(content);
  if (joined === original) return { matches: true };
  let i = 0;
  while (i < joined.length && i < original.length && joined[i] === original[i]) i++;
  const around = (s: string) => s.slice(Math.max(0, i - 20), i + 20);
  return {
    matches: false,
    diff: `segmentler: "${around(joined)}" | metin: "${around(original)}"`,
  };
}

/**
 * Joins segment texts for one TTS request. Segments cut from the story
 * usually carry their own surrounding whitespace; where neither side has
 * any, a space keeps the words apart.
 */
export function joinSegmentTexts(texts: string[]): string {
  let out = '';
  for (const text of texts) {
    if (out && !/\s$/.test(out) && !/^\s/.test(text)) out += ' ';
    out += text;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic splitter (fallback when Gemini is unavailable)
// ---------------------------------------------------------------------------

/**
 * Words that end with a full stop without ending the sentence (lower case,
 * without the dot). Turkish and English.
 */
const ABBREVIATIONS = new Set([
  'dr', 'prof', 'doç', 'doc', 'yrd', 'av', 'sn', 'bkz', 'vb', 'vs', 'örn', 'orn',
  'mr', 'mrs', 'ms', 'st', 'jr', 'sr', 'no', 'etc', 'vol', 'ch', 'mt', 'capt', 'col', 'gen', 'lt', 'rev',
]);

const CLOSERS = `"'”’»)\\]`;
const TERMINATOR = new RegExp(`(?:\\.{3}|[.!?\\u2026]+)[${CLOSERS}]*(?=\\s|$)`, 'gu');

/**
 * Splits one paragraph into sentences without cutting a sentence:
 * a terminator followed by a lower-case word ("Gel!" diye bağırdı), after
 * an abbreviation (Dr.) or after a single capital initial (J.) is not a
 * sentence end. Every character of the input is kept.
 */
export function splitSentences(paragraph: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  TERMINATOR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TERMINATOR.exec(paragraph)) !== null) {
    const end = match.index + match[0].length;
    const rest = paragraph.slice(end);
    const next = rest.replace(/^\s+/, '').charAt(0);
    if (next && /\p{Ll}/u.test(next)) continue;
    const before = paragraph.slice(start, match.index);
    const lastWord = (before.match(/([\p{L}]+)$/u)?.[1] ?? '').toLocaleLowerCase('tr');
    if (match[0].startsWith('.') && !match[0].startsWith('...')) {
      if (ABBREVIATIONS.has(lastWord)) continue;
      if (/(^|\s)\p{Lu}$/u.test(before)) continue;
    }
    const ws = rest.match(/^\s*/)?.[0] ?? '';
    sentences.push(paragraph.slice(start, end + ws.length));
    start = end + ws.length;
  }
  if (start < paragraph.length) sentences.push(paragraph.slice(start));
  return sentences.filter((s) => s.trim().length > 0);
}

/** A piece longer than the hard limit: cut at a line break, a clause mark, then a space. */
function splitOversized(text: string): string[] {
  const pieces: string[] = [];
  let rest = text;
  const fits = (s: string) => s.length <= SEGMENT_MAX_CHARS && utf8Bytes(s) <= SEGMENT_MAX_BYTES;
  while (!fits(rest)) {
    let limit = Math.min(SEGMENT_MAX_CHARS, rest.length);
    while (limit > 1 && utf8Bytes(rest.slice(0, limit)) > SEGMENT_MAX_BYTES) limit--;
    const window = rest.slice(0, limit);
    let cut = window.lastIndexOf('\n');
    if (cut < limit / 3) {
      const clause = Math.max(window.lastIndexOf('; '), window.lastIndexOf(': '), window.lastIndexOf(', '));
      cut = clause > limit / 3 ? clause + 1 : -1;
    }
    if (cut < limit / 3) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = limit;
    pieces.push(rest.slice(0, cut + (rest[cut] === ' ' || rest[cut] === '\n' ? 1 : 0)));
    rest = rest.slice(cut + (rest[cut] === ' ' || rest[cut] === '\n' ? 1 : 0));
  }
  if (rest.trim()) pieces.push(rest);
  return pieces;
}

/**
 * Free, deterministic segmentation: paragraphs and sentences packed into
 * segments of about `target` characters. Never cuts inside a sentence
 * unless the sentence alone is longer than SEGMENT_MAX_CHARS. Paragraph
 * breaks inside a segment are kept. No tags: the pipeline applies the
 * story defaults. Used only when Gemini segmentation is not available.
 */
export function splitStoryForTts(
  content: string,
  target: number = FALLBACK_SEGMENT_TARGET_CHARS,
): StorySegment[] {
  const normalized = (content ?? '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return [];

  const pieces: string[] = [];
  for (const paragraph of normalized.split(/\n{2,}/)) {
    const sentences = paragraph.trim().length <= target ? [paragraph.trim()] : splitSentences(paragraph.trim());
    for (const sentence of sentences) pieces.push(...splitOversized(sentence.trim()));
    // Paragraph boundary marker.
    pieces.push('\n\n');
  }

  const segments: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (piece === '\n\n') {
      if (current) current += '\n\n';
      continue;
    }
    const candidate = current ? joinSegmentTexts([current, piece]) : piece;
    if (current && (candidate.trim().length > target || utf8Bytes(candidate) > SEGMENT_MAX_BYTES)) {
      segments.push(current.trim());
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments.map((text) => ({ text }));
}

/** What the admin editor and the import document offer as tags. */
export function segmentVocabulary() {
  return {
    emotions: SONIC3_EXTENDED_EMOTIONS.map((value) => ({
      value,
      label: SONIC3_EMOTION_LABELS_TR[value],
      recommended: SONIC3_BEDTIME_EMOTIONS.includes(value),
    })),
    speed: { min: SONIC3_SPEED_MIN, max: SONIC3_SPEED_MAX, recommendedMin: 0.65, recommendedMax: 1.05 },
    volume: { min: SONIC3_VOLUME_MIN, max: SONIC3_VOLUME_MAX },
    pauseAfterMs: { min: 0, max: PAUSE_AFTER_MAX_MS },
    maxSegmentChars: SEGMENT_MAX_CHARS,
    maxSegments: SEGMENTS_MAX_COUNT,
  };
}
