/**
 * VoiceProfilesScreen: the "Sesim" tab and the "VoiceProfiles" stack screen
 * (design/v4/playful, frame e).
 *
 * Covers the own-voice section (card, add card, slot checks, delete and
 * retry dialogs, sample playback, a recording that never arrived), the
 * ready-made narrators (order, add, plan gate, added narrators, preview,
 * stable places and colours), "Tümü" (opens the full catalogue screen), the
 * loading skeletons and the catalogue error, and the rules a sample follows
 * next to a story: nothing here stops a story, a story replacing a sample
 * resets its card, and the screen never re-renders for the player position.
 * Stores are plain mocks; the audio mock keeps the store's sample contract
 * (`sampleKey`, `playFromUrl`, `stopPreview`).
 */

import React from 'react';
import { configure as configureMobx, observable as mockObservable, runInAction } from 'mobx';
import { ScrollView } from 'react-native';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { AvailableGoogleVoice, VoiceProfile } from '../../models/VoiceProfile';
import { TTSProvider, VoiceProfileStatus } from '../../types/enums';
import { showToast } from '../../utils/toast';
import VoiceProfileService from '../../services/VoiceProfileService';
import { narratorAvatarSlotFor } from '../../components/voice/narratorRows';
import {
  OWN_VOICE_COUNT_KEY,
  rememberOwnVoiceCount,
  resetOwnVoiceMemoryForTests,
} from '../../components/voice/ownVoiceMemory';
import { setSessionUserId } from '../../stores/session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VoiceProfilesScreen } from './VoiceProfilesScreen';
import { OWN_VOICE_SLOT_HEIGHT } from '../../components/voice/VoiceCards';
import type { PaletteKey } from '../../theme/palettes';

// Cold-cache first renders can exceed the 5 s default (see the other
// voice screen tests).
jest.setTimeout(60000);

// The tests set fields of the mocked player directly.
configureMobx({ enforceActions: 'never' });

// --- Mocks ---

interface DialogButton {
  text: string;
  style?: string;
  onPress?: () => void | Promise<void>;
}
interface DialogCall {
  title: string;
  message?: string;
  buttons?: DialogButton[];
}

interface VoiceStoreMock {
  voiceProfiles: VoiceProfile[];
  isLoading: boolean;
  hasLoadedProfiles: boolean;
  isLoadingVoices: boolean;
  cloneConfig: { targetSeconds: number; enabled: boolean } | null;
  canCreateClone: boolean;
  voiceSlotInfo: unknown;
  loadVoiceProfiles: jest.Mock;
  loadAvailableVoices: jest.Mock;
  loadCloneConfig: jest.Mock;
  catalogueFor: jest.Mock;
  catalogueErrorFor: jest.Mock;
  loadVoiceSlots: jest.Mock;
  checkCanCreate: jest.Mock;
  slotBlock: jest.Mock;
  createVoiceProfile: jest.Mock;
  getVoiceSample: jest.Mock;
  deleteVoiceProfile: jest.Mock;
  isAddingPreset: jest.Mock;
  /** The real store adds the adds and removals on their way; here the snapshot. */
  readonly presetSlots: unknown;
}

let mockVoiceStore: VoiceStoreMock;
let mockPlanId: 'free' | 'mini' | 'premium' = 'free';
let mockUsage: unknown = null;
let mockFirstName = 'Deniz';
// Every render of the screen body asks for the voice store (twice: the
// screen and useAddNarrator), so this counts the screen's renders.
const mockRenders = { count: 0 };
const mockShowDialog = jest.fn();

type Source = 'none' | 'story' | 'sample';
// Observable, like the real store: the screen follows changes made in a test.
const mockAudioPlayer = mockObservable(
  {
    source: 'none' as Source,
    sampleKey: null as string | null,
    isPlaying: false,
    isPlayingStory: false,
    storyEnded: false,
    showMiniPlayer: false,
    currentPositionMs: 0,
    totalDurationMs: 0,
    previewPending: false,
    previewFailed: false,
    acknowledgePreviewFailure: jest.fn(),
    stopAndCleanup: jest.fn(() => Promise.resolve()),
    stopPreview: jest.fn((_key?: string) => Promise.resolve()),
    pause: jest.fn(() => Promise.resolve()),
    playFromUrl: jest.fn((_url: string, _meta?: { key?: string; title?: string }) => Promise.resolve()),
  },
  {
    acknowledgePreviewFailure: false,
    stopAndCleanup: false,
    stopPreview: false,
    pause: false,
    playFromUrl: false,
  },
);

/** The store's sample contract: a sample replaces whatever is in the player. */
function startSampleInStore(meta?: { key?: string }, durationMs = 0) {
  runInAction(() => {
    mockAudioPlayer.source = 'sample';
    mockAudioPlayer.sampleKey = meta?.key ?? null;
    mockAudioPlayer.isPlayingStory = false;
    mockAudioPlayer.isPlaying = true;
    mockAudioPlayer.currentPositionMs = 0;
    mockAudioPlayer.totalDurationMs = durationMs;
  });
}

/** `stopPreview(key?)`: only a sample (with a key, only that one) stops. */
function stopSampleInStore(key?: string) {
  if (mockAudioPlayer.source !== 'sample') return;
  if (key !== undefined && key !== mockAudioPlayer.sampleKey) return;
  runInAction(() => {
    mockAudioPlayer.source = 'none';
    mockAudioPlayer.sampleKey = null;
    mockAudioPlayer.isPlaying = false;
    mockAudioPlayer.totalDurationMs = 0;
    mockAudioPlayer.currentPositionMs = 0;
  });
}

/** A story is loaded and plays (from the mini player, the library...). */
function playStoryInStore(durationMs = 845000) {
  runInAction(() => {
    mockAudioPlayer.source = 'story';
    mockAudioPlayer.sampleKey = null;
    mockAudioPlayer.isPlayingStory = true;
    mockAudioPlayer.isPlaying = true;
    mockAudioPlayer.showMiniPlayer = true;
    mockAudioPlayer.totalDurationMs = durationMs;
    mockAudioPlayer.currentPositionMs = 60000;
  });
}

// The top bar bell asks for the unread count (components/common/TopBarAccount).
const mockGetUnreadCount = jest.fn(() => Promise.resolve(0));
jest.mock('../../services/NotificationService', () => ({
  __esModule: true,
  default: { getUnreadCount: () => mockGetUnreadCount() },
}));
// "Masal dili" and the enabled content languages (the narrator filter).
const mockContentLanguage = {
  effective: 'tr',
  languages: [] as { code: string }[],
  // The real store falls back to the effective language the same way.
  get selectable(): string {
    return this.effective;
  },
  nativeName: (code: string) =>
    ({ tr: 'Türkçe', en: 'English', ru: 'Русский' })[code] ?? code.toUpperCase(),
  load: jest.fn(() => Promise.resolve()),
};
jest.mock('../../hooks/useContentLanguage', () => ({
  ...jest.requireActual('../../hooks/useContentLanguage'),
  useContentLanguage: () => mockContentLanguage,
}));
jest.mock('../../hooks/useVoiceProfile', () => ({
  useVoiceProfile: () => {
    mockRenders.count += 1;
    return mockVoiceStore;
  },
}));
jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ backendUser: { firstName: mockFirstName }, user: null }),
}));
jest.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => mockAudioPlayer,
}));
const mockLoadUsage = jest.fn(() => Promise.resolve());
const mockLoadUsageIfStale = jest.fn(() => Promise.resolve());
const mockLoadUsageSoon = jest.fn();
jest.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => ({
    planId: mockPlanId,
    isPaid: mockPlanId !== 'free',
    isPremiumPlan: mockPlanId === 'premium',
    usage: mockUsage,
    loadUsage: mockLoadUsage,
    loadUsageIfStale: mockLoadUsageIfStale,
    loadUsageSoon: mockLoadUsageSoon,
  }),
}));
jest.mock('../../hooks/useDialog', () => ({
  useDialog: () => ({ showDialog: mockShowDialog, hideDialog: jest.fn() }),
}));
jest.mock('../../services/VoiceProfileService', () => ({
  __esModule: true,
  default: { previewVoice: jest.fn(() => Promise.resolve(null)) },
}));
jest.mock('../../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

const mockNav = {
  navigate: jest.fn(),
  goBack: jest.fn(),
};
let mockRoute: { key: string; name: string; params?: Record<string, unknown> };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => mockRoute,
  useScrollToTop: jest.fn(),
  // Focused while mounted: unmounting the screen is leaving it.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react') as typeof React;
    useEffect(effect, [effect]);
  },
}));

// --- Fixtures ---

function preset(name: string): AvailableGoogleVoice {
  const voiceId = `tr-TR-Chirp3-HD-${name}`;
  return {
    id: voiceId,
    voiceId,
    name,
    language: 'tr-TR',
    languageCode: 'tr-TR',
    contentLanguage: 'tr',
    gender: 'female',
    description: '',
    provider: 'GOOGLE',
  };
}

// Backend order, which the list keeps.
const BACKEND_PRESETS = [preset('Ada'), preset('Cem'), preset('Bora'), preset('Deniz')];
const PRESET_NAME = /^(Ada|Bora|Cem|Deniz)$/;

function cloneProfile(patch: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id: 'vp-1',
    name: 'Annem',
    status: VoiceProfileStatus.READY,
    provider: TTSProvider.CARTESIA,
    voiceId: 'cartesia-1',
    language: 'tr',
    contentLanguage: 'tr',
    sampleAudioUrl: null,
    errorMessage: null,
    voiceModelId: null,
    kind: 'CLONE',
    consentAt: null,
    createdAt: new Date(2026, 9, 12, 10, 0, 0),
    updatedAt: new Date(2026, 9, 12, 10, 0, 0),
    ...patch,
  };
}

function addedPreset(name = 'Cem'): VoiceProfile {
  return cloneProfile({
    id: `vp-${name.toLowerCase()}`,
    name,
    kind: 'PRESET',
    provider: TTSProvider.GOOGLE,
    voiceId: `tr-TR-Chirp3-HD-${name}`,
    language: 'tr-TR',
  });
}

/** GET /voice-profiles/slots with the clone place and its creations. */
function slotInfo(clone: Record<string, unknown>) {
  return {
    used: 1,
    limit: 1,
    available: 0,
    plan: 'FREE',
    canCreate: false,
    message: null,
    preset: null,
    clone: { used: 1, limit: 1, canCreate: false, message: null, monthlyCreated: null, monthlyLimit: null, creations: null, ...clone },
  };
}

function makeVoiceStore(overrides: Partial<VoiceStoreMock> = {}): VoiceStoreMock {
  const store = {
    voiceProfiles: [],
    isLoading: false,
    hasLoadedProfiles: true,
    isLoadingVoices: false,
    cloneConfig: null,
    canCreateClone: true,
    voiceSlotInfo: null,
    loadVoiceProfiles: jest.fn(() => Promise.resolve()),
    loadAvailableVoices: jest.fn(() => Promise.resolve()),
    loadCloneConfig: jest.fn(() => Promise.resolve(null)),
    catalogueFor: jest.fn(() => BACKEND_PRESETS),
    catalogueErrorFor: jest.fn(() => null),
    loadVoiceSlots: jest.fn(() => Promise.resolve()),
    checkCanCreate: jest.fn(() => Promise.resolve(true)),
    slotBlock: jest.fn(() => ({ title: 'Hak doldu', message: 'Açıklama', showPaywall: true })),
    createVoiceProfile: jest.fn(() =>
      Promise.resolve({ profile: { id: 'vp-new' }, error: null }),
    ),
    getVoiceSample: jest.fn(() => Promise.resolve(null)),
    deleteVoiceProfile: jest.fn(() => Promise.resolve(true)),
    isAddingPreset: jest.fn(() => false),
    ...overrides,
  };
  // A getter on the object itself (a spread would copy its value once).
  Object.defineProperty(store, 'presetSlots', {
    enumerable: true,
    get: () => (store.voiceSlotInfo as { preset?: unknown } | null)?.preset ?? null,
  });
  return store as VoiceStoreMock;
}

