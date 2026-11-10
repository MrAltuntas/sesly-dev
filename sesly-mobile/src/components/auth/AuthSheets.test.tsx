/**
 * The password reset sheet of the auth screens (docs/release-pass/
 * SPEC-startup.md 7.2 to 7.5, SPEC-design 3.16): the field takes focus once
 * the sheet is up, "send" on the keyboard sends, a failure shows once (under
 * the field or in the form-level line) and never as a snackbar, the button
 * spins with its label kept, and nothing says "Vazgeç". The legal sheet has
 * its own tests (LegalSheet.test.tsx).
 */

import React from 'react';
import { TextInput } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { insetFace } from '../../theme/surfaces';
import { resetSheetPresence } from '../design/sheetPresence';
import PasswordResetSheet from './PasswordResetSheet';

jest.setTimeout(60000);

interface MockAuthStore {
  errorMessage: string;
  errorField: 'email' | 'password' | null;
  resetPassword: jest.Mock;
}
let mockAuthStore: MockAuthStore;
jest.mock('../../hooks/useAuth', () => ({ useAuth: () => mockAuthStore }));

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

/** The store answers a failed reset with this message and field. */
function failWith(message: string, field: MockAuthStore['errorField']) {
  mockAuthStore.resetPassword.mockImplementation(async () => {
    mockAuthStore.errorMessage = message;
    mockAuthStore.errorField = field;
    return false;
  });
}

beforeEach(() => {
  mockAuthStore = {
    errorMessage: '',
    errorField: null,
    resetPassword: jest.fn().mockResolvedValue(true),
  };
});

afterEach(() => resetSheetPresence());

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

