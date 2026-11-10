/**
 * OfflineBanner: follows NetInfo through the real ConnectivityStore. Nothing
 * online (no reserved space), one quiet row offline, gone again after the
 * connection returns.
 */

let mockNetInfoListener: ((state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void) | null =
  null;

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: typeof mockNetInfoListener) => {
      mockNetInfoListener = listener;
      return () => {
        mockNetInfoListener = null;
      };
    },
    fetch: jest.fn(),
  },
}));

import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { connectivityStore } from '../../stores/ConnectivityStore';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { OFFLINE_BANNER_HEIGHT, OfflineBanner } from './OfflineBanner';

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

function netInfo(isConnected: boolean | null, isInternetReachable: boolean | null): void {
  act(() => {
    mockNetInfoListener?.({ isConnected, isInternetReachable });
  });
}

beforeEach(() => {
  connectivityStore.stop();
  connectivityStore.start();
  netInfo(true, true);
});

afterEach(() => {
  connectivityStore.stop();
});

describe('OfflineBanner', () => {
  it('renders nothing online (no reserved space)', () => {
    render(<OfflineBanner />);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    expect(screen.toJSON()).toBeNull();
  });

  it('shows one row while offline and goes again after reconnect', () => {
    renderWithProviders(<OfflineBanner />);

    netInfo(false, false);
    expect(screen.getByTestId('offline-banner')).toBeOnTheScreen();
    expect(screen.getByText('Çevrimdışısın')).toBeOnTheScreen();
    expect(screen.getByTestId('icon-wifiOff', { includeHiddenElements: true })).toBeOnTheScreen();

    netInfo(true, true);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('counts a network without internet as offline and an unknown reachability as online', () => {
    renderWithProviders(<OfflineBanner />);

    netInfo(true, false);
    expect(screen.getByTestId('offline-banner')).toBeOnTheScreen();

    netInfo(true, null);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it.each(['gece-mavisi', 'kitaplik', 'orijinal'] as const)('is a 28dp text2-on-surface2 row in %s', scheme => {
    renderWithProviders(<OfflineBanner />, { theme: scheme });
    netInfo(false, false);
    const T = themes[scheme];

    const row = flatStyle(screen.getByTestId('offline-banner'));
    expect(row).toMatchObject({ minHeight: OFFLINE_BANNER_HEIGHT, backgroundColor: T.surface2 });
    expect(OFFLINE_BANNER_HEIGHT).toBe(28);
    expect(flatStyle(screen.getByText('Çevrimdışısın'))).toMatchObject({
      color: T.text2,
      fontFamily: T.fontBody,
      fontSize: 12,
    });
  });

  it('a second banner of the same palette reuses the same cached row style', () => {
    const first = renderWithProviders(<OfflineBanner />);
    netInfo(false, false);
    const a = screen.getByTestId('offline-banner').props.style;
    first.unmount();
    renderWithProviders(<OfflineBanner />);
    expect(screen.getByTestId('offline-banner').props.style).toBe(a);
  });

  it('announces itself politely', () => {
    renderWithProviders(<OfflineBanner />);
    netInfo(false, false);
    expect(screen.getByTestId('offline-banner').props.accessibilityLiveRegion).toBe('polite');
  });

  it('is translated into English', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    renderWithProviders(<OfflineBanner />);
    netInfo(false, false);
    expect(screen.getByText('You are offline')).toBeOnTheScreen();
  });
});
