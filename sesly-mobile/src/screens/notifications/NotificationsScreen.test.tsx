/**
 * NotificationsScreen (design/v4/playful): rows as cards on their lips, the
 * leading image per type, the unread dot, mark read, routing, pagination,
 * refresh and the loading / error / empty states.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { mockNavigation } from '../../test-utils/mocks/navigation';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { contrastRatio } from '../../theme/color';
import { PALETTE_KEYS, type PaletteKey } from '../../theme/palettes';
import { Notification, NotificationType } from '../../models/Notification';
import NotificationsScreen, {
  NOTIFICATION_ROW_HEIGHT,
  notificationKind,
  notificationStoryId,
  notificationVoiceProfileId,
} from './NotificationsScreen';

jest.setTimeout(60000);

const NOW = new Date('2026-10-13T21:42:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const note = (
  id: string,
  type: NotificationType,
  title: string,
  body: string,
  agoMs: number,
  patch: Partial<Notification> = {},
): Notification => ({
  id,
  userId: 'u-1',
  type,
  title,
  body,
  data: null,
  read: true,
  readAt: null,
  createdAt: new Date(NOW.getTime() - agoMs),
  ...patch,
});

const NOTES: Notification[] = [
  note('n-1', NotificationType.NARRATION_READY, 'Masalın hazır', 'Bremen Mızıkacıları dinlemeye hazır.', 5 * MIN, {
    read: false,
    data: { narrationId: 'nar-1', storyId: 's-1' },
  }),
  note('n-2', NotificationType.VOICE_READY, 'Ses profilin hazır', '"Zeynep" sesi artık kullanılabilir.', 2 * HOUR, {
    read: false,
    data: { voiceProfileId: 'vp-1' },
  }),
  note('n-3', NotificationType.NARRATION_FAILED, 'Masal hazırlanamadı', 'Uykulu Ay hazırlanamadı.', DAY, {
    data: { narrationId: 'nar-3', storyId: 's-3' },
  }),
  note('n-4', NotificationType.VOICE_FAILED, 'Ses hazırlanamadı', 'Bir sorun oluştu.', 3 * DAY, {
    data: { voiceProfileId: 'vp-unknown' },
  }),
  note('n-5', NotificationType.SYSTEM, 'Yeni masallar eklendi', '', 7 * DAY),
  note('n-6', NotificationType.NARRATION_READY, 'Masalın hazır', 'Kimliği olmayan masal.', 8 * DAY),
];

interface MockNotificationsStore {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  isRefreshing: boolean;
  errorMessage: string;
  errorKind: string | null;
  load: jest.Mock;
  refresh: jest.Mock;
  loadMore: jest.Mock;
  markAsRead: jest.Mock;
  markAllAsRead: jest.Mock;
}

let mockStore: MockNotificationsStore;
jest.mock('../../hooks/useNotifications', () => ({ useNotifications: () => mockStore }));

let mockStoryStore: { stories: unknown[]; favoriteStories: unknown[] } | null;
jest.mock('../../hooks/useStory', () => ({ getStoryStore: () => mockStoryStore }));

let mockVoiceStore: { voiceProfiles: { id: string; name: string }[] } | null;
jest.mock('../../hooks/useVoiceProfile', () => ({ getVoiceProfileStore: () => mockVoiceStore }));

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

beforeEach(() => {
  jest.setSystemTime(NOW);
  mockStore = {
    notifications: NOTES,
    unreadCount: 2,
    isLoading: false,
    isRefreshing: false,
    errorMessage: '',
    errorKind: null,
    load: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    loadMore: jest.fn().mockResolvedValue(undefined),
    markAsRead: jest.fn().mockResolvedValue(undefined),
    markAllAsRead: jest.fn().mockResolvedValue(undefined),
  };
  mockStoryStore = null;
  mockVoiceStore = { voiceProfiles: [{ id: 'vp-1', name: 'zeynep' }] };
});

async function renderNotifications(theme: PaletteKey = 'gece-mavisi') {
  const view = renderWithProviders(<NotificationsScreen />, { theme });
  await act(async () => undefined);
  return view;
}

describe('notification helpers', () => {
  it('maps the type to story, voice or system', () => {
    expect(notificationKind(NotificationType.NARRATION_READY)).toBe('story');
    expect(notificationKind(NotificationType.NARRATION_FAILED)).toBe('story');
    expect(notificationKind(NotificationType.VOICE_READY)).toBe('voice');
    expect(notificationKind(NotificationType.VOICE_FAILED)).toBe('voice');
    expect(notificationKind(NotificationType.SYSTEM)).toBe('system');
  });

  it('reads the story and voice ids only from the matching type', () => {
    expect(notificationStoryId(NOTES[0])).toBe('s-1');
    expect(notificationStoryId(NOTES[5])).toBeNull();
    expect(notificationStoryId({ type: NotificationType.SYSTEM, data: { storyId: 's-9' } })).toBeNull();
    expect(notificationStoryId({ type: NotificationType.NARRATION_READY, data: { storyId: 7 } })).toBeNull();
    expect(notificationVoiceProfileId(NOTES[1])).toBe('vp-1');
    expect(notificationVoiceProfileId(NOTES[0])).toBeNull();
    expect(notificationVoiceProfileId({ type: NotificationType.VOICE_READY, data: null })).toBeNull();
  });
});

describe('NotificationsScreen', () => {
  it('loads on mount and shows the back bar with "Hepsi okundu" while something is unread', async () => {
    await renderNotifications();
    expect(mockStore.load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('header', { name: 'Bildirimler' })).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Hepsi okundu' }));
    expect(mockStore.markAllAsRead).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('appbar-back'));
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('hides "Hepsi okundu" when everything is read', async () => {
    mockStore.unreadCount = 0;
    await renderNotifications();
    expect(screen.queryByRole('button', { name: 'Hepsi okundu' })).toBeNull();
  });

  it('draws each row: type, relative time, and the title and body as the backend wrote them', async () => {
    await renderNotifications();
    // No uppercase labels in the playful design.
    expect(screen.getAllByText('Masal')).toHaveLength(3);
    expect(screen.getAllByText('Ses')).toHaveLength(2);
    expect(screen.getByText('Bilgi')).toBeOnTheScreen();
    expect(screen.queryByText('MASAL')).toBeNull();

    expect(screen.getByText('5 dk önce')).toBeOnTheScreen();
    expect(screen.getByText('2 sa önce')).toBeOnTheScreen();
    expect(screen.getByText('1 gün önce')).toBeOnTheScreen();
    expect(screen.getByText('3 gün önce')).toBeOnTheScreen();
    expect(screen.getAllByText('1 hafta önce')).toHaveLength(2);

    expect(screen.getAllByText('Masalın hazır')).toHaveLength(2);
    expect(screen.getByText('Bremen Mızıkacıları dinlemeye hazır.')).toBeOnTheScreen();
    expect(screen.getByText('"Zeynep" sesi artık kullanılabilir.')).toBeOnTheScreen();
  });

  it('marks only unread rows with the dot and says so to screen readers', async () => {
    await renderNotifications();
    expect(screen.getByTestId('notification-unread-n-1')).toBeOnTheScreen();
    expect(screen.getByTestId('notification-unread-n-2')).toBeOnTheScreen();
    expect(screen.queryByTestId('notification-unread-n-3')).toBeNull();
    expect(screen.getByTestId('notification-row-n-1').props.accessibilityLabel).toBe(
      'Okunmadı, Masal, Masalın hazır, Bremen Mızıkacıları dinlemeye hazır., 5 dk önce',
    );
    expect(screen.getByTestId('notification-row-n-5').props.accessibilityLabel).toBe(
      'Bilgi, Yeni masallar eklendi, 1 hafta önce',
    );
  });

  it('leads with a story cover, a voice avatar or a neutral icon', async () => {
    await renderNotifications();
    // Story notifications with a story id: a cover.
    expect(screen.getByTestId('notification-cover-n-1')).toBeOnTheScreen();
    expect(screen.getByTestId('notification-cover-n-3')).toBeOnTheScreen();
    // Voice the app knows: its initial, uppercased, on a rounded avatar.
    expect(screen.getByText('Z')).toBeOnTheScreen();
    expect(screen.getByTestId('notification-avatar-n-2')).toBeOnTheScreen();
    expect(screen.queryByTestId('notification-icon-n-2')).toBeNull();
    // Unknown voice, system, and a story notification without an id: the icon.
    expect(screen.getByTestId('notification-icon-n-4')).toBeOnTheScreen();
    expect(screen.getByTestId('notification-icon-n-5')).toBeOnTheScreen();
    expect(screen.getByTestId('notification-icon-n-6')).toBeOnTheScreen();
    expect(screen.queryByTestId('notification-cover-n-6')).toBeNull();
  });

  it('uses the story the app already knows for the cover, and works without the stores', async () => {
    mockStoryStore = {
      stories: [{ id: 's-1', translationGroupId: 'g-1', coverImageUrl: null, category: 'BEDTIME' }],
      favoriteStories: [{ id: 's-3', translationGroupId: null, coverImageUrl: null, category: null }],
    };
    mockVoiceStore = null;
    await renderNotifications();
    expect(screen.getByTestId('notification-cover-n-1')).toBeOnTheScreen();
    expect(screen.getByTestId('notification-cover-n-3')).toBeOnTheScreen();
    // No voice store: the voice rows fall back to the icon.
    expect(screen.getByTestId('notification-icon-n-2')).toBeOnTheScreen();
  });

  it('a tap marks an unread row read and opens its target', async () => {
    await renderNotifications();

    fireEvent.press(screen.getByTestId('notification-row-n-1'));
    expect(mockStore.markAsRead).toHaveBeenCalledWith('n-1');
    expect(mockNavigation.navigate).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'nar-1' });

    fireEvent.press(screen.getByTestId('notification-row-n-2'));
    expect(mockStore.markAsRead).toHaveBeenCalledWith('n-2');
    expect(mockNavigation.navigate).toHaveBeenCalledWith('VoiceProfiles');

    // Already read: no second mark, still routed.
    fireEvent.press(screen.getByTestId('notification-row-n-3'));
    expect(mockStore.markAsRead).toHaveBeenCalledTimes(2);
    expect(mockNavigation.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-3' });

    // No destination: nothing more is opened.
    fireEvent.press(screen.getByTestId('notification-row-n-5'));
    expect(mockNavigation.navigate).toHaveBeenCalledTimes(3);
  });

  it('paginates at the end of the list and refreshes on pull', async () => {
    await renderNotifications();
    const list = screen.getByTestId('notifications-list');
    fireEvent(list, 'endReached');
    expect(mockStore.loadMore).toHaveBeenCalledTimes(1);

    await act(async () => {
      list.props.refreshControl.props.onRefresh();
    });
    expect(mockStore.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the spinner until the first load resolves', async () => {
    mockStore.notifications = [];
    mockStore.unreadCount = 0;
    mockStore.load = jest.fn(() => new Promise(() => undefined));
    renderWithProviders(<NotificationsScreen />);
    await act(async () => undefined);
    expect(screen.getByTestId('notifications-loading')).toBeOnTheScreen();
    expect(screen.queryByText('Bildirim yok')).toBeNull();
  });

  it('the skeleton rows are as tall as a usual row, so the first page does not jump', async () => {
    // A usual row (n-3): the type line, a one-line title and a one-line body
    // inside the face padding.
    const loaded = await renderNotifications();
    const row = within(screen.getByTestId('notification-row-n-3-face'));
    const face = flatStyle(screen.getByTestId('notification-row-n-3-face'));
    const typeLine = flatStyle(row.getByText('Masal'));
    const title = flatStyle(row.getByText('Masal hazırlanamadı'));
    const body = flatStyle(row.getByText('Uykulu Ay hazırlanamadı.'));
    const usual =
      2 * face.padding +
      typeLine.lineHeight +
      title.marginTop +
      title.lineHeight +
      body.marginTop +
      body.lineHeight;
    expect(usual).toBe(NOTIFICATION_ROW_HEIGHT);
    loaded.unmount();

    mockStore.notifications = [];
    mockStore.load = jest.fn(() => new Promise(() => undefined));
    renderWithProviders(<NotificationsScreen />);
    await act(async () => undefined);
    const loading = screen.getByTestId('notifications-loading');
    const rows = within(loading)
      .UNSAFE_getAllByType(View)
      .filter(node => flatStyle(node).height === NOTIFICATION_ROW_HEIGHT);
    expect(rows).toHaveLength(5);
  });

  it('shows the error state with the shared copy and retries', async () => {
    mockStore.notifications = [];
    mockStore.unreadCount = 0;
    mockStore.errorMessage = 'Bildirimler yüklenemedi';
    mockStore.errorKind = 'server';
    await renderNotifications();
    expect(screen.getByText('Bildirimler yüklenemedi')).toBeOnTheScreen();
    expect(screen.getByText('Sorun bizde. Biraz sonra tekrar dene.')).toBeOnTheScreen();
    expect(screen.getByTestId('icon-alert', { includeHiddenElements: true })).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    });
    expect(mockStore.load).toHaveBeenCalledTimes(2);
  });

  it('says the device is offline when the load failed for lack of a connection', async () => {
    mockStore.notifications = [];
    mockStore.unreadCount = 0;
    mockStore.errorMessage = 'Bildirimler yüklenemedi';
    mockStore.errorKind = 'offline';
    await renderNotifications();
    const state = within(screen.getByTestId('notifications-error'));
    expect(state.getByText('İnternete bağlı değilsin')).toBeOnTheScreen();
    expect(state.getByText('Masalları açmak için bağlantı gerekiyor.')).toBeOnTheScreen();
    expect(state.queryByText('Sorun bizde. Biraz sonra tekrar dene.')).toBeNull();
    expect(state.getByTestId('icon-wifiOff', { includeHiddenElements: true })).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(state.getByRole('button', { name: 'Tekrar dene' }));
    });
    expect(mockStore.load).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state, whose button goes back to the profile (notification switches)', async () => {
    mockStore.notifications = [];
    mockStore.unreadCount = 0;
    await renderNotifications();
    expect(screen.getByRole('header', { name: 'Bildirim yok' })).toBeOnTheScreen();
    expect(screen.getByText('Masalın ya da sesin hazır olunca burada görürsün.')).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Bildirim tercihleri' }));
    // Pops back to a Profile already in the stack instead of stacking a second one.
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Profile', undefined, { pop: true });
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', async scheme => {
    await renderNotifications(scheme);
    const T = themes[scheme];
    // Every row is a surface card on the neutral lip.
    // Row cards on the scale: radius 20, padding 12, a 3dp lip, 72dp tall.
    expect(flatStyle(screen.getByTestId('notification-row-n-5-face'))).toMatchObject({
      backgroundColor: T.surface,
      borderRadius: 20,
      padding: 12,
      minHeight: 72,
    });
    expect(flatStyle(screen.getByTestId('notification-row-n-5-lip')).top).toBe(3);
    expect(flatStyle(screen.getByTestId('notification-row-n-5-lip')).backgroundColor).toBe(T.lip);
    expect(flatStyle(screen.getByTestId('notification-unread-n-1')).backgroundColor).toBe(T.action);
    expect(flatStyle(screen.getByText('Bilgi')).color).toBe(T.text3);
    expect(flatStyle(screen.getByText('5 dk önce')).color).toBe(T.text3);
    expect(flatStyle(screen.getByText('Yeni masallar eklendi')).color).toBe(T.text);
    expect(flatStyle(screen.getByText('Bremen Mızıkacıları dinlemeye hazır.')).color).toBe(T.text2);
    expect(flatStyle(screen.getByTestId('notifications-mark-all-face')).backgroundColor).toBe(T.surface);
    expect(screen.getByRole('button', { name: 'Hepsi okundu' })).toBeOnTheScreen();
    expect(flatStyle(screen.getByTestId('notification-icon-n-5'))).toMatchObject({
      backgroundColor: T.surface2,
      borderRadius: 16,
    });
    expect(flatStyle(screen.getByTestId('notification-avatar-n-2')).backgroundColor).toBe(T.own);
  });

  it.each(PALETTE_KEYS)('in %s every face stands out from what it sits on', async scheme => {
    await renderNotifications(scheme);
    const T = themes[scheme];
    const bg = (testID: string) => flatStyle(screen.getByTestId(testID)).backgroundColor as string;
    const apart = (face: string, container: string) => {
      expect(face).not.toBe(container);
      expect(contrastRatio(face, container)).toBeGreaterThan(1.05);
    };
    apart(bg('notification-row-n-5-face'), T.bg);
    apart(bg('notification-icon-n-5'), bg('notification-row-n-5-face'));
    apart(bg('notification-unread-n-1'), bg('notification-row-n-1-face'));
    apart(bg('notifications-mark-all-face'), T.bg);
  });

  it.each(PALETTE_KEYS)('in %s the empty state button stands out from the canvas', async scheme => {
    mockStore.notifications = [];
    mockStore.unreadCount = 0;
    await renderNotifications(scheme);
    const face = flatStyle(screen.getByTestId('notifications-preferences-face')).backgroundColor as string;
    expect(face).not.toBe(themes[scheme].bg);
    expect(contrastRatio(face, themes[scheme].bg)).toBeGreaterThan(1.05);
  });

  it('draws a story cover as a flat rounded square inside the card', async () => {
    await renderNotifications();
    expect(screen.queryByTestId('notification-cover-n-1-lip')).toBeNull();
    expect(flatStyle(screen.getByTestId('notification-cover-n-1')).width).toBe(48);
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('the empty state is a state icon and a secondary button in the %s theme', async scheme => {
    mockStore.notifications = [];
    mockStore.unreadCount = 0;
    await renderNotifications(scheme);
    const T = themes[scheme];
    expect(flatStyle(screen.getByTestId('notifications-preferences-face')).backgroundColor).toBe(T.surface);
    expect(flatStyle(screen.getByTestId('notifications-preferences-lip')).backgroundColor).toBe(T.lip);
    expect(screen.getByTestId('icon-bell', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(flatStyle(screen.getByRole('header', { name: 'Bildirim yok' })).fontFamily).toBe(T.fontDisplay);
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    await renderNotifications();
    expect(screen.getByRole('header', { name: 'Notifications' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeOnTheScreen();
    expect(screen.getAllByText('Story')).toHaveLength(3);
    expect(screen.getAllByText('Voice')).toHaveLength(2);
    expect(screen.getByText('Info')).toBeOnTheScreen();
    expect(screen.getByText('5 min ago')).toBeOnTheScreen();
    expect(screen.getByText('2 hr ago')).toBeOnTheScreen();
    expect(screen.getByText('1 day ago')).toBeOnTheScreen();
  });

  it('the empty state is translated into English', async () => {
    await i18n.changeLanguage('en');
    mockStore.notifications = [];
    mockStore.unreadCount = 0;
    await renderNotifications();
    expect(screen.getByText('No notifications')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Notification preferences' })).toBeOnTheScreen();
  });
});
