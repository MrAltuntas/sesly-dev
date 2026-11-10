/**
 * Story Hook with MobX Store
 * Replaces Flutter StoryController
 *
 * Each screen part has its own loading flag and error: `isLoadingMore` /
 * `errorMessage` / `listErrorKind` belong to the story list (loadStories),
 * `isLoadingDetail` / `storyDetailErrorStatus` / `detailErrorKind` to the
 * story detail, `isLoadingFavorites` / `favoritesError` /
 * `favoritesErrorKind` to the saved list. A failed load sets its error; the
 * screen shows its own error state for an empty list, so a snackbar comes
 * only when rows stay on screen (a refresh or a next page that failed).
 * Actions the user started (saving) still say when they fail.
 *
 * Everything here belongs to the signed-in account: `reset()` runs on
 * sign-out, on session expiry and when another account signs in, and drops
 * every answer still in flight, so the next account never sees this one's
 * saved marks, narrations or shelves.
 */

import { makeAutoObservable, observable, runInAction } from 'mobx';
import { useMemo } from 'react';
import StoryService from '../services/StoryService';
import NarrationService from '../services/NarrationService';
import { Story, StoryDetail, TaleRef, isStorySaved } from '../models/Story';
import { StoryNarration } from '../models/Narration';
import { showToast } from '../utils/toast';
import { FailureKind, classifyFailure, getErrorMessage, isApiError } from '../services/ApiError';
import { getConnectivityStore } from '../stores/ConnectivityStore';
import { msg } from '../i18n/messages';
import { getDiscoverStore } from './useDiscover';
import { getContentLanguageStore } from './useContentLanguage';
import {
  getSessionUserId,
  onSessionUserChange,
  registerSessionEndHandler,
} from '../stores/session';

/** Story details kept for reopening a story without a skeleton. */
export const DETAIL_CACHE_SIZE = 20;
/** Favourite changes kept for lists that patch their rows instead of refetching. */
export const FAVORITE_CHANGES_KEPT = 50;
/** Stories per home category shelf. */
export const CATEGORY_SHELF_LIMIT = 10;

/** One save or unsave, as every in-memory copy received it. */
export interface FavoriteChange {
  /** The value of `favoritesVersion` this change produced. */
  readonly version: number;
  readonly story: TaleRef;
  readonly saved: boolean;
}

/**
 * How a toggleFavorite / restoreFavorite call ended:
 *   - `done`: the state asked for last is on the server;
 *   - `failed`: the last request failed and every copy was rolled back;
 *   - `superseded`: a later tap on the same story took over before this one
 *     settled, and that call reports the outcome.
 */
export type FavoriteToggleResult = 'done' | 'failed' | 'superseded';

export interface ToggleFavoriteOptions {
  /** No error snackbar: the caller tells the user itself. */
  quiet?: boolean;
}

/**
 * The taps on one story's bookmark while its requests run. Requests for a
 * story never overlap: the running loop sends the latest wanted state once
 * the previous request settled.
 */
interface FavoriteBurst {
  /** Server state before the first tap, then after every request that succeeded. */
  confirmed: boolean;
  /** Bumped by every tap; only the latest tap reports the outcome. */
  tap: number;
  quiet: boolean;
  /** Ids to save (restoreFavorite saves every version it had removed). */
  saveIds: string[];
  /** Ids to unsave: every saved language version seen during the burst. */
  removeIds: Set<string>;
  /** List-shaped copy for re-inserting the story into the saved list. */
  snapshot: Story | null;
  /** The saved-list entry and its place before the burst, for the rollback. */
  savedEntry: Story | null;
  savedIndex: number;
  run: Promise<boolean> | null;
  /** The store's session the burst began in (reset() ends it). */
  session: number;
}

/** List-shaped copy of a detail (no chunks / progress / translations). */
function toListStory(detail: StoryDetail): Story {
  return {
    id: detail.id,
    title: detail.title,
    description: detail.description,
    ageGroup: detail.ageGroup,
    category: detail.category,
    estimatedDuration: detail.estimatedDuration,
    coverImageUrl: detail.coverImageUrl,
    isPremium: detail.isPremium,
    isFavorite: detail.isFavorite,
    language: detail.language,
    languageLevel: detail.languageLevel,
    summary: detail.summary,
    credit: detail.credit,
    translationGroupId: detail.translationGroupId,
    coverKey: detail.coverKey,
    contentWarnings: detail.contentWarnings,
    availableLanguages: detail.availableLanguages,
    isFavoriteAnyLanguage: detail.isFavoriteAnyLanguage,
  };
}

/** The saved-list entry names the story itself or one of its saved versions. */
function namesStory(entry: Story, storyId: string): boolean {
  return entry.id === storyId || (entry.favoriteStoryIds?.includes(storyId) ?? false);
}

/** Kind of a failed load; the connection state decides `offline` first. */
function failureKindOf(error: unknown): FailureKind {
  return classifyFailure(error, getConnectivityStore());
}

