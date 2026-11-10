/**
 * Notifications Hook with MobX Store
 * Backs NotificationsScreen with paged data + unread count.
 */

import {makeAutoObservable, runInAction} from 'mobx';
import {useMemo} from 'react';
import NotificationService from '../services/NotificationService';
import {Notification} from '../models/Notification';
import {showToast} from '../utils/toast';
import { msg } from '../i18n/messages';
import {FailureKind, classifyFailure} from '../services/ApiError';
import {getConnectivityStore} from '../stores/ConnectivityStore';

// ============================================================================
// Notifications Store (MobX)
// ============================================================================

class NotificationsStore {
  notifications: Notification[] = [];
  unreadCount = 0;
  isLoading = false;
  isRefreshing = false;
  errorMessage = '';
  /** What the last failed load ran into (offline, server...); null without an error. */
  errorKind: FailureKind | null = null;

  // Pagination
  page = 1;
  limit = 20;
  hasMore = false;
  total = 0;

  constructor() {
    makeAutoObservable(this);
  }

  // ============================================================================
  // Computed
  // ============================================================================

  get isEmpty(): boolean {
    return !this.isLoading && this.notifications.length === 0;
  }

  // ============================================================================
  // Fetching
  // ============================================================================

  /**
   * Load the first page of notifications + unread count.
   */
  async load(): Promise<void> {
    try {
      runInAction(() => {
        this.isLoading = true;
        this.errorMessage = '';
        this.errorKind = null;
        this.page = 1;
      });

      const [listResponse, unread] = await Promise.all([
        NotificationService.list(1, this.limit),
        NotificationService.getUnreadCount(),
      ]);

      runInAction(() => {
        this.notifications = [...listResponse.items];
        this.total = listResponse.total;
        this.hasMore = listResponse.hasMore;
        this.unreadCount = unread;
      });
    } catch (error) {
      console.error('Load notifications error:', error);
      runInAction(() => {
        this.errorMessage = msg('notifications.loadFailed');
        this.errorKind = classifyFailure(error, getConnectivityStore());
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  /**
   * Refresh (pull-to-refresh) — reloads first page.
   */
  async refresh(): Promise<void> {
    try {
      runInAction(() => {
        this.isRefreshing = true;
      });
      await this.load();
    } finally {
      runInAction(() => {
        this.isRefreshing = false;
      });
    }
  }

  /**
   * Load next page (append).
   */
  async loadMore(): Promise<void> {
    if (!this.hasMore || this.isLoading) return;
    try {
      const nextPage = this.page + 1;
      const response = await NotificationService.list(nextPage, this.limit);
      runInAction(() => {
        this.page = nextPage;
        // The backend paginates by offset: a socket prepend shifts page N+1
        // back by one row, so its first item may already be listed.
        const seen = new Set(this.notifications.map(n => n.id));
        const fresh = response.items.filter(n => !seen.has(n.id));
        this.notifications = [...this.notifications, ...fresh];
        this.total = response.total;
        this.hasMore = response.hasMore;
      });
    } catch (error) {
      console.error('Load more notifications error:', error);
    }
  }

  // ============================================================================
  // Mutations
  // ============================================================================

  /**
   * Mark a single notification as read (optimistic).
   */
  async markAsRead(id: string): Promise<void> {
    const target = this.notifications.find(n => n.id === id);
    if (!target || target.read) return;

    // Optimistic update
    runInAction(() => {
      this.notifications = this.notifications.map(n =>
        n.id === id ? {...n, read: true, readAt: new Date()} : n,
      );
      this.unreadCount = Math.max(0, this.unreadCount - 1);
    });

    try {
      await NotificationService.markAsRead(id);
    } catch (error) {
      console.error('Mark as read error:', error);
      // Roll back
      runInAction(() => {
        this.notifications = this.notifications.map(n =>
          n.id === id ? {...n, read: false, readAt: null} : n,
        );
        this.unreadCount = this.unreadCount + 1;
      });
      showToast.error(msg('notifications.updateFailed'));
    }
  }

  /**
   * Mark all as read (optimistic).
   */
  async markAllAsRead(): Promise<void> {
    if (this.unreadCount === 0) return;
    const previous = [...this.notifications];
    const previousUnread = this.unreadCount;

    runInAction(() => {
      this.notifications = this.notifications.map(n => ({
        ...n,
        read: true,
        readAt: n.readAt ?? new Date(),
      }));
      this.unreadCount = 0;
    });

    try {
      await NotificationService.markAllAsRead();
    } catch (error) {
      console.error('Mark all as read error:', error);
      runInAction(() => {
        this.notifications = previous;
        this.unreadCount = previousUnread;
      });
      showToast.error(msg('common.actionFailed'));
    }
  }

  /**
   * Refresh only the unread badge. Safe to call from WebSocket push.
   */
  async refreshUnreadCount(): Promise<void> {
    try {
      const count = await NotificationService.getUnreadCount();
      runInAction(() => {
        this.unreadCount = count;
      });
    } catch (error) {
      console.error('Refresh unread count error:', error);
    }
  }

  /**
   * Prepend a notification that arrived over WebSocket.
   */
  prependNotification(notification: Notification): void {
    runInAction(() => {
      const exists = this.notifications.some(n => n.id === notification.id);
      if (!exists) {
        this.notifications = [notification, ...this.notifications];
        this.total += 1;
        if (!notification.read) {
          this.unreadCount += 1;
        }
      }
    });
  }

  reset(): void {
    runInAction(() => {
      this.notifications = [];
      this.unreadCount = 0;
      this.page = 1;
      this.hasMore = false;
      this.total = 0;
      this.isLoading = false;
      this.isRefreshing = false;
      this.errorMessage = '';
      this.errorKind = null;
    });
  }
}

// ============================================================================
// Hook Export (Singleton Pattern)
// ============================================================================

let notificationsStoreInstance: NotificationsStore | null = null;

export function useNotifications(): NotificationsStore {
  const store = useMemo(() => {
    if (!notificationsStoreInstance) {
      notificationsStoreInstance = new NotificationsStore();
    }
    return notificationsStoreInstance;
  }, []);

  return store;
}

export function getNotificationsStore(): NotificationsStore {
  if (!notificationsStoreInstance) {
    notificationsStoreInstance = new NotificationsStore();
  }
  return notificationsStoreInstance;
}

export {NotificationsStore};
