/**
 * ProfileScreen (design/v4/playful): profile and settings as one screen.
 *
 * useFocusEffect behaves like the real one on a focused screen (runs on focus
 * and again only when the callback identity changes): the old screen once
 * looped a request because its focus effect depended on its own result, and
 * the global navigation mock (callback on every render) cannot catch that.
 */

import React from 'react';
import { AppState, Linking, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { observable, runInAction } from 'mobx';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { mockNavigation } from '../../test-utils/mocks/navigation';
import i18n from '../../i18n';
import { UI_LANGUAGE_STORAGE_KEY } from '../../i18n/language';
import { themes } from '../../theme/theme';
import { contrastRatio } from '../../theme/color';
import { PALETTE_KEYS, type PaletteKey } from '../../theme/palettes';
import { PALETTE_STORAGE_KEY } from '../../theme/ThemeProvider';
import type { DialogOptions } from '../../hooks/useDialog';
import type { UserPreferences } from '../../models/UserPreferences';
import type { PlanId } from '../../models/Plans';
import { UsageSummary, parseUsageSummary } from '../../models/Quota';
import { backendUsageFree } from '../../test-utils/contract-fixtures';
import { Icon } from '../../components/design/Icon';
import { BUTTON_METRICS } from '../../components/design/buttonMetrics';
import { SETTING_ROW_MIN_HEIGHT } from '../../components/profile/SettingRow';
import { USAGE_METER_HEIGHT } from '../../components/profile/PlanUsageCard';
import ProfileScreen from './ProfileScreen';

jest.setTimeout(60000);

// ── Navigation with real focus semantics ──────────────────────
let mockFocusCount = 0;
jest.mock('@react-navigation/native', () => {
  const ReactActual = jest.requireActual('react');
  const { mockNavigation: navigation } = jest.requireActual('../../test-utils/mocks/navigation');
  return {
    ...jest.requireActual('@react-navigation/native'),
    useNavigation: () => navigation,
    useRoute: () => ({ key: 'profile', name: 'Profile', params: {} }),
    useIsFocused: () => true,
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactActual.useEffect(() => {
        mockFocusCount += 1;
        return callback();
      }, [callback]);
    },
  };
});

// ── Stores ────────────────────────────────────────────────────
interface MockBackendUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}
interface MockAuthStore {
  backendUser: MockBackendUser | null;
  user: { displayName?: string; email?: string } | null;
  signOut: jest.Mock;
  updateBackendUser: jest.Mock;
  isSigningOut?: boolean;
}
let mockAuthStore: MockAuthStore;
jest.mock('../../hooks/useAuth', () => ({ useAuth: () => mockAuthStore }));

let mockSubscriptionStore: {
  planId: PlanId;
  usage: UsageSummary | null;
  usageError: boolean;
  loadUsageIfStale: jest.Mock;
  refresh: jest.Mock;
};
jest.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => mockSubscriptionStore,
}));

let mockNotificationsStore: { unreadCount: number; refreshUnreadCount: jest.Mock };
jest.mock('../../hooks/useNotifications', () => ({
  useNotifications: () => mockNotificationsStore,
}));

interface MockLanguage {
  code: string;
  nativeName: string;
  storyCount?: number;
}
let mockContentLanguageStore: {
  languages: MockLanguage[];
  effective: string;
  readonly selectable: string;
  readonly pickableLanguages: MockLanguage[];
  load: jest.Mock;
  setContentLanguage: jest.Mock;
  nativeName: (code: string) => string;
};
jest.mock('../../hooks/useContentLanguage', () => ({
  useContentLanguage: () => mockContentLanguageStore,
}));

// ── Services ──────────────────────────────────────────────────
const mockPrefsGet = jest.fn();
const mockPrefsUpdate = jest.fn();
const mockPrefsCached = jest.fn();
jest.mock('../../services/UserPreferencesService', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockPrefsGet(...args),
    update: (...args: unknown[]) => mockPrefsUpdate(...args),
    getCachedSync: () => mockPrefsCached(),
  },
}));

const mockPermissionStatus = jest.fn();
const mockRequestPermission = jest.fn();
jest.mock('../../services/PushNotificationService', () => ({
  __esModule: true,
  default: {
    getPermissionStatus: () => mockPermissionStatus(),
    requestPermissionFromSettings: () => mockRequestPermission(),
  },
}));

const mockCacheSize = jest.fn();
const mockClearCache = jest.fn();
jest.mock('../../services/CacheService', () => ({
  __esModule: true,
  default: {
    getCacheSize: () => mockCacheSize(),
    clearAllCache: () => mockClearCache(),
  },
}));

const mockUpdateProfile = jest.fn();
jest.mock('../../services/UserService', () => ({
  __esModule: true,
  default: { updateProfile: (...args: unknown[]) => mockUpdateProfile(...args) },
}));

const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
const mockToastInfo = jest.fn();
jest.mock('../../utils/toast', () => ({
  showToast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
    warning: jest.fn(),
  },
}));

const mockShowDialog = jest.fn();
jest.mock('../../hooks/useDialog', () => ({
  useDialog: () => ({ showDialog: mockShowDialog, hideDialog: jest.fn() }),
}));

jest.mock('../../components/design/LegalSheet', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    LegalSheet: ({ slug }: { slug: string | null }) =>
      slug ? <Text testID="legal-sheet-slug">{slug}</Text> : null,
  };
});

// ── Helpers ───────────────────────────────────────────────────
const PREFS: UserPreferences = {
  userId: 'u-1',
  sleepTimerFadeOut: true,
  sleepTimerPauseWhenAsleep: false,
  sleepTimerLastDuration: null,
  voiceReadyNotifications: true,
  narrationReadyNotifications: true,
  promoNotifications: false,
  contentLanguage: null,
  effectiveContentLanguage: 'tr',
  uiLanguage: null,
  settings: {},
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const LANGUAGES: Record<string, MockLanguage> = {
  tr: { code: 'tr', nativeName: 'Türkçe' },
  en: { code: 'en', nativeName: 'English' },
  de: { code: 'de', nativeName: 'Deutsch' },
  fr: { code: 'fr', nativeName: 'Français' },
};

const FREE_USAGE = parseUsageSummary(backendUsageFree);

const flush = async (rounds = 6) => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => undefined);
  }
};

