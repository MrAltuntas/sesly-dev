/**
 * Discover store: the story list of the "Keşfet" tab (design v3, frames 3
 * and 3b) and of "Yeni eklenenler".
 *
 * Scope rule (backend "One story per list"):
 *   - by default the Dil filter holds the content language ("Masal dili",
 *     following the UI language without a pick): `language: [code]`, flat,
 *     so an English user starts on the English stories only;
 *   - one or more languages picked: `language: [...]`, flat, one row per
 *     story per language (the counter then says "sonuç", not "masal");
 *   - every language unpicked: `grouped: true`, one row per tale of the
 *     whole catalogue, shown in the content language where it exists.
 * Neither the default nor the whole catalogue is a filter: they are not
 * counted and have no chip of their own, and "clear" goes back to the
 * default. It follows the content language while the
 * user has not touched the Dil row (`languagePicks` null).
 *
 * A search term switches the list to `GET /stories/search` with the same
 * scope. That endpoint takes no age group and no sort key, so those two
 * are left out while a term is active.
 *
 * Saving is per tale: `toggleStorySaved` goes through StoryStore so the
 * other lists (home, library, detail) stay in sync, and the caller patches
 * its own rows with `patchSaved`.
 *
 * Grouped requests send `prefer` (the content language), so a reload right
 * after a "Masal dili" change never waits for the preference to be saved.
 */

function sameLanguages(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every(code => b.includes(code));
}

import { makeAutoObservable, observable, runInAction } from 'mobx';
import { useMemo } from 'react';
import StoryService, { StorySort } from '../services/StoryService';
import { FailureKind, classifyFailure, hasApiStatus } from '../services/ApiError';
import { PaginatedStories, Story, TaleRef, isStorySaved } from '../models/Story';
import { getConnectivityStore } from '../stores/ConnectivityStore';
import { getContentLanguageStore } from './useContentLanguage';
import type { StoryStore } from './useStory';

export const DISCOVER_PAGE_SIZE = 20;

/** Sort keys offered by the sort sheet; null is the default order ("Önerilen"). */
export const DISCOVER_SORTS: readonly (StorySort | null)[] = [
  null,
  'newest',
  'oldest',
  'title',
  'duration',
  'level',
];

/** Age groups the catalogue uses (backend enum `AgeGroup`), youngest first. */
export const DISCOVER_AGE_GROUPS: readonly string[] = [
  'ZERO_TO_THREE',
  'THREE_TO_SIX',
  'SIX_TO_TEN',
  'TEN_PLUS',
];

// ─────────────────────────────────────────────────────────────
// Saved state helpers
// ─────────────────────────────────────────────────────────────

/** Same story, or another language version of it when the tale key is known. */
function isSameTale(item: TaleRef, story: TaleRef): boolean {
  if (item.id === story.id) return true;
  return !!story.translationGroupId && item.translationGroupId === story.translationGroupId;
}

/**
 * Write a saved state into a list: the story itself and, when the tale key
 * is known, its other language versions.
 */
export function patchSaved<S extends Story>(
  list: readonly S[],
  story: TaleRef,
  saved: boolean,
): S[] {
  return list.map(item => {
    const sameStory = item.id === story.id;
    if (!isSameTale(item, story)) return item;
    return {
      ...item,
      // Unsaving removes every version; saving stores this version only.
      isFavorite: saved ? (sameStory ? true : item.isFavorite) : false,
      isFavoriteAnyLanguage: saved,
    };
  });
}

/**
 * Put back the saved flags `previous` had for the rows of one tale (a failed
 * save); every other row keeps what it has now.
 */
function restoreSavedFlags(
  items: readonly Story[],
  previous: readonly Story[],
  story: TaleRef,
): Story[] {
  const before = new Map(previous.map(item => [item.id, item]));
  return items.map(item => {
    const old = before.get(item.id);
    if (!old || !isSameTale(item, story)) return item;
    return {
      ...item,
      isFavorite: old.isFavorite,
      isFavoriteAnyLanguage: old.isFavoriteAnyLanguage,
    };
  });
}