// ============================================================================
// Story Store (MobX)
// ============================================================================

class StoryStore {
  stories: Story[] = [];
  favoriteStories: Story[] = [];
  currentStory: StoryDetail | null = null;

  // Narrations owned by the signed-in user. Populated by loadUserNarrations,
  // read by the Library tab (to list narrated stories) and StoryDetail (to
  // detect existing narrations before creating a new one).
  userNarrations: StoryNarration[] = [];
  isLoadingNarrations = false;
  isLoadingMoreNarrations = false;
  narrationsPage = 1;
  narrationsTotalPages = 1;
  hasMoreNarrations = true;
  // Active search term, carried into loadMoreNarrations so page 2+ stay filtered.
  narrationsSearch = '';
  // Bumped by every page-1 load; stale responses are dropped (see loaders).
  private narrationsGeneration = 0;
  private storiesGeneration = 0;
  private favoritesGeneration = 0;
  /** A story list / the saved list was asked for (a language change fetches it again). */
  private storiesRequested = false;
  private favoritesRequested = false;
  /** Bumped by reset(): an answer for the account that left is dropped. */
  private session = 0;

  /**
   * Every narration of one story (`GET /narrations/story/:id`), filled by
   * loadNarrationsForStory. Unlike userNarrations it is not limited to the
   * newest page.
   */
  narrationsByStory = new Map<string, StoryNarration[]>();
  private storyNarrationsSeq = new Map<string, number>();
  /**
   * Stories whose last loadNarrationsForStory failed while no list of
   * their own was there: their pages go on with what userNarrations knows.
   */
  narrationsFailedFor = new Set<string>();

  /** A next page of the story list (loadStories) is in flight. */
  isLoadingMore = false;
  /** Story list error (loadStories). */
  errorMessage = '';
  listErrorKind: FailureKind | null = null;

  /** Story detail (getStoryDetail): true while no copy of the story can be shown. */
  isLoadingDetail = false;
  // HTTP status of the last failed getStoryDetail (403 = premium-only story).
  storyDetailErrorStatus: number | null = null;
  detailErrorKind: FailureKind | null = null;
  /** The story the last getStoryDetail asked for; older answers are dropped. */
  private detailRequestId = '';
  /** Least recently opened first (a Map keeps insertion order). */
  private detailCache = new Map<string, StoryDetail>();

  // Stories pagination
  currentPage = 1;
  totalPages = 1;
  hasMore = true;

  // Favorites pagination
  favoritesPage = 1;
  favoritesTotalPages = 1;
  hasMoreFavorites = true;
  isLoadingMoreFavorites = false;
  /** First page of the saved list in flight. */
  isLoadingFavorites = false;
  /** The first page of the saved list failed (cleared when the next one starts). */
  favoritesError = false;
  favoritesErrorKind: FailureKind | null = null;
  /** Saved tales the backend counts (meta.total of the saved list). */
  favoritesTotal = 0;

  /**
   * Bumped by every change of a saved state in this store; `favoriteChanges`
   * holds the last FAVORITE_CHANGES_KEPT of them, so a list can patch its
   * rows with the changes made since it last looked.
   */
  favoritesVersion = 0;
  favoriteChanges: readonly FavoriteChange[] = [];
  private favoriteWanted = new Map<string, boolean>();
  private favoriteBusy = new Set<string>();
  private favoriteBursts = new Map<string, FavoriteBurst>();

  /** Home shelves: one request per category (loadCategoryShelves). */
  shelfByCategory = new Map<string, Story[]>();
  isLoadingShelves = false;
  /** True once a shelf request settled: tells loading from empty. */
  hasLoadedShelves = false;
  /** Set when every category request failed. */
  shelvesErrorKind: FailureKind | null = null;
  private shelfCategories: string[] = [];
  private shelfLimit = CATEGORY_SHELF_LIMIT;
  private shelvesGeneration = 0;

  constructor() {
    makeAutoObservable<
      this,
      | 'narrationsGeneration'
      | 'storiesGeneration'
      | 'favoritesGeneration'
      | 'storiesRequested'
      | 'favoritesRequested'
      | 'session'
      | 'storyNarrationsSeq'
      | 'detailRequestId'
      | 'detailCache'
      | 'favoriteWanted'
      | 'favoriteBusy'
      | 'favoriteBursts'
      | 'shelfCategories'
      | 'shelfLimit'
      | 'shelvesGeneration'
    >(this, {
      narrationsGeneration: false,
      storiesGeneration: false,
      favoritesGeneration: false,
      storiesRequested: false,
      favoritesRequested: false,
      session: false,
      storyNarrationsSeq: false,
      detailRequestId: false,
      detailCache: false,
      favoriteWanted: false,
      favoriteBusy: false,
      favoriteBursts: false,
      shelfCategories: false,
      shelfLimit: false,
      shelvesGeneration: false,
      favoriteChanges: observable.ref,
    });
  }

  // ============================================================================
  // User Narrations
  // ============================================================================

