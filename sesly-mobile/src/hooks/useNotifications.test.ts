/**
 * NotificationsStore (src/hooks/useNotifications.ts) unit tests.
 * NotificationService is mocked; payloads go through the real parsers.
 */

const mockList = jest.fn();
const mockGetUnreadCount = jest.fn();
const mockMarkAsRead = jest.fn();
const mockMarkAllAsRead = jest.fn();

jest.mock('../services/NotificationService', () => ({
  __esModule: true,
  default: {
    list: (...a: unknown[]) => mockList(...a),
    getUnreadCount: (...a: unknown[]) => mockGetUnreadCount(...a),
    markAsRead: (...a: unknown[]) => mockMarkAsRead(...a),
    markAllAsRead: (...a: unknown[]) => mockMarkAllAsRead(...a),
  },
}));
jest.mock('../utils/toast', () => ({
  showToast: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
}));

import { renderHook } from '@testing-library/react-native';
import {
  NotificationsStore,
  getNotificationsStore,
  useNotifications,
} from './useNotifications';
import {
  parseNotificationFromJSON,
  parseNotificationListResponseFromJSON,
  type Notification,
} from '../models/Notification';
import { API_ERROR_CODES, ApiError, apiErrorFromResponse } from '../services/ApiError';
import { showToast } from '../utils/toast';
import { mockNotificationJSON } from '../test-utils/mock-data';

const toastError = showToast.error as jest.Mock;

const note = (id: string, read = false, readAt: string | null = null): Notification =>
  parseNotificationFromJSON({ ...mockNotificationJSON, id, read, readAt });

/** GET /notifications?page&limit response, parsed like NotificationService.list. */
function page(ids: string[], opts: { page?: number; total?: number; hasMore?: boolean } = {}) {
  return parseNotificationListResponseFromJSON({
    items: ids.map(id => ({ ...mockNotificationJSON, id })),
    total: opts.total ?? ids.length,
    page: opts.page ?? 1,
    limit: 20,
    hasMore: opts.hasMore ?? false,
  });
}

const ids = (store: NotificationsStore) => store.notifications.map(n => n.id);

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockList.mockReset();
  mockGetUnreadCount.mockReset().mockResolvedValue(0);
  mockMarkAsRead.mockReset().mockResolvedValue(undefined);
  mockMarkAllAsRead.mockReset().mockResolvedValue(undefined);
});

describe('NotificationsStore.load', () => {
  it('loads page 1 and the unread count', async () => {
    mockList.mockResolvedValue(page(['n1', 'n2'], { total: 25, hasMore: true }));
    mockGetUnreadCount.mockResolvedValue(3);
    const store = new NotificationsStore();

    await store.load();

    expect(mockList).toHaveBeenCalledWith(1, 20);
    expect(ids(store)).toEqual(['n1', 'n2']);
    expect(store.total).toBe(25);
    expect(store.hasMore).toBe(true);
    expect(store.unreadCount).toBe(3);
    expect(store.page).toBe(1);
    expect(store.isLoading).toBe(false);
    expect(store.isEmpty).toBe(false);
    expect(store.errorMessage).toBe('');
  });

  it('isEmpty only after loading finished with no items', async () => {
    let release: (v: unknown) => void = () => {};
    mockList.mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      }),
    );
    const store = new NotificationsStore();

    const pending = store.load();
    expect(store.isLoading).toBe(true);
    expect(store.isEmpty).toBe(false);

    release(page([]));
    await pending;
    expect(store.isEmpty).toBe(true);
  });

  it('keeps the previous list and sets an error on failure', async () => {
    mockList.mockResolvedValueOnce(page(['n1']));
    const store = new NotificationsStore();
    await store.load();

    mockList.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
    await store.load();

    expect(ids(store)).toEqual(['n1']);
    expect(store.errorMessage).toBe('Bildirimler yüklenemedi');
    expect(store.errorKind).toBe('server');
    expect(store.isLoading).toBe(false);
  });

  it('keeps the failure kind next to the error, and a new load clears it', async () => {
    const store = new NotificationsStore();
    mockList.mockRejectedValueOnce(new ApiError({ status: 0, code: API_ERROR_CODES.NETWORK, message: 'offline' }));
    await store.load();
    expect(store.errorKind).toBe('offline');

    let resolve: (value: ReturnType<typeof page>) => void = () => undefined;
    mockList.mockReturnValueOnce(new Promise(r => (resolve = r)));
    const pending = store.load();
    expect(store.errorKind).toBeNull();
    expect(store.errorMessage).toBe('');
    resolve(page(['n1']));
    await pending;
    expect(store.errorKind).toBeNull();
  });

  it('refresh reloads page 1 and toggles isRefreshing', async () => {
    mockList.mockResolvedValue(page(['n1']));
    const store = new NotificationsStore();

    const pending = store.refresh();
    expect(store.isRefreshing).toBe(true);
    await pending;

    expect(store.isRefreshing).toBe(false);
    expect(mockList).toHaveBeenCalledWith(1, 20);
  });
});

