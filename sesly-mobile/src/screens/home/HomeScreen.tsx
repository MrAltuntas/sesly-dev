/**
 * HomeScreen: the "Masallar" tab (design/v4/playful, frame a).
 *
 *   - Greeting: one compact line, "İyi geceler, Elif" (Baloo 2 21, the
 *     heading step, by the time of day and the user's first name), with the
 *     bell and the avatar (TopBarAccount) at the right; no line above it
 *     (owner feedback: the block took too much room). The mockup's streak chip and the
 *     bedtime countdown are left out: the app has no such data.
 *   - Hero (184dp): the featured story's picture with the "Bu gecenin
 *     masalı" tag ("Bugünün masalı" before the evening) in its category
 *     colour, the title, glass chips (duration, age, the level, and the
 *     language only when it is not the content language) and
 *     a 56dp round play button in the action colour. The featured story
 *     changes every day; a user without premium stories never gets a premium
 *     one. The card opens the story; the play button opens the player and
 *     starts the newest ready narration of it, or the story page when it has
 *     none.
 *   - Category tiles: one per category that has stories, from the category
 *     shelves; a tile opens Keşfet filtered to that category (as does a
 *     category shelf's "Tümü"). Bones while the shelves load.
 *   - Shelves of 100 x 146 cover cards (ShelfCover) with the duration chip,
 *     the AI translation mark and the lock on the picture: new stories
 *     and saved stories (page 1 of the catalogue and the saved list), then
 *     one shelf per category in HOME_CATEGORIES order, each from its own
 *     request (StoryStore.loadCategoryShelves), and the collections of the
 *     content language. "Tümü" leads on. A cover has no long press (owner
 *     feedback: nobody found it, and a tale without a narration has nothing
 *     to queue): its tap opens the story page, where saving and queueing
 *     a ready narration are visible buttons.
 *   - Cheap first render: the hero, the tiles and the first two shelves
 *     mount with the content, the other shelves a frame later; each shelf
 *     renders four covers first.
 *   - Nothing moves while it loads (HOME-SHIFT): a title takes at most two
 *     lines, the marks are on the cover, and every shelf list has the same
 *     fixed height (shelfListHeight: the cover and two title lines at the
 *     font scale); every shelf still on its way (the later shelves before
 *     their frame, the category shelves before they are in) is a skeleton
 *     of that height.
 *   - One language only: the hero, the newest stories and the category
 *     shelves are flat lists of the content language ("Masal dili", the UI
 *     language without a pick), the saved shelf keeps only the tales saved
 *     in it, and the collections are that language's. A tale without a
 *     version in it is found in Keşfet. The lists load after the device
 *     copy of the pick was read (`seed`, local) and follow every change of
 *     the language (the story store and the collections react to it).
 *   - No search and no filters here; those live in Keşfet.
 *
 * The last played story is docked above the navigation bar by the shell
 * (MainScaffold), not by this screen; the scroll end leaves room for it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  LayoutChangeEvent,
  ListRenderItemInfo,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { observer } from 'mobx-react-lite';
import { reaction } from 'mobx';
import { useNavigation, useScrollToTop } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Card,
  CategoryTile,
  Bone,
  Icon,
  PictureCover,
  SectionHeader,
  ShelfSkeleton,
  SkeletonPulse,
  StateView,
  Tactile,
  Tag,
  coverLip,
  usePressSink,
  useCoverSpread,
} from '../../components/design';
import { SkeletonSwap } from '../../components/design/Skeleton';
import { usePremiumGate } from '../../components/story/usePremiumGate';
import {
  SHELF_COVER_HEIGHT,
  SHELF_COVER_WIDTH,
  SHELF_TITLE_LINES,
  ShelfCover,
  shelfListHeight,
} from '../../components/story/ShelfCover';
import { useMiniPlayerInset } from '../../components/audio/useMiniPlayerInset';
import { LIP, RADIUS, SCREEN_PAD_H, SPACE, Theme, themedStyles, useT, useTextStyles } from '../../theme/theme';
import { PRESS_DELAY_MS } from '../../theme/motion';
import { categoryColors } from '../../theme/palettes';
import { withAlpha } from '../../theme/color';
import { TopBarAccount } from '../../components/common/TopBarAccount';
import { useStory } from '../../hooks/useStory';
import { useAuth } from '../../hooks/useAuth';
import { contentLanguageNativeName, useContentLanguage } from '../../hooks/useContentLanguage';
import { Story } from '../../models/Story';
import { Collection } from '../../models/Collection';
import CollectionService from '../../services/CollectionService';
import { getConnectivityStore } from '../../stores/ConnectivityStore';
import { newestReadyNarration } from '../../stores/queueActions';
import { metaFromNarration, playerStoryOf, rememberNarrationMeta } from '../../stores/narrationMeta';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { storyAgeLabel, storyDurationLabel, storyShelfLabel } from '../../utils/storyLabels';
import { initialOf } from '../../i18n/text';
import { requestLibrarySegment } from '../../components/library/librarySegment';
import { failureCopy } from './failureState';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Hero card height (`.hero`). */
export const HERO_HEIGHT = 184;
/** The hero is the wide cover: radius `RADIUS.xxl`. */
export const HERO_RADIUS = RADIUS.xxl;
/** The hero play button (lip `LIP.md`, a 24dp glyph). */
export const HERO_PLAY_SIZE = 56;
/** Every overlay keeps 12dp to the hero's edges (SPEC-design 1.5). */
export const HERO_INSET = SPACE.md;
/** How far the hero title follows the system font: two lines always fit under the tag. */
export const HERO_TITLE_MAX_SCALE = 1.2;
/** How far the hero tags follow it: a Tag stays 28dp up to this. */
export const HERO_TAG_MAX_SCALE = 1.3;
export { SHELF_COVER_HEIGHT, SHELF_COVER_WIDTH, SHELF_TITLE_LINES, shelfListHeight };
/** Gap between the covers of a shelf. */
export const SHELF_GAP = SPACE.md;
/** Covers a shelf renders first; the rest follow as it scrolls. */
export const SHELF_INITIAL_COVERS = 4;
/** Shelves that mount with the content; the others mount a frame later. */
export const FIRST_SHELVES = 2;
const SHELF_LIMIT = 10;
const COLLECTION_CARD_WIDTH = 172;
const TILE_WIDTH = 128;
const TILE_HEIGHT = 56;