/** True when StoryStore holds a copy of the story, so its toggle can be checked. */
function storeKnows(storyStore: StoryStore, storyId: string): boolean {
  const inList = (list: readonly Story[]) => list.some(s => s.id === storyId);
  // Screen tests hand in partial stores without shelves.
  const shelves = storyStore.shelfByCategory ? [...storyStore.shelfByCategory.values()] : [];
  return (
    storyStore.currentStory?.id === storyId ||
    inList(storyStore.stories) ||
    shelves.some(inList) ||
    storyStore.favoriteStories.some(
      s => s.id === storyId || (s.favoriteStoryIds?.includes(storyId) ?? false),
    )
  );
}

/**
 * Remove a tale that is saved through another language version than the row
 * (the row itself is not a favourite). The saved versions come from the
 * grouped favourites, else from the story detail.
 */
async function removeSavedVersions(story: Story, storyStore: StoryStore): Promise<void> {
  const ids = new Set<string>();
  storyStore.favoriteStories
    .filter(s => s.id === story.id || (s.favoriteStoryIds?.includes(story.id) ?? false))
    .forEach(s => {
      ids.add(s.id);
      s.favoriteStoryIds?.forEach(id => ids.add(id));
    });
  if (ids.size === 0) {
    const detail = await StoryService.getStoryById(story.id);
    detail.translations.forEach(ref => ids.add(ref.id));
  }
  ids.add(story.id);
  const results = await Promise.allSettled(
    [...ids].map(id => StoryService.toggleFavorite(id, false)),
  );
  // A version that was not saved answers 404, which is the wanted state.
  const failure = results.find(
    (result): result is PromiseRejectedResult =>
      result.status === 'rejected' && !hasApiStatus(result.reason, 404),
  );
  if (failure) throw failure.reason;
}

/**
 * What a bookmark tap ended in. `superseded`: a later tap on the same story
 * took over before this one settled; that tap reports the outcome, so the
 * caller says nothing.
 */
export type SaveOutcome = 'saved' | 'removed' | 'failed' | 'superseded';

/**
 * A saved state changed straight through StoryService: tell StoryStore, so
 * the lists that follow its favoriteChanges patch their rows too.
 */
function noteChange(storyStore: StoryStore, story: TaleRef, saved: boolean): void {
  // Screen tests hand in partial stores without it.
  storyStore.recordFavoriteChange?.(story, saved);
}

/**
 * Save or unsave the tale of a list row. Resolves with what happened; never
 * throws and never shows a message: the caller announces the outcome once
 * (StoryStore's own error snackbar is turned off for this path).
 */
export async function toggleStorySaved(
  story: Story,
  storyStore: StoryStore,
): Promise<SaveOutcome> {
  const wasSaved = isStorySaved(story);
  const next = !wasSaved;
  try {
    if (wasSaved && !story.isFavorite) {
      await removeSavedVersions(story, storyStore);
      noteChange(storyStore, story, false);
      void storyStore.loadFavorites();
      void storyStore.refresh();
    } else if (
      storeKnows(storyStore, story.id) &&
      storyStore.getFavoriteState(story.id) === wasSaved
    ) {
      // Optimistic in every copy the store holds; it rolls back by itself.
      // Taps on the same story are serialised there: the latest tap reports.
      const result = await storyStore.toggleFavorite(story.id, { quiet: true });
      if (result === 'superseded') return 'superseded';
      if (result === 'failed' || storyStore.getFavoriteState(story.id) !== next) return 'failed';
    } else {
      // The store has no copy (or a stale one): talk to the backend and let
      // the saved list catch up.
      await StoryService.toggleFavorite(story.id, next);
      noteChange(storyStore, story, next);
      void storyStore.loadFavorites();
    }
    return next ? 'saved' : 'removed';
  } catch (error) {
    console.warn('Toggle saved failed:', error);
    return 'failed';
  }
}

// ─────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────

class DiscoverStore {
  items: Story[] = [];
  /** Tales (grouped) or rows (flat) the backend counts for this scope. */
  total = 0;
  page = 1;
  hasMore = false;

  isLoading = false;
  isLoadingMore = false;
  /** True once a first page arrived or failed: tells loading from empty. */
  hasLoaded = false;
  hasError = false;
  /** Why the first page failed (offline, server, ...); null without an error. */
  listErrorKind: FailureKind | null = null;

  query = '';
  /** The languages the user picked in the Dil row; null: the default (the content language). */
  languagePicks: string[] | null = null;
  levels: string[] = [];
  ageGroup: string | null = null;
  /** Story category (BEDTIME, TURKISH_CLASSICS, ...); null for every category. */
  category: string | null = null;
  sort: StorySort | null = null;

