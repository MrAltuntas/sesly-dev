import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as admin from 'firebase-admin';
import type {
  BaseMessage,
  BatchResponse,
  Messaging,
  TokenMessage,
} from 'firebase-admin/messaging';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NotificationToggleKey,
  UserPreferencesService,
  notificationToggleOnWhere,
} from '../user-preferences/user-preferences.service';
import { RegisterDeviceDto, UnregisterDeviceDto } from './dto/register-device.dto';
import { NotificationsGateway } from './notifications.gateway';
import { serverText } from '../../common/i18n/server-text';
import { STORY_FALLBACK_TITLE_KEY } from '../../common/constants/messages.constants';
import { resolveUserUiLanguage } from '../../common/i18n/user-ui-language';
import type { UiLanguage } from '../../common/i18n/ui-language';

/** Android notification channel the app must create (id is part of the mobile contract). */
export const ANDROID_CHANNEL_ID = 'sesly-default';

/** FCM hard limit for tokens per sendEachForMulticast / messages per sendEach. */
const FCM_BATCH_LIMIT = 500;

/** Rows per createManyAndReturn / IN (...) query during a broadcast. */
const BROADCAST_DB_CHUNK = 1000;

/** FCM errors meaning the token will never work again: drop it. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/**
 * Keys FCM rejects in `data`, plus the two we always set ourselves.
 * (FCM also reserves any key starting with "google." or "gcm.".)
 */
const RESERVED_DATA_KEYS = new Set([
  'from',
  'notification',
  'message_type',
  'collapse_key',
  'type',
  'notificationId',
]);

export type NotificationType =
  | 'VOICE_READY'
  | 'VOICE_FAILED'
  | 'NARRATION_READY'
  | 'NARRATION_FAILED'
  | 'TRANSLATION_READY'
  | 'BROADCAST';

export interface SendNotificationInput {
  /** NotificationType, or any other string for ungated system messages. */
  type: NotificationType | string;
  title: string;
  body: string;
  /**
   * Deep-link ids (narrationId, storyId, voiceProfileId). Only primitive
   * values are kept; they are stored on the row and sent as FCM data strings.
   */
  data?: Record<string, string | number | boolean | null | undefined>;
}

export interface SendNotificationResult {
  notificationId: string;
  /** true when FCM accepted the message for at least one of the user's devices. */
  pushSent: boolean;
}

export interface BroadcastResult {
  /** Users targeted; every one of them got an in-app notification row. */
  count: number;
  /** true when at least one push was delivered. */
  pushSent: boolean;
  /** Users reached by push (promo opt-in AND at least one live device). */
  pushDelivered: number;
}

/**
 * Which Settings toggle gates the PUSH for a notification type. The in-app
 * row + socket event are never gated. `null` = transactional, always pushed.
 */
