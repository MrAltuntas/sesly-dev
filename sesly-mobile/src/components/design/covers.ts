/**
 * Cover pictures.
 *
 * A story with `coverImageUrl` shows that image. Otherwise it gets one of ten
 * placeholder illustrations. Every tale starts from its own picture, chosen
 * by a stable hash (the same after every restart and, once the backend sends
 * the translation group id, in every language). A shelf steps a tale off its
 * picture when a neighbour already shows it (`assignSpread`), and the picture
 * a tale got first is kept for the whole session, so the same tale shows the
 * same picture on every shelf, its detail, the player and the library rows.
 */

import type { ImageSourcePropType } from 'react-native';

/* eslint-disable @typescript-eslint/no-var-requires */
export const COVER_PLACEHOLDERS: readonly ImageSourcePropType[] = [
  require('../../../assets/images/covers/cover-placeholder-01.webp'),
  require('../../../assets/images/covers/cover-placeholder-02.webp'),
  require('../../../assets/images/covers/cover-placeholder-03.webp'),
  require('../../../assets/images/covers/cover-placeholder-04.webp'),
  require('../../../assets/images/covers/cover-placeholder-05.webp'),
  require('../../../assets/images/covers/cover-placeholder-06.webp'),
  require('../../../assets/images/covers/cover-placeholder-07.webp'),
  require('../../../assets/images/covers/cover-placeholder-08.webp'),
  require('../../../assets/images/covers/cover-placeholder-09.webp'),
  require('../../../assets/images/covers/cover-placeholder-10.webp'),
];
/* eslint-enable @typescript-eslint/no-var-requires */

export const COVER_PLACEHOLDER_COUNT = 10;

/**
 * FNV-1a, 32 bit. Deterministic across devices, JS engines and app versions
 * (no Math.random, no object identity), and spreads similar ids (UUIDs that
 * share a prefix) evenly.
 */
export function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** What the picker needs to know about a story. */
export interface CoverSubject {
  readonly id: string;
  /** Same for every language version of one tale; null when unknown. */
  readonly translationGroupId?: string | null;
  /**
   * The API's `coverKey`: the same for every language version (else every
   * part) of a tale, so they draw the same placeholder picture.
   */
  readonly coverKey?: string | null;
  readonly coverImageUrl?: string | null;
  /** Story category (the colour of its dot and chips). */
  readonly category?: string | null;
}

/** The key the placeholder is derived from: the tale's cover key, else the translation group, else the story. */
export function coverSeedKey(subject: Pick<CoverSubject, 'id' | 'translationGroupId' | 'coverKey'>): string {
  return subject.coverKey || subject.translationGroupId || subject.id;
}

/**
 * Final avalanche of MurmurHash3. FNV alone leaves the low bits of similar
 * keys (seed slugs, sequential ids) correlated, and the low bits are what
 * "modulo ten" reads; after this step every input bit reaches them, so the
 * ten pictures are used evenly.
 */
