/**
 * NotificationsScreen (design/v4/playful; no frame of its own, restyled in
 * the system of the Sesim frame).
 *
 * Back bar "Bildirimler" with a "Hepsi okundu" button while something is
 * unread. Each row is a card on its lip (`.nr`): leading image (a rounded
 * square story cover, the voice's avatar or an icon tile), type, relative
 * time and the unread dot in the action colour, then the title and body the
 * notification carries (the backend writes them; they are not rebuilt here).
 * The empty state is the round state icon with one button to the
 * notification preferences on the profile. Backed by
 * `useNotifications` (MobX store): pagination, pull to refresh, mark one
 * read on tap, mark all read.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { observer } from 'mobx-react-lite';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LIP, RADIUS, SPACE, Theme, themedStyles, useT, useTextStyles } from '../../theme/theme';
import { initialOf } from '../../i18n/text';
import { formatRelativeTime } from '../../i18n/relativeTime';
import { Button } from '../../components/design/Button';
import { Icon, IconName } from '../../components/design/Icon';
import { PictureCover, useCoverSpread } from '../../components/design/PictureCover';
import type { CoverSubject } from '../../components/design/covers';
import { Avatar, IconButton, StateIcon, StateView, TopAppBar } from '../../components/design/rows';
import { RowSkeleton, SkeletonPulse } from '../../components/design/Skeleton';
import { Tactile } from '../../components/design/Tactile';
import { useNotifications } from '../../hooks/useNotifications';
import { getStoryStore } from '../../hooks/useStory';
import { getVoiceProfileStore } from '../../hooks/useVoiceProfile';
import {
  Notification as AppNotification,
  NotificationType,
  getNotificationTarget,
  isNarrationNotification,
  isVoiceNotification,
} from '../../models/Notification';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { navigateSingleton } from '../../navigation/navigateSingleton';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Edge of the leading cover, avatar or icon tile (dp). */
const LEADING = 48;
const LEADING_RADIUS = RADIUS.md;
/** A row card: the leading image plus its 12dp padding above and below. */
const ROW_MIN_HEIGHT = LEADING + 2 * SPACE.md;
/** Line heights of the type line, the title and the body (dp). */
const TYPE_LINE = 16;
const TITLE_LINE = 21;
const BODY_LINE = 19;
/**
 * The usual row: the type line, a one-line title and a one-line body inside
 * the padding. The skeleton rows are this tall, so the list does not jump
 * when the first page lands.
 */
export const NOTIFICATION_ROW_HEIGHT =
  2 * SPACE.md + TYPE_LINE + SPACE.xxs + TITLE_LINE + SPACE.xxs + BODY_LINE;
/** Edge of the unread dot (dp). */
const UNREAD_DOT = 10;

// ─────────────────────────────────────────────────────────────
// Helpers (pure)
// ─────────────────────────────────────────────────────────────

export type NotificationKind = 'story' | 'voice' | 'system';

export function notificationKind(type: NotificationType): NotificationKind {
  if (isNarrationNotification(type)) return 'story';
  if (isVoiceNotification(type)) return 'voice';
  return 'system';
}

function readId(data: Record<string, unknown> | null, key: string): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value ? value : null;
}

/** Story a narration notification is about, when it carries one. */
export function notificationStoryId(notification: Pick<AppNotification, 'type' | 'data'>): string | null {
  return notificationKind(notification.type) === 'story' ? readId(notification.data, 'storyId') : null;
}

/** Voice profile a voice notification is about, when it carries one. */
export function notificationVoiceProfileId(
  notification: Pick<AppNotification, 'type' | 'data'>,
): string | null {
  return notificationKind(notification.type) === 'voice'
    ? readId(notification.data, 'voiceProfileId')
    : null;
}

const KIND_ICON: Record<NotificationKind, IconName> = {
  story: 'book',
  voice: 'mic',
  system: 'bell',
};

// ─────────────────────────────────────────────────────────────