/** The four categories, in the order of the mockup's tiles and shelves. */
export const HOME_CATEGORIES = [
  'BEDTIME',
  'TURKISH_CLASSICS',
  'WORLD_CLASSICS',
  'EDUCATIONAL',
] as const;

const NO_STORIES: readonly Story[] = [];

// ─────────────────────────────────────────────────────────────
// Pure selection logic (exported for tests)
// ─────────────────────────────────────────────────────────────

/** Day of the year in local time, 1 on January 1st. */
export function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getFullYear(), 0, 1);
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((today - start) / 86_400_000) + 1;
}

/**
 * "Bu gecenin masalı": one of the bedtime stories, a different one each day
 * (by the day of the year), else the first story. Without premium stories
 * (`hasPremiumStories` false: the free plan) premium stories are never
 * picked; null when nothing is left.
 */
export function pickFeaturedStory(
  stories: readonly Story[],
  hasPremiumStories: boolean,
  date: Date = new Date(),
): Story | null {
  const open = hasPremiumStories ? stories : stories.filter(story => !story.isPremium);
  if (open.length === 0) return null;
  const bedtime = open.filter(story => story.category === 'BEDTIME');
  if (bedtime.length === 0) return open[0];
  return bedtime[dayOfYear(date) % bedtime.length];
}

export type DayPart = 'morning' | 'day' | 'evening' | 'night';

/**
 * Part of the day for the greeting: 5-11 morning, 12-16 day, 17-20 evening,
 * from 21 on night (bedtime, "İyi geceler").
 */
export function dayPartOf(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'day';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/** The hero tag: "Bu gecenin masalı" from the evening on, "Bugünün masalı" before. */
export function featuredTagKey(part: DayPart): 'featured.tagNight' | 'featured.tagDay' {
  return part === 'evening' || part === 'night' ? 'featured.tagNight' : 'featured.tagDay';
}

/** A first name as the greeting writes it: the first letter uppercased for the UI language. */
export function greetingName(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) return '';
  return initialOf(trimmed) + trimmed.slice(1);
}

/** Where cover `index` of a shelf sits (fixed widths: no measuring). */
export function shelfItemLayout(
  _data: ArrayLike<Story> | null | undefined,
  index: number,
): { length: number; offset: number; index: number } {
  return {
    length: SHELF_COVER_WIDTH,
    offset: SCREEN_PAD_H + (SHELF_COVER_WIDTH + SHELF_GAP) * index,
    index,
  };
}