  /** Bumped by every page-1 load; answers of an older scope are dropped. */
  private generation = 0;

  /**
   * Bookmark taps per story while a save runs (see toggleSaved): the wanted
   * state, the running request and the latest tap.
   */
  private saveWanted = new Map<string, boolean>();
  private saveRuns = new Map<string, Promise<SaveOutcome>>();
  private saveTaps = new Map<string, number>();

  constructor(initial?: { sort?: StorySort | null }) {
    if (initial?.sort) this.sort = initial.sort;
    makeAutoObservable<this, 'generation' | 'saveWanted' | 'saveRuns' | 'saveTaps'>(this, {
      generation: false,
      saveWanted: false,
      saveRuns: false,
      saveTaps: false,
      items: observable.ref,
    });
  }

  get searchTerm(): string {
    return this.query.trim();
  }

  get isSearching(): boolean {
    return this.searchTerm.length > 0;
  }

  /** The Dil row's default: the content language. */
  get defaultLanguages(): string[] {
    return [getContentLanguageStore().effective];
  }

  /** The languages the list is in: the picks, else the default. Empty: every language. */
  get languages(): string[] {
    return this.languagePicks ?? this.defaultLanguages;
  }

  /**
   * The Dil row narrows the list to languages of the user's choosing
   * (counted, with chips, cleared by "clear"). Neither the default (the
   * content language) nor every language unpicked (the whole catalogue) is
   * a filter.
   */
  get languageFilterActive(): boolean {
    const picks = this.languagePicks;
    return picks !== null && picks.length > 0 && !sameLanguages(picks, this.defaultLanguages);
  }

  /**
   * A search that stays in the default language could find the tale in
   * another one: the empty result offers every language.
   */
  get canWidenSearch(): boolean {
    return this.isSearching && this.languages.length > 0;
  }

  /** A language is picked: rows are stories, not tales. */
  get isFlat(): boolean {
    return this.languages.length > 0;
  }

  /**
   * A flat list of several languages: a tale can be on it more than once
   * (one row per language version). A list of one language holds each tale
   * once, like a grouped one.
   */
  get showsSeveralLanguages(): boolean {
    return this.languages.length > 1;
  }

  get hasFilters(): boolean {
    return (
      this.languageFilterActive ||
      this.levels.length > 0 ||
      (!this.isSearching && (this.ageGroup !== null || this.category !== null))
    );
  }

  private fetchPage(page: number): Promise<PaginatedStories> {
    // A flat list names its languages; a grouped one picks a version per
    // tale in the content language.
    const scope = this.isFlat
      ? { language: this.languages }
      : { grouped: true, prefer: getContentLanguageStore().effective };
    const languageLevel = this.levels.length > 0 ? this.levels : undefined;
    if (this.isSearching) {
      return StoryService.searchStories(this.searchTerm, {
        page,
        limit: DISCOVER_PAGE_SIZE,
        ...scope,
        languageLevel,
      });
    }
    return StoryService.getStories({
      page,
      limit: DISCOVER_PAGE_SIZE,
      ...scope,
      languageLevel,
      ageGroup: this.ageGroup ?? undefined,
      category: this.category ?? undefined,
      sort: this.sort ?? undefined,
    });
  }

  /** Load a page of the current scope. Page 1 replaces the list. */
  async load(page = 1): Promise<void> {
    if (page === 1) this.generation += 1;
    const generation = this.generation;
    const isCurrent = () => generation === this.generation;
    runInAction(() => {
      if (page === 1) {
        this.isLoading = true;
        this.isLoadingMore = false;
        this.hasError = false;
        this.listErrorKind = null;
      } else {
        this.isLoadingMore = true;
      }
    });
    try {
      const response = await this.fetchPage(page);
      if (!isCurrent()) return;
      runInAction(() => {
        this.items = page === 1 ? [...response.data] : [...this.items, ...response.data];
        this.total = response.meta.total;
        this.page = response.meta.page;
        this.hasMore = response.meta.page < response.meta.totalPages;
      });
    } catch (error) {
      if (!isCurrent()) return;
      console.warn('Discover load failed:', error);
      // A failed next page keeps the rows that are already on screen.
      if (page === 1) {
        runInAction(() => {
          this.items = [];
          this.total = 0;
          this.hasMore = false;
          this.hasError = true;
          this.listErrorKind = classifyFailure(error, getConnectivityStore());
        });
      }
    } finally {
      if (isCurrent()) {
        runInAction(() => {
          this.isLoading = false;
          this.isLoadingMore = false;
          this.hasLoaded = true;
        });
      }
    }
  }

