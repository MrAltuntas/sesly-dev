/**
 * Push bridge (src/hooks/usePushNotifications.ts) unit tests.
 *
 * pushRouting has its own tests (src/navigation/pushRouting.test.ts); here it
 * is mocked so the bridge's wiring (refresh, toast, mark read, session
 * register/cleanup) is tested in isolation.
 */

const mockPushInitialize = jest.fn();
const mockSetHandlers = jest.fn();
const mockOnSessionStarted = jest.fn();
const mockOnSessionEnded = jest.fn();
const mockServiceMarkAsRead = jest.fn();
const mockNavIsReady = jest.fn();
const mockNavGetRootState = jest.fn();
const mockNavGetCurrentRoute = jest.fn();
const mockIsAppShellReady = jest.fn();
const mockShouldSuppress = jest.fn();
const mockQueueOpen = jest.fn();
const mockClearPending = jest.fn();
const mockGetNotificationsStore = jest.fn();
const mockGetVoiceProfileStore = jest.fn();
const mockGetStoryStore = jest.fn();

jest.mock('../services/PushNotificationService', () => ({
  __esModule: true,
  default: {
    initialize: (...a: unknown[]) => mockPushInitialize(...a),
    setHandlers: (...a: unknown[]) => mockSetHandlers(...a),
    onSessionStarted: (...a: unknown[]) => mockOnSessionStarted(...a),
    onSessionEnded: (...a: unknown[]) => mockOnSessionEnded(...a),
  },
}));
jest.mock('../services/NotificationService', () => ({
  __esModule: true,
  default: {
    markAsRead: (...a: unknown[]) => mockServiceMarkAsRead(...a),
  },
}));
jest.mock('../navigation/navigationRef', () => ({
  navigationRef: {
    isReady: (...a: unknown[]) => mockNavIsReady(...a),
    getRootState: (...a: unknown[]) => mockNavGetRootState(...a),
    getCurrentRoute: (...a: unknown[]) => mockNavGetCurrentRoute(...a),
  },
}));
jest.mock('../navigation/pushRouting', () => ({
  isAppShellReady: (...a: unknown[]) => mockIsAppShellReady(...a),
  shouldSuppressForegroundToast: (...a: unknown[]) => mockShouldSuppress(...a),
  queueNotificationOpen: (...a: unknown[]) => mockQueueOpen(...a),
  clearPendingNotificationOpen: (...a: unknown[]) => mockClearPending(...a),
}));
jest.mock('./useNotifications', () => ({
  getNotificationsStore: (...a: unknown[]) => mockGetNotificationsStore(...a),
}));
jest.mock('./useVoiceProfile', () => ({
  getVoiceProfileStore: (...a: unknown[]) => mockGetVoiceProfileStore(...a),
}));
jest.mock('./useStory', () => ({
  getStoryStore: (...a: unknown[]) => mockGetStoryStore(...a),
}));
jest.mock('../utils/toast', () => ({
  showToast: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
}));

import { renderHook } from '@testing-library/react-native';
import {
  buildPushToast,
  buildPushToastAction,
  handleForegroundPush,
  handleOpenedPush,
  usePushNotificationBridge,
} from './usePushNotifications';
import { NotificationType, type PushPayload } from '../models/Notification';
import { showToast, type ToastAction } from '../utils/toast';
import i18n from '../i18n';

const payload = (overrides: Partial<PushPayload> = {}): PushPayload => ({
  type: NotificationType.NARRATION_READY,
  notificationId: 'notif-1',
  data: { type: 'NARRATION_READY', narrationId: 'narr-1', notificationId: 'notif-1' },
  title: null,
  body: null,
  ...overrides,
});

const notificationsStore = {
  notifications: [] as { id: string }[],
  markAsRead: jest.fn(),
  refreshUnreadCount: jest.fn(),
};
const storyStore = { narrationsSearch: 'tavsan', loadUserNarrations: jest.fn() };
const voiceProfileStore = { refresh: jest.fn() };

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockNavIsReady.mockReset().mockReturnValue(true);
  mockNavGetRootState.mockReset().mockReturnValue({ routes: [{ name: 'Main' }] });
  mockNavGetCurrentRoute.mockReset().mockReturnValue({ name: 'Home' });
  mockIsAppShellReady.mockReset().mockReturnValue(true);
  mockShouldSuppress.mockReset().mockReturnValue(false);
  mockQueueOpen.mockReset();
  mockClearPending.mockReset();
  mockServiceMarkAsRead.mockReset().mockResolvedValue(undefined);
  mockPushInitialize.mockReset();
  mockSetHandlers.mockReset().mockReturnValue(jest.fn());
  mockOnSessionStarted.mockReset().mockResolvedValue(undefined);
  mockOnSessionEnded.mockReset();

  notificationsStore.notifications = [];
  notificationsStore.markAsRead.mockReset().mockResolvedValue(undefined);
  notificationsStore.refreshUnreadCount.mockReset().mockResolvedValue(undefined);
  storyStore.loadUserNarrations.mockReset().mockResolvedValue(undefined);
  voiceProfileStore.refresh.mockReset().mockResolvedValue(undefined);
  mockGetNotificationsStore.mockReset().mockReturnValue(notificationsStore);
  mockGetStoryStore.mockReset().mockReturnValue(storyStore);
  mockGetVoiceProfileStore.mockReset().mockReturnValue(voiceProfileStore);
});

