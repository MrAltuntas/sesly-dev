/**
 * "Sıradakiler": the device-local, per-account listening queue (SPEC-audio 6).
 *
 * The queue is a list of narration metas, unique by narration id (the same
 * story read by another narrator is another entry), at most QUEUE_MAX long.
 * It lives in memory and in AsyncStorage under QUEUE_STORAGE_PREFIX + the
 * user id; every mutation writes the whole snapshot `{ version: 1, entries,
 * currentId }` with one setItem (no debounce timer, so nothing is lost when
 * the app is killed right after a change). A snapshot that cannot be read is
 * an empty queue. A change made before the account's stored queue was read
 * is not written on its own (it would replace the stored queue): the read
 * merges it in and writes the result.
 *
 * Queue context: `currentId` is the narration playback is on when that
 * playback came from the queue (`startAt`, through stores/queuePlayback).
 * Only then does a finished story advance. A start from anywhere else for
 * another narration leaves the context (`leaveQueue`), and so does removing
 * the current entry: that story keeps playing and nothing follows it.
 *
 * The store knows neither the audio player nor the timer. The wiring (start
 * listener, story end handler, the meta refresh) is installed once by the
 * session bridge.
 */

import { makeAutoObservable, observable, runInAction } from 'mobx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  onNarrationMetaRemembered,
  parseNarrationMeta,
  playerStoryOf,
  storableMeta,
  type NarrationMeta,
} from './narrationMeta';
import { knownNarrationDurationMs } from '../utils/narrationDurations';

export type QueueEntry = NarrationMeta & { readonly addedAt: number };

/** Longest queue. */
export const QUEUE_MAX = 50;
/** Storage key prefix; the user id follows. */
export const QUEUE_STORAGE_PREFIX = '@sesly/queue:v1:';
const SNAPSHOT_VERSION = 1;

/** The whole queue at one moment, for undo ("Geri al"). */
export interface QueueSnapshot {
  readonly entries: readonly QueueEntry[];
  readonly currentId: string | null;
}

export type QueueAddResult = 'added' | 'exists' | 'full';

/** What `remove` took out, for `restore`. */
export interface RemovedQueueEntry {
  readonly entry: QueueEntry;
  readonly index: number;
  /** It was the entry playback was on (the context was cleared). */
  readonly wasCurrent?: boolean;
}

export const queueStorageKey = (userId: string): string => `${QUEUE_STORAGE_PREFIX}${userId}`;

/** The meta fields only (a record with more, such as the last played one, is trimmed). */
const entryOf = (meta: NarrationMeta, addedAt: number): QueueEntry => ({
  narrationId: meta.narrationId,
  storyId: meta.storyId,
  voiceProfileId: meta.voiceProfileId ?? null,
  story: playerStoryOf(meta.story ?? { id: meta.storyId }),
  voiceProfile: meta.voiceProfile ?? null,
  narratorName: meta.narratorName ?? null,
  ownVoice: meta.ownVoice === true,
  estimateMs: Number.isFinite(meta.estimateMs) && meta.estimateMs > 0 ? meta.estimateMs : 0,
  addedAt,
});

/** Unique by narration id (the first copy wins), at most QUEUE_MAX. */
function dedupe<T extends NarrationMeta>(metas: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const meta of metas) {
    if (!meta?.narrationId || seen.has(meta.narrationId)) continue;
    seen.add(meta.narrationId);
    out.push(meta);
    if (out.length >= QUEUE_MAX) break;
  }
  return out;
}

/** What storage holds for an entry (the voice model is not persisted). */
function storedEntry(entry: QueueEntry): QueueEntry {
  return { ...storableMeta(entry), addedAt: entry.addedAt };
}

/**
 * Of two length estimates of one narration, the one a row should show: the
 * shorter. The estimates differ only by their source: the story's minutes
 * (what its card and its Library row show) or, for a narration that came
 * without its story (a story page), the backend's stored length, which runs
 * about three times too long. A story page seen after the Library must not
 * put "13 dk" back on a row that read "4 dk". The real length wins over both.
 */
export function preferredEstimateMs(old: number, fresh: number): number {
  const a = Number.isFinite(old) && old > 0 ? old : 0;
  const b = Number.isFinite(fresh) && fresh > 0 ? fresh : 0;
  return a > 0 && b > 0 ? Math.min(a, b) : a || b;
}

/**
 * A fresher meta over a queued entry. What the fresh one does not know keeps
 * the entry's value: the narrations of a story page come without their story
 * (no title, no cover, not the story's minutes), a stored meta without the
 * voice model.
 */
