/**
 * DataDeletionScreen: the account deletion flow behind "Hesabı sil".
 * Warnings, a ticked confirmation, a second confirmation in a dialog, then
 * DELETE /users/me (docs/release-pass/SPEC-startup.md 3.7): done, a toast
 * and a sign out; 401 or 404 (already gone), a sign out; any other failure
 * keeps the user signed in and offers the delete again.
 */

import React from 'react';
import { Linking, Platform } from 'react-native';
import { act, fireEvent, screen, userEvent, within } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { mockNavigation } from '../../test-utils/mocks/navigation';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { contrastRatio, withAlpha } from '../../theme/color';
import { PALETTE_KEYS, type PaletteKey } from '../../theme/palettes';
import { disabledFace } from '../../theme/surfaces';
import type { DialogOptions } from '../../hooks/useDialog';
import { ApiError } from '../../services/ApiError';
import DataDeletionScreen, { isAlreadyDeleted } from './DataDeletionScreen';

jest.setTimeout(60000);

const mockDeleteAccount = jest.fn();
jest.mock('../../services/UserService', () => ({
  __esModule: true,
  default: { deleteAccount: () => mockDeleteAccount() },
}));

const mockSignOut = jest.fn();
let mockProvider = 'GOOGLE';
jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ signOut: mockSignOut, backendUser: { provider: mockProvider } }),
}));

const mockRevokeApple = jest.fn();
jest.mock('../../services/AuthService', () => ({
  __esModule: true,
  default: { revokeAppleSignIn: () => mockRevokeApple() },
}));

const mockRecordNonFatal = jest.fn();
jest.mock('../../services/crashReporting', () => ({
  recordNonFatal: (...args: unknown[]) => mockRecordNonFatal(...args),
}));

const mockShowDialog = jest.fn();
jest.mock('../../hooks/useDialog', () => ({
  useDialog: () => ({ showDialog: mockShowDialog, hideDialog: jest.fn() }),
}));

let mockIsPaid = false;
jest.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => ({ isPaid: mockIsPaid }),
}));