  async loadMore(): Promise<void> {
    if (!this.hasMore || this.isLoading || this.isLoadingMore) return;
    await this.load(this.page + 1);
  }

  refresh(): Promise<void> {
    return this.load(1);
  }

  /**
   * Fetch the pages that are on screen again without a loading state (after
   * a save in a flat list, or when the tab comes back into view), so saved
   * marks follow changes made elsewhere.
   */
  async resync(): Promise<void> {
    if (!this.hasLoaded || this.isLoading || this.isLoadingMore || this.hasError) return;
    const generation = this.generation;
    const pages = this.page;
    try {
      const responses: PaginatedStories[] = [];
      for (let page = 1; page <= pages; page += 1) {
        responses.push(await this.fetchPage(page));
      }
      if (generation !== this.generation || responses.length === 0) return;
      const last = responses[responses.length - 1];
      runInAction(() => {
        this.items = responses.flatMap(response => [...response.data]);
        this.total = last.meta.total;
        this.page = last.meta.page;
        this.hasMore = last.meta.page < last.meta.totalPages;
      });
    } catch (error) {
      console.warn('Discover resync failed:', error);
    }
  }

  // ── Scope changes: each one reloads from page 1 ──

  setQuery(query: string): void {
    if (query.trim() === this.searchTerm) {
      this.query = query;
      return;
    }
    this.query = query;
    void this.load(1);
  }

  toggleLanguage(code: string): void {
    const current = this.languages;
    this.languagePicks = current.includes(code)
      ? current.filter(item => item !== code)
      : [...current, code];
    void this.load(1);
  }

  /** Every language (the empty result of a search in one language). */
  showAllLanguages(): void {
    if (this.languagePicks !== null && this.languagePicks.length === 0) return;
    this.languagePicks = [];
    void this.load(1);
  }

  /**
   * The content language changed: a list on the default languages follows
   * it, as does a grouped one (it picks its versions in that language).
   */
  contentLanguageChanged(): void {
    if (this.languagePicks === null || !this.isFlat) void this.load(1);
  }

  toggleLevel(level: string): void {
    this.levels = this.levels.includes(level)
      ? this.levels.filter(item => item !== level)
      : [...this.levels, level];
    void this.load(1);
  }

  setAgeGroup(ageGroup: string | null): void {
    if (ageGroup === this.ageGroup) return;
    this.ageGroup = ageGroup;
    void this.load(1);
  }

  /** One category or every category (null). The search endpoint takes none. */
  setCategory(category: string | null): void {
    if (category === this.category) return;
    this.category = category;
    void this.load(1);
  }

  setSort(sort: StorySort | null): void {
    if (sort === this.sort) return;
    this.sort = sort;
    void this.load(1);
  }

  /** Empty result state: drop the term and every filter. */
  clearFilters(): void {
    this.query = '';
    this.languagePicks = null;
    this.levels = [];
    this.ageGroup = null;
    this.category = null;
    void this.load(1);
  }

  /**
   * Open the list on one category (a home tile or a shelf's "Tümü"): the
   * term, the language picks (back to the default), the levels and the
   * age group picked earlier are dropped, so the category never opens filtered to nothing. One load;
   * none when that exact list is already on screen. The sort stays.
   */
  showCategory(category: string | null): void {
    const unchanged =
      this.query === '' &&
      this.languagePicks === null &&
      this.levels.length === 0 &&
      this.ageGroup === null &&
      this.category === category;
    this.query = '';
    this.languagePicks = null;
    this.levels = [];
    this.ageGroup = null;
    this.category = category;
    if (unchanged && this.hasLoaded && !this.hasError) return;
    void this.load(1);
  }

  // ── Saving ──

