/**
 * NarratorCatalogueScreen: every ready-made narrator of one language
 * ("Tümünü gör" on Sesim, and the story's "Hazır anlatıcı seç").
 *
 * Covers the language filter, the stable catalogue order with added
 * narrators marked in place, adding (and going back for a story), removing,
 * the preview and the loading and empty states. Stores are plain mocks.
 */

import React from 'react';
import { configure as configureMobx, observable as mockObservable } from 'mobx';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { themes } from '../../theme/theme';
import { narratorAvatarSlotFor } from '../../components/voice/narratorRows';
import { AvailableGoogleVoice, VoiceProfile } from '../../models/VoiceProfile';
import { TTSProvider, VoiceProfileStatus } from '../../types/enums';
import { showToast } from '../../utils/toast';
import VoiceProfileService from '../../services/VoiceProfileService';
import {
  NarratorCatalogueScreen,
  filterRowsByGender,
  offersGenderFilter,
} from './NarratorCatalogueScreen';
import { buildCatalogueRows } from '../../components/voice/narratorRows';

jest.setTimeout(60000);
configureMobx({ enforceActions: 'never' });

interface DialogCall {
  title: string;
  message?: string;
  buttons?: { text: string; style?: string; onPress?: () => void | Promise<void> }[];
}

function voice(name: string, language = 'tr'): AvailableGoogleVoice {
  const locale = language === 'tr' ? 'tr-TR' : 'en-US';
  const voiceId = `${locale}-Chirp3-HD-${name}`;
  return {
    id: voiceId,
    voiceId,
    name,
    language: locale,
    languageCode: locale,
    contentLanguage: language,
    gender: 'female',
    description: '',
    provider: 'GOOGLE',
  };
}

function added(name: string): VoiceProfile {
  return {
    id: `vp-${name}`,
    name,
    status: VoiceProfileStatus.READY,
    provider: TTSProvider.GOOGLE,
    voiceId: `tr-TR-Chirp3-HD-${name}`,
    language: 'tr-TR',
    contentLanguage: 'tr',
    sampleAudioUrl: null,
    errorMessage: null,
    voiceModelId: null,
    kind: 'PRESET',
    consentAt: null,
    createdAt: new Date(2026, 9, 12),
    updatedAt: new Date(2026, 9, 12),
  };
}

const TR = ['Ada', 'Bora', 'Cem', 'Deniz', 'Ece', 'Fatma', 'Gül', 'Hale'].map(name => voice(name));
const EN = ['Orus', 'Puck'].map(name => voice(name, 'en'));

let mockVoiceStore: Record<string, any>;
const mockShowDialog = jest.fn();
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), popTo: jest.fn() };
let mockRoute: { key: string; name: string; params?: Record<string, unknown> };
const mockContentLanguage = {
  selectable: 'tr',
  languages: [{ code: 'tr' }, { code: 'en' }],
  nativeName: (code: string) => ({ tr: 'Türkçe', en: 'English' })[code] ?? code,
  load: jest.fn(() => Promise.resolve()),
};
// The sample contract of the narrator preview hook: the store's sample key.
const mockAudioPlayer = mockObservable(
  {
    source: 'none',
    sampleKey: null as string | null,
    isPlaying: false,
    isPlayingStory: false,
    previewPending: false,
    previewFailed: false,
    acknowledgePreviewFailure: jest.fn(),
    stopAndCleanup: jest.fn(() => Promise.resolve()),
    stopPreview: jest.fn(() => Promise.resolve()),
    playFromUrl: jest.fn(() => Promise.resolve()),
  },
  {
    acknowledgePreviewFailure: false,
    stopAndCleanup: false,
    stopPreview: false,
    playFromUrl: false,
  },
);

