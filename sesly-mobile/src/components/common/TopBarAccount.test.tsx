/**
 * TopBarAccount: the bell (with its unread dot) and the avatar of the tab
 * screens' top bars. Both open their screen through navigateSingleton.
 */

import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { runInAction } from 'mobx';

const mockGetUnreadCount = jest.fn();
jest.mock('../../services/NotificationService', () => ({
  __esModule: true,
  default: { getUnreadCount: () => mockGetUnreadCount() },
}));

const mockAuth: {
  backendUser: { firstName?: string; lastName?: string; email?: string } | null;
  user: { displayName?: string; email?: string } | null;
} = { backendUser: { firstName: 'ışıl' }, user: null };
jest.mock('../../hooks/useAuth', () => ({ useAuth: () => mockAuth }));

import { renderScreen } from '../../test-utils/render-helpers';
import { mockNavigation } from '../../test-utils/mocks/navigation';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { SurfaceLevelProvider } from '../design/SurfaceLevel';
import { useNotifications } from '../../hooks/useNotifications';
import {
  TopBarAccount,
  UNREAD_REFRESH_MIN_MS,
  resetUnreadRefreshForTests,
} from './TopBarAccount';

const flat = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean)) as Record<string, unknown>;

let store: ReturnType<typeof useNotifications>;

function Capture() {
  store = useNotifications();
  return null;
}

async function renderBar(theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi') {
  return renderScreen(
    <>
      <Capture />
      <TopBarAccount testIDPrefix="home" />
    </>,
    { theme },
  );
}

beforeEach(() => {
  mockNavigation.navigate.mockClear();
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  resetUnreadRefreshForTests();
  mockGetUnreadCount.mockReset().mockResolvedValue(0);
  mockAuth.backendUser = { firstName: 'ışıl' };
  mockAuth.user = null;
});

afterEach(() => {
  runInAction(() => {
    store.unreadCount = 0;
  });
});

describe('TopBarAccount', () => {
  it('shows the bell next to the avatar; each opens its screen without stacking a second copy', async () => {
    await renderBar();

    fireEvent.press(screen.getByRole('button', { name: 'Bildirimler' }));
    expect(mockNavigation.navigate).toHaveBeenLastCalledWith('Notifications', undefined, { pop: true });

    // Turkish casing of the initial: ı becomes I.
    expect(screen.getByText('I')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Profil' }));
    expect(mockNavigation.navigate).toHaveBeenLastCalledWith('Profile', undefined, { pop: true });
    expect(mockNavigation.navigate).toHaveBeenCalledTimes(2);
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('the bell is a raised face on its lip and the avatar sits on its own lip (%s)', async scheme => {
    mockGetUnreadCount.mockResolvedValue(1);
    await renderBar(scheme);
    const T = themes[scheme];
    // On the canvas: one ladder step up, the surface.
    expect(flat(screen.getByTestId('home-bell-face')).backgroundColor).toBe(T.surface);
    expect(flat(screen.getByTestId('home-bell-lip')).backgroundColor).toBe(T.lip);
    expect(flat(screen.getByTestId('home-bell-lip')).top).toBe(2);
    expect(flat(screen.getByTestId('home-avatar-lip')).backgroundColor).toBe(T.ownLip);
    expect(flat(screen.getByTestId('home-avatar-face')).backgroundColor).toBe(T.own);
    // The 40dp avatar is a control like the bell: the same 2dp lip (F20).
    expect(flat(screen.getByTestId('home-avatar-lip')).top).toBe(2);
  });

  it('inside a surface container the bell and its dot ring take the next step up', async () => {
    mockGetUnreadCount.mockResolvedValue(2);
    await renderScreen(
      <SurfaceLevelProvider level="surface">
        <Capture />
        <TopBarAccount testIDPrefix="home" />
      </SurfaceLevelProvider>,
    );
    const T = themes['gece-mavisi'];
    expect(flat(screen.getByTestId('home-bell-face')).backgroundColor).toBe(T.surface2);
    expect(flat(screen.getByTestId('home-bell-dot')).borderColor).toBe(T.surface2);
  });

  it('has no dot while nothing is unread', async () => {
    await renderBar();
    expect(screen.queryByTestId('home-bell-dot')).toBeNull();
  });

  it('shows the dot, in the accent colour, and says how many are unread', async () => {
    mockGetUnreadCount.mockResolvedValue(3);
    await renderBar('gece-mavisi');

    const dot = screen.getByTestId('home-bell-dot');
    expect(flat(dot).backgroundColor).toBe(themes['gece-mavisi'].action);
    // The ring cuts the dot out of the bell on its card colour.
    expect(flat(dot).borderColor).toBe(themes['gece-mavisi'].surface);
    expect(screen.getByRole('button', { name: 'Bildirimler, 3 okunmamış' })).toBeOnTheScreen();
  });

  it('follows the store: the dot goes when everything is read', async () => {
    mockGetUnreadCount.mockResolvedValue(2);
    await renderBar();
    expect(screen.getByTestId('home-bell-dot')).toBeOnTheScreen();

    act(() => {
      runInAction(() => {
        store.unreadCount = 0;
      });
    });
    expect(screen.queryByTestId('home-bell-dot')).toBeNull();
  });

  it('refreshes on mount and on focus, but not more often than the minimum interval', async () => {
    jest.setSystemTime(new Date(2026, 9, 13, 21, 0, 0));
    await renderBar();
    expect(mockGetUnreadCount).toHaveBeenCalledTimes(1);

    const calls = mockNavigation.addListener.mock.calls as unknown as Array<[string, () => void]>;
    const focusCall = calls.find(call => call[0] === 'focus');
    expect(focusCall).toBeDefined();
    const onFocus = focusCall![1];

    await act(async () => onFocus());
    expect(mockGetUnreadCount).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date(2026, 9, 13, 21, 0, 0).getTime() + UNREAD_REFRESH_MIN_MS + 1);
    mockGetUnreadCount.mockResolvedValue(1);
    await act(async () => onFocus());
    expect(mockGetUnreadCount).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('home-bell-dot')).toBeOnTheScreen();
  });

  it('a failed refresh leaves the bar as it was', async () => {
    mockGetUnreadCount.mockRejectedValue(new Error('offline'));
    await renderBar();
    expect(screen.getByTestId('home-bell')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-bell-dot')).toBeNull();
  });

  it('falls back to the display name, then the neutral name, never the e-mail', async () => {
    mockAuth.backendUser = null;
    mockAuth.user = { displayName: 'Zeynep Kaya' };
    const first = await renderBar();
    expect(screen.getByText('Z')).toBeOnTheScreen();
    first.unmount();

    // A private relay address is a random id: "Sesly dostu" instead.
    mockAuth.user = { email: 'x7k2abc9d@privaterelay.appleid.com' };
    const second = await renderBar();
    expect(screen.getByText('S')).toBeOnTheScreen();
    expect(screen.queryByText('X')).toBeNull();
    second.unmount();

    // A backend user without names falls through the same way.
    mockAuth.backendUser = { email: 'mert@example.com' };
    mockAuth.user = { displayName: 'Ali Veli' };
    await renderBar();
    expect(screen.getByText('A')).toBeOnTheScreen();
  });

  it('is translated', async () => {
    mockGetUnreadCount.mockResolvedValue(4);
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    await renderBar();
    expect(screen.getByRole('button', { name: 'Notifications, 4 unread' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Profile' })).toBeOnTheScreen();
  });
});
