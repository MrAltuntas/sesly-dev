/**
 * LoginScreen and RegistrationScreen (design v4 playful, in the system of
 * frame f; docs/release-pass/SPEC-startup.md 7, SPEC-design 2.3 and 3.22):
 * palette colours and sizes, the return-key chain, errors shown once under
 * the right field or in the form-level line, busy on the pressed button
 * only, Google and Apple without a consent sheet, consent and legal links,
 * the stack reset after sign-in (with the onboarding intent), the first-run
 * title, and the EMAIL_IN_USE dialog.
 */

import React from 'react';
import { AccessibilityInfo, Platform, TextInput } from 'react-native';
import { StackActions, StackRouter } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { mockNavigation, setMockRouteParams } from '../../test-utils/mocks/navigation';
import { EMAIL_IN_USE_DIALOG } from '../../services/authErrors';
import { ONBOARDING_INTENT_STORAGE_KEY } from '../../boot/onboardingIntent';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { BUTTON_METRICS } from '../../components/design/buttonMetrics';
import type { PaletteKey } from '../../theme/palettes';
import { LoginScreen } from './LoginScreen';
import { RegistrationScreen } from './RegistrationScreen';
import { mainParamsForIntent } from './enterApp';

jest.setTimeout(60000);

// The sheets are replaced by small stand-ins that expose what the screen
// passes them: the open document, its context, and the consent "Anladım".
jest.mock('../../components/design/LegalSheet', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  const Stub = ({
    slug,
    context = 'profile',
    onAccept,
    onClose,
  }: {
    slug: string | null;
    context?: string;
    onAccept?: (slug: string) => void;
    onClose: () => void;
  }) =>
    slug
      ? React.createElement(
          View,
          null,
          React.createElement(Text, { testID: 'legal-open' }, slug),
          React.createElement(Text, { testID: 'legal-context' }, context),
          context === 'consent'
            ? React.createElement(
                Text,
                {
                  testID: 'legal-accept',
                  onPress: () => {
                    onAccept?.(slug);
                    onClose();
                  },
                },
                'accept',
              )
            : null,
        )
      : null;
  return { __esModule: true, default: Stub, LegalSheet: Stub };
});
jest.mock('../../components/auth/PasswordResetSheet', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const Stub = ({ visible, initialEmail }: { visible: boolean; initialEmail?: string }) =>
    visible ? React.createElement(Text, { testID: 'reset-open' }, initialEmail ?? '') : null;
  return { __esModule: true, default: Stub, PasswordResetSheet: Stub };
});

const mockPrefetch = jest.fn();
jest.mock('../../services/LegalService', () => ({
  __esModule: true,
  default: { prefetch: (...args: unknown[]) => mockPrefetch(...args) },
}));

const mockToastError = jest.fn();
jest.mock('../../utils/toast', () => ({
  showToast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: jest.fn(),
    info: jest.fn(),
  },
}));

const mockShowDialog = jest.fn();
jest.mock('../../hooks/useDialog', () => ({
  useDialog: () => ({ showDialog: mockShowDialog, hideDialog: jest.fn() }),
}));

interface MockAuthStore {
  errorMessage: string;
  errorField: 'email' | 'password' | null;
  isInitialized: boolean;
  restoreOutcome: string;
  authNotice: { title: string; message: string } | null;
  clearAuthNotice: jest.Mock;
  signInWithEmail: jest.Mock;
  registerWithEmail: jest.Mock;
  signInWithGoogle: jest.Mock;
  signInWithApple: jest.Mock;
}

let mockAuthStore: MockAuthStore;
jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockAuthStore,
}));

/** The store answers a failed attempt with this message and field. */
function failWith(mock: jest.Mock, message: string, field: MockAuthStore['errorField']) {
  mock.mockImplementation(async () => {
    mockAuthStore.errorMessage = message;
    mockAuthStore.errorField = field;
    return false;
  });
}

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  mockShowDialog.mockReset();
  mockPrefetch.mockReset();
  mockToastError.mockReset();
  await AsyncStorage.removeItem(ONBOARDING_INTENT_STORAGE_KEY);
  mockAuthStore = {
    errorMessage: '',
    errorField: null,
    isInitialized: true,
    restoreOutcome: 'none',
    authNotice: null,
    clearAuthNotice: jest.fn(),
    signInWithEmail: jest.fn().mockResolvedValue(false),
    registerWithEmail: jest.fn().mockResolvedValue(false),
    signInWithGoogle: jest.fn().mockResolvedValue(false),
    signInWithApple: jest.fn().mockResolvedValue(false),
  };
});

async function renderAuth(Screen: React.FC, theme: PaletteKey = 'gece-mavisi') {
  const utils = renderWithProviders(<Screen />, { theme });
  await act(async () => undefined);
  return utils;
}

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

const a11yState = (testID: string) => screen.getByTestId(testID).props.accessibilityState ?? {};

/** testIDs of the inputs `TextInput.prototype.focus` was called on. */
function focusedInputs(focus: jest.SpyInstance): string[] {
  return (focus.mock.contexts as { props: { testID?: string } }[]).map(c => c.props.testID ?? '');
}

const mainReset = (params: unknown) => ({ index: 0, routes: [{ name: 'Main', params }] });