jest.mock('../../hooks/useVoiceProfile', () => ({ useVoiceProfile: () => mockVoiceStore }));
jest.mock('../../hooks/useContentLanguage', () => ({
  ...jest.requireActual('../../hooks/useContentLanguage'),
  useContentLanguage: () => mockContentLanguage,
}));
jest.mock('../../hooks/useAudioPlayer', () => ({ useAudioPlayer: () => mockAudioPlayer }));
jest.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => ({ planId: 'free', isPaid: false, isPremiumPlan: false }),
}));
jest.mock('../../hooks/useDialog', () => ({
  useDialog: () => ({ showDialog: mockShowDialog, hideDialog: jest.fn() }),
}));
jest.mock('../../services/VoiceProfileService', () => ({
  __esModule: true,
  default: { previewVoice: jest.fn(() => Promise.resolve({ audioUrl: 'https://x/preview.mp3' })) },
}));
jest.mock('../../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => mockRoute,
  // Focused while mounted: unmounting the screen is leaving it.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react') as typeof React;
    useEffect(effect, [effect]);
  },
}));

function makeStore(overrides: Record<string, unknown> = {}) {
  const store = {
    voiceProfiles: [] as VoiceProfile[],
    isLoadingVoices: false,
    catalogueFor: jest.fn((language: string) => (language === 'en' ? EN : TR)),
    catalogueErrorFor: jest.fn(() => null),
    voiceSlotInfo: null as unknown,
    loadVoiceSlots: jest.fn(() => Promise.resolve()),
    loadAvailableVoices: jest.fn(() => Promise.resolve()),
    loadVoiceProfiles: jest.fn(() => Promise.resolve()),
    deleteVoiceProfile: jest.fn(() => Promise.resolve(true)),
    checkCanCreate: jest.fn(() => Promise.resolve(true)),
    slotBlock: jest.fn(() => ({ title: 'Hak doldu', message: 'Açıklama', showPaywall: true })),
    createVoiceProfile: jest.fn(() => Promise.resolve({ profile: { id: 'vp-new' }, error: null })),
    getVoiceSample: jest.fn(() => Promise.resolve(null)),
    /** Voice ids whose add is on its way (the real store marks them in the tap). */
    addingPresetIds: new Set<string>(),
    isAddingPreset: jest.fn((voiceId: string): boolean => (store.addingPresetIds as Set<string>).has(voiceId)),
    ...overrides,
  };
  // The real store adds the adds and removals on their way; here the snapshot.
  // A getter on the object itself (a spread would copy its value once).
  Object.defineProperty(store, 'presetSlots', {
    enumerable: true,
    get: () => (store.voiceSlotInfo as { preset?: unknown } | null)?.preset ?? null,
  });
  return store as typeof store & { readonly presetSlots: unknown };
}

async function renderScreen() {
  const utils = renderWithProviders(<NarratorCatalogueScreen />);
  await act(async () => undefined);
  return utils;
}

const lastDialog = (): DialogCall =>
  mockShowDialog.mock.calls[mockShowDialog.mock.calls.length - 1][0] as DialogCall;

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

beforeEach(() => {
  mockVoiceStore = makeStore();
  mockRoute = { key: 'catalogue', name: 'NarratorCatalogue', params: { language: 'tr' } };
  mockShowDialog.mockReset();
  mockNav.navigate.mockReset();
  mockNav.goBack.mockReset();
  mockNav.popTo.mockReset();
  mockContentLanguage.languages = [{ code: 'tr' }, { code: 'en' }];
  (showToast.success as jest.Mock).mockReset();
  mockAudioPlayer.stopAndCleanup.mockClear();
  mockAudioPlayer.playFromUrl.mockClear();
});

