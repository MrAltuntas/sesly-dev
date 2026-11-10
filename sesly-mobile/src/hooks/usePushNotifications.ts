/**
 * Push notification bridge: connects PushNotificationService (FCM) to the
 * app's stores, toasts and navigation. Mounted once by RootNavigator.
 *
 *   - Session: registers the FCM token while a backend user exists, cleans up
 *     locally when the session ends (explicit sign-out already unregistered).
 *   - Foreground message: refresh the affected store + unread badge and show
 *     an in-app toast (the OS shows no banner while the app is open). When the
 *     message points somewhere the toast has an action: "Dinle" opens the
 *     player and starts the narration, "Göster" opens the story or Sesim; it
 *     marks the notification read like a tap.
 *   - Tap (background or cold start): mark the notification read and route
 *     with getNotificationTarget once the Main shell is mounted. A tap opens
 *     the player without starting it.
 *
 * FCM itself is initialised by the BootStore once AuthService is set up
 * (Firebase first); this bridge only installs the handlers, and a tap that
 * arrived before them is delivered when they are set.
 */

import { useEffect, useRef } from 'react';
import PushNotificationService from '../services/PushNotificationService';
import NotificationService from '../services/NotificationService';
import {
  NotificationType,
  PushPayload,
  getNotificationTarget,
  isNarrationNotification,
  isVoiceNotification,
} from '../models/Notification';
import { navigationRef } from '../navigation/navigationRef';
import {
  NotificationOpenOptions,
  clearPendingNotificationOpen,
  isAppShellReady,
  queueNotificationOpen,
  shouldSuppressForegroundToast,
} from '../navigation/pushRouting';
import { ToastAction, showToast } from '../utils/toast';
import { getNotificationsStore } from './useNotifications';
import { getVoiceProfileStore } from './useVoiceProfile';
import { getStoryStore } from './useStory';
import i18n from '../i18n';
import { msg } from '../i18n/messages';

// ============================================================================
// Toast copy (backend sends Turkish title/body; these are fallbacks only)
// ============================================================================

export interface PushToast {
  kind: 'success' | 'error' | 'info';
  title: string;
  message: string;
}

// Built when a push arrives, so the text follows the UI language.
const fallbackCopy = (): Record<NotificationType, PushToast> => ({
  [NotificationType.NARRATION_READY]: {
    kind: 'success',
    title: msg('push.narrationReadyTitle'),
    message: msg('push.narrationReadyMessage'),
  },
  [NotificationType.NARRATION_FAILED]: {
    kind: 'error',
    title: msg('push.narrationFailedTitle'),
    message: msg('push.narrationFailedMessage'),
  },
  [NotificationType.VOICE_READY]: {
    kind: 'success',
    title: msg('voice.readyTitle'),
    message: msg('voice.readyMessage'),
  },
  [NotificationType.VOICE_FAILED]: {
    kind: 'error',
    title: msg('voice.failedTitle'),
    message: msg('push.voiceFailedMessage'),
  },
  [NotificationType.SYSTEM]: {
    kind: 'info',
    title: 'Sesly',
    message: '',
  },
});

export function buildPushToast(payload: PushPayload): PushToast | null {
  const fallback = fallbackCopy()[payload.type];
  const title = payload.title ?? fallback.title;
  const message = payload.body ?? fallback.message;
  if (payload.type === NotificationType.SYSTEM && !payload.title && !payload.body) {
    return null; // nothing meaningful to show
  }
  return { kind: fallback.kind, title, message };
}

// ============================================================================
// Handlers
// ============================================================================

function refreshStoresFor(payload: PushPayload): void {
  getNotificationsStore()
    .refreshUnreadCount()
    .catch(() => {});

  if (isNarrationNotification(payload.type)) {
    const storyStore = getStoryStore();
    if (storyStore) {
      storyStore
        .loadUserNarrations(1, storyStore.narrationsSearch)
        .catch(error => console.warn('[Push] narrations refresh failed:', error));
    }
  } else if (isVoiceNotification(payload.type)) {
    getVoiceProfileStore()
      ?.refresh()
      .catch(error => console.warn('[Push] voice profiles refresh failed:', error));
  }
}