async function renderProfile(theme: PaletteKey = 'gece-mavisi') {
  const view = renderWithProviders(<ProfileScreen />, { theme });
  await flush();
  return view;
}

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

const dialog = (index = 0) => mockShowDialog.mock.calls[index]?.[0] as DialogOptions;

function setAppVersion(version: string | undefined): () => void {
  // The global expo-constants mock has no __esModule flag, so the default
  // import resolves to the module object itself; patch both spots.
  const Constants = jest.requireMock('expo-constants') as {
    expoConfig?: Record<string, unknown>;
    default: { expoConfig: Record<string, unknown> };
  };
  const previousTop = Constants.expoConfig;
  const previousDefault = Constants.default.expoConfig;
  Constants.expoConfig = { version };
  Constants.default.expoConfig = { ...previousDefault, version };
  return () => {
    Constants.expoConfig = previousTop;
    Constants.default.expoConfig = previousDefault;
  };
}

beforeEach(async () => {
  mockFocusCount = 0;
  await AsyncStorage.clear();
  await i18n.changeLanguage('tr');
  mockNavigation.navigate.mockClear();
  mockNavigation.goBack.mockClear();

  mockAuthStore = {
    backendUser: { id: 'u-1', email: 'zeynep@ornek.com', firstName: 'Zeynep', lastName: 'Kaya' },
    user: null,
    signOut: jest.fn().mockResolvedValue(true),
    updateBackendUser: jest.fn((user: MockBackendUser) => {
      mockAuthStore.backendUser = user;
    }),
  };
  mockSubscriptionStore = {
    planId: 'free',
    usage: FREE_USAGE,
    usageError: false,
    loadUsageIfStale: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
  };
  mockUpdateProfile.mockReset();
  mockNotificationsStore = {
    unreadCount: 2,
    refreshUnreadCount: jest.fn().mockResolvedValue(undefined),
  };
  mockContentLanguageStore = {
    languages: [LANGUAGES.tr, LANGUAGES.en],
    effective: 'tr',
    // The real store falls back to the default when the effective language
    // is not enabled (covered in useContentLanguage.test.ts).
    get selectable(): string {
      return this.effective;
    },
    // The languages with stories (a language without a count has some here).
    get pickableLanguages(): MockLanguage[] {
      return this.languages.filter(language => (language.storyCount ?? 1) > 0);
    },
    load: jest.fn().mockResolvedValue(undefined),
    setContentLanguage: jest.fn().mockResolvedValue(undefined),
    nativeName: (code: string) => LANGUAGES[code]?.nativeName ?? code.toUpperCase(),
  };

  mockPrefsCached.mockReset().mockReturnValue(null);
  mockPrefsGet.mockReset().mockImplementation(async () => ({ ...PREFS }));
  mockPrefsUpdate.mockReset().mockImplementation(async (patch: Partial<UserPreferences>) => ({
    ...PREFS,
    ...patch,
  }));
  mockPermissionStatus.mockReset().mockResolvedValue('granted');
  mockRequestPermission.mockReset().mockResolvedValue('denied');
  mockCacheSize.mockReset().mockResolvedValue({ total: 13002342 });
  mockClearCache.mockReset().mockResolvedValue(undefined);
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
  mockToastInfo.mockReset();
  mockShowDialog.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ──────────────────────────────────────────────────────────────

describe('account and plan', () => {
  it('shows the back bar, the avatar initial, the full name and the e-mail', async () => {
    await renderProfile();
    expect(screen.getByRole('header', { name: 'Profil' })).toBeOnTheScreen();
    expect(screen.getByText('Z')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Zeynep Kaya' })).toBeOnTheScreen();
    expect(screen.getByText('zeynep@ornek.com')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('appbar-back'));
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('falls back to the Firebase name and then to a neutral name', async () => {
    mockAuthStore = { ...mockAuthStore, backendUser: null, user: { displayName: 'ipek Demir', email: 'i@d.com' } };
    const first = await renderProfile();
    expect(screen.getByText('İ')).toBeOnTheScreen();
    expect(screen.getByText('i@d.com')).toBeOnTheScreen();
    first.unmount();

    mockAuthStore = { ...mockAuthStore, backendUser: null, user: null };
    await renderProfile();
    expect(screen.getByRole('header', { name: 'Sesly dostu' })).toBeOnTheScreen();
    expect(screen.getByText('S')).toBeOnTheScreen();
  });

  it('never shows the e-mail local part as the name (Apple private relay)', async () => {
    mockAuthStore.backendUser = {
      id: 'u-2',
      email: 'x7k2abc9d@privaterelay.appleid.com',
      firstName: null,
      lastName: null,
    };
    const first = await renderProfile();
    expect(screen.getByRole('header', { name: 'Sesly dostu' })).toBeOnTheScreen();
    expect(screen.queryByText('x7k2abc9d')).toBeNull();
    expect(screen.queryByText('X')).toBeNull();
    first.unmount();

    // The sign-in name comes before the neutral one.
    mockAuthStore.user = { displayName: 'Deniz Ak' };
    await renderProfile();
    expect(screen.getByRole('header', { name: 'Deniz Ak' })).toBeOnTheScreen();
  });

  it('edits the name in a sheet: the saved name reaches the card and the greeting', async () => {
    mockUpdateProfile.mockImplementation(async ({ firstName }: { firstName: string }) => ({
      ...mockAuthStore.backendUser,
      firstName,
    }));
    await renderProfile();
    expect(screen.queryByTestId('profile-name-sheet')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Zeynep Kaya, zeynep@ornek.com, Adını değiştir' }));
    const sheet = within(screen.getByTestId('profile-name-sheet'));
    expect(sheet.getByTestId('profile-name-input').props.value).toBe('Zeynep');

    fireEvent.changeText(sheet.getByTestId('profile-name-input'), ' Elif ');
    await act(async () => {
      fireEvent.press(sheet.getByRole('button', { name: 'Kaydet' }));
    });
    await flush(2);
    expect(mockUpdateProfile).toHaveBeenCalledWith({ firstName: 'Elif' });
    // The auth store holds the user the greeting reads.
    expect(mockAuthStore.updateBackendUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u-1', firstName: 'Elif' }),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('Adın güncellendi');
    expect(screen.queryByTestId('profile-name-sheet')).toBeNull();
    expect(screen.getByRole('header', { name: 'Elif Kaya' })).toBeOnTheScreen();
    expect(screen.getByText('E')).toBeOnTheScreen();
  });

  it('keeps the name sheet open when the save fails', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockUpdateProfile.mockRejectedValue(new Error('offline'));
    await renderProfile();
    fireEvent.press(screen.getByTestId('profile-account'));
    fireEvent.changeText(screen.getByTestId('profile-name-input'), 'Elif');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Kaydet' }));
    });
    await flush(2);
    expect(mockToastError).toHaveBeenCalledWith('Adın kaydedilemedi');
    expect(screen.getByTestId('profile-name-sheet')).toBeOnTheScreen();
    expect(mockAuthStore.updateBackendUser).not.toHaveBeenCalled();
    expect(screen.getByRole('header', { name: 'Zeynep Kaya' })).toBeOnTheScreen();
  });

  it('the account card opens nothing without a backend user', async () => {
    mockAuthStore = { ...mockAuthStore, backendUser: null, user: { displayName: 'Deniz' } };
    await renderProfile();
    expect(screen.queryByTestId('profile-account-chevron')).toBeNull();
    fireEvent.press(screen.getByTestId('profile-account'));
    expect(screen.queryByTestId('profile-name-sheet')).toBeNull();
  });

  it('shows the plan name and opens the plans screen', async () => {
    await renderProfile();
    const card = within(screen.getByTestId('profile-plan'));
    expect(card.getByText('Ücretsiz plan')).toBeOnTheScreen();

    fireEvent.press(card.getByRole('button', { name: 'Planları gör' }));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Subscription', undefined, { pop: true });
  });

  it.each([
    ['mini', 'Mini planı'],
    ['premium', 'Premium planı'],
  ] as const)('names the %s plan from planId', async (planId, name) => {
    mockSubscriptionStore.planId = planId;
    mockSubscriptionStore.usage = null;
    mockSubscriptionStore.usageError = true;
    await renderProfile();
    expect(within(screen.getByTestId('profile-plan')).getByText(name)).toBeOnTheScreen();
  });

  it('the plan card shows the two bars from GET /usage', async () => {
    await renderProfile();
    const card = within(screen.getByTestId('profile-plan'));
    expect(card.getByText('0 / 20 masal')).toBeOnTheScreen();
    expect(card.getByText('0 / 1 masal')).toBeOnTheScreen();
    expect(card.getByText('Ücretsiz planda toplam 1 masal. Yenilenmez.')).toBeOnTheScreen();
    expect(card.getByTestId('usage-preset-bar')).toBeOnTheScreen();
    expect(card.getByTestId('usage-cloned-bar')).toBeOnTheScreen();
  });

  it('while GET /usage has not answered: skeleton rows of the meter height', async () => {
    mockSubscriptionStore.usage = null;
    await renderProfile();
    const card = within(screen.getByTestId('profile-plan'));
    expect(card.getByTestId('usage-loading')).toBeOnTheScreen();
    expect(flatStyle(card.getByTestId('usage-skeleton-0')).height).toBe(USAGE_METER_HEIGHT);
    expect(flatStyle(card.getByTestId('usage-skeleton-1')).height).toBe(USAGE_METER_HEIGHT);
    expect(card.queryByText(/\d+ \/ \d+/)).toBeNull();
  });

  it('when GET /usage failed with nothing known: the plan limits instead of numbers', async () => {
    mockSubscriptionStore.usage = null;
    mockSubscriptionStore.usageError = true;
    await renderProfile();
    const card = within(screen.getByTestId('profile-plan'));
    expect(card.getByText('Hazır anlatıcılarla ayda 20 masal')).toBeOnTheScreen();
    expect(card.getByText('Kendi sesinle toplam 1 masal')).toBeOnTheScreen();
    expect(card.queryByTestId('usage-loading')).toBeNull();
    expect(card.queryByText(/\d+ \/ \d+/)).toBeNull();
  });

  it('asks for usage on focus when it is older than a minute (the store decides)', async () => {
    await renderProfile();
    expect(mockSubscriptionStore.loadUsageIfStale).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionStore.loadUsageIfStale).toHaveBeenCalledWith();
  });
});

describe('Masal dili', () => {
  it('is a segmented control with native names for two languages', async () => {
    await renderProfile();
    // Asked again every time the profile opens: the enabled languages are a
    // panel setting.
    expect(mockContentLanguageStore.load).toHaveBeenCalledTimes(1);
    expect(mockContentLanguageStore.load).toHaveBeenCalledWith(true);

    const row = within(screen.getByTestId('profile-content-language'));
    expect(row.getByText('Masal dili')).toBeOnTheScreen();
    expect(row.getByRole('radio', { name: 'Türkçe' })).toBeSelected();
    expect(row.getByRole('radio', { name: 'English' })).not.toBeSelected();

    fireEvent.press(row.getByRole('radio', { name: 'English' }));
    // The pill moves at once; the choice is handed over in the next frame.
    expect(row.getByRole('radio', { name: 'English' })).toBeSelected();
    expect(mockContentLanguageStore.setContentLanguage).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(16);
    });
    expect(mockContentLanguageStore.setContentLanguage).toHaveBeenCalledWith('en');
    await flush(2);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('stays a segmented control with three languages', async () => {
    mockContentLanguageStore.languages = [LANGUAGES.tr, LANGUAGES.en, LANGUAGES.de];
    await renderProfile();
    const row = within(screen.getByTestId('profile-content-language'));
    expect(row.getAllByRole('radio')).toHaveLength(3);
    expect(row.getByRole('radio', { name: 'Deutsch' })).toBeOnTheScreen();
  });

  it('becomes a row with the current value that opens a list with more than three', async () => {
    mockContentLanguageStore.languages = [LANGUAGES.tr, LANGUAGES.en, LANGUAGES.de, LANGUAGES.fr];
    mockContentLanguageStore.effective = 'en';
    await renderProfile();

    const row = screen.getByRole('button', { name: 'Masal dili, English' });
    expect(within(screen.getByTestId('profile-content-language')).queryByRole('radio')).toBeNull();
    expect(screen.queryByTestId('profile-language-sheet')).toBeNull();

    fireEvent.press(row);
    const sheet = within(screen.getByTestId('profile-language-sheet'));
    expect(sheet.getAllByRole('radio')).toHaveLength(4);
    expect(sheet.getByRole('radio', { name: 'English' })).toBeSelected();

    fireEvent.press(sheet.getByRole('radio', { name: 'Français' }));
    expect(mockContentLanguageStore.setContentLanguage).toHaveBeenCalledWith('fr');
    expect(screen.queryByTestId('profile-language-sheet')).toBeNull();
  });

  it('tells the user when the change could not be saved', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockContentLanguageStore.setContentLanguage.mockRejectedValue(new Error('400'));
    await renderProfile();

    fireEvent.press(
      within(screen.getByTestId('profile-content-language')).getByRole('radio', { name: 'English' }),
    );
    act(() => {
      jest.advanceTimersByTime(16);
    });
    await flush(2);
    expect(mockToastError).toHaveBeenCalledWith('Masal dili kaydedilemedi');
  });

  it('is hidden while there is nothing to choose between', async () => {
    mockContentLanguageStore.languages = [LANGUAGES.tr];
    await renderProfile();
    expect(screen.queryByTestId('profile-content-language')).toBeNull();
    expect(screen.queryByText('Masal dili')).toBeNull();
  });

  it('is hidden while only one language has stories', async () => {
    mockContentLanguageStore.languages = [LANGUAGES.tr, { ...LANGUAGES.en, storyCount: 0 }];
    await renderProfile();
    expect(screen.queryByTestId('profile-content-language')).toBeNull();
  });

  it('without a pick shows the language in use (the UI language), a pick overrides it', async () => {
    // An English UI that never chose: the store's effective language is English.
    mockContentLanguageStore.effective = 'en';
    await renderProfile();
    const row = within(screen.getByTestId('profile-content-language'));
    expect(row.getByRole('radio', { name: 'English' })).toBeSelected();
    fireEvent.press(row.getByRole('radio', { name: 'Türkçe' }));
    act(() => {
      jest.advanceTimersByTime(16);
    });
    expect(mockContentLanguageStore.setContentLanguage).toHaveBeenCalledWith('tr');
    await flush(2);
  });

  it('is hidden, not broken, while the languages could not be loaded', async () => {
    mockContentLanguageStore.languages = [];
    await renderProfile();
    expect(screen.queryByTestId('profile-content-language')).toBeNull();
    expect(screen.queryByText('Masal dili')).toBeNull();
  });

  it('appears after a pull to refresh once a second language is enabled', async () => {
    mockContentLanguageStore.languages = [LANGUAGES.tr];
    mockContentLanguageStore.load.mockImplementation(async (force?: boolean) => {
      // The second request (the refresh) sees the panel change.
      if (force && mockContentLanguageStore.load.mock.calls.length > 1) {
        mockContentLanguageStore.languages = [LANGUAGES.tr, LANGUAGES.en];
      }
    });
    const view = await renderProfile();
    expect(screen.queryByTestId('profile-content-language')).toBeNull();

    const scroll = view.UNSAFE_getByType(ScrollView);
    await act(async () => {
      await scroll.props.refreshControl.props.onRefresh();
    });
    expect(mockContentLanguageStore.load).toHaveBeenCalledTimes(2);
    expect(mockContentLanguageStore.load).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId('profile-content-language')).toBeOnTheScreen();
  });
});

describe('Renk paleti and Uygulama dili', () => {
  it('offers the six palettes, applies a pick at once and stores it on the device', async () => {
    await renderProfile('gece-mavisi');
    const block = within(screen.getByTestId('profile-palette'));
    expect(screen.getByTestId('palette-picker')).toHaveProp('accessibilityLabel', 'Renk paleti');
    for (const name of ['Kitaplık', 'Orman', 'Gece mavisi', 'Mürekkep', 'Erik', 'Orijinal']) {
      expect(block.getByRole('radio', { name })).toBeOnTheScreen();
    }
    expect(block.getByRole('radio', { name: 'Gece mavisi' })).toBeSelected();
    expect(flatStyle(screen.getByTestId('profile-screen')).backgroundColor).toBe(themes['gece-mavisi'].bg);

    await act(async () => {
      fireEvent.press(block.getByRole('radio', { name: 'Erik' }));
    });
    // The ring moves at once; the palette applies on the next frame.
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(block.getByRole('radio', { name: 'Erik' })).toBeSelected();
    expect(block.getByRole('radio', { name: 'Gece mavisi' })).not.toBeSelected();
    expect(flatStyle(screen.getByTestId('profile-screen')).backgroundColor).toBe(themes.erik.bg);
    await expect(AsyncStorage.getItem(PALETTE_STORAGE_KEY)).resolves.toBe('erik');
  });

  it('groups the settings into cards', async () => {
    mockPermissionStatus.mockResolvedValue('denied');
    await renderProfile();
    const language = within(screen.getByTestId('profile-group-language'));
    expect(language.getByTestId('profile-content-language')).toBeOnTheScreen();
    expect(language.getByTestId('profile-ui-language')).toBeOnTheScreen();
    const notifications = within(screen.getByTestId('profile-group-notifications'));
    expect(notifications.getByTestId('profile-notifications')).toBeOnTheScreen();
    expect(notifications.getByTestId('profile-push-permission')).toBeOnTheScreen();
    expect(notifications.getAllByRole('switch')).toHaveLength(2);
    const more = within(screen.getByTestId('profile-group-more'));
    expect(more.getByTestId('profile-legal')).toBeOnTheScreen();
    expect(more.getByTestId('profile-contact')).toBeOnTheScreen();
    expect(more.getByTestId('profile-clear-cache')).toBeOnTheScreen();
    // The account actions are buttons of their own, outside the cards.
    expect(more.queryByTestId('profile-sign-out')).toBeNull();
    expect(screen.getByTestId('profile-sign-out')).toBeOnTheScreen();
    expect(within(screen.getByTestId('profile-account')).getByText('zeynep@ornek.com')).toBeOnTheScreen();
  });

  it('there is no light theme and no theme mode setting any more', async () => {
    await renderProfile();
    expect(screen.queryByTestId('profile-theme')).toBeNull();
    expect(screen.queryByText('Tema')).toBeNull();
    expect(screen.queryByText('Açık')).toBeNull();
  });

  it('switches the app language between Türkçe and English and stores the pick', async () => {
    await renderProfile();
    const row = within(screen.getByTestId('profile-ui-language'));
    expect(row.getByText('Uygulama dili')).toBeOnTheScreen();
    expect(row.getByRole('radio', { name: 'Türkçe' })).toBeSelected();

    await act(async () => {
      fireEvent.press(row.getByRole('radio', { name: 'English' }));
    });
    // The pick shows at once; the language is applied in the next frame, so
    // the app-wide re-render never holds the pill back.
    expect(row.getByRole('radio', { name: 'English' })).toBeSelected();
    expect(i18n.language).toBe('tr');
    expect(screen.getByText('Uygulama dili')).toBeOnTheScreen();
    act(() => {
      jest.advanceTimersByTime(16);
    });
    await flush(2);
    expect(i18n.language).toBe('en');
    await expect(AsyncStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).resolves.toBe('en');
    expect(screen.getByText('App language')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('profile-ui-language')).getByRole('radio', { name: 'English' }),
    ).toBeSelected();
    // The language names themselves stay in their own language.
    expect(
      within(screen.getByTestId('profile-ui-language')).getByRole('radio', { name: 'Türkçe' }),
    ).toBeOnTheScreen();
  });
});