describe('NarratorCatalogueScreen gender filter (V14)', () => {
  const male = (name: string): AvailableGoogleVoice => ({ ...voice(name), gender: 'male' });
  const MIXED = [voice('Ada'), male('Bora'), male('Cem'), voice('Deniz'), { ...voice('Ece'), gender: '' }];

  it('is offered only when the language has women\'s and men\'s voices', () => {
    expect(offersGenderFilter(MIXED)).toBe(true);
    expect(offersGenderFilter(TR)).toBe(false);
    expect(offersGenderFilter([])).toBe(false);
    expect(offersGenderFilter([{ ...voice('A'), gender: 'FEMALE' }, { ...voice('B'), gender: ' Male ' }])).toBe(true);
  });

  it('keeps the rows of one gender; an added narrator takes its catalogue gender', () => {
    const rows = buildCatalogueRows([added('Cem')], MIXED, 'tr');
    const names = (filter: 'all' | 'female' | 'male') =>
      filterRowsByGender(rows, filter, MIXED).map(row =>
        row.kind === 'catalogue' ? row.voice.name : `+${row.profile.name}`,
      );
    expect(names('all')).toHaveLength(rows.length);
    expect(names('male')).toEqual(expect.arrayContaining(['Bora', '+Cem']));
    expect(names('male')).not.toContain('Ada');
    expect(names('female')).toEqual(expect.arrayContaining(['Ada', 'Deniz']));
    // A voice of unknown gender is only under "Hepsi".
    expect(names('female')).not.toContain('Ece');
    expect(names('male')).not.toContain('Ece');
    expect(names('all')).toContain('Ece');
  });

  it('narrows the list with its chips and takes "Hepsi" back', async () => {
    mockVoiceStore = makeStore({ catalogueFor: jest.fn(() => MIXED) });
    await renderScreen();
    const filter = screen.getByTestId('catalogue-gender-filter');
    expect(within(filter).getByRole('radio', { name: 'Hepsi' })).toBeSelected();
    expect(screen.getByTestId('narrator-tr-TR-Chirp3-HD-Ada')).toBeOnTheScreen();

    fireEvent.press(within(filter).getByRole('radio', { name: 'Erkek sesleri' }));
    expect(screen.queryByTestId('narrator-tr-TR-Chirp3-HD-Ada')).toBeNull();
    expect(screen.getByTestId('narrator-tr-TR-Chirp3-HD-Bora')).toBeOnTheScreen();
    expect(screen.getByTestId('narrator-tr-TR-Chirp3-HD-Cem')).toBeOnTheScreen();

    fireEvent.press(within(filter).getByRole('radio', { name: 'Kadın sesleri' }));
    expect(screen.getByTestId('narrator-tr-TR-Chirp3-HD-Ada')).toBeOnTheScreen();
    expect(screen.queryByTestId('narrator-tr-TR-Chirp3-HD-Bora')).toBeNull();

    fireEvent.press(within(filter).getByRole('radio', { name: 'Hepsi' }));
    expect(screen.getByTestId('narrator-tr-TR-Chirp3-HD-Bora')).toBeOnTheScreen();
    expect(screen.getByTestId('narrator-tr-TR-Chirp3-HD-Ece')).toBeOnTheScreen();
  });

  it('a language of one gender has no chips and drops a filter picked on another one', async () => {
    mockVoiceStore = makeStore({
      catalogueFor: jest.fn((language: string) => (language === 'en' ? EN : MIXED)),
    });
    await renderScreen();
    fireEvent.press(screen.getByRole('radio', { name: 'Erkek sesleri' }));
    expect(screen.queryByTestId('narrator-tr-TR-Chirp3-HD-Ada')).toBeNull();

    fireEvent.press(screen.getByTestId('catalogue-language-en'));
    expect(screen.queryByTestId('catalogue-gender-filter')).toBeNull();
    // Every English narrator is listed although "men" was picked on Turkish.
    expect(screen.getByTestId('narrator-en-US-Chirp3-HD-Orus')).toBeOnTheScreen();
    expect(screen.getByTestId('narrator-en-US-Chirp3-HD-Puck')).toBeOnTheScreen();
  });

  it('is not shown for a catalogue of one gender', async () => {
    await renderScreen();
    expect(screen.queryByTestId('catalogue-gender-filter')).toBeNull();
  });
});

