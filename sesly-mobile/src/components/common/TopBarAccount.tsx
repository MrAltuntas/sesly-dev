/**
 * TopBarAccount: the right side of every top bar that shows the profile
 * avatar (Masallar, Kütüphane, Sesim): a bell that opens Notifications, with
 * a dot while something is unread, and the avatar that opens Profile. Both
 * open through `navigateSingleton`, so a tap never stacks a second copy.
 * The bell is a raised face one step above the bar's container; the avatar
 * sits on its own lip like the bell.
 *
 * The unread count comes from the notifications store, which the socket and
 * push bridge keep fresh; it is also refreshed when the screen gains focus,
 * at most once every `UNREAD_REFRESH_MIN_MS`.
 */

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { observer } from 'mobx-react-lite';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../design/rows';
import { Icon } from '../design/Icon';
import { Tactile } from '../design/Tactile';
import { useSurfaceLevel } from '../design/SurfaceLevel';
import { LIP, RADIUS, SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { raisedFace } from '../../theme/surfaces';
import { useAuth } from '../../hooks/useAuth';
import { useNotifications } from '../../hooks/useNotifications';
import { initialOf } from '../../i18n/text';
import { getUserFullName } from '../../models/User';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { navigateSingleton } from '../../navigation/navigateSingleton';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Focus changes closer together than this do not ask the server again. */
export const UNREAD_REFRESH_MIN_MS = 30000;

let lastUnreadRefreshAt = 0;

/** Tests only: forget when the unread count was last refreshed. */
export function resetUnreadRefreshForTests(): void {
  lastUnreadRefreshAt = 0;
}

export interface TopBarAccountProps {
  /** Prefix of the test ids: `<prefix>-bell`, `<prefix>-avatar`. */
  testIDPrefix: string;
}

export const TopBarAccount: React.FC<TopBarAccountProps> = observer(({ testIDPrefix }) => {
  const nav = useNavigation<Nav>();
  const T = useT();
  const { t } = useTranslation('common');
  const styles = stylesFor(T);
  const bellFace = raisedFace(T, useSurfaceLevel());
  const auth = useAuth();
  const notifications = useNotifications();

  // On mount and every time the screen comes back into focus.
  useEffect(() => {
    const refresh = () => {
      const now = Date.now();
      if (now - lastUnreadRefreshAt < UNREAD_REFRESH_MIN_MS) return;
      lastUnreadRefreshAt = now;
      void notifications.refreshUnreadCount();
    };
    refresh();
    return nav.addListener?.('focus', refresh);
  }, [nav, notifications]);

  // The same name as the profile's avatar: never the e-mail (a private
  // relay address is a random id).
  const name =
    (auth.backendUser && getUserFullName(auth.backendUser)) ||
    auth.user?.displayName?.trim() ||
    t('profile:fallbackName');
  const unread = notifications.unreadCount;
  const hasUnread = unread > 0;

  return (
    <View style={styles.row}>
      <Tactile
        color={bellFace}
        lipColor={T.lip}
        lip={LIP.sm}
        radius={RADIUS.md}
        onPress={() => navigateSingleton(nav, 'Notifications')}
        hitSlop={2}
        accessibilityLabel={
          hasUnread ? t('a11y.notificationsUnread', { n: unread }) : t('a11y.notifications')
        }
        testID={`${testIDPrefix}-bell`}
        faceStyle={styles.bell}
      >
        <Icon name="bell" size={24} color={T.text} />
        {hasUnread ? (
          <View style={[styles.dot, { borderColor: bellFace }]} testID={`${testIDPrefix}-bell-dot`} />
        ) : null}
      </Tactile>
      <Avatar
        size={40}
        initial={initialOf(name)}
        lipColor={T.ownLip}
        onPress={() => navigateSingleton(nav, 'Profile')}
        accessibilityLabel={t('a11y.profile')}
        testID={`${testIDPrefix}-avatar`}
      />
    </View>
  );
});

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.tight },
    bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    // On the bell's upper right; the ring in the face colour cuts it out of
    // the icon's stroke.
    dot: {
      position: 'absolute',
      top: 9, // geometry: the glyph's upper right
      right: 10, // geometry
      width: 11,
      height: 11,
      borderRadius: 6,
      backgroundColor: T.action,
      borderWidth: 2,
    },
  });

const stylesFor = themedStyles(makeStyles);

export default TopBarAccount;
