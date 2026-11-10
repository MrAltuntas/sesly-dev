/**
 * ForceUpdateScreen: the blocking gate BootStore sends the app to when the
 * installed version is too old (the routing itself is covered in
 * src/boot/BootStore.test.ts). The store link, the message, the way forward
 * without a link, the palettes and the swallowed back button.
 */

import React from 'react';
import { BackHandler, Linking, Platform } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { setMockRouteParams } from '../../test-utils/mocks/navigation';
import { FALLBACK_ANDROID_STORE_URL } from '../../models/AppConfig';

/** The Turkish sentence the screen shows when the backend sends none. */
const DEFAULT_TR_MESSAGE = "Sesly'nin yeni bir sürümü var. Devam etmek için uygulamayı güncelle.";
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import ForceUpdateScreen from './ForceUpdateScreen';

jest.setTimeout(60000);

const mockToastError = jest.fn();
jest.mock('../../utils/toast', () => ({
  showToast: { error: (...a: unknown[]) => mockToastError(...a), success: jest.fn(), info: jest.fn() },
}));

const UPDATE = {
  message: 'Yeni sürüm hazır, güncelle.',
  storeUrl: 'https://play.google.com/store/apps/details?id=com.sesly',
};

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

beforeEach(() => {
  mockToastError.mockReset();
});

describe('ForceUpdateScreen', () => {
  it('shows the message and opens the store link', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    setMockRouteParams(UPDATE);
    renderWithProviders(<ForceUpdateScreen />, { theme: 'kitaplik' });

    expect(screen.getByText('sesly')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Güncelleme gerekli' })).toBeOnTheScreen();
    expect(screen.getByText(UPDATE.message)).toBeOnTheScreen();
    expect(screen.queryByTestId('force-update-store-hint')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByText('Uygulamayı güncelle'));
    });

    expect(openURL).toHaveBeenCalledWith(UPDATE.storeUrl);
  });

  it('explains when the store cannot be opened', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    setMockRouteParams(UPDATE);
    renderWithProviders(<ForceUpdateScreen />, { theme: 'kitaplik' });

    await act(async () => {
      fireEvent.press(screen.getByText('Uygulamayı güncelle'));
    });

    expect(mockToastError).toHaveBeenCalledWith(
      'Mağaza açılamadı. Lütfen uygulamayı mağazadan güncelle.',
    );
  });

  it('on iOS without a store link shows the App Store line instead of a dead end', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    setMockRouteParams({ storeUrl: null });
    renderWithProviders(<ForceUpdateScreen />, { theme: 'kitaplik' });

    expect(screen.getByText(DEFAULT_TR_MESSAGE)).toBeOnTheScreen();
    expect(screen.queryByText('Uygulamayı güncelle')).toBeNull();
    expect(screen.getByTestId('force-update-store-hint')).toHaveTextContent(
      "Sesly'yi App Store'dan güncelleyebilirsin.",
    );
    const T = themes.kitaplik;
    expect(flatStyle(screen.getByTestId('force-update-store-hint')).color).toBe(T.text2);
  });

  it('on Android without a store link opens the Play listing', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    setMockRouteParams({ storeUrl: null });
    renderWithProviders(<ForceUpdateScreen />, { theme: 'kitaplik' });

    expect(screen.queryByTestId('force-update-store-hint')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByText('Uygulamayı güncelle'));
    });
    expect(openURL).toHaveBeenCalledWith(FALLBACK_ANDROID_STORE_URL);
  });

  it.each(['gece-mavisi', 'kitaplik', 'murekkep'] as const)('takes its colours from the %s palette', scheme => {
    setMockRouteParams(UPDATE);
    renderWithProviders(<ForceUpdateScreen />, { theme: scheme });
    const T = themes[scheme];
    expect(flatStyle(screen.getByTestId('force-update-screen')).backgroundColor).toBe(T.bg);
    expect(flatStyle(screen.getByText('Güncelleme gerekli'))).toMatchObject({
      color: T.text,
      fontFamily: T.fontDisplay,
    });
    expect(flatStyle(screen.getByText(UPDATE.message)).color).toBe(T.text2);
    expect(flatStyle(screen.getByTestId('force-update-action-face')).backgroundColor).toBe(T.action);
    expect(flatStyle(screen.getByTestId('force-update-action-lip')).backgroundColor).toBe(T.actionLip);
    expect(screen.getByTestId('icon-download', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('is translated into English; the backend sentence is shown as sent', async () => {
    await i18n.changeLanguage('en');
    setMockRouteParams(UPDATE);
    const { unmount } = renderWithProviders(<ForceUpdateScreen />);
    expect(screen.getByRole('header', { name: 'Update required' })).toBeOnTheScreen();
    expect(screen.getByText(UPDATE.message)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Update the app' })).toBeOnTheScreen();
    unmount();

    // No backend sentence: ours in the UI language; the App Store line is
    // English too.
    jest.replaceProperty(Platform, 'OS', 'ios');
    setMockRouteParams({ message: null, storeUrl: null });
    renderWithProviders(<ForceUpdateScreen />);
    expect(screen.getByText('A new version of Sesly is available. Update the app to continue.')).toBeOnTheScreen();
    expect(screen.queryByText(DEFAULT_TR_MESSAGE)).toBeNull();
    expect(screen.getByText('You can update Sesly from the App Store.')).toBeOnTheScreen();
  });

  it('swallows the Android back button while mounted', () => {
    const remove = jest.fn();
    const add = jest
      .spyOn(BackHandler, 'addEventListener')
      .mockReturnValue({ remove } as ReturnType<typeof BackHandler.addEventListener>);
    setMockRouteParams(UPDATE);
    const { unmount } = renderWithProviders(<ForceUpdateScreen />, { theme: 'kitaplik' });

    expect(add).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));
    const handler = add.mock.calls[0][1] as () => boolean;
    expect(handler()).toBe(true);

    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