export function mixHash(hash: number): number {
  let h = hash >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Index (0 to 9) of the placeholder for a seed key. */
export function pickPlaceholderIndex(seedKey: string): number {
  return mixHash(stableHash(seedKey)) % COVER_PLACEHOLDER_COUNT;
}

/**
 * How many neighbours before an item must show a different picture. Three
 * covers are visible side by side on a shelf, so no picture repeats within
 * one screenful.
 */
export const COVER_SPREAD_WINDOW = 3;

/**
 * Placeholder indices for a shelf or list, in order. Every tale starts from
 * its own picture (`pickPlaceholderIndex`); when that picture was already
 * used by one of the previous `window` items it steps to the next picture
 * that is free in that window. The result depends only on the order of the
 * keys, so the same list always draws the same pictures. A key that appears
 * again (the same tale in another language) keeps the picture it got first.
 */
export function spreadPlaceholderIndices(
  seedKeys: readonly string[],
  window: number = COVER_SPREAD_WINDOW,
): number[] {
  return spreadInto(seedKeys, window, new Map<string, number>());
}

/**
 * The spread rule over `byKey`: a key found there keeps its index, any other
 * key gets its spread index against the window and is added to it.
 */
function spreadInto(seedKeys: readonly string[], window: number, byKey: Map<string, number>): number[] {
  const span = Math.max(0, Math.min(window, COVER_PLACEHOLDER_COUNT - 1));
  const out: number[] = [];
  for (const key of seedKeys) {
    const known = byKey.get(key);
    if (known !== undefined) {
      out.push(known);
      continue;
    }
    const recent = out.slice(Math.max(0, out.length - span));
    let index = pickPlaceholderIndex(key);
    for (let step = 0; step < COVER_PLACEHOLDER_COUNT && recent.includes(index); step++) {
      index = (index + 1) % COVER_PLACEHOLDER_COUNT;
    }
    byKey.set(key, index);
    out.push(index);
  }
  return out;
}

/** Spread indices keyed by story id, for a list of stories in display order. */
export function spreadCoverIndices(
  subjects: readonly Pick<CoverSubject, 'id' | 'translationGroupId'>[],
  window: number = COVER_SPREAD_WINDOW,
): Map<string, number> {
  const indices = spreadPlaceholderIndices(subjects.map(coverSeedKey), window);
  const map = new Map<string, number>();
  subjects.forEach((subject, i) => map.set(subject.id, indices[i]));
  return map;
}

// ─────────────────────────────────────────────────────────────
// Session assignment: one picture per tale
// ─────────────────────────────────────────────────────────────

/**
 * The picture each tale (seed key) shows in this session. Whichever list or
 * screen draws a tale first fixes its picture; every later shelf, the hero,
 * the detail, the player and the library rows read it from here. The cost:
 * two tales fixed on different screens may later sit side by side with the
 * same picture, which is milder than a tale changing its picture.
 */
const assigned = new Map<string, number>();

function isPlaceholderIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < COVER_PLACEHOLDER_COUNT;
}

/**
 * Pictures for a shelf or list in display order, recorded for the session. A
 * tale that already has a picture keeps it; any other tale starts from its
 * own picture and steps to the next one free among the previous `window`
 * items of this list (the rule of `spreadPlaceholderIndices`), and that index
 * is recorded.
 */
export function assignSpread(seedKeys: readonly string[], window: number = COVER_SPREAD_WINDOW): number[] {
  return spreadInto(seedKeys, window, assigned);
}

/** `assignSpread` keyed by story id, for a list of stories in display order. */
export function assignCoverIndices(
  subjects: readonly Pick<CoverSubject, 'id' | 'translationGroupId'>[],
  window: number = COVER_SPREAD_WINDOW,
): Map<string, number> {
  const indices = assignSpread(subjects.map(coverSeedKey), window);
  const map = new Map<string, number>();
  subjects.forEach((subject, i) => map.set(subject.id, indices[i]));
  return map;
}

/** The picture of a tale for this session: the recorded one, else its own (and recorded). */
export function assignedPlaceholderIndex(seedKey: string): number {
  const known = assigned.get(seedKey);
  if (known !== undefined) return known;
  const index = pickPlaceholderIndex(seedKey);
  assigned.set(seedKey, index);
  return index;
}

/** Forgets every recorded picture (jest: call it in `beforeEach`). */
export function resetCoverAssignments(): void {
  assigned.clear();
}

export type ResolvedCover =
  | { kind: 'remote'; uri: string; cacheKey: string; fallback: ImageSourcePropType; placeholderIndex: number }
  | { kind: 'placeholder'; source: ImageSourcePropType; placeholderIndex: number };

/**
 * Decide what a story's cover shows. A list passes the picture it assigned;
 * without one the tale shows its picture of this session. A remote cover
 * keeps its placeholder as the fallback for a failed download.
 */
export function resolveCover(subject: CoverSubject, placeholderOverride?: number): ResolvedCover {
  const placeholderIndex = isPlaceholderIndex(placeholderOverride)
    ? placeholderOverride
    : assignedPlaceholderIndex(coverSeedKey(subject));
  const fallback = COVER_PLACEHOLDERS[placeholderIndex];
  const uri = subject.coverImageUrl?.trim();
  if (uri) {
    // Signed URLs rotate their query string; cache on the stable object path.
    return { kind: 'remote', uri, cacheKey: uri.split('?')[0], fallback, placeholderIndex };
  }
  return { kind: 'placeholder', source: fallback, placeholderIndex };
}