describe('NarratorCatalogueScreen', () => {
  it('lists every narrator of the language under the "Hazır anlatıcılar" title', async () => {
    await renderScreen();
    expect(screen.getByRole('header', { name: 'Hazır anlatıcılar' })).toBeOnTheScreen();
    // FlatList renders the first window; eight rows fit in it.
    for (const name of ['Ada', 'Hale']) {
      expect(screen.getByTestId(`narrator-tr-TR-Chirp3-HD-${name}`)).toBeOnTheScreen();
    }
    fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
    expect(mockNav.goBack).toHaveBeenCalledTimes(1);
  });

  it('switches language with the filter and asks for a catalogue it does not have', async () => {
    mockVoiceStore = makeStore({
      catalogueFor: jest.fn((language: string) => (language === 'tr' ? TR : null)),
    });
    await renderScreen();
    expect(screen.getByRole('radio', { name: 'Türkçe' })).toBeSelected();

    fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledWith('en');
    // Loading: row skeletons, labelled for a screen reader.
    expect(screen.getByTestId('catalogue-loading').props.accessibilityLabel).toBe(
      'Anlatıcılar yükleniyor...',
    );
  });

  it('keeps the catalogue order and marks an added narrator in place', async () => {
    mockVoiceStore = makeStore({ voiceProfiles: [added('Deniz')] });
    await renderScreen();
    const ids = screen
      .getAllByTestId(/^narrator-(tr-TR-Chirp3-HD-[A-Za-zÇĞİÖŞÜçğıöşü]+|vp-[A-Za-z]+)$/)
      .map(node => node.props.testID as string);
    expect(ids.slice(0, 4)).toEqual([
      'narrator-tr-TR-Chirp3-HD-Ada',
      'narrator-tr-TR-Chirp3-HD-Bora',
      'narrator-tr-TR-Chirp3-HD-Cem',
      'narrator-vp-Deniz',
    ]);
    expect(within(screen.getByTestId('narrator-vp-Deniz')).getByText('Eklendi')).toBeOnTheScreen();
  });

  it('adds a narrator on tap and stays', async () => {
    await renderScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Ece anlatıcısını ekle' }));
    await waitFor(() => expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledTimes(1));
    expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ece', voiceId: 'tr-TR-Chirp3-HD-Ece' }),
    );
    await waitFor(() => expect(showToast.success).toHaveBeenCalledWith('Anlatıcı eklendi'));
    expect(mockNav.goBack).not.toHaveBeenCalled();
  });

  it('pickForStory returns with popTo and selectVoiceId', async () => {
    mockRoute = {
      key: 'catalogue',
      name: 'NarratorCatalogue',
      params: { language: 'tr', pickForStory: true, storyId: 'story-7' },
    };
    mockVoiceStore = makeStore({
      createVoiceProfile: jest.fn(() => Promise.resolve({ profile: { id: 'vp-ada' }, error: null })),
    });
    await renderScreen();
    expect(
      screen.getByText('Masalı dinlemek için bir anlatıcı ekle. Eklediğinde masala geri dönersin.'),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Ada anlatıcısını ekle' }));
    await waitFor(() =>
      expect(mockNav.popTo).toHaveBeenCalledWith('StoryDetail', {
        storyId: 'story-7',
        selectVoiceId: 'vp-ada',
      }),
    );
    expect(mockNav.goBack).not.toHaveBeenCalled();
    // The story selects the new narrator; a message would only cover its button.
    expect(showToast.success).not.toHaveBeenCalled();
  });

  it('goes back when it was opened for a story it does not know', async () => {
    mockRoute = {
      key: 'catalogue',
      name: 'NarratorCatalogue',
      params: { language: 'tr', pickForStory: true },
    };
    await renderScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Ada anlatıcısını ekle' }));
    await waitFor(() => expect(mockNav.goBack).toHaveBeenCalledTimes(1));
    expect(mockNav.popTo).not.toHaveBeenCalled();
  });

  it('stays when an add for a story was refused', async () => {
    mockRoute = {
      key: 'catalogue',
      name: 'NarratorCatalogue',
      params: { language: 'tr', pickForStory: true, storyId: 'story-7' },
    };
    mockVoiceStore = makeStore({ checkCanCreate: jest.fn(() => Promise.resolve(false)) });
    await renderScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Ada anlatıcısını ekle' }));
    await waitFor(() => expect(mockShowDialog).toHaveBeenCalled());
    expect(mockNav.popTo).not.toHaveBeenCalled();
    expect(mockNav.goBack).not.toHaveBeenCalled();
  });

  it('a double tap adds once and shows the row busy', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockVoiceStore = makeStore({
      createVoiceProfile: jest.fn(
        () => new Promise(resolve => {
          finish = resolve;
        }),
      ),
    });
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Ece anlatıcısını ekle' }));
    });
    const row = screen.getByRole('button', { name: 'Ece anlatıcısını ekle' });
    expect(row).toBeDisabled();
    expect(row.props.accessibilityState).toMatchObject({ busy: true });
    // Its plus spins meanwhile, its sample button stays as it is (V5-04); the
    // other rows stay as they were.
    expect(screen.getByRole('button', { name: 'Ece örneğini dinle' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Ada anlatıcısını ekle' })).toBeEnabled();
    fireEvent.press(row);
    await act(async () => {
      finish({ profile: { id: 'vp-ece' }, error: null });
    });
    expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledTimes(1);
    expect(showToast.success).toHaveBeenCalledTimes(1);
  });

  it('a failed catalogue shows the error state and retry reloads', async () => {
    mockVoiceStore = makeStore({
      catalogueFor: jest.fn(() => null),
      catalogueErrorFor: jest.fn(() => 'Hazır anlatıcılar yüklenemedi'),
    });
    await renderScreen();
    // Never an endless skeleton.
    expect(screen.queryByTestId('catalogue-loading')).toBeNull();
    const error = screen.getByTestId('catalogue-error');
    expect(within(error).getByText('Anlatıcılar yüklenemedi')).toBeOnTheScreen();
    expect(within(error).getByText('Bağlantını kontrol edip tekrar dene.')).toBeOnTheScreen();
    mockVoiceStore.loadAvailableVoices.mockClear();
    fireEvent.press(within(error).getByRole('button', { name: 'Tekrar dene' }));
    expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledWith('tr');
  });

  it('a pull to refresh after a failure shows the skeleton, not an empty list', async () => {
    let error: string | null = 'Hazır anlatıcılar yüklenemedi';
    mockVoiceStore = makeStore({
      catalogueFor: jest.fn(() => null),
      catalogueErrorFor: jest.fn(() => error),
      // The store forgets the old error when it asks again.
      loadAvailableVoices: jest.fn(() => {
        error = null;
        return new Promise<void>(() => undefined);
      }),
    });
    await renderScreen();
    expect(screen.getByTestId('catalogue-error')).toBeOnTheScreen();
    act(() => {
      void screen.getByTestId('catalogue-list').props.refreshControl.props.onRefresh();
    });
    expect(screen.getByTestId('catalogue-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('catalogue-empty')).toBeNull();
    expect(screen.queryByTestId('catalogue-error')).toBeNull();
  });

  it('a failed catalogue keeps the added narrators of the language reachable', async () => {
    mockVoiceStore = makeStore({
      voiceProfiles: [added('Cem')],
      catalogueFor: jest.fn(() => null),
      catalogueErrorFor: jest.fn(() => 'Hazır anlatıcılar yüklenemedi'),
    });
    await renderScreen();
    expect(screen.getByTestId('narrator-vp-Cem')).toBeOnTheScreen();
    // The failure is still said, after the rows, with its retry.
    const error = screen.getByTestId('catalogue-error');
    mockVoiceStore.loadAvailableVoices.mockClear();
    fireEvent.press(within(error).getByRole('button', { name: 'Tekrar dene' }));
    expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledWith('tr');
  });

  it('explains a full allowance instead of adding', async () => {
    mockVoiceStore = makeStore({ checkCanCreate: jest.fn(() => Promise.resolve(false)) });
    await renderScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Ada anlatıcısını ekle' }));
    await waitFor(() => expect(mockShowDialog).toHaveBeenCalled());
    expect(lastDialog().title).toBe('Hak doldu');
    expect(mockVoiceStore.createVoiceProfile).not.toHaveBeenCalled();
  });

  it('removes an added narrator after a confirmation: hidden at once, then confirmed', async () => {
    let answer: (deleted: boolean) => void = () => undefined;
    mockVoiceStore = makeStore({
      voiceProfiles: [added('Cem')],
      deleteVoiceProfile: jest.fn(
        () => new Promise<boolean>(resolve => {
          answer = resolve;
        }),
      ),
    });
    await renderScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Cem anlatıcısını kaldır' }));
    expect(lastDialog().title).toBe('Cem kaldırılsın mı?');
    await act(async () => {
      lastDialog().buttons?.[1].onPress?.();
    });
    expect(mockVoiceStore.deleteVoiceProfile).toHaveBeenCalledWith('vp-Cem');
    // The added row is gone while the request runs; the catalogue row is back in its place.
    expect(screen.queryByTestId('narrator-vp-Cem')).toBeNull();
    expect(screen.getByTestId('narrator-tr-TR-Chirp3-HD-Cem')).toBeOnTheScreen();
    await act(async () => {
      answer(true);
    });
    expect(showToast.success).toHaveBeenCalledWith('Anlatıcı kaldırıldı', undefined, {
      label: 'Geri al',
      onPress: expect.any(Function),
    });
  });

  it('"Geri al" after a removal adds the same narrator again (V11)', async () => {
    mockVoiceStore = makeStore({ voiceProfiles: [added('Cem')] });
    await renderScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Cem anlatıcısını kaldır' }));
    await act(async () => {
      lastDialog().buttons?.[1].onPress?.();
    });
    const action = (showToast.success as jest.Mock).mock.calls[0][2] as { onPress: () => void };
    // The store dropped the profile with the delete.
    mockVoiceStore.voiceProfiles = [];
    await act(async () => {
      action.onPress();
    });
    expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledWith(
      expect.objectContaining({ voiceId: 'tr-TR-Chirp3-HD-Cem', name: 'Cem' }),
    );
  });

  it('a removal whose voice is not in the catalogue offers no undo', async () => {
    const gone = { ...added('Zeki'), voiceId: 'tr-TR-Chirp3-HD-Zeki' };
    mockVoiceStore = makeStore({ voiceProfiles: [gone] });
    await renderScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Zeki anlatıcısını kaldır' }));
    await act(async () => {
      lastDialog().buttons?.[1].onPress?.();
    });
    expect(showToast.success).toHaveBeenCalledWith('Anlatıcı kaldırıldı', undefined, undefined);
  });

  it('a removal the backend refuses brings the row back, and its "Geri al" adds nothing', async () => {
    mockVoiceStore = makeStore({
      voiceProfiles: [added('Cem')],
      // The store shows why (its error message replaces the snackbar).
      deleteVoiceProfile: jest.fn(() => Promise.resolve(false)),
    });
    await renderScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Cem anlatıcısını kaldır' }));
    await act(async () => {
      lastDialog().buttons?.[1].onPress?.();
    });
    expect(screen.getByTestId('narrator-vp-Cem')).toBeOnTheScreen();
    const action = (showToast.success as jest.Mock).mock.calls[0][2] as { onPress: () => void };
    await act(async () => {
      action.onPress();
    });
    expect(mockVoiceStore.createVoiceProfile).not.toHaveBeenCalled();
  });

  it('a removal says so in the frame of the confirm, before the backend answers (VR-04)', async () => {
    let answer: (deleted: boolean) => void = () => undefined;
    mockVoiceStore = makeStore({
      voiceProfiles: [added('Cem')],
      deleteVoiceProfile: jest.fn(
        () => new Promise<boolean>(resolve => {
          answer = resolve;
        }),
      ),
    });
    await renderScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Cem anlatıcısını kaldır' }));
    act(() => {
      lastDialog().buttons?.[1].onPress?.();
    });
    // Row and message together, the delete still on its way.
    expect(screen.queryByTestId('narrator-vp-Cem')).toBeNull();
    expect(showToast.success).toHaveBeenCalledTimes(1);
    expect(showToast.success).toHaveBeenCalledWith('Anlatıcı kaldırıldı', undefined, {
      label: 'Geri al',
      onPress: expect.any(Function),
    });

    // "Geri al" pressed before the delete went: the add waits for it.
    const action = (showToast.success as jest.Mock).mock.calls[0][2] as { onPress: () => void };
    act(() => {
      action.onPress();
    });
    expect(mockVoiceStore.createVoiceProfile).not.toHaveBeenCalled();
    await act(async () => {
      // The store dropped the profile with the delete.
      mockVoiceStore.voiceProfiles = [];
      answer(true);
    });
    expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledWith(
      expect.objectContaining({ voiceId: 'tr-TR-Chirp3-HD-Cem', name: 'Cem' }),
    );
  });

  it('a tap marks the row added in the same frame, before the backend answers (VR-03)', async () => {
    // Observable like the real store, whose create marks the voice before its first await.
    const marks = mockObservable(new Set<string>());
    mockVoiceStore = makeStore({
      addingPresetIds: marks,
      canAddPresetNow: true,
      hasLoadedProfiles: true,
      createVoiceProfile: jest.fn(({ voiceId }: { voiceId: string }) => {
        marks.add(voiceId);
        return new Promise(() => undefined);
      }),
    });
    await renderScreen();

    act(() => {
      fireEvent.press(screen.getByRole('button', { name: 'Ada anlatıcısını ekle' }));
    });

    // No slot round trip first, and the row (a list cell, outside the screen's
    // own render) already says it.
    expect(mockVoiceStore.checkCanCreate).not.toHaveBeenCalled();
    expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledTimes(1);
    const row = screen.getByTestId('narrator-tr-TR-Chirp3-HD-Ada');
    expect(within(row).getByText(/Eklendi/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Ada anlatıcısını ekle' })).toBeNull();
  });

  it('a narrator whose add is on its way shows as added at once, without its plus (VR-03)', async () => {
    mockVoiceStore = makeStore({
      addingPresetIds: new Set(['tr-TR-Chirp3-HD-Ada']),
      voiceSlotInfo: { preset: { used: 2, limit: 3, canCreate: true, message: null }, clone: null },
    });
    await renderScreen();
    const row = screen.getByTestId('narrator-tr-TR-Chirp3-HD-Ada');
    expect(within(row).getByText(/Eklendi/)).toBeOnTheScreen();
    expect(screen.queryByTestId('narrator-plus-tr-TR-Chirp3-HD-Ada')).toBeNull();
    expect(screen.queryByTestId('narrator-adding-tr-TR-Chirp3-HD-Ada')).toBeNull();
    // Not removable until the profile exists; the sample still plays.
    expect(screen.queryByTestId('narrator-remove-tr-TR-Chirp3-HD-Ada')).toBeNull();
    expect(screen.getByTestId('narrator-preview-tr-TR-Chirp3-HD-Ada')).toBeOnTheScreen();
    expect(screen.getByTestId('catalogue-hint')).toHaveTextContent(/2\/3/);
  });

  it('colours each narrator by its voice, the same as on the Sesim tab and in the sheet', async () => {
    mockVoiceStore = makeStore({ voiceProfiles: [added('Deniz')] });
    renderWithProviders(<NarratorCatalogueScreen />, { theme: 'orman' });
    await act(async () => undefined);
    const T = themes.orman;
    const colour = (testID: string) =>
      flatStyle(screen.getByTestId(`narrator-avatar-${testID}-tile`, { includeHiddenElements: true }))
        .backgroundColor;
    expect(colour('tr-TR-Chirp3-HD-Ada')).toBe(T.cat[narratorAvatarSlotFor('tr-TR-Chirp3-HD-Ada')].color);
    expect(colour('vp-Deniz')).toBe(T.cat[narratorAvatarSlotFor('tr-TR-Chirp3-HD-Deniz')].color);
    // The added row keeps the gender its catalogue entry gives.
    expect(within(screen.getByTestId('narrator-vp-Deniz')).getByText('Eklendi, Türkçe, kadın sesi')).toBeOnTheScreen();
  });

  it('drops the language code on a list of one language', async () => {
    mockContentLanguage.languages = [{ code: 'tr' }];
    await renderScreen();
    expect(screen.queryByTestId('catalogue-language-filter')).toBeNull();
    expect(screen.queryByTestId('narrator-code-tr-TR-Chirp3-HD-Ada')).toBeNull();
  });

  it('shows the codes next to a filter of several languages', async () => {
    await renderScreen();
    expect(screen.getByTestId('narrator-code-tr-TR-Chirp3-HD-Ada')).toHaveTextContent('TR');
  });

  it('plays a sample without adding the narrator', async () => {
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Bora örneğini dinle' }));
    });
    expect(VoiceProfileService.previewVoice).toHaveBeenCalledWith('tr-TR-Chirp3-HD-Bora', 'GOOGLE');
    expect(mockAudioPlayer.playFromUrl).toHaveBeenCalledWith('https://x/preview.mp3', expect.anything());
    expect(mockVoiceStore.createVoiceProfile).not.toHaveBeenCalled();
  });

  it('leaving stops the sample it started, and only that one', async () => {
    mockAudioPlayer.playFromUrl.mockImplementation(((_url: string, meta?: { key?: string }) => {
      mockAudioPlayer.source = 'sample';
      mockAudioPlayer.sampleKey = meta?.key ?? null;
      mockAudioPlayer.isPlaying = true;
      return Promise.resolve();
    }) as never);
    mockAudioPlayer.stopPreview.mockClear();
    try {
      const view = await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Bora örneğini dinle' }));
      });
      expect(screen.getByRole('button', { name: 'Bora örneğini durdur' })).toBeOnTheScreen();
      const key = mockAudioPlayer.sampleKey;
      mockAudioPlayer.stopPreview.mockClear();
      view.unmount();
      expect(mockAudioPlayer.stopPreview).toHaveBeenCalledWith(key);
      expect(mockAudioPlayer.stopAndCleanup).not.toHaveBeenCalled();
    } finally {
      mockAudioPlayer.playFromUrl.mockImplementation((() => Promise.resolve()) as never);
      Object.assign(mockAudioPlayer, { source: 'none', sampleKey: null, isPlaying: false });
    }
  });

  it('says how full the list of narrators is, and asks for the places when they are not known', async () => {
    await renderScreen();
    expect(mockVoiceStore.loadVoiceSlots).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('catalogue-hint')).toHaveTextContent('Bir anlatıcıya dokununca listene eklenir.');
  });

  it('a full list says so before a tap is refused', async () => {
    mockVoiceStore = makeStore({
      voiceSlotInfo: { preset: { used: 3, limit: 3, canCreate: false, message: null } },
    });
    await renderScreen();
    expect(mockVoiceStore.loadVoiceSlots).not.toHaveBeenCalled();
    expect(screen.getByTestId('catalogue-hint')).toHaveTextContent(
      'Bir anlatıcıya dokununca listene eklenir. Listen dolu (3/3). Yeni bir anlatıcı için önce birini kaldır.',
    );
  });

  it('says so when a language has no ready-made narrator', async () => {
    mockVoiceStore = makeStore({ catalogueFor: jest.fn(() => []) });
    await renderScreen();
    expect(screen.getByText('Anlatıcı yok')).toBeOnTheScreen();
    expect(screen.getByText('Türkçe hazır anlatıcı henüz yok.')).toBeOnTheScreen();
  });
});
