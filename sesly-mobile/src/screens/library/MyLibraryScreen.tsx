/**
 * MyLibraryScreen: the "Kütüphane" tab (design/v4/playful; no frame of its
 * own, restyled in the system of the Sesim frame).
 *
 *   - App bar: the Baloo 2 tab title, the queue button ("Sıradakiler", with
 *     the number of queued stories) and TopBarAccount (bell and avatar, which
 *     opens Profile). Three actions, so "Kütüphane" fits a 360dp phone in
 *     both languages; the search is the list's own (the count row).
 *   - Two segments in a SegmentedControl. "Masallarım": the user's
 *     narrations from `GET /narrations` (paged, searchable, pull to
 *     refresh), each row with its narrator, the time left where the device
 *     knows a playback position, and the progress while it is still
 *     generating (live through the `narration_status` socket, with a status
 *     poll while the tab is on screen). Above them "Kaldığın yerden devam
 *     et" (the last story of this account with a resumable position) and the
 *     count row with the search button and "Hepsini çal". The open search
 *     is the field with "Vazgeç" beside it (which closes it); a search that
 *     found nothing says so at the top of the list, above the keyboard.
 *     "Kaydedilenler": the saved tales, one row per tale, from the story
 *     store; unsaving offers "Geri al".
 *   - Rows play in place (the round button); the body opens the player, or
 *     the generation screen while the narration is prepared. Beside play a
 *     ready row has "Sıraya ekle" (the queue glyph, a toggle) and "more",
 *     which opens the row's menu (the story's page, delete). No long press:
 *     every action is a visible control (owner feedback).
 *   - A refocus within 30 s of the last load makes no request (positions
 *     are read again, one storage read); a refresh keeps the pages already
 *     loaded instead of going back to the first one.
 *   - Loading draws the header slot and the rows in their own shape, so
 *     nothing moves when the list lands; the first real content fades in.
 *   - The mockup's third segment, "İndirilenler", is not built: offline
 *     download does not exist in the app or the backend.
 *
 * Another screen can ask for the saved segment with `requestLibrarySegment`
 * (components/library/librarySegment.ts) before navigating here.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { observer } from 'mobx-react-lite';
import { reaction } from 'mobx';
import { useFocusEffect, useNavigation, useScrollToTop } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import {
  Bone,
  Button,
  FadeIn,
  IconButton,
  RowSkeleton,
  SearchField,
  SegmentedControl,
  SkeletonPulse,
  Spinner,
  StateView,
  TopAppBar,
  useCoverSpread,
} from '../../components/design';
import { RADIUS, SPACE, Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { useStory } from '../../hooks/useStory';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { useDialog } from '../../hooks/useDialog';
import { forgetLastListened, useLastListened } from '../../hooks/useLastListened';
import NarrationService from '../../services/NarrationService';
import WebSocketService from '../../services/WebSocketService';
import { classifyFailure, hasApiStatus, type FailureKind } from '../../services/ApiError';
import { getConnectivityStore } from '../../stores/ConnectivityStore';
import { metaFromNarration, rememberNarrationMeta } from '../../stores/narrationMeta';
import { QUEUE_MAX, queueStore } from '../../stores/QueueStore';
import { playQueueFrom } from '../../stores/queuePlayback';
import { queueSheet } from '../../stores/queueSheet';
import { StoryNarration, isNarrationReady } from '../../models/Narration';
import { Story } from '../../models/Story';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { showToast } from '../../utils/toast';
import { TopBarAccount } from '../../components/common/TopBarAccount';
import { useMiniPlayerInset } from '../../components/audio/useMiniPlayerInset';
import { StoryOptionsSheet, type StoryOption } from '../../components/detail/StoryOptionsSheet';
import { announceSaveOutcome } from '../../components/story/saveFeedback';
import type { SaveOutcome } from '../../hooks/useDiscover';
import {
  LIBRARY_COVER_RADIUS,
  LIBRARY_COVER_WIDTH,
  LIBRARY_ROW_HEIGHT,
  NarrationRow,
} from '../../components/library/NarrationRow';
import {
  LIBRARY_CARD_GAP,
  LIBRARY_CARD_LIP,
  LIBRARY_CARD_RADIUS,
} from '../../components/library/LibraryRowCard';
import { SavedStoryRow } from '../../components/library/SavedStoryRow';
import { LibraryEmptyState } from '../../components/library/LibraryEmptyState';
import { ContinueListeningCard } from '../../components/library/ContinueListeningCard';
import {
  LibrarySegment,
  consumeLibrarySegmentRequest,
  subscribeLibrarySegment,
} from '../../components/library/librarySegment';
import {
  isPendingNarration,
  isVisibleNarration,
  sortNarrations,
  withGenerationProgress,
} from '../../components/library/narrationProgress';
import { readSavedPositions, removeSavedPosition } from '../../components/library/savedPositions';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;
/** A refresh asks for at most this many pages at once (the backend caps `limit` at 100). */
export const MAX_REFRESH_PAGES = 5;
/** A refocus this soon after the last load makes no request. */
export const FOCUS_REFRESH_SKIP_MS = 30000;
/** Status poll of narrations being prepared, while the tab is on screen. */
export const NARRATION_POLL_MS = 5000;
/** Height of the count row, and of its slot in the skeleton (dp). */
export const LIBRARY_COUNT_ROW_HEIGHT = 40;
/** Rows of the loading skeleton. */
const SKELETON_ROWS = 5;