function mergedMeta(old: QueueEntry, fresh: NarrationMeta): NarrationMeta {
  const knowsVoice = !!fresh.voiceProfile || !!fresh.narratorName;
  return {
    narrationId: old.narrationId,
    storyId: fresh.storyId || old.storyId,
    voiceProfileId: fresh.voiceProfileId ?? old.voiceProfileId,
    story: fresh.story?.title ? fresh.story : old.story,
    voiceProfile: fresh.voiceProfile ?? old.voiceProfile,
    narratorName: fresh.narratorName ?? old.narratorName,
    ownVoice: knowsVoice ? fresh.ownVoice === true : old.ownVoice,
    estimateMs: preferredEstimateMs(old.estimateMs, fresh.estimateMs),
  };
}

/** Strict parse of a stored snapshot; anything malformed reads as an empty queue. */
export function parseQueueSnapshot(raw: string | null): QueueSnapshot {
  const empty: QueueSnapshot = { entries: [], currentId: null };
  if (!raw) return empty;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!data || typeof data !== 'object') return empty;
  const record = data as Record<string, unknown>;
  if (record.version !== SNAPSHOT_VERSION || !Array.isArray(record.entries)) return empty;
  const entries: QueueEntry[] = [];
  for (const item of record.entries) {
    const meta = parseNarrationMeta(item);
    if (!meta) continue;
    const addedAt = (item as Record<string, unknown>).addedAt;
    entries.push(
      entryOf(meta, typeof addedAt === 'number' && Number.isFinite(addedAt) ? addedAt : 0),
    );
  }
  const unique = dedupe(entries);
  const currentId =
    typeof record.currentId === 'string' && unique.some(e => e.narrationId === record.currentId)
      ? record.currentId
      : null;
  return { entries: unique, currentId };
}

class QueueStore {
  /** Replaced, never mutated in place: a snapshot is the array itself. */
  entries: readonly QueueEntry[] = [];
  /** narrationId of the entry playback is on, when it came from the queue; else null. */
  currentId: string | null = null;
  /** The queue of the signed-in user was read from storage. */
  hydrated = false;

  private userId: string | null = null;
  // Bumped by every hydrate and reset: a slower read for an earlier user is dropped.
  private hydrateSeq = 0;
  // Bumped by every mutation: a re-read of a queue already in memory never
  // undoes a change made while it ran.
  private revision = 0;
  // Changes made before the account's stored queue was read. They are not
  // written yet (a write would replace the stored queue with them); the read
  // merges them in and stores the result.
  private unsaved = false;
  // One of them replaced the whole queue ("Hepsini çal", clear, undo): it wins.
  private replacedUnsaved = false;

  constructor() {
    makeAutoObservable<
      this,
      'userId' | 'hydrateSeq' | 'revision' | 'unsaved' | 'replacedUnsaved'
    >(
      this,
      {
        entries: observable.ref,
        userId: false,
        hydrateSeq: false,
        revision: false,
        unsaved: false,
        replacedUnsaved: false,
      },
      { autoBind: true },
    );
  }

  // ==========================================================================
  // Account
  // ==========================================================================

  /** Read the queue of `userId` (null: signed out, an empty queue). */
  async hydrate(userId: string | null): Promise<void> {
    const seq = ++this.hydrateSeq;
    const revision = this.revision;
    const userChanged = this.userId !== userId;
    this.userId = userId;
    if (userChanged) {
      // Never show one account's queue to another while the read runs.
      this.entries = [];
      this.currentId = null;
      this.hydrated = false;
      this.unsaved = false;
      this.replacedUnsaved = false;
    }
    if (!userId) {
      this.hydrated = true;
      return;
    }
    // A re-read of a queue already in memory, or the read the store waits for.
    const reread = this.hydrated;
    let raw: string | null = null;
    let readFailed = false;
    try {
      raw = await AsyncStorage.getItem(queueStorageKey(userId));
    } catch (error) {
      readFailed = true;
      console.warn('[QueueStore] Reading the queue failed:', error);
    }
    if (seq !== this.hydrateSeq) return;
    const snapshot = parseQueueSnapshot(raw);
    if (reread) {
      // Every change is stored already; one made while this ran is newer,
      // and a failed read knows less than memory.
      if (this.revision !== revision || readFailed) return;
      runInAction(() => {
        this.entries = snapshot.entries;
        this.currentId = snapshot.currentId;
      });
      return;
    }
    const unsaved = this.unsaved;
    runInAction(() => {
      if (!unsaved) {
        this.entries = snapshot.entries;
        this.currentId = snapshot.currentId;
      } else if (!this.replacedUnsaved) {
        // Added before the stored queue arrived: after it, in their order.
        const entries = dedupe([...snapshot.entries, ...this.entries]);
        const own = this.currentId;
        this.entries = entries;
        this.currentId =
          own && entries.some(e => e.narrationId === own) ? own : snapshot.currentId;
      }
      this.hydrated = true;
    });
    this.unsaved = false;
    this.replacedUnsaved = false;
    if (unsaved) this.persist();
  }

