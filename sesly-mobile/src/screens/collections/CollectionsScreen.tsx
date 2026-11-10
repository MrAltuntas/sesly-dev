/**
 * CollectionsScreen: the curated collections of the content language
 * (`GET /collections?language=`), each a row card on its lip (`.nr`): the
 * books icon in a rounded tile, the title, two lines of description, the
 * number of stories and a chevron.
 *
 * A failed first load shows the error state (the offline one without a
 * connection); a failed pull-to-refresh keeps the rows and says so in a
 * snackbar. A new content language loads that language's collections.
 *
 * Not drawn in the playful mockup; it follows the cards and rows of the
 * frames that are (the narrator rows of Sesim).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { observer } from 'mobx-react-lite';
import { reaction } from 'mobx';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ListRow, RowSkeleton, SkeletonPulse, StateView, TopAppBar } from '../../components/design';
import { LIP, RADIUS, SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import CollectionService from '../../services/CollectionService';
import { FailureKind, classifyFailure, getErrorMessage } from '../../services/ApiError';
import { getConnectivityStore } from '../../stores/ConnectivityStore';
import { useContentLanguage } from '../../hooks/useContentLanguage';
import { showToast } from '../../utils/toast';
import { Collection } from '../../models/Collection';
import { failureCopy } from '../home/failureState';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Lines of description a collection row shows before it ends in three dots. */
export const COLLECTION_SUBTITLE_LINES = 2;
/**
 * A row card with two lines of description (ListRow card: 12 padding, the
 * 21dp title, 2, two 17dp lines, 12), so the rows land where the bones were.
 */
export const COLLECTION_ROW_HEIGHT = 12 + 21 + 2 + 17 * COLLECTION_SUBTITLE_LINES + 12;

interface LoadError {
  readonly message: string;
  readonly kind: FailureKind;
}

const CollectionsScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const T = useT();
  const { t } = useTranslation('discover');
  const styles = stylesFor(T);
  const contentLanguage = useContentLanguage();

  const [collections, setCollections] = useState<Collection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);
  const shown = useRef(collections);
  shown.current = collections;
  // Only the newest request lands (a refresh, then a language change).
  const request = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      const id = ++request.current;
      if (mode === 'initial') {
        setIsLoading(true);
        setError(null);
      } else {
        setIsRefreshing(true);
      }
      try {
        const list = await CollectionService.list(contentLanguage.effective);
        if (id !== request.current) return;
        setCollections(list);
        setError(null);
      } catch (err) {
        if (id !== request.current) return;
        const kind = classifyFailure(err, getConnectivityStore());
        if (mode === 'refresh' && shown.current.length > 0) {
          // The rows stay; the snackbar is the only sign.
          showToast.error(
            kind === 'offline' ? t('states:offline.title') : t('collections.errorTitle'),
          );
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
    [contentLanguage, t],
  );

  useEffect(() => {
    void load('initial');
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Collections are kept per content language.
  useEffect(
    () => reaction(() => contentLanguage.effective, () => void load('initial')),
    [contentLanguage, load],
  );

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <SkeletonPulse testID="collections-loading" style={styles.list}>
        {[0, 1, 2, 3].map(i => (
          <RowSkeleton
            key={i}
            height={COLLECTION_ROW_HEIGHT}
            radius={RADIUS.lg}
            lip={LIP.md}
            leadingSize={40}
            leadingRadius={RADIUS.sm}
            trailing={false}
          />
        ))}
      </SkeletonPulse>
    );
  } else if (error) {
    const copy = failureCopy(error.kind, { title: t('collections.errorTitle'), message: error.message });
    body = (
      <StateView
        testID="collections-error"
        icon={copy.icon}
        title={copy.title}
        message={copy.message}
        actionLabel={t('common:retry')}
        onAction={() => void load('initial')}
        style={styles.state}
      />
    );
  } else if (collections.length === 0) {
    body = (
      <StateView
        testID="collections-empty"
        icon="books"
        title={t('collections.emptyTitle')}
        message={t('collections.emptyMessage')}
        style={styles.state}
      />
    );
  } else {
    body = (
      <View style={styles.list}>
        {collections.map(collection => (
          <ListRow
            key={collection.id}
            card
            icon="books"
            title={collection.title}
            subtitle={collection.description ?? collection.subtitle ?? undefined}
            subtitleLines={COLLECTION_SUBTITLE_LINES}
            value={t('collections.storyCount', { total: String(collection.storyCount) })}
            chevron
            onPress={() => nav.navigate('CollectionDetail', { slug: collection.slug })}
            testID={`collection-row-${collection.slug}`}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TopAppBar variant="back" title={t('collections.title')} onBack={() => nav.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACE.xxl }]}
        showsVerticalScrollIndicator={false}
        testID="collections-scroll"
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void load('refresh')}
            tintColor={T.action}
            colors={[T.action]}
            progressBackgroundColor={T.surface}
          />
        }
      >
        {body}
      </ScrollView>
    </View>
  );
});

const stylesFor = themedStyles((T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    content: { flexGrow: 1 },
    state: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: SPACE.xxxl },
    list: { paddingHorizontal: T.screenPadH, paddingTop: SPACE.sm, gap: SPACE.md },
  }),
);

export default CollectionsScreen;