// ─────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────

interface ShelfSpec {
  readonly id: string;
  readonly title: string;
  readonly stories: readonly Story[];
}

const HomeScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const storyStore = useStory();
  const auth = useAuth();
  // Premium stories play on every paid plan (Mini and Premium).
  const premiumGate = usePremiumGate();
  const contentLanguage = useContentLanguage();
  const T = useT();
  const { t } = useTranslation('home');
  const styles = stylesFor(T);
  const text = useTextStyles();
  const { width: windowWidth } = useWindowDimensions();
  const miniPlayerInset = useMiniPlayerInset();

  // A tap on the focused Masallar tab scrolls back to the top.
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  const [refreshing, setRefreshing] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  // True once a stories fetch has completed. Tells "still loading" apart from
  // "loaded, nothing there", so a failed fetch offers a retry instead of an
  // empty state (the store's loading flags are shared between loads).
  const [storiesLoaded, setStoriesLoaded] = useState(false);
  // The shelves after the first FIRST_SHELVES mount a frame after the content.
  const [restReady, setRestReady] = useState(false);
  // Where the pull-to-refresh spinner starts: under the greeting, not on it.
  const [greetingBottom, setGreetingBottom] = useState(0);
  // Content already there on mount (the store kept it): no fade.
  const contentAtMount = useRef(storyStore.stories.length > 0).current;
  const collectionsRequest = useRef(0);
  // The language of the collections on screen, and whether the last load failed.
  const collectionsLanguage = useRef<string | null>(null);
  const collectionsFailed = useRef(false);

  const loadStories = useCallback(async () => {
    await storyStore.loadStories();
    setStoriesLoaded(true);
  }, [storyStore]);

  const loadShelves = useCallback(
    () => storyStore.loadCategoryShelves(HOME_CATEGORIES, { limit: SHELF_LIMIT }),
    [storyStore],
  );

  // Collections are kept per content language ("Masal dili").
  const loadCollections = useCallback(async () => {
    const request = ++collectionsRequest.current;
    const language = contentLanguage.effective;
    try {
      const list = await CollectionService.list(language);
      if (request !== collectionsRequest.current) return;
      collectionsLanguage.current = language;
      collectionsFailed.current = false;
      setCollections(list);
    } catch {
      if (request !== collectionsRequest.current) return;
      // The collections row is an extra; home works without it. A failed
      // refresh keeps the row it had, unless that row is of another language.
      collectionsFailed.current = true;
      if (collectionsLanguage.current !== language) setCollections([]);
    }
  }, [contentLanguage]);

  useEffect(() => {
    // The catalogue and the account's pick (the lists follow when they
    // change the language).
    void contentLanguage.load();
    if (storyStore.stories.length > 0) setStoriesLoaded(true);
    let cancelled = false;
    // The lists are asked for in the language the device last knew.
    void contentLanguage.seed().then(() => {
      if (cancelled) return;
      if (storyStore.stories.length === 0) void loadStories();
      if (storyStore.favoriteStories.length === 0) void storyStore.loadFavorites();
      if (!storyStore.hasLoadedShelves && !storyStore.isLoadingShelves) void loadShelves();
      void loadCollections();
    });
    return () => {
      cancelled = true;
    };
    // Mount only: the stores are singletons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new content language: the collections of that language. The stories
  // and the shelves are reloaded by the store (setContentLanguage).
  useEffect(
    () => reaction(() => contentLanguage.effective, () => void loadCollections()),
    [contentLanguage, loadCollections],
  );

  // "Tekrar dene": the stories and whatever else the failed start left out.
  const retry = useCallback(() => {
    setStoriesLoaded(false);
    void loadStories();
    if (storyStore.shelvesErrorKind) void loadShelves();
    if (storyStore.favoritesError) void storyStore.loadFavorites();
    if (collectionsFailed.current) void loadCollections();
  }, [storyStore, loadStories, loadShelves, loadCollections]);

  // Back online: the whole screen again when nothing but the error is on it,
  // else the parts that failed without the connection (shelves, collections).
  useEffect(
    () =>
      getConnectivityStore().onReconnect(() => {
        if (storyStore.stories.length === 0 && storyStore.errorMessage) {
          retry();
          return;
        }
        if (storyStore.shelvesErrorKind) void loadShelves();
        if (collectionsFailed.current) void loadCollections();
      }),
    [storyStore, retry, loadShelves, loadCollections],
  );

  const stories = storyStore.stories;
  const hasPremiumStories = !premiumGate.locksPremium;
  const today = new Date();
  const todayKey = dayOfYear(today);
  const featured = useMemo(
    () => pickFeaturedStory(stories, hasPremiumStories, today),
    // `today` only matters by its day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stories, hasPremiumStories, todayKey],
  );
  const featuredId = featured?.id;

  // The narrations of the featured story, so its play button can start one.
  useEffect(() => {
    if (featuredId) void storyStore.loadNarrationsForStory(featuredId);
  }, [storyStore, featuredId]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      storyStore.refresh().then(() => setStoriesLoaded(true)),
      storyStore.loadFavorites(),
      loadShelves(),
      loadCollections(),
      featuredId ? storyStore.loadNarrationsForStory(featuredId) : undefined,
    ]);
    setRefreshing(false);
  }, [storyStore, loadShelves, loadCollections, featuredId]);

  // The first frame with content draws the hero, the tiles and two shelves;
  // the other shelves and the collections mount in the next one. (Not
  // InteractionManager: deprecated in RN 0.83, a setImmediate stub that warns.)
  const hasContent = stories.length > 0;
  useEffect(() => {
    if (!hasContent || restReady) return undefined;
    const frame = requestAnimationFrame(() => setRestReady(true));
    return () => cancelAnimationFrame(frame);
  }, [hasContent, restReady]);

  const openStory = useCallback(
    (story: Pick<Story, 'id'>) => nav.navigate('StoryDetail', { storyId: story.id }),
    [nav],
  );
  // A cover the plan does not play explains the plans instead (as in Keşfet).
  const openCover = useCallback(
    (story: Story) => (premiumGate.isLocked(story) ? premiumGate.showPlans() : openStory(story)),
    [premiumGate, openStory],
  );
  // A category tile or a category shelf's "Tümü" opens Keşfet filtered to it.
  const openCategory = useCallback(
    (category: string) => nav.navigate('Main', { screen: 'Discover', params: { category } }),
    [nav],
  );
  const openLibrarySaved = useCallback(() => {
    requestLibrarySegment('saved');
    nav.navigate('Main', { screen: 'Library' });
  }, [nav]);
  const seeAll = useCallback(
    (shelfId: string) => {
      if (shelfId === 'new') nav.navigate('AllStories');
      else if (shelfId === 'saved') openLibrarySaved();
      else openCategory(shelfId);
    },
    [nav, openLibrarySaved, openCategory],
  );

  // The hero's play button: the player with the newest ready narration of
  // the story, started at once; the story page when there is none yet.
  const playFeatured = useCallback(() => {
    if (!featured) return;
    const narration = newestReadyNarration(storyStore.getNarrationsForStory(featured.id));
    if (!narration) {
      openStory(featured);
      return;
    }
    const meta = metaFromNarration(narration.storyId ? narration : { ...narration, storyId: featured.id });
    // The player draws the title at once from the remembered meta.
    rememberNarrationMeta(meta.story.title ? meta : { ...meta, story: playerStoryOf(featured) });
    nav.navigate('AudioPlayer', { narrationId: narration.id, autoplay: true });
  }, [featured, storyStore, openStory, nav]);

  // ── Greeting ──
  const firstName = greetingName(
    auth.backendUser?.firstName ?? auth.user?.displayName?.split(' ')[0] ?? '',
  );
  const part = dayPartOf(today.getHours());
  const greeting = firstName
    ? t(`greeting.${part}Name`, { name: firstName })
    : t(`greeting.${part}`);

  // ── Shelves ──
  const newest = useMemo(
    () => stories.filter(story => story.id !== featuredId).slice(0, SHELF_LIMIT),
    [stories, featuredId],
  );
  // Home is in one language: the saved tales of the content language (the
  // others stay in the Library's saved list, which "Tümü" opens).
  const shownLanguage = contentLanguage.effective;
  const favoriteStories = storyStore.favoriteStories;
  const saved = useMemo(
    () => favoriteStories.filter(story => story.language === shownLanguage).slice(0, SHELF_LIMIT),
    [favoriteStories, shownLanguage],
  );
  const shelfByCategory = storyStore.shelfByCategory;
  const shelvesLoaded = storyStore.hasLoadedShelves;
  const categoryShelves: ShelfSpec[] = HOME_CATEGORIES.map(category => ({
    id: category,
    title: storyShelfLabel(category),
    stories: shelfByCategory.get(category) ?? NO_STORIES,
  }));
  // A tile only for a category with stories: no tile opens an empty Keşfet.
  const tileCategories = categoryShelves.filter(shelf => shelf.stories.length > 0).map(shelf => shelf.id);
  const shelves: ShelfSpec[] = [
    { id: 'new', title: t('shelves.new'), stories: newest },
    { id: 'saved', title: t('shelves.saved'), stories: saved },
    ...categoryShelves,
  ].filter(shelf => shelf.stories.length > 0);
  const shownShelves = restReady ? shelves : shelves.slice(0, FIRST_SHELVES);
  // Nothing under the first shelves is ever empty (HOME-SHIFT): every shelf
  // still on its way has a skeleton as tall as the shelf (all shelves are
  // equally tall: the marks are on the covers). A known shelf waiting for
  // the frame after the content stands for itself; before the category
  // shelves are in, one skeleton per category.
  const pendingShelves: string[] = [
    ...(restReady ? [] : shelves.slice(FIRST_SHELVES)).map(shelf => shelf.id),
    ...(shelvesLoaded ? [] : HOME_CATEGORIES),
  ];

  // The first load: the skeleton holds the body until the stories are there,
  // then the content cross-fades in over it (SkeletonSwap: no empty frame
  // while the JS thread still draws the rest of the screen, LA-2).
  const loadingStories = stories.length === 0 && !storiesLoaded;
  let body: React.ReactNode;
  if (!loadingStories && stories.length === 0 && storyStore.errorMessage) {
    const copy = failureCopy(storyStore.listErrorKind, {
      title: t('error.title'),
      message: t('error.message'),
    });
    body = (
      <StateView
        testID="home-error"
        icon={copy.icon}
        title={copy.title}
        message={copy.message}
        actionLabel={t('common:retry')}
        onAction={retry}
        style={styles.state}
      />
    );
  } else if (!loadingStories && stories.length === 0) {
    body = (
      <StateView
        testID="home-empty"
        icon="book"
        title={t('empty.title')}
        message={t('empty.message')}
        style={styles.state}
      />
    );
  } else {
    body = (
      <SkeletonSwap
        loading={loadingStories}
        skeleton={<HomeSkeleton heroWidth={windowWidth - T.screenPadH * 2} />}
        skip={contentAtMount}
        testID="home-body"
        contentTestID="home-content"
      >
        {loadingStories ? null : (
          <>
            {featured ? (
              <Hero
                story={featured}
                shownLanguage={shownLanguage}
                width={windowWidth - T.screenPadH * 2}
                part={part}
                onOpen={openStory}
                onPlay={playFeatured}
              />
            ) : null}

            {!shelvesLoaded ? (
              <SkeletonPulse testID="home-tiles-loading">
                <View style={[styles.tilesRow, styles.tiles, styles.tileBones]}>
                  {[0, 1, 2].map(i => (
                    <Bone key={i} width={TILE_WIDTH} height={TILE_HEIGHT} radius={RADIUS.lg} lip={LIP.md} />
                  ))}
                </View>
              </SkeletonPulse>
            ) : tileCategories.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.tilesRow}
                contentContainerStyle={styles.tiles}
                testID="home-categories"
              >
                {tileCategories.map(category => (
                  <CategoryTile
                    key={category}
                    category={category}
                    label={storyShelfLabel(category)}
                    onPress={() => openCategory(category)}
                    testID={`home-category-${category}`}
                  />
                ))}
              </ScrollView>
            ) : null}

            {shownShelves.map(shelf => (
              <Shelf
                key={shelf.id}
                id={shelf.id}
                title={shelf.title}
                stories={shelf.stories}
                hasPremiumStories={hasPremiumStories}
                onSeeAll={seeAll}
                onOpen={openCover}
              />
            ))}

            {pendingShelves.length > 0 ? (
              <SkeletonPulse testID="home-shelves-loading">
                {pendingShelves.map(pending => (
                  <View
                    key={pending}
                    style={styles.shelfSkeleton}
                    testID={`home-shelf-${pending}-loading`}
                  >
                    <ShelfSkeleton
                      coverWidth={SHELF_COVER_WIDTH}
                      coverHeight={SHELF_COVER_HEIGHT}
                      covers={SHELF_INITIAL_COVERS}
                      titleLines={SHELF_TITLE_LINES}
                      testID={`home-shelf-${pending}-loading-bones`}
                    />
                  </View>
                ))}
              </SkeletonPulse>
            ) : null}

            {restReady && collections.length > 0 ? (
              <View testID="home-collections">
                <SectionHeader
                  title={t('shelves.collections')}
                  linkLabel={t('common:seeAll')}
                  linkAccessibilityLabel={t('a11y.seeAll', { shelf: t('shelves.collections') })}
                  onLinkPress={() => nav.navigate('Collections')}
                  testID="home-shelf-collections"
                  style={styles.shelfHeader}
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.collectionRow}
                >
                  {collections.map(collection => (
                    <Card
                      key={collection.id}
                      onPress={() => nav.navigate('CollectionDetail', { slug: collection.slug })}
                      accessibilityRole="button"
                      accessibilityLabel={collection.title}
                      testID={`home-collection-${collection.slug}`}
                      style={styles.collectionCardBox}
                      contentStyle={styles.collectionCard}
                    >
                      <View style={styles.collectionIcon}>
                        <Icon name="books" size={20} color={T.text2} />
                      </View>
                      <Text style={text.label} numberOfLines={2}>
                        {collection.title}
                      </Text>
                      {typeof collection.storyCount === 'number' ? (
                        <Text style={text.meta}>
                          {t('discover:collections.storyCount', { total: String(collection.storyCount) })}
                        </Text>
                      ) : null}
                    </Card>
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </>
        )}
      </SkeletonSwap>
    );
  }

  const onGreetingLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    setGreetingBottom(Math.round(y + height));
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: T.tabBarReservedHeight + miniPlayerInset }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            progressViewOffset={greetingBottom}
            tintColor={T.action}
            colors={[T.action]}
            progressBackgroundColor={T.surface}
          />
        }
        showsVerticalScrollIndicator={false}
        testID="home-scroll"
      >
        <View style={styles.greet} testID="home-greeting" onLayout={onGreetingLayout}>
          <View style={styles.greetText}>
            <Text accessibilityRole="header" style={styles.greetTitle} numberOfLines={2}>
              {greeting}
            </Text>
          </View>
          <TopBarAccount testIDPrefix="home" />
        </View>
        {body}
      </ScrollView>
    </View>
  );
});