  /** Sign-out: forget the queue in memory. Storage keeps it for that account. */
  reset(): void {
    ++this.hydrateSeq;
    this.userId = null;
    this.entries = [];
    this.currentId = null;
    this.hydrated = false;
    this.unsaved = false;
    this.replacedUnsaved = false;
  }

  // ==========================================================================
  // Contents
  // ==========================================================================

  has(narrationId: string): boolean {
    return this.entries.some(e => e.narrationId === narrationId);
  }

  /** Append at the end. Adding while the queue plays: it plays in its turn. */
  add(meta: NarrationMeta): QueueAddResult {
    if (this.has(meta.narrationId)) return 'exists';
    if (this.entries.length >= QUEUE_MAX) return 'full';
    this.commit([...this.entries, entryOf(meta, Date.now())], this.currentId);
    return 'added';
  }

  /** "Hepsini çal": replace the queue (no context yet); returns the previous state for undo. */
  replaceAll(metas: readonly NarrationMeta[]): QueueSnapshot {
    const previous = this.snapshot();
    const now = Date.now();
    this.markReplaced();
    this.commit(
      dedupe(metas).map(meta => entryOf(meta, now)),
      null,
    );
    return previous;
  }

  /** Take one entry out. Removing the current entry clears the context. */
  remove(narrationId: string): RemovedQueueEntry | null {
    const index = this.entries.findIndex(e => e.narrationId === narrationId);
    if (index < 0) return null;
    const entry = this.entries[index];
    const wasCurrent = this.currentId === narrationId;
    this.commit(
      this.entries.filter((_, i) => i !== index),
      wasCurrent ? null : this.currentId,
    );
    return { entry, index, wasCurrent };
  }

  /** Undo of `remove`: back at the same index (and the context, if it was the current one). */
  restore(removed: RemovedQueueEntry): void {
    const { entry } = removed;
    if (this.has(entry.narrationId) || this.entries.length >= QUEUE_MAX) return;
    const index = Math.min(Math.max(0, removed.index), this.entries.length);
    const entries = [...this.entries];
    entries.splice(index, 0, entry);
    const currentId =
      removed.wasCurrent && this.currentId === null ? entry.narrationId : this.currentId;
    this.commit(entries, currentId);
  }

  /** Undo of `clear` and `replaceAll`. */
  restoreSnapshot(snapshot: QueueSnapshot): void {
    const entries = dedupe(snapshot.entries);
    const currentId =
      snapshot.currentId && entries.some(e => e.narrationId === snapshot.currentId)
        ? snapshot.currentId
        : null;
    this.markReplaced();
    this.commit(entries, currentId);
  }

