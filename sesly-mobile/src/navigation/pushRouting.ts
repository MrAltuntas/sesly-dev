/**
 * Routing for push-notification taps.
 *
 * A tap can arrive before navigation can take it: on a cold start the boot
 * route (Login, Onboarding, NoInternet, ForceUpdate) may be shown first, and
 * the reset that leaves it would drop a screen pushed above it. The target is
 * therefore queued and flushed once the Main shell is mounted
 * (NavigationContainer onReady / onStateChange call
 * `flushPendingNotificationOpen`); when Main is the boot route the tap runs at
 * the first `onReady`.
 *
 * The destination rule itself is `getNotificationTarget` (models/Notification),
 * shared with NotificationsScreen. A tap opens the player without starting it;
 * the in-app "Masalın hazır" toast action passes `autoplay`, because pressing
 * "Dinle" is the decision to listen.
 */

import {
  NotificationTarget,
  NotificationType,
  PushPayload,
} from '../models/Notification';
import { navigationRef } from './navigationRef';
import { openStoryDetail } from './openStory';

export type NotificationRoute =
  | { name: 'AudioPlayer'; params: { narrationId: string; autoplay?: boolean } }
  | { name: 'StoryDetail'; params: { storyId: string } }
  | { name: 'VoiceProfiles' };

/** A queued tap older than this is dropped (e.g. the user never signed in). */
export const PENDING_OPEN_TTL_MS = 5 * 60 * 1000;

export interface NotificationOpenOptions {
  /** Start the narration as the player opens ("Dinle" on the in-app toast). */
  autoplay?: boolean;
}

export function routeForNotificationTarget(
  target: NotificationTarget,
  options: NotificationOpenOptions = {},
): NotificationRoute | null {
  switch (target.kind) {
    case 'player':
      return {
        name: 'AudioPlayer',
        // A plain tap carries no autoplay key: the player reads it as false.
        params: options.autoplay
          ? { narrationId: target.narrationId, autoplay: true }
          : { narrationId: target.narrationId },
      };
    case 'story':
      return { name: 'StoryDetail', params: { storyId: target.storyId } };
    case 'voices':
      return { name: 'VoiceProfiles' };
    default:
      return null;
  }
}

interface RouteStateLike {
  readonly routes: ReadonlyArray<{ readonly name: string }>;
}

/**
 * True once the Main tabs are in the root stack: the session is in place and
 * the boot route (Login, Onboarding, NoInternet) is gone, so a pushed screen
 * will stick.
 */
export function isAppShellReady(state: RouteStateLike | null | undefined): boolean {
  return !!state && state.routes.some(route => route.name === 'Main');
}

interface CurrentRouteLike {
  readonly name: string;
  readonly params?: object;
}

/**
 * Foreground pushes become an in-app toast, except when the user is already
 * looking at the thing the push is about (the generation or voice training
 * screen shows its own result).
 */
export function shouldSuppressForegroundToast(
  payload: PushPayload,
  route: CurrentRouteLike | null | undefined,
): boolean {
  if (!route) return false;
  const params = (route.params ?? {}) as Record<string, unknown>;
  switch (payload.type) {
    case NotificationType.NARRATION_READY:
    case NotificationType.NARRATION_FAILED:
      if (
        route.name === 'AudioGeneration' &&
        !!payload.data.storyId &&
        params.storyId === payload.data.storyId
      ) {
        return true;
      }
      return (
        route.name === 'AudioPlayer' &&
        !!payload.data.narrationId &&
        params.narrationId === payload.data.narrationId
      );
    case NotificationType.VOICE_READY:
    case NotificationType.VOICE_FAILED:
      return (
        route.name === 'Processing' &&
        (!params.profileId || params.profileId === payload.data.voiceProfileId)
      );
    default:
      return false;
  }
}

// ============================================================================
// Pending tap queue
// ============================================================================

interface PendingOpen {
  route: NotificationRoute | null;
  notificationId: string | null;
  onOpened?: (notificationId: string) => void;
  queuedAt: number;
}

let pending: PendingOpen | null = null;

/**
 * Queue a notification tap and try to perform it right away. `onOpened` runs
 * (with the notification id) at the moment the tap is performed, i.e. inside
 * an authenticated session: used to mark the in-app notification read.
 */
export function queueNotificationOpen(
  target: NotificationTarget,
  notificationId: string | null,
  onOpened?: (notificationId: string) => void,
  options: NotificationOpenOptions = {},
): void {
  pending = {
    route: routeForNotificationTarget(target, options),
    notificationId,
    onOpened,
    queuedAt: Date.now(),
  };
  flushPendingNotificationOpen();
}

/** Perform the queued tap if the Main shell is mounted. Safe to call often. */
export function flushPendingNotificationOpen(): void {
  if (!pending) return;
  if (Date.now() - pending.queuedAt > PENDING_OPEN_TTL_MS) {
    pending = null;
    return;
  }
  if (!navigationRef.isReady()) return;
  if (!isAppShellReady(navigationRef.getRootState())) return;

  const { route, notificationId, onOpened } = pending;
  pending = null;

  if (notificationId && onOpened) {
    try {
      onOpened(notificationId);
    } catch (error) {
      console.warn('[Push] onOpened failed:', error);
    }
  }
  if (!route) return;

  switch (route.name) {
    case 'AudioPlayer':
      navigationRef.navigate('AudioPlayer', route.params);
      break;
    case 'StoryDetail':
      // Over a player opened from that story's page: back to it, not a copy.
      openStoryDetail(navigationRef, route.params.storyId);
      break;
    case 'VoiceProfiles':
      navigationRef.navigate('VoiceProfiles');
      break;
  }
}

export function clearPendingNotificationOpen(): void {
  pending = null;
}

export function hasPendingNotificationOpen(): boolean {
  return pending !== null;
}