export const NotificationsScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const T = useT();
  const styles = stylesFor(T);
  const text = useTextStyles();
  const { t } = useTranslation('notifications');
  const notificationsStore = useNotifications();

  // True once the first load() has resolved. Lets us show a spinner on the
  // very first load (and a retry on failure) instead of flashing the empty
  // state before isLoading flips true.
  const [loadedOnce, setLoadedOnce] = useState(false);

  const runInitialLoad = useCallback(async () => {
    await notificationsStore.load();
    setLoadedOnce(true);
  }, [notificationsStore]);

  useEffect(() => {
    runInitialLoad();
  }, [runInitialLoad]);

  const notifications = notificationsStore.notifications;
  const unreadCount = notificationsStore.unreadCount;

  // Covers: what the app already knows about the story (its picture, its
  // tale key), else the id alone. Read from the stores other screens filled;
  // this screen does not fetch stories or voices.
  const storyStore = getStoryStore();
  const knownStories = storyStore ? [...storyStore.stories, ...storyStore.favoriteStories] : [];
  const coverSubjects: CoverSubject[] = [];
  const subjectByStoryId = new Map<string, CoverSubject>();
  notifications.forEach(n => {
    const storyId = notificationStoryId(n);
    if (!storyId || subjectByStoryId.has(storyId)) return;
    const known = knownStories.find(story => story.id === storyId);
    const subject: CoverSubject = known
      ? {
          id: known.id,
          translationGroupId: known.translationGroupId,
          coverImageUrl: known.coverImageUrl,
          category: known.category,
        }
      : { id: storyId };
    subjectByStoryId.set(storyId, subject);
    coverSubjects.push(subject);
  });
  const spread = useCoverSpread(coverSubjects);

  const voiceProfiles = getVoiceProfileStore()?.voiceProfiles ?? [];

  const handleMarkAll = useCallback(() => {
    notificationsStore.markAllAsRead();
  }, [notificationsStore]);

  const handleRefresh = useCallback(() => {
    notificationsStore.refresh();
  }, [notificationsStore]);

  const handlePressNotification = useCallback(
    (n: AppNotification) => {
      if (!n.read) {
        notificationsStore.markAsRead(n.id);
      }
      // Deep link by type. Marking read is always a real effect, so the row
      // is never a no-op even when there is no destination (SYSTEM).
      const target = getNotificationTarget(n);
      switch (target.kind) {
        case 'player':
          nav.navigate('AudioPlayer', { narrationId: target.narrationId });
          break;
        case 'story':
          nav.navigate('StoryDetail', { storyId: target.storyId });
          break;
        case 'voices':
          nav.navigate('VoiceProfiles');
          break;
        default:
          break;
      }
    },
    [notificationsStore, nav],
  );

  const renderLeading = (n: AppNotification) => {
    const kind = notificationKind(n.type);
    const storyId = notificationStoryId(n);
    const subject = storyId ? subjectByStoryId.get(storyId) : undefined;
    if (subject) {
      return (
        <PictureCover
          story={subject}
          width={LEADING}
          shape="square"
          radius={LEADING_RADIUS}
          flat
          placeholderIndex={spread.get(subject.id)}
          testID={`notification-cover-${n.id}`}
        />
      );
    }
    const voiceId = notificationVoiceProfileId(n);
    const voiceName = voiceId ? voiceProfiles.find(profile => profile.id === voiceId)?.name : undefined;
    if (voiceName?.trim()) {
      return (
        <Avatar
          initial={initialOf(voiceName)}
          size={LEADING}
          shape="rounded"
          testID={`notification-avatar-${n.id}`}
        />
      );
    }
    return (
      <View style={styles.iconTile} testID={`notification-icon-${n.id}`}>
        <Icon name={KIND_ICON[kind]} size={24} color={T.text2} />
      </View>
    );
  };

  const renderRow = ({ item }: { item: AppNotification }) => {
    const unread = !item.read;
    const typeLabel = t(`type.${notificationKind(item.type)}`);
    const time = formatRelativeTime(item.createdAt);
    return (
      <Tactile
        color={T.surface}
        lipColor={T.lip}
        lip={LIP.md}
        radius={RADIUS.lg}
        onPress={() => handlePressNotification(item)}
        accessibilityLabel={[unread ? t('a11y.unread') : null, typeLabel, item.title, item.body, time]
          .filter(Boolean)
          .join(', ')}
        testID={`notification-row-${item.id}`}
        style={styles.card}
        faceStyle={styles.row}
      >
        {renderLeading(item)}
        <View style={styles.mid}>
          <View style={styles.eyebrowRow}>
            <Text style={styles.type} numberOfLines={1}>
              {typeLabel}
            </Text>
            {time ? <Text style={styles.time}>{time}</Text> : null}
            {unread ? <View style={styles.dot} testID={`notification-unread-${item.id}`} /> : null}
          </View>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          {item.body ? (
            <Text style={styles.body} numberOfLines={3}>
              {item.body}
            </Text>
          ) : null}
        </View>
      </Tactile>
    );
  };

  const renderEmptyComponent = () => {
    if (!loadedOnce || notificationsStore.isLoading) {
      return (
        <SkeletonPulse testID="notifications-loading" style={styles.skeleton}>
          {[0, 1, 2, 3, 4].map(i => (
            <RowSkeleton
              key={i}
              height={NOTIFICATION_ROW_HEIGHT}
              radius={RADIUS.lg}
              lip={LIP.md}
              leadingSize={LEADING}
              leadingRadius={LEADING_RADIUS}
              trailing={false}
            />
          ))}
        </SkeletonPulse>
      );
    }
    if (notificationsStore.errorMessage) {
      // No connection: say so, not that the problem is on our side.
      const offline = notificationsStore.errorKind === 'offline';
      return (
        <StateView
          testID="notifications-error"
          icon={offline ? 'wifiOff' : 'alert'}
          title={offline ? t('states:offline.title') : t('error.title')}
          message={offline ? t('states:offline.message') : t('error.message')}
          actionLabel={t('common:retry')}
          onAction={runInitialLoad}
          style={styles.centerState}
        />
      );
    }
    return (
      <View style={styles.centerState} testID="notifications-empty">
        <StateIcon icon="bell" />
        <Text accessibilityRole="header" style={[text.heading, styles.emptyTitle]}>
          {t('empty.title')}
        </Text>
        <Text style={[text.bodySmall, styles.emptyMessage]}>{t('empty.message')}</Text>
        <Button
          label={t('empty.action')}
          variant="secondary"
          icon="sliders"
          onPress={() => navigateSingleton(nav, 'Profile')}
          style={styles.emptyAction}
          testID="notifications-preferences"
        />
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <TopAppBar
        variant="back"
        title={t('title')}
        onBack={() => nav.goBack()}
        trailing={
          unreadCount > 0 ? (
            // An icon button: a text button left the title no room on a
            // 360dp phone at a large font.
            <IconButton
              variant="tactile"
              icon="checkAll"
              onPress={handleMarkAll}
              accessibilityLabel={t('markAllRead')}
              testID="notifications-mark-all"
            />
          ) : null
        }
      />

      <FlatList
        data={notifications}
        keyExtractor={item => item.id}
        renderItem={renderRow}
        ListEmptyComponent={renderEmptyComponent}
        contentContainerStyle={{ flexGrow: 1, paddingTop: SPACE.md, paddingBottom: insets.bottom + SPACE.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={notificationsStore.isRefreshing}
            onRefresh={handleRefresh}
            tintColor={T.action}
            colors={[T.action]}
            progressBackgroundColor={T.surface}
          />
        }
        onEndReached={() => notificationsStore.loadMore()}
        onEndReachedThreshold={0.3}
        showsVerticalScrollIndicator={false}
        testID="notifications-list"
      />
    </View>
  );
});