const mockToastError = jest.fn();
const mockToastSuccess = jest.fn();
jest.mock('../../utils/toast', () => ({
  showToast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

const apiError = (status: number) => new ApiError({ status, message: 'HTTP ' + status });

/**
 * The paid-plan note: deleting the account cannot cancel a store
 * subscription, so it says the subscription keeps renewing and where to
 * cancel it first. It is not one of the removed items.
 */
const SUBSCRIPTION_TR =
  "Hesabını silmek aboneliğini iptal etmez. Abonelik, Google Play'den ya da App Store'dan iptal edene kadar yenilenmeye devam eder. Hesabını silmeden önce oradan iptal et.";
const SUBSCRIPTION_EN =
  'Deleting your account does not cancel your subscription. It keeps renewing until you cancel it in Google Play or the App Store. Cancel it there before you delete your account.';

/** The testIDs in tree order. */
function testIdsInOrder(): string[] {
  const ids: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const n = node as { props?: { testID?: string }; children?: unknown[] | null };
    if (n.props?.testID) ids.push(n.props.testID);
    (n.children ?? []).forEach(walk);
  };
  walk(screen.toJSON());
  return ids;
}

async function renderScreen(theme: PaletteKey = 'gece-mavisi') {
  const view = renderWithProviders(<DataDeletionScreen />, { theme });
  await act(async () => undefined);
  return view;
}

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

const dialog = (index = 0) => mockShowDialog.mock.calls[index]?.[0] as DialogOptions;
const button = (options: DialogOptions, text: string) => options.buttons?.find(b => b.text === text);

/** Ticks the confirmation, presses the button and confirms in the dialog. */
async function confirmDelete() {
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(screen.getByTestId('deletion-submit'));
  await act(async () => {
    await dialog().buttons?.[0].onPress?.();
  });
}

beforeEach(async () => {
  await i18n.changeLanguage('tr');
  mockDeleteAccount.mockReset().mockResolvedValue(undefined);
  mockSignOut.mockReset().mockResolvedValue(true);
  mockShowDialog.mockReset();
  mockToastError.mockReset();
  mockToastSuccess.mockReset();
  mockIsPaid = false;
  mockProvider = 'GOOGLE';
  mockRevokeApple.mockReset().mockResolvedValue(undefined);
  mockRecordNonFatal.mockReset();
  mockNavigation.goBack.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('isAlreadyDeleted', () => {
  it('is a 401 or a 404, nothing else', () => {
    expect(isAlreadyDeleted(apiError(401))).toBe(true);
    expect(isAlreadyDeleted(apiError(404))).toBe(true);
    expect(isAlreadyDeleted(apiError(500))).toBe(false);
    expect(isAlreadyDeleted(apiError(0))).toBe(false);
    expect(isAlreadyDeleted(new Error('404'))).toBe(false);
  });
});

describe('DataDeletionScreen', () => {
  it('explains what is removed', async () => {
    mockIsPaid = true;
    await renderScreen();
    expect(screen.getByRole('header', { name: 'Hesabı sil' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Bu işlem geri alınamaz' })).toBeOnTheScreen();
    expect(screen.getByText('Profil bilgilerin (ad, e-posta, tercihler)')).toBeOnTheScreen();
    expect(screen.getByText('Oluşturduğun bütün masallar ve seslendirmeler')).toBeOnTheScreen();
    expect(screen.getByText('Kendi sesin (ses sağlayıcımızdaki kopyası dahil)')).toBeOnTheScreen();
    expect(screen.getByText(SUBSCRIPTION_TR)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('appbar-back'));
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('a paid plan gets the subscription note after the removed items, not as one of them', async () => {
    mockIsPaid = true;
    await renderScreen();
    const note = screen.getByTestId('deletion-subscription-note');
    expect(within(note).getByText(SUBSCRIPTION_TR)).toBeOnTheScreen();
    // The subscription is not listed as removed: three removed items only.
    const ids = testIdsInOrder();
    expect(ids.filter(id => id.startsWith('deletion-item-'))).toEqual([
      'deletion-item-profile',
      'deletion-item-narrations',
      'deletion-item-voices',
    ]);
    // Below the list, inside the warning card.
    expect(ids.indexOf('deletion-subscription-note')).toBeGreaterThan(ids.indexOf('deletion-item-voices'));
    expect(ids.indexOf('deletion-subscription-note')).toBeLessThan(ids.indexOf('deletion-confirm-card'));
  });

  it('names the subscription only for a paid plan', async () => {
    await renderScreen();
    expect(screen.queryByText(SUBSCRIPTION_TR)).toBeNull();
    expect(screen.queryByTestId('deletion-subscription-note')).toBeNull();
    expect(screen.queryByTestId('deletion-item-subscription')).toBeNull();
    expect(screen.getByTestId('deletion-item-voices')).toBeOnTheScreen();
  });

  it('keeps the delete button disabled until the confirmation is ticked', async () => {
    await renderScreen();
    const submit = screen.getByRole('button', { name: 'Hesabımı sil' });
    expect(submit).toBeDisabled();

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.press(submit);
    expect(mockShowDialog).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('checkbox', { name: 'Bütün verilerimin silinmesini onaylıyorum.' }));
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Hesabımı sil' })).toBeEnabled();

    // The sentence toggles the box too.
    fireEvent.press(screen.getByText('Bütün verilerimin silinmesini onaylıyorum.'));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('asks once more, then deletes the account, says so and signs out', async () => {
    await renderScreen();
    fireEvent.press(screen.getByRole('checkbox'));
    fireEvent.press(screen.getByTestId('deletion-submit'));

    expect(dialog().title).toBe('Hesabı sil');
    expect(dialog().message).toBe('Hesabın ve bütün verilerin kalıcı olarak silinir. Geri alınamaz.');
    expect(dialog().buttons?.map(button => [button.text, button.style])).toEqual([
      ['Hesabı sil', 'destructive'],
      ['Vazgeç', 'cancel'],
    ]);
    expect(mockDeleteAccount).not.toHaveBeenCalled();

    await act(async () => {
      await dialog().buttons?.[0].onPress?.();
    });
    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith('Hesabın silindi');
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    // The confirmation comes first, then the session ends.
    expect(mockToastSuccess.mock.invocationCallOrder[0]).toBeLessThan(
      mockSignOut.mock.invocationCallOrder[0],
    );
    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockShowDialog).toHaveBeenCalledTimes(1);
  });

  describe('Sign in with Apple (iOS)', () => {
    const originalOS = Platform.OS;
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
      mockProvider = 'APPLE';
    });
    afterEach(() => {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS });
    });

    it('revokes the Apple tokens before the account is deleted', async () => {
      await renderScreen();
      await confirmDelete();
      expect(mockRevokeApple).toHaveBeenCalledTimes(1);
      expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
      expect(mockRevokeApple.mock.invocationCallOrder[0]).toBeLessThan(
        mockDeleteAccount.mock.invocationCallOrder[0],
      );
    });

    it('closing the Apple sheet deletes nothing and keeps the session', async () => {
      const { AuthCancelledError } = jest.requireActual('../../services/authErrors');
      mockRevokeApple.mockRejectedValue(new AuthCancelledError('cancelled'));
      await renderScreen();
      await confirmDelete();
      expect(mockDeleteAccount).not.toHaveBeenCalled();
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(screen.getByTestId('deletion-submit')).toBeEnabled();
    });

    it('a failing revoke is reported and the account is deleted anyway', async () => {
      mockRevokeApple.mockRejectedValue(new Error('network'));
      await renderScreen();
      await confirmDelete();
      expect(mockRecordNonFatal).toHaveBeenCalledWith(expect.any(Error), 'app', { step: 'apple-revoke' });
      expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });

    it('a Google account on iOS is not asked to confirm with Apple', async () => {
      mockProvider = 'GOOGLE';
      await renderScreen();
      await confirmDelete();
      expect(mockRevokeApple).not.toHaveBeenCalled();
      expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    });
  });

  it('shows the busy label while the request runs', async () => {
    let finish: () => void = () => undefined;
    mockDeleteAccount.mockReturnValue(
      new Promise<void>(resolve => {
        finish = resolve;
      }),
    );
    await renderScreen();
    fireEvent.press(screen.getByRole('checkbox'));
    fireEvent.press(screen.getByTestId('deletion-submit'));

    let pending: Promise<void> | void;
    await act(async () => {
      pending = dialog().buttons?.[0].onPress?.() as Promise<void> | void;
    });
    expect(screen.getByRole('button', { name: 'Siliniyor...' })).toBeDisabled();

    await act(async () => {
      finish();
      await pending;
    });
    expect(screen.getByRole('button', { name: 'Hesabımı sil' })).toBeEnabled();
  });

  it('keeps the user signed in after a failed deletion and offers it again', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockDeleteAccount.mockRejectedValue(apiError(500));
    await renderScreen();
    await confirmDelete();

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
    // The button can be pressed again.
    expect(screen.getByRole('button', { name: 'Hesabımı sil' })).toBeEnabled();

    const failed = dialog(1);
    expect(failed.title).toBe('Hesap silinemedi');
    expect(failed.message).toBe('Hesabın ve verilerin yerinde duruyor. Biraz sonra tekrar dene.');
    expect(failed.buttons?.map(b => [b.text, b.style])).toEqual([
      ['Tekrar dene', undefined],
      ['Vazgeç', 'cancel'],
    ]);

    // Tekrar dene runs the delete again; this time it goes through.
    mockDeleteAccount.mockResolvedValue(undefined);
    await act(async () => {
      await button(failed, 'Tekrar dene')?.onPress?.();
    });
    expect(mockDeleteAccount).toHaveBeenCalledTimes(2);
    expect(mockToastSuccess).toHaveBeenCalledWith('Hesabın silindi');
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('a network failure also keeps the session, and a second failure asks again', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockDeleteAccount.mockRejectedValue(apiError(0));
    await renderScreen();
    await confirmDelete();
    await act(async () => {
      await button(dialog(1), 'Tekrar dene')?.onPress?.();
    });
    expect(mockDeleteAccount).toHaveBeenCalledTimes(2);
    expect(dialog(2).title).toBe('Hesap silinemedi');
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it.each([401, 404])('signs out when the account is already gone (%i)', async status => {
    mockDeleteAccount.mockRejectedValue(apiError(status));
    await renderScreen();
    await confirmDelete();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    // No failure dialog, and no claim that this delete did it.
    expect(mockShowDialog).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('survives a failing sign out after the deletion', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSignOut.mockRejectedValue(new Error('network'));
    await renderScreen();
    fireEvent.press(screen.getByRole('checkbox'));
    fireEvent.press(screen.getByTestId('deletion-submit'));

    await act(async () => {
      await dialog().buttons?.[0].onPress?.();
    });
    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Hesabımı sil' })).toBeEnabled();
  });

  it('offers a request by e-mail as the other way', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderScreen();
    // No uppercase section labels in the playful design.
    expect(screen.getByRole('header', { name: 'Başka yol' })).toBeOnTheScreen();
    expect(screen.getByText('E-postayla talep')).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'info@sesly.io' }));
    expect(openURL).toHaveBeenCalledWith('mailto:info@sesly.io');
  });

  it('says so when no mail app can open', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('deletion-mail'));
    });
    expect(dialog().title).toBe('E-posta açılamadı');
    expect(dialog().message).toBe('Cihazında bir e-posta uygulaması bulunamadı.');
  });

  it.each(PALETTE_KEYS)('in %s every face stands out from what it sits on', async scheme => {
    mockIsPaid = true;
    await renderScreen(scheme);
    const T = themes[scheme];
    const bg = (testID: string) => flatStyle(screen.getByTestId(testID)).backgroundColor as string;
    const apart = (face: string, container: string) => {
      expect(face).not.toBe(container);
      expect(contrastRatio(face, container)).toBeGreaterThan(1.05);
    };
    for (const id of ['deletion-warning', 'deletion-confirm-card', 'deletion-alt']) apart(bg(`${id}-face`), T.bg);
    // The item tile on its card; the mail button (secondary) on its card.
    apart(bg('deletion-item-voices'), bg('deletion-warning-face'));
    apart(bg('deletion-mail-face'), bg('deletion-alt-face'));
    // The disabled confirm is still a face of its own on the canvas.
    apart(bg('deletion-submit-face'), T.bg);
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', async scheme => {
    mockIsPaid = true;
    await renderScreen(scheme);
    const T = themes[scheme];
    // Cards on their lips, no red hairline: the alert lives in its tile.
    for (const id of ['deletion-warning', 'deletion-confirm-card', 'deletion-alt']) {
      expect(flatStyle(screen.getByTestId(`${id}-face`))).toMatchObject({
        backgroundColor: T.surface,
        // The card's 2dp ring is always there, transparent unless selected.
        borderColor: 'transparent',
      });
      expect(flatStyle(screen.getByTestId(`${id}-lip`)).backgroundColor).toBe(T.lip);
    }
    expect(flatStyle(screen.getByTestId('deletion-warning-icon')).backgroundColor).toBe(withAlpha(T.error, 0.14));
    expect(flatStyle(screen.getByTestId('deletion-item-voices')).backgroundColor).toBe(T.surface2);
    expect(flatStyle(screen.getByText('Bu işlem geri alınamaz'))).toMatchObject({
      color: T.text,
      fontFamily: T.fontDisplay,
    });
    expect(flatStyle(screen.getByText(SUBSCRIPTION_TR)).color).toBe(T.text);
    // The note's tile is warning-tinted (a notice), not an error-coloured removed item.
    expect(flatStyle(screen.getByTestId('deletion-subscription-icon')).backgroundColor).toBe(
      withAlpha(T.warning, 0.14),
    );
    // The confirm is the lg danger button (52dp face).
    expect(flatStyle(screen.getByTestId('deletion-submit-face')).minHeight).toBe(52);
    // The danger primary button: the error colour with dark text, and until
    // the confirmation is ticked the disabled face with a text3 label.
    expect(screen.getByTestId('deletion-submit')).toBeDisabled();
    expect(flatStyle(screen.getByTestId('deletion-submit-face')).backgroundColor).toBe(disabledFace(T, 'bg'));
    expect(flatStyle(screen.getByText('Hesabımı sil')).color).toBe(T.text3);
    fireEvent.press(screen.getByRole('checkbox'));
    expect(screen.getByTestId('deletion-submit')).toBeEnabled();
    expect(flatStyle(screen.getByTestId('deletion-submit-face')).backgroundColor).toBe(T.error);
    expect(flatStyle(screen.getByText('Hesabımı sil')).color).toBe(T.onAction);
    // A secondary button in a card is one ladder step above it (SPEC-design 1.6.1).
    expect(flatStyle(screen.getByTestId('deletion-mail-face')).backgroundColor).toBe(T.surface2);
    expect(flatStyle(screen.getByText('info@sesly.io')).color).toBe(T.text);
  });

  it('is translated into English', async () => {
    mockIsPaid = true;
    await i18n.changeLanguage('en');
    await renderScreen();
    expect(screen.getByText(SUBSCRIPTION_EN)).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Delete account' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'This cannot be undone' })).toBeOnTheScreen();
    expect(screen.getByText('Every story and narration you created')).toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: 'I confirm that all my data will be deleted.' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Another way' })).toBeOnTheScreen();
  });
});
