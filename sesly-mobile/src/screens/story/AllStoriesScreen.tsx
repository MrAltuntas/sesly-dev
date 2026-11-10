/**
 * AllStoriesScreen: "Yeni eklenenler", reached from "Tümü" on the home
 * shelf of the same name.
 *
 * The whole catalogue, one card per tale (grouped scope), newest first, in
 * the cover grid of Keşfet (components/story/StoryCard) under a back bar.
 * No search and no filters here. Premium stories carry their mark; on the
 * free plan they are locked and a tap offers the plans. Coming back from a
 * story page shows the bookmarks saved there without a request.
 *
 * The screen sits on the root stack above Main, so the save message's
 * "Göster" pops back to Main and its Kütüphane tab instead of pushing a
 * second Main.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, ListRenderItemInfo, RefreshControl, StyleSheet, View } from 'react-native';
import { observer } from 'mobx-react-lite';
import { reaction } from 'mobx';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { FadeIn, Spinner, StateView, TopAppBar, useCoverSpread } from '../../components/design';
import {
  GRID_COLUMN_GAP,
  GRID_ROW_GAP,
  StoryCard,
  StoryGridSkeleton,
  useStoryGrid,
} from '../../components/story/StoryCard';
import { useListSaveToggle } from '../../components/story/saveFeedback';
import { usePremiumGate } from '../../components/story/usePremiumGate';
import { useSavedMarksOnFocus } from '../../components/story/useSavedMarksOnFocus';
import { SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { DiscoverStore } from '../../hooks/useDiscover';
import { useStory } from '../../hooks/useStory';
import { getContentLanguageStore } from '../../hooks/useContentLanguage';
import type { Story } from '../../models/Story';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const keyOf = (story: Story) => story.id;

export const AllStoriesScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const T = useT();
  const { t } = useTranslation('discover');
  const styles = stylesFor(T);
  const storyStore = useStory();
  const gate = usePremiumGate();
  // A list of its own: the content language (the Home shelf it continues),
  // newest first, no filters.
  const store = useMemo(() => new DiscoverStore({ sort: 'newest' }), []);

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void store.load();
  }, [store]);

  // In the content language: a new one (a pick, or the UI language without
  // one) lists that language.
  useEffect(
    () => reaction(() => getContentLanguageStore().effective, () => store.contentLanguageChanged()),
    [store],
  );

  // Back from a story page: the bookmarks saved or removed there.
  useSavedMarksOnFocus(store, storyStore, isFocused);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await store.refresh();
    } finally {
      setRefreshing(false);
    }
  }, [store]);

  const retry = useCallback(() => void store.load(), [store]);
  const loadMore = useCallback(() => void store.loadMore(), [store]);
  const goBack = useCallback(() => nav.goBack(), [nav]);
  // Main is below this screen: pop back to it rather than push a second one.
  const openLibrary = useCallback(() => nav.popTo('Main', { screen: 'Library' }), [nav]);
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
  const { columns, cardWidth } = useStoryGrid();
  const showList = items.length > 0;

  // The first grid after the skeleton fades in once.
  const fadeGrid = useRef(!showList);
  useEffect(() => {
    if (showList) fadeGrid.current = false;
  }, [showList]);

  const locksPremium = gate.locksPremium;
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Story>) => (
      <FadeIn skip={!fadeGrid.current}>
        <StoryCard
          story={item}
          width={cardWidth}
          placeholderIndex={spread.get(item.id)}
          onPress={openStory}
          onToggleSave={toggleSave}
          premium={item.isPremium}
          locked={locksPremium && item.isPremium}
        />
      </FadeIn>
    ),
    [cardWidth, spread, openStory, toggleSave, locksPremium],
  );

  let emptyBody: React.ReactNode;
  if (!store.hasLoaded || (store.isLoading && !refreshing)) {
    emptyBody = <StoryGridSkeleton testID="all-stories-loading" />;
  } else if (store.hasError) {
    // The load failed: a retry, not a "no content" state the user cannot act on.
    const offline = store.listErrorKind === 'offline';
    emptyBody = (
      <StateView
        testID="all-stories-error"
        icon={offline ? 'wifiOff' : 'alert'}
        title={offline ? t('states:offline.title') : t('error.title')}
        message={offline ? t('states:offline.message') : t('error.message')}
        actionLabel={t('common:retry')}
        onAction={retry}
        style={styles.state}
      />
    );
  } else {
    emptyBody = (
      <StateView
        testID="all-stories-empty"
        icon="book"
        title={t('empty.catalogueTitle')}
        message={t('empty.catalogueMessage')}
        style={styles.state}
      />
    );
  }

  return (
    <View style={styles.container}>
      <TopAppBar variant="back" title={t('allStories.title')} onBack={goBack} />
      <FlatList
        key={`grid-${columns}`}
        data={items}
        numColumns={columns}
        keyExtractor={keyOf}
        columnWrapperStyle={styles.gridRow}
        ItemSeparatorComponent={GridRowGap}
        renderItem={renderItem}
        ListEmptyComponent={<View style={styles.state}>{emptyBody}</View>}
        ListFooterComponent={
          store.isLoadingMore ? (
            <View style={styles.footer} testID="all-stories-loading-more">
              <Spinner color={T.text2} />
            </View>
          ) : null
        }
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACE.xxl }]}
        initialNumToRender={4}
        maxToRenderPerBatch={3}
        windowSize={7}
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
        testID="all-stories-list"
      />
    </View>
  );
});

const GridRowGap: React.FC = () => <View style={{ height: GRID_ROW_GAP }} />;

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    content: { flexGrow: 1, paddingTop: SPACE.md },
    gridRow: { gap: GRID_COLUMN_GAP, paddingHorizontal: T.screenPadH },
    state: { flex: 1 },
    footer: { paddingVertical: SPACE.lg, alignItems: 'center' },
  });

const stylesFor = themedStyles(makeStyles);

export default AllStoriesScreen;