describe('PasswordResetSheet', () => {
  it('prefills the email, sends the reset mail with it trimmed and closes', async () => {
    const onClose = jest.fn();
    renderWithProviders(<PasswordResetSheet visible onClose={onClose} initialEmail=" ayse@example.com " />);

    expect(screen.getByRole('header', { name: 'Şifreni mi unuttun?' })).toBeOnTheScreen();
    expect(screen.getByTestId('reset-email').props.value).toBe(' ayse@example.com ');
    await press('reset-submit');
    expect(mockAuthStore.resetPassword).toHaveBeenCalledWith('ayse@example.com');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"send" on the keyboard sends', async () => {
    const onClose = jest.fn();
    renderWithProviders(<PasswordResetSheet visible onClose={onClose} initialEmail="ayse@example.com" />);
    const field = screen.getByTestId('reset-email');
    expect(field.props.returnKeyType).toBe('send');

    await act(async () => {
      fireEvent(field, 'submitEditing');
    });
    expect(mockAuthStore.resetPassword).toHaveBeenCalledWith('ayse@example.com');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('validates the address before calling the store', async () => {
    renderWithProviders(<PasswordResetSheet visible onClose={jest.fn()} />);
    await press('reset-submit');
    expect(screen.getByText('E-posta adresini gir')).toBeOnTheScreen();

    fireEvent.changeText(screen.getByTestId('reset-email'), 'ayse');
    expect(screen.queryByText('E-posta adresini gir')).toBeNull();
    await press('reset-submit');
    expect(screen.getByText('Geçerli bir e-posta adresi gir')).toBeOnTheScreen();
    expect(mockAuthStore.resetPassword).not.toHaveBeenCalled();
  });

  it('an unknown address stays open with the message under the field, no line, no snackbar', async () => {
    const onClose = jest.fn();
    failWith('Bu e-posta ile kayıtlı hesap yok', 'email');
    renderWithProviders(<PasswordResetSheet visible onClose={onClose} initialEmail="yok@example.com" />);
    await press('reset-submit');

    expect(screen.getAllByText('Bu e-posta ile kayıtlı hesap yok')).toHaveLength(1);
    expect(flatStyle(screen.getByText('E-posta')).color).toBe(themes['gece-mavisi'].error);
    expect(screen.queryByTestId('reset-form-error')).toBeNull();
    expect(screen.queryByTestId('sheet-snackbar')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a network failure goes into the form-level line above the button, not under the field', async () => {
    const onClose = jest.fn();
    failWith('İnternet bağlantısı kurulamadı', null);
    renderWithProviders(<PasswordResetSheet visible onClose={onClose} initialEmail="ayse@example.com" />);
    await press('reset-submit');

    const line = screen.getByTestId('reset-form-error');
    expect(line).toHaveTextContent('İnternet bağlantısı kurulamadı');
    expect(screen.getByTestId('reset-form-error-region').props.accessibilityLiveRegion).toBe('polite');
    expect(screen.getAllByText('İnternet bağlantısı kurulamadı')).toHaveLength(1);
    expect(flatStyle(screen.getByText('E-posta')).color).not.toBe(themes['gece-mavisi'].error);
    expect(screen.queryByTestId('sheet-snackbar')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // Editing the address clears the line; a second try that works closes.
    fireEvent.changeText(screen.getByTestId('reset-email'), 'ayse@example.co');
    expect(screen.queryByTestId('reset-form-error')).toBeNull();
    mockAuthStore.resetPassword.mockResolvedValue(true);
    await press('reset-submit');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('while sending, the button spins with its label kept and the field waits', async () => {
    let finish: (ok: boolean) => void = () => undefined;
    mockAuthStore.resetPassword.mockReturnValue(
      new Promise<boolean>(resolve => {
        finish = resolve;
      }),
    );
    const onClose = jest.fn();
    renderWithProviders(<PasswordResetSheet visible onClose={onClose} initialEmail="ayse@example.com" />);
    await press('reset-submit');

    expect(screen.getByTestId('reset-submit').props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.getByRole('button', { name: 'Sıfırlama bağlantısı gönder' })).toBeOnTheScreen();
    expect(screen.queryByText('Gönderiliyor...')).toBeNull();
    expect(screen.getByTestId('reset-email').props.editable).toBe(false);

    // "send" again does not start a second request.
    await act(async () => {
      fireEvent(screen.getByTestId('reset-email'), 'submitEditing');
    });
    expect(mockAuthStore.resetPassword).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish(true);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an answer for an earlier opening neither closes the reopened sheet nor ends its busy state', async () => {
    const first: { resolve: (ok: boolean) => void } = { resolve: () => undefined };
    mockAuthStore.resetPassword.mockReturnValueOnce(
      new Promise<boolean>(resolve => {
        first.resolve = resolve;
      }),
    );
    const onClose = jest.fn();
    const { rerender } = renderWithProviders(
      <PasswordResetSheet visible onClose={onClose} initialEmail="ayse@example.com" />,
    );
    await press('reset-submit');
    expect(mockAuthStore.resetPassword).toHaveBeenCalledTimes(1);

    // Closed on the scrim while the request runs, then opened again.
    rerender(<PasswordResetSheet visible={false} onClose={onClose} initialEmail="ayse@example.com" />);
    rerender(<PasswordResetSheet visible onClose={onClose} initialEmail="ayse@example.com" />);
    expect(screen.getByTestId('reset-submit').props.accessibilityState).toMatchObject({ busy: false });

    // A send in the new opening is busy until its own answer.
    const second: { resolve: (ok: boolean) => void } = { resolve: () => undefined };
    mockAuthStore.resetPassword.mockReturnValueOnce(
      new Promise<boolean>(resolve => {
        second.resolve = resolve;
      }),
    );
    await press('reset-submit');
    expect(mockAuthStore.resetPassword).toHaveBeenCalledTimes(2);

    // The old success arrives: dropped.
    await act(async () => {
      first.resolve(true);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('reset-submit').props.accessibilityState).toMatchObject({ busy: true });

    await act(async () => {
      second.resolve(true);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the field once the sheet has risen, not before', () => {
    const held: ((finished?: boolean) => void)[] = [];
    jest.spyOn(Reanimated, 'withTiming').mockImplementation(((
      toValue: number,
      _config?: unknown,
      callback?: (finished?: boolean) => void,
    ) => {
      if (callback) held.push(callback);
      return toValue;
    }) as unknown as typeof Reanimated.withTiming);
    const focus = jest.spyOn(TextInput.prototype, 'focus');

    renderWithProviders(<PasswordResetSheet visible onClose={jest.fn()} />);
    expect(screen.getByTestId('reset-email').props.autoFocus).toBeUndefined();
    fireEvent(screen.getByTestId('password-reset-sheet'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 320 } },
    });
    expect(focus).not.toHaveBeenCalled();

    act(() => held.forEach(callback => callback(true)));
    const focused = (focus.mock.contexts as { props: { testID?: string } }[]).map(c => c.props.testID);
    expect(focused).toEqual(['reset-email']);
  });

  it('has one md block button and no "Vazgeç" (the scrim, handle and back close it)', () => {
    renderWithProviders(<PasswordResetSheet visible onClose={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Vazgeç' })).toBeNull();
    expect(screen.queryByText('Vazgeç')).toBeNull();
    expect(flatStyle(screen.getByTestId('reset-submit-face')).minHeight).toBe(44);
    expect(flatStyle(screen.getByTestId('reset-submit')).alignSelf).toBe('stretch');
  });

  it('starts clean each time it opens', async () => {
    failWith('İnternet bağlantısı kurulamadı', null);
    const { rerender } = renderWithProviders(
      <PasswordResetSheet visible onClose={jest.fn()} initialEmail="ayse@example.com" />,
    );
    await press('reset-submit');
    expect(screen.getByTestId('reset-form-error')).toBeOnTheScreen();

    rerender(<PasswordResetSheet visible={false} onClose={jest.fn()} initialEmail="ayse@example.com" />);
    rerender(<PasswordResetSheet visible onClose={jest.fn()} initialEmail="baska@example.com" />);
    expect(screen.queryByTestId('reset-form-error')).toBeNull();
    expect(screen.getByTestId('reset-email').props.value).toBe('baska@example.com');
  });

  it.each(['gece-mavisi', 'orman'] as const)('draws with the %s palette', key => {
    renderWithProviders(<PasswordResetSheet visible onClose={jest.fn()} />, { theme: key });
    const T = themes[key];
    expect(flatStyle(screen.getByTestId('reset-submit-face')).backgroundColor).toBe(T.action);
    expect(flatStyle(screen.getByRole('header', { name: 'Şifreni mi unuttun?' })).fontFamily).toBe(
      T.fontDisplay,
    );
    expect(flatStyle(screen.getByText(/sıfırlama bağlantısı gönderelim/)).color).toBe(T.text2);
    // The field is one ladder step below the sheet, so it never melts into it.
    const fieldFace = flatStyle(screen.getByTestId('reset-email-field-face')).backgroundColor;
    expect(fieldFace).toBe(insetFace(T, 'surface'));
    expect(fieldFace).not.toBe(T.surface);
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<PasswordResetSheet visible onClose={jest.fn()} />);
    expect(screen.getByRole('header', { name: 'Forgot your password?' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeOnTheScreen();
  });
});