type LoadMode = 'initial' | 'refresh' | 'append';

/**
 * A list row that mounts with the first real content fades in; a row that
 * mounts later (the next page, a row scrolled back into the window) is drawn
 * as it is, without a fade wrapper of its own. Decided once, at mount, so a
 * row never changes its tree.
 */
const RowFade: React.FC<{ skip: boolean; children: React.ReactNode }> = ({ skip, children }) => {
  const [fade] = useState(!skip);
  return fade ? <FadeIn>{children}</FadeIn> : <>{children}</>;
};

/** The same narrations with the same positions. */
function samePositions(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => b[key] === a[key]);
}

/** What the store's generation fields say; a change means the list may have a new row. */
function generationKey(audio: { generatingNarrationId: string | null; generationReadyId: string | null }) {
  return `${audio.generatingNarrationId ?? ''}|${audio.generationReadyId ?? ''}`;
}

export const MyLibraryScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const storyStore = useStory();
  const audio = useAudioPlayer();
  const { showDialog } = useDialog();
  const T = useT();
  const { t } = useTranslation('library');
  const styles = stylesFor(T);
  const text = textStylesFor(T);
  const miniPlayerInset = useMiniPlayerInset();
  const lastListened = useLastListened();

  const [segment, setSegment] = useState<LibrarySegment>(
    () => consumeLibrarySegmentRequest() ?? 'mine',
  );

  // ─── Masallarım: narrations ───
  const [narrations, setNarrations] = useState<StoryNarration[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMorePages, setHasMorePages] = useState(false);
  // Playback positions the player saved on this device, by narration id.
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Why the last load failed; null after a load that worked.
  const [errorKind, setErrorKind] = useState<FailureKind | null>(null);
  // True once a narrations request has completed (an empty list is then real).
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchVal, setSearchVal] = useState('');
  // The term the list on screen was loaded with (empty state wording).
  const [appliedSearch, setAppliedSearch] = useState('');
  // The row whose menu is open (kept through the sheet's exit).
  const [menuNarration, setMenuNarration] = useState<StoryNarration | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const afterMenuRef = useRef<(() => void) | null>(null);

  // loadNarrations reads paging and search through refs so its identity never
  // changes: the focus effect depends on it, and a changing identity re-ran
  // that effect after every page or keystroke (list reset to page 1).
  const pageRef = useRef(1);
  const totalPagesRef = useRef(1);
  const searchRef = useRef('');
  searchRef.current = searchVal;
  const narrationsRef = useRef<StoryNarration[]>([]);
  narrationsRef.current = narrations;
  const loadingMoreRef = useRef(false);
  // Latest request wins: a slower older response (previous search term, or an
  // append overtaken by a refresh) is dropped.
  const requestSeqRef = useRef(0);
  // The first-pages load (initial or refresh) still running, if any.
  const listLoadSeqRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const focusedRef = useRef(false);
  const loadedOnceRef = useRef(false);
  // When the list was last loaded, and what the generation fields said then.
  const lastLoadedAtRef = useRef(0);
  const loadedGenerationRef = useRef('');
  // A narration changed while the tab was away (socket event, delete): the
  // next focus refreshes whatever the clock says.
  const dirtyRef = useRef(false);
  // Closing the search reloads at once; the debounce must not reload again.
  const skipNextDebounceRef = useRef(false);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const loadPositions = useCallback(async (items: readonly StoryNarration[], replace: boolean) => {
    const ids = items.filter(isNarrationReady).map(item => item.id);
    const next = await readSavedPositions(ids);
    if (!mountedRef.current) return;
    // A read that changed nothing (a start or a pause of a story that saved
    // no new position) keeps the object, so the list does not re-render.
    setPositions(prev => {
      const merged = replace ? next : { ...prev, ...next };
      return samePositions(prev, merged) ? prev : merged;
    });
  }, []);

  const loadNarrations = useCallback(
    async (mode: LoadMode = 'initial', currentSearch: string = searchRef.current) => {
      if (mode === 'append') {
        // While the first pages load again (a search term, a refresh) the
        // paging on screen is about to change: a next page now would be
        // counted from the old one and dropped anyway.
        if (
          loadingMoreRef.current ||
          listLoadSeqRef.current !== null ||
          pageRef.current >= totalPagesRef.current
        ) {
          return;
        }
        loadingMoreRef.current = true;
      }
      const seq = ++requestSeqRef.current;
      if (mode !== 'append') listLoadSeqRef.current = seq;
      // A refresh keeps what is on screen: the pages loaded so far, in one request.
      const pagesShown = Math.min(Math.max(pageRef.current, 1), MAX_REFRESH_PAGES);
      const request =
        mode === 'append'
          ? { page: pageRef.current + 1, limit: PAGE_SIZE }
          : { page: 1, limit: mode === 'refresh' ? pagesShown * PAGE_SIZE : PAGE_SIZE };
      if (mode === 'initial') setIsLoading(true);
      else if (mode === 'append') setIsLoadingMore(true);
      try {
        const paginated = await NarrationService.getMyNarrations({
          ...request,
          search: currentSearch,
        });
        if (seq !== requestSeqRef.current) return;
        const data = paginated.data;
        setNarrations(prev => {
          if (mode !== 'append') return [...data];
          const known = new Set(prev.map(item => item.id));
          return [...prev, ...data.filter(item => !known.has(item.id))];
        });
        setTotal(paginated.meta.total);
        setAppliedSearch(currentSearch.trim());
        setErrorKind(null);
        if (mode === 'refresh' && request.limit > PAGE_SIZE) {
          // The meta pages are counted with the larger limit.
          pageRef.current = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
          totalPagesRef.current = Math.max(1, Math.ceil(paginated.meta.total / PAGE_SIZE));
        } else {
          pageRef.current = paginated.meta.page;
          totalPagesRef.current = paginated.meta.totalPages;
        }
        setHasMorePages(pageRef.current < totalPagesRef.current);
        if (mode !== 'append') {
          lastLoadedAtRef.current = Date.now();
          loadedGenerationRef.current = generationKey(audio);
          dirtyRef.current = false;
        }
        // The player, the queue and the continue card start these without a
        // request.
        data.filter(isNarrationReady).forEach(item => rememberNarrationMeta(metaFromNarration(item)));
        void loadPositions(data, mode !== 'append');
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        console.error('[MyLibrary] narrations load failed', err);
        setErrorKind(classifyFailure(err, getConnectivityStore()));
        throw err;
      } finally {
        // Only the latest request ends the loading state: a stale response
        // never uncovers an old result while the newer one is in flight.
        if (seq === requestSeqRef.current) {
          loadedOnceRef.current = true;
          setLoadedOnce(true);
          setIsLoading(false);
        }
        if (listLoadSeqRef.current === seq) listLoadSeqRef.current = null;
        if (mode === 'append') {
          loadingMoreRef.current = false;
          setIsLoadingMore(false);
        }
      }
    },
    [audio, loadPositions],
  );

  /** A load nobody waits on: its failure is the error state (or the rows stay). */
  const load = useCallback(
    (mode: LoadMode, currentSearch?: string) => {
      loadNarrations(mode, currentSearch).catch(() => undefined);
    },
    [loadNarrations],
  );

  // ─── Kaydedilenler: saved tales (story store, grouped) ───
  const [savedLoaded, setSavedLoaded] = useState(false);
  const loadSaved = useCallback(async () => {
    await storyStore.loadFavorites();
    if (mountedRef.current) setSavedLoaded(true);
  }, [storyStore]);

  useEffect(() => {
    if (storyStore.favoriteStories.length === 0) void loadSaved();
    else setSavedLoaded(true);
    // Mount only: the store is a singleton.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A request made while the tab is mounted applies at once.
  useEffect(() => subscribeLibrarySegment(setSegment), []);

  // Fires once per focus (loadNarrations is stable): a segment request made
  // before the tab was mounted, then the list. A refocus soon after a load
  // keeps the list and only reads the positions again.
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      const requested = consumeLibrarySegmentRequest();
      if (requested) setSegment(requested);
      const recent = Date.now() - lastLoadedAtRef.current < FOCUS_REFRESH_SKIP_MS;
      const unchanged = !dirtyRef.current && loadedGenerationRef.current === generationKey(audio);
      const preparing = narrationsRef.current.some(isPendingNarration);
      if (loadedOnceRef.current && recent && unchanged && !preparing) {
        void loadPositions(narrationsRef.current, true);
      } else {
        load('refresh', searchRef.current);
      }
      // While on screen, a story that starts, pauses or changes saves its
      // position: the rows read it again (one storage read).
      const disposePositions = reaction(
        () => [audio.audioId, audio.isPlaying],
        () => {
          void Promise.resolve().then(() => loadPositions(narrationsRef.current, false));
        },
      );
      return () => {
        focusedRef.current = false;
        disposePositions();
      };
    }, [audio, load, loadPositions]),
  );

  // A narration became READY or FAILED (or one this list does not show yet
  // appeared): refresh in place while on screen, else on the next focus.
  useEffect(
    () =>
      WebSocketService.addNarrationStatusListener(event => {
        const known = narrationsRef.current.some(item => item.id === event.narrationId);
        const settled = event.status === 'READY' || event.status === 'FAILED';
        if (known && !settled) {
          if (typeof event.progress === 'number') {
            const progress = event.progress;
            setNarrations(prev =>
              prev.map(item =>
                item.id === event.narrationId ? withGenerationProgress(item, progress, event.status) : item,
              ),
            );
          }
          return;
        }
        dirtyRef.current = true;
        if (focusedRef.current) load('refresh');
      }),
    [load],
  );

  // The socket says only READY and FAILED: the percentage of a narration
  // being prepared comes from a status poll, while the tab is on screen.
  const preparingKey = narrations
    .filter(isPendingNarration)
    .map(item => item.id)
    .join(',');
  useFocusEffect(
    useCallback(() => {
      if (!preparingKey) return undefined;
      const ids = preparingKey.split(',');
      let polling = false;
      const timer = setInterval(() => {
        if (polling) return;
        polling = true;
        void Promise.allSettled(ids.map(id => NarrationService.getNarrationStatus(id))).then(results => {
          polling = false;
          if (!mountedRef.current) return;
          let settled = false;
          const updates = new Map<string, { progress: number; status: string }>();
          results.forEach((result, index) => {
            if (result.status !== 'fulfilled') return;
            const status = result.value.status.toUpperCase();
            if (status === 'READY' || status === 'FAILED') settled = true;
            else updates.set(ids[index], { progress: result.value.progress, status });
          });
          if (updates.size > 0) {
            setNarrations(prev => {
              let changed = false;
              const next = prev.map(item => {
                const update = updates.get(item.id);
                if (!update) return item;
                const patched = withGenerationProgress(item, update.progress, update.status);
                if (patched !== item) changed = true;
                return patched;
              });
              return changed ? next : prev;
            });
          }
          if (settled) load('refresh');
        });
      }, NARRATION_POLL_MS);
      return () => clearInterval(timer);
    }, [preparingKey, load]),
  );

  // Debounced search. Skips the mount run (the focus effect already loads
  // the first page) and the run after closing the search (it reloaded).
  const skipFirstSearchRun = useRef(true);
  useEffect(() => {
    if (skipFirstSearchRun.current) {
      skipFirstSearchRun.current = false;
      return;
    }
    if (skipNextDebounceRef.current) {
      skipNextDebounceRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      load('initial', searchVal);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchVal, load]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    if (searchRef.current) {
      // The full list comes back at once, not after the debounce.
      skipNextDebounceRef.current = true;
      setSearchVal('');
      load('initial', '');
    }
  }, [load]);

  // The search belongs to Masallarım: leaving the segment closes it, so
  // coming back neither shows a filtered list nor opens the keyboard.
  useEffect(() => {
    if (segment !== 'mine') closeSearch();
    // Only on a segment change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    if (segment === 'saved') {
      await loadSaved();
    } else {
      try {
        await loadNarrations('refresh', searchRef.current);
      } catch (err) {
        // The rows stay; the pull asked for something, so it says so.
        if (narrationsRef.current.length > 0) {
          const offline = classifyFailure(err, getConnectivityStore()) === 'offline';
          showToast.error(offline ? t('states:offline.title') : t('error.refreshFailed'));
        }
      }
    }
    if (mountedRef.current) setIsRefreshing(false);
  }, [segment, loadSaved, loadNarrations, t]);

  const openSearch = () => setSearchOpen(true);

  const openNarration = useCallback(
    (narration: StoryNarration) => {
      if (isPendingNarration(narration)) {
        // The generation screen follows the running job (no new request).
        const storyId = narration.storyId || narration.story?.id;
        const voiceProfileId = narration.voiceProfileId || narration.voiceProfile?.id;
        if (storyId && voiceProfileId) nav.navigate('AudioGeneration', { storyId, voiceProfileId });
        return;
      }
      if (!isNarrationReady(narration)) return;
      // Known meta: the player opens at once and loads it paused.
      rememberNarrationMeta(metaFromNarration(narration));
      nav.navigate('AudioPlayer', { narrationId: narration.id });
    },
    [nav],
  );
  const openStory = useCallback(
    (story: Story) => nav.navigate('StoryDetail', { storyId: story.id }),
    [nav],
  );
  const unsave = useCallback(
    (story: Story) => {
      // "Geri al" puts the row back where it was (even when the tale is in
      // no other list) and saves every version the unsave removed.
      const index = storyStore.favoriteStories.findIndex(item => item.id === story.id);
      void storyStore.toggleFavorite(story.id, { quiet: true }).then(result => {
        const outcome: SaveOutcome =
          result === 'failed' ? 'failed' : result === 'superseded' ? 'superseded' : 'removed';
        announceSaveOutcome(outcome, story, true, () => undefined, () =>
          storyStore.restoreFavorite(story, Math.max(0, index)),
        );
      });
    },
    [storyStore],
  );
  const browse = useCallback(() => nav.navigate('Main', { screen: 'Discover' }), [nav]);

  // ─── Row menu ("more"): the story's page, delete ───
  const openMenu = useCallback((narration: StoryNarration) => {
    afterMenuRef.current = null;
    setMenuNarration(narration);
    setMenuVisible(true);
  }, []);
  const closeMenu = useCallback(() => setMenuVisible(false), []);
  const runAfterMenu = useCallback(() => {
    const action = afterMenuRef.current;
    afterMenuRef.current = null;
    action?.();
  }, []);
  /** Close the menu, then run `action` once the sheet has left. */
  const afterMenu = (action: () => void) => {
    afterMenuRef.current = action;
    setMenuVisible(false);
  };

  const deleteNarration = useCallback(
    async (narration: StoryNarration) => {
      try {
        await NarrationService.deleteNarration(narration.id);
      } catch (error) {
        // 404: already gone (deleted on another device, or replaced by a
        // regenerate). The row and what points to it go all the same.
        if (!hasApiStatus(error, 404)) {
          console.error('[MyLibrary] delete failed', error);
          showToast.error(t('delete.failed'));
          return;
        }
      }
      const id = narration.id;
      queueStore.remove(id);
      // Unloaded first: the stop saves the position, which then goes.
      if ((audio.isStoryLoaded && audio.audioId === id) || audio.pendingNarrationId === id) {
        await audio.stopAndCleanup();
      }
      await removeSavedPosition(id);
      void forgetLastListened(id);
      dirtyRef.current = true;
      if (!mountedRef.current) return;
      setNarrations(prev => prev.filter(item => item.id !== id));
      setTotal(prev => Math.max(0, prev - 1));
      setPositions(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      showToast.success(t('delete.done'));
    },
    [audio, t],
  );

  const confirmDelete = useCallback(
    (narration: StoryNarration) => {
      showDialog({
        title: t('delete.title'),
        message: t('delete.message', { title: narration.story?.title ?? t('row.fallbackTitle') }),
        buttons: [
          { text: t('common:cancel'), style: 'cancel' },
          {
            text: t('delete.confirm'),
            style: 'destructive',
            onPress: () => void deleteNarration(narration),
          },
        ],
      });
    },
    [showDialog, t, deleteNarration],
  );

  const menuOptions: StoryOption[] = [];
  if (menuNarration) {
    const narration = menuNarration;
    // "Sıraya ekle" is the row's own button, beside play.
    menuOptions.push(
      {
        key: 'story',
        title: t('player:openStory'),
        icon: 'book',
        onPress: () =>
          afterMenu(() => {
            const storyId = narration.storyId || narration.story?.id;
            if (storyId) nav.navigate('StoryDetail', { storyId });
          }),
      },
      {
        key: 'delete',
        title: t('menu.delete'),
        icon: 'trash',
        onPress: () => afterMenu(() => confirmDelete(narration)),
      },
    );
  }

  const libraryNarrations = useMemo(
    () => sortNarrations(narrations.filter(isVisibleNarration)),
    [narrations],
  );
  const readyNarrations = useMemo(
    () => libraryNarrations.filter(isNarrationReady),
    [libraryNarrations],
  );
  const savedStories = storyStore.favoriteStories;
  const searching = appliedSearch.length > 0;

  // "Hepsini çal": the ready rows in list order become the queue and play.
  const playAll = useCallback(() => {
    const hadQueue = queueStore.entries.length > 0;
    const previous = queueStore.replaceAll(readyNarrations.slice(0, QUEUE_MAX).map(metaFromNarration));
    void playQueueFrom();
    if (hadQueue) {
      showToast.info(t('player:queue.replaced'), undefined, {
        label: t('common:undo'),
        onPress: () => queueStore.restoreSnapshot(previous),
      });
    }
  }, [readyNarrations, t]);

  // Covers of neighbouring rows never repeat a placeholder picture.
  const narrationSubjects = useMemo(
    () =>
      libraryNarrations.map(n => ({
        id: n.id,
        translationGroupId: n.story?.translationGroupId ?? n.storyId,
      })),
    [libraryNarrations],
  );
  const narrationSpread = useCoverSpread(narrationSubjects);
  const savedSpread = useCoverSpread(savedStories);

  // One list ref per segment (only one is mounted): a tap on the focused
  // tab scrolls it to the top.
  const mineListRef = useRef<FlatList<StoryNarration>>(null);
  const savedListRef = useRef<FlatList<Story>>(null);
  useScrollToTop(mineListRef);
  useScrollToTop(savedListRef);

  const mineLoading = libraryNarrations.length === 0 && (isLoading || !loadedOnce);
  const savedLoading =
    savedStories.length === 0 &&
    (!savedLoaded || (!!storyStore.isLoadingFavorites && !storyStore.favoritesError));

  // The first real content after a skeleton fades in once: what mounts in
  // the commit that replaces the skeleton. Later rows (next pages, rows
  // virtualised back in) are shown at once.
  const skeletonShownRef = useRef<Record<LibrarySegment, boolean>>({ mine: false, saved: false });
  const fadeNowRef = useRef<Record<LibrarySegment, boolean>>({ mine: false, saved: false });
  const loadingNow: Record<LibrarySegment, boolean> = { mine: mineLoading, saved: savedLoading };
  if (loadingNow[segment]) {
    skeletonShownRef.current[segment] = true;
  } else if (skeletonShownRef.current[segment]) {
    skeletonShownRef.current[segment] = false;
    fadeNowRef.current[segment] = true;
  }
  useEffect(() => {
    fadeNowRef.current = { mine: false, saved: false };
  });
  const fadeSkip = !fadeNowRef.current[segment];

  const refreshControl = (
    <RefreshControl
      refreshing={isRefreshing}
      onRefresh={handleRefresh}
      tintColor={T.action}
      colors={[T.action]}
      progressBackgroundColor={T.surface}
    />
  );
  const listPadding = {
    paddingBottom: T.tabBarReservedHeight + miniPlayerInset,
    flexGrow: 1,
  };
  const footerSpinner = (
    <View style={styles.footer}>
      <Spinner />
    </View>
  );

  // Loading: the header slot (the count row) and the rows in their own
  // shape (cover, text lines, the play button), so nothing moves when the
  // list lands.
  const rowsSkeleton = (
    <SkeletonPulse testID="library-loading">
      <View style={styles.countRow} testID="library-loading-count">
        <Bone tone="text" width={70} height={12} radius={RADIUS.xs} />
      </View>
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <RowSkeleton
          key={i}
          height={LIBRARY_ROW_HEIGHT}
          radius={LIBRARY_CARD_RADIUS}
          lip={LIBRARY_CARD_LIP}
          leadingSize={LIBRARY_COVER_WIDTH}
          leadingRadius={LIBRARY_COVER_RADIUS}
          style={styles.skeletonRow}
        />
      ))}
    </SkeletonPulse>
  );

  const failureState = (kind: FailureKind | null, testID: string, title: string, onRetry: () => void) =>
    kind === 'offline' ? (
      <StateView
        testID={testID}
        icon="wifiOff"
        title={t('states:offline.title')}
        message={t('states:offline.message')}
        actionLabel={t('common:retry')}
        onAction={onRetry}
        style={styles.state}
      />
    ) : (
      <StateView
        testID={testID}
        icon="alert"
        title={title}
        message={t('error.message')}
        actionLabel={t('common:retry')}
        onAction={onRetry}
        style={styles.state}
      />
    );

  const renderMine = () => {
    const continueItem = !searching ? lastListened : null;
    const count = hasMorePages ? Math.max(total, libraryNarrations.length) : libraryNarrations.length;
    const countKey = searching
      ? count === 1
        ? 'count.resultsOne'
        : 'count.results'
      : count === 1
        ? 'count.talesOne'
        : 'count.tales';

    // The count row comes with the list. While the search is open its
    // "Vazgeç" sits beside the field, so the row has no search button and
    // a search that found nothing shows no row at all.
    const showCountRow = !mineLoading && libraryNarrations.length > 0;
    const showSearchToggle = !searchOpen;
    const showPlayAll = !searching && readyNarrations.length >= 2;

    let empty: React.ReactElement;
    if (mineLoading) {
      empty = rowsSkeleton;
    } else if (errorKind && narrations.length === 0) {
      empty = failureState(errorKind, 'library-error', t('error.title'), () => load('initial'));
    } else if (searching) {
      // At the top of the list, not centred in it: the keyboard is up while
      // the user types, and a centred state sat half under it.
      empty = (
        <StateView
          testID="library-no-results"
          icon="search"
          title={t('empty.search.title')}
          message={t('empty.search.message')}
          style={styles.stateTop}
        />
      );
    } else {
      empty = (
        <LibraryEmptyState
          testID="library-empty"
          title={t('empty.mine.title')}
          message={t('empty.mine.message')}
          actionLabel={t('empty.mine.action')}
          onAction={browse}
        />
      );
    }

    return (
      <FlatList
        key="mine"
        ref={mineListRef}
        data={libraryNarrations}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <RowFade skip={fadeSkip}>
            <NarrationRow
              narration={item}
              savedPositionMs={positions[item.id] ?? null}
              placeholderIndex={narrationSpread.get(item.id)}
              onOpen={openNarration}
              onMenu={openMenu}
            />
          </RowFade>
        )}
        ListHeaderComponent={
          <>
            {/* Local, so it shows above the skeleton and the empty states too. */}
            {continueItem ? (
              <ContinueListeningCard
                item={continueItem}
                placeholderIndex={narrationSpread.get(continueItem.record.narrationId)}
              />
            ) : null}
            {showCountRow ? (
              <FadeIn skip={fadeSkip} style={styles.countRow} testID="library-count-row">
                <View style={styles.countTextSlot}>
                  <Text style={text.label} numberOfLines={1} testID="library-count">
                    {/* The server total also counts narrations that are not
                        listed (failed ones), so it is used only while pages
                        are still missing. */}
                    {t(countKey, { total: count })}
                  </Text>
                </View>
                <View style={styles.countActions}>
                  {showSearchToggle ? (
                    <IconButton
                      icon="search"
                      onPress={openSearch}
                      accessibilityLabel={t('search.open')}
                      testID="library-search-toggle"
                      style={[styles.countIcon, !showPlayAll && styles.countIconLast]}
                    />
                  ) : null}
                  {showPlayAll ? (
                    <Button
                      label={t('playAll')}
                      variant="text"
                      size="sm"
                      icon="play"
                      onPress={playAll}
                      testID="library-play-all"
                      style={styles.countAction}
                    />
                  ) : null}
                </View>
              </FadeIn>
            ) : null}
          </>
        }
        ListEmptyComponent={mineLoading ? empty : <FadeIn skip={fadeSkip} style={styles.state}>{empty}</FadeIn>}
        ListFooterComponent={isLoadingMore ? footerSpinner : null}
        contentContainerStyle={listPadding}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onEndReached={() => load('append')}
        onEndReachedThreshold={0.3}
        refreshControl={refreshControl}
      />
    );
  };

  const renderSaved = () => {
    const count = storyStore.favoritesTotal || savedStories.length;
    let empty: React.ReactElement;
    if (savedLoading) {
      empty = rowsSkeleton;
    } else if (storyStore.favoritesError) {
      empty = failureState(
        storyStore.favoritesErrorKind ?? null,
        'library-saved-error',
        t('savedError.title'),
        () => void loadSaved(),
      );
    } else {
      empty = (
        <LibraryEmptyState
          testID="library-empty-saved"
          title={t('empty.saved.title')}
          message={t('empty.saved.message')}
          actionLabel={t('empty.saved.action')}
          onAction={browse}
        />
      );
    }
    return (
      <FlatList
        key="saved"
        ref={savedListRef}
        data={savedStories}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <RowFade skip={fadeSkip}>
            <SavedStoryRow
              story={item}
              placeholderIndex={savedSpread.get(item.id)}
              onOpen={openStory}
              onUnsave={unsave}
            />
          </RowFade>
        )}
        ListHeaderComponent={
          // The count row from the first page on: the store keeps the total,
          // so a later page never moves the list.
          savedStories.length > 0 ? (
            <FadeIn skip={fadeSkip} style={styles.countRow}>
              <Text style={text.label} testID="library-count">
                {t(count === 1 ? 'count.talesOne' : 'count.tales', { total: count })}
              </Text>
            </FadeIn>
          ) : null
        }
        ListEmptyComponent={savedLoading ? empty : <FadeIn skip={fadeSkip} style={styles.state}>{empty}</FadeIn>}
        ListFooterComponent={storyStore.isLoadingMoreFavorites ? footerSpinner : null}
        contentContainerStyle={listPadding}
        showsVerticalScrollIndicator={false}
        onEndReached={() => void storyStore.loadMoreFavorites()}
        onEndReachedThreshold={0.3}
        refreshControl={refreshControl}
      />
    );
  };

  const queueCount = queueStore.entries.length;
  const queueLabel =
    queueCount === 0
      ? t('player:queue.title')
      : queueCount === 1
        ? t('player:queue.a11yOpenOne')
        : t('player:queue.a11yOpen', { n: queueCount });

  return (
    <View style={styles.container}>
      <TopAppBar
        variant="tab"
        title={t('title')}
        trailing={
          <View style={styles.actions} testID="library-actions">
            <IconButton
              variant="tactile"
              icon="queue"
              badgeCount={queueCount}
              // The label says the count, so it is heard once and never
              // left behind as a stale value once the queue is cleared.
              countInLabel
              onPress={() => queueSheet.open('library')}
              accessibilityLabel={queueLabel}
              testID="library-queue"
            />
            <TopBarAccount testIDPrefix="library" />
          </View>
        }
      />

      <SegmentedControl<LibrarySegment>
        segments={[
          { value: 'mine', label: t('segments.mine') },
          { value: 'saved', label: t('segments.saved') },
        ]}
        value={segment}
        onChange={setSegment}
        accessibilityLabel={t('segments.label')}
        testID="library-segments"
        style={styles.segments}
      />

      {segment === 'mine' && searchOpen ? (
        // "Vazgeç" beside the field closes the search, so the list below
        // never holds a lone close button (V5-06).
        <View style={styles.searchRow} testID="library-search-row">
          <SearchField
            value={searchVal}
            onChangeText={setSearchVal}
            placeholder={t('search.placeholder')}
            clearLabel={t('search.clear')}
            autoFocus
            testID="library-search-input"
            style={styles.searchField}
          />
          <Button
            label={t('common:cancel')}
            variant="text"
            size="md"
            onPress={closeSearch}
            testID="library-search-cancel"
            style={styles.searchCancel}
          />
        </View>
      ) : null}

      <View style={styles.body}>{segment === 'mine' ? renderMine() : renderSaved()}</View>

      <StoryOptionsSheet
        visible={menuVisible}
        onClose={closeMenu}
        onClosed={runAfterMenu}
        options={menuOptions}
        title={menuNarration?.story?.title ?? t('row.fallbackTitle')}
        testID="library-options"
      />
    </View>
  );
});

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    actions: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
    segments: { marginHorizontal: T.screenPadH, marginTop: SPACE.sm, marginBottom: SPACE.xs },
    // The field and its "Vazgeç", whose label ends on the gutter.
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.xs,
      marginHorizontal: T.screenPadH,
      marginTop: SPACE.md,
    },
    searchField: { flex: 1, minWidth: 0 },
    searchCancel: { alignSelf: 'center', marginRight: -SPACE.md },
    body: { flex: 1 },
    countRow: {
      minHeight: LIBRARY_COUNT_ROW_HEIGHT,
      paddingHorizontal: T.screenPadH,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    countTextSlot: { flex: 1, minWidth: 0 },
    countActions: { flexDirection: 'row', alignItems: 'center' },
    // The 48dp targets keep the row at 40dp; the last one's label or glyph
    // ends on the gutter.
    countIcon: { marginVertical: -SPACE.xs },
    countIconLast: { marginRight: -SPACE.md },
    countAction: { marginVertical: -SPACE.xs, marginRight: -SPACE.md },
    skeletonRow: { marginHorizontal: T.screenPadH, marginBottom: LIBRARY_CARD_GAP },
    state: { flex: 1 },
    // A search that found nothing: right under the field, above the keyboard.
    stateTop: { flex: 1, justifyContent: 'flex-start', paddingTop: SPACE.xxl },
    footer: { paddingVertical: SPACE.lg, alignItems: 'center' },
  });

const stylesFor = themedStyles(makeStyles);

export default MyLibraryScreen;
