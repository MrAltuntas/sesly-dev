import { apiErrorFromResponse } from './ApiError';
import { NotificationType } from '../models/Notification';

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('./ApiClient', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import NotificationService from './NotificationService';

// Backend Notification row as returned by listNotifications
// (notifications.service.ts): { items, total, page, limit, unreadCount }.
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'ntf-1',
  userId: 'u-1',
  type: 'VOICE_READY',
  title: 'Ses profilin hazir',
  body: '"Annemin sesi" sesi artik kullanilabilir.',
  data: { type: 'VOICE_READY', voiceProfileId: 'vp-1' },
  read: false,
  readAt: null,
  createdAt: '2026-09-27T20:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('NotificationService.list', () => {
  it('GETs /notifications with page and limit in the query string', async () => {
    mockGet.mockResolvedValue({
      items: [row(), row({ id: 'ntf-2', type: 'BROADCAST', data: { type: 'BROADCAST' }, read: true, readAt: '2026-09-27T21:00:00.000Z' })],
      total: 45,
      page: 1,
      limit: 20,
      unreadCount: 3,
    });

    const res = await NotificationService.list();

    expect(mockGet).toHaveBeenCalledWith('/notifications?page=1&limit=20');
    expect(res.total).toBe(45);
    expect(res.hasMore).toBe(true);
    expect(res.items).toHaveLength(2);
    expect(res.items[0]).toMatchObject({
      id: 'ntf-1',
      type: NotificationType.VOICE_READY,
      read: false,
      readAt: null,
      data: { type: 'VOICE_READY', voiceProfileId: 'vp-1' },
    });
    expect(res.items[1]).toMatchObject({ type: NotificationType.SYSTEM, read: true });
    expect(res.items[1].readAt).toEqual(new Date('2026-09-27T21:00:00.000Z'));
  });

  it('computes hasMore from the last page and skips malformed rows', async () => {
    mockGet.mockResolvedValue({
      items: [row(), { title: 'no id' }],
      total: 41,
      page: 3,
      limit: 20,
    });
    const res = await NotificationService.list(3, 20);
    expect(mockGet).toHaveBeenCalledWith('/notifications?page=3&limit=20');
    expect(res.items.map(n => n.id)).toEqual(['ntf-1']);
    expect(res.hasMore).toBe(false);
  });

  it('rethrows client errors and rejects a non-object body', async () => {
    mockGet.mockResolvedValue(null);
    await expect(NotificationService.list()).rejects.toThrow(/expected object/);

    const error = apiErrorFromResponse(401, {});
    mockGet.mockRejectedValue(error);
    await expect(NotificationService.list()).rejects.toBe(error);
  });
});

describe('NotificationService.getUnreadCount', () => {
  it('reads { unreadCount } from the backend', async () => {
    mockGet.mockResolvedValue({ unreadCount: 7 });
    await expect(NotificationService.getUnreadCount()).resolves.toBe(7);
    expect(mockGet).toHaveBeenCalledWith('/notifications/unread-count');
  });

  it('accepts legacy count shapes', async () => {
    mockGet.mockResolvedValue({ count: 2 });
    await expect(NotificationService.getUnreadCount()).resolves.toBe(2);
    mockGet.mockResolvedValue(4);
    await expect(NotificationService.getUnreadCount()).resolves.toBe(4);
    mockGet.mockResolvedValue({ something: 'else' });
    await expect(NotificationService.getUnreadCount()).resolves.toBe(0);
  });

  it('returns 0 instead of throwing on errors (badge must never crash)', async () => {
    mockGet.mockRejectedValue(apiErrorFromResponse(undefined, null));
    await expect(NotificationService.getUnreadCount()).resolves.toBe(0);
  });
});

describe('NotificationService.markAsRead / markAllAsRead', () => {
  it('POSTs /notifications/:id/read with an empty body', async () => {
    mockPost.mockResolvedValue({ message: 'Notification marked as read', updated: 1 });
    await expect(NotificationService.markAsRead('ntf-1')).resolves.toBeUndefined();
    expect(mockPost).toHaveBeenCalledWith('/notifications/ntf-1/read', {});
  });

  it('validates the id and rethrows 404', async () => {
    await expect(NotificationService.markAsRead('')).rejects.toThrow('Notification id is required');
    expect(mockPost).not.toHaveBeenCalled();

    const error = apiErrorFromResponse(404, { message: 'Notification not found' });
    mockPost.mockRejectedValue(error);
    await expect(NotificationService.markAsRead('ntf-x')).rejects.toBe(error);
  });

  it('POSTs /notifications/read-all and rethrows errors', async () => {
    mockPost.mockResolvedValue({ updated: 3 });
    await expect(NotificationService.markAllAsRead()).resolves.toBeUndefined();
    expect(mockPost).toHaveBeenCalledWith('/notifications/read-all', {});

    const error = apiErrorFromResponse(500, {});
    mockPost.mockRejectedValue(error);
    await expect(NotificationService.markAllAsRead()).rejects.toBe(error);
  });
});