describe('Bildirimler', () => {
  it('shows the unread count, refreshes it once per focus and opens the list', async () => {
    await renderProfile();
    expect(mockFocusCount).toBe(1);
    expect(mockNotificationsStore.refreshUnreadCount).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByRole('button', { name: 'Bildirimler, 2 yeni' }));
    // Pops back to a Notifications already in the stack instead of stacking a second one.
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Notifications', undefined, { pop: true });
  });

  it('hides the count when nothing is unread', async () => {
    mockNotificationsStore.unreadCount = 0;
    await renderProfile();
    expect(screen.getByRole('button', { name: 'Bildirimler' })).toBeOnTheScreen();
    expect(screen.queryByText(/\d+ yeni/)).toBeNull();
  });

  it('binds the two switches to the stored preferences', async () => {
    mockPrefsGet.mockImplementation(async () => ({ ...PREFS, voiceReadyNotifications: false }));
    await renderProfile();
    expect(mockPrefsGet).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('switch', { name: 'Masal hazır olunca bildir' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Ses hazır olunca bildir' })).not.toBeChecked();
    // No promotional switch: the app sends no promotional pushes.
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });

  it('saves a toggle optimistically', async () => {
    let resolveUpdate: (value: UserPreferences) => void = () => undefined;
    mockPrefsUpdate.mockReturnValue(
      new Promise<UserPreferences>(resolve => {
        resolveUpdate = resolve;
      }),
    );
    await renderProfile();

    fireEvent.press(screen.getByTestId('profile-pref-narration'));
    await flush(1);
    expect(mockPrefsUpdate).toHaveBeenCalledWith({ narrationReadyNotifications: false });
    // Flipped before the backend answered, and locked meanwhile.
    expect(screen.getByTestId('profile-pref-narration')).not.toBeChecked();
    expect(screen.getByTestId('profile-pref-narration')).toBeDisabled();
    expect(screen.getByTestId('profile-pref-voice')).toBeEnabled();

    await act(async () => {
      resolveUpdate({ ...PREFS, narrationReadyNotifications: false });
    });
    expect(screen.getByTestId('profile-pref-narration')).not.toBeChecked();
    expect(screen.getByTestId('profile-pref-narration')).toBeEnabled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('rolls a toggle back and says so when the backend refuses', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockPrefsUpdate.mockRejectedValue(new Error('500'));
    await renderProfile();

    fireEvent.press(screen.getByTestId('profile-pref-voice'));
    await flush(2);
    expect(mockPrefsUpdate).toHaveBeenCalledWith({ voiceReadyNotifications: false });
    expect(screen.getByTestId('profile-pref-voice')).toBeChecked();
    expect(mockToastError).toHaveBeenCalledWith('Tercih kaydedilemedi');
  });

  it('shows the cached preferences at once and a spinner only while nothing is known', async () => {
    mockPrefsCached.mockReturnValue({ ...PREFS, narrationReadyNotifications: false });
    mockPrefsGet.mockReturnValue(new Promise(() => undefined));
    const first = await renderProfile();
    expect(screen.getByTestId('profile-pref-narration')).not.toBeChecked();
    expect(screen.queryByTestId('profile-prefs-loading')).toBeNull();
    first.unmount();

    mockPrefsCached.mockReturnValue(null);
    await renderProfile();
    expect(screen.getByTestId('profile-prefs-loading')).toBeOnTheScreen();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('without a cache the skeleton is there in the first frame, as tall as the switch rows', async () => {
    mockPrefsGet.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<ProfileScreen />);
    // No flush: the very first commit.
    expect(screen.getByTestId('profile-prefs-loading')).toBeOnTheScreen();
    for (const i of [0, 1]) {
      expect(flatStyle(screen.getByTestId(`profile-prefs-skeleton-${i}`)).minHeight).toBe(SETTING_ROW_MIN_HEIGHT);
    }
    expect(SETTING_ROW_MIN_HEIGHT).toBe(56);
    // The push status and the cache size answer after that frame.
    await act(async () => undefined);
  });

  it('says so when the preferences cannot be loaded, and retry loads them again', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockPrefsGet.mockRejectedValueOnce(new Error('offline'));
    await renderProfile();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByTestId('profile-prefs-loading')).toBeNull();
    const row = within(screen.getByTestId('profile-prefs-error'));
    expect(row.getByText('Bildirim ayarları yüklenemedi')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(row.getByRole('button', { name: 'Tekrar dene' }));
    });
    await flush(2);
    expect(mockPrefsGet).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('profile-prefs-error')).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });

  it('a failed refresh keeps the switches it already shows', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockPrefsCached.mockReturnValue({ ...PREFS });
    mockPrefsGet.mockRejectedValue(new Error('offline'));
    await renderProfile();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
    expect(screen.queryByTestId('profile-prefs-error')).toBeNull();
  });

  it('says nothing about permission when it is granted', async () => {
    await renderProfile();
    expect(screen.queryByTestId('profile-push-permission')).toBeNull();
  });

  it('offers the system settings page when the permission is denied', async () => {
    mockPermissionStatus.mockResolvedValue('denied');
    await renderProfile();
    expect(screen.getByText('Bildirim izni kapalı')).toBeOnTheScreen();
    // A warning: the alert icon in the warning colour.
    const icon = within(screen.getByTestId('profile-push-permission')).UNSAFE_getByType(Icon);
    expect(icon.props).toMatchObject({ name: 'alert', color: themes['gece-mavisi'].warning });
    // Nothing arrives while it is off: the switches are not shown as active.
    expect(screen.getByTestId('profile-pref-narration')).toBeDisabled();
    expect(screen.getByTestId('profile-pref-voice')).toBeDisabled();
    expect(screen.getByTestId('profile-pref-narration')).toBeChecked();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Ayarları aç' }));
    });
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Bildirim izni kapalı')).toBeOnTheScreen();
  });

  it('offers the system dialog when the permission was never asked, and hides the notice once granted', async () => {
    mockPermissionStatus.mockResolvedValue('undetermined');
    mockRequestPermission.mockResolvedValue('granted');
    await renderProfile();
    // Never asked yet: a question with a bell, not a warning.
    expect(screen.getByText('Masalın hazır olunca haber verelim mi?')).toBeOnTheScreen();
    const icon = within(screen.getByTestId('profile-push-permission')).UNSAFE_getByType(Icon);
    expect(icon.props).toMatchObject({ name: 'bell', color: themes['gece-mavisi'].text2 });
    expect(screen.getByText('Masalın ya da sesin hazır olunca haber verebilmemiz için izin gerekiyor.')).toBeOnTheScreen();
    // The switches stay usable: the preference is stored for when it is granted.
    expect(screen.getByTestId('profile-pref-narration')).toBeEnabled();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'İzin ver' }));
    });
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('profile-push-permission')).toBeNull();
  });

  it('reads the permission again when the app comes back from the system settings', async () => {
    const remove = jest.fn();
    let listener: (state: string) => void = () => undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      listener = handler as (state: string) => void;
      return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    mockPermissionStatus.mockResolvedValue('denied');
    const view = await renderProfile();
    expect(screen.getByTestId('profile-push-permission')).toBeOnTheScreen();

    mockPermissionStatus.mockResolvedValue('granted');
    await act(async () => {
      listener('background');
    });
    expect(mockPermissionStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      listener('active');
    });
    expect(mockPermissionStatus).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('profile-push-permission')).toBeNull();

    view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('Yasal belgeler', () => {
  it('lists the three documents in a sheet and opens each in the legal sheet', async () => {
    await renderProfile();
    expect(screen.queryByTestId('profile-legal-sheet')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Yasal belgeler' }));
    const sheet = within(screen.getByTestId('profile-legal-sheet'));
    expect(sheet.getByRole('button', { name: 'Kullanım Şartları' })).toBeOnTheScreen();
    expect(sheet.getByRole('button', { name: 'Gizlilik Politikası' })).toBeOnTheScreen();
    expect(sheet.getByRole('button', { name: 'Veri silme politikası' })).toBeOnTheScreen();
    expect(screen.queryByTestId('legal-sheet-slug')).toBeNull();

    fireEvent.press(sheet.getByRole('button', { name: 'Gizlilik Politikası' }));
    expect(screen.getByTestId('legal-sheet-slug')).toHaveTextContent('privacy');
    fireEvent.press(screen.getByTestId('profile-legal-data-deletion'));
    expect(screen.getByTestId('legal-sheet-slug')).toHaveTextContent('data-deletion');
    fireEvent.press(screen.getByTestId('profile-legal-tos'));
    expect(screen.getByTestId('legal-sheet-slug')).toHaveTextContent('tos');

    fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
    expect(screen.queryByTestId('profile-legal-sheet')).toBeNull();
  });
});

describe('sign out and delete account', () => {
  it('asks before signing out and signs out on confirmation', async () => {
    await renderProfile();
    fireEvent.press(screen.getByRole('button', { name: 'Çıkış yap' }));

    expect(dialog().title).toBe('Çıkış yap');
    expect(dialog().message).toBe('Oturumunu kapatmak istediğine emin misin?');
    expect(dialog().buttons?.map(button => [button.text, button.style])).toEqual([
      ['Çıkış yap', 'destructive'],
      ['Vazgeç', 'cancel'],
    ]);
    expect(mockAuthStore.signOut).not.toHaveBeenCalled();

    await act(async () => {
      await dialog().buttons?.[0].onPress?.();
    });
    expect(mockAuthStore.signOut).toHaveBeenCalledTimes(1);
  });

  it('the sign-out button is a full-width md button of the scale, not a label-wide pill (owner feedback)', async () => {
    await renderProfile();
    const button = screen.getByTestId('profile-sign-out');
    // Spans the page gutter.
    expect(flatStyle(button).alignSelf).toBe('stretch');
    // The md step: a 44dp face on its 2dp lip.
    expect(flatStyle(screen.getByTestId('profile-sign-out-face')).minHeight).toBe(BUTTON_METRICS.md.height);
    expect(flatStyle(screen.getByTestId('profile-sign-out-lip')).top).toBe(BUTTON_METRICS.md.lip);
    // The account deletion stays a quiet text link under it.
    expect(flatStyle(screen.getByTestId('profile-delete-account')).alignSelf).toBe('center');
  });

  it('says it is signing out at once and takes no second press until the session is dropped', async () => {
    mockAuthStore.isSigningOut = true;
    await renderProfile();

    const button = screen.getByTestId('profile-sign-out');
    expect(button).toHaveAccessibleName('Çıkış yapılıyor...');
    expect(button).toHaveTextContent('Çıkış yapılıyor...');
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(screen.getByTestId('profile-sign-out-spinner')).toBeOnTheScreen();
    fireEvent.press(button);
    expect(mockShowDialog).not.toHaveBeenCalled();
    expect(mockAuthStore.signOut).not.toHaveBeenCalled();
    // The account deletion waits too.
    fireEvent.press(screen.getByTestId('profile-delete-account'));
    expect(mockNavigation.navigate).not.toHaveBeenCalledWith('DataDeletion', undefined, { pop: true });
  });

  it('stays busy after the session is dropped, until the navigator has left (SIGNOUT-IDLE-FLASH)', async () => {
    // The store's contract (useAuth.test): busy from the press, the user
    // cleared, and still busy afterwards.
    const store = observable({ ...mockAuthStore, isSigningOut: false });
    const userGone = deferred();
    store.signOut = jest.fn(async () => {
      runInAction(() => {
        store.isSigningOut = true;
      });
      await userGone.promise;
      runInAction(() => {
        store.backendUser = null;
      });
      return true;
    });
    mockAuthStore = store;
    await renderProfile();
    const busy = () => {
      const button = screen.getByTestId('profile-sign-out');
      expect(button).toHaveTextContent('Çıkış yapılıyor...');
      expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
      expect(screen.getByTestId('profile-delete-account').props.accessibilityState).toMatchObject({
        disabled: true,
      });
    };

    fireEvent.press(screen.getByRole('button', { name: 'Çıkış yap' }));
    let pending!: Promise<unknown> | undefined;
    act(() => {
      pending = dialog().buttons?.[0].onPress?.() as Promise<unknown> | undefined;
    });
    busy();

    await act(async () => {
      userGone.resolve();
      await pending;
    });
    // Signed out, Profile not yet replaced: never the idle button, never a
    // "Hesabı sil" that takes a press.
    busy();
    fireEvent.press(screen.getByTestId('profile-delete-account'));
    expect(mockNavigation.navigate).not.toHaveBeenCalledWith('DataDeletion', undefined, { pop: true });
  });

  it('in English the busy label is translated', async () => {
    await i18n.changeLanguage('en');
    mockAuthStore.isSigningOut = true;
    await renderProfile();

    expect(screen.getByTestId('profile-sign-out')).toHaveTextContent('Signing out...');
  });

  it('survives a failing sign out', async () => {
    mockAuthStore.signOut.mockRejectedValue(new Error('network'));
    await renderProfile();
    fireEvent.press(screen.getByTestId('profile-sign-out'));
    await expect(dialog().buttons?.[0].onPress?.()).resolves.toBeUndefined();
  });

  it('opens the account deletion flow', async () => {
    await renderProfile();
    fireEvent.press(screen.getByRole('button', { name: 'Hesabı sil' }));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('DataDeletion', undefined, { pop: true });
  });

  it('never navigates to the removed Settings routes', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderProfile();
    for (const row of screen.getAllByRole('button')) {
      fireEvent.press(row);
    }
    const routes = mockNavigation.navigate.mock.calls.map(call => call[0]);
    expect(routes).not.toContain('Settings');
    expect(routes).not.toContain('AdvancedSettings');
    expect(routes).not.toContain('MyLibrary');
  });
});