  async loadUserNarrations(page = 1, search = ''): Promise<void> {
    // A page-1 load (new search term, refresh) starts a new list generation;
    // responses from an older generation (a slower request for an outdated
    // term, or a loadMore that was in flight) are dropped.
    if (page === 1) this.narrationsGeneration += 1;
    const generation = this.narrationsGeneration;
    const isCurrent = () => generation === this.narrationsGeneration;
    try {
      if (page === 1) {
        runInAction(() => {
          this.isLoadingNarrations = true;
          this.isLoadingMoreNarrations = false;
          this.narrationsSearch = search;
        });
      } else {
        runInAction(() => {
          this.isLoadingMoreNarrations = true;
        });
      }

      const response = await NarrationService.getMyNarrations({
        page,
        limit: 20,
        search,
      });
      if (!isCurrent()) return;

      runInAction(() => {
        if (page === 1) {
          this.userNarrations = [...response.data];
        } else {
          this.userNarrations = [...this.userNarrations, ...response.data];
        }
        this.mergeStoryNarrations(response.data);
        this.narrationsPage = response.meta.page;
        this.narrationsTotalPages = response.meta.totalPages;
        this.hasMoreNarrations = response.meta.page < response.meta.totalPages;
      });
    } catch (error) {
      if (isCurrent()) console.error('Load user narrations error:', error);
    } finally {
      if (isCurrent()) {
        runInAction(() => {
          this.isLoadingNarrations = false;
          this.isLoadingMoreNarrations = false;
        });
      }
    }
  }

  async loadMoreNarrations(): Promise<void> {
    if (!this.hasMoreNarrations || this.isLoadingMoreNarrations) return;
    await this.loadUserNarrations(this.narrationsPage + 1, this.narrationsSearch);
  }

  /**
   * Narrations of one story: the full list from loadNarrationsForStory once
   * it arrived, else the matching rows of the newest page (userNarrations).
   */
  getNarrationsForStory(storyId: string): StoryNarration[] {
    return (
      this.narrationsByStory.get(storyId) ??
      this.userNarrations.filter(n => n.storyId === storyId)
    );
  }

  /**
   * Keep the per-story lists current with a page of the user's narrations
   * (a push refreshes that page when a narration became ready while its
   * story page is open): each narration replaces its old copy, a new one
   * goes first. Only stories already listed are touched.
   */
  private mergeStoryNarrations(narrations: readonly StoryNarration[]): void {
    for (const narration of narrations) {
      const list = this.narrationsByStory.get(narration.storyId);
      if (!list) continue;
      const index = list.findIndex(n => n.id === narration.id);
      this.narrationsByStory.set(
        narration.storyId,
        index >= 0
          ? list.map((n, i) => (i === index ? narration : n))
          : [narration, ...list],
      );
    }
  }

  /**
   * The narrations of one story are known: its own list arrived
   * (loadNarrationsForStory), or its request failed, and then the newest
   * page (userNarrations) is all there is. Until then a story page cannot
   * tell "nothing ready yet" from "not asked yet" (V3-04).
   */
  narrationsKnownFor(storyId: string): boolean {
    return this.narrationsByStory.has(storyId) || this.narrationsFailedFor.has(storyId);
  }

  /**
   * Load every narration of one story into narrationsByStory. An older
   * request for the same story that answers later is dropped; a failure
   * keeps the list that was there (and marks the story as known, so a page
   * waiting for it goes on). Never throws.
   */
  async loadNarrationsForStory(storyId: string): Promise<void> {
    if (!storyId) return;
    const seq = (this.storyNarrationsSeq.get(storyId) ?? 0) + 1;
    this.storyNarrationsSeq.set(storyId, seq);
    const session = this.session;
    try {
      const narrations = await NarrationService.getNarrationsByStory(storyId);
      if (session !== this.session || this.storyNarrationsSeq.get(storyId) !== seq) return;
      runInAction(() => {
        // The route sends no storyId; callers match narrations by it.
        this.narrationsByStory.set(
          storyId,
          narrations.map(n => (n.storyId ? n : { ...n, storyId })),
        );
        this.narrationsFailedFor.delete(storyId);
      });
    } catch (error) {
      if (session === this.session && this.storyNarrationsSeq.get(storyId) === seq) {
        console.warn('Load story narrations error:', error);
        runInAction(() => {
          if (!this.narrationsByStory.has(storyId)) this.narrationsFailedFor.add(storyId);
        });
      }
    }
  }

  // ============================================================================
  // Fetch Stories
  // ============================================================================

