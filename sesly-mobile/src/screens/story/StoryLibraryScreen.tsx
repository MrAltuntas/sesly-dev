/**
 * StoryLibraryScreen: the "Keşfet" tab (route `Discover`; design/v4/playful,
 * frame b).
 *
 *   - One header row, the only part that stays at the top: the tab title
 *     "Keşfet" in the same `TopAppBar variant="tab"` as Kütüphane and Sesim
 *     (Baloo 2 32), then a search icon button and the filters button.
 *   - Search behind its icon (owner feedback from a 360dp Redmi 8): a tap
 *     opens the search field (components/design/SearchField, 52dp on its
 *     lip) from the icon towards the left, over the title, and focuses it
 *     (the keyboard opens). The filters button stays beside it. Once open
 *     the field never folds by itself (losing focus or an emptied field keep
 *     it open): only its close tile, and the Android back button while it is
 *     empty, put it back into the icon. The reveal is a native-driven mask
 *     (`enter` / `exit`, at once under reduced motion with a short fade);
 *     the field is an overlay of the bar, so the list never moves. Its clear
 *     tile drops the term; there is no voice search, so no mic. The field owns what is
 *     typed: the term reaches the list 400 ms after the last key, or at once
 *     on the keyboard's search key (an emptied field at once too), and typing
 *     re-renders nothing else.
 *   - The filter card (`.card.filters`): one row per filter with its label
 *     at the left and `.fc` chips. "Dil" lists the catalogue languages as
 *     chips with their code (several can be picked) once there are two or
 *     more; with more languages than fit, it is one chip naming the picked
 *     ones ("Hepsi" without a pick) that opens the language sheet. "Seviye"
 *     lists the CEFR levels of the languages on screen (several), "Tür" the
 *     categories and "Yaş" the age groups (one each, "Hepsi" first). A row
 *     with nothing to pick is not drawn; Tür and Yaş rest while a term is
 *     searched (the search endpoint takes neither), and a line says so when
 *     one of them is picked.
 *   - The result header: "12 masal bulundu" while a card is a tale, "21
 *     sonuç bulundu" once languages are picked and a tale is listed once per
 *     language; the sort order at the right opens the sort sheet. While the
 *     first page loads the header keeps its place, so the grid never jumps.
 *   - A grid of cover cards (components/story/StoryCard), three columns on
 *     a phone, with the save bookmark on each cover (no long press, no card
 *     menu). A premium story carries its mark; on the free plan it is
 *     locked and a tap offers the plans (usePremiumGate).
 *
 * Filters on demand (owner feedback: the card took the screen, and the grid
 * slid under it before it went away):
 *   - The filter card is hidden by default. Open, it is plain list content:
 *     the first thing in the list header, above the result line, so it
 *     scrolls away with the grid under the header row like any card. There
 *     is no overlay and no spacer.
 *   - The filters button opens it. At the top of the list it comes in from
 *     above as it fades in while the result line and the rows of the grid
 *     slide down to make room; closing, it fades out upwards and they slide
 *     back up into its place (owner: "animasyonlu gitsin gelsin"). All of it
 *     runs on the UI thread as Reanimated layout animations: the card's
 *     `entering` / `exiting`, and a `LinearTransition` on the blocks of the
 *     list header and on every row (`itemLayoutAnimation` of the
 *     Reanimated FlatList), so no height is animated and nothing is laid
 *     out again per frame. Further down the list first scrolls to the top
 *     and the card opens once it is there, so nothing is inserted above the
 *     rows on screen. A second tap closes it while any of it is in view;
 *     scrolled out of sight, a tap scrolls back up to it. Under reduced
 *     motion nothing moves: the jump to the top, the card and the rows are
 *     instant.
 *   - While the card is not in view the button carries the number of picks
 *     in a count bubble and says so to screen readers ("Filtreleri göster, 2
 *     filtre seçili"); open, its glyph takes the action colour.
 *   - Closed with picks, one compact row of removable chips sits at the top
 *     of the list (one per pick with a close mark, and "Temizle" from two
 *     picks), so what narrows the list is always visible and one tap away.
 *
 * The result line and the grid scroll together. The list, its scope
 * and pagination live in DiscoverStore (useDiscover). Coming back to the tab
 * writes the saves made elsewhere into the rows without a request
 * (useSavedMarksOnFocus). The file keeps its old name because the navigators
 * import it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  type FlatList,
  LayoutChangeEvent,
  ListRenderItemInfo,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Reanimated, {
  Easing as ReanimatedEasing,
  FadeIn as FadeInLayout,
  FadeInUp,
  FadeOut,
  FadeOutUp,
  LinearTransition,
} from 'react-native-reanimated';
import { observer } from 'mobx-react-lite';
import { reaction } from 'mobx';
import {
  RouteProp,
  useIsFocused,
  useNavigation,
  useRoute,
  useScrollToTop,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import {
  Card,
  CategoryDot,
  Chip,
  FadeIn,
  Icon,
  IconButton,
  ProgressBar,
  SearchField,
  Spinner,
  StateView,
  TopAppBar,
  useCoverSpread,
  usePressTint,
} from '../../components/design';
import {
  GRID_COLUMN_GAP,
  GRID_ROW_GAP,
  StoryCard,
  StoryGridSkeleton,
  useStoryGrid,
} from '../../components/story/StoryCard';
import {
  LanguageFilterSheet,
  SortSheet,
  filterChipLabel,
  sortLabel,
} from '../../components/story/FilterSheets';
import { useListSaveToggle } from '../../components/story/saveFeedback';
import { usePremiumGate } from '../../components/story/usePremiumGate';
import { useSavedMarksOnFocus } from '../../components/story/useSavedMarksOnFocus';
import { useMiniPlayerInset } from '../../components/audio/useMiniPlayerInset';
import { RADIUS, SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { CURVE, DURATION, animateTo, useReducedMotion } from '../../theme/motion';
import {
  DISCOVER_AGE_GROUPS,
  DISCOVER_SORTS,
  DiscoverStore,
  useDiscover,
} from '../../hooks/useDiscover';
import { useStory } from '../../hooks/useStory';
import { contentLanguageLabel, useContentLanguage } from '../../hooks/useContentLanguage';
import type { Story } from '../../models/Story';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import type { MainTabParamList } from '../main/MainScaffold';
import { storyAgeLabel, storyShelfLabel } from '../../utils/storyLabels';
import { StoryCategory } from '../../types/enums';
import { languageCodeLabel } from '../../i18n/text';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type OpenSheet = 'language' | 'sort' | null;

export const SEARCH_DEBOUNCE_MS = 400;

/** Languages shown as chips on the "Dil" row; more open the language sheet. */
export const INLINE_LANGUAGE_LIMIT = 3;
/**
 * Width of the filter row labels ("Dil", "Seviye", "Yaş"). "Language" is
 * 58dp in Nunito 800 12.5, so 68 holds it up to the 1.15 font scale the
 * label allows (FILTER_LABEL_MAX_SCALE).
 */
