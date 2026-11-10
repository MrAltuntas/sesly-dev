/**
 * Notification Model
 * Matches backend Aşama 1 contract:
 * { id, userId, type, title, body, data, read, readAt, createdAt }
 */

/**
 * Notification types the backend emits (Notification.type / data.type).
 * Anything unknown (INFO, promo campaigns, ...) is shown as SYSTEM.
 */
export enum NotificationType {
  VOICE_READY = 'VOICE_READY',
  VOICE_FAILED = 'VOICE_FAILED',
  NARRATION_READY = 'NARRATION_READY',
  NARRATION_FAILED = 'NARRATION_FAILED',
  SYSTEM = 'SYSTEM',
}

/** Map any backend type string to a NotificationType. */
export function parseNotificationType(raw: unknown): NotificationType {
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  switch (value) {
    case NotificationType.VOICE_READY:
      return NotificationType.VOICE_READY;
    case NotificationType.VOICE_FAILED:
      return NotificationType.VOICE_FAILED;
    case NotificationType.NARRATION_READY:
      return NotificationType.NARRATION_READY;
    case NotificationType.NARRATION_FAILED:
      return NotificationType.NARRATION_FAILED;
    default:
      return NotificationType.SYSTEM;
  }
}

export function isVoiceNotification(type: NotificationType): boolean {
  return (
    type === NotificationType.VOICE_READY ||
    type === NotificationType.VOICE_FAILED
  );
}

export function isNarrationNotification(type: NotificationType): boolean {
  return (
    type === NotificationType.NARRATION_READY ||
    type === NotificationType.NARRATION_FAILED
  );
}

/** Where tapping a notification should take the user. */
export type NotificationTarget =
  | { kind: 'player'; narrationId: string }
  | { kind: 'story'; storyId: string }
  | { kind: 'voices' }
  | { kind: 'none' };

function readString(
  data: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value ? value : null;
}

/**
 * Pure routing rule for a notification tap:
 *   NARRATION_READY  -> player for data.narrationId (story detail if missing)
 *   NARRATION_FAILED -> story detail for data.storyId
 *   VOICE_*          -> voice profiles
 *   SYSTEM           -> nowhere (marking read is the effect)
 */
export function getNotificationTarget(
  notification: Pick<Notification, 'type' | 'data'>,
): NotificationTarget {
  const narrationId = readString(notification.data, 'narrationId');
  const storyId = readString(notification.data, 'storyId');
  switch (notification.type) {
    case NotificationType.NARRATION_READY:
      if (narrationId) return { kind: 'player', narrationId };
      if (storyId) return { kind: 'story', storyId };
      return { kind: 'none' };
    case NotificationType.NARRATION_FAILED:
      if (storyId) return { kind: 'story', storyId };
      return { kind: 'none' };
    case NotificationType.VOICE_READY:
    case NotificationType.VOICE_FAILED:
      return { kind: 'voices' };
    default:
      return { kind: 'none' };
  }
}

// ============================================================================
// FCM push payload (RemoteMessage.notification + RemoteMessage.data)
// ============================================================================

/**
 * What the app acts on from an FCM message. Backend contract: `data` values
 * are all strings, `data.type` is one of the NotificationType values (or
 * BROADCAST / promo types, read as SYSTEM) and `data.notificationId` is the
 * in-app notification row created alongside the push.
 */
export interface PushPayload {
  readonly type: NotificationType;
  readonly notificationId: string | null;
  readonly data: Record<string, string>;
  /** Visible title/body from the `notification` block (Turkish). */
  readonly title: string | null;
  readonly body: string | null;
}

interface RemoteMessageLike {
  readonly data?: Record<string, unknown> | null;
  readonly notification?: {
    readonly title?: string | null;
    readonly body?: string | null;
  } | null;
}

