/**
 * useSavedMarksOnFocus: a story grid that was out of view (a story page
 * pushed over it, another tab) shows the saves and unsaves made meanwhile
 * as soon as it is back, without a request (perf-15, ui-8, ui-24).
 *
 * StoryStore records every saved-state change (`favoriteChanges`, the last
 * FAVORITE_CHANGES_KEPT, numbered by `favoritesVersion`): the story detail
 * heart, the saved list, another grid. On blur the hook notes the version;
 * on refocus it writes the newer changes into the list's rows
 * (`DiscoverStore.syncSaved`: the story's row and its other language rows,
 * known by the tale key or, without one, from the versions the story page
 * listed). Nothing changed: nothing happens. A fetch happens only when the
 * rows cannot be matched on the client:
 *   - more changes than are kept were made (the oldest ones are gone);
 *   - a flat list (one row per language) and a changed story without a tale
 *     key and without a story page naming its versions.
 *
 * The version seen last is kept per store across a remount, so a tab that
 * was unmounted with its list (the Keşfet store is a singleton) catches up
 * on its next mount too.
 */

import { useEffect, useRef } from 'react';
import type { DiscoverStore } from '../../hooks/useDiscover';
import type { StoryStore } from '../../hooks/useStory';

/** The favourites version each list store last showed. */
const seenVersions = new WeakMap<DiscoverStore, number>();

/** The change log of a store, or nothing when it keeps none (partial test stores). */
function versionOf(storyStore: StoryStore): number | null {
  return typeof storyStore.favoritesVersion === 'number' ? storyStore.favoritesVersion : null;
}

/**
 * Write the changes made after `since` into the list's rows. Returns what it
 * did: 'none' (nothing new), 'patched' (rows written, no request) or
 * 'resync' (the pages on screen are fetched again).
 */
export function catchUpSavedMarks(
  store: DiscoverStore,
  storyStore: StoryStore,
  since: number,
): 'none' | 'patched' | 'resync' {
  const version = versionOf(storyStore);
  if (version === null || version <= since || !store.hasLoaded) return 'none';
  const changes = (storyStore.favoriteChanges ?? []).filter(change => change.version > since);
  // The change right after `since` is no longer kept: the rows cannot be
  // brought up to date from the log.
  if (changes.length === 0 || changes[0].version > since + 1) {
    void store.resync();
    return 'resync';
  }
  let unmatched = false;
  changes.forEach(change => {
    store.syncSaved({
      id: change.story.id,
      translationGroupId: change.story.translationGroupId,
      isFavorite: change.saved,
      isFavoriteAnyLanguage: change.saved,
    });
    if (change.story.translationGroupId) return;
    // No tale key (the API does not send it yet): the story page that made
    // the change names the other language versions.
    const versions = otherVersionIds(storyStore, change.story.id);
    if (!versions) {
      unmatched = true;
      return;
    }
    versions.forEach(id => {
      const row = store.items.find(item => item.id === id);
      if (!row) return;
      // A save is per tale (this version stays as it is); an unsave removes
      // every version.
      store.syncSaved({
        id,
        translationGroupId: null,
        isFavorite: change.saved ? row.isFavorite : false,
        isFavoriteAnyLanguage: change.saved,
      });
    });
  });
  if (store.showsSeveralLanguages && unmatched) {
    void store.resync();
    return 'resync';
  }
  return 'patched';
}

/**
 * The other language versions of a story, from the story page the app holds
 * of it (the open one, else a cached one); null when it holds none.
 */
function otherVersionIds(storyStore: StoryStore, storyId: string): string[] | null {
  const detail =
    storyStore.currentStory?.id === storyId
      ? storyStore.currentStory
      : (storyStore.cachedDetail?.(storyId) ?? null);
  if (!detail) return null;
  return (detail.translations ?? []).map(ref => ref.id).filter(id => id !== storyId);
}

export function useSavedMarksOnFocus(
  store: DiscoverStore,
  storyStore: StoryStore,
  focused: boolean,
): void {
  const wasFocused = useRef(focused);
  // A list kept from an earlier mount catches up with what happened since.
  useEffect(() => {
    const seen = seenVersions.get(store);
    if (seen !== undefined && focused) catchUpSavedMarks(store, storyStore, seen);
    return () => {
      // Unmounted while out of view: the blur noted what the rows show, and
      // the changes made since must still reach them on the next mount.
      if (!wasFocused.current) return;
      const version = versionOf(storyStore);
      if (version !== null) seenVersions.set(store, version);
    };
    // Mount and unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const version = versionOf(storyStore);
    if (!focused) {
      if (wasFocused.current && version !== null) seenVersions.set(store, version);
    } else if (!wasFocused.current) {
      const seen = seenVersions.get(store);
      if (seen !== undefined) catchUpSavedMarks(store, storyStore, seen);
    }
    wasFocused.current = focused;
  }, [focused, store, storyStore]);
}