  async loadStories(page = 1, categoryId?: string): Promise<void> {
    // Same generation guard as loadUserNarrations: a pull-to-refresh while a
    // loadMore is in flight must not let the stale page land on the fresh list.
    if (page === 1) this.storiesGeneration += 1;
    const generation = this.storiesGeneration;
    const isCurrent = () => generation === this.storiesGeneration;
    this.storiesRequested = true;
    try {
      if (page === 1) {
        runInAction(() => {
          this.isLoadingMore = false;
          this.errorMessage = '';
          this.listErrorKind = null;
        });
      } else {
        runInAction(() => {
          this.isLoadingMore = true;
        });
      }

      // Home lists one language only (flat list): the content language.
      // A tale without a version in it is not on Home (Keşfet finds it).
      const response = await StoryService.getStories({
        page,
        limit: 20,
        category: categoryId,
        language: getContentLanguageStore().effective,
      });
      if (!isCurrent()) return;

      runInAction(() => {
        // A save still being sent wins over the answer.
        const rows = response.data.map(s => this.withPendingFavorite(s));
        if (page === 1) {
          this.stories = rows;
        } else {
          this.stories = [...this.stories, ...rows];
        }

        this.currentPage = response.meta.page;
        this.totalPages = response.meta.totalPages;
        this.hasMore = page < response.meta.totalPages;
      });
    } catch (error) {
      if (!isCurrent()) return;
      console.error('Load stories error:', error);
      // A failed next page keeps the rows; the list's error state is for page 1.
      if (page === 1) {
        runInAction(() => {
          this.errorMessage = msg('story.listFailed');
          this.listErrorKind = failureKindOf(error);
        });
      }
      // The screen shows its error state only for an empty list. With rows
      // still on screen (a refresh, a next page) the snackbar is the only sign.
      if (this.stories.length > 0) showToast.error(msg('story.listFailed'));
    } finally {
      if (isCurrent()) {
        runInAction(() => {
          this.isLoadingMore = false;
        });
      }
    }
  }

  async loadMore(): Promise<void> {
    if (!this.hasMore || this.isLoadingMore) return;
    await this.loadStories(this.currentPage + 1);
  }

  async refresh(): Promise<void> {
    this.currentPage = 1;
    this.hasMore = true;
    await this.loadStories(1);
  }

  // ============================================================================
  // Home category shelves
  // ============================================================================

  /**
   * One shelf per category, each from its own request (flat, the content
   * language only), so a category never depends on the newest page.
   * A category that fails keeps the shelf it had; a category with no story
   * has an empty shelf. Shelves are read with shelfByCategory.get(category).
   */
  async loadCategoryShelves(
    categories: readonly string[],
    options?: { limit?: number },
  ): Promise<void> {
    this.shelvesGeneration += 1;
    const generation = this.shelvesGeneration;
    const limit = options?.limit ?? CATEGORY_SHELF_LIMIT;
    runInAction(() => {
      this.shelfCategories = [...categories];
      this.shelfLimit = limit;
      this.isLoadingShelves = true;
    });
    const language = getContentLanguageStore().effective;
    const results = await Promise.allSettled(
      categories.map(category => StoryService.getStories({ page: 1, limit, category, language })),
    );
    if (generation !== this.shelvesGeneration) return;
    runInAction(() => {
      const shelves = new Map<string, Story[]>();
      let firstFailure: unknown = null;
      let failures = 0;
      results.forEach((result, index) => {
        const category = categories[index];
        if (result.status === 'fulfilled') {
          shelves.set(category, result.value.data.map(s => this.withPendingFavorite(s)));
        } else {
          failures += 1;
          firstFailure ??= result.reason;
          const kept = this.shelfByCategory.get(category);
          if (kept) shelves.set(category, kept);
        }
      });
      if (failures > 0) console.warn('Load category shelves error:', firstFailure);
      this.shelfByCategory = shelves;
      this.shelvesErrorKind =
        categories.length > 0 && failures === categories.length
          ? failureKindOf(firstFailure)
          : null;
      this.isLoadingShelves = false;
      this.hasLoadedShelves = true;
    });
  }

  /** Load the last requested shelves again (pull-to-refresh, content language change). */
  async refreshCategoryShelves(): Promise<void> {
    if (this.shelfCategories.length === 0) return;
    await this.loadCategoryShelves(this.shelfCategories, { limit: this.shelfLimit });
  }

  /**
   * The content language changed (a new pick, or the UI language without
   * one): every list that was asked for is fetched again in the new
   * language. A list nobody asked for yet stays unasked.
   */
  contentLanguageChanged(): void {
    if (this.storiesRequested) void this.refresh();
    if (this.favoritesRequested) void this.loadFavorites();
    void this.refreshCategoryShelves();
  }

  // ============================================================================
  // Story Detail
  // ============================================================================

