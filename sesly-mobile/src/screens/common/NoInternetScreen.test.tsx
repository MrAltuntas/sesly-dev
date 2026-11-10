/**
 * NoInternetScreen: the boot route of a signed-in user whose session could
 * not be checked. Copy per reason, the retry through the AuthStore (restored
 * goes to Main, a refused session to Login, anything else stays and says so
 * in place), the automatic retry on reconnect and the exit when the user is
 * back in the store.
 */

const mockRetryRestore = jest.fn();
const mockReconnectListeners = new Set<() => void>();
const mockAuthHolder: { store: { backendUser: unknown; retryRestore: (...a: unknown[]) => unknown } | null } = {
  store: null,
};

jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockAuthHolder.store,
  getAuthStore: () => mockAuthHolder.store,
}));
jest.mock('../../stores/ConnectivityStore', () => ({
  connectivityStore: {
    offline: false,
    onReconnect: (listener: () => void) => {
      mockReconnectListeners.add(listener);
      return () => {
        mockReconnectListeners.delete(listener);
      };
    },
  },
}));

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { observable, runInAction } from 'mobx';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { mockNavigation, setMockFocused, setMockRouteParams } from '../../test-utils/mocks/navigation';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import NoInternetScreen from './NoInternetScreen';

jest.setTimeout(60000);

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

function reconnect(): void {
  [...mockReconnectListeners].forEach(listener => listener());
}

beforeEach(() => {
  (AccessibilityInfo.announceForAccessibility as jest.Mock).mockClear();
  mockRetryRestore.mockReset();
  mockReconnectListeners.clear();
  mockAuthHolder.store = observable(
    { backendUser: null as unknown, retryRestore: (...a: unknown[]) => mockRetryRestore(...a) },
    { retryRestore: false },
  );
});

async function pressRetry() {
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: i18n.t('common:retry') }));
  });
}

