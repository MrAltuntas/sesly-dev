/**
 * Cover picker: a story with its own image shows it, every other story gets
 * one of ten placeholders by a stable hash of its translation group id (or
 * its own id), so the same tale always shows the same picture.
 */

import {
  COVER_PLACEHOLDERS,
  COVER_PLACEHOLDER_COUNT,
  coverSeedKey,
  COVER_SPREAD_WINDOW,
  assignCoverIndices,
  assignSpread,
  assignedPlaceholderIndex,
  mixHash,
  resetCoverAssignments,
  spreadCoverIndices,
  spreadPlaceholderIndices,
  pickPlaceholderIndex,
  resolveCover,
  stableHash,
} from './covers';

const uuid = (n: number) => `c0a8012e-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A key other than `key` (and `except`) whose own picture is the same as `key`'s. */
function clashingKey(key: string, except: readonly string[] = []): string {
  const target = pickPlaceholderIndex(key);
  for (let i = 1; i < 2000; i++) {
    const candidate = uuid(1000 + i);
    if (candidate !== key && !except.includes(candidate) && pickPlaceholderIndex(candidate) === target) return candidate;
  }
  throw new Error('no clashing key');
}

beforeEach(() => resetCoverAssignments());

describe('stableHash', () => {
  it('is deterministic and matches the FNV-1a reference values', () => {
    // Reference vectors of 32 bit FNV-1a. If these change, every user would
    // see different covers after an update.
    expect(stableHash('')).toBe(0x811c9dc5);
    expect(stableHash('a')).toBe(0xe40c292c);
    expect(stableHash('foobar')).toBe(0xbf9cf968);
    expect(stableHash(uuid(1))).toBe(stableHash(uuid(1)));
  });

  it('is an unsigned 32 bit integer', () => {
    for (let i = 0; i < 50; i++) {
      const hash = stableHash(uuid(i));
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('pickPlaceholderIndex', () => {
  it('there are ten placeholder pictures', () => {
    expect(COVER_PLACEHOLDER_COUNT).toBe(10);
    expect(COVER_PLACEHOLDERS).toHaveLength(10);
  });

  it('always returns the same index, between 0 and 9', () => {
    for (let i = 0; i < 200; i++) {
      const index = pickPlaceholderIndex(uuid(i));
      expect(index).toBe(pickPlaceholderIndex(uuid(i)));
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(10);
    }
  });

  it('spreads sequential ids over all ten pictures', () => {
    const used = new Set<number>();
    for (let i = 0; i < 200; i++) used.add(pickPlaceholderIndex(uuid(i)));
    expect(used.size).toBe(10);
  });
});

describe('coverSeedKey and resolveCover', () => {
  it('prefers the translation group id, so every language shows the same picture', () => {
    const turkish = { id: uuid(1), translationGroupId: 'group-bremen' };
    const english = { id: uuid(2), translationGroupId: 'group-bremen' };
    expect(coverSeedKey(turkish)).toBe('group-bremen');
    expect(resolveCover(turkish).placeholderIndex).toBe(resolveCover(english).placeholderIndex);
  });

  it('falls back to the story id without a group', () => {
    expect(coverSeedKey({ id: uuid(7) })).toBe(uuid(7));
    expect(coverSeedKey({ id: uuid(7), translationGroupId: null })).toBe(uuid(7));
    expect(coverSeedKey({ id: uuid(7), translationGroupId: '' })).toBe(uuid(7));
    expect(resolveCover({ id: uuid(7) })).toEqual({
      kind: 'placeholder',
      source: COVER_PLACEHOLDERS[pickPlaceholderIndex(uuid(7))],
      placeholderIndex: pickPlaceholderIndex(uuid(7)),
    });
  });

  it('a story with coverImageUrl shows that image and keeps its placeholder as fallback', () => {
    const cover = resolveCover({
      id: uuid(3),
      coverImageUrl: 'https://storage.googleapis.com/covers/keloglan.jpg?X-Goog-Signature=abc',
    });
    expect(cover).toEqual({
      kind: 'remote',
      uri: 'https://storage.googleapis.com/covers/keloglan.jpg?X-Goog-Signature=abc',
      // Signed URLs rotate; the cache key is the stable object path.
      cacheKey: 'https://storage.googleapis.com/covers/keloglan.jpg',
      fallback: COVER_PLACEHOLDERS[pickPlaceholderIndex(uuid(3))],
      placeholderIndex: pickPlaceholderIndex(uuid(3)),
    });
  });

  it('a blank coverImageUrl counts as none', () => {
    expect(resolveCover({ id: uuid(4), coverImageUrl: '   ' }).kind).toBe('placeholder');
    expect(resolveCover({ id: uuid(4), coverImageUrl: null }).kind).toBe('placeholder');
  });
});

describe('spreadPlaceholderIndices', () => {
  const keys = Array.from({ length: 30 }, (_, i) => uuid(i));

  it('is deterministic and keeps every index between 0 and 9', () => {
    const first = spreadPlaceholderIndices(keys);
    expect(spreadPlaceholderIndices(keys)).toEqual(first);
    first.forEach(index => {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(COVER_PLACEHOLDER_COUNT);
    });
  });

  it('never repeats a picture within the window of neighbours', () => {
    const indices = spreadPlaceholderIndices(keys);
    for (let i = 0; i < indices.length; i++) {
      for (let back = 1; back <= COVER_SPREAD_WINDOW && i - back >= 0; back++) {
        expect(indices[i]).not.toBe(indices[i - back]);
      }
    }
  });

  it('thirty seed style keys use all ten pictures, none more than twice the fair share', () => {
    const slugs = Array.from({ length: 30 }, (_, i) => `seed-story-masal-${i + 1}`);
    const counts = new Array(COVER_PLACEHOLDER_COUNT).fill(0);
    spreadPlaceholderIndices(slugs).forEach(index => (counts[index] += 1));
    expect(counts.every(n => n > 0)).toBe(true);
    expect(Math.max(...counts)).toBeLessThanOrEqual(6);
  });

  it('starts from the picture of the tale and only steps on a clash', () => {
    expect(spreadPlaceholderIndices([uuid(1)])).toEqual([pickPlaceholderIndex(uuid(1))]);
    const same = spreadPlaceholderIndices(['a', 'a']);
    expect(same[0]).toBe(same[1]);
  });

  it('a clash moves to the next free picture', () => {
    // Find two different keys with the same own picture.
    const base = pickPlaceholderIndex(uuid(0));
    let other = '';
    for (let i = 1; i < 500 && !other; i++) {
      if (pickPlaceholderIndex(uuid(i)) === base) other = uuid(i);
    }
    expect(other).not.toBe('');
    expect(spreadPlaceholderIndices([uuid(0), other])).toEqual([base, (base + 1) % 10]);
  });

  it('spreadCoverIndices keys the result by story id and groups by tale', () => {
    const map = spreadCoverIndices([
      { id: 'tr-1', translationGroupId: 'g' },
      { id: 'en-1', translationGroupId: 'g' },
      { id: 'x' },
    ]);
    expect(map.get('tr-1')).toBe(map.get('en-1'));
    expect(map.get('x')).not.toBe(map.get('tr-1'));
  });
});

describe('session assignment: one picture per tale', () => {
  it('a tale stepped off its picture on a shelf keeps that picture without a list', () => {
    const a = uuid(0);
    const b = clashingKey(a);
    const shelf = assignSpread([a, b]);
    expect(shelf).toEqual([pickPlaceholderIndex(a), (pickPlaceholderIndex(a) + 1) % 10]);
    // The detail, the player, the hero: no placeholderIndex, the same picture.
    expect(resolveCover({ id: b }).placeholderIndex).toBe(shelf[1]);
    expect(resolveCover({ id: a }).placeholderIndex).toBe(shelf[0]);
  });

  it('the same tale keeps one picture across two shelf orders', () => {
    const a = uuid(0);
    const b = clashingKey(a);
    const c = uuid(7);
    const newShelf = assignCoverIndices([{ id: a }, { id: b }, { id: c }]);
    // A category shelf with b first: unspread, b would show a's picture.
    expect(spreadCoverIndices([{ id: b }, { id: c }, { id: a }]).get(b)).not.toBe(newShelf.get(b));
    const categoryShelf = assignCoverIndices([{ id: b }, { id: c }, { id: a }]);
    for (const id of [a, b, c]) expect(categoryShelf.get(id)).toBe(newShelf.get(id));
  });

  it('a tale drawn first without a list keeps its own picture on a later shelf', () => {
    const a = uuid(0);
    const b = clashingKey(a);
    // The hero shows b before any shelf: b is fixed on its own picture.
    expect(resolveCover({ id: b }).placeholderIndex).toBe(pickPlaceholderIndex(b));
    expect(assignSpread([a, b])).toEqual([pickPlaceholderIndex(a), pickPlaceholderIndex(b)]);
  });

  it('new tales still step around their neighbours, also assigned ones', () => {
    const a = uuid(0);
    const b = clashingKey(a);
    const c = clashingKey(a, [b]);
    assignSpread([a]);
    // b clashes with the assigned a before it; c with both.
    const shelf = assignSpread([a, b, c]);
    expect(new Set(shelf).size).toBe(3);
    expect(shelf[0]).toBe(pickPlaceholderIndex(a));
  });

  it('every language of a tale shares the assignment', () => {
    const turkish = { id: 'tr-1', translationGroupId: 'g-1' };
    const english = { id: 'en-1', translationGroupId: 'g-1' };
    const shelf = assignCoverIndices([{ id: clashingKey('g-1') }, turkish]);
    expect(resolveCover(english).placeholderIndex).toBe(shelf.get('tr-1'));
  });

  it('the pure spread is untouched by the session: same result before and after assignments', () => {
    const keys = Array.from({ length: 12 }, (_, i) => uuid(i));
    const before = spreadPlaceholderIndices(keys);
    assignSpread([...keys].reverse());
    keys.forEach(key => resolveCover({ id: key }));
    expect(spreadPlaceholderIndices(keys)).toEqual(before);
    expect(spreadCoverIndices(keys.map(id => ({ id })))).toEqual(
      new Map(keys.map((id, i) => [id, before[i]])),
    );
  });

  it('resetCoverAssignments forgets every picture', () => {
    const a = uuid(0);
    const b = clashingKey(a);
    assignSpread([a, b]);
    expect(assignedPlaceholderIndex(b)).not.toBe(pickPlaceholderIndex(b));
    resetCoverAssignments();
    expect(assignedPlaceholderIndex(b)).toBe(pickPlaceholderIndex(b));
  });
});

describe('assigned pictures and the hash mix', () => {
  it('resolveCover takes the picture a list assigned', () => {
    expect(resolveCover({ id: uuid(3) }, 7).placeholderIndex).toBe(7);
    expect(resolveCover({ id: uuid(3) }, 99).placeholderIndex).toBe(pickPlaceholderIndex(uuid(3)));
    expect(resolveCover({ id: uuid(3) }, 2.5).placeholderIndex).toBe(pickPlaceholderIndex(uuid(3)));
    expect(resolveCover({ id: uuid(3) }, -1).placeholderIndex).toBe(pickPlaceholderIndex(uuid(3)));
  });

  it('mixHash is a 32 bit unsigned value', () => {
    expect(mixHash(0)).toBe(0);
    expect(mixHash(stableHash('a'))).toBeLessThanOrEqual(0xffffffff);
    expect(mixHash(stableHash('a'))).toBeGreaterThanOrEqual(0);
  });
});
