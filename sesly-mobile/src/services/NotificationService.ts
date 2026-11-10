/**
 * Notification Service
 * Handles fetching, reading, and counting user notifications.
 * Matches backend Aşama 1 contract:
 *   GET  /notifications?page=&limit=
 *   GET  /notifications/unread-count
 *   POST /notifications/:id/read
 *   POST /notifications/read-all
 */

import ApiClient from './ApiClient';
import {
  Notification,
  NotificationListResponse,
  parseNotificationListResponseFromJSON,
  parseUnreadCountFromJSON,
} from '../models/Notification';

// ============================================================================
// Notification Service Class (Singleton)
// ============================================================================

class NotificationService {
  private static instance: NotificationService;

  private constructor() {}

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  // ============================================================================
  // Fetching Notifications
  // ============================================================================

  /**
   * Get paginated list of notifications for the current user.
   */
  public async list(
    page: number = 1,
    limit: number = 20,
  ): Promise<NotificationListResponse> {
    try {
      const response = await ApiClient.get<unknown>(
        `/notifications?page=${page}&limit=${limit}`,
      );
      return parseNotificationListResponseFromJSON(response);
    } catch (error) {
      console.error('Failed to list notifications:', error);
      throw error;
    }
  }

  /**
   * Get unread notification count.
   */
  public async getUnreadCount(): Promise<number> {
    try {
      const response = await ApiClient.get<unknown>(
        '/notifications/unread-count',
      );
      return parseUnreadCountFromJSON(response);
    } catch (error) {
      console.error('Failed to get unread count:', error);
      return 0;
    }
  }

  /**
   * Mark a single notification as read.
   */
  public async markAsRead(id: string): Promise<void> {
    if (!id) {
      throw new Error('Notification id is required');
    }
    try {
      await ApiClient.post(`/notifications/${id}/read`, {});
    } catch (error) {
      console.error(`Failed to mark notification ${id} as read:`, error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read.
   */
  public async markAllAsRead(): Promise<void> {
    try {
      await ApiClient.post('/notifications/read-all', {});
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
      throw error;
    }
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export default NotificationService.getInstance();
export type {Notification};