// ─────────────────────────────────────────────────────────────
// Hero: "Bu gecenin masalı"
// ─────────────────────────────────────────────────────────────

interface HeroProps {
  story: Story;
  /** The content language: the language chip shows only for a story in another one. */
  shownLanguage: string;
  width: number;
  part: DayPart;
  onOpen: (story: Story) => void;
  onPlay: () => void;
}

/**
 * The hero's language chip: the level alone for a story in the content
 * language ("A1", nothing without a level), the language and its level for
 * one in another language ("English A1").
 */
export function heroLanguageChip(
  story: Pick<Story, 'language' | 'languageLevel'>,
  shownLanguage: string,
): string {
  const language =
    story.language && story.language !== shownLanguage ? contentLanguageNativeName(story.language) : '';
  return [language, story.languageLevel ?? ''].filter(Boolean).join(' ');
}

const Hero: React.FC<HeroProps> = ({ story, shownLanguage, width, part, onOpen, onPlay }) => {
  const T = useT();
  const styles = stylesFor(T);
  const { t } = useTranslation('home');
  const lip = coverLip(width);
  const { translateY, onPressIn, onPressOut } = usePressSink(lip);
  const chips = [
    storyDurationLabel(story.estimatedDuration),
    storyAgeLabel(story.ageGroup),
    heroLanguageChip(story, shownLanguage),
  ].filter(Boolean);
  return (
    <View style={styles.hero} testID="home-featured">
      <Pressable
        onPress={() => onOpen(story)}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        unstable_pressDelay={PRESS_DELAY_MS}
        accessibilityRole="button"
        accessibilityLabel={t('a11y.openStory', { title: story.title })}
        testID="home-featured-open"
      >
        <PictureCover
          story={story}
          width={width}
          height={HERO_HEIGHT}
          shape="wide"
          radius={HERO_RADIUS}
          sink={translateY}
        />
      </Pressable>
      {/* Drawn over the picture and sinking with it; only the play button takes touches. */}
      <Animated.View
        pointerEvents="box-none"
        style={[styles.heroOverlay, { width, transform: [{ translateY }] }]}
      >
        <LinearGradient
          pointerEvents="none"
          colors={[withAlpha(T.bg, 0), withAlpha(T.bar, 0.92)]}
          locations={[0.3, 1]}
          style={styles.heroShade}
        />
        <View pointerEvents="none" style={styles.heroTag} testID="home-featured-tag-box">
          <Tag
            label={t(featuredTagKey(part))}
            color={categoryColors(T, story.category).color}
            maxFontSizeMultiplier={HERO_TAG_MAX_SCALE}
            testID="home-featured-tag"
          />
        </View>
        <View pointerEvents="box-none" style={styles.heroBottom} testID="home-featured-bottom">
          <View pointerEvents="none" style={styles.heroText} testID="home-featured-text">
            {/* Two lines of the title at 1.2 times the font, the chips and
                the insets leave 8dp under the 28dp tag (184dp hero). */}
            <Text
              style={styles.heroTitle}
              numberOfLines={2}
              maxFontSizeMultiplier={HERO_TITLE_MAX_SCALE}
              testID="home-featured-title"
            >
              {story.title}
            </Text>
            <View style={styles.heroChips}>
              {chips.map(label => (
                <Tag key={label} label={label} tone="glass" maxFontSizeMultiplier={HERO_TAG_MAX_SCALE} />
              ))}
            </View>
          </View>
          <Tactile
            color={T.action}
            lipColor={T.actionLip}
            lip={LIP.md}
            radius={HERO_PLAY_SIZE / 2}
            onPress={onPlay}
            accessibilityLabel={t('featured.listenTo', { title: story.title })}
            testID="home-featured-listen"
            faceStyle={styles.play}
          >
            <Icon name="play" size={24} color={T.onAction} />
          </Tactile>
        </View>
      </Animated.View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// Shelf: a header and a horizontal list of covers. Memoised: with the same
// stories and the same (stable) handlers it does not render again when
// another shelf or the saved state of another story changes.
// ─────────────────────────────────────────────────────────────

interface ShelfProps {
  id: string;
  title: string;
  stories: readonly Story[];
  /** False: premium covers carry a lock. */
  hasPremiumStories: boolean;
  onSeeAll: (shelfId: string) => void;
  onOpen: (story: Story) => void;
}

const Shelf = React.memo(function Shelf({
  id,
  title,
  stories,
  hasPremiumStories,
  onSeeAll,
  onOpen,
}: ShelfProps) {
  const styles = stylesFor(useT());
  const { t } = useTranslation('home');
  const { fontScale, scale } = useWindowDimensions();
  const spread = useCoverSpread(stories);
  // A fixed height known before any cover renders: an off-screen cover with
  // a long title never makes the list taller (HOME-SHIFT); marks are on the cover.
  const listHeight = shelfListHeight(fontScale, scale);
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Story>) => (
      <ShelfCover
        story={item}
        placeholderIndex={spread.get(item.id)}
        locked={item.isPremium && !hasPremiumStories}
        onOpen={onOpen}
        testID={`home-tile-${item.id}`}
      />
    ),
    [spread, hasPremiumStories, onOpen],
  );
  if (stories.length === 0) return null;
  return (
    <View testID={`home-shelf-${id}`}>
      <SectionHeader
        title={title}
        linkLabel={t('common:seeAll')}
        linkAccessibilityLabel={t('a11y.seeAll', { shelf: title })}
        onLinkPress={() => onSeeAll(id)}
        testID={`home-shelf-${id}-header`}
        style={styles.shelfHeader}
      />
      <FlatList
        horizontal
        data={stories as Story[]}
        keyExtractor={storyKey}
        renderItem={renderItem}
        getItemLayout={shelfItemLayout}
        initialNumToRender={SHELF_INITIAL_COVERS}
        maxToRenderPerBatch={SHELF_INITIAL_COVERS}
        windowSize={3}
        showsHorizontalScrollIndicator={false}
        style={[styles.shelfList, { height: listHeight }]}
        contentContainerStyle={styles.shelfCovers}
        testID={`home-shelf-${id}-list`}
      />
    </View>
  );
});