async function renderScreen(theme: PaletteKey = 'gece-mavisi') {
  const utils = renderWithProviders(<VoiceProfilesScreen />, { theme });
  await act(async () => undefined);
  return utils;
}

const presetNames = () =>
  screen.getAllByText(PRESET_NAME).map(el => el.props.children as string);

const lastDialog = (): DialogCall =>
  mockShowDialog.mock.calls[mockShowDialog.mock.calls.length - 1][0] as DialogCall;

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

/** The test ids of the narrator rows, in order. */
const narratorRowIds = () =>
  screen
    .getAllByTestId(/^narrator-(tr-TR-Chirp3-HD-[A-Za-z]+|vp-[a-z]+)$/)
    .map(node => node.props.testID as string);

const TAB_ROUTE = { key: 'voices-tab', name: 'Voices', params: undefined };
const STACK_ROUTE = { key: 'vp-stack', name: 'VoiceProfiles', params: undefined };

type HostNode = ReturnType<typeof screen.getByTestId>;

/** The nearest host (native view) descendants of a node. */
function hostChildren(node: HostNode): HostNode[] {
  const out: HostNode[] = [];
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    if (typeof child.type === 'string') out.push(child);
    else out.push(...hostChildren(child));
  }
  return out;
}

/**
 * A column layout model of a rendered block, one line per text: fixed and
 * minimum heights, paddings, margins and gaps, a row as tall as its tallest
 * child, absolute layers left out (as in voice.test.tsx).
 */
function blockHeight(node: HostNode): number {
  const style = flatStyle(node);
  if (style.position === 'absolute') return 0;
  const marginTop = style.marginTop ?? style.marginVertical ?? style.margin ?? 0;
  const marginBottom = style.marginBottom ?? style.marginVertical ?? style.margin ?? 0;
  let box: number;
  if (typeof style.height === 'number') {
    box = style.height;
  } else {
    const padTop = style.paddingTop ?? style.paddingVertical ?? style.padding ?? 0;
    const padBottom = style.paddingBottom ?? style.paddingVertical ?? style.padding ?? 0;
    let content: number;
    if (node.type === 'Text') {
      content = style.lineHeight ?? style.fontSize ?? 0;
    } else {
      const kids = hostChildren(node).filter(kid => flatStyle(kid).position !== 'absolute');
      const heights = kids.map(blockHeight);
      content =
        style.flexDirection === 'row'
          ? Math.max(0, ...heights)
          : heights.reduce((sum, height) => sum + height, 0) +
            (style.rowGap ?? style.gap ?? 0) * Math.max(0, kids.length - 1);
    }
    box = Math.max(style.minHeight ?? 0, padTop + content + padBottom);
  }
  return marginTop + box + marginBottom;
}

const layoutEvent = (y: number) => ({
  nativeEvent: { layout: { x: 0, y, width: 360, height: 600 } },
});

afterEach(() => {
  setSessionUserId(null);
  resetOwnVoiceMemoryForTests();
});

beforeEach(() => {
  mockPlanId = 'free';
  mockUsage = null;
  mockFirstName = 'Deniz';
  mockRoute = TAB_ROUTE;
  mockVoiceStore = makeVoiceStore();
  mockShowDialog.mockReset();
  mockLoadUsage.mockClear();
  mockLoadUsageIfStale.mockClear();
  mockLoadUsageSoon.mockClear();
  mockNav.navigate.mockReset();
  mockNav.goBack.mockReset();
  runInAction(() => {
    Object.assign(mockAudioPlayer, {
      source: 'none',
      sampleKey: null,
      isPlaying: false,
      isPlayingStory: false,
      storyEnded: false,
      showMiniPlayer: false,
      currentPositionMs: 0,
      totalDurationMs: 0,
      previewPending: false,
      previewFailed: false,
    });
  });
  mockContentLanguage.effective = 'tr';
  mockContentLanguage.languages = [];
  mockAudioPlayer.acknowledgePreviewFailure.mockReset();
  mockAudioPlayer.stopAndCleanup.mockReset();
  mockAudioPlayer.pause.mockReset();
  mockAudioPlayer.stopPreview.mockReset();
  mockAudioPlayer.stopPreview.mockImplementation(key => {
    stopSampleInStore(key);
    return Promise.resolve();
  });
  mockAudioPlayer.playFromUrl.mockReset();
  mockAudioPlayer.playFromUrl.mockImplementation((_url, meta) => {
    startSampleInStore(meta);
    return Promise.resolve();
  });
  (showToast.success as jest.Mock).mockReset();
  (showToast.error as jest.Mock).mockReset();
  (VoiceProfileService.previewVoice as jest.Mock).mockImplementation(() => Promise.resolve(null));
});