describe('contact, cache and version', () => {
  it('opens a mail to support', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderProfile();
    fireEvent.press(screen.getByRole('button', { name: 'Bize ulaşın' }));
    expect(openURL).toHaveBeenCalledWith('mailto:info@sesly.io?subject=Sesly%20Destek');
    await flush(1);
    expect(mockShowDialog).not.toHaveBeenCalled();
  });

  it('gives the address when no mail app can open', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    await renderProfile();
    fireEvent.press(screen.getByTestId('profile-contact'));
    await flush(2);
    expect(dialog().title).toBe('E-posta açılamadı');
    expect(dialog().message).toBe(
      'Cihazında bir e-posta uygulaması bulunamadı. Bize info@sesly.io adresinden ulaşabilirsin.',
    );
  });

  it('shows the cache size and clears the cache after a confirmation', async () => {
    await renderProfile();
    expect(screen.getByRole('button', { name: 'Önbelleği temizle, 12,4 MB' })).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('profile-clear-cache'));
    expect(dialog().title).toBe('Önbelleği temizle');
    expect(dialog().message).toBe('Önbellekteki ses dosyaları silinir.');
    expect(dialog().buttons?.map(button => button.text)).toEqual(['Temizle', 'Vazgeç']);
    expect(mockClearCache).not.toHaveBeenCalled();

    mockCacheSize.mockResolvedValue({ total: 0 });
    await act(async () => {
      await dialog().buttons?.[0].onPress?.();
    });
    expect(mockClearCache).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith('Önbellek temizlendi');
    expect(mockCacheSize).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Önbelleği temizle, 0 B' })).toBeOnTheScreen();

    // Empty now: no question to answer, only a note.
    fireEvent.press(screen.getByTestId('profile-clear-cache'));
    expect(mockShowDialog).toHaveBeenCalledTimes(1);
    expect(mockToastInfo).toHaveBeenCalledWith('Önbellek zaten boş');
    expect(mockClearCache).toHaveBeenCalledTimes(1);
  });

  it('the cache row has a phone icon, apart from the delete-account trash', async () => {
    await renderProfile();
    const icons = within(screen.getByTestId('profile-clear-cache')).UNSAFE_getAllByType(Icon);
    expect(icons.map(icon => icon.props.name)).toEqual(['phone']);
  });

  it('reports a failed clear', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockClearCache.mockRejectedValue(new Error('disk'));
    await renderProfile();
    fireEvent.press(screen.getByTestId('profile-clear-cache'));
    await act(async () => {
      await dialog().buttons?.[0].onPress?.();
    });
    expect(mockToastError).toHaveBeenCalledWith('Önbellek temizlenemedi');
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('shows the row without a size when the size cannot be read', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockCacheSize.mockRejectedValue(new Error('fs'));
    await renderProfile();
    expect(screen.getByRole('button', { name: 'Önbelleği temizle' })).toBeOnTheScreen();
  });

  it('shows the real app version and nothing when it is unknown', async () => {
    let restore = setAppVersion('1.0.8');
    try {
      const first = await renderProfile();
      expect(screen.getByText('Sürüm 1.0.8')).toBeOnTheScreen();
      first.unmount();
    } finally {
      restore();
    }

    restore = setAppVersion(undefined);
    try {
      await renderProfile();
      expect(screen.queryByTestId('profile-version')).toBeNull();
    } finally {
      restore();
    }
  });
});