const storyKey = (story: Story) => story.id;

// ─────────────────────────────────────────────────────────────
// Loading skeleton: the hero, the tiles and two shelves in their own shapes,
// places and lips, breathing, so nothing moves when the content arrives.
// ─────────────────────────────────────────────────────────────

const HomeSkeleton: React.FC<{ heroWidth: number }> = ({ heroWidth }) => {
  const styles = stylesFor(useT());
  return (
    <SkeletonPulse testID="home-loading">
      <View style={styles.hero}>
        <Bone width={heroWidth} height={HERO_HEIGHT} radius={HERO_RADIUS} lip={coverLip(heroWidth)} />
      </View>
      <View style={[styles.tilesRow, styles.tiles, styles.tileBones]}>
        {[0, 1, 2].map(i => (
          <Bone key={i} width={TILE_WIDTH} height={TILE_HEIGHT} radius={RADIUS.lg} lip={LIP.md} />
        ))}
      </View>
      {/* As tall as the real shelves (titles of SHELF_TITLE_LINES lines; no
          marks, the common case before anything is known). */}
      {[0, 1].map(i => (
        <View key={i} style={styles.shelfSkeleton} testID={`home-loading-shelf-${i}`}>
          <ShelfSkeleton
            coverWidth={SHELF_COVER_WIDTH}
            coverHeight={SHELF_COVER_HEIGHT}
            covers={SHELF_INITIAL_COVERS}
            titleLines={SHELF_TITLE_LINES}
            testID={`home-loading-shelf-${i}-bones`}
          />
        </View>
      ))}
    </SkeletonPulse>
  );
};