describe('VoiceProfilesScreen', () => {
  describe('ready-made narrator order', () => {
    it.each(['free', 'premium'] as const)('keeps the backend order and locks nothing (%s plan)', async plan => {
      mockPlanId = plan;
      await renderScreen();
      expect(presetNames()).toEqual(['Ada', 'Cem', 'Bora', 'Deniz']);
      expect(screen.queryByLabelText('Ücretsiz planda kapalı')).toBeNull();
      expect(screen.queryByTestId('icon-lock', { includeHiddenElements: true })).toBeNull();
    });

    it('shows the language and the gender in one line and no plan or tier badges', async () => {
      await renderScreen();
      expect(screen.getAllByText('Türkçe, kadın sesi')).toHaveLength(4);
      expect(screen.queryByText(/Premium|Ücretsiz$|Standart|Yüksek kalite|HD|Chirp/)).toBeNull();
    });

    it('asks for the narrators of the content language ("Masal dili")', async () => {
      mockContentLanguage.effective = 'en';
      mockVoiceStore = makeVoiceStore({ catalogueFor: jest.fn(() => null) });
      await renderScreen();
      expect(mockContentLanguage.load).toHaveBeenCalled();
      expect(mockVoiceStore.catalogueFor).toHaveBeenCalledWith('en');
      expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledWith('en');
    });

    it('does not ask again for a language whose narrators are already loaded', async () => {
      await renderScreen();
      expect(mockVoiceStore.loadAvailableVoices).not.toHaveBeenCalled();
    });
  });

  describe('as the Voices tab', () => {
    it('shows the tab app bar with a Turkish-cased initial and no back button', async () => {
      mockFirstName = 'irem';
      await renderScreen();

      expect(screen.getByRole('header', { name: 'Sesim' })).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Geri' })).toBeNull();
      expect(screen.getByText('İ')).toBeOnTheScreen();
      expect(screen.getByText('Bir anlatıcıya dokununca listene eklenir.')).toBeOnTheScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Profil' }));
      expect(mockNav.navigate.mock.calls.at(-1)?.[0]).toBe('Profile');
    });

    it('loads profiles, narrators, slots and the clone config on mount', async () => {
      mockVoiceStore = makeVoiceStore({ catalogueFor: jest.fn(() => null) });
      await renderScreen();
      expect(mockVoiceStore.loadVoiceProfiles).toHaveBeenCalledTimes(1);
      expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledTimes(1);
      expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledWith('tr');
      expect(mockVoiceStore.loadVoiceSlots).toHaveBeenCalledTimes(1);
      // Whether cloning is open, in the language the flow will ask in.
      expect(mockVoiceStore.loadCloneConfig).toHaveBeenCalledWith('tr');
    });

    it('does not ask for the clone config again when it is loaded', async () => {
      mockVoiceStore = makeVoiceStore({ cloneConfig: { targetSeconds: 30, enabled: true } });
      await renderScreen();
      expect(mockVoiceStore.loadCloneConfig).not.toHaveBeenCalled();
    });

    it('pull to refresh reloads all three', async () => {
      mockVoiceStore = makeVoiceStore({ voiceProfiles: [cloneProfile()] });
      const { UNSAFE_getByType } = await renderScreen();
      await act(async () => {
        await UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh();
      });
      expect(mockVoiceStore.loadVoiceProfiles).toHaveBeenCalledTimes(1);
      expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledTimes(1);
      expect(mockVoiceStore.loadAvailableVoices).toHaveBeenLastCalledWith('tr');
      expect(mockVoiceStore.loadVoiceSlots).toHaveBeenCalledTimes(2);
    });

    it('holds the own-voice place with a skeleton until the first list load settled', async () => {
      mockVoiceStore = makeVoiceStore({ hasLoadedProfiles: false, isLoading: true });
      await renderScreen();
      const skeleton = screen.getByTestId('voices-loading');
      expect(skeleton.props.accessibilityLabel).toBe('Sesler yükleniyor...');
      expect(skeleton.props.accessibilityState).toEqual({ busy: true });
      expect(screen.queryByTestId('own-voice-add-slot')).toBeNull();
    });

    it("a cold load holds the own place with the slots' skeleton, and the slots take it in place", async () => {
      // Observable, like the real store: the screen follows the list arriving.
      const base = makeVoiceStore({ hasLoadedProfiles: false, isLoading: true });
      const plain = Object.fromEntries(
        Object.entries(base)
          .filter(([, value]) => typeof value === 'function')
          .map(([key]) => [key, false]),
      );
      mockVoiceStore = mockObservable(base, plain as never);
      await renderScreen();
      // Most accounts have no own voice: the skeleton is the "Ses ekle" row's alone.
      expect(screen.getByTestId('own-voice-add-skeleton', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.queryByTestId('own-voice-slot-skeleton', { includeHiddenElements: true })).toBeNull();
      const slot = () => screen.getByTestId('voices-own', { includeHiddenElements: true });
      const presets = () => screen.getByTestId('voice-presets-section');
      // The native layout of the skeleton (the model's height of it).
      const skeletonHeight = blockHeight(slot());
      act(() => {
        fireEvent(screen.getByTestId('voices-own-skeleton'), 'layout', {
          nativeEvent: { layout: { x: 0, y: 0, width: 320, height: skeletonHeight } },
        });
      });
      const presetsMargin = flatStyle(presets()).marginTop;
      // "Hazır anlatıcılar" follows the own-voice section directly in the list.
      const section = screen.getByTestId('voices-own-section');
      let parent = section.parent;
      while (parent && typeof parent.type !== 'string') parent = parent.parent;
      const siblings = hostChildren(parent as HostNode);
      expect(siblings.indexOf(presets())).toBe(siblings.indexOf(section) + 1);

      // The list arrives: the slots mount under the fading skeleton, at once.
      act(() => {
        runInAction(() => {
          mockVoiceStore.hasLoadedProfiles = true;
          mockVoiceStore.isLoading = false;
        });
      });
      expect(screen.getByTestId('own-voice-add-slot')).toBeOnTheScreen();
      expect(screen.getByTestId('voices-own-skeleton', { includeHiddenElements: true })).toBeTruthy();
      expect(blockHeight(slot())).toBe(skeletonHeight);
      expect(flatStyle(presets()).marginTop).toBe(presetsMargin);
      // A tap during the swap lands on the real row.
      fireEvent.press(screen.getByTestId('own-voice-add-slot'));
      expect(mockNav.navigate).toHaveBeenCalledWith('CreateVoiceProfile');

      // The fade ends: the slots alone, the same height, the narrators where they were.
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      expect(screen.queryByTestId('voices-own-skeleton', { includeHiddenElements: true })).toBeNull();
      expect(blockHeight(slot())).toBe(skeletonHeight);
      expect(flatStyle(presets()).marginTop).toBe(presetsMargin);
    });

    it('an account that had own voices gets a slot skeleton for each, then the "Ses ekle" row\'s', async () => {
      setSessionUserId('u-own');
      rememberOwnVoiceCount('u-own', 2);
      mockVoiceStore = makeVoiceStore({ hasLoadedProfiles: false, isLoading: true });
      await renderScreen();
      expect(screen.getAllByTestId('own-voice-slot-skeleton', { includeHiddenElements: true })).toHaveLength(2);
      expect(screen.getByTestId('own-voice-add-skeleton', { includeHiddenElements: true })).toBeTruthy();
    });

    it('reads the remembered count from the device on a cold load, per account', async () => {
      await AsyncStorage.setItem(`${OWN_VOICE_COUNT_KEY}u-stored`, '1');
      setSessionUserId('u-stored');
      mockVoiceStore = makeVoiceStore({ hasLoadedProfiles: false, isLoading: true });
      await renderScreen();
      expect(screen.getAllByTestId('own-voice-slot-skeleton', { includeHiddenElements: true })).toHaveLength(1);
      await AsyncStorage.removeItem(`${OWN_VOICE_COUNT_KEY}u-stored`);
    });

    it('remembers how many own voices the account has once the list is loaded', async () => {
      setSessionUserId('u-count');
      mockVoiceStore = makeVoiceStore({ voiceProfiles: [cloneProfile(), addedPreset('Cem')] });
      await renderScreen();
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(`${OWN_VOICE_COUNT_KEY}u-count`, '1');
      await AsyncStorage.removeItem(`${OWN_VOICE_COUNT_KEY}u-count`);
    });

    it('a later load or a change never turns the slots back into a skeleton', async () => {
      mockVoiceStore = makeVoiceStore({ hasLoadedProfiles: true, isLoading: true, voiceProfiles: [] });
      await renderScreen();
      expect(screen.getByTestId('own-voice-add-slot')).toBeOnTheScreen();
      expect(screen.queryByTestId('voices-loading')).toBeNull();
    });

    it('holds the narrator place with row skeletons while the catalogue loads', async () => {
      mockVoiceStore = makeVoiceStore({ catalogueFor: jest.fn(() => null) });
      await renderScreen();
      expect(screen.getByTestId('narrators-loading').props.accessibilityLabel).toBe(
        'Anlatıcılar yükleniyor...',
      );
      // Not loaded yet is not a failure: no error sentence in the meantime.
      expect(screen.queryByTestId('narrators-empty')).toBeNull();
      expect(screen.queryByText(/yüklenemedi/)).toBeNull();
    });

    it('no error flash on a language chip switch', async () => {
      mockContentLanguage.languages = [{ code: 'tr' }, { code: 'en' }];
      mockVoiceStore = makeVoiceStore({
        catalogueFor: jest.fn((language: string) => (language === 'tr' ? BACKEND_PRESETS : null)),
      });
      await renderScreen();
      fireEvent.press(screen.getByRole('radio', { name: 'English' }));
      expect(screen.getByTestId('narrators-loading')).toBeOnTheScreen();
      expect(screen.queryByTestId('narrators-empty')).toBeNull();
      expect(screen.queryByTestId('narrators-error')).toBeNull();
      await waitFor(() => expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledWith('en'));
    });

    it('a catalogue that could not be loaded says so and its retry asks again', async () => {
      mockVoiceStore = makeVoiceStore({
        catalogueFor: jest.fn(() => null),
        catalogueErrorFor: jest.fn(() => 'Anlatıcılar yüklenemedi'),
      });
      await renderScreen();
      expect(screen.queryByTestId('narrators-loading')).toBeNull();
      expect(
        within(screen.getByTestId('narrators-error')).getByText(
          'Hazır anlatıcılar şu an yüklenemedi. Aşağı çekip yenile.',
        ),
      ).toBeOnTheScreen();
      mockVoiceStore.loadAvailableVoices.mockClear();
      fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
      expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledWith('tr');
    });

    it('a pull to refresh after a failed catalogue shows the row skeletons, not an error flash', async () => {
      let error: string | null = 'Anlatıcılar yüklenemedi';
      mockVoiceStore = makeVoiceStore({
        catalogueFor: jest.fn(() => null),
        catalogueErrorFor: jest.fn(() => error),
        // The store forgets the old error when it asks again.
        loadAvailableVoices: jest.fn(() => {
          error = null;
          return new Promise<void>(() => undefined);
        }),
      });
      const { UNSAFE_getByType } = await renderScreen();
      expect(screen.getByTestId('narrators-error')).toBeOnTheScreen();
      act(() => {
        void UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh();
      });
      expect(screen.getByTestId('narrators-loading')).toBeOnTheScreen();
      expect(screen.queryByTestId('narrators-empty')).toBeNull();
      expect(screen.queryByText(/yüklenemedi/)).toBeNull();
    });

    it('adds a usable narrator without leaving the screen', async () => {
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: 'Cem anlatıcısını ekle' }));

      await waitFor(() => expect(showToast.success).toHaveBeenCalledWith('Anlatıcı eklendi'));
      expect(mockVoiceStore.checkCanCreate).toHaveBeenCalledWith('preset');
      expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledWith({
        name: 'Cem',
        provider: TTSProvider.GOOGLE,
        voiceId: 'tr-TR-Chirp3-HD-Cem',
        language: 'tr-TR',
      });
      expect(mockNav.goBack).not.toHaveBeenCalled();
    });

    it('the hint says how many narrators the list holds, before a tap is refused', async () => {
      mockVoiceStore = makeVoiceStore({
        voiceSlotInfo: { preset: { used: 1, limit: 3, canCreate: true, message: null }, clone: null },
      });
      await renderScreen();
      expect(screen.getByTestId('narrators-hint')).toHaveTextContent(
        'Bir anlatıcıya dokununca listene eklenir. Listende 1/3 anlatıcı var.',
      );
    });

    it('a narrator being added is busy, and a second tap adds nothing', async () => {
      let finish: (value: unknown) => void = () => undefined;
      mockVoiceStore = makeVoiceStore({
        createVoiceProfile: jest.fn(
          () => new Promise(resolve => {
            finish = resolve;
          }),
        ),
      });
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Cem anlatıcısını ekle' }));
      });
      const row = screen.getByRole('button', { name: 'Cem anlatıcısını ekle' });
      expect(row).toBeDisabled();
      // The add spins in the plus's place; the sample button stays a play button (V5-04).
      expect(within(row).getByTestId('narrator-adding-tr-TR-Chirp3-HD-Cem')).toBeOnTheScreen();
      const sample = screen.getByRole('button', { name: 'Cem örneğini dinle' });
      expect(sample).toBeEnabled();
      expect(within(sample).queryByTestId('spinner-indicator')).toBeNull();
      fireEvent.press(row);
      await act(async () => {
        finish({ profile: { id: 'vp-new' }, error: null });
      });
      expect(screen.queryByTestId('narrator-adding-tr-TR-Chirp3-HD-Cem')).toBeNull();
      expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Cem anlatıcısını ekle' })).toBeEnabled();
    });

    it('explains a full preset allowance instead of adding', async () => {
      mockVoiceStore = makeVoiceStore({ checkCanCreate: jest.fn(() => Promise.resolve(false)) });
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: 'Cem anlatıcısını ekle' }));

      await waitFor(() => expect(mockShowDialog).toHaveBeenCalledTimes(1));
      expect(mockVoiceStore.slotBlock).toHaveBeenCalledWith('preset', 'free');
      expect(lastDialog().title).toBe('Hak doldu');
      lastDialog().buttons?.find(b => b.text === 'Planları gör')?.onPress?.();
      expect(mockNav.navigate).toHaveBeenCalledWith('Subscription', { reason: 'voices' }, { pop: true });
      expect(mockVoiceStore.createVoiceProfile).not.toHaveBeenCalled();
    });

    it('shows the backend message when adding is refused', async () => {
      mockVoiceStore = makeVoiceStore({
        createVoiceProfile: jest.fn(() =>
          Promise.resolve({ profile: null, error: new Error('Sunucu hatası') }),
        ),
      });
      await renderScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Cem anlatıcısını ekle' }));
      await waitFor(() => expect(showToast.error).toHaveBeenCalledTimes(1));
      expect(showToast.success).not.toHaveBeenCalled();
    });

    it('never auto-scrolls', async () => {
      const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
      await renderScreen();

      fireEvent(screen.getByTestId('voice-presets-section'), 'layout', layoutEvent(400));

      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('plays a catalogue preview under its own sample key, without adding the narrator', async () => {
      (VoiceProfileService.previewVoice as jest.Mock).mockResolvedValue({ audioUrl: 'https://x/p.mp3' });
      await renderScreen();

      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Cem örneğini dinle' }));
      });
      expect(VoiceProfileService.previewVoice).toHaveBeenCalledWith('tr-TR-Chirp3-HD-Cem', 'GOOGLE');
      expect(mockAudioPlayer.playFromUrl).toHaveBeenCalledWith('https://x/p.mp3', {
        key: 'sesim:preset:tr-TR-Chirp3-HD-Cem',
        title: 'Cem',
      });
      expect(screen.getByRole('button', { name: 'Cem örneğini durdur' })).toBeOnTheScreen();
      // Previewing does not add the narrator.
      expect(mockVoiceStore.createVoiceProfile).not.toHaveBeenCalled();
    });

    it('reports a preview that cannot be fetched', async () => {
      (VoiceProfileService.previewVoice as jest.Mock).mockRejectedValue(new Error('500'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Cem örneğini dinle' }));
      });
      expect(showToast.error).toHaveBeenCalledWith('Örnek oynatılamadı');
      // The button is a play button again, not a spinner or a pause icon.
      expect(screen.getByRole('button', { name: 'Cem örneğini dinle' })).toBeEnabled();
    });

    it('says so when the catalogue has no sample for a narrator', async () => {
      (VoiceProfileService.previewVoice as jest.Mock).mockResolvedValue({ audioUrl: null });
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Cem örneğini dinle' }));
      });
      expect(showToast.error).toHaveBeenCalledWith('Ses örneği bulunamadı');
      expect(mockAudioPlayer.playFromUrl).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Cem örneğini dinle' })).toBeEnabled();
    });

    it('shows a spinner until the sample sounds, then stop', async () => {
      (VoiceProfileService.previewVoice as jest.Mock).mockResolvedValue({ audioUrl: 'https://x/p.mp3' });
      mockAudioPlayer.playFromUrl.mockImplementation((_url, meta) => {
        // Handed to the player; nothing sounds yet.
        startSampleInStore(meta);
        runInAction(() => {
          mockAudioPlayer.previewPending = true;
        });
        return Promise.resolve();
      });
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Cem örneğini dinle' }));
      });
      expect(screen.getByRole('button', { name: 'Cem örneğini dinle' })).toBeDisabled();

      act(() => {
        runInAction(() => {
          mockAudioPlayer.previewPending = false;
        });
      });
      expect(screen.getByRole('button', { name: 'Cem örneğini durdur' })).toBeEnabled();
    });

    it('a sample the player cannot start resets its button (never stuck)', async () => {
      (VoiceProfileService.previewVoice as jest.Mock).mockResolvedValue({ audioUrl: 'https://x/broken.mp3' });
      mockAudioPlayer.playFromUrl.mockImplementation((_url, meta) => {
        startSampleInStore(meta);
        runInAction(() => {
          mockAudioPlayer.previewPending = true;
        });
        return Promise.resolve();
      });
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Cem örneğini dinle' }));
      });
      expect(screen.getByRole('button', { name: 'Cem örneğini dinle' })).toBeDisabled();

      // The store's watchdog gives up: it shows the message and leaves the sample.
      await act(async () => {
        runInAction(() => {
          mockAudioPlayer.previewPending = false;
          mockAudioPlayer.previewFailed = true;
          mockAudioPlayer.source = 'none';
          mockAudioPlayer.sampleKey = null;
          mockAudioPlayer.isPlaying = false;
        });
      });
      expect(mockAudioPlayer.acknowledgePreviewFailure).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Cem örneğini dinle' })).toBeEnabled();
    });

    it('a failed sample of another screen is not acknowledged here', async () => {
      await renderScreen();
      await act(async () => {
        runInAction(() => {
          mockAudioPlayer.previewFailed = true;
        });
      });
      expect(mockAudioPlayer.acknowledgePreviewFailure).not.toHaveBeenCalled();
    });

    it('nor one that replaced a sample of this screen, nor a sample that simply ended', async () => {
      (VoiceProfileService.previewVoice as jest.Mock).mockResolvedValue({ audioUrl: 'https://x/p.mp3' });
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Cem örneğini dinle' }));
      });
      // It ends: nothing failed.
      await act(async () => {
        stopSampleInStore();
      });
      expect(mockAudioPlayer.acknowledgePreviewFailure).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Cem örneğini dinle' }));
      });
      // The story detail's sheet plays its own sample over it, which fails.
      await act(async () => {
        startSampleInStore({ key: 'detail:vp-9' });
      });
      await act(async () => {
        runInAction(() => {
          mockAudioPlayer.previewFailed = true;
          mockAudioPlayer.sampleKey = null;
          mockAudioPlayer.source = 'none';
        });
      });
      expect(mockAudioPlayer.acknowledgePreviewFailure).not.toHaveBeenCalled();
    });

    it('a second tap that is answered first wins over a slower first fetch', async () => {
      let answerAda: (value: { audioUrl: string }) => void = () => undefined;
      (VoiceProfileService.previewVoice as jest.Mock).mockImplementation((voiceId: string) =>
        voiceId.endsWith('Ada')
          ? new Promise(resolve => {
              answerAda = resolve;
            })
          : Promise.resolve({ audioUrl: 'https://x/cem.mp3' }),
      );
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Ada örneğini dinle' }));
      });
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Cem örneğini dinle' }));
      });
      await act(async () => {
        answerAda({ audioUrl: 'https://x/ada.mp3' });
      });
      expect(mockAudioPlayer.playFromUrl).toHaveBeenCalledTimes(1);
      expect(mockAudioPlayer.playFromUrl).toHaveBeenCalledWith('https://x/cem.mp3', expect.anything());
      expect(screen.getByRole('button', { name: 'Ada örneğini dinle' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Cem örneğini durdur' })).toBeOnTheScreen();
    });
  });

  describe('next to a playing story', () => {
    const MANY = ['Ada', 'Bora', 'Cem', 'Deniz', 'Ece', 'Fatma', 'Gül', 'Hale'].map(preset);

    it('Tümünü gör while a story plays does not stop it', async () => {
      mockVoiceStore = makeVoiceStore({ catalogueFor: jest.fn(() => MANY) });
      playStoryInStore();
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Hazır anlatıcılar, tümünü gör' }));
      });
      expect(mockNav.navigate).toHaveBeenCalledWith('NarratorCatalogue', { language: 'tr' });
      expect(mockAudioPlayer.stopAndCleanup).not.toHaveBeenCalled();
      expect(mockAudioPlayer.stopPreview).not.toHaveBeenCalled();
      expect(mockAudioPlayer.pause).not.toHaveBeenCalled();
      expect(mockAudioPlayer.isPlayingStory && mockAudioPlayer.isPlaying).toBe(true);
    });

    it('adding a narrator while a story plays does not stop it', async () => {
      playStoryInStore();
      await renderScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Cem anlatıcısını ekle' }));
      await waitFor(() => expect(showToast.success).toHaveBeenCalledWith('Anlatıcı eklendi'));
      expect(mockAudioPlayer.stopAndCleanup).not.toHaveBeenCalled();
      expect(mockAudioPlayer.stopPreview).not.toHaveBeenCalled();
      expect(mockAudioPlayer.pause).not.toHaveBeenCalled();
      expect(mockAudioPlayer.isPlayingStory && mockAudioPlayer.isPlaying).toBe(true);
    });

    it('a sample over a playing story goes through the store, which pauses the story; nothing unloads it', async () => {
      (VoiceProfileService.previewVoice as jest.Mock).mockResolvedValue({ audioUrl: 'https://x/p.mp3' });
      playStoryInStore();
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Cem örneğini dinle' }));
      });
      expect(mockAudioPlayer.playFromUrl).toHaveBeenCalledTimes(1);
      expect(mockAudioPlayer.stopAndCleanup).not.toHaveBeenCalled();
      // A stop of the screen's own sample never reaches the story.
      expect(mockAudioPlayer.stopPreview.mock.calls.every(call => call[0] === undefined)).toBe(true);
    });

    it('a story finishing does not reset this screen\'s buttons', async () => {
      (VoiceProfileService.previewVoice as jest.Mock).mockResolvedValue({ audioUrl: 'https://x/p.mp3' });
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Cem örneğini dinle' }));
      });
      expect(screen.getByRole('button', { name: 'Cem örneğini durdur' })).toBeOnTheScreen();
      // A story's end elsewhere changes nothing here: no stop, no reset.
      const stops = mockAudioPlayer.stopPreview.mock.calls.length;
      await act(async () => {
        runInAction(() => {
          mockAudioPlayer.storyEnded = true;
        });
      });
      expect(screen.getByRole('button', { name: 'Cem örneğini durdur' })).toBeOnTheScreen();
      expect(mockAudioPlayer.stopPreview).toHaveBeenCalledTimes(stops);
    });

    it('a story replacing a sample resets the card to play and keeps the sample length', async () => {
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [cloneProfile()],
        getVoiceSample: jest.fn(() => Promise.resolve('https://x/sample.wav')),
      });
      mockAudioPlayer.playFromUrl.mockImplementation((_url, meta) => {
        startSampleInStore(meta, 12000);
        return Promise.resolve();
      });
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Annem örneğini dinle' }));
      });
      expect(screen.getByRole('button', { name: 'Annem örneğini durdur' })).toBeOnTheScreen();
      expect(screen.getByText('Türkçe, 12 Ekim kaydı, 0:12')).toBeOnTheScreen();

      // A story starts from the mini player or the library.
      await act(async () => {
        playStoryInStore(845000);
      });
      expect(screen.getByRole('button', { name: 'Annem örneğini dinle' })).toBeOnTheScreen();
      // The story's length is never taken for the sample's.
      expect(screen.queryByText(/14:05/)).toBeNull();
      expect(screen.getByText('Türkçe, 12 Ekim kaydı, 0:12')).toBeOnTheScreen();
    });

    it('the screen body does not re-render on position updates while a story plays', async () => {
      mockVoiceStore = makeVoiceStore({ voiceProfiles: [cloneProfile(), addedPreset()] });
      playStoryInStore();
      await renderScreen();
      const before = mockRenders.count;
      for (const ms of [61000, 61500, 62000, 62500, 63000]) {
        await act(async () => {
          runInAction(() => {
            mockAudioPlayer.currentPositionMs = ms;
          });
        });
      }
      expect(mockRenders.count).toBe(before);
    });

    it('while its own sample plays, the screen does not re-render on position reports', async () => {
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [cloneProfile()],
        getVoiceSample: jest.fn(() => Promise.resolve('https://x/sample.wav')),
      });
      mockAudioPlayer.playFromUrl.mockImplementation((_url, meta) => {
        startSampleInStore(meta, 12000);
        return Promise.resolve();
      });
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Annem örneğini dinle' }));
      });
      const before = mockRenders.count;
      for (const ms of [3000, 6000, 9000]) {
        await act(async () => {
          runInAction(() => {
            mockAudioPlayer.currentPositionMs = ms;
          });
        });
      }
      expect(mockRenders.count).toBe(before);
      expect(screen.getByRole('button', { name: 'Annem örneğini durdur' })).toBeOnTheScreen();
    });

    it('leaving the tab stops a sample of this screen, never a story', async () => {
      (VoiceProfileService.previewVoice as jest.Mock).mockResolvedValue({ audioUrl: 'https://x/p.mp3' });
      const { unmount } = await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Cem örneğini dinle' }));
      });
      mockAudioPlayer.stopPreview.mockClear();
      unmount();
      expect(mockAudioPlayer.stopPreview).toHaveBeenCalledWith('sesim:preset:tr-TR-Chirp3-HD-Cem');

      // With a story in the player, leaving touches nothing.
      playStoryInStore();
      const second = await renderScreen();
      mockAudioPlayer.stopPreview.mockClear();
      second.unmount();
      expect(mockAudioPlayer.stopPreview).not.toHaveBeenCalled();
      expect(mockAudioPlayer.stopAndCleanup).not.toHaveBeenCalled();
    });

    it('a sample still on its way when the user leaves never starts', async () => {
      let answer: (value: { audioUrl: string }) => void = () => undefined;
      (VoiceProfileService.previewVoice as jest.Mock).mockImplementation(
        () => new Promise(resolve => {
          answer = resolve;
        }),
      );
      const { unmount } = await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Cem örneğini dinle' }));
      });
      unmount();
      await act(async () => {
        answer({ audioUrl: 'https://x/p.mp3' });
      });
      expect(mockAudioPlayer.playFromUrl).not.toHaveBeenCalled();
      expect(mockAudioPlayer.sampleKey).toBeNull();
    });

    it('a sample the player was still taking when the user left is stopped once it is in', async () => {
      (VoiceProfileService.previewVoice as jest.Mock).mockResolvedValue({ audioUrl: 'https://x/p.mp3' });
      let take: () => void = () => undefined;
      mockAudioPlayer.playFromUrl.mockImplementation(
        (_url, meta) =>
          new Promise<void>(resolve => {
            take = () => {
              startSampleInStore(meta);
              resolve();
            };
          }),
      );
      playStoryInStore();
      const { unmount } = await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Cem örneğini dinle' }));
      });
      expect(mockAudioPlayer.playFromUrl).toHaveBeenCalledTimes(1);
      unmount();
      await act(async () => {
        take();
      });
      expect(mockAudioPlayer.stopPreview).toHaveBeenLastCalledWith('sesim:preset:tr-TR-Chirp3-HD-Cem');
      expect(mockAudioPlayer.sampleKey).toBeNull();
      expect(mockAudioPlayer.stopAndCleanup).not.toHaveBeenCalled();
    });

    it('leaves room for the mini player at the end of the tab', async () => {
      const { UNSAFE_getByType } = await renderScreen();
      const padding = () =>
        flatStyle({ props: { style: UNSAFE_getByType(ScrollView).props.contentContainerStyle } })
          .paddingBottom as number;
      const without = padding();
      await act(async () => {
        playStoryInStore();
      });
      expect(padding()).toBeGreaterThan(without);
    });
  });

  describe('own voices as slots (owner feedback: stop promoting cloning)', () => {
    /** GET /usage with the own-voice numbers of a plan. */
    function usage(
      plan: 'FREE' | 'MINI' | 'PRO',
      {
        held,
        slots,
        created,
        limit,
        period,
        renewsAt = null,
      }: {
        held: number;
        slots: number;
        created: number;
        limit: number;
        period: 'month' | 'lifetime';
        renewsAt?: Date | null;
      },
    ) {
      return {
        planId: plan === 'FREE' ? 'free' : plan === 'MINI' ? 'mini' : 'premium',
        buckets: {
          presetNarrations: { limit: 20, used: 0, remaining: 20, period: 'month', renewsAt: null },
          cloneNarrations: { limit: 1, used: 0, remaining: 1, period: 'lifetime', renewsAt: null },
          cloneCreations: { limit, used: created, remaining: Math.max(0, limit - created), period, renewsAt },
        },
        voiceSlots: { preset: { used: 0, limit: 3 }, clone: { used: held, limit: slots } },
        features: { backgroundPlayback: plan !== 'FREE', premiumStories: plan !== 'FREE' },
      };
    }
    const clones = (n: number) =>
      Array.from({ length: n }, (_, i) => cloneProfile({ id: `vp-${i + 1}`, name: `Ses ${i + 1}` }));
    const value = (id: 'slots' | 'creations') => screen.getByTestId(`own-voice-limits-${id}-value`);
    const addSlot = () => screen.getByTestId('own-voice-add-slot');

    it('has no hero card and no big "Yeni ses" button, with or without a voice', async () => {
      const empty = await renderScreen();
      expect(screen.queryByText('Kendi sesini ekle')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Sesimi kaydet' })).toBeNull();
      expect(screen.queryByText('Yeni ses kaydet')).toBeNull();
      empty.unmount();

      mockPlanId = 'premium';
      mockVoiceStore = makeVoiceStore({ voiceProfiles: [cloneProfile()] });
      await renderScreen();
      expect(screen.queryByText('Yeni ses kaydet')).toBeNull();
      expect(screen.queryByTestId('own-voice-record-new-vp-1')).toBeNull();
      // The free room is the one modest dashed row.
      expect(flatStyle(hostChildren(screen.getByTestId('own-voice-add-slot'))[0])).toMatchObject({
        borderStyle: 'dashed',
      });
    });

    it('free plan without a voice: "Ses yuvası 0/1", "Toplam yeni ses hakkı 0/1", and "Ses ekle" opens the flow', async () => {
      mockUsage = usage('FREE', { held: 0, slots: 1, created: 0, limit: 1, period: 'lifetime' });
      await renderScreen();
      expect(screen.getByText('Kendi seslerin')).toBeOnTheScreen();
      expect(screen.getByText('Ses yuvası')).toBeOnTheScreen();
      expect(value('slots')).toHaveTextContent('0/1');
      // "Toplam" on the free plan: its one new voice never renews.
      expect(screen.getByText('Toplam yeni ses hakkı')).toBeOnTheScreen();
      expect(value('creations')).toHaveTextContent('0/1');
      expect(screen.getByTestId('own-voice-limits-caption')).toHaveTextContent(
        'Bu hak yenilenmez. Bir sesi silmek yeni ses hakkını geri vermez.',
      );
      expect(screen.getByTestId('own-voice-limits-slots').props.accessibilityLabel).toBe(
        'Ses yuvası, 1 yuvadan 0 tanesi dolu',
      );

      fireEvent.press(screen.getByRole('button', { name: 'Ses ekle, Yaklaşık 30 saniyelik bir kayıt yeterli.' }));
      // No wait for the network: the intro checks the slots before recording.
      expect(mockNav.navigate).toHaveBeenCalledWith('CreateVoiceProfile');
      expect(mockVoiceStore.checkCanCreate).not.toHaveBeenCalled();
    });

    it('Premium with one voice: "Ses yuvası 1/3", "Bu ay yeni ses hakkı 2/5" with the renewal day', async () => {
      mockPlanId = 'premium';
      mockUsage = usage('PRO', {
        held: 1,
        slots: 3,
        created: 2,
        limit: 5,
        period: 'month',
        renewsAt: new Date(2026, 10, 1),
      });
      mockVoiceStore = makeVoiceStore({ voiceProfiles: [cloneProfile()] });
      await renderScreen();
      expect(value('slots')).toHaveTextContent('1/3');
      expect(screen.getByText('Bu ay yeni ses hakkı')).toBeOnTheScreen();
      expect(value('creations')).toHaveTextContent('2/5');
      expect(screen.getByTestId('own-voice-limits-creations').props.accessibilityLabel).toBe(
        'Bu ay yeni ses hakkı, 5 haktan 2 tanesi kullanıldı',
      );
      expect(screen.getByTestId('own-voice-limits-caption')).toHaveTextContent(
        "1 Kasım'da yenilenir. Bir sesi silmek yeni ses hakkını geri vermez.",
      );
      // Bars filled to the use: a third of the slots, two fifths of the new voices.
      expect(screen.getByTestId('own-voice-limits-slots-bar').props.accessibilityValue.now).toBe(33);
      expect(screen.getByTestId('own-voice-limits-creations-bar').props.accessibilityValue.now).toBe(40);
      // The free room says what a recording takes.
      expect(within(addSlot()).getByText('Ses ekle')).toBeOnTheScreen();
      expect(screen.getByTestId('own-voice-add-hint')).toHaveTextContent('Yaklaşık 30 saniyelik bir kayıt yeterli.');
    });

    it('the slots follow the list on screen: a delete frees its slot at once', async () => {
      let answer: (deleted: boolean) => void = () => undefined;
      mockPlanId = 'premium';
      mockUsage = usage('PRO', { held: 2, slots: 3, created: 2, limit: 5, period: 'month' });
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: clones(2),
        deleteVoiceProfile: jest.fn(
          () => new Promise<boolean>(resolve => {
            answer = resolve;
          }),
        ),
      });
      await renderScreen();
      expect(value('slots')).toHaveTextContent('2/3');
      fireEvent.press(screen.getByRole('button', { name: 'Ses 1 sesini sil' }));
      await act(async () => {
        lastDialog().buttons?.[1].onPress?.();
      });
      expect(value('slots')).toHaveTextContent('1/3');
      // A delete never gives a new voice back.
      expect(value('creations')).toHaveTextContent('2/5');
      await act(async () => {
        answer(true);
      });
      // The backend counts again a moment later.
      expect(mockLoadUsageSoon).toHaveBeenCalledTimes(1);
    });

    it('a failed voice takes no slot, as the backend counts', async () => {
      mockUsage = usage('FREE', { held: 0, slots: 1, created: 0, limit: 1, period: 'lifetime' });
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [cloneProfile({ status: VoiceProfileStatus.FAILED })],
      });
      await renderScreen();
      expect(value('slots')).toHaveTextContent('0/1');
      expect(screen.getByTestId('own-voice-vp-1')).toBeOnTheScreen();
      expect(screen.getByTestId('own-voice-add-hint')).toBeOnTheScreen();
    });

    it('without GET /usage, the numbers come from the slots answer, then from the plan', async () => {
      mockPlanId = 'mini';
      mockVoiceStore = makeVoiceStore({
        voiceSlotInfo: slotInfo({
          used: 0,
          limit: 1,
          canCreate: true,
          creations: { used: 1, limit: 2, period: 'month', renewsAt: null, canCreate: true },
        }),
      });
      const fromSlots = await renderScreen();
      expect(value('slots')).toHaveTextContent('0/1');
      expect(value('creations')).toHaveTextContent('1/2');
      fromSlots.unmount();

      mockVoiceStore = makeVoiceStore();
      await renderScreen();
      // Mini: one slot, two new voices a month; the use is not known yet.
      expect(value('slots')).toHaveTextContent('0/1');
      expect(value('creations')).toHaveTextContent('2 hak');
    });

    it('asks for fresh numbers on the tab and on a pull to refresh', async () => {
      await renderScreen();
      expect(mockLoadUsageIfStale).toHaveBeenCalled();
      const scroll = screen.UNSAFE_getByType(ScrollView);
      await act(async () => {
        await scroll.props.refreshControl.props.onRefresh();
      });
      expect(mockLoadUsage).toHaveBeenCalledTimes(1);
    });

    it('slots full on the free plan: the slot says why and links to the plans, never the flow', async () => {
      mockUsage = usage('FREE', { held: 1, slots: 1, created: 1, limit: 1, period: 'lifetime' });
      mockVoiceStore = makeVoiceStore({ voiceProfiles: [cloneProfile()], canCreateClone: false });
      await renderScreen();
      expect(value('slots')).toHaveTextContent('1/1');
      expect(screen.getByTestId('own-voice-add-block')).toHaveTextContent('Ses yuvaların dolu.');
      // The row itself opens nothing.
      expect(addSlot().props.onPress).toBeUndefined();
      expect(screen.queryByRole('button', { name: /^Ses ekle, Yaklaşık/ })).toBeNull();
      fireEvent.press(screen.getByRole('button', { name: 'Planları gör' }));
      expect(mockNav.navigate).toHaveBeenCalledWith('Subscription', { reason: 'voices' }, { pop: true });
      expect(mockNav.navigate).not.toHaveBeenCalledWith('CreateVoiceProfile');
    });

    it("new voices used up this month with a slot free: the slot says so with the renewal, and Mini sees the plans", async () => {
      mockPlanId = 'mini';
      mockUsage = usage('MINI', {
        held: 0,
        slots: 1,
        created: 2,
        limit: 2,
        period: 'month',
        renewsAt: new Date(2026, 10, 1),
      });
      await renderScreen();
      expect(screen.getByTestId('own-voice-add-block')).toHaveTextContent(
        "Bu ayki yeni ses hakkın bitti. 1 Kasım'da yenilenir.",
      );
      expect(screen.getByRole('button', { name: 'Planları gör' })).toBeOnTheScreen();
    });

    it('the free plan whose one new voice is used: it never renews', async () => {
      mockUsage = usage('FREE', { held: 0, slots: 1, created: 1, limit: 1, period: 'lifetime' });
      await renderScreen();
      expect(screen.getByTestId('own-voice-add-block')).toHaveTextContent(
        'Yeni ses hakkını kullandın, bu hak yenilenmez.',
      );
      expect(value('creations')).toHaveTextContent('1/1');
    });

    it('Premium with its slots full: the way is a delete, no plans to offer', async () => {
      mockPlanId = 'premium';
      mockUsage = usage('PRO', { held: 3, slots: 3, created: 3, limit: 5, period: 'month' });
      mockVoiceStore = makeVoiceStore({ voiceProfiles: clones(3) });
      await renderScreen();
      expect(screen.getByTestId('own-voice-add-block')).toHaveTextContent(
        'Ses yuvaların dolu. Yeni bir ses için önce birini sil.',
      );
      expect(screen.queryByRole('button', { name: 'Planları gör' })).toBeNull();
    });

    it('a slots answer that refuses for another reason gets the plain line', async () => {
      mockPlanId = 'premium';
      mockVoiceStore = makeVoiceStore({ canCreateClone: false });
      await renderScreen();
      expect(screen.getByTestId('own-voice-add-block')).toHaveTextContent('Şu an yeni bir kendi ses kaydedemezsin.');
      expect(screen.queryByRole('button', { name: 'Planları gör' })).toBeNull();
    });

    it('closed cloning: the slot says so, with no plans (a bigger plan does not open it)', async () => {
      mockVoiceStore = makeVoiceStore({ cloneConfig: { targetSeconds: 30, enabled: false } });
      await renderScreen();
      expect(screen.getByTestId('own-voice-add-block')).toHaveTextContent(
        'Kendi sesinle masal kısa bir süre kullanılamıyor. Biraz sonra tekrar dene.',
      );
      expect(screen.queryByRole('button', { name: 'Planları gör' })).toBeNull();
    });

    it('uses the served recording length on the "Ses ekle" row', async () => {
      mockPlanId = 'premium';
      mockVoiceStore = makeVoiceStore({ cloneConfig: { targetSeconds: 24.2, enabled: true } });
      await renderScreen();
      expect(screen.getByTestId('own-voice-add-hint')).toHaveTextContent('Yaklaşık 25 saniyelik bir kayıt yeterli.');
      expect(screen.queryByText(/Ücretsiz planda/)).toBeNull();
    });

    it.each([1, 2, 3, 4, 5])(
      '%i voices: one compact slot each in the list, then the one "Ses ekle" or full row',
      async n => {
        mockPlanId = 'premium';
        mockUsage = usage('PRO', { held: n, slots: 5, created: n, limit: 10, period: 'month' });
        mockVoiceStore = makeVoiceStore({ voiceProfiles: clones(n) });
        await renderScreen();
        const list = screen.getByTestId('own-voice-slots');
        const rows = hostChildren(list).map(node => String(node.props.testID));
        expect(rows).toEqual([...clones(n).map(profile => `own-voice-${profile.id}`), 'own-voice-add-slot']);
        // Each slot is a row card: a face of the slot height, 20dp corners on a 3dp lip.
        clones(n).forEach(profile => {
          expect(flatStyle(screen.getByTestId(`own-voice-${profile.id}-face`))).toMatchObject({
            minHeight: OWN_VOICE_SLOT_HEIGHT,
            borderRadius: 20,
          });
          expect(blockHeight(screen.getByTestId(`own-voice-${profile.id}`))).toBe(OWN_VOICE_SLOT_HEIGHT + 3);
        });
        // Five voices and the free row stay well under the 228dp a hero card took per voice.
        expect(blockHeight(list)).toBeLessThan(n * 228);
        // Only the first ready one is the default.
        expect(screen.getAllByText('Varsayılan')).toHaveLength(1);
        expect(within(screen.getByTestId('own-voice-vp-1')).getByText('Varsayılan')).toBeOnTheScreen();
      },
    );

    it('a filled slot: the name, the language and the day, the sample button and delete', async () => {
      mockVoiceStore = makeVoiceStore({ voiceProfiles: [cloneProfile()] });
      await renderScreen();
      const slot = within(screen.getByTestId('own-voice-vp-1'));
      expect(slot.getByText('Annem')).toBeOnTheScreen();
      // The ready state needs no tag; the default one says so.
      expect(slot.queryByText('Hazır')).toBeNull();
      expect(slot.getByText('Varsayılan')).toBeOnTheScreen();
      expect(slot.getByText('Türkçe, 12 Ekim kaydı')).toBeOnTheScreen();
      // No length before the sample was played: the profile carries none.
      expect(slot.queryByText(/\d+:\d\d/)).toBeNull();
      expect(slot.getByRole('button', { name: 'Annem örneğini dinle' })).toBeOnTheScreen();
      expect(slot.getByRole('button', { name: 'Annem sesini sil' })).toBeOnTheScreen();
    });

    it('asks before deleting and says that a delete gives no new voice back', async () => {
      mockVoiceStore = makeVoiceStore({ voiceProfiles: [cloneProfile()] });
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: 'Annem sesini sil' }));

      const dialog = lastDialog();
      expect(dialog.title).toBe('Annem sesi silinsin mi?');
      // The allowance is not known: only that a delete gives nothing back.
      expect(dialog.message).toBe(
        'Kaydın ve ondan oluşturulan ses kalıcı olarak silinir. Geri alınamaz. Silmek, kullandığın yeni ses hakkını geri vermez.',
      );
      expect(dialog.buttons?.map(b => [b.text, b.style])).toEqual([
        ['Vazgeç', 'cancel'],
        ['Sesi sil', 'destructive'],
      ]);
      expect(mockVoiceStore.deleteVoiceProfile).not.toHaveBeenCalled();

      await act(async () => {
        await dialog.buttons?.[1].onPress?.();
      });
      expect(mockVoiceStore.deleteVoiceProfile).toHaveBeenCalledWith('vp-1');
      expect(showToast.success).toHaveBeenCalledWith('Ses silindi');
    });

    it('deleting the only lifetime clone: no refund and no way to record again', async () => {
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [cloneProfile()],
        canCreateClone: false,
        voiceSlotInfo: slotInfo({
          creations: { used: 1, limit: 1, period: 'lifetime', renewsAt: null, canCreate: false },
        }),
      });
      await renderScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Annem sesini sil' }));
      expect(lastDialog().message).toBe(
        'Kaydın ve ondan oluşturulan ses kalıcı olarak silinir. Geri alınamaz. Silmek, kullandığın yeni ses hakkını geri vermez. Hiç yeni ses hakkın kalmadı, silersen yeniden kaydedemezsin.',
      );
      // A lifetime allowance never speaks of a month.
      expect(lastDialog().message).not.toMatch(/\bay\b/i);
      expect(mockVoiceStore.deleteVoiceProfile).not.toHaveBeenCalled();
    });

    it('the dialog reads GET /usage first: no refund, and how many new voices are left this month', async () => {
      mockPlanId = 'premium';
      mockUsage = usage('PRO', { held: 1, slots: 3, created: 2, limit: 5, period: 'month' });
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [cloneProfile()],
        // An older slots answer that says otherwise loses.
        voiceSlotInfo: slotInfo({
          creations: { used: 0, limit: 5, period: 'month', renewsAt: null, canCreate: true },
        }),
      });
      await renderScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Annem sesini sil' }));
      expect(lastDialog().message).toBe(
        'Kaydın ve ondan oluşturulan ses kalıcı olarak silinir. Geri alınamaz. Silmek, kullandığın yeni ses hakkını geri vermez. Bu ay 3 yeni ses hakkın kaldı.',
      );
    });

    it('a delete hides the slot at once and restores it on failure', async () => {
      let answer: (deleted: boolean) => void = () => undefined;
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [cloneProfile()],
        deleteVoiceProfile: jest.fn(
          () => new Promise<boolean>(resolve => {
            answer = resolve;
          }),
        ),
      });
      await renderScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Annem sesini sil' }));
      await act(async () => {
        lastDialog().buttons?.[1].onPress?.();
      });
      // Gone while the request runs; the free slot shows at once.
      expect(screen.queryByTestId('own-voice-vp-1')).toBeNull();
      expect(screen.getByTestId('own-voice-add-hint')).toBeOnTheScreen();

      // The store refused (it has shown why): the slot comes back.
      await act(async () => {
        answer(false);
      });
      expect(screen.getByTestId('own-voice-vp-1')).toBeOnTheScreen();
      expect(showToast.success).not.toHaveBeenCalled();
      expect(mockLoadUsageSoon).not.toHaveBeenCalled();
    });

    it('a start-over whose place is still taken explains it instead of opening the flow', async () => {
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [cloneProfile({ status: VoiceProfileStatus.FAILED })],
        checkCanCreate: jest.fn(() => Promise.resolve(false)),
      });
      await renderScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
      await act(async () => {
        await lastDialog().buttons?.find(b => b.text === 'Sil ve baştan başla')?.onPress?.();
      });
      expect(mockVoiceStore.slotBlock).toHaveBeenCalledWith('clone', 'free');
      expect(lastDialog().title).toBe('Hak doldu');
      expect(mockNav.navigate).not.toHaveBeenCalledWith('CreateVoiceProfile');
    });

    it('plays the sample from a fresh URL, shows its length, and stops only that sample', async () => {
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [cloneProfile()],
        getVoiceSample: jest.fn(() => Promise.resolve('https://x/sample.wav')),
      });
      mockAudioPlayer.playFromUrl.mockImplementation((_url, meta) => {
        startSampleInStore(meta, 12000);
        return Promise.resolve();
      });
      await renderScreen();

      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Annem örneğini dinle' }));
      });
      expect(mockVoiceStore.getVoiceSample).toHaveBeenCalledWith('vp-1');
      expect(mockAudioPlayer.playFromUrl).toHaveBeenCalledWith('https://x/sample.wav', {
        key: 'sesim:vp-1',
        title: 'Annem',
      });
      expect(screen.getByText('Türkçe, 12 Ekim kaydı, 0:12')).toBeOnTheScreen();

      mockAudioPlayer.stopPreview.mockClear();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Annem örneğini durdur' }));
      });
      expect(mockAudioPlayer.stopPreview).toHaveBeenCalledTimes(1);
      expect(mockAudioPlayer.stopAndCleanup).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Annem örneğini dinle' })).toBeOnTheScreen();
    });

    it('stops the running sample before deleting that voice', async () => {
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [cloneProfile()],
        getVoiceSample: jest.fn(() => Promise.resolve('https://x/sample.wav')),
      });
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Annem örneğini dinle' }));
      });

      fireEvent.press(screen.getByRole('button', { name: 'Annem sesini sil' }));
      await act(async () => {
        await lastDialog().buttons?.[1].onPress?.();
      });
      expect(mockAudioPlayer.stopPreview).toHaveBeenCalledWith('sesim:vp-1');
      expect(mockAudioPlayer.stopAndCleanup).not.toHaveBeenCalled();
      expect(mockVoiceStore.deleteVoiceProfile).toHaveBeenCalledWith('vp-1');
    });

    it('a deleted voice whose sample was still on its way never plays it', async () => {
      let answer: (url: string) => void = () => undefined;
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [cloneProfile()],
        getVoiceSample: jest.fn(
          () => new Promise<string>(resolve => {
            answer = resolve;
          }),
        ),
      });
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Annem örneğini dinle' }));
      });
      fireEvent.press(screen.getByRole('button', { name: 'Annem sesini sil' }));
      await act(async () => {
        await lastDialog().buttons?.[1].onPress?.();
      });
      await act(async () => {
        answer('https://x/sample.wav');
      });
      expect(mockAudioPlayer.playFromUrl).not.toHaveBeenCalled();
    });

    it('says so when the voice has no sample', async () => {
      mockVoiceStore = makeVoiceStore({ voiceProfiles: [cloneProfile()] });
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Annem örneğini dinle' }));
      });
      expect(showToast.error).toHaveBeenCalledWith('Ses örneği bulunamadı');
      expect(mockAudioPlayer.playFromUrl).not.toHaveBeenCalled();
    });

    it('the slot goes back to play when its sample ends, with nothing to acknowledge', async () => {
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [cloneProfile()],
        getVoiceSample: jest.fn(() => Promise.resolve('https://x/sample.wav')),
      });
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Annem örneğini dinle' }));
      });
      expect(screen.getByRole('button', { name: 'Annem örneğini durdur' })).toBeOnTheScreen();
      await act(async () => {
        stopSampleInStore();
      });
      expect(screen.getByRole('button', { name: 'Annem örneğini dinle' })).toBeOnTheScreen();
      expect(mockAudioPlayer.acknowledgePreviewFailure).not.toHaveBeenCalled();
    });

    it('a voice still in preparation has no sample player', async () => {
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [cloneProfile({ status: VoiceProfileStatus.PROCESSING })],
      });
      await renderScreen();
      expect(screen.getByText('Hazırlanıyor')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Annem örneğini dinle' })).toBeNull();
    });

    it('a PENDING profile shows the waiting note and its action retries', async () => {
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [cloneProfile({ status: VoiceProfileStatus.PENDING })],
      });
      await renderScreen();
      expect(screen.getByText('Beklemede')).toBeOnTheScreen();
      expect(screen.queryByText('Hazırlanıyor')).toBeNull();
      expect(screen.getByTestId('own-voice-waiting-vp-1')).toHaveTextContent(
        'Kayıt gönderilemedi. Silip yeniden kaydedebilirsin, bu yeni ses hakkı kullanmaz.',
      );

      fireEvent.press(screen.getByRole('button', { name: 'Baştan başla' }));
      const dialog = lastDialog();
      expect(dialog.title).toBe('Baştan başla');
      expect(dialog.message).toBe('Annem kaydı gönderilemedi. Bu kaydı silip yeniden okuyabilirsin.');
      await act(async () => {
        await dialog.buttons?.find(b => b.text === 'Sil ve baştan başla')?.onPress?.();
      });
      expect(mockVoiceStore.deleteVoiceProfile).toHaveBeenCalledWith('vp-1');
      // The delete freed the place: the slots are asked again, then the flow opens.
      expect(mockVoiceStore.checkCanCreate).toHaveBeenCalledWith('clone');
      expect(mockNav.navigate).toHaveBeenCalledWith('CreateVoiceProfile');
      // A start-over is not a deletion the user asked to hear about.
      expect(showToast.success).not.toHaveBeenCalled();
    });

    it('deleting a PENDING clone warns about nothing it did not use', async () => {
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [cloneProfile({ status: VoiceProfileStatus.PENDING })],
        voiceSlotInfo: slotInfo({
          creations: { used: 1, limit: 1, period: 'lifetime', renewsAt: null, canCreate: false },
        }),
      });
      await renderScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Annem sesini sil' }));
      expect(lastDialog().message).toBe(
        'Kaydın ve ondan oluşturulan ses kalıcı olarak silinir. Geri alınamaz.',
      );
    });

    it('a failed voice gives its reason and is discarded and recorded again through "Tekrar dene"', async () => {
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [
          cloneProfile({ status: VoiceProfileStatus.FAILED, errorMessage: 'Ortam çok gürültülü' }),
        ],
      });
      await renderScreen();
      expect(screen.getByText('Hazırlanamadı')).toBeOnTheScreen();
      expect(screen.getByTestId('own-voice-error-vp-1')).toHaveTextContent('Ortam çok gürültülü');

      fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
      const dialog = lastDialog();
      expect(dialog.title).toBe('Baştan başla');
      expect(dialog.message).toContain('Annem');

      await act(async () => {
        await dialog.buttons?.find(b => b.text === 'Sil ve baştan başla')?.onPress?.();
      });
      expect(mockVoiceStore.deleteVoiceProfile).toHaveBeenCalledWith('vp-1');
      expect(mockNav.navigate).toHaveBeenCalledWith('CreateVoiceProfile');
    });

    it('a failed delete during a start-over does not open the flow', async () => {
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [cloneProfile({ status: VoiceProfileStatus.FAILED })],
        deleteVoiceProfile: jest.fn(() => Promise.resolve(false)),
      });
      await renderScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
      await act(async () => {
        await lastDialog().buttons?.find(b => b.text === 'Sil ve baştan başla')?.onPress?.();
      });
      expect(mockNav.navigate).not.toHaveBeenCalled();
      expect(screen.getByTestId('own-voice-vp-1')).toBeOnTheScreen();
    });
  });

  describe('narrators the user added', () => {
    beforeEach(() => {
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [addedPreset()],
        getVoiceSample: jest.fn(() => Promise.resolve('https://x/cem.mp3')),
      });
    });

    it('lists them first, marked, once, and not under "Senin sesin"', async () => {
      await renderScreen();
      expect(presetNames()).toEqual(['Cem', 'Ada', 'Bora', 'Deniz']);
      expect(screen.getAllByText('Eklendi')).toHaveLength(1);
      // The added row keeps the gender the catalogue gives its voice.
      expect(within(screen.getByTestId('narrator-vp-cem')).getByText('Eklendi, Türkçe, kadın sesi')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Cem anlatıcısını ekle' })).toBeNull();
      // No own voice: the "Ses ekle" row is still there.
      expect(screen.getByTestId('own-voice-add-slot')).toBeOnTheScreen();
    });

    it('removes one after a confirmation with its own wording, hiding it at once', async () => {
      let answer: (deleted: boolean) => void = () => undefined;
      mockVoiceStore.deleteVoiceProfile = jest.fn(
        () => new Promise<boolean>(resolve => {
          answer = resolve;
        }),
      );
      await renderScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Cem anlatıcısını kaldır' }));

      const dialog = lastDialog();
      expect(dialog.title).toBe('Cem kaldırılsın mı?');
      expect(dialog.buttons?.map(b => b.text)).toEqual(['Vazgeç', 'Kaldır']);
      await act(async () => {
        dialog.buttons?.[1].onPress?.();
      });
      expect(mockVoiceStore.deleteVoiceProfile).toHaveBeenCalledWith('vp-cem');
      // Hidden: the narrator is a catalogue row again, at its catalogue place.
      expect(screen.queryByTestId('narrator-vp-cem')).toBeNull();
      expect(presetNames()).toEqual(['Ada', 'Cem', 'Bora', 'Deniz']);
      await act(async () => {
        answer(true);
      });
      expect(showToast.success).toHaveBeenCalledWith('Anlatıcı kaldırıldı', undefined, {
        label: 'Geri al',
        onPress: expect.any(Function),
      });
    });

    it('a removal says so in the frame of the confirm; a refused one gives nothing to undo (VR-04)', async () => {
      let answer: (deleted: boolean) => void = () => undefined;
      mockVoiceStore.deleteVoiceProfile = jest.fn(
        () => new Promise<boolean>(resolve => {
          answer = resolve;
        }),
      );
      await renderScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Cem anlatıcısını kaldır' }));
      act(() => {
        lastDialog().buttons?.[1].onPress?.();
      });
      // Before the backend answered: the row went and the message is up.
      expect(screen.queryByTestId('narrator-vp-cem')).toBeNull();
      expect(showToast.success).toHaveBeenCalledWith('Anlatıcı kaldırıldı', undefined, {
        label: 'Geri al',
        onPress: expect.any(Function),
      });
      const call = (showToast.success as jest.Mock).mock.calls.find(args => args[0] === 'Anlatıcı kaldırıldı');
      const action = call?.[2] as { onPress: () => void };

      // The delete fails: the row is back and "Geri al" adds nothing.
      await act(async () => {
        answer(false);
      });
      expect(screen.getByTestId('narrator-vp-cem')).toBeOnTheScreen();
      await act(async () => {
        action.onPress();
      });
      expect(mockVoiceStore.createVoiceProfile).not.toHaveBeenCalled();
    });

    it('a narrator whose add is on its way is shown as added, with no plus and no spinner (VR-03)', async () => {
      mockVoiceStore = makeVoiceStore({
        isAddingPreset: jest.fn((voiceId: string) => voiceId === preset('Ada').voiceId),
      });
      await renderScreen();
      const row = screen.getByTestId(`narrator-${preset('Ada').voiceId}`);
      expect(within(row).getByText(/Eklendi/)).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Ada anlatıcısını ekle' })).toBeNull();
      expect(screen.queryByTestId(`narrator-adding-${preset('Ada').voiceId}`)).toBeNull();
    });

    it('"Geri al" after a removal adds the same narrator back (V11)', async () => {
      await renderScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Cem anlatıcısını kaldır' }));
      await act(async () => {
        lastDialog().buttons?.[1].onPress?.();
      });
      const call = (showToast.success as jest.Mock).mock.calls.find(args => args[0] === 'Anlatıcı kaldırıldı');
      const action = call?.[2] as { label: string; onPress: () => void };
      expect(action.label).toBe('Geri al');
      // The store dropped the profile with the delete.
      mockVoiceStore.voiceProfiles = mockVoiceStore.voiceProfiles.filter(profile => profile.id !== 'vp-cem');
      await act(async () => {
        action.onPress();
      });
      expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: preset('Cem').voiceId, name: 'Cem' }),
      );
    });

    it('an own voice deleted offers no "Geri al": it cannot come back', async () => {
      mockVoiceStore = makeVoiceStore({ voiceProfiles: [cloneProfile()] });
      await renderScreen();
      fireEvent.press(screen.getByRole('button', { name: /Annem sesini sil/ }));
      await act(async () => {
        lastDialog().buttons?.[1].onPress?.();
      });
      expect(showToast.success).toHaveBeenCalledWith('Ses silindi');
      expect((showToast.success as jest.Mock).mock.calls.every(args => args.length === 1)).toBe(true);
    });

    it('previews one through its profile sample', async () => {
      await renderScreen();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Cem örneğini dinle' }));
      });
      expect(mockVoiceStore.getVoiceSample).toHaveBeenCalledWith('vp-cem');
      expect(VoiceProfileService.previewVoice).not.toHaveBeenCalled();
    });
  });

  describe('a narrator added during the visit', () => {
    it('an added narrator keeps its place and colour during the visit', async () => {
      const store = makeVoiceStore();
      store.createVoiceProfile = jest.fn(() => {
        const profile = addedPreset('Bora');
        store.voiceProfiles = [...store.voiceProfiles, profile];
        return Promise.resolve({ profile, error: null });
      });
      mockVoiceStore = store;
      const view = await renderScreen('orman');
      const T = themes.orman;
      const avatarColour = (testID: string) =>
        flatStyle(screen.getByTestId(`narrator-avatar-${testID}-tile`, { includeHiddenElements: true }))
          .backgroundColor;
      const boraColour = avatarColour('tr-TR-Chirp3-HD-Bora');
      expect(boraColour).toBe(T.cat[narratorAvatarSlotFor('tr-TR-Chirp3-HD-Bora')].color);
      const deniz = avatarColour('tr-TR-Chirp3-HD-Deniz');

      fireEvent.press(screen.getByRole('button', { name: 'Bora anlatıcısını ekle' }));
      await waitFor(() => expect(showToast.success).toHaveBeenCalledWith('Anlatıcı eklendi'));
      // The store changed under the screen: render it with the new list.
      view.rerender(<VoiceProfilesScreen />);

      // Third, where it was, now marked; the neighbours keep their colours.
      expect(narratorRowIds()).toEqual([
        'narrator-tr-TR-Chirp3-HD-Ada',
        'narrator-tr-TR-Chirp3-HD-Cem',
        'narrator-vp-bora',
        'narrator-tr-TR-Chirp3-HD-Deniz',
      ]);
      expect(within(screen.getByTestId('narrator-vp-bora')).getByText('Eklendi, Türkçe, kadın sesi')).toBeOnTheScreen();
      expect(avatarColour('vp-bora')).toBe(boraColour);
      expect(avatarColour('tr-TR-Chirp3-HD-Deniz')).toBe(deniz);

      // The next visit lists it first again.
      view.unmount();
      await renderScreen('orman');
      expect(narratorRowIds()[0]).toBe('narrator-vp-bora');
    });
  });

  describe('pushed as VoiceProfiles', () => {
    it('shows a back app bar', async () => {
      mockRoute = STACK_ROUTE;
      await renderScreen();
      expect(screen.queryByRole('button', { name: 'Profil' })).toBeNull();
      expect(screen.getByText('Sesim')).toBeOnTheScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
      expect(mockNav.goBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('with a language in the route', () => {
    it('lists the narrators of that language, not of "Masal dili"', async () => {
      mockRoute = { key: 'vp-stack', name: 'VoiceProfiles', params: { language: 'en' } };
      mockVoiceStore = makeVoiceStore({ catalogueFor: jest.fn(() => null) });
      await renderScreen();
      expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledWith('en');
    });
  });

  describe('frame e layout', () => {
    it('has the tab title, its sub line, then the own voice and the narrators in that order', async () => {
      mockVoiceStore = makeVoiceStore({ voiceProfiles: [cloneProfile()] });
      await renderScreen();
      const title = screen.getByRole('header', { name: 'Sesim' });
      expect(title).toBeOnTheScreen();
      expect(screen.getByText('Masalları kimin anlatacağını buradan seçersin.')).toBeOnTheScreen();
      expect(screen.getByRole('header', { name: 'Hazır anlatıcılar' })).toBeOnTheScreen();
      // No uppercase section labels, no "Senin sesin" label.
      expect(screen.queryByText('HAZIR ANLATICILAR')).toBeNull();
      expect(screen.queryByText(/Senin sesin/i)).toBeNull();
      expect(screen.getByRole('header', { name: 'Kendi seslerin' })).toBeOnTheScreen();
      // The own voices come before the narrators.
      const order = screen
        .UNSAFE_root.findAll((node: { props: { testID?: unknown } }) => typeof node.props.testID === 'string' && node.props.testID !== '')
        .map((node: { props: { testID?: unknown } }) => node.props.testID as string);
      expect(order.indexOf('own-voice-vp-1')).toBeLessThan(order.indexOf('voice-presets-section'));
    });

    it('the stack instance has no sub line', async () => {
      mockRoute = STACK_ROUTE;
      await renderScreen();
      expect(screen.queryByText('Masalları kimin anlatacağını buradan seçersin.')).toBeNull();
    });

    it('colours each narrator by its voice and shows no language code on a list of one language', async () => {
      await renderScreen('orman');
      const T = themes.orman;
      const avatar = (name: string) =>
        flatStyle(
          screen.getByTestId(`narrator-avatar-tr-TR-Chirp3-HD-${name}-tile`, {
            includeHiddenElements: true,
          }),
        ).backgroundColor;
      for (const name of ['Ada', 'Cem', 'Bora', 'Deniz']) {
        expect(avatar(name)).toBe(T.cat[narratorAvatarSlotFor(`tr-TR-Chirp3-HD-${name}`)].color);
      }
      // "Türkçe, kadın sesi" already says it.
      expect(screen.queryByText('TR')).toBeNull();
    });

    it('shows the language codes once the filter offers several languages', async () => {
      mockContentLanguage.languages = [{ code: 'tr' }, { code: 'en' }];
      await renderScreen();
      expect(screen.getByTestId('narrator-code-tr-TR-Chirp3-HD-Ada')).toHaveTextContent('TR');
    });

    it('only the first ready own voice is the default', async () => {
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [
          cloneProfile({ id: 'vp-0', name: 'Babam', status: VoiceProfileStatus.PROCESSING }),
          cloneProfile(),
          cloneProfile({ id: 'vp-2', name: 'Teyzem' }),
        ],
      });
      await renderScreen();
      expect(screen.getAllByText('Varsayılan')).toHaveLength(1);
      expect(within(screen.getByTestId('own-voice-vp-1')).getByText('Varsayılan')).toBeOnTheScreen();
    });

    it('marks the selected language chip with its code in the action colour', async () => {
      mockContentLanguage.languages = [{ code: 'tr' }, { code: 'en' }];
      await renderScreen('kitaplik');
      const T = themes.kitaplik;
      expect(flatStyle(screen.getByTestId('narrator-language-tr-face')).backgroundColor).toBe(
        T.action,
      );
      expect(flatStyle(screen.getByTestId('narrator-language-en-face')).backgroundColor).toBe(
        T.line,
      );
      expect(
        within(screen.getByTestId('narrator-language-tr-code')).getByText('TR'),
      ).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('narrator-language-en-code')).getByText('EN'),
      ).toBeOnTheScreen();
    });
  });

  describe('"Tümü"', () => {
    const MANY = ['Ada', 'Bora', 'Cem', 'Deniz', 'Ece', 'Fatma', 'Gül', 'Hale'].map(preset);
    const SEE_ALL = 'Hazır anlatıcılar, tümünü gör';

    it('a long list shows six narrators and the link opens all narrators of that language', async () => {
      mockVoiceStore = makeVoiceStore({ catalogueFor: jest.fn(() => MANY) });
      await renderScreen();
      expect(screen.getByTestId('narrator-tr-TR-Chirp3-HD-Fatma')).toBeOnTheScreen();
      expect(screen.queryByTestId('narrator-tr-TR-Chirp3-HD-Gül')).toBeNull();
      // The short shared label, as on Home and story detail (it never clips).
      expect(screen.getByText('Tümü')).toBeOnTheScreen();

      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: SEE_ALL }));
      });

      expect(mockNav.navigate).toHaveBeenCalledWith('NarratorCatalogue', { language: 'tr' });
      // No in-place expansion: the tab keeps its six rows.
      expect(screen.queryByTestId('narrator-tr-TR-Chirp3-HD-Gül')).toBeNull();
    });

    it('opens the list of the language the filter shows', async () => {
      mockContentLanguage.languages = [{ code: 'tr' }, { code: 'en' }];
      mockVoiceStore = makeVoiceStore({ catalogueFor: jest.fn(() => MANY) });
      await renderScreen();
      fireEvent.press(screen.getByRole('radio', { name: 'English' }));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: SEE_ALL }));
      });
      expect(mockNav.navigate).toHaveBeenCalledWith('NarratorCatalogue', { language: 'en' });
    });

    it('is not offered for a short list', async () => {
      await renderScreen();
      expect(screen.queryByRole('button', { name: SEE_ALL })).toBeNull();
    });
  });

  it.each(['gece-mavisi', 'kitaplik', 'erik'] as const)('takes its colours from the %s palette', async scheme => {
    mockVoiceStore = makeVoiceStore({ voiceProfiles: [cloneProfile()] });
    await renderScreen(scheme);
    const T = themes[scheme];
    const title = flatStyle(screen.getByRole('header', { name: 'Sesim' }));
    expect(title).toMatchObject({ color: T.text, fontFamily: T.fontDisplay, fontSize: 32 });
    expect(flatStyle(screen.getByRole('header', { name: 'Hazır anlatıcılar' })).color).toBe(T.text);
    // The own-voice slot is a plain row card like the narrator rows: no
    // gradient or glow, the standard face and lip (owner feedback).
    expect(screen.queryByTestId('own-voice-vp-1-gradient', { includeHiddenElements: true })).toBeNull();
    expect(flatStyle(screen.getByTestId('own-voice-vp-1-face')).backgroundColor).toBe(T.surface);
    expect(flatStyle(screen.getByTestId('own-voice-vp-1-lip')).backgroundColor).toBe(T.lip);
    // The sample button is the neutral circle of the narrator rows.
    expect(flatStyle(screen.getByTestId('own-voice-sample-vp-1-face')).backgroundColor).toBe(
      T.surface2,
    );
    // The dashed "Ses ekle" row (full here: one voice on the free plan) draws in the line colour.
    expect(flatStyle(screen.getByTestId('own-voice-add-slot')).borderColor).toBe(T.line);
    expect(
      flatStyle(screen.getByTestId('narrator-tr-TR-Chirp3-HD-Ada-face')).backgroundColor,
    ).toBe(T.surface);
    expect(
      flatStyle(screen.getByTestId('narrator-preview-tr-TR-Chirp3-HD-Ada-face')).backgroundColor,
    ).toBe(T.surface2);
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    try {
      await renderScreen();
      expect(screen.getByRole('header', { name: 'My voice' })).toBeOnTheScreen();
      expect(screen.getByText('Choose here who tells the stories.')).toBeOnTheScreen();
      expect(screen.getByRole('header', { name: 'Ready-made narrators' })).toBeOnTheScreen();
      expect(screen.getByRole('header', { name: 'Your own voices' })).toBeOnTheScreen();
      expect(screen.getByText('Voice slots')).toBeOnTheScreen();
      expect(screen.getByText('New voices in total')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Add a voice, A recording of about 30 seconds is enough.' })).toBeOnTheScreen();
      // The language of a voice keeps its own name.
      expect(screen.getAllByText('Türkçe, female voice').length).toBeGreaterThan(0);
    } finally {
      await act(() => i18n.changeLanguage('tr'));
    }
  });

  it('writes an English own voice\'s line in English, the date in lower case', async () => {
    mockVoiceStore = makeVoiceStore({
      voiceProfiles: [cloneProfile({ language: 'en-US', contentLanguage: 'en' })],
    });
    await i18n.changeLanguage('en');
    try {
      await renderScreen();
      expect(screen.getByText('English, recorded October 12')).toBeOnTheScreen();
    } finally {
      await act(() => i18n.changeLanguage('tr'));
    }
  });

  describe('voice languages', () => {
    const ENGLISH_PRESETS: AvailableGoogleVoice[] = ['Orus', 'Puck'].map(name => ({
      id: `en-US-Chirp3-HD-${name}`,
      voiceId: `en-US-Chirp3-HD-${name}`,
      name,
      language: 'English',
      languageCode: 'en-US',
      contentLanguage: 'en',
      gender: 'male',
      description: '',
      provider: 'GOOGLE',
    }));
    const cataloguesByLanguage = (extra: Record<string, AvailableGoogleVoice[] | null> = {}) =>
      jest.fn((language: string) => {
        const all: Record<string, AvailableGoogleVoice[] | null> = {
          tr: BACKEND_PRESETS,
          en: ENGLISH_PRESETS,
          ...extra,
        };
        return language in all ? all[language] : null;
      });
    const addedNarrator = (name: string, locale: string, contentLanguage: string) =>
      cloneProfile({
        id: `vp-${name}`,
        name,
        kind: 'PRESET',
        provider: TTSProvider.GOOGLE,
        voiceId: `${locale}-Chirp3-HD-${name}`,
        language: locale,
        contentLanguage,
      });
    const TWO_LANGUAGES = [{ code: 'tr' }, { code: 'en' }];

    it('shows no filter while there is only one content language', async () => {
      mockContentLanguage.languages = [{ code: 'tr' }];
      await renderScreen();
      expect(screen.queryByTestId('narrator-language-filter')).toBeNull();
      expect(presetNames()).toEqual(['Ada', 'Cem', 'Bora', 'Deniz']);
    });

    it('filters the ready-made narrators by language, starting with "Masal dili"', async () => {
      mockContentLanguage.languages = TWO_LANGUAGES;
      mockVoiceStore = makeVoiceStore({ catalogueFor: cataloguesByLanguage() });
      await renderScreen();

      expect(screen.getByTestId('narrator-language-filter').props.accessibilityLabel).toBe(
        'Anlatıcı dili',
      );
      expect(screen.getByRole('radio', { name: 'Türkçe' })).toBeSelected();
      expect(screen.getByRole('radio', { name: 'English' })).not.toBeSelected();
      expect(presetNames()).toEqual(['Ada', 'Cem', 'Bora', 'Deniz']);

      fireEvent.press(screen.getByRole('radio', { name: 'English' }));

      expect(screen.getByRole('radio', { name: 'English' })).toBeSelected();
      expect(screen.queryByText('Ada')).toBeNull();
      expect(screen.getByText('Orus')).toBeOnTheScreen();
      expect(screen.getByText('Puck')).toBeOnTheScreen();
      expect(screen.getAllByText('English, erkek sesi')).toHaveLength(2);
      // Already loaded: not requested again.
      expect(mockVoiceStore.loadAvailableVoices).not.toHaveBeenCalled();
    });

    it('requests the catalogue of a language the first time it is picked', async () => {
      mockContentLanguage.languages = TWO_LANGUAGES;
      mockVoiceStore = makeVoiceStore({ catalogueFor: cataloguesByLanguage({ en: null }) });
      await renderScreen();
      expect(mockVoiceStore.loadAvailableVoices).not.toHaveBeenCalled();

      fireEvent.press(screen.getByRole('radio', { name: 'English' }));
      await waitFor(() => expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledWith('en'));
    });

    it('adds the narrator of the language that is shown', async () => {
      mockContentLanguage.languages = TWO_LANGUAGES;
      mockVoiceStore = makeVoiceStore({ catalogueFor: cataloguesByLanguage() });
      await renderScreen();

      fireEvent.press(screen.getByRole('radio', { name: 'English' }));
      fireEvent.press(screen.getByRole('button', { name: 'Orus anlatıcısını ekle' }));

      await waitFor(() =>
        expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledWith({
          name: 'Orus',
          provider: 'GOOGLE',
          voiceId: 'en-US-Chirp3-HD-Orus',
          language: 'en-US',
        }),
      );
    });

    it('lists an added narrator under its own language only', async () => {
      mockContentLanguage.languages = TWO_LANGUAGES;
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [addedNarrator('Orus', 'en-US', 'en'), addedNarrator('Ada', 'tr-TR', 'tr')],
        catalogueFor: cataloguesByLanguage(),
      });
      await renderScreen();

      // Turkish: Ada is the added row; Orus is not here.
      expect(screen.getByTestId('narrator-vp-Ada')).toBeOnTheScreen();
      expect(screen.queryByTestId('narrator-vp-Orus')).toBeNull();
      expect(
        within(screen.getByTestId('narrator-vp-Ada')).getByText('Eklendi, Türkçe, kadın sesi'),
      ).toBeOnTheScreen();

      fireEvent.press(screen.getByRole('radio', { name: 'English' }));
      expect(screen.getByTestId('narrator-vp-Orus')).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('narrator-vp-Orus')).getByText('Eklendi, English, erkek sesi'),
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('narrator-vp-Ada')).toBeNull();
      // Listed once: as the added row, not again as a catalogue row.
      expect(screen.queryByTestId('narrator-en-US-Chirp3-HD-Orus')).toBeNull();
      expect(screen.getByTestId('narrator-en-US-Chirp3-HD-Puck')).toBeOnTheScreen();
    });

    it('starts on the language of the story the user came from', async () => {
      mockContentLanguage.languages = TWO_LANGUAGES;
      mockRoute = {
        key: 'vp-stack',
        name: 'VoiceProfiles',
        params: { language: 'en-US' },
      };
      mockVoiceStore = makeVoiceStore({ catalogueFor: cataloguesByLanguage() });
      await renderScreen();

      expect(screen.getByRole('radio', { name: 'English' })).toBeSelected();
      expect(screen.getByText('Orus')).toBeOnTheScreen();
    });

    it('says so when a language has no ready-made narrator, and keeps the filter', async () => {
      mockContentLanguage.languages = [...TWO_LANGUAGES, { code: 'ru' }];
      mockVoiceStore = makeVoiceStore({ catalogueFor: cataloguesByLanguage({ ru: [] }) });
      await renderScreen();

      fireEvent.press(screen.getByRole('radio', { name: 'Русский' }));

      expect(screen.getByText('Rusça hazır anlatıcı henüz yok.')).toBeOnTheScreen();
      expect(screen.getByRole('radio', { name: 'Türkçe' })).toBeOnTheScreen();
    });

    it('offers the language of an added narrator even when it is not a content language', async () => {
      mockContentLanguage.languages = [{ code: 'tr' }];
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [addedNarrator('Orus', 'en-US', 'en')],
        catalogueFor: cataloguesByLanguage(),
      });
      await renderScreen();

      fireEvent.press(screen.getByRole('radio', { name: 'English' }));
      expect(screen.getByTestId('narrator-vp-Orus')).toBeOnTheScreen();
    });

    it('names the language of an own voice of another language', async () => {
      mockVoiceStore = makeVoiceStore({
        voiceProfiles: [cloneProfile({ language: 'en-US', contentLanguage: 'en' })],
      });
      await renderScreen();
      expect(screen.getByText('English, 12 Ekim kaydı')).toBeOnTheScreen();
    });
  });
});