describe('refresh, themes and languages', () => {
  it('pull to refresh reloads the plan, the unread count, the preferences and the cache size', async () => {
    await renderProfile();
    const scroll = screen.UNSAFE_getAllByType(ScrollView)[0];
    await act(async () => {
      await scroll.props.refreshControl.props.onRefresh();
    });
    expect(mockSubscriptionStore.refresh).toHaveBeenCalledTimes(1);
    expect(mockNotificationsStore.refreshUnreadCount).toHaveBeenCalledTimes(2);
    expect(mockPrefsGet).toHaveBeenCalledTimes(2);
    expect(mockCacheSize).toHaveBeenCalledTimes(2);
  });

  it.each(PALETTE_KEYS)('in %s every face stands out from what it sits on', async scheme => {
    mockPermissionStatus.mockResolvedValue('denied');
    await renderProfile(scheme);
    const T = themes[scheme];
    const bg = (testID: string) => flatStyle(screen.getByTestId(testID)).backgroundColor as string;
    const apart = (face: string, container: string) => {
      expect(face).not.toBe(container);
      expect(contrastRatio(face, container)).toBeGreaterThan(1.05);
    };
    for (const id of ['profile-account', 'profile-plan', 'profile-group-language', 'profile-group-more']) {
      apart(bg(`${id}-face`), T.bg);
    }
    // The row tile and the permission block on their card, the block's
    // button on the block.
    const notifications = bg('profile-group-notifications-face');
    apart(bg('profile-notifications-tile'), notifications);
    apart(bg('profile-push-permission'), notifications);
    apart(bg('profile-push-permission-action-face'), bg('profile-push-permission'));
    // Sign out is a secondary button on the canvas.
    apart(bg('profile-sign-out-face'), T.bg);
    // Every palette swatch's preview on its swatch face.
    for (const key of PALETTE_KEYS) {
      apart(bg(`palette-preview-${key}`), bg(`palette-option-${key}-face`));
    }
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', async scheme => {
    mockPermissionStatus.mockResolvedValue('denied');
    const restore = setAppVersion('1.1.0');
    try {
      await renderProfile(scheme);
      const T = themes[scheme];
      expect(flatStyle(screen.getByRole('header', { name: 'Zeynep Kaya' })).color).toBe(T.text);
      expect(flatStyle(screen.getByText('zeynep@ornek.com')).color).toBe(T.text2);
      // The account card: the avatar in the own colour with dark text, as on
      // the tab bars.
      expect(flatStyle(screen.getByTestId('profile-account-face')).backgroundColor).toBe(T.surface);
      expect(flatStyle(screen.getByTestId('profile-avatar')).backgroundColor).toBe(T.own);
      expect(flatStyle(screen.getByText('Z')).color).toBe(T.onCat);
      // Cards on their lips, no hairline borders.
      for (const id of ['profile-plan', 'profile-group-language', 'profile-group-notifications', 'profile-group-more']) {
        const face = flatStyle(screen.getByTestId(`${id}-face`));
        expect(face.backgroundColor).toBe(T.surface);
        // Every card keeps its 2dp ring, transparent unless selected.
        expect(face.borderColor).toBe('transparent');
        expect(flatStyle(screen.getByTestId(`${id}-lip`)).backgroundColor).toBe(T.lip);
      }
      // "Planları gör" is the one action-coloured button of the screen.
      expect(flatStyle(screen.getByTestId('profile-see-plans-face')).backgroundColor).toBe(T.action);
      expect(flatStyle(screen.getByText('Planları gör')).color).toBe(T.onAction);
      expect(flatStyle(screen.getByText('Masal dili')).color).toBe(T.text);
      expect(flatStyle(screen.getByTestId('profile-notifications-tile')).backgroundColor).toBe(T.surface2);
      expect(flatStyle(screen.getByText('2 yeni')).color).toBe(T.text2);
      // Sign out is a secondary button, delete account a danger one.
      expect(flatStyle(screen.getByTestId('profile-sign-out-face')).backgroundColor).toBe(T.surface);
      expect(flatStyle(screen.getByText('Çıkış yap')).color).toBe(T.text);
      expect(flatStyle(screen.getByText('Hesabı sil')).color).toBe(T.error);
      expect(flatStyle(screen.getByText('Sürüm 1.1.0')).color).toBe(T.text3);
      // The permission notice is a raised box; its one action is the primary sm button.
      expect(flatStyle(screen.getByTestId('profile-push-permission')).backgroundColor).toBe(T.surface2);
      expect(flatStyle(screen.getByTestId('profile-push-permission-action-face'))).toMatchObject({
        backgroundColor: T.action,
        minHeight: 36,
      });
      // The palette block sits right under the language card.
      expect(flatStyle(screen.getByTestId('profile-palette')).paddingTop).toBe(0);
      expect(flatStyle(screen.getByTestId('profile-palette')).paddingBottom).toBe(16);
      // The pick of a segmented control is the action colour, with dark text.
      const uiRow = within(screen.getByTestId('profile-ui-language'));
      expect(flatStyle(uiRow.getByText('Türkçe')).color).toBe(T.onAction);
      expect(flatStyle(uiRow.getByText('English')).color).toBe(T.text2);
    } finally {
      restore();
    }
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    mockPermissionStatus.mockResolvedValue('denied');
    await renderProfile();

    expect(screen.getByRole('header', { name: 'Profile' })).toBeOnTheScreen();
    expect(screen.getByText('Free plan')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'See plans' })).toBeOnTheScreen();
    expect(screen.getByText('Story language')).toBeOnTheScreen();
    expect(screen.getByTestId('palette-picker')).toHaveProp('accessibilityLabel', 'Colour palette');
    expect(screen.getByRole('radio', { name: 'Night blue' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Notifications, 2 new' })).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: 'Tell me when a story is ready' })).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: 'Tell me when my voice is ready' })).toBeOnTheScreen();
    expect(screen.getByText('Notifications are turned off')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Open settings' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Legal documents' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Contact us' })).toBeOnTheScreen();
    // The decimal mark follows the UI language.
    expect(screen.getByRole('button', { name: 'Clear cache, 12.4 MB' })).toBeOnTheScreen();
  });
});