export const FILTER_LABEL_WIDTH = 68;
/** The filter labels stop growing here, so "Language" never clips. */
export const FILTER_LABEL_MAX_SCALE = 1.15;
/** Space between two filter chips (`.frow` gap). */
export const CHIP_GAP = SPACE.tight;
/** Edge of the tactile search and filters buttons of the header row (IconButton). */
export const HEADER_BUTTON_SIZE = 44;
/**
 * Room the open search field leaves at the right of the header row: the
 * filters button and the gap before it, so the filters stay reachable.
 */
export const SEARCH_OVERLAY_END = HEADER_BUTTON_SIZE + SPACE.sm;

// ── The filter card's motion (Reanimated layout animations, UI thread) ──
const MOVE_EASING = ReanimatedEasing.bezier(...CURVE.standard);
const LEAVE_EASING = ReanimatedEasing.bezier(...CURVE.exit);
/** The card opens: it comes down from above (a short slide) as it fades in. */
export const PANEL_ENTERING = FadeInUp.duration(DURATION.enter).easing(MOVE_EASING);
/** The card closes: it fades out upwards while the rows take its place. */
export const PANEL_EXITING = FadeOutUp.duration(DURATION.exit).easing(LEAVE_EASING);
/**
 * The blocks under the card and every row of the grid move to their new
 * place in step with the card instead of jumping (frames set natively, no
 * layout per frame).
 */
export const LIST_MOVE = LinearTransition.duration(DURATION.enter).easing(MOVE_EASING);
/** The picks of a closed card come and go with a fade. */
export const PICKS_ENTERING = FadeInLayout.duration(DURATION.enter).easing(MOVE_EASING);
export const PICKS_EXITING = FadeOut.duration(DURATION.exit).easing(LEAVE_EASING);

/**
 * Picks that narrow the list: every picked language (not the default
 * content language), every level, a category, an age group.
 */
export function activeFilterCount(store: {
  languages: readonly string[];
  languageFilterActive: boolean;
  levels: readonly string[];
  category: string | null;
  ageGroup: string | null;
}): number {
  return (
    (store.languageFilterActive ? store.languages.length : 0) +
    store.levels.length +
    (store.category !== null ? 1 : 0) +
    (store.ageGroup !== null ? 1 : 0)
  );
}

/**
 * Whether the list at scroll offset `y` is at its top: the open card, or the
 * place it opens in, is in view from its first line (half a dp of rounding).
 */
export function isAtListTop(y: number): boolean {
  return y < 1;
}

/**
 * Whether an open filter card of `panelHeight` (it starts the list) has
 * scrolled out of sight at offset `y`. Before it is measured only the top
 * counts as in view.
 */
export function isPanelOutOfView(y: number, panelHeight: number): boolean {
  return panelHeight > 0 ? y >= panelHeight : !isAtListTop(y);
}

/** One pick, as a removable chip of the row above the result line. */
export interface ActiveFilter {
  key: string;
  label: string;
  remove: () => void;
}

/** The categories of the "Tür" row, in the order of the home tiles. */
export const DISCOVER_CATEGORIES: readonly string[] = [
  StoryCategory.BEDTIME,
  StoryCategory.TURKISH_CLASSICS,
  StoryCategory.WORLD_CLASSICS,
  StoryCategory.EDUCATIONAL,
];

const keyOf = (story: Story) => story.id;