  /**
   * Save or unsave the tale of a row: optimistic in this list, rolled back
   * when the backend refuses. Taps on one row are serialised: while its
   * request runs, a new tap only flips the row and records the wanted state,
   * which is sent when the request settled (if the server does not have it
   * by then). The latest tap reports the outcome; earlier ones resolve
   * `superseded`.
   */
  async toggleSaved(story: Story, storyStore: StoryStore): Promise<SaveOutcome> {
    const row = this.items.find(item => item.id === story.id) ?? story;
    const wanted = !(this.saveWanted.get(story.id) ?? isStorySaved(row));
    const tap = (this.saveTaps.get(story.id) ?? 0) + 1;
    this.saveTaps.set(story.id, tap);
    this.saveWanted.set(story.id, wanted);
    // The rows as the server has them, before this burst of taps.
    const previous = this.items;
    runInAction(() => {
      this.items = patchSaved(this.items, story, wanted);
    });
    let run = this.saveRuns.get(story.id);
    if (!run) {
      run = this.runSave(row, previous, storyStore);
      this.saveRuns.set(story.id, run);
    }
    const outcome = await run;
    // Earlier taps of the burst resume first (same promise, earlier reactions).
    if (this.saveTaps.get(story.id) !== tap) return 'superseded';
    if (!this.saveRuns.has(story.id)) this.saveTaps.delete(story.id);
    return outcome;
  }

  private async runSave(
    original: Story,
    previous: readonly Story[],
    storyStore: StoryStore,
  ): Promise<SaveOutcome> {
    const id = original.id;
    // The row as the server has it; toggleStorySaved reads the flags from it.
    let server: Story = original;
    let outcome: SaveOutcome = isStorySaved(original) ? 'saved' : 'removed';
    let changed = false;
    for (;;) {
      const wanted = this.saveWanted.get(id) ?? isStorySaved(server);
      if (wanted === isStorySaved(server)) {
        outcome = wanted ? 'saved' : 'removed';
        break;
      }
      const result = await toggleStorySaved(server, storyStore);
      if (result === 'failed') {
        outcome = 'failed';
        // A later tap asking for the state the server still has ends the
        // run without a rollback.
        if (this.saveWanted.get(id) === wanted) break;
        continue;
      }
      changed = true;
      server = patchSaved([server], server, wanted)[0];
    }
    this.saveRuns.delete(id);
    this.saveWanted.delete(id);

    if (outcome === 'failed') {
      runInAction(() => {
        this.items = changed
          ? patchSaved(this.items, server, isStorySaved(server))
          : restoreSavedFlags(this.items, previous, original);
      });
    } else if (changed && this.showsSeveralLanguages && !original.translationGroupId) {
      // The other language rows of this tale cannot be told apart on the
      // client (no tale key), so the server says which rows are saved.
      void this.resync();
    }
    return outcome;
  }

  /**
   * Show a saved state learned elsewhere (the detail page that was just
   * left) without a fetch: the story's own row takes its flags, its other
   * language rows (same tale key) follow.
   */
  syncSaved(story: TaleRef & Pick<Story, 'isFavorite' | 'isFavoriteAnyLanguage'>): void {
    const saved = isStorySaved(story);
    let touched = false;
    const next = this.items.map(item => {
      let patched: Story;
      if (item.id === story.id) {
        patched = { ...item, isFavorite: story.isFavorite, isFavoriteAnyLanguage: saved };
      } else if (isSameTale(item, story)) {
        patched = { ...item, isFavorite: saved ? item.isFavorite : false, isFavoriteAnyLanguage: saved };
      } else {
        return item;
      }
      if (
        patched.isFavorite === item.isFavorite &&
        patched.isFavoriteAnyLanguage === item.isFavoriteAnyLanguage
      ) {
        return item;
      }
      touched = true;
      return patched;
    });
    if (touched) this.items = next;
  }

  reset(): void {
    this.generation += 1;
    this.items = [];
    this.total = 0;
    this.page = 1;
    this.hasMore = false;
    this.isLoading = false;
    this.isLoadingMore = false;
    this.hasLoaded = false;
    this.hasError = false;
    this.listErrorKind = null;
    this.query = '';
    this.languagePicks = null;
    this.levels = [];
    this.ageGroup = null;
    this.category = null;
    this.sort = null;
  }
}

// ─────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────

let instance: DiscoverStore | null = null;

export function getDiscoverStore(): DiscoverStore {
  if (!instance) instance = new DiscoverStore();
  return instance;
}

/** The Keşfet tab's store: filters survive switching tabs. */
export function useDiscover(): DiscoverStore {
  return useMemo(() => getDiscoverStore(), []);
}

export { DiscoverStore };