  /**
   * Load a story into currentStory. Only the answer for the story asked for
   * last is applied. Every answer fills the cache of the last
   * DETAIL_CACHE_SIZE stories.
   *
   * `showCached`: a story opened before becomes currentStory at once from
   * the cache and is refreshed in the background. Off by default: a caller
   * that keeps another version on screen until the new one arrived (the
   * language switch awaits this call) would lose it at once.
   *
   * isLoadingDetail is true only while no copy of the story is current.
   */
  async getStoryDetail(id: string, options?: { showCached?: boolean }): Promise<void> {
    this.detailRequestId = id;
    const session = this.session;
    const isCurrent = () => session === this.session && this.detailRequestId === id;
    const cached = options?.showCached ? this.cachedDetail(id) : null;
    runInAction(() => {
      this.storyDetailErrorStatus = null;
      this.detailErrorKind = null;
      if (cached) this.currentStory = this.withPendingFavorite(cached);
      this.isLoadingDetail = this.currentStory?.id !== id;
    });

    try {
      const story = await StoryService.getStoryById(id);
      // An answer for the account that left is not cached for the next one.
      if (session !== this.session) return;
      runInAction(() => {
        // A late answer is still the right data for its own story.
        const fresh = this.withPendingFavorite(story);
        this.rememberDetail(fresh);
        if (isCurrent()) this.currentStory = fresh;
      });
    } catch (error) {
      if (!isCurrent()) return;
      console.error('Get story detail error:', error);
      const status = isApiError(error) ? error.status : null;
      runInAction(() => {
        this.storyDetailErrorStatus = status;
        this.detailErrorKind = failureKindOf(error);
        // Gone (404) or locked for this plan (403): a cached copy must not
        // stay on screen. Any other failure keeps it.
        if (status === 403 || status === 404) {
          this.detailCache.delete(id);
          if (this.currentStory?.id === id) this.currentStory = null;
        }
      });
    } finally {
      if (isCurrent()) {
        runInAction(() => {
          this.isLoadingDetail = false;
        });
      }
    }
  }

  /**
   * The detail of a story opened recently, or null. Marks it as used, so
   * the stories opened most often stay cached.
   */
  cachedDetail(id: string): StoryDetail | null {
    const hit = this.detailCache.get(id);
    if (!hit) return null;
    this.detailCache.delete(id);
    this.detailCache.set(id, hit);
    return hit;
  }

  private rememberDetail(detail: StoryDetail): void {
    this.detailCache.delete(detail.id);
    this.detailCache.set(detail.id, detail);
    while (this.detailCache.size > DETAIL_CACHE_SIZE) {
      const oldest = this.detailCache.keys().next().value;
      if (oldest === undefined) break;
      this.detailCache.delete(oldest);
    }
  }

  /** A loaded copy carries the saved state the user asked for while a request runs. */
  private withPendingFavorite<T extends Story | StoryDetail>(story: T): T {
    const wanted = this.favoriteWanted.get(story.id);
    if (wanted === undefined || isStorySaved(story) === wanted) return story;
    return { ...story, isFavorite: wanted, isFavoriteAnyLanguage: wanted };
  }

  /**
   * Any copy of a story this app holds, without a request: the store's
   * lists, the Keşfet list, the home shelves, then the open or a cached
   * detail (list-shaped). Lets a screen draw a story before its detail
   * arrives.
   */
  peekStory(id: string): Story | null {
    const find = (list: readonly Story[]) => list.find(s => s.id === id);
    const listed =
      find(this.stories) ??
      find(this.favoriteStories) ??
      find(getDiscoverStore().items) ??
      this.findOnShelf(id);
    if (listed) return listed;
    const detail =
      this.currentStory?.id === id ? this.currentStory : (this.detailCache.get(id) ?? null);
    return detail ? toListStory(detail) : null;
  }

  // ============================================================================
  // Favorites
  // ============================================================================

  /**
   * Current favorite state for a story. A save or unsave in flight is the
   * user's latest wish; then the open detail screen is the most reliable
   * copy (it may not be in any paginated list), then the lists.
   */
  getFavoriteState(storyId: string): boolean {
    const wanted = this.favoriteWanted.get(storyId);
    if (wanted !== undefined) return wanted;
    if (this.currentStory?.id === storyId) {
      return isStorySaved(this.currentStory);
    }
    const fromList = this.stories.find(s => s.id === storyId) ?? this.findOnShelf(storyId);
    if (fromList) return isStorySaved(fromList);
    return this.favoriteStories.some(s => namesStory(s, storyId));
  }