export const StoryLibraryScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const isFocused = useIsFocused();
  const T = useT();
  const { t } = useTranslation('discover');
  const styles = stylesFor(T);

  const store = useDiscover();
  const storyStore = useStory();
  const contentLanguage = useContentLanguage();
  const gate = usePremiumGate();
  const miniPlayerInset = useMiniPlayerInset();
  const { columns, cardWidth } = useStoryGrid();

  const listRef = useRef<FlatList<Story>>(null);
  useScrollToTop(listRef);

  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [refreshing, setRefreshing] = useState(false);

  // ── Search behind its icon ──
  // Open from the icon (or with a term kept from an earlier visit); only
  // the field's close tile and the back button fold it (DiscoverSearch).
  const [searchOpen, setSearchOpen] = useState(() => store.query.trim() !== '');
  const searchInput = useRef<TextInput>(null);
  // Focus once the field is open: while folded it takes no touches, and a
  // field focused in that state loses the focus (and the keyboard) at once.
  const focusOnOpen = useRef(false);
  const openSearch = useCallback(() => {
    focusOnOpen.current = true;
    setSearchOpen(true);
  }, []);
  useEffect(() => {
    if (!searchOpen || !focusOnOpen.current) return undefined;
    focusOnOpen.current = false;
    const frame = requestAnimationFrame(() => searchInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [searchOpen]);
  const expandSearch = useCallback(() => setSearchOpen(true), []);
  const collapseSearch = useCallback(() => {
    setSearchOpen(false);
    searchInput.current?.blur();
  }, []);

  // ── Filters on demand ──
  const reduced = useReducedMotion();
  // Hidden by default; open, the card is the start of the list content.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The open card has scrolled out of sight (the button then shows the
  // count and brings it back). Changes only when the list crosses its edge.
  const [panelOutOfView, setPanelOutOfView] = useState(false);
  const scrollY = useRef(0);
  const panelHeight = useRef(0);
  // A tap further down scrolls to the top first; the card opens on arrival.
  const openOnArrival = useRef(false);
  // The card comes and goes while the rows slide; under reduced motion
  // nothing moves and every change is instant.
  const panelEntering = reduced ? undefined : PANEL_ENTERING;
  const panelExiting = reduced ? undefined : PANEL_EXITING;
  const listMove = reduced ? undefined : LIST_MOVE;
  const picksEntering = reduced ? undefined : PICKS_ENTERING;
  const picksExiting = reduced ? undefined : PICKS_EXITING;

  const showOutOfView = useCallback((next: boolean) => {
    setPanelOutOfView(current => (current === next ? current : next));
  }, []);

  const openFilters = useCallback(() => {
    openOnArrival.current = false;
    setFiltersOpen(true);
    showOutOfView(false);
  }, [showOutOfView]);

  const onPanelLayout = useCallback((event: LayoutChangeEvent) => {
    // Its bottom in the content: the card under its small top margin.
    panelHeight.current = Math.round(event.nativeEvent.layout.height) + SPACE.xs;
  }, []);

  const onListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      scrollY.current = y;
      if (openOnArrival.current) {
        if (isAtListTop(y)) openFilters();
        return;
      }
      showOutOfView(isPanelOutOfView(y, panelHeight.current));
    },
    [openFilters, showOutOfView],
  );
  // A finger on the grid takes over from the scroll a tap started: the card
  // stays closed (opening it now would push the rows on screen down).
  const onScrollBeginDrag = useCallback(() => {
    openOnArrival.current = false;
  }, []);

  const panelShown = filtersOpen && !panelOutOfView;
  const toggleFilters = useCallback(() => {
    if (panelShown) {
      // Closing removes the card from the content; the rows move up into
      // its place, as when a card at the top of any list goes away.
      setFiltersOpen(false);
      panelHeight.current = 0;
      showOutOfView(!isAtListTop(scrollY.current));
      return;
    }
    if (isAtListTop(scrollY.current)) {
      openFilters();
      return;
    }
    // Further down: to the top first, so nothing is inserted above the rows
    // on screen. Under reduced motion the jump is instant and the card opens
    // with it.
    listRef.current?.scrollToOffset({ offset: 0, animated: !reduced });
    if (reduced) {
      scrollY.current = 0;
      openFilters();
    } else if (!filtersOpen) {
      openOnArrival.current = true;
    }
  }, [panelShown, filtersOpen, reduced, openFilters, showOutOfView]);
  const route = useRoute<RouteProp<MainTabParamList, 'Discover'>>();
  const requestedCategory = route.params?.category;

  // Opened from a home category tile: show that category once (the term
  // and the other filters go, so it never opens filtered to nothing), then
  // forget the request so coming back to the tab does not filter again.
  useEffect(() => {
    if (!requestedCategory) return;
    store.showCategory(requestedCategory);
    nav.setParams?.({ category: undefined } as never);
  }, [requestedCategory, store, nav]);

  // First load, and the options of the Dil and Seviye rows.
  useEffect(() => {
    void contentLanguage.load();
    if (!store.hasLoaded && !store.isLoading) void store.load();
    // Mount only: the stores are singletons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The default Dil filter is the content language, and a grouped list
  // picks its versions on the server from it: both are fetched again when
  // "Masal dili" (or, without a pick, the UI language) changes.
  useEffect(
    () => reaction(() => contentLanguage.effective, () => store.contentLanguageChanged()),
    [contentLanguage, store],
  );

  // Coming back to the tab: the saves made on a story page or in the
  // library are written into the rows, without a request.
  useSavedMarksOnFocus(store, storyStore, isFocused);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([store.refresh(), contentLanguage.load(true)]);
    } finally {
      setRefreshing(false);
    }
  }, [store, contentLanguage]);

  const handleClear = useCallback(() => store.clearFilters(), [store]);
  const showAllLanguages = useCallback(() => store.showAllLanguages(), [store]);
  const clearSearch = useCallback(() => store.setQuery(''), [store]);
  const retry = useCallback(() => void store.load(), [store]);
  const loadMore = useCallback(() => void store.loadMore(), [store]);

  const openLibrary = useCallback(() => nav.navigate('Main', { screen: 'Library' }), [nav]);
  const toggleSave = useListSaveToggle(store, storyStore, openLibrary);
  const openStory = useCallback(
    (story: Story) => {
      if (gate.isLocked(story)) {
        gate.showPlans();
        return;
      }
      nav.navigate('StoryDetail', { storyId: story.id });
    },
    [gate, nav],
  );

  const items = store.items;
  const spread = useCoverSpread(items);
  const showList = items.length > 0;
  const firstLoad = !store.hasLoaded || (store.isLoading && !showList && !refreshing);

  // The first grid after the skeleton fades in once; a list kept from an
  // earlier visit, later pages and new results show at once.
  const fadeGrid = useRef(!showList);
  useEffect(() => {
    if (showList) fadeGrid.current = false;
  }, [showList]);

  // A card names its language only where that says something: a story in
  // another language than the content language.
  const shownLanguage = contentLanguage.effective;
  const locksPremium = gate.locksPremium;
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Story>) => (
      <FadeIn skip={!fadeGrid.current}>
        <StoryCard
          story={item}
          width={cardWidth}
          languages={item.language !== shownLanguage ? 'own' : 'all'}
          placeholderIndex={spread.get(item.id)}
          onPress={openStory}
          onToggleSave={toggleSave}
          premium={item.isPremium}
          locked={locksPremium && item.isPremium}
        />
      </FadeIn>
    ),
    [cardWidth, shownLanguage, spread, openStory, toggleSave, locksPremium],
  );

  // ── Filter options, in catalogue order ──
  const languageOptions = contentLanguage.languagesWithStories;
  // Languages picked that the catalogue no longer lists stay visible, so
  // they can be cleared.
  const languageChips = [
    ...languageOptions.map(language => ({ code: language.code, name: language.nativeName })),
    ...store.languages
      .filter(code => !languageOptions.some(language => language.code === code))
      .map(code => ({ code, name: contentLanguage.nativeName(code) })),
  ];
  // Levels of the languages on screen: the picked ones, else the whole
  // catalogue. No level there means no Seviye row (a dimmed, dead row read
  // as broken); a level that is still picked keeps it, so it can be cleared.
  const levelOptions = contentLanguage.levelsFor(store.languages);
  const levelChips = [
    ...levelOptions,
    ...store.levels.filter(level => !levelOptions.includes(level)),
  ];
  // One catalogue language is no choice: picking it would only switch to an
  // identical list. A pick keeps the row, so it can be cleared.
  const showLanguageRow = languageChips.length > 1 || store.languageFilterActive;
  const showLevelRow = levelChips.length > 0;
  // The search endpoint takes no age group and no category, so these rows
  // rest while a term is active.
  const showAgeRow = !store.isSearching;
  const showCategoryRow = !store.isSearching;
  const languagesInSheet = languageChips.length > INLINE_LANGUAGE_LIMIT;
  const pickedLanguageNames = languageChips
    .filter(language => store.languages.includes(language.code))
    .map(language => language.name);
  const searchIgnoresPicks =
    store.isSearching && (store.ageGroup !== null || store.category !== null);

  let emptyBody: React.ReactNode;
  if (firstLoad) {
    emptyBody = <StoryGridSkeleton testID="discover-loading" />;
  } else if (store.hasError) {
    const offline = store.listErrorKind === 'offline';
    emptyBody = (
      <StateView
        testID="discover-error"
        icon={offline ? 'wifiOff' : 'alert'}
        title={offline ? t('states:offline.title') : t('error.title')}
        message={offline ? t('states:offline.message') : t('error.message')}
        actionLabel={t('common:retry')}
        onAction={retry}
        style={styles.state}
      />
    );
  } else if (store.canWidenSearch && !store.languageFilterActive && !store.hasFilters) {
    // A search in the default language found nothing: the tale may exist
    // in another one, so every language is offered first.
    emptyBody = (
      <StateView
        testID="discover-no-results"
        icon="search"
        title={t('empty.title')}
        message={t('empty.languageMessage', { language: contentLanguageLabel(store.languages[0]) })}
        actionLabel={t('search.allLanguages')}
        onAction={showAllLanguages}
        style={styles.state}
      />
    );
  } else if (store.isSearching || store.hasFilters) {
    // A plain search clears only its term; filters (with or without a
    // term) clear everything.
    const termOnly = store.isSearching && !store.hasFilters;
    emptyBody = (
      <StateView
        testID="discover-no-results"
        icon="search"
        title={t('empty.title')}
        message={t('empty.message')}
        actionLabel={t(
          termOnly ? 'search.clear' : store.isSearching ? 'filters.clearAll' : 'filters.clear',
        )}
        onAction={termOnly ? clearSearch : handleClear}
        style={styles.state}
      />
    );
  } else {
    emptyBody = (
      <StateView
        testID="discover-empty"
        icon="book"
        title={t('empty.catalogueTitle')}
        message={t('empty.catalogueMessage')}
        style={styles.state}
      />
    );
  }

  const updating = showList && store.isLoading && !refreshing;

  const activeFilters = activeFilterCount(store);
  // Out of view, the button says how many picks narrow the list.
  const hiddenPicks = panelShown ? 0 : activeFilters;
  const toggleLabel = [
    t(panelShown ? 'filters.hide' : 'filters.show'),
    hiddenPicks === 1
      ? t('filters.activeOne')
      : hiddenPicks > 1
        ? t('filters.active', { n: String(hiddenPicks) })
        : null,
  ]
    .filter(Boolean)
    .join(', ');

  // The picks of a closed card, in the order of its rows.
  const picks: ActiveFilter[] = filtersOpen
    ? []
    : [
        ...(store.languageFilterActive ? store.languages : []).map(code => ({
          key: `language-${code}`,
          label:
            languageChips.find(language => language.code === code)?.name ??
            contentLanguage.nativeName(code),
          remove: () => store.toggleLanguage(code),
        })),
        ...store.levels.map(level => ({
          key: `level-${level}`,
          label: level,
          remove: () => store.toggleLevel(level),
        })),
        ...(store.category !== null
          ? [{ key: 'category', label: storyShelfLabel(store.category), remove: () => store.setCategory(null) }]
          : []),
        ...(store.ageGroup !== null
          ? [{ key: 'age', label: storyAgeLabel(store.ageGroup), remove: () => store.setAgeGroup(null) }]
          : []),
      ];

  // The one sticky part: the tab title of Kütüphane and Sesim, the search
  // icon and the filters button on one line; the search field opens over
  // the title. The list scrolls up under it.
  const top = (
    <View testID="discover-top">
      <TopAppBar
        variant="tab"
        title={t('title')}
        trailing={
          <View style={styles.actions} testID="discover-actions">
            {/* Under the open field: neither a target nor read out then. */}
            <View
              accessibilityElementsHidden={searchOpen}
              importantForAccessibility={searchOpen ? 'no-hide-descendants' : 'auto'}
              testID="discover-search-toggle"
            >
              <IconButton
                variant="tactile"
                icon="search"
                onPress={openSearch}
                accessibilityLabel={t('search.open')}
                pressDelay={0}
                testID="discover-search-open"
              />
            </View>
            <IconButton
              variant="tactile"
              icon="sliders"
              color={filtersOpen ? T.action : undefined}
              onPress={toggleFilters}
              accessibilityLabel={toggleLabel}
              badgeCount={hiddenPicks}
              countInLabel
              pressDelay={0}
              testID="discover-filters-toggle"
            />
          </View>
        }
        overlay={
          <DiscoverSearch
            store={store}
            open={searchOpen}
            inputRef={searchInput}
            onExpand={expandSearch}
            onCollapse={collapseSearch}
          />
        }
      />
    </View>
  );

  // The open filter card: the first thing in the list, so it scrolls away
  // with the grid. It comes in from above and leaves upwards (UI thread).
  const panel = filtersOpen ? (
    <Reanimated.View
      entering={panelEntering}
      exiting={panelExiting}
      // While it fades, the card is composited as one layer (its lip never
      // shows through the face).
      needsOffscreenAlphaCompositing
      style={styles.panel}
      testID="discover-panel"
    >
      <View onLayout={onPanelLayout} testID="discover-panel-body">
        {showLanguageRow || showLevelRow || showAgeRow || showCategoryRow ? (
          <Card clip contentStyle={styles.filters} testID="discover-filters">
            {showLanguageRow ? (
              <FilterRow label={t('filters.language')} testID="discover-row-language">
                {languagesInSheet ? (
                  <Chip
                    kind="filter"
                    label={
                      pickedLanguageNames.length > 0
                        ? pickedLanguageNames.join(', ')
                        : t('filters.allAges')
                    }
                    accessibilityLabel={filterChipLabel(t('filters.language'), pickedLanguageNames)}
                    selected={store.languages.length > 0}
                    onPress={() => setSheet('language')}
                    testID="discover-chip-language"
                  />
                ) : (
                  languageChips.map(language => {
                    const picked = store.languages.includes(language.code);
                    return (
                      <Chip
                        key={language.code}
                        label={language.name}
                        role="checkbox"
                        selected={picked}
                        leading={<CodeBadge code={language.code} picked={picked} />}
                        onPress={() => store.toggleLanguage(language.code)}
                        testID={`discover-language-${language.code}`}
                      />
                    );
                  })
                )}
              </FilterRow>
            ) : null}
            {showLevelRow ? (
              <FilterRow label={t('filters.level')} testID="discover-row-level">
                {levelChips.map(level => (
                  <Chip
                    key={level}
                    label={level}
                    square
                    role="checkbox"
                    selected={store.levels.includes(level)}
                    onPress={() => store.toggleLevel(level)}
                    testID={`discover-level-${level}`}
                  />
                ))}
              </FilterRow>
            ) : null}
            {showCategoryRow ? (
              <FilterRow label={t('filters.category')} testID="discover-row-category">
                <Chip
                  label={t('filters.allAges')}
                  selected={store.category === null}
                  onPress={() => store.setCategory(null)}
                  testID="discover-category-all"
                />
                {DISCOVER_CATEGORIES.map(category => {
                  const picked = store.category === category;
                  return (
                    <Chip
                      key={category}
                      label={storyShelfLabel(category)}
                      selected={picked}
                      leading={<CategoryDot category={category} size={8} />}
                      // Tapping the picked category shows every category again.
                      onPress={() => store.setCategory(picked ? null : category)}
                      testID={`discover-category-${category}`}
                    />
                  );
                })}
              </FilterRow>
            ) : null}
            {showAgeRow ? (
              <FilterRow label={t('filters.age')} testID="discover-row-age">
                <Chip
                  label={t('filters.allAges')}
                  selected={store.ageGroup === null}
                  onPress={() => store.setAgeGroup(null)}
                  testID="discover-age-all"
                />
                {DISCOVER_AGE_GROUPS.map(ageGroup => {
                  const picked = store.ageGroup === ageGroup;
                  return (
                    <Chip
                      key={ageGroup}
                      label={storyAgeLabel(ageGroup)}
                      selected={picked}
                      onPress={() => store.setAgeGroup(picked ? null : ageGroup)}
                      testID={`discover-age-${ageGroup}`}
                    />
                  );
                })}
              </FilterRow>
            ) : null}
          </Card>
        ) : null}
      </View>
    </Reanimated.View>
  ) : null;

  // A closed card with picks: one compact row of them, each removed by a
  // tap, "Temizle" from two on. It scrolls to the screen edges (the wrapper
  // reaches them, so every chip stays a target on Android).
  const pickRow =
    picks.length > 0 ? (
      <Reanimated.View
        entering={picksEntering}
        exiting={picksExiting}
        layout={listMove}
        style={styles.picks}
        testID="discover-active-filters-row"
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.picksContent}
          testID="discover-active-filters"
        >
          {picks.map(pick => (
            <Chip
              key={pick.key}
              label={pick.label}
              role="button"
              selected
              trailing={<Icon name="close" size={16} color={T.onAction} />}
              accessibilityLabel={t('filters.remove', { name: pick.label })}
              onPress={pick.remove}
              testID={`discover-active-${pick.key}`}
            />
          ))}
          {picks.length > 1 ? (
            <Chip
              label={t('filters.clearShort')}
              role="button"
              accessibilityLabel={t('filters.clear')}
              onPress={handleClear}
              testID="discover-active-clear"
            />
          ) : null}
        </ScrollView>
      </Reanimated.View>
    ) : null;

  // The start of the list: the open card or the picks, then the result line.
  // Each block under the card slides to its new place with the rows.
  const header = (
    <View style={styles.header} testID="discover-list-header">
      {panel ?? pickRow}

      {searchIgnoresPicks ? (
        <Reanimated.Text layout={listMove} style={styles.note} testID="discover-search-note">
          {t('search.ignoresFilters')}
        </Reanimated.Text>
      ) : null}

      {/* The result line and the progress slot keep their place from the
          first frame (an empty line while the skeleton shows), so the grid
          starts where the skeleton did. */}
      {showList || firstLoad ? (
        <Reanimated.View
          layout={listMove}
          style={[styles.resultLine, panel || pickRow || searchIgnoresPicks ? styles.resultLineAfter : null]}
          testID="discover-result-line"
        >
          {showList ? (
            <>
              <Text
                style={[styles.count, updating ? styles.countUpdating : null]}
                testID={updating ? 'discover-count-updating' : 'discover-count'}
              >
                {updating
                  ? t('common:loading')
                  : t(store.isFlat ? 'count.results' : 'count.tales', { total: String(store.total) })}
              </Text>
              {store.isSearching ? null : (
                <SortButton
                  label={sortLabel(store.sort)}
                  a11yLabel={t('sort.label', { value: sortLabel(store.sort) })}
                  onPress={() => setSheet('sort')}
                />
              )}
            </>
          ) : null}
        </Reanimated.View>
      ) : null}
      {showList || firstLoad ? (
        // New results on the way: the grid stays as it is (never dimmed) and
        // a thin bar runs in a slot that is always there, so nothing moves.
        <Reanimated.View layout={listMove} style={styles.updatingSlot}>
          {updating ? (
            <ProgressBar height={3} accessibilityLabel={t('common:loading')} testID="discover-updating" />
          ) : null}
        </Reanimated.View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      {top}
      <View style={styles.listArea}>
        {/* Reanimated's FlatList: every row is a cell with `layout`, so the
            rows slide when the card opens or closes above them. */}
        <Reanimated.FlatList
          ref={listRef}
          key={`grid-${columns}`}
          data={items}
          numColumns={columns}
          keyExtractor={keyOf}
          renderItem={renderItem}
          itemLayoutAnimation={listMove}
          ListHeaderComponent={header}
          onScroll={onListScroll}
          onScrollBeginDrag={onScrollBeginDrag}
          scrollEventThrottle={16}
          columnWrapperStyle={styles.gridRow}
          ItemSeparatorComponent={GridRowGap}
          ListEmptyComponent={
            <Reanimated.View layout={listMove} style={styles.emptyWrap}>
              {emptyBody}
            </Reanimated.View>
          }
          ListFooterComponent={
            store.isLoadingMore ? (
              <View style={styles.footer} testID="discover-loading-more">
                <Spinner color={T.text2} />
              </View>
            ) : null
          }
          style={styles.list}
          contentContainerStyle={{
            flexGrow: 1,
            paddingBottom: T.tabBarReservedHeight + miniPlayerInset,
          }}
          initialNumToRender={4}
          maxToRenderPerBatch={3}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={T.action}
              colors={[T.action]}
              progressBackgroundColor={T.surface}
            />
          }
          testID="discover-list"
        />
      </View>

      <LanguageFilterSheet
        visible={sheet === 'language'}
        onClose={() => setSheet(null)}
        languages={languageChips.map(language => ({ code: language.code, nativeName: language.name }))}
        selected={store.languages}
        onToggle={code => store.toggleLanguage(code)}
      />
      <SortSheet
        visible={sheet === 'sort'}
        onClose={() => setSheet(null)}
        sorts={DISCOVER_SORTS}
        selected={store.sort}
        onSelect={sort => store.setSort(sort)}
      />
    </View>
  );
});