describe('NotificationsStore.loadMore', () => {
  it('appends the next page', async () => {
    mockList
      .mockResolvedValueOnce(page(['n1', 'n2'], { total: 4, hasMore: true }))
      .mockResolvedValueOnce(page(['n3', 'n4'], { page: 2, total: 4, hasMore: false }));
    const store = new NotificationsStore();
    await store.load();

    await store.loadMore();

    expect(mockList).toHaveBeenLastCalledWith(2, 20);
    expect(ids(store)).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(store.page).toBe(2);
    expect(store.hasMore).toBe(false);
  });

  it('does nothing when there is no next page or a load is running', async () => {
    const store = new NotificationsStore();
    await store.loadMore();
    expect(mockList).not.toHaveBeenCalled();

    store.hasMore = true;
    store.isLoading = true;
    await store.loadMore();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('a failure keeps the current page', async () => {
    mockList
      .mockResolvedValueOnce(page(['n1'], { total: 2, hasMore: true }))
      .mockRejectedValueOnce(apiErrorFromResponse(undefined, null));
    const store = new NotificationsStore();
    await store.load();

    await store.loadMore();

    expect(ids(store)).toEqual(['n1']);
    expect(store.page).toBe(1);
    expect(store.hasMore).toBe(true);
  });

  // Regression (fixed 2026-09-28, was BUG): src/hooks/useNotifications.ts:105 - loadMore appends without
  // de-duplicating. The backend paginates by offset, so after
  // prependNotification (socket) inserts a new row, page 2 starts one row
  // earlier and repeats the last item of page 1: duplicate ids in the list
  // (FlatList duplicate keys, the row shows twice).
  it('loadMore after a socket prepend does not duplicate rows', async () => {
    mockList
      .mockResolvedValueOnce(page(['n2', 'n3'], { total: 4, hasMore: true }))
      // Server now has n1 on top, so offset 2 returns n3, n4.
      .mockResolvedValueOnce(page(['n3', 'n4'], { page: 2, total: 5, hasMore: false }));
    const store = new NotificationsStore();
    await store.load();
    store.prependNotification(note('n1'));

    await store.loadMore();

    expect(ids(store)).toEqual(['n1', 'n2', 'n3', 'n4']);
  });
});

describe('NotificationsStore.markAsRead', () => {
  it('optimistically marks the row read and decrements the badge', async () => {
    mockList.mockResolvedValue(page(['n1', 'n2']));
    mockGetUnreadCount.mockResolvedValue(2);
    const store = new NotificationsStore();
    await store.load();

    await store.markAsRead('n1');

    expect(mockMarkAsRead).toHaveBeenCalledWith('n1');
    expect(store.notifications[0].read).toBe(true);
    expect(store.notifications[0].readAt).toBeInstanceOf(Date);
    expect(store.notifications[1].read).toBe(false);
    expect(store.unreadCount).toBe(1);
  });

  it('skips unknown or already-read rows', async () => {
    const store = new NotificationsStore();
    store.notifications = [note('n1', true, '2026-09-01T00:00:00.000Z')];
    store.unreadCount = 1;

    await store.markAsRead('n1');
    await store.markAsRead('missing');

    expect(mockMarkAsRead).not.toHaveBeenCalled();
    expect(store.unreadCount).toBe(1);
  });

  it('never drives the badge below zero', async () => {
    const store = new NotificationsStore();
    store.notifications = [note('n1')];
    store.unreadCount = 0;

    await store.markAsRead('n1');

    expect(store.unreadCount).toBe(0);
  });

  it('rolls back and toasts on failure', async () => {
    mockMarkAsRead.mockRejectedValue(apiErrorFromResponse(500, {}));
    const store = new NotificationsStore();
    store.notifications = [note('n1')];
    store.unreadCount = 1;

    await store.markAsRead('n1');

    expect(store.notifications[0].read).toBe(false);
    expect(store.notifications[0].readAt).toBeNull();
    expect(store.unreadCount).toBe(1);
    expect(toastError).toHaveBeenCalledWith('Bildirim güncellenemedi');
  });
});

describe('NotificationsStore.markAllAsRead', () => {
  it('marks every row read and zeroes the badge, keeping existing readAt', async () => {
    const store = new NotificationsStore();
    store.notifications = [note('n1'), note('n2', true, '2026-09-01T00:00:00.000Z')];
    store.unreadCount = 1;

    await store.markAllAsRead();

    expect(mockMarkAllAsRead).toHaveBeenCalledTimes(1);
    expect(store.notifications.every(n => n.read)).toBe(true);
    expect(store.notifications[1].readAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(store.unreadCount).toBe(0);
  });

  it('is a no-op when nothing is unread', async () => {
    const store = new NotificationsStore();
    store.notifications = [note('n1', true)];

    await store.markAllAsRead();

    expect(mockMarkAllAsRead).not.toHaveBeenCalled();
  });

  it('restores the previous rows and badge on failure', async () => {
    mockMarkAllAsRead.mockRejectedValue(apiErrorFromResponse(500, {}));
    const store = new NotificationsStore();
    store.notifications = [note('n1'), note('n2')];
    store.unreadCount = 2;

    await store.markAllAsRead();

    expect(store.notifications.map(n => n.read)).toEqual([false, false]);
    expect(store.unreadCount).toBe(2);
    expect(toastError).toHaveBeenCalledWith('İşlem başarısız');
  });
});

describe('NotificationsStore badge + socket helpers', () => {
  it('refreshUnreadCount updates the badge and ignores failures', async () => {
    const store = new NotificationsStore();
    mockGetUnreadCount.mockResolvedValueOnce(7);
    await store.refreshUnreadCount();
    expect(store.unreadCount).toBe(7);

    mockGetUnreadCount.mockRejectedValueOnce(apiErrorFromResponse(undefined, null));
    await store.refreshUnreadCount();
    expect(store.unreadCount).toBe(7);
  });

  it('prependNotification adds new rows once and bumps total/unread', () => {
    const store = new NotificationsStore();
    store.notifications = [note('n1')];
    store.total = 1;

    store.prependNotification(note('n2'));
    store.prependNotification(note('n2'));
    store.prependNotification(note('n3', true));

    expect(ids(store)).toEqual(['n3', 'n2', 'n1']);
    expect(store.total).toBe(3);
    expect(store.unreadCount).toBe(1);
  });

  it('reset clears everything', async () => {
    mockList.mockResolvedValue(page(['n1'], { total: 30, hasMore: true }));
    mockGetUnreadCount.mockResolvedValue(4);
    const store = new NotificationsStore();
    await store.load();
    store.errorMessage = 'x';
    store.errorKind = 'server';

    store.reset();

    expect(store.notifications).toEqual([]);
    expect(store.unreadCount).toBe(0);
    expect(store.page).toBe(1);
    expect(store.hasMore).toBe(false);
    expect(store.total).toBe(0);
    expect(store.errorMessage).toBe('');
    expect(store.errorKind).toBeNull();
    expect(store.isLoading).toBe(false);
    expect(store.isRefreshing).toBe(false);
  });
});

describe('useNotifications / getNotificationsStore', () => {
  it('share one store instance', () => {
    const first = renderHook(() => useNotifications());
    const second = renderHook(() => useNotifications());

    expect(second.result.current).toBe(first.result.current);
    expect(getNotificationsStore()).toBe(first.result.current);
  });

  it('getNotificationsStore creates the singleton lazily', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./useNotifications') as typeof import('./useNotifications');
      const store = mod.getNotificationsStore();
      expect(mod.getNotificationsStore()).toBe(store);
      expect(store.notifications).toEqual([]);
    });
  });
});