describe('buildPushToast', () => {
  it('prefers the backend title and body', () => {
    expect(
      buildPushToast(payload({ title: 'Masal hazır', body: 'Ayışığı Ormanı dinlemeye hazır' })),
    ).toEqual({ kind: 'success', title: 'Masal hazır', message: 'Ayışığı Ormanı dinlemeye hazır' });
  });

  it.each([
    [NotificationType.NARRATION_READY, 'success', 'Masalın hazır'],
    [NotificationType.NARRATION_FAILED, 'error', 'Masal hazırlanamadı'],
    [NotificationType.VOICE_READY, 'success', 'Sesin hazır'],
    [NotificationType.VOICE_FAILED, 'error', 'Ses hazırlanamadı'],
  ])('falls back to the %s copy', (type, kind, title) => {
    const toast = buildPushToast(payload({ type }));
    expect(toast?.kind).toBe(kind);
    expect(toast?.title).toBe(title);
    expect(toast?.message).toBeTruthy();
  });

  it('SYSTEM without text shows nothing; with text it is an info toast', () => {
    expect(buildPushToast(payload({ type: NotificationType.SYSTEM }))).toBeNull();
    expect(
      buildPushToast(payload({ type: NotificationType.SYSTEM, body: 'Yeni masallar eklendi' })),
    ).toEqual({ kind: 'info', title: 'Sesly', message: 'Yeni masallar eklendi' });
  });
});