interface DiscoverSearchProps {
  store: DiscoverStore;
  /** Unfolded over the title. */
  open: boolean;
  inputRef: React.RefObject<TextInput | null>;
  /** The field got focus (from the icon, or a screen reader). */
  onExpand: () => void;
  /** Fold back into the icon (and drop the focus). */
  onCollapse: () => void;
}

/**
 * The search field of Keşfet, an overlay of the header row from its left
 * edge to the filters button. It is always mounted (so the icon's tap can
 * focus it at once); folded it is invisible, takes no touches and is hidden
 * from screen readers.
 *
 * It owns what is typed, so a key press re-renders only this field (not the
 * grid): the term reaches the store SEARCH_DEBOUNCE_MS after the last key,
 * or at once on the search key. It empties itself when the store drops its
 * term (a category from Home, "Filtreleri temizle"). It never folds by
 * itself: only its close tile and the back button (while empty) put it
 * back behind the icon, so losing focus or an empty field keep it open.
 *
 * The reveal runs from the icon towards the left: the mask slides left from
 * the icon's place while the field inside slides the other way by as much,
 * so the field stands still and its left edge grows out (native driver,
 * transforms only).
 */
const DiscoverSearch: React.FC<DiscoverSearchProps> = observer(
  ({ store, open, inputRef, onExpand, onCollapse }) => {
    const { t } = useTranslation('discover');
    const styles = stylesFor(useT());
    const reduced = useReducedMotion();
    const isFocused = useIsFocused();
    const [value, setValue] = useState(store.query);
    const query = store.query;
    const valueRef = useRef(value);
    useEffect(() => {
      valueRef.current = value;
    }, [value]);

    // Empty or blank: drop what is left and fold back.
    const fold = useCallback(() => {
      if (valueRef.current !== '') {
        valueRef.current = '';
        setValue('');
        store.setQuery('');
      }
      onCollapse();
    }, [store, onCollapse]);

    // The store dropped its term: the field empties and stays as it is.
    useEffect(() => {
      if (query) return;
      setValue('');
      valueRef.current = '';
    }, [query]);

    useEffect(() => {
      if (value.trim() === store.searchTerm) return undefined;
      const timer = setTimeout(() => store.setQuery(value), SEARCH_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    }, [value, store]);

    const submit = useCallback(() => store.setQuery(value), [store, value]);
    // An emptied field (the clear tile, or the last key deleted) shows the
    // whole list at once; only a term waits for the debounce.
    const change = useCallback(
      (next: string) => {
        setValue(next);
        valueRef.current = next;
        if (next === '') store.setQuery('');
      },
      [store],
    );

    // Android back folds an empty (or blank) field first; with a term it is
    // the tab's.
    useEffect(() => {
      if (!open || !isFocused) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (valueRef.current.trim() !== '') return false;
        fold();
        return true;
      });
      return () => sub.remove();
    }, [open, isFocused, fold]);

    // ── The reveal ──
    const [width, setWidth] = useState(0);
    const reveal = useRef(new Animated.Value(open ? 1 : 0)).current;
    const fade = useRef(new Animated.Value(open ? 1 : 0)).current;
    const shown = useRef(open);
    useEffect(() => {
      if (shown.current === open) return;
      shown.current = open;
      animateTo(reveal, open ? 1 : 0, open ? 'enter' : 'exit', reduced);
      animateTo(fade, open ? 1 : 0, open ? 'fast' : 'exit', reduced, { fade: true });
    }, [open, reduced, reveal, fade]);
    useEffect(
      () => () => {
        reveal.stopAnimation();
        fade.stopAnimation();
      },
      [reveal, fade],
    );
    // Folded, only the icon's width of the mask is left, at the right.
    const hidden = Math.max(0, width - HEADER_BUTTON_SIZE);
    const maskX = useMemo(
      () => reveal.interpolate({ inputRange: [0, 1], outputRange: [hidden, 0] }),
      [reveal, hidden],
    );
    const fieldX = useMemo(
      () => reveal.interpolate({ inputRange: [0, 1], outputRange: [-hidden, 0] }),
      [reveal, hidden],
    );
    const onLayout = useCallback((event: LayoutChangeEvent) => {
      const next = Math.round(event.nativeEvent.layout.width);
      setWidth(current => (current === next ? current : next));
    }, []);

    return (
      <View
        pointerEvents={open ? 'box-none' : 'none'}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
        onLayout={onLayout}
        style={styles.searchOverlay}
        testID="discover-search-overlay"
      >
        <Animated.View
          style={[styles.searchMask, { opacity: fade, transform: [{ translateX: maskX }] }]}
          testID="discover-search-mask"
        >
          <Animated.View
            style={[styles.searchSlide, { transform: [{ translateX: fieldX }] }]}
            testID="discover-search-slide"
          >
            <SearchField
              inputRef={inputRef}
              value={value}
              onChangeText={change}
              onSubmitEditing={submit}
              onFocus={onExpand}
              onClose={fold}
              placeholder={t('search.placeholder')}
              accessibilityLabel={t('search.label')}
              clearLabel={t('search.clear')}
              closeLabel={t('search.close')}
              testID="discover-search"
            />
          </Animated.View>
        </Animated.View>
      </View>
    );
  },
);

