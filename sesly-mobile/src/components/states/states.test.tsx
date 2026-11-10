/**
 * Full-screen states (design v4 playful): the centred block with the round
 * icon badge, the screen with the brand bar, and the offline state.
 */

import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { FullScreenState, StateBody } from './FullScreenState';
import { OfflineState } from './OfflineState';

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

describe('StateBody', () => {
  it('shows the title, the sentence and the action', () => {
    const onPress = jest.fn();
    renderWithProviders(
      <StateBody
        icon="bell"
        title="Bildirim yok"
        message="Masalın ya da sesin hazır olunca burada görürsün."
        action={{ label: 'Bildirim tercihleri', onPress, variant: 'secondary', testID: 'act' }}
      />,
    );
    expect(screen.getByRole('header', { name: 'Bildirim yok' })).toBeOnTheScreen();
    expect(screen.getByText('Masalın ya da sesin hazır olunca burada görürsün.')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Bildirim tercihleri' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    // A secondary action is a neutral card button on its lip.
    expect(flatStyle(screen.getByTestId('act-face')).backgroundColor).toBe(themes['gece-mavisi'].surface);
    expect(screen.getByTestId('icon-bell', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('sits on the spacing scale: 32 to the sides, lifted 16dp above the centre, 20 / 8 / 24 / 16 between its parts', () => {
    renderWithProviders(
      <StateBody
        icon="bell"
        title="Bildirim yok"
        message="Bir cümle."
        action={{ label: 'Tekrar dene', onPress: jest.fn(), testID: 'act' }}
        note="Küçük not"
        testID="body"
      />,
    );
    const body = flatStyle(screen.getByTestId('body'));
    expect(body).toMatchObject({ paddingHorizontal: 32, paddingTop: 0, paddingBottom: 32 });
    expect(flatStyle(screen.getByText('Bildirim yok')).marginTop).toBe(20);
    expect(flatStyle(screen.getByText('Bir cümle.')).marginTop).toBe(8);
    expect(flatStyle(screen.getByTestId('act')).marginTop).toBe(24);
    expect(flatStyle(screen.getByText('Küçük not')).marginTop).toBe(16);
  });

  it('works with a title alone', () => {
    renderWithProviders(<StateBody icon="alert" title="Yalnız başlık" />);
    expect(screen.getByText('Yalnız başlık')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('note')).toBeNull();
  });

  it('shows a small note under the block when given one', () => {
    renderWithProviders(
      <StateBody icon="info" title="Güncelleme gerekli" note="Mağazadan güncelleyebilirsin." noteTestID="note" />,
      { theme: 'kitaplik' },
    );
    const note = screen.getByTestId('note');
    expect(note).toHaveTextContent('Mağazadan güncelleyebilirsin.');
    expect(flatStyle(note)).toMatchObject({
      color: themes.kitaplik.text2,
      fontFamily: themes.kitaplik.fontBody,
      textAlign: 'center',
    });
  });
});

describe('FullScreenState', () => {
  it.each(['gece-mavisi', 'kitaplik', 'orijinal'] as const)('draws the brand bar and the block in the %s palette', scheme => {
    renderWithProviders(
      <FullScreenState
        testID="state"
        icon="info"
        title="Güncelleme gerekli"
        message="Yeni sürüm hazır."
        action={{ label: 'Güncelle', onPress: jest.fn(), testID: 'act' }}
      />,
      { theme: scheme },
    );
    const T = themes[scheme];
    expect(screen.getByText('sesly')).toBeOnTheScreen();
    expect(screen.getByTestId('appbar-mark', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(flatStyle(screen.getByTestId('state')).backgroundColor).toBe(T.bg);
    expect(flatStyle(screen.getByText('Güncelleme gerekli'))).toMatchObject({
      color: T.text,
      fontFamily: T.fontDisplay,
    });
    expect(flatStyle(screen.getByText('Yeni sürüm hazır.'))).toMatchObject({
      color: T.text2,
      fontFamily: T.fontBody,
    });
    expect(flatStyle(screen.getByTestId('act-face')).backgroundColor).toBe(T.action);
    expect(flatStyle(screen.getByTestId('act-lip')).backgroundColor).toBe(T.actionLip);
  });
});

describe('OfflineState', () => {
  it('uses the mockup copy and retries', () => {
    const onRetry = jest.fn();
    renderWithProviders(<OfflineState onRetry={onRetry} />);
    expect(screen.getByText('sesly')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'İnternete bağlı değilsin' })).toBeOnTheScreen();
    expect(screen.getByText('Masalları açmak için bağlantı gerekiyor.')).toBeOnTheScreen();
    expect(screen.getByTestId('icon-wifiOff', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByTestId('icon-restart', { includeHiddenElements: true })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    // The upsell card of the old screen is gone.
    expect(screen.queryByText(/Pro/)).toBeNull();
  });

  it('takes another title, message and icon (server down, maintenance)', () => {
    const onRetry = jest.fn();
    renderWithProviders(
      <OfflineState
        onRetry={onRetry}
        icon="alert"
        title="Sesly'ye şu an ulaşılamıyor"
        message="Sorun bizde. Biraz sonra tekrar dene."
        testID="server-state"
      />,
    );
    expect(screen.getByTestId('server-state')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: "Sesly'ye şu an ulaşılamıyor" })).toBeOnTheScreen();
    expect(screen.getByText('Sorun bizde. Biraz sonra tekrar dene.')).toBeOnTheScreen();
    expect(screen.getByTestId('icon-alert', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByTestId('icon-wifiOff', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByText('İnternete bağlı değilsin')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('blocks the button while the check runs', () => {
    const onRetry = jest.fn();
    renderWithProviders(<OfflineState onRetry={onRetry} retrying />);
    const button = screen.getByTestId('offline-retry');
    expect(button.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    fireEvent.press(button);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<OfflineState onRetry={jest.fn()} />);
    expect(screen.getByText('You are offline')).toBeOnTheScreen();
    expect(screen.getByText('You need a connection to open stories.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });
});