describe('handleForegroundPush', () => {
  it('does nothing before navigation is ready', () => {
    mockNavIsReady.mockReturnValue(false);

    handleForegroundPush(payload());

    expect(notificationsStore.refreshUnreadCount).not.toHaveBeenCalled();
    expect(showToast.success).not.toHaveBeenCalled();
  });

  it('does nothing before the Main shell is mounted (a Login boot route)', () => {
    mockIsAppShellReady.mockReturnValue(false);

    handleForegroundPush(payload());

    expect(mockIsAppShellReady).toHaveBeenCalledWith({ routes: [{ name: 'Main' }] });
    expect(notificationsStore.refreshUnreadCount).not.toHaveBeenCalled();
    expect(showToast.success).not.toHaveBeenCalled();
  });

  it('narration push: refreshes badge + narrations (keeping the search) and toasts', () => {
    handleForegroundPush(payload({ title: 'Masalın hazır', body: 'Dinlemeye hazır' }));

    expect(notificationsStore.refreshUnreadCount).toHaveBeenCalledTimes(1);
    expect(storyStore.loadUserNarrations).toHaveBeenCalledWith(1, 'tavsan');
    expect(voiceProfileStore.refresh).not.toHaveBeenCalled();
    expect(showToast.success).toHaveBeenCalledWith(
      'Dinlemeye hazır',
      'Masalın hazır',
      expect.objectContaining({ label: 'Dinle' }),
    );
  });

  it('voice push: refreshes voice profiles and shows an error toast for failures', () => {
    handleForegroundPush(payload({ type: NotificationType.VOICE_FAILED, data: {} }));

    expect(voiceProfileStore.refresh).toHaveBeenCalledTimes(1);
    expect(storyStore.loadUserNarrations).not.toHaveBeenCalled();
    expect(showToast.error).toHaveBeenCalledWith(
      'Lütfen yeniden kayıt yapmayı dene.',
      'Ses hazırlanamadı',
      expect.objectContaining({ label: 'Göster' }),
    );
  });

  it('a ready narration toast offers Dinle, which opens the player and starts it', async () => {
    handleForegroundPush(payload({ title: 'Masalın hazır', body: 'Dinlemeye hazır' }));
    const action = (showToast.success as jest.Mock).mock.calls[0][2] as ToastAction;
    expect(action.label).toBe('Dinle');
    // Showing the toast navigates nowhere.
    expect(mockQueueOpen).not.toHaveBeenCalled();

    action.onPress();

    expect(mockQueueOpen).toHaveBeenCalledWith(
      { kind: 'player', narrationId: 'narr-1' },
      'notif-1',
      expect.any(Function),
      { autoplay: true },
    );
    // Like a tap, the action marks the notification read.
    const onOpened = mockQueueOpen.mock.calls[0][2] as (id: string) => void;
    onOpened('notif-1');
    await flush();
    expect(mockServiceMarkAsRead).toHaveBeenCalledWith('notif-1');
    // The stores were refreshed when the message arrived, not again here.
    expect(storyStore.loadUserNarrations).toHaveBeenCalledTimes(1);
  });

  it('a toast action pressed after the session ended does nothing', () => {
    handleForegroundPush(payload({ title: 'Masalın hazır', body: 'Dinlemeye hazır' }));
    const action = (showToast.success as jest.Mock).mock.calls[0][2] as ToastAction;

    // Signed out (or expired) while the snackbar was still up: back on Login.
    mockIsAppShellReady.mockReturnValue(false);
    action.onPress();
    expect(mockQueueOpen).not.toHaveBeenCalled();

    mockNavIsReady.mockReturnValue(false);
    mockIsAppShellReady.mockReturnValue(true);
    action.onPress();
    expect(mockQueueOpen).not.toHaveBeenCalled();
  });

  it('a story message shows Göster, which opens the story without autoplay', () => {
    handleForegroundPush(
      payload({
        type: NotificationType.NARRATION_FAILED,
        data: { type: 'NARRATION_FAILED', storyId: 'story-7' },
        body: 'Masal hazırlanamadı',
      }),
    );
    const action = (showToast.error as jest.Mock).mock.calls[0][2] as ToastAction;
    expect(action.label).toBe('Göster');

    action.onPress();

    expect(mockQueueOpen).toHaveBeenCalledWith(
      { kind: 'story', storyId: 'story-7' },
      'notif-1',
      expect.any(Function),
      { autoplay: false },
    );
  });

  it('a voice message shows Göster for Sesim', () => {
    const action = buildPushToastAction(payload({ type: NotificationType.VOICE_READY, data: {} }));
    expect(action?.label).toBe('Göster');
    action?.onPress();
    expect(mockQueueOpen).toHaveBeenCalledWith(
      { kind: 'voices' },
      'notif-1',
      expect.any(Function),
      { autoplay: false },
    );
  });

  it('a message without a destination has no action', () => {
    handleForegroundPush(payload({ type: NotificationType.SYSTEM, data: {}, body: 'Yeni masallar eklendi' }));
    expect(showToast.info).toHaveBeenCalledWith('Yeni masallar eklendi', 'Sesly', undefined);
    // A ready narration without any id has nowhere to go either.
    expect(buildPushToastAction(payload({ data: { type: 'NARRATION_READY' } }))).toBeUndefined();
  });

  it('the action labels follow the UI language', async () => {
    await i18n.changeLanguage('en');
    expect(buildPushToastAction(payload())?.label).toBe('Listen');
    expect(buildPushToastAction(payload({ type: NotificationType.VOICE_READY }))?.label).toBe('Show');
  });

  it('tolerates stores that are not created yet and refresh failures', async () => {
    mockGetStoryStore.mockReturnValue(null);
    mockGetVoiceProfileStore.mockReturnValue(null);
    notificationsStore.refreshUnreadCount.mockRejectedValue(new Error('offline'));

    expect(() => handleForegroundPush(payload())).not.toThrow();
    expect(() =>
      handleForegroundPush(payload({ type: NotificationType.VOICE_READY })),
    ).not.toThrow();
    await flush();
  });

  it('logs (does not throw) when a narration or voice refresh rejects', async () => {
    storyStore.loadUserNarrations.mockRejectedValue(new Error('narrations down'));
    voiceProfileStore.refresh.mockRejectedValue(new Error('voices down'));

    handleForegroundPush(payload());
    handleForegroundPush(payload({ type: NotificationType.VOICE_READY }));
    await flush();

    expect(console.warn).toHaveBeenCalledWith('[Push] narrations refresh failed:', expect.any(Error));
    expect(console.warn).toHaveBeenCalledWith('[Push] voice profiles refresh failed:', expect.any(Error));
  });

  it('still refreshes but skips the toast when the current screen already shows it', () => {
    mockShouldSuppress.mockReturnValue(true);
    const p = payload();

    handleForegroundPush(p);

    expect(mockShouldSuppress).toHaveBeenCalledWith(p, { name: 'Home' });
    expect(notificationsStore.refreshUnreadCount).toHaveBeenCalledTimes(1);
    expect(showToast.success).not.toHaveBeenCalled();
  });

  it('an empty SYSTEM push refreshes the badge without a toast', () => {
    handleForegroundPush(payload({ type: NotificationType.SYSTEM, data: {} }));

    expect(notificationsStore.refreshUnreadCount).toHaveBeenCalledTimes(1);
    expect(showToast.info).not.toHaveBeenCalled();
  });
});