describe.each([
  ['LoginScreen', LoginScreen, 'login'],
  ['RegistrationScreen', RegistrationScreen, 'register'],
] as const)('%s: shared behaviour', (_name, Screen, prefix) => {
  it('offers Google but not Apple on Android', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderAuth(Screen);

    expect(screen.getByRole('button', { name: 'Google ile devam et' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Apple ile devam et' })).toBeNull();
  });

  it('offers Apple on iOS', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    await renderAuth(Screen);

    expect(screen.getByRole('button', { name: 'Apple ile devam et' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Google ile devam et' })).toBeOnTheScreen();
  });

  it('Google calls the store at once (no consent sheet) and resets to Main on success', async () => {
    mockAuthStore.signInWithGoogle.mockResolvedValue(true);
    await renderAuth(Screen);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Google ile devam et' }));
    });
    expect(mockAuthStore.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('social-consent-sheet')).toBeNull();
    expect(mockNavigation.reset).toHaveBeenCalledWith(mainReset(undefined));
    expect(mockNavigation.replace).not.toHaveBeenCalled();
  });

  it('Apple calls the store at once and stays put on failure, the buttons free again', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    await renderAuth(Screen);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Apple ile devam et' }));
    });
    expect(mockAuthStore.signInWithApple).toHaveBeenCalledTimes(1);
    expect(mockNavigation.reset).not.toHaveBeenCalled();
    expect(a11yState(`${prefix}-apple`).busy).toBe(false);
    expect(a11yState(`${prefix}-google`).disabled).toBe(false);
    expect(a11yState(`${prefix}-submit`).disabled).toBe(false);
  });

  it('while Google is pending only Google is busy; the rest waits at full label', async () => {
    const google = deferred<boolean>();
    mockAuthStore.signInWithGoogle.mockReturnValue(google.promise);
    await renderAuth(Screen);
    const T = themes['gece-mavisi'];

    await act(async () => {
      fireEvent.press(screen.getByTestId(`${prefix}-google`));
    });
    expect(a11yState(`${prefix}-google`)).toMatchObject({ busy: true });
    expect(screen.getByTestId(`${prefix}-google-spinner`)).toBeOnTheScreen();
    // Full colour, not the disabled face.
    expect(flatStyle(screen.getByTestId(`${prefix}-google-face`)).backgroundColor).toBe(T.surface);

    const submitLabel = prefix === 'login' ? 'Giriş yap' : 'Hesap oluştur';
    const submit = screen.getByRole('button', { name: submitLabel });
    expect(submit).toBeDisabled();
    expect(a11yState(`${prefix}-submit`).busy).toBe(false);
    expect(within(screen.getByTestId(`${prefix}-submit`)).getByText(submitLabel)).toBeOnTheScreen();
    expect(screen.getByTestId(`${prefix}-email`).props.editable).toBe(false);
    expect(screen.getByTestId(`${prefix}-password`).props.editable).toBe(false);

    // A second tap while it runs does not start another attempt.
    fireEvent.press(screen.getByTestId(`${prefix}-google`));
    expect(mockAuthStore.signInWithGoogle).toHaveBeenCalledTimes(1);

    await act(async () => {
      google.resolve(false);
    });
    expect(a11yState(`${prefix}-google`).busy).toBe(false);
    expect(screen.getByRole('button', { name: submitLabel })).not.toBeDisabled();
    expect(screen.getByTestId(`${prefix}-email`).props.editable).toBe(true);
  });

  it('nothing is busy or disabled while the launch still checks the session', async () => {
    mockAuthStore.isInitialized = false;
    mockAuthStore.restoreOutcome = 'pending';
    await renderAuth(Screen);

    for (const id of [`${prefix}-submit`, `${prefix}-google`]) {
      expect(a11yState(id)).toMatchObject({ disabled: false, busy: false });
    }
    expect(screen.getByTestId(`${prefix}-email`).props.editable).toBe(true);
  });

  it('a successful sign-in with the record intent opens Sesim and removes the intent', async () => {
    await AsyncStorage.setItem(ONBOARDING_INTENT_STORAGE_KEY, 'record');
    mockAuthStore.signInWithGoogle.mockResolvedValue(true);
    await renderAuth(Screen);

    await act(async () => {
      fireEvent.press(screen.getByTestId(`${prefix}-google`));
    });
    expect(mockNavigation.reset).toHaveBeenCalledTimes(1);
    expect(mockNavigation.reset).toHaveBeenCalledWith(mainReset({ screen: 'Voices' }));
    await expect(AsyncStorage.getItem(ONBOARDING_INTENT_STORAGE_KEY)).resolves.toBeNull();
  });

  it('prefetches the terms and the privacy policy on mount, in the UI language', async () => {
    await renderAuth(Screen);
    expect(mockPrefetch).toHaveBeenCalledTimes(2);
    expect(mockPrefetch).toHaveBeenCalledWith('tos', 'tr');
    expect(mockPrefetch).toHaveBeenCalledWith('privacy', 'tr');
  });

  it('in the English UI it prefetches the English documents', async () => {
    await i18n.changeLanguage('en');
    await renderAuth(Screen);
    expect(mockPrefetch).toHaveBeenCalledTimes(2);
    expect(mockPrefetch).toHaveBeenCalledWith('tos', 'en');
    expect(mockPrefetch).toHaveBeenCalledWith('privacy', 'en');
  });

  it('shows the EMAIL_IN_USE notice as a dialog once and clears it', async () => {
    mockAuthStore.authNotice = { ...EMAIL_IN_USE_DIALOG };
    await renderAuth(Screen);

    expect(mockShowDialog).toHaveBeenCalledTimes(1);
    expect(mockShowDialog).toHaveBeenCalledWith({
      title: EMAIL_IN_USE_DIALOG.title,
      message: EMAIL_IN_USE_DIALOG.message,
      buttons: [{ text: 'Tamam' }],
    });
    expect(mockAuthStore.clearAuthNotice).toHaveBeenCalledTimes(1);
  });

  it('shows no dialog without a notice', async () => {
    await renderAuth(Screen);
    expect(mockShowDialog).not.toHaveBeenCalled();
  });

  it('the legal line under the buttons opens the documents read-only', async () => {
    await renderAuth(Screen);
    const legal = within(screen.getByTestId(`${prefix}-legal`));
    fireEvent.press(legal.getByText('Kullanım Şartları'));
    expect(screen.getByTestId('legal-open')).toHaveTextContent('tos');
    expect(screen.getByTestId('legal-context')).toHaveTextContent('profile');
    fireEvent.press(legal.getByText('Gizlilik Politikası'));
    expect(screen.getByTestId('legal-open')).toHaveTextContent('privacy');
    expect(screen.queryByTestId('legal-accept')).toBeNull();
  });

  it('the submit is lg (52 on a 3dp lip) and Google md (44 on 2dp), both full width', async () => {
    // Android: one Google button (iOS Registration puts two half buttons in a row).
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderAuth(Screen);
    expect(flatStyle(screen.getByTestId(`${prefix}-submit-face`)).minHeight).toBe(52);
    expect(flatStyle(screen.getByTestId(`${prefix}-google-face`)).minHeight).toBe(44);
    expect(BUTTON_METRICS.lg).toMatchObject({ height: 52, lip: 3 });
    expect(BUTTON_METRICS.md).toMatchObject({ height: 44, lip: 2 });
    expect(flatStyle(screen.getByTestId(`${prefix}-submit`)).alignSelf).toBe('stretch');
    expect(flatStyle(screen.getByTestId(`${prefix}-google`)).alignSelf).toBe('stretch');
  });

  it('the "ya da" row is 40 high with 4 above and below', async () => {
    await renderAuth(Screen);
    expect(flatStyle(screen.getByTestId(`${prefix}-or`))).toMatchObject({ minHeight: 40, marginVertical: 4 });
  });

  it('the footer text button sits 4dp from its sentence (marginLeft -8)', async () => {
    await renderAuth(Screen);
    const alt = prefix === 'login' ? 'login-register' : 'register-login';
    expect(flatStyle(screen.getByTestId(alt)).marginLeft).toBe(-8);
  });

  it('form rhythm: title 12, first field 20, the next 16', async () => {
    await renderAuth(Screen);
    const title = screen.getByRole('header', {
      name: prefix === 'login' ? 'Tekrar hoş geldin' : 'Hesap oluştur',
    });
    expect(flatStyle(title).marginTop).toBe(12);
    // TextField puts testID on the input; the block style is on its root.
    const fieldRoot = (testID: string) => {
      let node = screen.getByTestId(`${testID}-field-face`).parent;
      while (node && flatStyle(node).marginTop === undefined) node = node.parent;
      return node ? flatStyle(node) : {};
    };
    const first = prefix === 'login' ? 'login-email' : 'register-name';
    expect(fieldRoot(first).marginTop).toBe(20);
    expect(fieldRoot(`${prefix}-password`).marginTop).toBe(16);
  });

  it.each(['gece-mavisi', 'kitaplik', 'murekkep'] as const)(
    'draws with the active %s palette',
    async key => {
      await renderAuth(Screen, key);
      const T = themes[key];
      // One primary button on its lip, always enabled; Google is a neutral
      // card button.
      expect(!!a11yState(`${prefix}-submit`).disabled).toBe(false);
      expect(flatStyle(screen.getByTestId(`${prefix}-submit-face`)).backgroundColor).toBe(T.action);
      expect(flatStyle(screen.getByTestId(`${prefix}-submit-lip`)).backgroundColor).toBe(T.actionLip);
      expect(flatStyle(screen.getByTestId(`${prefix}-google-face`)).backgroundColor).toBe(T.surface);
      expect(flatStyle(screen.getByTestId(`${prefix}-google-lip`)).backgroundColor).toBe(T.lip);
      expect(screen.getByTestId('mark-google')).toBeOnTheScreen();
      // Baloo 2 headline; links are underlined text, not the action colour.
      const header = screen.getByRole('header', { name: Screen === LoginScreen ? 'Tekrar hoş geldin' : 'Hesap oluştur' });
      expect(flatStyle(header)).toMatchObject({ fontFamily: T.fontDisplay, color: T.text });
      for (const link of screen.getAllByRole('link')) {
        expect(flatStyle(link).textDecorationLine).toBe('underline');
        expect(flatStyle(link).color).not.toBe(T.action);
      }
    },
  );
});