/** The sort order at the right of the result line; dims while held. */
const SortButton: React.FC<{ label: string; a11yLabel: string; onPress: () => void }> = ({
  label,
  a11yLabel,
  onPress,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const { opacity, onPressIn, onPressOut } = usePressTint();
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
      testID="discover-sort"
    >
      <Animated.View style={[styles.sort, { opacity }]}>
        <Icon name="sort" size={20} color={T.text2} />
        <Text style={styles.sortLabel}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
};

const GridRowGap: React.FC = () => <View style={{ height: GRID_ROW_GAP }} />;

/** One row of the filter card (`.frow`): the label, then its chips. */
const FilterRow: React.FC<{ label: string; testID: string; children: React.ReactNode }> = ({
  label,
  testID,
  children,
}) => {
  const styles = stylesFor(useT());
  return (
    <View style={styles.filterRow} testID={testID}>
      <Text style={styles.filterLabel} numberOfLines={1} maxFontSizeMultiplier={FILTER_LABEL_MAX_SCALE}>
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={styles.filterScroll}
        contentContainerStyle={styles.filterChips}
      >
        {children}
      </ScrollView>
    </View>
  );
};

/** The language code in a language chip (`.fc .lg`). */
const CodeBadge: React.FC<{ code: string; picked: boolean }> = ({ code, picked }) => {
  const styles = stylesFor(useT());
  return (
    <View style={[styles.code, picked ? styles.codePicked : null]}>
      <Text style={[styles.codeText, picked ? styles.codeTextPicked : null]}>
        {languageCodeLabel(code)}
      </Text>
    </View>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    // The search icon and the filters button at the end of the header row.
    actions: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
    // The open search: over the title and the icon, from the screen edge to
    // the filters button, on the content line of the bar (below its 8dp
    // top padding). The canvas behind the field hides the title.
    searchOverlay: {
      position: 'absolute',
      top: SPACE.sm,
      bottom: 0,
      left: T.screenPadH,
      right: T.screenPadH + SEARCH_OVERLAY_END,
    },
    searchMask: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
    searchSlide: { flex: 1, justifyContent: 'center', backgroundColor: T.bg },
    // The list scrolls up under the header row and stops at its edge.
    listArea: { flex: 1, overflow: 'hidden' },
    header: { paddingHorizontal: T.screenPadH, paddingBottom: SPACE.md },
    panel: { marginTop: SPACE.xs },
    picks: { marginTop: SPACE.xs, marginHorizontal: -T.screenPadH },
    picksContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: CHIP_GAP,
      paddingHorizontal: T.screenPadH,
    },
    // The chips scroll to the card's right edge.
    filters: {
      paddingTop: SPACE.md,
      paddingBottom: SPACE.md,
      paddingLeft: SPACE.lg,
      paddingRight: 0,
      gap: SPACE.sm,
    },
    filterRow: { flexDirection: 'row', alignItems: 'center' },
    filterLabel: {
      width: FILTER_LABEL_WIDTH,
      fontFamily: T.fontLabel,
      fontSize: 12.5,
      lineHeight: 17,
      color: T.text3,
    },
    filterScroll: { flex: 1 },
    filterChips: { flexDirection: 'row', alignItems: 'center', gap: CHIP_GAP, paddingRight: SPACE.md },
    code: {
      height: 16,
      paddingHorizontal: SPACE.xs,
      borderRadius: RADIUS.xs,
      justifyContent: 'center',
      backgroundColor: withAlpha(T.text, 0.12),
    },
    codePicked: { backgroundColor: withAlpha(T.onAction, 0.16) },
    codeText: { fontFamily: T.fontLabel, fontSize: 10, lineHeight: 14, color: T.text },
    codeTextPicked: { color: T.onAction },
    note: {
      marginTop: SPACE.sm,
      fontFamily: T.fontBody,
      fontSize: 12.5,
      lineHeight: 17,
      color: T.text3,
    },
    list: { flex: 1 },
    updatingSlot: { height: 3, marginTop: SPACE.sm },
    resultLine: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: SPACE.xs,
      minHeight: 24,
    },
    // Under the card, the picks or the note: the next block.
    resultLineAfter: { marginTop: SPACE.lg },
    count: { fontFamily: T.fontLabel, fontSize: 14, lineHeight: 19, color: T.text, flexShrink: 1 },
    countUpdating: { color: T.text3 },
    sort: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
    sortLabel: { fontFamily: T.fontLabel, fontSize: 13, lineHeight: 18, color: T.text2 },
    gridRow: { gap: GRID_COLUMN_GAP, paddingHorizontal: T.screenPadH },
    emptyWrap: { flex: 1 },
    state: { flex: 1 },
    footer: { paddingVertical: SPACE.lg, alignItems: 'center' },
  });

const stylesFor = themedStyles(makeStyles);

export default StoryLibraryScreen;