export function pushPreferenceFor(type: string): NotificationToggleKey | null {
  if (type.startsWith('VOICE_')) return 'voiceReadyNotifications';
  if (type.startsWith('NARRATION_')) return 'narrationReadyNotifications';
  if (type === 'BROADCAST' || type === 'PROMO' || type.startsWith('PROMO_')) {
    return 'promoNotifications';
  }
  return null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Last chars only: tokens are credentials for pushing to a device. */
function tokenTail(token: string): string {
  return `...${token.slice(-6)}`;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private warnedNoFirebase = false;

  constructor(
    private prisma: PrismaService,
    private notificationsGateway: NotificationsGateway,
    private userPreferences: UserPreferencesService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // Device registration
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Idempotent upsert of the caller's FCM token. A token identifies one app
   * install, so if another account still holds it (logout without
   * unregister, account switch on the same phone) it is moved to this user.
   */
  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    const platform = dto.platform.toUpperCase(); // DB convention: IOS | ANDROID

    const [, device] = await this.prisma.$transaction([
      this.prisma.userDevice.deleteMany({
        where: { deviceToken: dto.token, userId: { not: userId } },
      }),
      this.prisma.userDevice.upsert({
        where: { deviceToken: dto.token },
        create: { userId, deviceToken: dto.token, platform, isActive: true },
        update: { platform, isActive: true },
      }),
    ]);

    this.logger.log(`Device registered for user ${userId}: ${dto.platform} ${tokenTail(dto.token)}`);

    return {
      message: 'Device registered',
      device: {
        id: device.id,
        platform: dto.platform,
        isActive: device.isActive,
        registeredAt: device.createdAt,
        updatedAt: device.updatedAt,
      },
    };
  }

  /** Logout: forget this token for the caller. Unknown token is not an error. */
  async unregisterDevice(userId: string, dto: UnregisterDeviceDto) {
    const { count } = await this.prisma.userDevice.deleteMany({
      where: { userId, deviceToken: dto.token },
    });

    this.logger.log(`Device unregistered for user ${userId}: ${tokenTail(dto.token)} (${count})`);

    return { message: 'Device unregistered', removed: count };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Sending
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Persist + deliver a notification: DB row (listed via GET /notifications),
   * socket `notification` event, and an FCM push to every active device of
   * the user unless the matching Settings toggle is off.
   *
   * Push problems are logged and swallowed (reported as `pushSent: false`);
   * only a failure to persist the row propagates.
   */
  async sendNotification(
    userId: string,
    input: SendNotificationInput,
  ): Promise<SendNotificationResult> {
    const { type, title, body } = input;
    const ids = this.toDataStrings(input.data);
    const rowData = { type, ...ids };

    const notification = await this.prisma.notification.create({
      data: { userId, type, title, body, data: rowData },
    });

    this.emitSafely(userId, 'notification', {
      id: notification.id,
      type,
      title,
      body,
      data: rowData,
      read: false,
      createdAt: notification.createdAt.toISOString(),
    });

    const pushSent = await this.pushToUser(userId, {
      type,
      title,
      body,
      data: { ...ids, type, notificationId: notification.id },
    });

    return { notificationId: notification.id, pushSent };
  }

  /**
   * Admin broadcast. Every targeted user gets the in-app row + socket event;
   * the push only goes to users whose promo toggle is on (missing
   * preferences row = default = off). Promotional push in Turkey needs prior
   * opt-in (Law 6563 / IYS).
   */
  async sendBroadcast(
    userIds: string[],
    input: { title: string; body: string },
  ): Promise<BroadcastResult> {
    const type: NotificationType = 'BROADCAST';
    const { title, body } = input;
    const targets = Array.from(new Set(userIds));
    const notificationIdByUser = new Map<string, string>();

    for (const ids of chunk(targets, BROADCAST_DB_CHUNK)) {
      const rows = await this.prisma.notification.createManyAndReturn({
        data: ids.map((userId) => ({ userId, type, title, body, data: { type } })),
        select: { id: true, userId: true, createdAt: true },
      });
      for (const row of rows) {
        notificationIdByUser.set(row.userId, row.id);
        this.emitSafely(row.userId, 'notification', {
          id: row.id,
          type,
          title,
          body,
          data: { type },
          read: false,
          createdAt: row.createdAt.toISOString(),
        });
      }
    }

    const reached = await this.pushBroadcast(notificationIdByUser, { type, title, body });

    this.logger.log(
      `Broadcast: ${targets.length} in-app, push delivered to ${reached.size} users`,
    );

    return { count: targets.length, pushSent: reached.size > 0, pushDelivered: reached.size };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Inbox
  // ──────────────────────────────────────────────────────────────────────

  /**
   * List persisted notifications for a user (paginated, newest first).
   * Returns the shape consumed by the mobile client:
   * { items, total, page, limit, unreadCount }
   */
  async listNotifications(userId: string, page = 1, limit = 20) {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 20));
    const skip = (safePage - 1) * safeLimit;

    const [items, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: safeLimit,
      }),
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, read: false } }),
    ]);

    return {
      items,
      total,
      page: safePage,
      limit: safeLimit,
      unreadCount,
    };
  }

  /**
   * Return the unread notification count for a user.
   */
  async getUnreadCount(userId: string) {
    const unreadCount = await this.prisma.notification.count({
      where: { userId, read: false },
    });
    return { unreadCount };
  }

  /**
   * Mark a single notification as read. Only affects notifications owned by the user.
   */
  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
      select: { id: true, read: true },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.read) {
      return { message: 'Notification already marked as read', updated: 0 };
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { read: true, readAt: new Date() },
    });

    return { message: 'Notification marked as read', updated: 1 };
  }

  /**
   * Mark all unread notifications as read for a user.
   */
  async markAllAsRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true, readAt: new Date() },
    });

    return {
      message: 'All notifications marked as read',
      updated: result.count,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Domain notifications. Titles/bodies are written in the user's stored UI
  // language (`notifications.*` keys of src/i18n, Turkish when none is
  // stored); the in-app row, the socket payload and the push carry the same
  // text. User-facing copy only: raw provider/pipeline errors are logged by the caller and
  // never interpolated into a body. These never throw: the voice and
  // narration pipelines must not fail because a notification failed.
  // ──────────────────────────────────────────────────────────────────────

  /**
   * A cloned voice finished training. Not used for ready-made (preset) voices:
   * those are READY the instant the user adds them.
   */
  async notifyVoiceReady(userId: string, voiceName: string, voiceProfileId: string) {
    this.emitSafely(userId, 'voice_status', {
      voiceProfileId,
      status: 'READY',
    });

    const lang = await this.languageOf(userId);
    await this.sendSafely(userId, {
      type: 'VOICE_READY',
      title: serverText('notifications.voiceReady.title', lang),
      body: serverText('notifications.voiceReady.body', lang, { voiceName }),
      data: { voiceProfileId },
    });
  }

  /**
   * @param errorMessage user-facing failure reason, already in the user's
   *   language (see voiceFailureReason); sent on the
   *   socket and stored on the profile. It is NOT put in the notification body.
   */
  async notifyVoiceFailed(
    userId: string,
    voiceName: string,
    voiceProfileId: string,
    errorMessage: string,
  ) {
    this.emitSafely(userId, 'voice_status', {
      voiceProfileId,
      status: 'FAILED',
      errorMessage,
    });

    const lang = await this.languageOf(userId);
    await this.sendSafely(userId, {
      type: 'VOICE_FAILED',
      title: serverText('notifications.voiceFailed.title', lang),
      body: serverText('notifications.voiceFailed.body', lang, { voiceName }),
      data: { voiceProfileId },
    });
  }

  async notifyNarrationReady(
    userId: string,
    storyTitle: string,
    narrationId: string,
    storyId: string,
  ) {
    this.emitSafely(userId, 'narration_status', {
      status: 'READY',
      narrationId,
      storyId,
    });

    const lang = await this.languageOf(userId);
    await this.sendSafely(userId, {
      type: 'NARRATION_READY',
      title: serverText('notifications.narrationReady.title', lang),
      body: serverText('notifications.narrationReady.body', lang, {
        storyTitle: storyTitle || serverText(STORY_FALLBACK_TITLE_KEY, lang),
      }),
      data: { narrationId, storyId },
    });
  }

  /**
   * @param errorMessage user-facing failure reason (already in the user's
   *   language) for the socket
   *   payload. Raw pipeline errors stay in Audio.errorMessage + logs.
   */
  async notifyNarrationFailed(
    userId: string,
    storyTitle: string,
    narrationId: string,
    storyId: string,
    errorMessage: string,
  ) {
    this.emitSafely(userId, 'narration_status', {
      status: 'FAILED',
      narrationId,
      storyId,
      errorMessage,
    });

    const lang = await this.languageOf(userId);
    await this.sendSafely(userId, {
      type: 'NARRATION_FAILED',
      title: serverText('notifications.narrationFailed.title', lang),
      body: serverText('notifications.narrationFailed.body', lang, {
        storyTitle: storyTitle || serverText(STORY_FALLBACK_TITLE_KEY, lang),
      }),
      data: { narrationId, storyId },
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // FCM internals
  // ──────────────────────────────────────────────────────────────────────

  /** Push one payload to all active devices of one user. Never throws. */
  private async pushToUser(
    userId: string,
    msg: { type: string; title: string; body: string; data: Record<string, string> },
  ): Promise<boolean> {
    try {
      const messaging = this.getMessaging();
      if (!messaging) return false;

      const gate = pushPreferenceFor(msg.type);
      if (gate) {
        const toggles = await this.userPreferences.getNotificationToggles(userId);
        if (!toggles[gate]) {
          this.logger.debug(`Push ${msg.type} skipped for ${userId}: ${gate} is off`);
          return false;
        }
      }

      const devices = await this.prisma.userDevice.findMany({
        where: { userId, isActive: true },
        select: { deviceToken: true },
      });
      const tokens = Array.from(new Set(devices.map((d) => d.deviceToken)));
      if (tokens.length === 0) return false;

      const base = this.buildMessage(msg.title, msg.body, msg.data);
      let delivered = 0;
      const dead: string[] = [];

      for (const batch of chunk(tokens, FCM_BATCH_LIMIT)) {
        const res = await messaging.sendEachForMulticast({ ...base, tokens: batch });
        const outcome = this.readBatch(batch, res);
        delivered += outcome.delivered.length;
        dead.push(...outcome.dead);
      }

      await this.removeDeadTokens(dead);

      if (delivered < tokens.length) {
        this.logger.warn(`Push ${msg.type} to ${userId}: ${delivered}/${tokens.length} delivered`);
      }
      return delivered > 0;
    } catch (err: any) {
      this.logger.warn(`Push ${msg.type} to ${userId} failed: ${err?.message ?? err}`);
      return false;
    }
  }

  /**
   * One message per device (each user has its own notificationId), sent with
   * sendEach in batches. Returns the set of users reached. Never throws.
   */
  private async pushBroadcast(
    notificationIdByUser: Map<string, string>,
    msg: { type: NotificationType; title: string; body: string },
  ): Promise<Set<string>> {
    const reached = new Set<string>();
    try {
      const messaging = this.getMessaging();
      if (!messaging || notificationIdByUser.size === 0) return reached;

      const gate = pushPreferenceFor(msg.type);
      const userIds = Array.from(notificationIdByUser.keys());
      const seen = new Set<string>();
      const targets: { userId: string; token: string }[] = [];

      for (const ids of chunk(userIds, BROADCAST_DB_CHUNK)) {
        const devices = await this.prisma.userDevice.findMany({
          where: {
            isActive: true,
            userId: { in: ids },
            ...(gate ? { user: notificationToggleOnWhere(gate) } : {}),
          },
          select: { userId: true, deviceToken: true },
        });
        for (const d of devices) {
          if (seen.has(d.deviceToken) || !notificationIdByUser.has(d.userId)) continue;
          seen.add(d.deviceToken);
          targets.push({ userId: d.userId, token: d.deviceToken });
        }
      }

      const dead: string[] = [];
      for (const batch of chunk(targets, FCM_BATCH_LIMIT)) {
        const messages: TokenMessage[] = batch.map((t) => ({
          ...this.buildMessage(msg.title, msg.body, {
            type: msg.type,
            notificationId: notificationIdByUser.get(t.userId)!,
          }),
          token: t.token,
        }));
        try {
          const res = await messaging.sendEach(messages);
          const outcome = this.readBatch(
            batch.map((t) => t.token),
            res,
          );
          for (const i of outcome.delivered) reached.add(batch[i].userId);
          dead.push(...outcome.dead);
        } catch (err: any) {
          this.logger.warn(`Broadcast push batch failed: ${err?.message ?? err}`);
        }
      }

      await this.removeDeadTokens(dead);
    } catch (err: any) {
      this.logger.warn(`Broadcast push failed: ${err?.message ?? err}`);
    }
    return reached;
  }

  private buildMessage(title: string, body: string, data: Record<string, string>): BaseMessage {
    return {
      notification: { title, body },
      data,
      android: {
        priority: 'high',
        notification: { channelId: ANDROID_CHANNEL_ID },
      },
      apns: { payload: { aps: { sound: 'default' } } },
    };
  }

  /** Indexes of delivered messages + tokens FCM says are permanently dead. */
  private readBatch(tokens: string[], res: BatchResponse): { delivered: number[]; dead: string[] } {
    const delivered: number[] = [];
    const dead: string[] = [];
    res.responses.forEach((r, i) => {
      if (r.success) {
        delivered.push(i);
        return;
      }
      const code = r.error?.code ?? 'unknown';
      if (DEAD_TOKEN_CODES.has(code)) {
        dead.push(tokens[i]);
      } else {
        this.logger.warn(`FCM send to ${tokenTail(tokens[i])} failed: ${code}`);
      }
    });
    return { delivered, dead };
  }

  /** Dead tokens are dead for every account: delete all rows holding them. */
  private async removeDeadTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    try {
      const { count } = await this.prisma.userDevice.deleteMany({
        where: { deviceToken: { in: Array.from(new Set(tokens)) } },
      });
      this.logger.log(`Removed ${count} unregistered/invalid FCM token(s)`);
    } catch (err: any) {
      this.logger.warn(`Failed to remove dead FCM tokens: ${err?.message ?? err}`);
    }
  }

  /**
   * Reuses the default firebase-admin app that AuthService.onModuleInit
   * initializes. null (push skipped) when Firebase is not configured.
   */
  private getMessaging(): Messaging | null {
    if (!admin.apps?.length) {
      if (!this.warnedNoFirebase) {
        this.warnedNoFirebase = true;
        this.logger.warn('Firebase Admin not initialized; push notifications are disabled');
      }
      return null;
    }
    return admin.messaging();
  }

  /** Primitive values only, stringified; FCM-reserved keys dropped. */
  private toDataStrings(data?: SendNotificationInput['data']): Record<string, string> {
    const out: Record<string, string> = {};
    if (!data) return out;
    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) continue;
      if (RESERVED_DATA_KEYS.has(key) || key.startsWith('google.') || key.startsWith('gcm.')) {
        continue;
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        out[key] = String(value);
      }
    }
    return out;
  }

  /** Stored UI language of the user (Turkish when none / unreadable). Never throws. */
  private languageOf(userId: string): Promise<UiLanguage> {
    return resolveUserUiLanguage(this.prisma, userId);
  }

  /** Domain wrapper: never propagate into the voice/narration pipelines. */
  private async sendSafely(userId: string, input: SendNotificationInput): Promise<void> {
    try {
      await this.sendNotification(userId, input);
    } catch (err: any) {
      this.logger.error(
        `Failed to persist ${input.type} notification for ${userId}: ${err?.message ?? err}`,
      );
    }
  }

  private emitSafely(userId: string, event: string, payload: Record<string, unknown>) {
    try {
      this.notificationsGateway.sendToUser(userId, event, payload);
    } catch (err: any) {
      this.logger.warn(`Failed to emit '${event}' to ${userId}: ${err?.message ?? err}`);
    }
  }
}
