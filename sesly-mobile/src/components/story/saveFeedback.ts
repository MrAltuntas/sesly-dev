/**
 * What the user is told after tapping a bookmark (design v3, frame 26):
 *
 *   saved    "Parmak Kız kaydedildi" with "Göster", which opens the
 *            Kaydedilenler segment of the Kütüphane tab;
 *   removed  "Parmak Kız kaydedilenlerden çıkarıldı" with "Geri al", which
 *            saves the tale again;
 *   failed   one error line ("Kaydedilemedi. Tekrar dene.").
 *
 * Every save path that reaches this helper runs quiet (StoryStore's own
 * error snackbar is off for it), so a failure is announced once.
 *
 *   announceSaveOutcome(outcome, story, wasSaved, openLibrary);
 *   announceSaveOutcome(outcome, story, wasSaved, openLibrary, () => storyStore.restoreFavorite(row, index));
 *
 * A list that patches its own rows passes its own undo (the saved list:
 * `restoreFavorite` at the row's index); without one the tale is saved again
 * through StoryStore (`resaveStory`). A DiscoverStore list (Keşfet, Yeni
 * eklenenler) takes the whole bookmark from `useListSaveToggle`, whose undo
 * saves the row again through the same list.
 *
 * A screen on the root stack (above Main) passes an `onShow` that pops back
 * to Main (`nav.popTo('Main', { screen: 'Library' })`); a tab screen
 * navigates to it.
 */

import { useCallback } from 'react';
import i18n from '../../i18n';
import { showToast } from '../../utils/toast';
import StoryService from '../../services/StoryService';
import type { DiscoverStore, SaveOutcome } from '../../hooks/useDiscover';
import { getStoryStore, type FavoriteToggleResult, type StoryStore } from '../../hooks/useStory';
import { type Story, isStorySaved } from '../../models/Story';
import { requestLibrarySegment } from '../library/librarySegment';

/** The story a bookmark tap was about: its id for the undo, its title for the copy. */
export type SaveFeedbackStory = Pick<Story, 'id' | 'title'> & Partial<Pick<Story, 'translationGroupId'>>;

/**
 * Saves the tale again after "Geri al". Resolves with what happened; only a
 * failure is announced (the bookmark filling again is the answer otherwise).
 */
export type SaveUndo = () => Promise<SaveOutcome | FavoriteToggleResult | void>;

export function announceSaveOutcome(
  outcome: SaveOutcome,
  story: SaveFeedbackStory,
  wasSaved: boolean,
  onShow: () => void,
  undo?: SaveUndo,
): void {
  if (outcome === 'saved') {
    showToast.success(i18n.t('discover:save.saved', { title: story.title }), undefined, {
      label: i18n.t('discover:save.show'),
      onPress: () => {
        // Land on Kaydedilenler, not on the narrations list.
        requestLibrarySegment('saved');
        onShow();
      },
    });
  } else if (outcome === 'removed') {
    showToast.info(i18n.t('discover:save.removed', { title: story.title }), undefined, {
      label: i18n.t('common:undo'),
      onPress: () => void runUndo(undo ?? (() => resaveStory(story))),
    });
  } else if (outcome === 'failed') {
    showToast.error(i18n.t(wasSaved ? 'discover:save.removeFailed' : 'discover:save.failed'));
  }
}

async function runUndo(undo: SaveUndo): Promise<void> {
  let result: SaveOutcome | FavoriteToggleResult | void;
  try {
    result = await undo();
  } catch (error) {
    console.warn('Undoing the unsave failed:', error);
    result = 'failed';
  }
  if (result === 'failed') showToast.error(i18n.t('discover:save.failed'));
}

/**
 * Save a tale again through StoryStore, so every list that holds it (and
 * every list that follows its favoriteChanges) shows the bookmark filled.
 * Nothing is sent when the tale is saved again already (a second tap).
 */
export async function resaveStory(story: SaveFeedbackStory): Promise<SaveOutcome> {
  try {
    const storyStore = getStoryStore();
    if (!storyStore) {
      await StoryService.toggleFavorite(story.id, true);
      return 'saved';
    }
    if (storyStore.getFavoriteState(story.id)) return 'saved';
    const known = storyStore.peekStory(story.id) !== null;
    const result = await storyStore.toggleFavorite(story.id, { quiet: true });
    if (result === 'failed') return 'failed';
    if (result === 'superseded') return 'superseded';
    // A tale the store had no copy of joins the saved list from the server.
    if (!known) void storyStore.loadFavorites();
    return 'saved';
  } catch (error) {
    console.warn('Saving again failed:', error);
    return 'failed';
  }
}

/**
 * The bookmark of a list that keeps its own rows (Keşfet, Yeni eklenenler):
 * a stable `(story) => void` for `StoryCard.onToggleSave`. The row flips at
 * once (DiscoverStore.toggleSaved), the outcome is announced, and "Geri al"
 * saves the row again through the same list.
 */
export function useListSaveToggle(
  store: DiscoverStore,
  storyStore: StoryStore,
  onShow: () => void,
): (story: Story) => void {
  return useCallback(
    (story: Story) => {
      const wasSaved = isStorySaved(story);
      void store.toggleSaved(story, storyStore).then(outcome =>
        announceSaveOutcome(outcome, story, wasSaved, onShow, () => resaveRow(store, story, storyStore)),
      );
    },
    [store, storyStore, onShow],
  );
}

/** Save a list row again (the undo of an unsave), unless it is saved already. */
export function resaveRow(
  store: DiscoverStore,
  story: Story,
  storyStore: StoryStore,
): Promise<SaveOutcome> {
  const row = store.items.find(item => item.id === story.id);
  if (row && isStorySaved(row)) return Promise.resolve('saved');
  // A row the list no longer shows (another scope) is saved from its copy.
  return store.toggleSaved(row ?? { ...story, isFavorite: false, isFavoriteAnyLanguage: false }, storyStore);
}