/** Pure parser for an FCM RemoteMessage. Null when there is nothing to act on. */
export function parsePushPayload(
  message: RemoteMessageLike | null | undefined,
): PushPayload | null {
  if (!message || typeof message !== 'object') return null;

  const data: Record<string, string> = {};
  if (message.data && typeof message.data === 'object') {
    Object.entries(message.data).forEach(([key, value]) => {
      if (typeof value === 'string') data[key] = value;
    });
  }

  const title =
    typeof message.notification?.title === 'string' && message.notification.title
      ? message.notification.title
      : null;
  const body =
    typeof message.notification?.body === 'string' && message.notification.body
      ? message.notification.body
      : null;

  if (Object.keys(data).length === 0 && !title && !body) return null;

  return {
    type: parseNotificationType(data.type),
    notificationId: data.notificationId ? data.notificationId : null,
    data,
    title,
    body,
  };
}

export interface Notification {
  readonly id: string;
  readonly userId: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly data: Record<string, unknown> | null;
  readonly read: boolean;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

export function parseNotificationFromJSON(json: unknown): Notification {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid notification data: expected object');
  }
  const data = json as Record<string, unknown>;

  if (typeof data.id !== 'string' || !data.id) {
    throw new Error('Invalid notification data: missing or invalid id');
  }
  if (typeof data.title !== 'string') {
    throw new Error('Invalid notification data: missing or invalid title');
  }
  if (typeof data.createdAt !== 'string') {
    throw new Error('Invalid notification data: missing or invalid createdAt');
  }

  // Tolerate legacy shapes: body may come as `description`, read as `isRead`,
  // createdAt as `timestamp`. Backend contract is the new field names.
  const body =
    typeof data.body === 'string'
      ? data.body
      : typeof data.description === 'string'
        ? data.description
        : '';

  const read =
    typeof data.read === 'boolean'
      ? data.read
      : typeof data.isRead === 'boolean'
        ? data.isRead
        : false;

  const createdAtStr =
    typeof data.createdAt === 'string'
      ? data.createdAt
      : typeof data.timestamp === 'string'
        ? data.timestamp
        : '';

  const payload =
    data.data && typeof data.data === 'object' && !Array.isArray(data.data)
      ? (data.data as Record<string, unknown>)
      : null;
  // Row `type` is authoritative; `data.type` mirrors it and is used when the
  // row carries a generic value (e.g. INFO).
  const rowType = parseNotificationType(data.type);
  const type =
    rowType !== NotificationType.SYSTEM
      ? rowType
      : parseNotificationType(payload?.type);

  return {
    id: data.id,
    userId: typeof data.userId === 'string' ? data.userId : '',
    type,
    title: data.title,
    body,
    data: payload,
    read,
    readAt:
      typeof data.readAt === 'string' && data.readAt
        ? new Date(data.readAt)
        : null,
    createdAt: new Date(createdAtStr),
  };
}

// ============================================================================
// Paginated List Response (GET /notifications)
// ============================================================================

export interface NotificationListResponse {
  readonly items: readonly Notification[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

export function parseNotificationListResponseFromJSON(
  json: unknown,
): NotificationListResponse {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid notification list response: expected object');
  }
  const data = json as Record<string, unknown>;

  const rawItems: unknown[] = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.notifications)
      ? data.notifications
      : Array.isArray(json as unknown[])
        ? (json as unknown[])
        : [];

  const items: Notification[] = [];
  rawItems.forEach(item => {
    try {
      items.push(parseNotificationFromJSON(item));
    } catch (err) {
      console.warn('Failed to parse notification:', err);
    }
  });

  const total =
    typeof data.total === 'number' ? data.total : items.length;
  const page = typeof data.page === 'number' ? data.page : 1;
  const limit = typeof data.limit === 'number' ? data.limit : items.length;
  const hasMore =
    typeof data.hasMore === 'boolean' ? data.hasMore : page * limit < total;

  return {items, total, page, limit, hasMore};
}

// ============================================================================
// Unread Count Response (GET /notifications/unread-count)
// ============================================================================

export function parseUnreadCountFromJSON(json: unknown): number {
  if (typeof json === 'number') return json;
  if (!json || typeof json !== 'object') return 0;
  const data = json as Record<string, unknown>;
  const count =
    typeof data.count === 'number'
      ? data.count
      : typeof data.unread === 'number'
        ? data.unread
        : typeof data.unreadCount === 'number'
          ? data.unreadCount
          : 0;
  return count;
}