describe('handleOpenedPush', () => {
  function openAndRunCallback(p: PushPayload): void {
    handleOpenedPush(p);
    expect(mockQueueOpen).toHaveBeenCalledTimes(1);
    const callback = mockQueueOpen.mock.calls[0][2] as (id: string) => void;
    callback(p.notificationId as string);
  }

  it('queues the route target with the notification id, without autoplay', () => {
    handleOpenedPush(payload());

    expect(mockQueueOpen).toHaveBeenCalledWith(
      { kind: 'player', narrationId: 'narr-1' },
      'notif-1',
      expect.any(Function),
      { autoplay: false },
    );
  });

  it('marks a loaded row read through the store (optimistic badge) and refreshes', async () => {
    notificationsStore.notifications = [{ id: 'notif-1' }];

    openAndRunCallback(payload());
    await flush();

    expect(notificationsStore.markAsRead).toHaveBeenCalledWith('notif-1');
    expect(mockServiceMarkAsRead).not.toHaveBeenCalled();
    expect(storyStore.loadUserNarrations).toHaveBeenCalledTimes(1);
  });

  it('marks an unloaded row read through the service, then refreshes the badge', async () => {
    openAndRunCallback(payload());
    await flush();

    expect(mockServiceMarkAsRead).toHaveBeenCalledWith('notif-1');
    expect(notificationsStore.markAsRead).not.toHaveBeenCalled();
    // Once from markPushNotificationRead, once from refreshStoresFor.
    expect(notificationsStore.refreshUnreadCount).toHaveBeenCalledTimes(2);
  });

  it('still refreshes the badge when the service mark-read fails', async () => {
    mockServiceMarkAsRead.mockRejectedValue(new Error('404'));

    openAndRunCallback(payload());
    await flush();

    expect(notificationsStore.refreshUnreadCount).toHaveBeenCalledTimes(2);
  });
});

describe('usePushNotificationBridge', () => {
  it('installs the handlers once until unmount and leaves FCM setup to the boot', () => {
    const unsubscribe = jest.fn();
    mockSetHandlers.mockReturnValue(unsubscribe);

    const { rerender, unmount } = renderHook(
      ({ userId }: { userId: string | null }) => usePushNotificationBridge(userId),
      { initialProps: { userId: null as string | null } },
    );
    rerender({ userId: 'user-123' });

    // BootStore initialises FCM after AuthService (Firebase first).
    expect(mockPushInitialize).not.toHaveBeenCalled();
    expect(mockSetHandlers).toHaveBeenCalledTimes(1);
    expect(mockSetHandlers).toHaveBeenCalledWith({
      onForegroundMessage: handleForegroundPush,
      onNotificationOpened: handleOpenedPush,
    });

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('cold start without a user ends the session but keeps a queued tap', () => {
    renderHook(() => usePushNotificationBridge(null));

    expect(mockOnSessionEnded).toHaveBeenCalledTimes(1);
    expect(mockClearPending).not.toHaveBeenCalled();
    expect(mockOnSessionStarted).not.toHaveBeenCalled();
  });

  it('registers on sign-in, not again for the same user, and cleans up on sign-out', () => {
    const { rerender } = renderHook(
      ({ userId }: { userId: string | null }) => usePushNotificationBridge(userId),
      { initialProps: { userId: 'user-123' as string | null } },
    );
    expect(mockOnSessionStarted).toHaveBeenCalledTimes(1);

    rerender({ userId: 'user-123' });
    expect(mockOnSessionStarted).toHaveBeenCalledTimes(1);

    rerender({ userId: null });
    expect(mockClearPending).toHaveBeenCalledTimes(1);
    expect(mockOnSessionEnded).toHaveBeenCalledTimes(1);

    rerender({ userId: 'user-456' });
    expect(mockOnSessionStarted).toHaveBeenCalledTimes(2);
  });

  it('swallows an onSessionStarted rejection', async () => {
    mockOnSessionStarted.mockRejectedValue(new Error('no permission'));

    renderHook(() => usePushNotificationBridge('user-123'));
    await flush();

    expect(mockOnSessionStarted).toHaveBeenCalledTimes(1);
  });
});