export function handleForegroundPush(payload: PushPayload): void {
  // Before the Main shell exists (a Login or Onboarding boot route) there is
  // no session to refresh against and nothing to point the user to.
  if (!navigationRef.isReady() || !isAppShellReady(navigationRef.getRootState())) {
    return;
  }

  refreshStoresFor(payload);

  if (shouldSuppressForegroundToast(payload, navigationRef.getCurrentRoute())) {
    return;
  }
  const toast = buildPushToast(payload);
  if (!toast) return;
  showToast[toast.kind](toast.message, toast.title, buildPushToastAction(payload));
}

/**
 * The toast's way to the thing the push is about: "Dinle" for a ready
 * narration (the player opens and plays), "Göster" for a story or a voice.
 * Nothing for a message without a destination (SYSTEM).
 *
 * The stores were refreshed when the message arrived, so the action only
 * routes and marks it read. The snackbar can outlive the session it was shown
 * in (a sign-out or an expiry while it is up): then the action does nothing,
 * instead of waiting for the next sign-in and opening (and playing) there.
 */
export function buildPushToastAction(payload: PushPayload): ToastAction | undefined {
  const target = getNotificationTarget({ type: payload.type, data: payload.data });
  if (target.kind === 'none') return undefined;
  const listen = target.kind === 'player';
  return {
    label: i18n.t(listen ? 'notifications:toast.listen' : 'notifications:toast.show'),
    onPress: () => {
      if (!navigationRef.isReady() || !isAppShellReady(navigationRef.getRootState())) return;
      openPush(payload, { autoplay: listen }, false);
    },
  };
}

async function markPushNotificationRead(notificationId: string): Promise<void> {
  const store = getNotificationsStore();
  if (store.notifications.some(n => n.id === notificationId)) {
    // Optimistic path: updates the row and the badge together.
    await store.markAsRead(notificationId);
    return;
  }
  try {
    await NotificationService.markAsRead(notificationId);
  } catch {
    // NotificationService already logged it; the badge refresh still runs.
  }
  await store.refreshUnreadCount();
}

/**
 * Route to the push's target once the shell is mounted and mark it read.
 * `refreshStores`: a tap on the system notification refreshes the stores too
 * (the app was not in the foreground when the message came).
 */
function openPush(payload: PushPayload, options: NotificationOpenOptions, refreshStores: boolean): void {
  const target = getNotificationTarget({ type: payload.type, data: payload.data });
  queueNotificationOpen(
    target,
    payload.notificationId,
    notificationId => {
      markPushNotificationRead(notificationId).catch(() => {});
      if (refreshStores) {
        refreshStoresFor(payload);
      }
    },
    options,
  );
}

/** A tap on the system notification: opens the target, never starts playback. */
export function handleOpenedPush(payload: PushPayload): void {
  openPush(payload, { autoplay: false }, true);
}

// ============================================================================
// Hook
// ============================================================================

/**
 * @param userId backend user id while signed in, null otherwise. Keyed on the
 *               id (not the user object) so profile edits do not re-register.
 */
export function usePushNotificationBridge(userId: string | null): void {
  useEffect(() => {
    return PushNotificationService.setHandlers({
      onForegroundMessage: handleForegroundPush,
      onNotificationOpened: handleOpenedPush,
    });
  }, []);

  const previousUserId = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousUserId.current;
    previousUserId.current = userId;
    if (userId) {
      PushNotificationService.onSessionStarted().catch(() => {});
      return;
    }
    // Signed out (or session expired). A cold start also passes null first;
    // the service ignores that, and a tap queued before Main must survive.
    if (previous) {
      clearPendingNotificationOpen();
    }
    PushNotificationService.onSessionEnded();
  }, [userId]);
}