const stylesFor = themedStyles((T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    scroll: { flex: 1 },
    content: { flexGrow: 1 },
    greet: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: SPACE.md,
      paddingHorizontal: T.screenPadH,
      marginTop: SPACE.sm,
    },
    greetText: { flex: 1, minWidth: 0 },
    // The heading step (Baloo 2 21) on one compact line; 1.3 line height keeps
    // the glyphs whole on Android.
    greetTitle: {
      fontFamily: T.fontDisplay,
      fontSize: 21,
      lineHeight: 28,
      color: T.text,
    },
    hero: { marginTop: SPACE.lg, marginHorizontal: T.screenPadH },
    heroOverlay: {
      position: 'absolute',
      left: 0,
      top: 0,
      height: HERO_HEIGHT,
      borderRadius: HERO_RADIUS,
      overflow: 'hidden',
    },
    heroShade: { ...StyleSheet.absoluteFillObject },
    heroTag: { position: 'absolute', left: HERO_INSET, top: HERO_INSET },
    heroBottom: {
      position: 'absolute',
      left: HERO_INSET,
      right: HERO_INSET,
      bottom: HERO_INSET,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: SPACE.sm,
    },
    heroText: { flex: 1, minWidth: 0 },
    heroTitle: {
      fontFamily: T.fontDisplay,
      fontSize: 28,
      lineHeight: 37,
      color: T.text,
      marginBottom: SPACE.tight,
    },
    // One row of chips: a second row would push the title into the top tag.
    heroChips: { flexDirection: 'row', flexWrap: 'nowrap', gap: SPACE.tight, overflow: 'hidden' },
    play: {
      width: HERO_PLAY_SIZE,
      height: HERO_PLAY_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tilesRow: { marginTop: SPACE.lg },
    tiles: { paddingHorizontal: T.screenPadH, gap: SPACE.sm },
    tileBones: { flexDirection: 'row', overflow: 'hidden' },
    // Block to block 20, the header to its covers 12 (as ShelfSkeleton draws
    // it); the list's own height (shelfListHeight) ends at its tallest card,
    // so the next block starts 20 under it.
    shelfHeader: { marginTop: SPACE.xl, paddingHorizontal: T.screenPadH },
    shelfList: { marginTop: SPACE.md },
    shelfCovers: { paddingHorizontal: T.screenPadH, gap: SHELF_GAP, alignItems: 'flex-start' },
    shelfSkeleton: { marginTop: SPACE.xl },
    collectionRow: {
      paddingHorizontal: T.screenPadH,
      gap: SPACE.md,
      paddingTop: SPACE.md,
      paddingBottom: SPACE.xs,
    },
    collectionCardBox: { width: COLLECTION_CARD_WIDTH },
    collectionCard: { padding: SPACE.lg, gap: SPACE.tight, minHeight: 112 },
    collectionIcon: {
      width: 36,
      height: 36,
      borderRadius: RADIUS.sm,
      backgroundColor: T.surface2,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: SPACE.xxs,
    },
    state: { flex: 1 },
  }),
);

export default HomeScreen;
