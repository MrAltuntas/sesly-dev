/**
 * CollectionDetailScreen: one curated collection (`GET /collections/:slug`
 * and `GET /collections/:slug/stories`, both in the content language): the
 * story count as a small line above a Baloo 2 32 title, the description,
 * then its stories in the cover grid of Keşfet (components/story/StoryCard,
 * with its bookmark; a card has no long press).
 *
 * Premium stories are locked on the free plan (Mini and Premium play them):
 * the card says so and a tap explains the plans instead of opening a detail
 * screen that answers 403.
 *
 * A failed pull-to-refresh keeps what is on screen and says so in a
 * snackbar; a save made on a story page (or anywhere else) shows on the
 * grid when the screen is back in view, without a request.
 *
 * Not drawn in the playful mockup; it follows the frames that are.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, ListRenderItemInfo, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { observer } from 'mobx-react-lite';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import {
  Bone,
  SkeletonPulse,
  Spinner,
  StateView,
  TopAppBar,
  useCoverSpread,
} from '../../components/design';
import {
  GRID_COLUMN_GAP,
  GRID_ROW_GAP,
  StoryCard,
  StoryGridSkeleton,
  useStoryGrid,
} from '../../components/story/StoryCard';
import { announceSaveOutcome } from '../../components/story/saveFeedback';
import { usePremiumGate } from '../../components/story/usePremiumGate';
import { RADIUS, SPACE, Theme, themedStyles, useT, useTextStyles } from '../../theme/theme';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { Story, TaleRef, isStorySaved } from '../../models/Story';
import { Collection } from '../../models/Collection';
import CollectionService from '../../services/CollectionService';
import { FailureKind, classifyFailure, getErrorMessage } from '../../services/ApiError';
import { getConnectivityStore } from '../../stores/ConnectivityStore';
import { useStory } from '../../hooks/useStory';
import { useContentLanguage } from '../../hooks/useContentLanguage';
import { SaveOutcome, patchSaved, toggleStorySaved } from '../../hooks/useDiscover';
import { showToast } from '../../utils/toast';
import { failureCopy } from '../home/failureState';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type CollRoute = RouteProp<RootStackParamList, 'CollectionDetail'>;

export const COLLECTION_PAGE_SIZE = 20;

interface LoadError {
  readonly message: string;
  readonly kind: FailureKind;
}

/** The list with one tale's saved state, or the same list when it already shows it. */
export function withSavedState(list: Story[], story: TaleRef, saved: boolean): Story[] {
  const patched = patchSaved(list, story, saved);
  const changed = patched.some(
    (item, i) =>
      item.isFavorite !== list[i].isFavorite ||
      item.isFavoriteAnyLanguage !== list[i].isFavoriteAnyLanguage,
  );
  return changed ? patched : list;
}

const CollectionDetailScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const route = useRoute<CollRoute>();
  const insets = useSafeAreaInsets();
  const T = useT();
  const { t } = useTranslation('discover');
  const styles = stylesFor(T);
  const text = useTextStyles();
  const storyStore = useStory();
  const contentLanguage = useContentLanguage();
  const premiumGate = usePremiumGate();

  const slug = route.params.slug;

  const [collection, setCollection] = useState<Collection | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<LoadError | null>(null);

  // What is on screen, for the handlers that run after a request.
  const storiesRef = useRef(stories);
  storiesRef.current = stories;
  const collectionRef = useRef(collection);
  collectionRef.current = collection;
  // The pages on screen are of this language; the next page asks for it too.
  const loadedLanguage = useRef(contentLanguage.effective);
  // Only the newest first-page request lands (a retry, a refresh, another slug).
  const request = useRef(0);
  // Bookmark taps per story while its request runs: the state wanted last.
  const saveWanted = useRef(new Map<string, boolean>());
  // StoryStore's saved-state log, as far as this grid has shown it.
  const seenFavorites = useRef(storyStore.favoritesVersion ?? 0);
  // The story page's copy (currentStory) this grid has already seen.
  const seenDetail = useRef(storyStore.currentStory);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!slug) return;
      const id = ++request.current;
      const language = contentLanguage.effective;
      if (mode === 'initial') {
        setIsLoading(true);
        setError(null);
      } else {
        setIsRefreshing(true);
      }
      try {
        const [col, paginated] = await Promise.all([
          CollectionService.getBySlug(slug, language),
          CollectionService.getStories(slug, 1, COLLECTION_PAGE_SIZE, language),
        ]);
        if (id !== request.current) return;
        loadedLanguage.current = language;
        // The rows are fresher than the saves and the story page seen so far.
        seenFavorites.current = storyStore.favoritesVersion ?? seenFavorites.current;
        seenDetail.current = storyStore.currentStory;
        setCollection(col);
        setStories([...paginated.data]);
        setPage(paginated.meta.page);
        setTotalPages(paginated.meta.totalPages);
        setError(null);
      } catch (err) {
        if (id !== request.current) return;
        const kind = classifyFailure(err, getConnectivityStore());
        if (mode === 'refresh' && collectionRef.current) {
          // The collection stays; the snackbar is the only sign.
          showToast.error(kind === 'offline' ? t('states:offline.title') : t('collection.errorTitle'));
        } else {
          setError({ message: getErrorMessage(err, t('error.message')), kind });
        }
      } finally {
        if (id === request.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [slug, contentLanguage, storyStore, t],
  );

  useEffect(() => {
    void load('initial');
    // Reload only when the route points at another collection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const loadMore = useCallback(async () => {
    if (!slug || isLoadingMore || page >= totalPages) return;
    const id = request.current;
    setIsLoadingMore(true);
    try {
      const paginated = await CollectionService.getStories(
        slug,
        page + 1,
        COLLECTION_PAGE_SIZE,
        loadedLanguage.current,
      );
      // A first page loaded meanwhile replaced the list.
      if (id !== request.current) return;
      setStories(prev => [...prev, ...paginated.data]);
      setPage(paginated.meta.page);
      setTotalPages(paginated.meta.totalPages);
    } catch (err) {
      // The stories stay; the next end of the list tries again.
      console.warn('Collection loadMore failed:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [slug, page, totalPages, isLoadingMore]);

  // Back in view: the story page that was just left and the saves made
  // meanwhile (its heart, another list), written into the rows. The story
  // page's copy counts only when it is a new one (an old copy is older than
  // the rows), and the changes go last: they are newer than that copy (an
  // unsave of a tale saved in another language does not touch it).
  useFocusEffect(
    useCallback(() => {
      const since = seenFavorites.current;
      const changes = (storyStore.favoriteChanges ?? []).filter(change => change.version > since);
      seenFavorites.current = storyStore.favoritesVersion ?? since;
      const current = storyStore.currentStory;
      const freshCopy = current && current !== seenDetail.current ? current : null;
      seenDetail.current = current;
      let next = storiesRef.current;
      if (freshCopy) next = withSavedState(next, freshCopy, isStorySaved(freshCopy));
      changes.forEach(change => {
        next = withSavedState(next, change.story, change.saved);
      });
      if (next !== storiesRef.current) setStories(next);
    }, [storyStore]),
  );

  const openStory = useCallback(
    (story: Story) => {
      if (premiumGate.isLocked(story)) {
        premiumGate.showPlans();
        return;
      }
      nav.navigate('StoryDetail', { storyId: story.id });
    },
    [premiumGate, nav],
  );

  // Root-stack screen: back to the one Main (no second tab shell) on Kütüphane.
  const showLibrary = useCallback(() => nav.popTo('Main', { screen: 'Library' }), [nav]);

  /**
   * Bring one tale to the saved state `wanted`, at once on screen. Taps on a
   * story while its request runs only change what is wanted; the running
   * request sends the latest wish when it settles, so requests for a story
   * never overlap. Resolves with the outcome of the last request
   * ('superseded' when a running one takes the tap).
   */
  const setSaved = useCallback(
    async (story: Story, wanted: boolean, announce: boolean): Promise<SaveOutcome> => {
      const before = storiesRef.current.filter(item => item.id === story.id || isSameTaleRow(item, story));
      setStories(prev => patchSaved(prev, story, wanted));
      const running = saveWanted.current;
      if (running.has(story.id)) {
        running.set(story.id, wanted);
        return 'superseded';
      }
      running.set(story.id, wanted);
      const original = before.find(item => item.id === story.id) ?? story;
      const startedSaved = isStorySaved(original);
      // What the server has, as far as the answers tell.
      let confirmed = startedSaved;
      let outcome: SaveOutcome = 'superseded';
      try {
        for (;;) {
          const target = running.get(story.id) ?? confirmed;
          if (target === confirmed) break;
          const row = confirmed === startedSaved ? original : patchSaved([original], original, confirmed)[0];
          outcome = await toggleStorySaved(row, storyStore);
          if (outcome !== 'saved' && outcome !== 'removed') break;
          confirmed = target;
        }
      } finally {
        running.delete(story.id);
      }
      if (outcome === 'failed') {
        // Back to what the server has: the rows as they were, or the last saved state.
        setStories(prev =>
          confirmed === startedSaved
            ? prev.map(item => before.find(old => old.id === item.id) ?? item)
            : patchSaved(prev, story, confirmed),
        );
      }
      if (announce) {
        announceSaveOutcome(outcome, story, confirmed, showLibrary, () =>
          setSaved(storiesRef.current.find(item => item.id === story.id) ?? story, true, false),
        );
      }
      return outcome;
    },
    [storyStore, showLibrary],
  );

  const toggleSave = useCallback(
    (story: Story) => {
      const shown = storiesRef.current.find(item => item.id === story.id) ?? story;
      void setSaved(shown, !isStorySaved(shown), true);
    },
    [setSaved],
  );

  const spread = useCoverSpread(stories);
  const { columns, cardWidth } = useStoryGrid();
  const locksPremium = premiumGate.locksPremium;

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Story>) => {
      const locked = locksPremium && item.isPremium;
      return (
        <StoryCard
          story={item}
          width={cardWidth}
          placeholderIndex={spread.get(item.id)}
          premium={item.isPremium}
          locked={locked}
          onPress={openStory}
          onToggleSave={locked ? undefined : toggleSave}
        />
      );
    },
    [locksPremium, cardWidth, spread, openStory, toggleSave],
  );

  let body: React.ReactNode;
  if (isLoading) {
    // The header lines in the line boxes of the real text, then the grid in
    // its shape: nothing moves when the collection arrives.
    body = (
      <View testID="collection-loading">
        <SkeletonPulse style={styles.header}>
          <View style={[styles.lineBox, { height: text.eyebrow.lineHeight }]} testID="collection-loading-count">
            <Bone tone="text" width={90} height={12} radius={RADIUS.xs} />
          </View>
          <View
            style={[styles.lineBox, styles.title, { height: text.displayL.lineHeight }]}
            testID="collection-loading-title"
          >
            <Bone tone="text" width="70%" height={28} radius={RADIUS.xs} />
          </View>
          <View
            style={[styles.lineBox, styles.description, { height: text.bodySmall.lineHeight }]}
            testID="collection-loading-description"
          >
            <Bone tone="text" width="90%" height={12} radius={RADIUS.xs} />
          </View>
        </SkeletonPulse>
        <StoryGridSkeleton rows={2} />
      </View>
    );
  } else if (error || !collection) {
    const copy = failureCopy(error?.kind, {
      title: t('collection.errorTitle'),
      message: error?.message ?? t('collection.notFound'),
    });
    body = (
      <StateView
        testID="collection-error"
        icon={copy.icon}
        title={copy.title}
        message={copy.message}
        actionLabel={t('common:retry')}
        onAction={() => void load('initial')}
        style={styles.state}
      />
    );
  } else {
    const description = collection.description ?? collection.subtitle;
    body = (
      <FlatList
        key={`grid-${columns}`}
        data={stories}
        extraData={locksPremium}
        numColumns={columns}
        keyExtractor={storyKey}
        columnWrapperStyle={styles.gridRow}
        ItemSeparatorComponent={GridRowGap}
        renderItem={renderItem}
        // Rows of `columns` cards: four rows first, then three at a time.
        initialNumToRender={4}
        maxToRenderPerBatch={3}
        windowSize={7}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={text.eyebrow}>
              {t('collections.storyCount', { total: String(collection.storyCount) })}
            </Text>
            <Text accessibilityRole="header" style={[text.displayL, styles.title]}>
              {collection.title}
            </Text>
            {description ? <Text style={[text.bodySmall, styles.description]}>{description}</Text> : null}
          </View>
        }
        ListFooterComponent={
          isLoadingMore ? (
            <View style={styles.footer}>
              <Spinner color={T.text2} />
            </View>
          ) : stories.length === 0 ? (
            <Text style={[text.bodySmall, styles.emptyLine]} testID="collection-empty">
              {t('collection.empty')}
            </Text>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + SPACE.xxl }}
        showsVerticalScrollIndicator={false}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void load('refresh')}
            tintColor={T.action}
            colors={[T.action]}
            progressBackgroundColor={T.surface}
          />
        }
        testID="collection-list"
      />
    );
  }

  return (
    <View style={styles.container}>
      <TopAppBar variant="back" onBack={() => nav.goBack()} />
      {body}
    </View>
  );
});

/** Another language row of the same tale (the tale key is known). */
function isSameTaleRow(item: TaleRef, story: TaleRef): boolean {
  return !!story.translationGroupId && item.translationGroupId === story.translationGroupId;
}

const storyKey = (story: Story) => story.id;

const GridRowGap: React.FC = () => <View style={{ height: GRID_ROW_GAP }} />;

const stylesFor = themedStyles((T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    gridRow: { gap: GRID_COLUMN_GAP, paddingHorizontal: T.screenPadH },
    state: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    // Block to block 20 under the description.
    header: { paddingHorizontal: T.screenPadH, paddingTop: SPACE.sm, paddingBottom: SPACE.xl },
    title: { marginTop: SPACE.xxs },
    description: { marginTop: SPACE.tight },
    lineBox: { justifyContent: 'center' },
    footer: { paddingVertical: SPACE.lg, alignItems: 'center' },
    emptyLine: { textAlign: 'center', paddingHorizontal: T.screenPadH, paddingVertical: SPACE.xxl },
  }),
);

export default CollectionDetailScreen;