  /** The story on one of the home shelves (a story can be on a shelf only). */
  private findOnShelf(storyId: string): Story | undefined {
    for (const shelf of this.shelfByCategory.values()) {
      const found = shelf.find(s => s.id === storyId);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * Every saved version of the tale a story belongs to, as far as the client
   * knows it: the story itself, the ids the grouped favourites list names,
   * and the other language versions of the open detail. Saving is per tale
   * in the design, so unsaving removes all of them.
   */
  private savedVersionIds(storyId: string): string[] {
    const ids = new Set<string>([storyId]);
    const saved = this.favoriteStories.find(s => namesStory(s, storyId));
    saved?.favoriteStoryIds?.forEach(id => ids.add(id));
    if (saved) ids.add(saved.id);
    const detail = this.currentStory;
    if (detail?.id === storyId && detail.isFavoriteAnyLanguage) {
      detail.translations.forEach(ref => ids.add(ref.id));
    }
    return [...ids];
  }

  /**
   * Write one favorite state into every in-memory copy of the story
   * (stories, shelves, currentStory, cached details,
   * favoriteStories) and record the change.
   */
  private applyFavoriteState(
    storyId: string,
    isFavorite: boolean,
    fallbackStory: Story | null,
  ): void {
    const patch = <T extends Story>(list: T[]): T[] =>
      list.some(s => s.id === storyId)
        ? list.map(s =>
            s.id === storyId ? { ...s, isFavorite, isFavoriteAnyLanguage: isFavorite } : s,
          )
        : list;

    this.stories = patch(this.stories);
    for (const [category, shelf] of this.shelfByCategory) {
      const patched = patch(shelf);
      if (patched !== shelf) this.shelfByCategory.set(category, patched);
    }
    if (this.currentStory?.id === storyId) {
      this.currentStory = { ...this.currentStory, isFavorite, isFavoriteAnyLanguage: isFavorite };
    }
    const cached = this.detailCache.get(storyId);
    if (cached) {
      // Patched in place: the entry keeps its place in the recency order.
      this.detailCache.set(storyId, { ...cached, isFavorite, isFavoriteAnyLanguage: isFavorite });
    }

    if (isFavorite) {
      if (!this.favoriteStories.some(s => namesStory(s, storyId))) {
        const source =
          this.stories.find(s => s.id === storyId) ?? fallbackStory;
        if (source) {
          this.setFavoriteRows([
            { ...source, isFavorite: true, isFavoriteAnyLanguage: true },
            ...this.favoriteStories,
          ]);
        }
      }
    } else {
      this.setFavoriteRows(this.favoriteStories.filter(s => !namesStory(s, storyId)));
    }

    const ref: TaleRef = {
      id: storyId,
      translationGroupId:
        fallbackStory?.translationGroupId ?? this.peekStory(storyId)?.translationGroupId ?? null,
    };
    this.recordFavoriteChange(ref, isFavorite);
  }

  /**
   * Replace the saved rows after a save, an unsave or an undo; the count
   * follows the rows added or removed (loadFavorites sets it from the server).
   */
  private setFavoriteRows(rows: Story[]): void {
    const delta = rows.length - this.favoriteStories.length;
    this.favoriteStories = rows;
    this.favoritesTotal = Math.max(0, this.favoritesTotal + delta);
  }

  /** A saved row whose unsave is still being sent. */
  private isPendingUnsave(entry: Story): boolean {
    if (this.favoriteWanted.get(entry.id) === false) return true;
    return entry.favoriteStoryIds?.some(id => this.favoriteWanted.get(id) === false) ?? false;
  }

  /**
   * Note a saved state that changed without going through this store's
   * copies (a row saved straight through StoryService), so lists that
   * follow favoriteChanges patch it too.
   */
  recordFavoriteChange(story: TaleRef, saved: boolean): void {
    this.favoritesVersion += 1;
    const change: FavoriteChange = {
      version: this.favoritesVersion,
      story: { id: story.id, translationGroupId: story.translationGroupId },
      saved,
    };
    this.favoriteChanges = [...this.favoriteChanges, change].slice(-FAVORITE_CHANGES_KEPT);
  }

  /**
   * Save or unsave a story, optimistic in every copy. Taps on the same story
   * are serialised: while a request runs, a new tap only records the wanted
   * state, which is sent once the request settled (and only when it differs
   * from what the server then has). The rollback (and the snackbar, unless
   * `quiet`) happens only when the last request failed.
   */
  toggleFavorite(storyId: string, options?: ToggleFavoriteOptions): Promise<FavoriteToggleResult> {
    const burst = this.beginFavorite(storyId, null);
    const wanted = !this.getFavoriteState(storyId);
    return this.commitFavorite(storyId, burst, wanted, options?.quiet ?? false);
  }

  /**
   * Undo an unsave from the saved list: put the row back at `index` (as it
   * was, even when the story is in no other list) and save again every
   * version the unsave removed.
   */
  restoreFavorite(story: Story, index: number): Promise<FavoriteToggleResult> {
    const burst = this.beginFavorite(story.id, story);
    burst.saveIds = story.favoriteStoryIds?.length ? [...story.favoriteStoryIds] : [story.id];
    runInAction(() => {
      const list = this.favoriteStories.filter(s => !namesStory(s, story.id));
      list.splice(Math.max(0, Math.min(index, list.length)), 0, {
        ...story,
        isFavoriteAnyLanguage: true,
      });
      this.setFavoriteRows(list);
    });
    return this.commitFavorite(story.id, burst, true, false);
  }

  /** The running burst of a story, or a new one that remembers the state before it. */
  private beginFavorite(storyId: string, fallback: Story | null): FavoriteBurst {
    const running = this.favoriteBursts.get(storyId);
    if (running) {
      if (fallback && !running.snapshot) running.snapshot = fallback;
      return running;
    }
    const savedIndex = this.favoriteStories.findIndex(s => namesStory(s, storyId));
    const burst: FavoriteBurst = {
      confirmed: this.getFavoriteState(storyId),
      tap: 0,
      quiet: false,
      saveIds: [storyId],
      removeIds: new Set(),
      snapshot: fallback ?? this.peekStory(storyId),
      savedEntry: savedIndex >= 0 ? this.favoriteStories[savedIndex] : null,
      savedIndex,
      run: null,
      session: this.session,
    };
    this.favoriteBursts.set(storyId, burst);
    return burst;
  }

  private async commitFavorite(
    storyId: string,
    burst: FavoriteBurst,
    wanted: boolean,
    quiet: boolean,
  ): Promise<FavoriteToggleResult> {
    burst.tap += 1;
    const tap = burst.tap;
    burst.quiet = quiet;
    // Collected before the optimistic update removes the saved entry.
    if (!wanted) this.savedVersionIds(storyId).forEach(id => burst.removeIds.add(id));
    this.favoriteWanted.set(storyId, wanted);
    runInAction(() => {
      this.applyFavoriteState(storyId, wanted, burst.snapshot);
    });

    if (!this.favoriteBusy.has(storyId)) {
      this.favoriteBusy.add(storyId);
      burst.run = this.runFavoriteBurst(storyId, burst);
    }
    const ok = await (burst.run as Promise<boolean>);
    // The account left meanwhile: nothing to report to it.
    if (burst.session !== this.session) return 'superseded';
    if (tap !== burst.tap) return 'superseded';
    return ok ? 'done' : 'failed';
  }

  /** Send the wanted state until the server has it; resolves false when the last request failed. */
  private async runFavoriteBurst(storyId: string, burst: FavoriteBurst): Promise<boolean> {
    let lastError: unknown = null;
    for (;;) {
      // The account left (reset): the maps belong to the next one now.
      if (burst.session !== this.session) return false;
      const wanted = this.favoriteWanted.get(storyId) ?? burst.confirmed;
      if (wanted === burst.confirmed) {
        lastError = null;
        break;
      }
      try {
        await this.sendFavorite(wanted, wanted ? burst.saveIds : [...burst.removeIds]);
        burst.confirmed = wanted;
        lastError = null;
      } catch (error) {
        lastError = error;
        // A later tap asking for the state the server still has ends the
        // burst without a rollback (the loop sees wanted === confirmed).
        if (this.favoriteWanted.get(storyId) === wanted) break;
      }
    }
    if (burst.session !== this.session) return false;

    this.favoriteBusy.delete(storyId);
    this.favoriteBursts.delete(storyId);
    this.favoriteWanted.delete(storyId);
    if (lastError === null) return true;

    console.error('Toggle favorite error:', lastError);
    runInAction(() => {
      this.rollbackFavorite(storyId, burst);
    });
    if (!burst.quiet) {
      showToast.error(getErrorMessage(lastError, msg('common.actionFailed')));
    }
    return false;
  }

  private async sendFavorite(saved: boolean, ids: readonly string[]): Promise<void> {
    if (saved) {
      await Promise.all(ids.map(id => StoryService.toggleFavorite(id, true)));
      return;
    }
    // Unsave every saved language version of the tale. A version that was
    // not saved answers 404, which is already the wanted state; any other
    // failure fails the request.
    await Promise.all(
      ids.map(id =>
        StoryService.toggleFavorite(id, false).catch(err => {
          if (isApiError(err) && err.status === 404) return undefined;
          throw err;
        }),
      ),
    );
  }

  /** Every copy back to the state the server has; a saved row returns to its old place. */
  private rollbackFavorite(storyId: string, burst: FavoriteBurst): void {
    const saved = burst.confirmed;
    if (saved && !this.favoriteStories.some(s => namesStory(s, storyId))) {
      const entry =
        burst.savedEntry ??
        (burst.snapshot ? { ...burst.snapshot, isFavorite: true, isFavoriteAnyLanguage: true } : null);
      if (entry) {
        const list = [...this.favoriteStories];
        const index = burst.savedIndex >= 0 ? Math.min(burst.savedIndex, list.length) : 0;
        list.splice(index, 0, entry);
        this.setFavoriteRows(list);
      }
    }
    this.applyFavoriteState(storyId, saved, burst.snapshot);
  }

  async loadFavorites(page = 1): Promise<void> {
    // Same generation guard as loadStories.
    if (page === 1) this.favoritesGeneration += 1;
    const generation = this.favoritesGeneration;
    const isCurrent = () => generation === this.favoritesGeneration;
    this.favoritesRequested = true;
    try {
      if (page === 1) {
        runInAction(() => {
          this.isLoadingFavorites = true;
          this.isLoadingMoreFavorites = false;
          this.favoritesError = false;
          this.favoritesErrorKind = null;
        });
      } else {
        runInAction(() => {
          this.isLoadingMoreFavorites = true;
        });
      }

      const favorites = await StoryService.getFavoriteStories({
        page,
        limit: 20,
        grouped: true,
        prefer: getContentLanguageStore().effective,
      });
      if (!isCurrent()) return;

      runInAction(() => {
        // A row whose unsave is still being sent stays out of the list.
        const rows = favorites.data.filter(s => !this.isPendingUnsave(s));
        if (page === 1) {
          this.favoriteStories = rows;
        } else {
          this.favoriteStories = [...this.favoriteStories, ...rows];
        }
        this.favoritesPage = favorites.meta.page;
        this.favoritesTotalPages = favorites.meta.totalPages;
        this.favoritesTotal = Math.max(
          0,
          favorites.meta.total - (favorites.data.length - rows.length),
        );
        this.hasMoreFavorites =
          favorites.meta.page < favorites.meta.totalPages;
      });
    } catch (error) {
      if (!isCurrent()) return;
      console.error('Load favorites error:', error);
      // A failed next page keeps the rows; the error state is for page 1.
      if (page === 1) {
        runInAction(() => {
          this.favoritesError = true;
          this.favoritesErrorKind = failureKindOf(error);
        });
      }
      // As in loadStories: with saved rows still on screen the error state is
      // not shown, so the snackbar says it.
      if (this.favoriteStories.length > 0) showToast.error(msg('story.savedFailed'));
    } finally {
      if (isCurrent()) {
        runInAction(() => {
          this.isLoadingFavorites = false;
          this.isLoadingMoreFavorites = false;
        });
      }
    }
  }

  async loadMoreFavorites(): Promise<void> {
    if (!this.hasMoreFavorites || this.isLoadingMoreFavorites) return;
    await this.loadFavorites(this.favoritesPage + 1);
  }

  // ============================================================================
  // Session end
  // ============================================================================

  /**
   * The account left (sign-out, session expiry) or another one signed in:
   * every list, saved mark, narration, shelf and cached detail goes, and
   * every request still in flight is dropped when it answers (each loader
   * checks its generation or the session). Saves still being sent finish
   * without a rollback or a message. `favoritesVersion` keeps counting, so a
   * list that remembers a version never mistakes a new change for an old one.
   */
  reset(): void {
    this.session += 1;
    this.narrationsGeneration += 1;
    this.storiesGeneration += 1;
    this.favoritesGeneration += 1;
    this.shelvesGeneration += 1;
    this.detailRequestId = '';
    this.detailCache.clear();
    this.favoriteWanted.clear();
    this.favoriteBusy.clear();
    this.favoriteBursts.clear();
    this.shelfCategories = [];
    this.shelfLimit = CATEGORY_SHELF_LIMIT;
    this.storiesRequested = false;
    this.favoritesRequested = false;

    this.stories = [];
    this.currentPage = 1;
    this.totalPages = 1;
    this.hasMore = true;
    this.isLoadingMore = false;
    this.errorMessage = '';
    this.listErrorKind = null;

    this.currentStory = null;
    this.isLoadingDetail = false;
    this.storyDetailErrorStatus = null;
    this.detailErrorKind = null;

    this.userNarrations = [];
    this.isLoadingNarrations = false;
    this.isLoadingMoreNarrations = false;
    this.narrationsPage = 1;
    this.narrationsTotalPages = 1;
    this.hasMoreNarrations = true;
    this.narrationsSearch = '';
    this.narrationsByStory = new Map();
    this.narrationsFailedFor = new Set();

    this.favoriteStories = [];
    this.favoritesPage = 1;
    this.favoritesTotalPages = 1;
    this.hasMoreFavorites = true;
    this.isLoadingMoreFavorites = false;
    this.isLoadingFavorites = false;
    this.favoritesError = false;
    this.favoritesErrorKind = null;
    this.favoritesTotal = 0;
    this.favoriteChanges = [];

    this.shelfByCategory = new Map();
    this.isLoadingShelves = false;
    this.hasLoadedShelves = false;
    this.shelvesErrorKind = null;
  }
}

// ============================================================================
// Hook Export (Singleton Pattern)
// ============================================================================

let storyStoreInstance: StoryStore | null = null;

/**
 * The store follows the session: it is emptied before the signed-in user is
 * cleared (session end handler) and when the session's user changes to
 * another account without one (the next account never sees this one's data).
 */
function bindStoryStoreToSession(store: StoryStore): void {
  registerSessionEndHandler(() => store.reset());
  let userId = getSessionUserId();
  onSessionUserChange(next => {
    const previous = userId;
    userId = next;
    if (previous !== null && next !== previous) store.reset();
  });
}

export function useStory(): StoryStore {
  const store = useMemo(() => {
    if (!storyStoreInstance) {
      const instance = new StoryStore();
      storyStoreInstance = instance;
      bindStoryStoreToSession(instance);
    }
    return storyStoreInstance;
  }, []);

  return store;
}

/** The store if a screen already created it (push handlers refresh it). */
export function getStoryStore(): StoryStore | null {
  return storyStoreInstance;
}

// Export for testing or direct access
export { StoryStore };