describe('NoInternetScreen', () => {
  it('shows the wordmark and the offline copy by default', () => {
    renderWithProviders(<NoInternetScreen />);
    expect(screen.getByText('sesly')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'İnternete bağlı değilsin' })).toBeOnTheScreen();
    expect(screen.getByText('Masalları açmak için bağlantı gerekiyor.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeOnTheScreen();
    expect(screen.getByTestId('icon-wifiOff', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText(/Pro/)).toBeNull();
  });

  it('shows the server copy for reason server', () => {
    setMockRouteParams({ reason: 'server' });
    renderWithProviders(<NoInternetScreen />);
    expect(screen.getByRole('header', { name: "Sesly'ye şu an ulaşılamıyor" })).toBeOnTheScreen();
    expect(screen.getByText('Sorun bizde. Biraz sonra tekrar dene.')).toBeOnTheScreen();
    expect(screen.queryByText('İnternete bağlı değilsin')).toBeNull();
  });

  it('shows the maintenance copy for reason maintenance', () => {
    setMockRouteParams({ reason: 'maintenance' });
    renderWithProviders(<NoInternetScreen />);
    expect(screen.getByRole('header', { name: 'Sesly bakımda' })).toBeOnTheScreen();
    expect(screen.getByText(i18n.t('messages:api.maintenance'))).toBeOnTheScreen();
  });

  it('retry: a restored session resets to Main', async () => {
    mockRetryRestore.mockResolvedValue('restored');
    renderWithProviders(<NoInternetScreen />);
    await pressRetry();
    expect(mockRetryRestore).toHaveBeenCalledTimes(1);
    expect(mockNavigation.reset).toHaveBeenCalledTimes(1);
    expect(mockNavigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Main' }] });
    expect(mockNavigation.goBack).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'none'])('retry: a %s session resets to Login', async outcome => {
    mockRetryRestore.mockResolvedValue(outcome);
    renderWithProviders(<NoInternetScreen />);
    await pressRetry();
    expect(mockNavigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Login' }] });
  });

  it('retry still offline: stays and says so in place, no dialog', async () => {
    mockRetryRestore.mockResolvedValue('offline');
    renderWithProviders(<NoInternetScreen />);
    await pressRetry();

    expect(mockNavigation.reset).not.toHaveBeenCalled();
    expect(screen.getByText('İnternet bağlantını kontrol et ve tekrar dene.')).toBeOnTheScreen();
    expect(screen.queryByText('Masalları açmak için bağlantı gerekiyor.')).toBeNull();
    // The button is usable again.
    expect(screen.getByTestId('offline-retry').props.accessibilityState).toMatchObject({ disabled: false });
    // A screen reader hears the new sentence.
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'İnternet bağlantını kontrol et ve tekrar dene.',
    );
  });

  it('retry that finds the server down switches to the server copy', async () => {
    mockRetryRestore.mockResolvedValue('server');
    renderWithProviders(<NoInternetScreen />);
    await pressRetry();
    expect(screen.getByRole('header', { name: "Sesly'ye şu an ulaşılamıyor" })).toBeOnTheScreen();
    expect(mockNavigation.reset).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Sorun bizde. Biraz sonra tekrar dene.');
  });

  it('announces nothing when the retry leaves the screen', async () => {
    mockRetryRestore.mockResolvedValue('restored');
    renderWithProviders(<NoInternetScreen />);
    await pressRetry();
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  });

  it('a retry that throws keeps the screen', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRetryRestore.mockRejectedValue(new Error('boom'));
    renderWithProviders(<NoInternetScreen />);
    await pressRetry();
    expect(mockNavigation.reset).not.toHaveBeenCalled();
    expect(screen.getByRole('header', { name: "Sesly'ye şu an ulaşılamıyor" })).toBeOnTheScreen();
  });

  it('shows the button as busy while the retry runs and ignores a second tap', async () => {
    const answer = deferred<string>();
    mockRetryRestore.mockReturnValue(answer.promise);
    renderWithProviders(<NoInternetScreen />);
    await pressRetry();
    expect(screen.getByTestId('offline-retry').props.accessibilityState).toMatchObject({ busy: true });
    await act(async () => {
      reconnect();
    });
    expect(mockRetryRestore).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer.resolve('offline');
    });
    expect(screen.getByTestId('offline-retry').props.accessibilityState).toMatchObject({ busy: false });
  });

  it('retries by itself when the connection comes back', async () => {
    mockRetryRestore.mockResolvedValue('restored');
    renderWithProviders(<NoInternetScreen />);
    expect(mockRetryRestore).not.toHaveBeenCalled();

    await act(async () => {
      reconnect();
    });

    expect(mockRetryRestore).toHaveBeenCalledTimes(1);
    expect(mockNavigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Main' }] });
  });

  it('retries once per reconnect, not while blurred', async () => {
    mockRetryRestore.mockResolvedValue('offline');
    renderWithProviders(<NoInternetScreen />);

    await act(async () => {
      reconnect();
    });
    await act(async () => {
      reconnect();
    });
    expect(mockRetryRestore).toHaveBeenCalledTimes(2);

    act(() => setMockFocused(false));
    await act(async () => {
      reconnect();
    });
    expect(mockRetryRestore).toHaveBeenCalledTimes(2);
  });

  it('goes to Main when the user is back in the store while focused, once', async () => {
    const answer = deferred<string>();
    mockRetryRestore.mockReturnValue(answer.promise);
    renderWithProviders(<NoInternetScreen />);
    await pressRetry();

    act(() => {
      runInAction(() => {
        mockAuthHolder.store!.backendUser = { id: 'user-123' };
      });
    });
    expect(mockNavigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Main' }] });

    await act(async () => {
      answer.resolve('restored');
    });
    expect(mockNavigation.reset).toHaveBeenCalledTimes(1);
  });

  it('waits for focus before leaving for a user restored in the background', () => {
    setMockFocused(false);
    renderWithProviders(<NoInternetScreen />);
    act(() => {
      runInAction(() => {
        mockAuthHolder.store!.backendUser = { id: 'user-123' };
      });
    });
    expect(mockNavigation.reset).not.toHaveBeenCalled();

    act(() => setMockFocused(true));
    expect(mockNavigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Main' }] });
  });

  it.each(['gece-mavisi', 'kitaplik', 'erik'] as const)('takes its colours from the %s palette', scheme => {
    renderWithProviders(<NoInternetScreen />, { theme: scheme });
    const T = themes[scheme];
    expect(flatStyle(screen.getByTestId('no-internet-screen')).backgroundColor).toBe(T.bg);
    expect(flatStyle(screen.getByText('sesly')).color).toBe(T.text);
    expect(flatStyle(screen.getByText('İnternete bağlı değilsin')).fontFamily).toBe(T.fontDisplay);
    expect(flatStyle(screen.getByTestId('offline-retry-face')).backgroundColor).toBe(T.action);
    expect(flatStyle(screen.getByTestId('offline-retry-lip')).backgroundColor).toBe(T.actionLip);
  });

  it('is translated into English, every reason included', async () => {
    await i18n.changeLanguage('en');
    mockRetryRestore.mockResolvedValue('offline');
    const { unmount } = renderWithProviders(<NoInternetScreen />);
    expect(screen.getByText('You are offline')).toBeOnTheScreen();
    await pressRetry();
    expect(screen.getByText('Check your internet connection and try again.')).toBeOnTheScreen();
    unmount();

    setMockRouteParams({ reason: 'server' });
    const server = renderWithProviders(<NoInternetScreen />);
    expect(screen.getByText('Sesly cannot be reached right now')).toBeOnTheScreen();
    expect(screen.getByText('The problem is on our side. Try again in a little while.')).toBeOnTheScreen();
    server.unmount();

    setMockRouteParams({ reason: 'maintenance' });
    renderWithProviders(<NoInternetScreen />);
    expect(screen.getByText('Sesly is under maintenance')).toBeOnTheScreen();
    expect(screen.getByText('Sesly is under maintenance. Try again in a while.')).toBeOnTheScreen();
  });
});