// ─────────────────────────────────────────────────────────────

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    card: { marginHorizontal: T.screenPadH, marginBottom: SPACE.md },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: SPACE.md,
      padding: SPACE.md,
      minHeight: ROW_MIN_HEIGHT,
    },
    iconTile: {
      width: LEADING,
      height: LEADING,
      borderRadius: LEADING_RADIUS,
      backgroundColor: T.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mid: { flex: 1, minWidth: 0 },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    type: {
      flex: 1,
      fontFamily: T.fontLabel,
      fontSize: 12,
      lineHeight: TYPE_LINE,
      color: T.text3,
    },
    time: { fontFamily: T.fontBody, fontSize: 12, lineHeight: TYPE_LINE, color: T.text3 },
    // The unread mark: one small dot in the action colour.
    dot: { width: UNREAD_DOT, height: UNREAD_DOT, borderRadius: UNREAD_DOT / 2, backgroundColor: T.action },
    title: {
      fontFamily: T.fontLabel,
      fontSize: 15,
      lineHeight: TITLE_LINE,
      color: T.text,
      marginTop: SPACE.xxs,
    },
    body: {
      fontFamily: T.fontBody,
      fontSize: 13.5,
      lineHeight: BODY_LINE,
      color: T.text2,
      marginTop: SPACE.xxs,
    },
    skeleton: { paddingHorizontal: T.screenPadH, gap: SPACE.md },
    centerState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: SPACE.xxxl,
      paddingVertical: SPACE.xxxl,
    },
    emptyTitle: { marginTop: 20, textAlign: 'center' },
    emptyMessage: { marginTop: 8, maxWidth: 280, textAlign: 'center' },
    emptyAction: { marginTop: 24, alignSelf: 'center' },
  });

const stylesFor = themedStyles(makeStyles);

export default NotificationsScreen;