describe('LoginScreen', () => {
  it('shows the brand bar and the open form in the informal form', async () => {
    await renderAuth(LoginScreen);

    expect(screen.getByText('sesly')).toBeOnTheScreen();
    expect(screen.getByTestId('appbar-mark', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Tekrar hoş geldin' })).toBeOnTheScreen();
    expect(screen.getByText('E-posta')).toBeOnTheScreen();
    expect(screen.getByText('Şifre')).toBeOnTheScreen();
    expect(screen.getByText('ya da')).toBeOnTheScreen();
    expect(screen.getByText('Hesabın yok mu?')).toBeOnTheScreen();
    expect(screen.queryByText('Mail ile giriş yap')).toBeNull();
    expect(
      screen.getByText(
        "Devam ederek Kullanım Şartları'nı ve Gizlilik Politikası'nı kabul etmiş olursun.",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/olursunuz|sizi/)).toBeNull();
  });

  it('reached from onboarding it says "Hoş geldin"', async () => {
    setMockRouteParams({ firstRun: true });
    await renderAuth(LoginScreen);
    expect(screen.getByRole('header', { name: 'Hoş geldin' })).toBeOnTheScreen();
    expect(screen.queryByText('Tekrar hoş geldin')).toBeNull();
  });

  it('has exactly the two legal links', async () => {
    await renderAuth(LoginScreen);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('Kullanım Şartları');
    expect(links[1]).toHaveTextContent('Gizlilik Politikası');
  });

  it('"next" on the email focuses the password, "go" there signs in', async () => {
    const focus = jest.spyOn(TextInput.prototype, 'focus');
    mockAuthStore.signInWithEmail.mockResolvedValue(true);
    await renderAuth(LoginScreen);

    const emailInput = screen.getByTestId('login-email');
    expect(emailInput.props).toMatchObject({ returnKeyType: 'next', submitBehavior: 'submit' });
    expect(screen.getByTestId('login-password').props.returnKeyType).toBe('go');

    fireEvent.changeText(emailInput, 'ayse@example.com');
    fireEvent(emailInput, 'submitEditing');
    expect(focusedInputs(focus)).toEqual(['login-password']);
    expect(mockAuthStore.signInWithEmail).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('login-password'), 'gizli-sifre');
    await act(async () => {
      fireEvent(screen.getByTestId('login-password'), 'submitEditing');
    });
    expect(mockAuthStore.signInWithEmail).toHaveBeenCalledWith('ayse@example.com', 'gizli-sifre');
    expect(mockNavigation.reset).toHaveBeenCalledWith(mainReset(undefined));
  });

  it('validates both fields and clears an error when the field is edited', async () => {
    await renderAuth(LoginScreen);
    await act(async () => {
      fireEvent.press(screen.getByTestId('login-submit'));
    });

    expect(screen.getByText('E-posta adresini gir')).toBeOnTheScreen();
    expect(screen.getByText('Şifreni gir')).toBeOnTheScreen();
    expect(mockAuthStore.signInWithEmail).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('login-email'), 'zeynep');
    expect(screen.queryByText('E-posta adresini gir')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('login-submit'));
    });
    expect(screen.getByText('Geçerli bir e-posta adresi gir')).toBeOnTheScreen();
  });

  it('signs in with the trimmed email and resets the stack to Main', async () => {
    mockAuthStore.signInWithEmail.mockResolvedValue(true);
    await renderAuth(LoginScreen);
    fireEvent.changeText(screen.getByTestId('login-email'), ' ayse@example.com ');
    fireEvent.changeText(screen.getByTestId('login-password'), 'gizli-sifre');
    await act(async () => {
      fireEvent.press(screen.getByTestId('login-submit'));
    });

    expect(mockAuthStore.signInWithEmail).toHaveBeenCalledWith('ayse@example.com', 'gizli-sifre');
    expect(mockNavigation.reset).toHaveBeenCalledWith(mainReset(undefined));
    expect(mockNavigation.replace).not.toHaveBeenCalled();
  });

  it('while the email sign-in runs, the submit spins with its label kept and Google waits', async () => {
    const signIn = deferred<boolean>();
    mockAuthStore.signInWithEmail.mockReturnValue(signIn.promise);
    await renderAuth(LoginScreen);
    fireEvent.changeText(screen.getByTestId('login-email'), 'ayse@example.com');
    fireEvent.changeText(screen.getByTestId('login-password'), 'gizli-sifre');
    await act(async () => {
      fireEvent.press(screen.getByTestId('login-submit'));
    });

    expect(a11yState('login-submit')).toMatchObject({ busy: true });
    expect(screen.getByRole('button', { name: 'Giriş yap' })).toBeOnTheScreen();
    expect(screen.queryByText('Giriş yapılıyor...')).toBeNull();
    expect(flatStyle(screen.getByTestId('login-submit-face')).backgroundColor).toBe(
      themes['gece-mavisi'].action,
    );
    expect(a11yState('login-google')).toMatchObject({ disabled: true, busy: false });

    // "go" again while it runs does not send a second request.
    await act(async () => {
      fireEvent(screen.getByTestId('login-password'), 'submitEditing');
    });
    expect(mockAuthStore.signInWithEmail).toHaveBeenCalledTimes(1);

    await act(async () => {
      signIn.resolve(true);
    });
    expect(mockNavigation.reset).toHaveBeenCalledTimes(1);
  });

  it('a wrong password shows the message once, under the password field, and no toast', async () => {
    failWith(mockAuthStore.signInWithEmail, 'Şifre hatalı', 'password');
    await renderAuth(LoginScreen);
    const T = themes['gece-mavisi'];
    fireEvent.changeText(screen.getByTestId('login-email'), 'ayse@example.com');
    fireEvent.changeText(screen.getByTestId('login-password'), 'yanlis');
    await act(async () => {
      fireEvent.press(screen.getByTestId('login-submit'));
    });

    expect(screen.getAllByText('Şifre hatalı')).toHaveLength(1);
    // Under the password: its label and ring turn to the error colour.
    expect(flatStyle(screen.getByText('Şifre')).color).toBe(T.error);
    expect(flatStyle(screen.getByTestId('login-password-field-face')).borderColor).toBe(T.error);
    expect(flatStyle(screen.getByText('E-posta')).color).not.toBe(T.error);
    expect(screen.queryByTestId('login-form-error')).toBeNull();
    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockNavigation.reset).not.toHaveBeenCalled();

    // Editing the password clears it.
    fireEvent.changeText(screen.getByTestId('login-password'), 'yeni');
    expect(screen.queryByText('Şifre hatalı')).toBeNull();
  });

  it('an unknown address goes under the email field', async () => {
    failWith(mockAuthStore.signInWithEmail, 'Bu e-posta ile kayıtlı hesap yok', 'email');
    await renderAuth(LoginScreen);
    fireEvent.changeText(screen.getByTestId('login-email'), 'yok@example.com');
    fireEvent.changeText(screen.getByTestId('login-password'), 'gizli');
    await act(async () => {
      fireEvent.press(screen.getByTestId('login-submit'));
    });
    expect(flatStyle(screen.getByText('E-posta')).color).toBe(themes['gece-mavisi'].error);
    expect(screen.getAllByText('Bu e-posta ile kayıtlı hesap yok')).toHaveLength(1);
  });

  it('a network failure shows the form-level line above the button, cleared by an edit', async () => {
    failWith(mockAuthStore.signInWithEmail, 'İnternet bağlantısı kurulamadı', null);
    await renderAuth(LoginScreen);
    // The polite live region is there before anything goes wrong (Android
    // reads out a change inside a region, not a view arriving with one).
    const region = screen.getByTestId('login-form-error-region');
    expect(region.props).toMatchObject({ accessibilityLiveRegion: 'polite', collapsable: false });
    expect(screen.queryByTestId('login-form-error')).toBeNull();

    fireEvent.changeText(screen.getByTestId('login-email'), 'ayse@example.com');
    fireEvent.changeText(screen.getByTestId('login-password'), 'gizli');
    await act(async () => {
      fireEvent.press(screen.getByTestId('login-submit'));
    });

    const line = screen.getByTestId('login-form-error');
    expect(line).toHaveTextContent('İnternet bağlantısı kurulamadı');
    expect(within(screen.getByTestId('login-form-error-region')).getByTestId('login-form-error')).toBe(line);
    expect(flatStyle(line).color).toBe(themes['gece-mavisi'].error);
    expect(screen.getAllByText('İnternet bağlantısı kurulamadı')).toHaveLength(1);
    expect(flatStyle(screen.getByText('Şifre')).color).not.toBe(themes['gece-mavisi'].error);
    expect(mockToastError).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('login-email'), 'ayse@example.co');
    expect(screen.queryByTestId('login-form-error')).toBeNull();
    expect(screen.getByTestId('login-form-error-region')).toBeOnTheScreen();
  });

  it('iOS has no live regions: the line is announced once; Android leaves it to the region', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    failWith(mockAuthStore.signInWithEmail, 'İnternet bağlantısı kurulamadı', null);
    const submit = async () => {
      fireEvent.changeText(screen.getByTestId('login-email'), 'ayse@example.com');
      fireEvent.changeText(screen.getByTestId('login-password'), 'gizli');
      await act(async () => {
        fireEvent.press(screen.getByTestId('login-submit'));
      });
    };

    jest.replaceProperty(Platform, 'OS', 'android');
    const android = await renderAuth(LoginScreen);
    await submit();
    expect(screen.getByTestId('login-form-error')).toBeOnTheScreen();
    expect(announce).not.toHaveBeenCalled();
    android.unmount();

    jest.replaceProperty(Platform, 'OS', 'ios');
    await renderAuth(LoginScreen);
    await submit();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('İnternet bağlantısı kurulamadı');

    // An edit clears the line without a word.
    fireEvent.changeText(screen.getByTestId('login-email'), 'ayse@example.co');
    expect(screen.queryByTestId('login-form-error')).toBeNull();
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('a quiet outcome (the EMAIL_IN_USE dialog) shows no line', async () => {
    failWith(mockAuthStore.signInWithEmail, '', null);
    await renderAuth(LoginScreen);
    fireEvent.changeText(screen.getByTestId('login-email'), 'ayse@example.com');
    fireEvent.changeText(screen.getByTestId('login-password'), 'gizli');
    await act(async () => {
      fireEvent.press(screen.getByTestId('login-submit'));
    });
    expect(screen.queryByTestId('login-form-error')).toBeNull();
  });

  it('the password is masked and can be shown', async () => {
    await renderAuth(LoginScreen);
    expect(screen.getByTestId('login-password').props.secureTextEntry).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: 'Şifreyi göster' }));
    expect(screen.getByTestId('login-password').props.secureTextEntry).toBe(false);
  });

  it('"Şifremi unuttum" opens the reset sheet with the typed email', async () => {
    await renderAuth(LoginScreen);
    fireEvent.changeText(screen.getByTestId('login-email'), 'ayse@example.com');
    expect(screen.queryByTestId('reset-open')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Şifremi unuttum' }));
    expect(screen.getByTestId('reset-open')).toHaveTextContent('ayse@example.com');
  });

  it('"Kayıt ol" opens Registration', async () => {
    await renderAuth(LoginScreen);
    fireEvent.press(screen.getByRole('button', { name: 'Kayıt ol' }));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Registration');
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    await renderAuth(LoginScreen);
    expect(screen.getByRole('header', { name: 'Welcome back' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeOnTheScreen();
    expect(
      screen.getByText('By continuing you accept the Terms of Use and the Privacy Policy.'),
    ).toBeOnTheScreen();
  });

  it('the first-run title is translated too', async () => {
    await i18n.changeLanguage('en');
    setMockRouteParams({ firstRun: true });
    await renderAuth(LoginScreen);
    expect(screen.getByRole('header', { name: 'Welcome' })).toBeOnTheScreen();
  });
});

describe('RegistrationScreen', () => {
  const fill = (overrides: Partial<Record<string, string>> = {}) => {
    const values: Record<string, string> = {
      'register-name': ' Zeynep ',
      'register-email': ' zeynep@ornek.com ',
      'register-password': 'gizli-sifre',
      ...overrides,
    };
    for (const [testID, value] of Object.entries(values)) {
      fireEvent.changeText(screen.getByTestId(testID), value);
    }
  };
  const consentBox = () => screen.getByRole('checkbox', { name: 'Şartları kabul ediyorum' });

  it('asks for a name, an email and a password only', async () => {
    await renderAuth(RegistrationScreen);

    expect(screen.getByRole('header', { name: 'Hesap oluştur' })).toBeOnTheScreen();
    for (const label of ['Adın', 'E-posta', 'Şifre']) {
      expect(screen.getByText(label)).toBeOnTheScreen();
    }
    // No last name and no repeat field.
    for (const gone of ['Soyad', 'Ad', 'Şifre (tekrar)']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    expect(screen.queryByTestId('register-last-name')).toBeNull();
    expect(screen.queryByTestId('register-password-confirm')).toBeNull();
    expect(screen.UNSAFE_getAllByType(TextInput)).toHaveLength(3);

    expect(screen.getByText('En az 6 karakter')).toBeOnTheScreen();
    expect(
      screen.getByText("Kullanım Şartları'nı ve Gizlilik Politikası'nı okudum, kabul ediyorum."),
    ).toBeOnTheScreen();
    expect(screen.getByText('Zaten hesabın var mı?')).toBeOnTheScreen();
    expect(screen.queryByText('ŞİFRE')).toBeNull();
  });

  it('has four legal links: two in the consent, two in the line under Google', async () => {
    await renderAuth(RegistrationScreen);
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(within(screen.getByTestId('register-consent-text')).getAllByRole('link')).toHaveLength(2);
    expect(within(screen.getByTestId('register-legal')).getAllByRole('link')).toHaveLength(2);
    expect(
      screen.getByText("Devam ederek Kullanım Şartları'nı ve Gizlilik Politikası'nı kabul etmiş olursun."),
    ).toBeOnTheScreen();
  });

  it('on iOS Google and Apple are short md buttons side by side with full labels for screen readers', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    await renderAuth(RegistrationScreen);
    expect(screen.getByText('Google')).toBeOnTheScreen();
    expect(screen.getByText('Apple')).toBeOnTheScreen();
    expect(screen.queryByText('Google ile devam et')).toBeNull();
    for (const id of ['register-google', 'register-apple']) {
      expect(flatStyle(screen.getByTestId(`${id}-face`)).minHeight).toBe(44);
      // Sharing a row: grows sideways, never stretches vertically.
      expect(flatStyle(screen.getByTestId(id))).toMatchObject({ flex: 1, alignSelf: 'center' });
    }
  });

  it('the return keys run name, email, password and then create the account', async () => {
    const focus = jest.spyOn(TextInput.prototype, 'focus');
    mockAuthStore.registerWithEmail.mockResolvedValue(true);
    await renderAuth(RegistrationScreen);
    fill();
    fireEvent.press(consentBox());

    expect(screen.getByTestId('register-name').props.returnKeyType).toBe('next');
    expect(screen.getByTestId('register-email').props.returnKeyType).toBe('next');
    expect(screen.getByTestId('register-password').props.returnKeyType).toBe('go');

    fireEvent(screen.getByTestId('register-name'), 'submitEditing');
    fireEvent(screen.getByTestId('register-email'), 'submitEditing');
    expect(focusedInputs(focus)).toEqual(['register-email', 'register-password']);
    expect(mockAuthStore.registerWithEmail).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent(screen.getByTestId('register-password'), 'submitEditing');
    });
    expect(mockAuthStore.registerWithEmail).toHaveBeenCalledWith('zeynep@ornek.com', 'gizli-sifre', 'Zeynep');
    expect(mockNavigation.reset).toHaveBeenCalledWith(mainReset(undefined));
  });

  it('the button is always enabled and, without consent, asks for it under the checkbox', async () => {
    await renderAuth(RegistrationScreen);
    expect(screen.getByTestId('register-submit')).not.toBeDisabled();
    fill();
    await act(async () => {
      fireEvent.press(screen.getByTestId('register-submit'));
    });

    const consentError = screen.getByTestId('register-consent-error');
    expect(consentError).toHaveTextContent('Devam etmek için şartları kabul et.');
    expect(flatStyle(consentError).color).toBe(themes['gece-mavisi'].error);
    expect(screen.getByTestId('register-consent-error-region').props.accessibilityLiveRegion).toBe('polite');
    expect(mockAuthStore.registerWithEmail).not.toHaveBeenCalled();

    // Ticking the box clears it (the region stays); the next press goes through.
    fireEvent.press(consentBox());
    expect(screen.queryByTestId('register-consent-error')).toBeNull();
    expect(screen.getByTestId('register-consent-error-region')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('register-submit'));
    });
    expect(mockAuthStore.registerWithEmail).toHaveBeenCalledTimes(1);
  });

  it('an empty form reports every field and the consent at once', async () => {
    await renderAuth(RegistrationScreen);
    await act(async () => {
      fireEvent.press(screen.getByTestId('register-submit'));
    });
    expect(screen.getByText('Adını gir')).toBeOnTheScreen();
    expect(screen.getByText('E-posta adresini gir')).toBeOnTheScreen();
    expect(screen.getByText('Şifreni gir')).toBeOnTheScreen();
    expect(screen.getByTestId('register-consent-error')).toBeOnTheScreen();
    expect(mockAuthStore.registerWithEmail).not.toHaveBeenCalled();

    // Each field error goes when that field is edited.
    fireEvent.changeText(screen.getByTestId('register-name'), 'Z');
    expect(screen.queryByText('Adını gir')).toBeNull();
    expect(screen.getByText('E-posta adresini gir')).toBeOnTheScreen();
  });

  it('only the checkbox toggles the consent; pressing the sentence does not', async () => {
    await renderAuth(RegistrationScreen);
    fireEvent.press(
      screen.getByText("Kullanım Şartları'nı ve Gizlilik Politikası'nı okudum, kabul ediyorum."),
    );
    expect(consentBox()).not.toBeChecked();
    fireEvent.press(consentBox());
    expect(consentBox()).toBeChecked();
    fireEvent.press(consentBox());
    expect(consentBox()).not.toBeChecked();
  });

  it('the consent links open the documents without toggling; their "Anladım" ticks the box', async () => {
    await renderAuth(RegistrationScreen);
    const consent = within(screen.getByTestId('register-consent-text'));

    fireEvent.press(consent.getByText('Kullanım Şartları'));
    expect(screen.getByTestId('legal-open')).toHaveTextContent('tos');
    expect(screen.getByTestId('legal-context')).toHaveTextContent('consent');
    expect(consentBox()).not.toBeChecked();

    fireEvent.press(consent.getByText('Gizlilik Politikası'));
    expect(screen.getByTestId('legal-open')).toHaveTextContent('privacy');
    expect(consentBox()).not.toBeChecked();

    fireEvent.press(screen.getByTestId('legal-accept'));
    expect(screen.queryByTestId('legal-open')).toBeNull();
    expect(consentBox()).toBeChecked();
  });

  it('registers with trimmed values (the name as the first name) and resets to Main', async () => {
    mockAuthStore.registerWithEmail.mockResolvedValue(true);
    await renderAuth(RegistrationScreen);
    fill();
    fireEvent.press(consentBox());
    await act(async () => {
      fireEvent.press(screen.getByTestId('register-submit'));
    });

    expect(mockAuthStore.registerWithEmail).toHaveBeenCalledWith('zeynep@ornek.com', 'gizli-sifre', 'Zeynep');
    expect(mockNavigation.reset).toHaveBeenCalledWith(mainReset(undefined));
    expect(mockNavigation.replace).not.toHaveBeenCalled();
  });

  it('sign-up with the record intent opens Sesim and removes the intent', async () => {
    await AsyncStorage.setItem(ONBOARDING_INTENT_STORAGE_KEY, 'record');
    mockAuthStore.registerWithEmail.mockResolvedValue(true);
    await renderAuth(RegistrationScreen);
    fill();
    fireEvent.press(consentBox());
    await act(async () => {
      fireEvent.press(screen.getByTestId('register-submit'));
    });
    expect(mockNavigation.reset).toHaveBeenCalledWith(mainReset({ screen: 'Voices' }));
    await expect(AsyncStorage.getItem(ONBOARDING_INTENT_STORAGE_KEY)).resolves.toBeNull();
  });

  it('reports a short password and a wrong email without calling the store', async () => {
    await renderAuth(RegistrationScreen);
    fill({ 'register-email': 'zeynep', 'register-password': '123' });
    fireEvent.press(consentBox());
    await act(async () => {
      fireEvent.press(screen.getByTestId('register-submit'));
    });

    expect(screen.getByText('Geçerli bir e-posta adresi gir')).toBeOnTheScreen();
    expect(screen.getByText('Şifre en az 6 karakter olmalı')).toBeOnTheScreen();
    // The error replaces the hint under the field.
    expect(screen.queryByText('En az 6 karakter')).toBeNull();
    expect(mockAuthStore.registerWithEmail).not.toHaveBeenCalled();
  });

  it('a store error with a field goes under it, once, with no toast', async () => {
    failWith(mockAuthStore.registerWithEmail, 'Bu e-posta zaten kullanılıyor', 'email');
    await renderAuth(RegistrationScreen);
    fill();
    fireEvent.press(consentBox());
    await act(async () => {
      fireEvent.press(screen.getByTestId('register-submit'));
    });

    expect(screen.getAllByText('Bu e-posta zaten kullanılıyor')).toHaveLength(1);
    expect(flatStyle(screen.getByText('E-posta')).color).toBe(themes['gece-mavisi'].error);
    expect(screen.queryByTestId('register-form-error')).toBeNull();
    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockNavigation.reset).not.toHaveBeenCalled();
  });

  it('a weak password from Firebase goes under the password', async () => {
    failWith(mockAuthStore.registerWithEmail, 'Şifre çok zayıf', 'password');
    await renderAuth(RegistrationScreen);
    fill();
    fireEvent.press(consentBox());
    await act(async () => {
      fireEvent.press(screen.getByTestId('register-submit'));
    });
    expect(flatStyle(screen.getByText('Şifre')).color).toBe(themes['gece-mavisi'].error);
    expect(screen.getAllByText('Şifre çok zayıf')).toHaveLength(1);
  });

  it('a failure without a field shows the form-level line above the button', async () => {
    failWith(mockAuthStore.registerWithEmail, 'İnternet bağlantısı kurulamadı', null);
    await renderAuth(RegistrationScreen);
    fill();
    fireEvent.press(consentBox());
    await act(async () => {
      fireEvent.press(screen.getByTestId('register-submit'));
    });
    expect(screen.getByTestId('register-form-error')).toHaveTextContent('İnternet bağlantısı kurulamadı');
    expect(screen.getAllByText('İnternet bağlantısı kurulamadı')).toHaveLength(1);

    // A new attempt starts without the old line.
    mockAuthStore.registerWithEmail.mockResolvedValue(true);
    await act(async () => {
      fireEvent.press(screen.getByTestId('register-submit'));
    });
    expect(screen.queryByTestId('register-form-error')).toBeNull();
  });

  it('back goes back and "Giriş yap" pops to the Login below', async () => {
    await renderAuth(RegistrationScreen);
    fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
    expect(mockNavigation.goBack).toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Giriş yap' }));
    expect(mockNavigation.popTo).toHaveBeenCalledWith('Login', undefined, { merge: true });
    expect(mockNavigation.replace).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  it('"Giriş yap" leaves a first-run Login saying "Hoş geldin" (its params kept)', async () => {
    await renderAuth(RegistrationScreen);
    fireEvent.press(screen.getByRole('button', { name: 'Giriş yap' }));
    const [name, params, options] = mockNavigation.popTo.mock.calls[0] as [
      'Login',
      undefined,
      { merge?: boolean },
    ];

    // What that call does to [Login (from onboarding), Registration] in the
    // real stack router.
    const routeNames = ['Login', 'Registration', 'Main'];
    const config = { routeNames, routeParamList: {}, routeGetIdList: {} };
    const router = StackRouter({});
    const state = {
      stale: false as const,
      type: 'stack' as const,
      key: 'root',
      index: 1,
      routeNames,
      preloadedRoutes: [],
      routes: [
        { key: 'login-1', name: 'Login', params: { firstRun: true } },
        { key: 'registration-1', name: 'Registration' },
      ],
    };
    const next = router.getStateForAction(state, StackActions.popTo(name, params, options), config);
    expect(next?.routes).toEqual([{ key: 'login-1', name: 'Login', params: { firstRun: true } }]);

    // A plain popTo would have dropped it (Login back on "Tekrar hoş geldin").
    const plain = router.getStateForAction(state, StackActions.popTo('Login'), config);
    expect(plain?.routes[0].params).toBeUndefined();
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    await renderAuth(RegistrationScreen);
    expect(screen.getByRole('header', { name: 'Create account' })).toBeOnTheScreen();
    expect(screen.getByText('Your name')).toBeOnTheScreen();
    expect(screen.getByText('At least 6 characters')).toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: 'I accept the terms' })).toBeOnTheScreen();
    expect(
      screen.getByText('I have read and accept the Terms of Use and the Privacy Policy.'),
    ).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('register-submit'));
    });
    expect(screen.getByText('Accept the terms to continue.')).toBeOnTheScreen();
    expect(screen.getByText('Enter your name')).toBeOnTheScreen();
  });
});

describe('mainParamsForIntent', () => {
  it('opens Sesim for the record intent and the default tab otherwise', () => {
    expect(mainParamsForIntent('record')).toEqual({ screen: 'Voices' });
    expect(mainParamsForIntent(null)).toBeUndefined();
  });
});