  /** Reorder; the context stays on its narration wherever it moves. */
  move(fromIndex: number, toIndex: number): void {
    const last = this.entries.length - 1;
    if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex > last) return;
    const to = Math.min(Math.max(0, Math.round(toIndex)), last);
    if (to === fromIndex) return;
    const entries = [...this.entries];
    const [entry] = entries.splice(fromIndex, 1);
    entries.splice(to, 0, entry);
    this.commit(entries, this.currentId);
  }

  /** Empty the queue; returns the previous state for undo. */
  clear(): QueueSnapshot {
    const previous = this.snapshot();
    if (this.entries.length > 0 || this.currentId !== null) {
      this.markReplaced();
      this.commit([], null);
    }
    return previous;
  }

  /**
   * Fresher fields of a queued narration (a fetch, a Library page); keeps
   * addedAt and order, and what the fresh meta does not know.
   */
  updateMeta(meta: NarrationMeta): void {
    const index = this.entries.findIndex(e => e.narrationId === meta.narrationId);
    if (index < 0) return;
    const old = this.entries[index];
    const next = entryOf(mergedMeta(old, meta), old.addedAt);
    const sameStored =
      JSON.stringify(storedEntry(old)) === JSON.stringify(storedEntry(next));
    if (sameStored && (old.voiceProfile || !next.voiceProfile)) return;
    const entries = this.entries.map((e, i) => (i === index ? next : e));
    if (sameStored) {
      // Only the voice model (memory only) is new: nothing to store.
      this.entries = entries;
      return;
    }
    this.commit(entries, this.currentId);
  }

  /**
   * A regenerate made a new narration of (story, voice): it takes the old
   * entry's place, the context follows it.
   */
  replaceNarration(storyId: string, voiceProfileId: string | null, meta: NarrationMeta): void {
    const index = this.entries.findIndex(
      e =>
        e.storyId === storyId &&
        e.voiceProfileId === voiceProfileId &&
        e.narrationId !== meta.narrationId,
    );
    if (index < 0) return;
    const old = this.entries[index];
    const entries = this.entries
      .map((e, i) => (i === index ? entryOf(meta, old.addedAt) : e))
      // The new narration may already be queued elsewhere: one copy.
      .filter((e, i) => i === index || e.narrationId !== meta.narrationId);
    const currentId = this.currentId === old.narrationId ? meta.narrationId : this.currentId;
    this.commit(entries, currentId);
  }

  /** A voice was deleted: its narrations leave the queue. */
  removeByVoice(voiceProfileId: string): void {
    if (!voiceProfileId) return;
    const entries = this.entries.filter(e => e.voiceProfileId !== voiceProfileId);
    if (entries.length === this.entries.length) return;
    const currentId =
      this.currentId && entries.some(e => e.narrationId === this.currentId) ? this.currentId : null;
    this.commit(entries, currentId);
  }

  // ==========================================================================
  // Context
  // ==========================================================================

  /** Playback starts from this entry (sets the context). */
  startAt(narrationId: string): QueueEntry | null {
    const entry = this.entries.find(e => e.narrationId === narrationId) ?? null;
    if (!entry) return null;
    if (this.currentId !== narrationId) this.commit(this.entries, narrationId);
    return entry;
  }

  /** Playback left the queue: nothing follows the playing story. */
  leaveQueue(): void {
    if (this.currentId !== null) this.commit(this.entries, null);
  }

  /** Move the context to the next entry. Null at the end (the context stays). */
  advance(): QueueEntry | null {
    const next = this.next;
    if (!next) return null;
    this.commit(this.entries, next.narrationId);
    return next;
  }

  get current(): QueueEntry | null {
    const index = this.index;
    return index >= 0 ? this.entries[index] : null;
  }

  /** Index of the current entry, -1 without context. */
  get index(): number {
    const id = this.currentId;
    return id ? this.entries.findIndex(e => e.narrationId === id) : -1;
  }

  get next(): QueueEntry | null {
    const index = this.index;
    return index >= 0 ? this.entries[index + 1] ?? null : null;
  }

  get previous(): QueueEntry | null {
    const index = this.index;
    return index > 0 ? this.entries[index - 1] : null;
  }

  /** The entries after the current one; empty without context. */
  get upcoming(): QueueEntry[] {
    const index = this.index;
    return index >= 0 ? this.entries.slice(index + 1) : [];
  }

  /**
   * Whole minutes of the whole queue from real lengths only (the device's
   * memory of each narration); null while any length is unknown.
   */
  get totalMinutes(): number | null {
    let totalMs = 0;
    for (const entry of this.entries) {
      const ms = knownNarrationDurationMs(entry.narrationId);
      if (ms === null) return null;
      totalMs += ms;
    }
    return totalMs > 0 ? Math.max(1, Math.round(totalMs / 60000)) : 0;
  }

  snapshot(): QueueSnapshot {
    return { entries: this.entries, currentId: this.currentId };
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  private commit(entries: readonly QueueEntry[], currentId: string | null): void {
    this.entries = entries;
    this.currentId = currentId;
    this.revision += 1;
    if (!this.hydrated) {
      // The stored queue is not read yet: the read stores the merged result.
      this.unsaved = true;
      return;
    }
    this.persist();
  }

  private markReplaced(): void {
    if (!this.hydrated) this.replacedUnsaved = true;
  }

  /** The whole snapshot, one write. Signed out: memory only. */
  private persist(): void {
    const userId = this.userId;
    if (!userId) return;
    const payload = JSON.stringify({
      version: SNAPSHOT_VERSION,
      entries: this.entries.map(storedEntry),
      currentId: this.currentId,
    });
    AsyncStorage.setItem(queueStorageKey(userId), payload).catch(error => {
      console.warn('[QueueStore] Saving the queue failed:', error);
    });
  }
}

export const queueStore = new QueueStore();
export { QueueStore };

/**
 * Keep queued rows current with every meta the app remembers (a Library
 * page, the player's background refresh). Returns the unsubscribe.
 */
export function keepQueueMetaCurrent(queue: QueueStore = queueStore): () => void {
  return onNarrationMetaRemembered(meta => queue.updateMeta(meta));
}
