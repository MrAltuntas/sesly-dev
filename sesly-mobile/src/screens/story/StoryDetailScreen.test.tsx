/**
 * StoryDetailScreen (design/v4/playful, frame c), with the narrator sheet,
 * the translation request sheet and the story options sheet.
 *
 * Uses the real StoryStore so the 403 -> premium mapping, the favourite
 * toggle, the cached and listed copies and the language switch run end to
 * end (StoryService and NarrationService are mocked at the service boundary
 * and throw real ApiErrors), and the real queue store; the voice profile
 * store, subscription, content language, audio player and dialog hooks are
 * mocks (the audio player mock is observable like the real store).
 */

import React from 'react';
import { Dimensions, Linking, ScrollView } from 'react-native';
import { act, fireEvent, screen, userEvent, waitFor, within } from '@testing-library/react-native';
import { observable, runInAction } from 'mobx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Reanimated from 'react-native-reanimated';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { mockNavigation, setMockFocused, setMockRouteParams } from '../../test-utils/mocks/navigation';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { contrastRatio, withAlpha } from '../../theme/color';
import { PALETTE_KEYS } from '../../theme/palettes';
import { StoryStore } from '../../hooks/useStory';
import { API_ERROR_CODES, ApiError, apiErrorFromResponse } from '../../services/ApiError';
import {
  EMPTY_STORY_CREDIT,
  NO_RELATED_STORIES,
  RelatedStories,
  parseRelatedStoriesFromJSON,
  parseStoryDetailFromJSON,
  parseStoryFromJSON,
} from '../../models/Story';
import { resetRelatedStoriesForTests } from '../../components/detail/RelatedStories';
import {
  HERO_SHADE_STOPS,
  HERO_SOLID_ALPHA,
  HERO_TITLE_LINES,
  HERO_TITLE_MAX_SCALE,
  storyHeroHeight,
} from '../../components/detail/StoryHero';
import { parseStoryNarrationFromJSON } from '../../models/Narration';
import { AvailableGoogleVoice, VoiceProfile } from '../../models/VoiceProfile';
import type { UsageBucket, UsageSummary } from '../../models/Quota';
import { TTSProvider, VoiceProfileStatus } from '../../types/enums';
import { showToast } from '../../utils/toast';
import { queueStore } from '../../stores/QueueStore';
import { getNarrationMeta, resetNarrationMetaForTests } from '../../stores/narrationMeta';
import { resetLastNarratorForTests } from '../../components/detail/lastNarrator';
import { resetSheetPresence } from '../../components/design/sheetPresence';
import { Bone, BottomSheet, RowSkeleton, snackbar } from '../../components/design';
import * as NarratorAvatarModule from '../../components/detail/NarratorAvatar';
import {
  DOCK_BODY,
  NARRATIONS_WAIT_MS,
  StoryDetailScreen,
  SUPPORT_EMAIL,
  TOP_BAR_BODY,
  TRANSITION_FALLBACK_MS,
  reportMailUrl,
  resetVoiceRefreshForTests,
  storyCreditRows,
  storySourceRows,
  storyLevelLabel,
} from './StoryDetailScreen';

// The first render in a cold Jest cache lazily transforms React Native
// internals; on a loaded machine that took well over the 5 s default.
jest.setTimeout(60000);

const mockGetStoryById = jest.fn();
const mockToggleFavorite = jest.fn();
const mockRequestTranslation = jest.fn();
const mockCancelTranslationRequest = jest.fn();
const mockGetFavoriteStories = jest.fn();
const mockGetMyNarrations = jest.fn();
const mockGetNarrationsByStory = jest.fn();
const mockPreviewVoice = jest.fn();
const mockGetRelatedStories = jest.fn();

jest.mock('../../services/StoryService', () => ({
  __esModule: true,
  default: {
    getStoryById: (...args: unknown[]) => mockGetStoryById(...args),
    toggleFavorite: (...args: unknown[]) => mockToggleFavorite(...args),
    requestTranslation: (...args: unknown[]) => mockRequestTranslation(...args),
    cancelTranslationRequest: (...args: unknown[]) => mockCancelTranslationRequest(...args),
    getFavoriteStories: (...args: unknown[]) => mockGetFavoriteStories(...args),
    getRelatedStories: (...args: unknown[]) => mockGetRelatedStories(...args),
  },
}));
jest.mock('../../services/NarrationService', () => ({
  __esModule: true,
  default: {
    getMyNarrations: (...args: unknown[]) => mockGetMyNarrations(...args),
    getNarrationsByStory: (...args: unknown[]) => mockGetNarrationsByStory(...args),
  },
}));
jest.mock('../../services/VoiceProfileService', () => ({
  __esModule: true,
  default: {
    previewVoice: (...args: unknown[]) => mockPreviewVoice(...args),
  },
}));
jest.mock('../../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

interface VoiceStoreMock {
  voiceProfiles: VoiceProfile[];
  hasLoadedProfiles: boolean;
  loadVoiceProfiles: jest.Mock;
  loadAvailableVoices: jest.Mock;
  catalogueFor: jest.Mock;
  /** Set once a catalogue load ended without a list, like the real store. */
  catalogueError: string | null;
  catalogueErrorFor: jest.Mock;
  isLoadingVoices: boolean;
  createVoiceProfile: jest.Mock;
  checkCanCreate: jest.Mock;
  isAddingPreset: jest.Mock;
  slotBlock: jest.Mock;
  getVoiceSample: jest.Mock;
  /** The clone flow's texts (prefetched by the own-voice entry). */
  cloneConfig: unknown;
  isLoadingCloneConfig: boolean;
  loadCloneConfig: jest.Mock;
}

/** The sample part of the audio store (SPEC-audio 2.5), observable like the real one. */
interface AudioPlayerMock {
  source: 'none' | 'sample' | 'story';
  sampleKey: string | null;
  isPlaying: boolean;
  previewPending: boolean;
  playFromUrl: jest.Mock;
  stopPreview: jest.Mock;
  stopAndCleanup: jest.Mock;
}

interface SubscriptionMock {
  planId: 'free' | 'mini' | 'premium';
  usage: UsageSummary | null;
  loadUsageIfStale: jest.Mock;
}

interface ContentLanguageMock {
  languages: { code: string; nativeName: string }[];
  effective: string;
  load: jest.Mock;
  nativeName: (code: string) => string;
}

interface DialogShape {
  title: string;
  message?: string;
  buttons?: { text: string; style?: string; onPress?: () => void }[];
}

let mockStoryStore: StoryStore;
let mockVoiceStore: VoiceStoreMock;
let mockAudioPlayer: AudioPlayerMock;
let mockSubscription: SubscriptionMock;
let mockContentLanguage: ContentLanguageMock;
const mockShowDialog = jest.fn();

jest.mock('../../hooks/useStory', () => {
  const actual = jest.requireActual('../../hooks/useStory');
  return { ...actual, useStory: () => mockStoryStore };
});
jest.mock('../../hooks/useVoiceProfile', () => ({
  useVoiceProfile: () => mockVoiceStore,
}));
jest.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => mockSubscription,
}));
jest.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => mockAudioPlayer,
}));
jest.mock('../../hooks/useContentLanguage', () => {
  const actual = jest.requireActual('../../hooks/useContentLanguage');
  return { ...actual, useContentLanguage: () => mockContentLanguage };
});
jest.mock('../../hooks/useDialog', () => ({
  useDialog: () => ({ showDialog: mockShowDialog, hideDialog: jest.fn() }),
}));

// --- Fixtures ---

const STORY_JSON = {
  id: 's-1',
  title: 'Bremen Mızıkacıları',
  description: 'Dört yaşlı hayvan çalgıcı olmak için yola çıkar.',
  summary: 'Yaşlı bir eşek, bir köpek, bir kedi ve bir horoz Bremen yoluna düşer.',
  ageGroup: 'THREE_TO_SIX',
  category: 'WORLD_CLASSICS',
  language: 'tr',
  languageLevel: 'A2',
  estimatedDuration: 6,
  coverImageUrl: null,
  isPremium: false,
  isFavorite: false,
  requestedLanguages: ['de'],
  translations: [{ id: 's-1-en', language: 'en', title: 'The Town Musicians of Bremen' }],
  credit: {
    ...EMPTY_STORY_CREDIT,
    collectorName: 'Jacob ve Wilhelm Grimm',
    translatorName: 'Sesly Yayın Kurulu',
    sourceName: 'Kinder- und Hausmärchen',
    firstPublishedYear: 1819,
    origin: 'FOLK_ANONYMOUS',
    translationMethod: 'HUMAN',
  },
};

const ENGLISH_JSON = {
  ...STORY_JSON,
  id: 's-1-en',
  title: 'The Town Musicians of Bremen',
  language: 'en',
  summary: 'Four old animals set out for Bremen.',
  requestedLanguages: [],
  translations: [{ id: 's-1', language: 'tr', title: 'Bremen Mızıkacıları' }],
  credit: { ...STORY_JSON.credit, translatorName: null, translationMethod: 'MACHINE' },
};

const OTHER_JSON = { ...STORY_JSON, id: 's-2', title: 'Parmak Kız', translations: [] };

// Backend envelope for GET /stories/:id on a premium story for a FREE user
// (StoriesService: ForbiddenException { code: 'PREMIUM_STORY', message }).
const PREMIUM_403_BODY = {
  success: false,
  statusCode: 403,
  code: 'PREMIUM_STORY',
  message: 'Bu masal Pro aboneliği gerektiriyor.',
  path: '/stories/s-1',
  method: 'GET',
};

function voice(
  id: string,
  name: string,
  kind: 'CLONE' | 'PRESET',
  language = 'tr-TR',
): VoiceProfile {
  return {
    id,
    name,
    status: VoiceProfileStatus.READY,
    provider: kind === 'CLONE' ? TTSProvider.CARTESIA : TTSProvider.GOOGLE,
    voiceId: `${id}-voice`,
    language,
    contentLanguage: language.slice(0, 2).toLowerCase(),
    sampleAudioUrl: null,
    errorMessage: null,
    voiceModelId: null,
    kind,
    consentAt: null,
    createdAt: new Date(2026, 9, 12, 10, 0, 0),
    updatedAt: new Date(2026, 9, 12, 10, 0, 0),
  };
}

const catalogueVoice = (name: string, gender: 'female' | 'male' = 'female', locale = 'tr-TR'): AvailableGoogleVoice => ({
  id: `${locale}-Chirp3-HD-${name}`,
  voiceId: `${locale}-Chirp3-HD-${name}`,
  name,
  language: 'Turkish',
  languageCode: locale,
  contentLanguage: locale.slice(0, 2),
  gender,
  description: '',
  provider: 'GOOGLE',
});

/** GET /narrations/story/:id: no storyId and no story in the rows. */
function storyNarration(id: string, voiceProfileId: string, status: string, createdAt = '2026-09-20T10:00:00Z') {
  return parseStoryNarrationFromJSON({
    id,
    userId: 'u-1',
    voiceProfileId,
    status,
    createdAt,
    updatedAt: createdAt,
    totalDuration: 360,
  });
}

function bucket(limit: number | null, remaining: number | null, period: 'month' | 'lifetime' = 'month'): UsageBucket {
  return {
    limit,
    used: limit !== null && remaining !== null ? limit - remaining : 0,
    remaining,
    period,
    renewsAt: period === 'month' ? new Date(2026, 10, 1) : null,
  };
}

function usage(preset: UsageBucket, clone: UsageBucket, planId: SubscriptionMock['planId'] = 'free'): UsageSummary {
  return {
    planId,
    buckets: { presetNarrations: preset, cloneNarrations: clone, cloneCreations: bucket(1, 1, 'lifetime') },
    voiceSlots: { preset: { used: 1, limit: 3 }, clone: { used: 1, limit: 1 } },
    features: { backgroundPlayback: planId !== 'free', premiumStories: planId !== 'free' },
  };
}

function makeAudioMock(): AudioPlayerMock {
  const state: AudioPlayerMock = observable(
    {
      source: 'none' as AudioPlayerMock['source'],
      sampleKey: null as string | null,
      isPlaying: false,
      previewPending: false,
      playFromUrl: jest.fn(async (_url: string, meta: { key: string }) => {
        runInAction(() => {
          state.source = 'sample';
          state.sampleKey = meta.key;
          state.isPlaying = true;
        });
      }),
      stopPreview: jest.fn(async (key?: string) => {
        if (state.source !== 'sample' || (key !== undefined && key !== state.sampleKey)) return;
        runInAction(() => {
          state.source = 'none';
          state.sampleKey = null;
          state.isPlaying = false;
        });
      }),
      stopAndCleanup: jest.fn(async () => undefined),
    },
    { playFromUrl: false, stopPreview: false, stopAndCleanup: false },
  );
  return state;
}

/** Holds every `withTiming`, so a sheet can be seen during its exit. */
function holdTimings(): { callback?: (finished?: boolean) => void }[] {
  const held: { callback?: (finished?: boolean) => void }[] = [];
  jest.spyOn(Reanimated, 'withTiming').mockImplementation(((
    toValue: number,
    _config?: unknown,
    callback?: (finished?: boolean) => void,
  ) => {
    held.push({ callback });
    return toValue;
  }) as unknown as typeof Reanimated.withTiming);
  return held;
}

/** The push of the page ends: the stack's `transitionEnd` reaches its listeners. */
function finishTransition() {
  const calls = mockNavigation.addListener.mock.calls as unknown as [string, (event: unknown) => void][];
  const listeners = calls.filter(([event]) => event === 'transitionEnd').map(([, listener]) => listener);
  act(() => listeners.forEach(listener => listener({ data: { closing: false } })));
}

/**
 * The catalogue of the story language loads like in the real store: a
 * request marks the store loading (and clears an old error) before it
 * returns, and the narrators arrive when the test answers (null: it failed).
 */
function holdCatalogue(): (voices: readonly AvailableGoogleVoice[] | null) => Promise<void> {
  let loaded: readonly AvailableGoogleVoice[] | null = null;
  mockVoiceStore.catalogueFor.mockImplementation(() => loaded);
  mockVoiceStore.loadAvailableVoices.mockImplementation(() => {
    runInAction(() => {
      mockVoiceStore.isLoadingVoices = true;
      mockVoiceStore.catalogueError = null;
    });
    return new Promise<void>(() => undefined);
  });
  return async voices => {
    await act(async () => {
      runInAction(() => {
        loaded = voices;
        mockVoiceStore.isLoadingVoices = false;
        if (!voices) mockVoiceStore.catalogueError = 'Anlatıcılar yüklenemedi.';
      });
    });
  };
}

// Renders, lets pending store / provider promises settle inside act, and
// ends the push (the deferred parts mount).
async function renderScreen(theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi') {
  const utils = renderWithProviders(<StoryDetailScreen />, { theme });
  await act(async () => undefined);
  finishTransition();
  return utils;
}

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

const lastDialog = (): DialogShape =>
  mockShowDialog.mock.calls[mockShowDialog.mock.calls.length - 1][0] as DialogShape;

/** Accessible name of the chosen narrator card ("Annem, Senin sesin"). */
const chosenNarrator = (): string | undefined =>
  within(screen.getByTestId('narrator-cards'))
    .getAllByRole('radio')
    .find(node => node.props.accessibilityState?.selected)?.props.accessibilityLabel;

const CTA_OWN = 'Senin sesinle dinle';

async function openOptions() {
  fireEvent.press(screen.getByRole('button', { name: 'Diğer seçenekler' }));
  return within(await screen.findByTestId('story-options-sheet'));
}

const optionIds = (sheet: ReturnType<typeof within>) =>
  sheet
    .getAllByRole('button')
    .map(node => node.props.testID as string)
    .filter(id => id?.startsWith('story-option-'));

/** The confirmation that comes before every new narration. */
async function confirmSheet() {
  return within(await screen.findByTestId('narration-confirm-sheet'));
}

/** "Seslendir" in the confirmation: the narration starts once the sheet has gone. */
async function confirmNarration() {
  const sheet = await confirmSheet();
  fireEvent.press(sheet.getByRole('button', { name: 'Seslendir' }));
  await waitFor(() => expect(screen.queryByTestId('narration-confirm-sheet')).toBeNull());
}

const generationCalls = () =>
  mockNavigation.navigate.mock.calls.filter(([route]: unknown[]) => route === 'AudioGeneration');

/** The route params, kept here so setParams merges like React Navigation. */
let routeParams: Record<string, unknown> = {};
function setRoute(params: Record<string, unknown>) {
  routeParams = params;
  setMockRouteParams(params);
}

beforeEach(async () => {
  setRoute({ storyId: 's-1' });
  mockNavigation.setParams.mockImplementation((params: Record<string, unknown>) =>
    setRoute({ ...routeParams, ...params }),
  );
  mockGetStoryById.mockReset();
  mockGetStoryById.mockImplementation((id: string) =>
    Promise.resolve(
      parseStoryDetailFromJSON(id === 's-1-en' ? ENGLISH_JSON : id === 's-2' ? OTHER_JSON : STORY_JSON),
    ),
  );
  mockToggleFavorite.mockReset();
  mockToggleFavorite.mockResolvedValue(undefined);
  mockRequestTranslation.mockReset();
  mockRequestTranslation.mockResolvedValue({});
  mockCancelTranslationRequest.mockReset();
  mockCancelTranslationRequest.mockResolvedValue({});
  mockGetFavoriteStories.mockReset();
  mockGetMyNarrations.mockReset();
  mockGetMyNarrations.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
  mockGetNarrationsByStory.mockReset();
  mockGetNarrationsByStory.mockResolvedValue([]);
  mockPreviewVoice.mockReset();
  mockPreviewVoice.mockResolvedValue({ audioUrl: 'https://cdn.test/preset.mp3' });
  // Related stories never answer unless a test says so (their section
  // stays on its bones and nothing updates after a test has ended).
  mockGetRelatedStories.mockReset();
  mockGetRelatedStories.mockReturnValue(new Promise(() => undefined));
  resetRelatedStoriesForTests();
  mockShowDialog.mockReset();
  mockStoryStore = new StoryStore();
  // Observable like the real stores, so the page follows their changes.
  mockVoiceStore = observable(
    {
    voiceProfiles: [
      voice('vp-1', 'Annem', 'CLONE'),
      voice('vp-2', 'Deniz', 'PRESET'),
      voice('vp-3', 'Emma', 'PRESET', 'en-US'),
    ],
    hasLoadedProfiles: true,
    loadVoiceProfiles: jest.fn(() => Promise.resolve()),
    // A load either lists the narrators (a test sets catalogueFor) or fails.
    loadAvailableVoices: jest.fn(async (language?: string) => {
      if (mockVoiceStore.catalogueFor(language) === null) {
        runInAction(() => {
          mockVoiceStore.catalogueError = 'Anlatıcılar yüklenemedi.';
        });
      }
    }),
    // Nothing loaded yet unless a test provides a catalogue.
    catalogueFor: jest.fn(() => null),
    catalogueError: null,
    catalogueErrorFor: jest.fn(() => mockVoiceStore.catalogueError),
    isLoadingVoices: false,
    createVoiceProfile: jest.fn(),
    checkCanCreate: jest.fn(() => Promise.resolve(true)),
    isAddingPreset: jest.fn(() => false),
    slotBlock: jest.fn(),
    getVoiceSample: jest.fn(() => Promise.resolve('https://cdn.test/own.wav')),
    cloneConfig: null,
    isLoadingCloneConfig: false,
    loadCloneConfig: jest.fn(() => Promise.resolve(null)),
    },
    {
      voiceProfiles: observable.ref,
      cloneConfig: observable.ref,
      loadCloneConfig: false,
      loadVoiceProfiles: false,
      loadAvailableVoices: false,
      catalogueFor: false,
      catalogueErrorFor: false,
      createVoiceProfile: false,
      checkCanCreate: false,
      isAddingPreset: false,
      slotBlock: false,
      getVoiceSample: false,
    },
  );
  mockAudioPlayer = makeAudioMock();
  mockSubscription = observable(
    { planId: 'free' as SubscriptionMock['planId'], usage: null as UsageSummary | null, loadUsageIfStale: jest.fn(() => Promise.resolve()) },
    { usage: observable.ref, loadUsageIfStale: false },
  );
  const names: Record<string, string> = { tr: 'Türkçe', en: 'English', de: 'Deutsch', fr: 'Français' };
  mockContentLanguage = {
    languages: ['tr', 'en', 'de', 'fr'].map(code => ({ code, nativeName: names[code] })),
    effective: 'tr',
    load: jest.fn(() => Promise.resolve()),
    nativeName: (code: string) => names[code] ?? code.toUpperCase(),
  };
  queueStore.reset();
  resetNarrationMetaForTests();
  resetLastNarratorForTests();
  resetVoiceRefreshForTests();
  await AsyncStorage.clear();
});

afterEach(() => resetSheetPresence());

describe('helpers', () => {
  it('names the level with a short word, in both languages', async () => {
    expect(storyLevelLabel('a2')).toBe('Düzey A2, temel');
    expect(storyLevelLabel('C1')).toBe('Düzey C1, ileri');
    expect(storyLevelLabel('X9')).toBe('Düzey X9');
    expect(storyLevelLabel(null)).toBe('');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(storyLevelLabel('B2')).toBe('Level B2, upper intermediate');
  });

  it('builds only the credit rows that have data, in the mockup order', () => {
    const rows = storyCreditRows({
      ...EMPTY_STORY_CREDIT,
      authorName: 'Hans Christian Andersen',
      collectorName: 'Jacob ve Wilhelm Grimm',
      translatorName: 'Sesly Yayın Kurulu',
      adaptedBy: 'Sesly',
      sourceName: 'Kinder- und Hausmärchen',
      editionYear: 1857,
      firstPublishedYear: 1819,
    });
    expect(rows.map(row => [row.label, row.value])).toEqual([
      ['Yazar', 'Hans Christian Andersen'],
      ['Derleyen', 'Jacob ve Wilhelm Grimm'],
      ['Çeviren', 'Sesly Yayın Kurulu'],
      ['Uyarlayan', 'Sesly'],
      ['Kaynak', 'Kinder- und Hausmärchen'],
    ]);
    // The source carries the edition year.
    expect(rows[4]).toMatchObject({ suffix: ', 1857' });
    expect(storyCreditRows(EMPTY_STORY_CREDIT)).toEqual([]);
  });

  it('labels the credits in English short enough for the 72dp column', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    const rows = storyCreditRows({
      ...EMPTY_STORY_CREDIT,
      authorName: 'A',
      collectorName: 'B',
      translatorName: 'C',
      adaptedBy: 'D',
      sourceName: 'E',
    });
    expect(rows.map(row => row.label)).toEqual(['Author', 'Collector', 'Translator', 'Adapter', 'Source']);
  });

  it('credits an anonymous folk tale and leaves a source without a year as it is', () => {
    const rows = storyCreditRows({
      ...EMPTY_STORY_CREDIT,
      origin: 'FOLK_ANONYMOUS',
      sourceName: 'gutenberg.org',
    });
    expect(rows[0]).toMatchObject({ key: 'author', value: 'Anonim halk masalı' });
    expect(rows[1]).toMatchObject({ key: 'source', value: 'gutenberg.org', suffix: '' });
  });

  it('"Kaynak ve lisans": source address, attribution, licence and licence address, only the ones given', () => {
    const credit = {
      ...EMPTY_STORY_CREDIT,
      authorName: 'A. Writer',
      sourceUrl: 'https://example.org/fox',
      attribution: 'The Fox, A. Writer, CC BY 4.0',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    };
    expect(storySourceRows(credit).map(row => [row.label, row.value])).toEqual([
      ['Kaynak adresi', 'https://example.org/fox'],
      ['Atıf', 'The Fox, A. Writer, CC BY 4.0'],
      ['Lisans', 'CC BY 4.0'],
      ['Lisans adresi', 'https://creativecommons.org/licenses/by/4.0/'],
    ]);
    // The cover picture credit comes last.
    expect(
      storySourceRows({ ...credit, coverCredit: ' Vilhelm Pedersen, Kamu malı ' }).slice(-1).map(row => [row.key, row.label, row.value]),
    ).toEqual([['cover', 'Kapak resmi', 'Vilhelm Pedersen, Kamu malı']]);
    expect(storySourceRows({ ...EMPTY_STORY_CREDIT, coverCredit: 'Ada, CC BY 4.0' }).map(row => row.key)).toEqual(['cover']);
    // The credit card keeps only the people and the source name.
    expect(storyCreditRows(credit).map(row => row.key)).toEqual(['author']);
    expect(storySourceRows(EMPTY_STORY_CREDIT)).toEqual([]);
  });

  it('writes the report mail to the support address with title and id', () => {
    expect(SUPPORT_EMAIL).toBe('info@sesly.io');
    const url = reportMailUrl({ id: 's-1', title: 'Bremen Mızıkacıları' });
    expect(url.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`)).toBe(true);
    expect(decodeURIComponent(url.split('subject=')[1])).toBe(
      'Metin hatası: Bremen Mızıkacıları (s-1)',
    );
  });

});

describe('StoryDetailScreen: load states', () => {
  it('shows the paid-plan state for a 403 premium story and links to the plans once', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetStoryById.mockRejectedValue(apiErrorFromResponse(403, PREMIUM_403_BODY));
    await renderScreen();

    expect(await screen.findByText('Bu masal ücretli planlarda')).toBeOnTheScreen();
    expect(screen.getByText('Mini ya da Premium planla dinleyebilirsin.')).toBeOnTheScreen();
    expect(screen.queryByTestId('story-cta')).toBeNull();
    // The premium state replaces the generic failure snackbar.
    expect(showToast.error).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'Planları gör' }));
    // navigateSingleton: back to a plans screen already in the stack.
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Subscription', { reason: 'premiumStory' }, { pop: true });
  });

  it('a premium story shows that state even when a list copy of it was on screen', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    runInAction(() => {
      mockStoryStore.stories = [parseStoryFromJSON({ ...STORY_JSON, isPremium: true })];
    });
    mockGetStoryById.mockRejectedValue(apiErrorFromResponse(403, PREMIUM_403_BODY));
    await renderScreen();
    expect(await screen.findByTestId('story-premium')).toBeOnTheScreen();
    expect(screen.queryByTestId('story-cta')).toBeNull();
  });

  it('shows a retryable error for other load failures', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetStoryById.mockRejectedValueOnce(apiErrorFromResponse(500, { message: 'boom' }));
    await renderScreen();

    expect(await screen.findByText('Masal açılamadı')).toBeOnTheScreen();
    expect(screen.queryByText('Bu masal ücretli planlarda')).toBeNull();
    // The error state says it; no snackbar on top (r10-13).
    expect(showToast.error).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByRole('header', { name: 'Bremen Mızıkacıları' })).toBeOnTheScreen();
    expect(mockGetStoryById).toHaveBeenCalledTimes(2);
  });

  it('says it is offline when the request could not leave the phone', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetStoryById.mockRejectedValueOnce(
      new ApiError({ status: 0, code: API_ERROR_CODES.NETWORK, message: 'Bağlantı kurulamadı' }),
    );
    await renderScreen();
    expect(await screen.findByText('İnternete bağlı değilsin')).toBeOnTheScreen();
    expect(screen.queryByText('Masal açılamadı')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByRole('header', { name: 'Bremen Mızıkacıları' })).toBeOnTheScreen();
  });

  it('shows the page in its shapes while the story loads: top bar actions and dock too', async () => {
    mockGetStoryById.mockReturnValue(new Promise(() => undefined));
    await renderScreen();
    expect(screen.getByTestId('story-detail-loading')).toBeOnTheScreen();
    expect(screen.getByTestId('story-detail-loading-actions')).toBeOnTheScreen();
    const dock = screen.getByTestId('story-detail-loading-dock');
    // Sample and action bones of the real geometry (52 tall, on a 3dp lip).
    const bones = within(dock).UNSAFE_getAllByType(Bone);
    expect(bones).toHaveLength(2);
    expect(bones.map(bone => [bone.props.height, bone.props.lip])).toEqual([
      [52, 3],
      [52, 3],
    ]);
    expect(within(screen.getByTestId('story-detail-loading-actions')).UNSAFE_getAllByType(Bone)).toHaveLength(2);
    fireEvent.press(screen.getByTestId('appbar-back'));
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });

  it('says so when there is no story id at all', async () => {
    setRoute({});
    await renderScreen();
    expect(screen.getByText('Masal bulunamadı')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Tekrar dene' })).toBeNull();
    expect(mockGetStoryById).not.toHaveBeenCalled();
  });

  it('a story already in a list renders at once: title and action on the first frame, bones only for the rest', async () => {
    runInAction(() => {
      mockStoryStore.stories = [parseStoryFromJSON(STORY_JSON)];
    });
    mockGetStoryById.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<StoryDetailScreen />);

    // The first frame, before any effect settled.
    expect(screen.getByRole('header', { name: 'Bremen Mızıkacıları' })).toBeOnTheScreen();
    expect(screen.getByTestId('story-cta')).toBeOnTheScreen();
    expect(screen.queryByTestId('story-detail-loading')).toBeNull();
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: CTA_OWN })).toBeOnTheScreen();
    finishTransition();
    // The credits come with the list copy; the language versions wait for
    // the detail, on bones, as the list copy says the tale can be asked for
    // in other languages.
    expect(within(screen.getByTestId('credit-collector')).getByText('Jacob ve Wilhelm Grimm')).toBeOnTheScreen();
    const bones = screen.getByTestId('story-detail-more-loading');
    expect(within(bones).UNSAFE_getAllByType(Bone).map(bone => bone.props.height)).toEqual([18, 36, 36]);
    expect(screen.queryByTestId('story-languages')).toBeNull();
    // The list copy is live: the bookmark works already.
    expect(screen.getByTestId('story-save')).toBeEnabled();
  });

  it('a story opened before renders from the cache, without the skeleton', async () => {
    await act(async () => {
      await mockStoryStore.getStoryDetail('s-1');
      await mockStoryStore.getStoryDetail('s-2');
    });
    expect(mockStoryStore.currentStory?.id).toBe('s-2');
    mockGetStoryById.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<StoryDetailScreen />);

    expect(screen.queryByTestId('story-detail-loading')).toBeNull();
    expect(screen.getByRole('header', { name: 'Bremen Mızıkacıları' })).toBeOnTheScreen();
    await act(async () => undefined);
    finishTransition();
    // Drawn complete from the cache (languages, credits) while it refreshes,
    // with no bones in between.
    expect(screen.queryByTestId('story-detail-more-loading')).toBeNull();
    expect(screen.getByTestId('story-languages')).toBeOnTheScreen();
    expect(screen.getByTestId('story-credits')).toBeOnTheScreen();
    expect(mockStoryStore.currentStory?.id).toBe('s-1');
    expect(mockGetStoryById).toHaveBeenLastCalledWith('s-1');
  });

  it('a list that finishes loading first never turns the page into an error', async () => {
    let resolveDetail: (value: unknown) => void = () => undefined;
    mockGetStoryById.mockReturnValue(new Promise(resolve => (resolveDetail = resolve)));
    mockGetFavoriteStories.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    await renderScreen();

    await act(async () => {
      await mockStoryStore.loadFavorites();
    });
    expect(screen.getByTestId('story-detail-loading')).toBeOnTheScreen();
    expect(screen.queryByText('Masal açılamadı')).toBeNull();

    await act(async () => {
      resolveDetail(parseStoryDetailFromJSON(STORY_JSON));
    });
    expect(screen.getByRole('header', { name: 'Bremen Mızıkacıları' })).toBeOnTheScreen();
  });

  it('an earlier detail in the stack keeps its story when another one is opened, and loads it again on focus', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(mockGetStoryById).toHaveBeenCalledTimes(1);

    // Another story page opens on top and loads its story into the store.
    act(() => setMockFocused(false));
    await act(async () => {
      await mockStoryStore.getStoryDetail('s-2');
    });
    expect(mockStoryStore.currentStory?.id).toBe('s-2');
    expect(screen.getByRole('header', { name: 'Bremen Mızıkacıları' })).toBeOnTheScreen();
    expect(screen.queryByText('Masal açılamadı')).toBeNull();
    // Its copy is not the store's: saving waits for it.
    expect(screen.getByTestId('story-save')).toBeDisabled();

    // Back on this page.
    await act(async () => setMockFocused(true));
    await waitFor(() => expect(mockGetStoryById).toHaveBeenLastCalledWith('s-1'));
    await waitFor(() => expect(mockStoryStore.currentStory?.id).toBe('s-1'));
    expect(screen.getByTestId('story-save')).toBeEnabled();
  });
});

describe('StoryDetailScreen: frame c', () => {
  it('renders the hero, title, tags, summary and credits, and no translation badge', async () => {
    await renderScreen();

    expect(await screen.findByRole('header', { name: 'Bremen Mızıkacıları' })).toBeOnTheScreen();
    // The picture is full-bleed and wide, the title (the screen's header) on its shade.
    const { width, height } = Dimensions.get('window');
    expect(flatStyle(screen.getByTestId('story-hero'))).toMatchObject({
      width,
      height: storyHeroHeight(width, height, 0),
    });
    expect(screen.getByTestId('story-cover').props.accessibilityLabel).toBe('Bremen Mızıkacıları kapağı');
    expect(
      within(screen.getByTestId('story-hero-title')).getByRole('header', { name: 'Bremen Mızıkacıları' }),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('story-glow', { includeHiddenElements: true })).toBeNull();
    // Tags: the category in its colour, then age, duration, language and level.
    expect(within(screen.getByTestId('story-tag-category')).getByText('Dünya klasikleri')).toBeOnTheScreen();
    expect(within(screen.getByTestId('story-tag-age')).getByText('3-6 yaş')).toBeOnTheScreen();
    expect(within(screen.getByTestId('story-tag-duration')).getByText('6 dk')).toBeOnTheScreen();
    expect(within(screen.getByTestId('story-tag-language')).getByText('Türkçe A2')).toBeOnTheScreen();
    // The level word is read out with the language tag.
    expect(screen.getByLabelText('Türkçe, Düzey A2, temel')).toBeOnTheScreen();
    expect(
      screen.getByText('Yaşlı bir eşek, bir köpek, bir kedi ve bir horoz Bremen yoluna düşer.'),
    ).toBeOnTheScreen();
    // A human translation carries no badge; the translator is named in the credits.
    expect(screen.queryByText('Çeviri')).toBeNull();
    expect(screen.queryByText('Yapay zekâ ile çevrildi')).toBeNull();

    // Credits: only the rows the story has data for, mockup labels.
    expect(within(screen.getByTestId('credit-author')).getByText('Yazar')).toBeOnTheScreen();
    expect(within(screen.getByTestId('credit-author')).getByText('Anonim halk masalı')).toBeOnTheScreen();
    expect(within(screen.getByTestId('credit-collector')).getByText('Jacob ve Wilhelm Grimm')).toBeOnTheScreen();
    expect(within(screen.getByTestId('credit-translator')).getByText('Sesly Yayın Kurulu')).toBeOnTheScreen();
    expect(within(screen.getByTestId('credit-source')).getByText('Kinder- und Hausmärchen, 1819')).toBeOnTheScreen();
    expect(screen.queryByTestId('credit-adapter')).toBeNull();
    expect(mockContentLanguage.load).toHaveBeenCalled();
  });

  it('has the top row: back, save and more', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    fireEvent.press(screen.getByTestId('appbar-back'));
    expect(mockNavigation.goBack).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Diğer seçenekler' })).toBeOnTheScreen();
  });

  it('has one chip per language version, this one selected', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    expect(screen.getByRole('header', { name: 'Masalın dilleri' })).toBeOnTheScreen();
    expect(screen.getByTestId('language-chip-tr')).toBeSelected();
    expect(screen.getByTestId('language-chip-en')).not.toBeSelected();
  });

  it('a language chip loads that version and replaces the route param', async () => {
    const view = await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    fireEvent.press(screen.getByTestId('language-chip-en'));
    await waitFor(() => expect(mockNavigation.setParams).toHaveBeenCalledWith({ storyId: 's-1-en' }));
    expect(mockGetStoryById).toHaveBeenLastCalledWith('s-1-en');
    view.rerender(<StoryDetailScreen />);

    expect(
      await screen.findByRole('header', { name: 'The Town Musicians of Bremen' }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('language-chip-en')).toBeSelected();
    expect(screen.getByTestId('machine-translation-note-text')).toBeOnTheScreen();
    expect(within(screen.getByTestId('story-tag-language')).getByText('English A2')).toBeOnTheScreen();
    // The route already points at the loaded version: no second request.
    expect(mockGetStoryById).toHaveBeenCalledTimes(2);
    // Its narrations are asked for.
    expect(mockGetNarrationsByStory).toHaveBeenLastCalledWith('s-1-en');
  });

  it('an AI translation says so with the language of its original and opens the original', async () => {
    setRoute({ storyId: 's-1-en' });
    mockGetStoryById.mockImplementation((id: string) =>
      Promise.resolve(
        parseStoryDetailFromJSON(
          id === 's-1-en'
            ? {
                ...ENGLISH_JSON,
                translation: {
                  isMachineTranslation: true,
                  method: 'MACHINE',
                  fromLanguage: 'tr',
                  original: { id: 's-1', title: 'Bremen Mızıkacıları', language: 'tr' },
                },
              }
            : STORY_JSON,
        ),
      ),
    );
    await renderScreen();
    await screen.findByRole('header', { name: 'The Town Musicians of Bremen' });

    // The note under the summary says it once; no second badge in the tags.
    expect(screen.queryByText('Yapay zekâ ile çevrildi')).toBeNull();
    expect(screen.getByTestId('machine-translation-note-text')).toHaveTextContent(
      'Bu metin Türkçe aslından yapay zekâ ile çevrildi.',
    );
    const open = screen.getByTestId('machine-translation-note-open-original');
    expect(within(open).getByText('Orijinalini aç: Bremen Mızıkacıları (Türkçe)')).toBeOnTheScreen();

    fireEvent.press(open);
    await waitFor(() => expect(mockNavigation.setParams).toHaveBeenCalledWith({ storyId: 's-1' }));
    expect(mockGetStoryById).toHaveBeenLastCalledWith('s-1');
  });

  it('an AI translation whose original is not published names the language only; a human one shows no note', async () => {
    setRoute({ storyId: 's-1-en' });
    mockGetStoryById.mockImplementation(() =>
      Promise.resolve(
        parseStoryDetailFromJSON({
          ...ENGLISH_JSON,
          translation: { isMachineTranslation: true, method: 'MACHINE', fromLanguage: 'tr', original: null },
        }),
      ),
    );
    const view = await renderScreen();
    await screen.findByRole('header', { name: 'The Town Musicians of Bremen' });
    expect(screen.getByTestId('machine-translation-note-text')).toHaveTextContent(
      'Bu metin Türkçe aslından yapay zekâ ile çevrildi.',
    );
    expect(screen.queryByTestId('machine-translation-note-open-original')).toBeNull();
    view.unmount();

    setRoute({ storyId: 's-1' });
    mockGetStoryById.mockImplementation(() => Promise.resolve(parseStoryDetailFromJSON(STORY_JSON)));
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(screen.queryByTestId('machine-translation-note')).toBeNull();
  });

  it('a CC BY story shows its source and licence as selectable text, never a link that leaves the app', async () => {
    mockGetStoryById.mockImplementation(() =>
      Promise.resolve(
        parseStoryDetailFromJSON({
          ...STORY_JSON,
          credit: {
            ...STORY_JSON.credit,
            attribution: 'The Fox, A. Writer, CC BY 4.0',
            licenseName: 'CC BY 4.0',
            licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
          },
        }),
      ),
    );
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    // Folded by default: one row with the title, a tap away.
    const section = within(screen.getByTestId('story-source'));
    expect(section.getByText('Kaynak ve lisans')).toBeOnTheScreen();
    const toggle = screen.getByRole('button', { name: 'Kaynak ve lisans' });
    expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByTestId('source-attribution')).toBeNull();
    fireEvent.press(toggle);
    expect(toggle.props.accessibilityState).toMatchObject({ expanded: true });
    expect(within(screen.getByTestId('source-attribution')).getByText('The Fox, A. Writer, CC BY 4.0')).toBeOnTheScreen();
    expect(within(screen.getByTestId('source-license')).getByText('CC BY 4.0')).toBeOnTheScreen();
    const address = within(screen.getByTestId('source-licenseUrl')).getByText(
      'https://creativecommons.org/licenses/by/4.0/',
    );
    expect(address.props.selectable).toBe(true);
    expect(address.props.onPress).toBeUndefined();
    expect(address.props.accessibilityRole).toBeUndefined();
    expect(openURL).not.toHaveBeenCalled();
    openURL.mockRestore();
  });

  it('"Kaynak ve lisans" names the cover picture credit as plain selectable text', async () => {
    const line = 'Illustration by Greystroke, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)';
    mockGetStoryById.mockImplementation(() =>
      Promise.resolve(
        parseStoryDetailFromJSON({ ...STORY_JSON, credit: { ...STORY_JSON.credit, coverCredit: line } }),
      ),
    );
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    fireEvent.press(screen.getByTestId('story-source-toggle'));
    const row = within(screen.getByTestId('source-cover'));
    expect(row.getByText('Kapak resmi')).toBeOnTheScreen();
    const text = row.getByText(line);
    expect(text.props.selectable).toBe(true);
    expect(text.props.onPress).toBeUndefined();
  });

  it('content warnings sit next to the age group as calm tags', async () => {
    mockGetStoryById.mockImplementation(() =>
      Promise.resolve(parseStoryDetailFromJSON({ ...STORY_JSON, contentWarnings: ['SAD_ENDING', 'SCARY', 'x'] })),
    );
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(within(screen.getByTestId('story-tag-warning-SCARY')).getByText('Korkutucu sahne')).toBeOnTheScreen();
    expect(within(screen.getByTestId('story-tag-warning-SAD_ENDING')).getByText('Üzücü son')).toBeOnTheScreen();
    expect(screen.queryByTestId('story-tag-warning-x')).toBeNull();
  });

  it('switching the language never shows an error and keeps the page (and its scroll)', async () => {
    let resolveEnglish: (value: unknown) => void = () => undefined;
    const view = await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    const scroll = screen.UNSAFE_getByType(ScrollView);

    mockGetStoryById.mockImplementationOnce(() => new Promise(resolve => (resolveEnglish = resolve)));
    fireEvent.press(screen.getByTestId('language-chip-en'));
    // While the version loads: the action, the sample and the bookmark wait,
    // and the chip being opened spins.
    expect(screen.getByTestId('story-cta')).toBeDisabled();
    expect(screen.getByTestId('story-sample')).toBeDisabled();
    expect(screen.getByTestId('story-save')).toBeDisabled();
    expect(screen.getByTestId('story-more')).toBeDisabled();
    expect(within(screen.getByTestId('language-chip-en')).getByTestId('language-chip-opening')).toBeOnTheScreen();
    expect(screen.queryByText('Masal açılamadı')).toBeNull();

    await act(async () => {
      resolveEnglish(parseStoryDetailFromJSON(ENGLISH_JSON));
    });
    // The version is drawn before the route param changed, in the same page.
    expect(screen.queryByText('Masal açılamadı')).toBeNull();
    expect(screen.getByRole('header', { name: 'The Town Musicians of Bremen' })).toBeOnTheScreen();
    view.rerender(<StoryDetailScreen />);
    await act(async () => undefined);
    expect(screen.queryByText('Masal açılamadı')).toBeNull();
    expect(screen.UNSAFE_getByType(ScrollView)).toBe(scroll);
    expect(screen.getByTestId('story-cta')).toBeEnabled();
  });

  it('keeps the version on screen and says so whenever the other language cannot be opened', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    mockGetStoryById.mockRejectedValueOnce(apiErrorFromResponse(403, PREMIUM_403_BODY));
    fireEvent.press(screen.getByTestId('language-chip-en'));
    await waitFor(() =>
      expect(showToast.error).toHaveBeenCalledWith('Masal bu dilde açılamadı.'),
    );
    expect(mockNavigation.setParams).not.toHaveBeenCalled();
    expect(screen.getByRole('header', { name: 'Bremen Mızıkacıları' })).toBeOnTheScreen();

    // Any other failure says the same.
    (showToast.error as jest.Mock).mockClear();
    mockGetStoryById.mockRejectedValueOnce(apiErrorFromResponse(500, { message: 'boom' }));
    fireEvent.press(screen.getByTestId('language-chip-en'));
    await waitFor(() =>
      expect(showToast.error).toHaveBeenCalledWith('Masal bu dilde açılamadı.'),
    );
    expect(screen.getByRole('header', { name: 'Bremen Mızıkacıları' })).toBeOnTheScreen();
  });

  it('saves the tale with the bookmark and says so with the way to the saved list', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(screen.getByTestId('icon-bookmark', { includeHiddenElements: true })).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Kaydet' }));
    expect(mockToggleFavorite).toHaveBeenCalledWith('s-1', true);
    expect(await screen.findByRole('button', { name: 'Kaydedilenlerden çıkar' })).toBeOnTheScreen();
    expect(screen.getByTestId('icon-bookmarkOn', { includeHiddenElements: true })).toBeOnTheScreen();
    await waitFor(() =>
      expect(showToast.success).toHaveBeenCalledWith(
        'Bremen Mızıkacıları kaydedildi',
        undefined,
        expect.objectContaining({ label: 'Göster' }),
      ),
    );
    const action = (showToast.success as jest.Mock).mock.calls[0][2] as { onPress: () => void };
    action.onPress();
    expect(mockNavigation.popTo).toHaveBeenCalledWith('Main', { screen: 'Library' });
  });

  it('unsaving offers to take it back, and a failure is said once', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetStoryById.mockResolvedValue(parseStoryDetailFromJSON({ ...STORY_JSON, isFavorite: true }));
    await renderScreen();
    fireEvent.press(await screen.findByRole('button', { name: 'Kaydedilenlerden çıkar' }));
    await waitFor(() =>
      expect(showToast.info).toHaveBeenCalledWith(
        'Bremen Mızıkacıları kaydedilenlerden çıkarıldı',
        undefined,
        expect.objectContaining({ label: 'Geri al' }),
      ),
    );
    const undo = (showToast.info as jest.Mock).mock.calls[0][2] as { onPress: () => void };
    await act(async () => undo.onPress());
    await waitFor(() => expect(mockToggleFavorite).toHaveBeenLastCalledWith('s-1', true));

    mockToggleFavorite.mockRejectedValueOnce(apiErrorFromResponse(500, { message: 'boom' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Kaydedilenlerden çıkar' }));
    await waitFor(() => expect(showToast.error).toHaveBeenCalledTimes(1));
    expect(showToast.error).toHaveBeenCalledWith('Kayıt kaldırılamadı. Tekrar dene.');
  });

  it('shows the bookmark filled when another language version is saved', async () => {
    mockGetStoryById.mockResolvedValue(
      parseStoryDetailFromJSON({ ...STORY_JSON, isFavoriteAnyLanguage: true }),
    );
    await renderScreen();
    expect(await screen.findByRole('button', { name: 'Kaydedilenlerden çıkar' })).toBeOnTheScreen();
  });

  describe('more options', () => {
    async function renderAndOpen() {
      await renderScreen();
      await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
      return openOptions();
    }

    it('lists the narrator, another language and the report', async () => {
      const sheet = await renderAndOpen();
      // Named after the story, like the story menus elsewhere.
      expect(sheet.getByRole('header', { name: 'Bremen Mızıkacıları' })).toBeOnTheScreen();
      expect(optionIds(sheet)).toEqual(['story-option-narrator', 'story-option-language', 'story-option-report']);
    });

    it('reports a mistake by mail once the sheet has gone, and names the address when no mail app opens', async () => {
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(true);
      let sheet = await renderAndOpen();

      fireEvent.press(sheet.getByRole('button', { name: 'Metinde hata mı var?, E-postayla bize bildir' }));
      await waitFor(() => expect(screen.queryByTestId('story-options-sheet')).toBeNull());
      await waitFor(() =>
        expect(openURL).toHaveBeenCalledWith(reportMailUrl({ id: 's-1', title: 'Bremen Mızıkacıları' })),
      );
      expect(mockShowDialog).not.toHaveBeenCalled();

      openURL.mockRejectedValueOnce(new Error('no handler'));
      sheet = await openOptions();
      fireEvent.press(sheet.getByTestId('story-option-report'));
      await waitFor(() => expect(mockShowDialog).toHaveBeenCalledTimes(1));
      expect(lastDialog().message).toContain(SUPPORT_EMAIL);
    });

    it('runs the option after the sheet reported the end of its exit, with no timer', async () => {
      await renderScreen();
      await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
      const held = holdTimings();
      const sheet = await openOptions();
      fireEvent(screen.getByTestId('story-options-sheet'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 300 } },
      });
      fireEvent.press(sheet.getByTestId('story-option-narrator'));
      // Leaving, the narrator sheet waits: no timer (the old 350 ms swap)
      // stands in for the exit. (Timers are fake in every test.)
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      expect(screen.getByTestId('story-options-sheet')).toBeOnTheScreen();
      expect(screen.queryByTestId('narrator-sheet')).toBeNull();
      act(() => held[held.length - 1].callback?.(true));
      expect(screen.queryByTestId('story-options-sheet')).toBeNull();
      expect(screen.getByTestId('narrator-sheet')).toBeOnTheScreen();
    });

    it('opens the narrator sheet and the translation requests', async () => {
      const sheet = await renderAndOpen();
      fireEvent.press(sheet.getByTestId('story-option-narrator'));
      expect(await screen.findByTestId('narrator-sheet')).toBeOnTheScreen();
      expect(screen.queryByTestId('story-options-sheet')).toBeNull();
      fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
      await waitFor(() => expect(screen.queryByTestId('narrator-sheet')).toBeNull());

      fireEvent.press((await openOptions()).getByTestId('story-option-language'));
      expect(await screen.findByTestId('translation-request-sheet')).toBeOnTheScreen();
    });

    it('leaves out what does not apply', async () => {
      mockVoiceStore.voiceProfiles = [];
      mockContentLanguage.languages = mockContentLanguage.languages.slice(0, 2);
      const sheet = await renderAndOpen();
      expect(sheet.queryByTestId('story-option-narrator')).toBeNull();
      expect(sheet.queryByTestId('story-option-language')).toBeNull();
      expect(sheet.queryByTestId('story-option-queue')).toBeNull();
      expect(sheet.queryByTestId('story-option-regenerate')).toBeNull();
      expect(sheet.getByTestId('story-option-report')).toBeOnTheScreen();
    });
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s palette', async scheme => {
    const T = themes[scheme];
    await renderScreen(scheme);
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    expect(flatStyle(screen.getByTestId('story-cta-face')).backgroundColor).toBe(T.action);
    expect(flatStyle(screen.getByTestId('story-cta-lip')).backgroundColor).toBe(T.actionLip);
    expect(flatStyle(screen.getByTestId('story-sample-face'))).toMatchObject({
      backgroundColor: T.surface,
      width: 52,
      height: 52,
      borderRadius: 20,
    });
    // The category: its tag.
    expect(flatStyle(screen.getByTestId('story-tag-category')).backgroundColor).toBe(T.cat.dunya.color);
    expect(flatStyle(within(screen.getByTestId('story-tag-category')).getByText('Dünya klasikleri')).color).toBe(T.onCat);
    expect(flatStyle(screen.getByTestId('story-tag-age')).backgroundColor).toBe(T.surface);
    // The picture melts into the canvas; the title is in the canvas text colour.
    expect(screen.getByTestId('story-hero-shade').props.colors[3]).toBe(withAlpha(T.bg, 1));
    expect(flatStyle(within(screen.getByTestId('story-hero-title')).getByText('Bremen Mızıkacıları')).color).toBe(T.text);
    // The top bar's buttons are glass: the surface with a ring, over any picture.
    for (const id of ['appbar-back', 'story-save', 'story-more']) {
      expect(flatStyle(screen.getByTestId(`${id}-face`)).backgroundColor).toBe(T.surface);
    }
    // The chosen narrator card is raised and ringed; the others are cards.
    expect(flatStyle(screen.getByTestId('narrator-card-vp-1-face'))).toMatchObject({
      backgroundColor: T.surface2,
      borderColor: T.action,
    });
    expect(flatStyle(screen.getByTestId('narrator-card-vp-2-face')).backgroundColor).toBe(T.surface);
    expect(flatStyle(screen.getByTestId('story-credits-face')).backgroundColor).toBe(T.surface);
    expect(flatStyle(within(screen.getByTestId('credit-author')).getByText('Yazar')).color).toBe(T.text3);
    // The dock fades the content out into the canvas.
    expect(screen.getByTestId('story-dock').props.colors).toEqual([withAlpha(T.bg, 0), T.bg]);
  });

  it('sizes the dock by its content: two 52dp faces on 3dp lips, centred, never stretched', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    const dock = flatStyle(screen.getByTestId('story-dock'));
    expect(dock.height).toBeUndefined();
    // No bottom inset in the test: max(0, 12) + 8.
    expect(dock).toMatchObject({ paddingTop: 8, paddingBottom: 20 });
    expect(flatStyle(screen.getByTestId('story-cta'))).toMatchObject({ flex: 1, alignSelf: 'center' });
    expect(flatStyle(screen.getByTestId('story-cta-face')).minHeight).toBe(52);
    expect(flatStyle(screen.getByTestId('story-cta-lip')).top).toBe(3);
    expect(flatStyle(screen.getByTestId('story-sample-face'))).toMatchObject({ width: 52, height: 52, borderRadius: 20 });
    expect(flatStyle(screen.getByTestId('story-sample-lip')).top).toBe(3);
    // The label stays on one line and shrinks to fit.
    const label = within(screen.getByTestId('story-cta')).getByText(CTA_OWN);
    expect(label.props.numberOfLines).toBe(1);
    // The scroll ends clear of the dock.
    expect(DOCK_BODY).toBe(63);
    const content = flatStyle({ props: { style: screen.UNSAFE_getByType(ScrollView).props.contentContainerStyle } });
    expect(content.paddingBottom).toBe(63 + 20 + 24);
  });

  it('lifts messages above the dock while the page is on top, and gives the room back when it leaves', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    act(() => {
      fireEvent(screen.getByTestId('story-dock'), 'layout', { nativeEvent: { layout: { height: 83.4 } } });
    });
    expect(snackbar.getState().bottomInset).toBe(83);
    // The measured dock also ends the scroll.
    const content = flatStyle({ props: { style: screen.UNSAFE_getByType(ScrollView).props.contentContainerStyle } });
    expect(content.paddingBottom).toBe(83 + 24);

    act(() => setMockFocused(false));
    expect(snackbar.getState().bottomInset).toBe(0);
    // Focus again reloads the story's narrations: let that answer land in act.
    await act(async () => setMockFocused(true));
    expect(snackbar.getState().bottomInset).toBe(83);
  });

  it('sets the title in Baloo 2 28 with room for its glyphs', async () => {
    await renderScreen();
    const title = await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(flatStyle(title)).toMatchObject({ fontSize: 28, textAlign: 'center' });
    expect(flatStyle(title).lineHeight).toBeGreaterThanOrEqual(27 * 1.3);
  });

  it('is translated', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(screen.getByRole('button', { name: 'Listen in your voice' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Türkçe, Level A2, elementary')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Whose voice should read it?' })).toBeOnTheScreen();
    expect(screen.getByText('World classics')).toBeOnTheScreen();
    // The language of a voice keeps its own name.
    expect(chosenNarrator()).toBe('Annem, Your voice');
    expect(screen.getByRole('radio', { name: 'Emma, English' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Ask for another language' })).toBeOnTheScreen();
  });
});

describe('StoryDetailScreen: requests', () => {
  it('focus asks for the narrations of this story once, never the newest page of all of them', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(mockGetNarrationsByStory).toHaveBeenCalledTimes(1);
    expect(mockGetNarrationsByStory).toHaveBeenCalledWith('s-1');
    expect(mockGetMyNarrations).not.toHaveBeenCalled();
  });

  it('the first mount asks for the voices once, and a focus within 30 s does not again', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(mockVoiceStore.loadVoiceProfiles).toHaveBeenCalledTimes(1);

    act(() => setMockFocused(false));
    await act(async () => setMockFocused(true));
    expect(mockVoiceStore.loadVoiceProfiles).toHaveBeenCalledTimes(1);
    // The narrations and the allowance are fresh on every focus.
    expect(mockGetNarrationsByStory).toHaveBeenCalledTimes(2);
    expect(mockSubscription.loadUsageIfStale).toHaveBeenCalledTimes(2);
  });

  it('the next story page within 30 s does not ask for the voices again, unless they never loaded', async () => {
    const first = await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(mockVoiceStore.loadVoiceProfiles).toHaveBeenCalledTimes(1);
    first.unmount();

    setRoute({ storyId: 's-2' });
    const second = await renderScreen();
    await screen.findByRole('header', { name: 'Parmak Kız' });
    expect(mockVoiceStore.loadVoiceProfiles).toHaveBeenCalledTimes(1);
    second.unmount();

    // A list that never loaded (a new session, an offline start) is asked for.
    runInAction(() => {
      mockVoiceStore.hasLoadedProfiles = false;
    });
    setRoute({ storyId: 's-1' });
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(mockVoiceStore.loadVoiceProfiles).toHaveBeenCalledTimes(2);
  });

  it('shows the narrator and dock shapes while the voices load, then the empty state', async () => {
    mockVoiceStore.voiceProfiles = [];
    mockVoiceStore.hasLoadedProfiles = false;
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    expect(screen.getByTestId('narrator-cards-loading')).toBeOnTheScreen();
    expect(screen.getByTestId('story-dock-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('narrator-empty')).toBeNull();
    expect(screen.queryByTestId('story-cta')).toBeNull();
    // The catalogue is asked for once the push ended, voices known or not
    // (the narrator sheet lists it too), and never drawn over their shapes.
    expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledWith('tr', { quiet: true });
    expect(screen.queryByTestId('narrator-catalogue-cards-loading')).toBeNull();

    // The first load settles with no voice.
    await act(async () => {
      runInAction(() => {
        mockVoiceStore.hasLoadedProfiles = true;
      });
    });
    expect(screen.getByTestId('narrator-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('narrator-cards-loading')).toBeNull();
  });

  it('voices that arrive after the page drew bring their narrator in the same commit (RB-2)', async () => {
    const profiles = mockVoiceStore.voiceProfiles;
    mockVoiceStore.voiceProfiles = [];
    mockVoiceStore.hasLoadedProfiles = false;
    // Every commit's main button, read while React commits it (the frame
    // that would be painted), never only the settled end state.
    const committed: string[] = [];
    let rendered = false;
    const record = () => {
      // The first commit lands before `screen` knows the tree (no button yet then).
      if (!rendered) return;
      const cta = screen.queryByTestId('story-cta');
      if (cta) committed.push(String(cta.props.accessibilityLabel));
    };
    renderWithProviders(
      <React.Profiler id="story-detail" onRender={record}>
        <StoryDetailScreen />
      </React.Profiler>,
    );
    rendered = true;
    await act(async () => undefined);
    finishTransition();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(screen.queryByTestId('story-cta')).toBeNull();

    // The cold start's late voice list.
    await act(async () => {
      runInAction(() => {
        mockVoiceStore.voiceProfiles = profiles;
        mockVoiceStore.hasLoadedProfiles = true;
      });
    });

    expect(committed.length).toBeGreaterThan(0);
    // Not one commit with "Anlatıcı seç" while a narrator is there to pick.
    expect(committed).not.toContain('Anlatıcı seç');
    expect(committed[0]).toBe(CTA_OWN);
    expect(chosenNarrator()).toMatch(/^Annem/);
    expect(screen.getByTestId('story-cta').props.accessibilityLabel).toBe(CTA_OWN);
  });

  it('remembers the meta of the ready narrations, with the story, for the player', async () => {
    mockGetNarrationsByStory.mockResolvedValue([storyNarration('n-1', 'vp-2', 'READY')]);
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    await waitFor(() => expect(getNarrationMeta('n-1')).not.toBeNull());
    expect(getNarrationMeta('n-1')).toMatchObject({
      storyId: 's-1',
      story: { id: 's-1', title: 'Bremen Mızıkacıları' },
      narratorName: 'Deniz',
      ownVoice: false,
    });
  });
});

describe('StoryDetailScreen: the narrator chosen first', () => {
  it('preselects the own voice and starts the narration with it', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    expect(screen.getByRole('header', { name: 'Kimin sesiyle dinlesin?' })).toBeOnTheScreen();
    // Three cards, the own voice first and chosen.
    expect(
      within(screen.getByTestId('narrator-cards'))
        .getAllByRole('radio')
        .map(node => node.props.accessibilityLabel),
    ).toEqual(['Annem, Senin sesin', 'Deniz, Hazır anlatıcı', 'Emma, English']);
    expect(chosenNarrator()).toBe('Annem, Senin sesin');
    // Same language as the story: nothing to explain.
    expect(screen.queryByTestId('narrator-language-note')).toBeNull();

    const cta = screen.getByRole('button', { name: CTA_OWN });
    expect(cta).toBeEnabled();
    fireEvent.press(cta);
    await confirmNarration();

    expect(mockNavigation.navigate).toHaveBeenCalledWith('AudioGeneration', {
      storyId: 's-1',
      voiceProfileId: 'vp-1',
      replace: false,
    });
    expect(mockShowDialog).not.toHaveBeenCalled();
  });

  it('a READY narration preselects its narrator, even when it arrives after the voices', async () => {
    let resolveNarrations: (value: unknown) => void = () => undefined;
    mockGetNarrationsByStory.mockReturnValue(new Promise(resolve => (resolveNarrations = resolve)));
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(chosenNarrator()).toBe('Annem, Senin sesin');

    await act(async () => {
      resolveNarrations([storyNarration('n-1', 'vp-2', 'READY')]);
    });
    expect(chosenNarrator()).toBe('Deniz, Hazır anlatıcı');
    expect(screen.getByRole('button', { name: 'Dinle' })).toBeOnTheScreen();
  });

  it('a tap is never replaced by narrations that arrive later', async () => {
    let resolveNarrations: (value: unknown) => void = () => undefined;
    mockGetNarrationsByStory.mockReturnValue(new Promise(resolve => (resolveNarrations = resolve)));
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    fireEvent.press(screen.getByRole('radio', { name: 'Emma, English' }));
    await act(async () => {
      resolveNarrations([storyNarration('n-1', 'vp-2', 'READY')]);
    });
    expect(chosenNarrator()).toBe('Emma, English');
  });

  it('the narrator chosen on another story comes first next time', async () => {
    const view = await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    fireEvent.press(screen.getByRole('radio', { name: 'Deniz, Hazır anlatıcı' }));
    expect(await AsyncStorage.getItem('@sesly/lastNarrator')).toBe('vp-2');
    view.unmount();

    setRoute({ storyId: 's-2' });
    await renderScreen();
    await screen.findByRole('header', { name: 'Parmak Kız' });
    expect(chosenNarrator()).toBe('Deniz, Hazır anlatıcı');
  });

  it('passes over the own voice when its allowance is used up', async () => {
    mockSubscription.usage = usage(bucket(20, 12), bucket(1, 0, 'lifetime'));
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(chosenNarrator()).toBe('Deniz, Hazır anlatıcı');
  });

  it('selects the narrator handed back as selectVoiceId once the voices list it, then clears the param', async () => {
    const created = { ...voice('vp-new', 'Puck', 'PRESET'), voiceId: 'tr-TR-Chirp3-HD-Puck' };
    setRoute({ storyId: 's-1', selectVoiceId: 'vp-new' });
    mockVoiceStore.loadVoiceProfiles.mockImplementation(async () => {
      runInAction(() => {
        mockVoiceStore.voiceProfiles = [...mockVoiceStore.voiceProfiles, created];
      });
    });
    const view = await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    view.rerender(<StoryDetailScreen />);
    await act(async () => undefined);

    await waitFor(() => expect(chosenNarrator()).toBe('Puck, Hazır anlatıcı'));
    expect(mockNavigation.setParams).toHaveBeenCalledWith({ selectVoiceId: undefined });
    expect(screen.getByRole('button', { name: 'Puck anlatsın' })).toBeOnTheScreen();
  });
});

describe('StoryDetailScreen: listening', () => {
  it('a READY narration of the chosen narrator reads "Dinle" and opens the player playing, with no dialog', async () => {
    mockGetNarrationsByStory.mockResolvedValue([storyNarration('n-1', 'vp-1', 'READY')]);
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    fireEvent.press(await screen.findByRole('button', { name: 'Dinle' }));
    expect(mockShowDialog).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'n-1', autoplay: true });
    // The player draws the title at once from the remembered meta.
    expect(getNarrationMeta('n-1')?.story.title).toBe('Bremen Mızıkacıları');
    // Listening costs nothing: no allowance line.
    expect(screen.queryByTestId('story-quota-left')).toBeNull();
  });

  it('"Baştan hazırla" is in the options, uses the allowance and names what is left', async () => {
    mockGetNarrationsByStory.mockResolvedValue([storyNarration('n-1', 'vp-1', 'READY')]);
    mockSubscription.usage = usage(bucket(20, 12), bucket(5, 4), 'mini');
    await renderScreen();
    await screen.findByRole('button', { name: 'Dinle' });

    const options = await openOptions();
    expect(options.getByRole('button', { name: 'Baştan hazırla, Bir masal hakkı kullanır' })).toBeOnTheScreen();
    fireEvent.press(options.getByTestId('story-option-regenerate'));

    // The confirmation, once the options have gone: what replaces what and the cost.
    const sheet = await confirmSheet();
    expect(screen.queryByTestId('story-options-sheet')).toBeNull();
    expect(sheet.getByRole('header', { name: 'Baştan hazırlansın mı?' })).toBeOnTheScreen();
    expect(sheet.getByTestId('narration-confirm-sheet-replaces')).toHaveTextContent('Yenisi eskisinin yerini alır.');
    expect(sheet.getByTestId('narration-confirm-sheet-cost')).toHaveTextContent(
      'Kendi sesinle masal hakkından 1 kullanır (bu ay 1/5).',
    );
    expect(mockShowDialog).not.toHaveBeenCalled();
    await confirmNarration();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('AudioGeneration', {
      storyId: 's-1',
      voiceProfileId: 'vp-1',
      replace: true,
    });
    expect(generationCalls()).toHaveLength(1);
  });

  it('an unlimited allowance says only what a new one replaces', async () => {
    mockGetNarrationsByStory.mockResolvedValue([storyNarration('n-1', 'vp-2', 'READY')]);
    mockSubscription.usage = usage(bucket(null, null), bucket(5, 4), 'mini');
    await renderScreen();
    await screen.findByRole('button', { name: 'Dinle' });
    const options = await openOptions();
    fireEvent.press(options.getByRole('button', { name: 'Baştan hazırla, Yenisi eskisinin yerini alır' }));
    const sheet = await confirmSheet();
    expect(sheet.getByTestId('narration-confirm-sheet-replaces')).toBeOnTheScreen();
    // Unlimited ready-made narrators: no cost line at all.
    expect(sheet.queryByTestId('narration-confirm-sheet-cost')).toBeNull();
    expect(sheet.getByRole('button', { name: 'Seslendir' })).toBeOnTheScreen();
  });

  it('a used-up allowance says so with the plans, instead of "Seslendir"', async () => {
    mockSubscription.usage = usage(bucket(20, 12), bucket(1, 0, 'lifetime'));
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    // The own voice is passed over by default; choose it.
    fireEvent.press(screen.getByRole('radio', { name: 'Annem, Senin sesin' }));
    fireEvent.press(screen.getByRole('button', { name: CTA_OWN }));

    const sheet = await confirmSheet();
    expect(sheet.getByTestId('narration-confirm-sheet-used-up')).toHaveTextContent(/Kendi sesinle masal hakkın doldu/);
    expect(sheet.queryByRole('button', { name: 'Seslendir' })).toBeNull();
    expect(sheet.queryByTestId('narration-confirm-sheet-cost')).toBeNull();
    expect(mockShowDialog).not.toHaveBeenCalled();
    fireEvent.press(sheet.getByRole('button', { name: 'Planları gör' }));
    await waitFor(() =>
      expect(mockNavigation.navigate).toHaveBeenCalledWith('Subscription', { reason: 'quota' }, { pop: true }),
    );
    expect(generationCalls()).toHaveLength(0);
  });

  it('says how many stories are left from three down, never for an unlimited allowance', async () => {
    mockSubscription.usage = usage(bucket(20, 2), bucket(5, 4), 'free');
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    // The own voice: 4 left, no line.
    expect(screen.queryByTestId('story-quota-left')).toBeNull();
    fireEvent.press(screen.getByRole('radio', { name: 'Deniz, Hazır anlatıcı' }));
    expect(screen.getByTestId('story-quota-left')).toHaveTextContent('Bu ay 2 masal hakkın kaldı');

    act(() => {
      runInAction(() => {
        mockSubscription.usage = usage(bucket(null, null), bucket(5, 4), 'mini');
      });
    });
    expect(screen.queryByTestId('story-quota-left')).toBeNull();
  });

  it('does not start a second narration while one is being prepared', async () => {
    mockGetNarrationsByStory.mockResolvedValue([storyNarration('n-1', 'vp-1', 'GENERATING')]);
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    fireEvent.press(await screen.findByRole('button', { name: 'Hazırlanıyor' }));

    expect(mockNavigation.navigate).not.toHaveBeenCalled();
    const dialog = lastDialog();
    expect(dialog.title).toBe('Masalın hazırlanıyor');
    act(() => dialog.buttons?.find(b => b.text === 'İlerlemeyi gör')?.onPress?.());
    expect(mockNavigation.navigate).toHaveBeenCalledWith('AudioGeneration', {
      storyId: 's-1',
      voiceProfileId: 'vp-1',
      replace: false,
    });
  });

  it('a narrator card is chosen with one tap, and the action names it', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    fireEvent.press(screen.getByRole('radio', { name: 'Deniz, Hazır anlatıcı' }));
    expect(chosenNarrator()).toBe('Deniz, Hazır anlatıcı');
    fireEvent.press(screen.getByRole('button', { name: 'Deniz anlatsın' }));
    await confirmNarration();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('AudioGeneration', {
      storyId: 's-1',
      voiceProfileId: 'vp-2',
      replace: false,
    });
  });

  it('plays the sample of the chosen narrator from the dock, and stops it before the narration starts', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    fireEvent.press(screen.getByRole('button', { name: 'Annem örneğini dinle' }));
    await waitFor(() =>
      expect(mockAudioPlayer.playFromUrl).toHaveBeenCalledWith(
        'https://cdn.test/own.wav',
        expect.objectContaining({ key: 'vp-1', title: 'Annem' }),
      ),
    );
    expect(await screen.findByRole('button', { name: 'Annem örneğini durdur' })).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('story-cta'));
    // The sample stops as the confirmation opens.
    await waitFor(() => expect(mockAudioPlayer.stopPreview).toHaveBeenCalledWith('vp-1'));
    await confirmNarration();
    expect(mockAudioPlayer.stopAndCleanup).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).toHaveBeenCalledWith(
      'AudioGeneration',
      expect.objectContaining({ voiceProfileId: 'vp-1' }),
    );
  });
});

describe('StoryDetailScreen: the confirmation before a new narration', () => {
  it('names the story, its part, language, length, age, warnings and the AI mark, then the voice', async () => {
    mockGetStoryById.mockImplementation(() =>
      Promise.resolve(
        parseStoryDetailFromJSON({
          ...STORY_JSON,
          contentWarnings: ['DEATH', 'SCARY'],
          credit: { ...STORY_JSON.credit, translatorName: null, translationMethod: 'MACHINE' },
          part: { number: 2, total: 3, next: null, previous: null },
        }),
      ),
    );
    mockSubscription.usage = usage(bucket(20, 16), bucket(1, 1, 'lifetime'));
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    fireEvent.press(screen.getByRole('radio', { name: 'Deniz, Hazır anlatıcı' }));
    fireEvent.press(screen.getByRole('button', { name: 'Deniz anlatsın' }));

    const sheet = await confirmSheet();
    expect(sheet.getByRole('header', { name: 'Bu masal seslendirilsin mi?' })).toBeOnTheScreen();
    expect(sheet.getByTestId('narration-confirm-sheet-title')).toHaveTextContent('Bremen Mızıkacıları');
    expect(sheet.getByTestId('narration-confirm-sheet-part')).toHaveTextContent('Bölüm 2 / 3');
    expect(sheet.getByTestId('narration-confirm-sheet-story-line')).toHaveTextContent('Türkçe, yaklaşık 6 dk, 3-6 yaş');
    expect(within(sheet.getByTestId('narration-confirm-sheet-warning-SCARY')).getByText('Korkutucu sahne')).toBeOnTheScreen();
    expect(within(sheet.getByTestId('narration-confirm-sheet-warning-DEATH')).getByText('Ölüm')).toBeOnTheScreen();
    expect(
      within(sheet.getByTestId('narration-confirm-sheet-machine')).getByText('Yapay zekâ ile çevrildi'),
    ).toBeOnTheScreen();
    expect(sheet.getByTestId('narration-confirm-sheet-voice').props.accessibilityLabel).toBe(
      'Anlatıcı: Deniz, Hazır anlatıcı, Türkçe',
    );
    expect(sheet.getByTestId('narration-confirm-sheet-voice-line')).toHaveTextContent('Hazır anlatıcı, Türkçe');
    expect(sheet.queryByTestId('narration-confirm-sheet-language')).toBeNull();
    // Free plan: the ready-made allowance, as used of the month's limit.
    expect(sheet.getByTestId('narration-confirm-sheet-cost')).toHaveTextContent(
      'Bu seslendirme hazır anlatıcı hakkından 1 kullanır (bu ay 4/20).',
    );
    expect(sheet.queryByTestId('narration-confirm-sheet-replaces')).toBeNull();
    // "Seslendir" (primary, md) and "Vazgeç".
    expect(flatStyle(sheet.getByTestId('narration-confirm-sheet-confirm-face'))).toMatchObject({ minHeight: 44 });
    expect(sheet.getByRole('button', { name: 'Vazgeç' })).toBeOnTheScreen();
    // Nothing starts before the confirmation.
    expect(generationCalls()).toHaveLength(0);
  });

  it('a story without part, warnings or AI translation shows none of them', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    fireEvent.press(screen.getByTestId('story-cta'));
    const sheet = await confirmSheet();
    expect(sheet.queryByTestId('narration-confirm-sheet-part')).toBeNull();
    expect(sheet.queryByTestId('narration-confirm-sheet-tags')).toBeNull();
  });

  it('the own voice names its own allowance; an unlimited plan says nothing for a ready-made one', async () => {
    mockSubscription.usage = usage(bucket(null, null), bucket(20, 18), 'premium');
    mockSubscription.planId = 'premium';
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    fireEvent.press(screen.getByRole('button', { name: CTA_OWN }));
    let sheet = await confirmSheet();
    expect(sheet.getByTestId('narration-confirm-sheet-voice-line')).toHaveTextContent('Kendi sesin, Türkçe');
    expect(sheet.getByTestId('narration-confirm-sheet-cost')).toHaveTextContent(
      'Kendi sesinle masal hakkından 1 kullanır (bu ay 2/20).',
    );
    fireEvent.press(sheet.getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => expect(screen.queryByTestId('narration-confirm-sheet')).toBeNull());

    fireEvent.press(screen.getByRole('radio', { name: 'Deniz, Hazır anlatıcı' }));
    fireEvent.press(screen.getByRole('button', { name: 'Deniz anlatsın' }));
    sheet = await confirmSheet();
    expect(sheet.queryByTestId('narration-confirm-sheet-cost')).toBeNull();
    expect(sheet.getByRole('button', { name: 'Seslendir' })).toBeOnTheScreen();
  });

  it('without an answer from GET /usage the plan says which allowance it uses', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    fireEvent.press(screen.getByRole('radio', { name: 'Deniz, Hazır anlatıcı' }));
    fireEvent.press(screen.getByRole('button', { name: 'Deniz anlatsın' }));
    expect((await confirmSheet()).getByTestId('narration-confirm-sheet-cost')).toHaveTextContent(
      'Bu seslendirme hazır anlatıcı hakkından 1 kullanır.',
    );
  });

  it('"Seslendir" starts exactly one narration, however often it is tapped', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    fireEvent.press(screen.getByTestId('story-cta'));
    const sheet = await confirmSheet();
    const confirm = sheet.getByRole('button', { name: 'Seslendir' });
    fireEvent.press(confirm);
    fireEvent.press(confirm);
    fireEvent.press(confirm);
    await waitFor(() => expect(screen.queryByTestId('narration-confirm-sheet')).toBeNull());
    expect(generationCalls()).toEqual([
      ['AudioGeneration', { storyId: 's-1', voiceProfileId: 'vp-1', replace: false }],
    ]);
  });

  it('a double tap on the action opens one confirmation and starts nothing by itself', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    fireEvent.press(screen.getByTestId('story-cta'));
    fireEvent.press(screen.getByTestId('story-cta'));
    await confirmSheet();
    expect(screen.getAllByTestId('narration-confirm-sheet')).toHaveLength(1);
    expect(generationCalls()).toHaveLength(0);
    await confirmNarration();
    expect(generationCalls()).toHaveLength(1);
  });

  it('"Vazgeç", the scrim and back start nothing', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    fireEvent.press(screen.getByTestId('story-cta'));
    fireEvent.press((await confirmSheet()).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => expect(screen.queryByTestId('narration-confirm-sheet')).toBeNull());

    fireEvent.press(screen.getByTestId('story-cta'));
    await confirmSheet();
    fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
    await waitFor(() => expect(screen.queryByTestId('narration-confirm-sheet')).toBeNull());

    expect(generationCalls()).toHaveLength(0);
    // The next open asks again and starts on "Seslendir" only.
    fireEvent.press(screen.getByTestId('story-cta'));
    await confirmNarration();
    expect(generationCalls()).toHaveLength(1);
  });

  it('playing a ready narration never asks', async () => {
    mockGetNarrationsByStory.mockResolvedValue([storyNarration('n-1', 'vp-1', 'READY')]);
    await renderScreen();
    fireEvent.press(await screen.findByRole('button', { name: 'Dinle' }));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'n-1', autoplay: true });
    expect(screen.queryByTestId('narration-confirm-sheet')).toBeNull();
    expect(generationCalls()).toHaveLength(0);
  });

  it('following a narration that is being prepared never asks', async () => {
    mockGetNarrationsByStory.mockResolvedValue([storyNarration('n-1', 'vp-1', 'GENERATING')]);
    await renderScreen();
    fireEvent.press(await screen.findByRole('button', { name: 'Hazırlanıyor' }));
    act(() => lastDialog().buttons?.find(b => b.text === 'İlerlemeyi gör')?.onPress?.());
    expect(screen.queryByTestId('narration-confirm-sheet')).toBeNull();
    expect(generationCalls()).toHaveLength(1);
  });

  it('is translated', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    mockSubscription.usage = usage(bucket(20, 16), bucket(1, 1, 'lifetime'));
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    fireEvent.press(screen.getByRole('button', { name: 'Listen in your voice' }));
    const sheet = await confirmSheet();
    expect(sheet.getByTestId('narration-confirm-sheet-story-line')).toHaveTextContent('Türkçe, about 6 min, Ages 3-6');
    expect(sheet.getByTestId('narration-confirm-sheet-cost')).toHaveTextContent(
      'Uses 1 of your own-voice stories (in total 0/1).',
    );
  });
});

describe('StoryDetailScreen: the queue', () => {
  it('offers "Sıraya ekle" only with a READY narration of the chosen narrator', async () => {
    mockGetNarrationsByStory.mockResolvedValue([storyNarration('n-2', 'vp-2', 'READY')]);
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    // Deniz's narration is ready, so Deniz is chosen; Annem has none.
    fireEvent.press(screen.getByRole('radio', { name: 'Annem, Senin sesin' }));
    let sheet = await openOptions();
    expect(sheet.queryByTestId('story-option-queue')).toBeNull();
    fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
    await waitFor(() => expect(screen.queryByTestId('story-options-sheet')).toBeNull());

    fireEvent.press(screen.getByRole('radio', { name: 'Deniz, Hazır anlatıcı' }));
    sheet = await openOptions();
    expect(optionIds(sheet)).toEqual([
      'story-option-narrator',
      'story-option-queue',
      'story-option-regenerate',
      'story-option-language',
      'story-option-report',
    ]);
  });

  it('adds that narration once the sheet has gone, and says so with "Sırayı aç"', async () => {
    mockGetNarrationsByStory.mockResolvedValue([
      storyNarration('n-old', 'vp-2', 'READY', '2026-09-01T10:00:00Z'),
      storyNarration('n-2', 'vp-2', 'READY', '2026-09-20T10:00:00Z'),
    ]);
    await renderScreen();
    await screen.findByRole('button', { name: 'Dinle' });

    const sheet = await openOptions();
    fireEvent.press(sheet.getByRole('button', { name: 'Sıraya ekle, Deniz anlatıyor' }));
    await waitFor(() => expect(queueStore.has('n-2')).toBe(true));
    expect(queueStore.has('n-old')).toBe(false);
    expect(queueStore.entries[0]).toMatchObject({ narrationId: 'n-2', storyId: 's-1' });
    expect(queueStore.entries[0].story.title).toBe('Bremen Mızıkacıları');
    expect(showToast.success).toHaveBeenCalledWith(
      'Sıraya eklendi',
      undefined,
      expect.objectContaining({ label: 'Sırayı aç' }),
    );
  });

  it('offers "Sıradan çıkar" when that narration is queued', async () => {
    mockGetNarrationsByStory.mockResolvedValue([storyNarration('n-2', 'vp-2', 'READY')]);
    await renderScreen();
    await screen.findByRole('button', { name: 'Dinle' });
    let sheet = await openOptions();
    fireEvent.press(sheet.getByTestId('story-option-queue'));
    await waitFor(() => expect(queueStore.has('n-2')).toBe(true));

    sheet = await openOptions();
    fireEvent.press(sheet.getByRole('button', { name: 'Sıradan çıkar, Deniz anlatıyor' }));
    await waitFor(() => expect(queueStore.has('n-2')).toBe(false));
    expect(showToast.info).toHaveBeenCalledWith(
      'Sıradan çıkarıldı',
      undefined,
      expect.objectContaining({ label: 'Geri al' }),
    );
  });
});

describe('StoryDetailScreen: a user without a voice', () => {
  const TR_CATALOGUE = [
    catalogueVoice('Achernar', 'female'),
    catalogueVoice('Puck', 'male'),
    catalogueVoice('Kore', 'female'),
    catalogueVoice('Orus', 'male'),
  ];

  it('offers the first three narrators of the catalogue, with samples, and asks for the catalogue quietly', async () => {
    mockVoiceStore.voiceProfiles = [];
    mockVoiceStore.catalogueFor.mockReturnValue(TR_CATALOGUE);
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    const empty = within(screen.getByTestId('narrator-empty'));
    expect(empty.getAllByRole('radio').map(node => node.props.accessibilityLabel)).toEqual([
      'Achernar, Hazır anlatıcı',
      'Puck, Hazır anlatıcı',
      'Kore, Hazır anlatıcı',
    ]);
    fireEvent.press(empty.getByRole('button', { name: 'Puck örneğini dinle' }));
    await waitFor(() => expect(mockPreviewVoice).toHaveBeenCalledWith('tr-TR-Chirp3-HD-Puck', 'GOOGLE'));
    expect(await empty.findByRole('button', { name: 'Puck örneğini durdur' })).toBeOnTheScreen();
  });

  it('asks for the catalogue of the story language when the user has no voice', async () => {
    mockVoiceStore.voiceProfiles = [];
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledWith('tr', { quiet: true });
  });

  it('draws the catalogue in its shapes before its request is out, never the fallback card first', async () => {
    mockVoiceStore.voiceProfiles = [];
    // Neither listed nor failed, and the store is not loading yet: the frame
    // before the request (and the catalogue's own loading flag) starts.
    mockVoiceStore.loadAvailableVoices.mockImplementation(() => new Promise(() => undefined));
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(screen.getByTestId('narrator-catalogue-cards-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('narrator-empty-pick-ready')).toBeNull();

    // The request failed: the card with both ways in.
    await act(async () => {
      runInAction(() => {
        mockVoiceStore.catalogueError = 'Anlatıcılar yüklenemedi.';
      });
    });
    expect(screen.getByTestId('narrator-empty-pick-ready')).toBeOnTheScreen();
    expect(screen.queryByTestId('narrator-catalogue-cards-loading')).toBeNull();
  });

  it('choosing one adds it and selects it: the action then names it', async () => {
    mockVoiceStore.voiceProfiles = [];
    mockVoiceStore.catalogueFor.mockReturnValue(TR_CATALOGUE);
    const created = { ...voice('vp-new', 'Puck', 'PRESET'), voiceId: 'tr-TR-Chirp3-HD-Puck' };
    mockVoiceStore.createVoiceProfile.mockImplementation(async () => {
      runInAction(() => {
        mockVoiceStore.voiceProfiles = [created];
      });
      return { profile: created, error: null };
    });
    const view = await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    fireEvent.press(screen.getByRole('radio', { name: 'Puck, Hazır anlatıcı' }));
    await waitFor(() => expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledTimes(1));
    view.rerender(<StoryDetailScreen />);
    await act(async () => undefined);
    expect(chosenNarrator()).toBe('Puck, Hazır anlatıcı');
    const cta = screen.getByRole('button', { name: 'Puck anlatsın' });
    expect(cta).toBeEnabled();
  });

  it('the action opens the narrator sheet instead of waiting dimmed, and the own voice is a quiet text button', async () => {
    mockVoiceStore.voiceProfiles = [];
    mockVoiceStore.catalogueFor.mockReturnValue(TR_CATALOGUE);
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    const cta = screen.getByRole('button', { name: 'Anlatıcı seç' });
    expect(cta).toBeEnabled();
    fireEvent.press(cta);
    expect(await screen.findByTestId('narrator-sheet')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
    await waitFor(() => expect(screen.queryByTestId('narrator-sheet')).toBeNull());

    // A text button: no face of its own that could take the card colour.
    const addOwn = screen.getByTestId('narrator-empty-add-own');
    const face = flatStyle(screen.getByTestId('narrator-empty-add-own-face'));
    expect(face.backgroundColor === 'transparent' || face.backgroundColor === undefined).toBe(true);
    fireEvent.press(addOwn);
    await waitFor(() =>
      expect(mockNavigation.navigate).toHaveBeenCalledWith('CreateVoiceProfile', { returnToStoryId: 's-1' }),
    );
    expect(mockVoiceStore.checkCanCreate).toHaveBeenCalledWith('clone');
  });

  it('has no sample to play without a narrator, and says why to a screen reader', async () => {
    mockVoiceStore.voiceProfiles = [];
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    const sample = screen.getByTestId('story-sample');
    expect(sample).toBeDisabled();
    expect(sample.props.accessibilityLabel).toBe('Önce bir anlatıcı seç');
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)(
    'without a catalogue the card offers both ways, the ready-made one on its own colour (%s)',
    async scheme => {
      const T = themes[scheme];
      mockVoiceStore.voiceProfiles = [];
      await renderScreen(scheme);
      await screen.findByText('Önce bir anlatıcı seç');
      const card = flatStyle(screen.getByTestId('narrator-empty-face')).backgroundColor;
      const pick = flatStyle(screen.getByTestId('narrator-empty-pick-ready-face')).backgroundColor;
      expect(pick).toBe(T.action);
      expect(pick).not.toBe(card);

      fireEvent.press(screen.getByRole('button', { name: 'Hazır anlatıcı seç' }));
      expect(mockNavigation.navigate).toHaveBeenCalledWith('NarratorCatalogue', {
        pickForStory: true,
        language: 'tr',
        storyId: 's-1',
      });
      // No clone slot check for a ready-made pick.
      expect(mockVoiceStore.checkCanCreate).not.toHaveBeenCalled();
    },
  );

  it('explains a full clone allowance over the page and offers the plans, the way out first', async () => {
    mockVoiceStore.voiceProfiles = [];
    mockVoiceStore.checkCanCreate.mockResolvedValue(false);
    mockVoiceStore.slotBlock.mockReturnValue({
      title: 'Kendi ses hakkın doldu',
      message: 'Hakkının tamamını kullandın.',
      showPaywall: true,
    });
    await renderScreen();

    fireEvent.press(await screen.findByRole('button', { name: 'Kendi sesini ekle' }));
    await waitFor(() => expect(mockShowDialog).toHaveBeenCalledTimes(1));
    expect(mockVoiceStore.slotBlock).toHaveBeenCalledWith('clone', 'free');
    expect(mockNavigation.navigate).not.toHaveBeenCalled();

    const dialog = lastDialog();
    expect(dialog.title).toBe('Kendi ses hakkın doldu');
    expect(dialog.buttons?.map(b => b.text)).toEqual(['Vazgeç', 'Planları gör']);
    act(() => dialog.buttons?.[1].onPress?.());
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Subscription', { reason: 'voices' }, { pop: true });
  });

  it('loads the clone texts while it checks the slots, once, so the intro opens complete (V5)', async () => {
    mockVoiceStore.voiceProfiles = [];
    let allow: (ok: boolean) => void = () => undefined;
    mockVoiceStore.checkCanCreate.mockImplementation(() => new Promise<boolean>(resolve => (allow = resolve)));
    await renderScreen();

    fireEvent.press(await screen.findByRole('button', { name: 'Kendi sesini ekle' }));
    // Started before the slot check answered.
    expect(mockVoiceStore.loadCloneConfig).toHaveBeenCalledWith('tr');
    await act(async () => {
      allow(true);
    });
    await waitFor(() =>
      expect(mockNavigation.navigate).toHaveBeenCalledWith('CreateVoiceProfile', { returnToStoryId: 's-1' }),
    );
    // Texts already loaded (or loading) are not asked for again.
    mockVoiceStore.cloneConfig = { language: 'tr' };
    mockVoiceStore.checkCanCreate.mockResolvedValue(true);
    fireEvent.press(screen.getByRole('button', { name: 'Kendi sesini ekle' }));
    await waitFor(() => expect(mockNavigation.navigate).toHaveBeenCalledTimes(2));
    expect(mockVoiceStore.loadCloneConfig).toHaveBeenCalledTimes(1);
  });

  it('offers no plans on the top plan when the clone slots are full', async () => {
    mockSubscription.planId = 'premium';
    mockVoiceStore.voiceProfiles = [];
    mockVoiceStore.checkCanCreate.mockResolvedValue(false);
    mockVoiceStore.slotBlock.mockReturnValue({ title: 'Dolu', message: 'Birini sil.', showPaywall: false });
    await renderScreen();

    fireEvent.press(await screen.findByRole('button', { name: 'Kendi sesini ekle' }));
    await waitFor(() => expect(mockShowDialog).toHaveBeenCalledTimes(1));
    expect(mockVoiceStore.slotBlock).toHaveBeenCalledWith('clone', 'premium');
    expect(lastDialog().buttons?.map(b => b.text)).toEqual(['Tamam']);
  });

  it('puts the way to record the own voice first when there is none, and comes back to this story', async () => {
    mockVoiceStore.voiceProfiles = [voice('vp-2', 'Deniz', 'PRESET')];
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    expect(chosenNarrator()).toBe('Deniz, Hazır anlatıcı');
    fireEvent.press(screen.getByTestId('narrator-card-add-own'));
    await waitFor(() =>
      expect(mockNavigation.navigate).toHaveBeenCalledWith('CreateVoiceProfile', { returnToStoryId: 's-1' }),
    );
    expect(mockVoiceStore.checkCanCreate).toHaveBeenCalledWith('clone');
  });
});

describe('StoryDetailScreen: a voice of another language', () => {
  const OWN_EN = () => voice('vp-en', 'Mom', 'CLONE', 'en-US');

  it('the confirmation warns before the own voice of another language reads the story', async () => {
    // The story is Turkish; the only voice is the user's English one.
    mockVoiceStore.voiceProfiles = [OWN_EN()];
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    // The own voice card names the language of the voice.
    expect(chosenNarrator()).toBe('Mom, English');
    expect(screen.getByRole('button', { name: 'Senin sesinle dinle' })).toBeOnTheScreen();
    // An own voice gets the warning, not the quiet line.
    expect(screen.queryByTestId('narrator-language-note')).toBeNull();

    fireEvent.press(screen.getByTestId('story-cta'));

    const sheet = await confirmSheet();
    expect(mockShowDialog).not.toHaveBeenCalled();
    expect(sheet.getByTestId('narration-confirm-sheet-voice-line')).toHaveTextContent('Kendi sesin, English');
    expect(sheet.getByTestId('narration-confirm-sheet-language-text')).toHaveTextContent(
      'Dil uyuşmuyor. Bu ses İngilizce, masal Türkçe. Aksan kaymaları olabilir ama dinlenebilir.',
    );

    // "Vazgeç" starts nothing.
    fireEvent.press(sheet.getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => expect(screen.queryByTestId('narration-confirm-sheet')).toBeNull());
    expect(generationCalls()).toHaveLength(0);

    fireEvent.press(screen.getByTestId('story-cta'));
    await confirmNarration();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('AudioGeneration', {
      storyId: 's-1',
      voiceProfileId: 'vp-en',
      replace: false,
    });
  });

  it('no language warning when the own voice speaks the story language', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    fireEvent.press(screen.getByTestId('story-cta'));
    const sheet = await confirmSheet();
    expect(sheet.queryByTestId('narration-confirm-sheet-language')).toBeNull();
    await confirmNarration();
    expect(mockShowDialog).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).toHaveBeenCalledWith(
      'AudioGeneration',
      expect.objectContaining({ voiceProfileId: 'vp-1' }),
    );
  });

  it('a mismatched voice that already read the story just plays it', async () => {
    mockVoiceStore.voiceProfiles = [{ ...OWN_EN(), id: 'vp-1' }];
    mockGetNarrationsByStory.mockResolvedValue([storyNarration('n-1', 'vp-1', 'READY')]);
    await renderScreen();
    fireEvent.press(await screen.findByRole('button', { name: 'Dinle' }));
    expect(mockShowDialog).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'n-1', autoplay: true });
  });

  it('a ready-made narrator of another language is not blocked: one quiet line says how it reads', async () => {
    // Only an English narrator; the story is Turkish.
    mockVoiceStore.voiceProfiles = [voice('vp-3', 'Emma', 'PRESET', 'en-US')];
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    expect(chosenNarrator()).toBe('Emma, English');
    expect(screen.getByRole('button', { name: 'Emma anlatsın' })).toBeOnTheScreen();
    expect(screen.getByTestId('narrator-language-note')).toHaveTextContent(
      'Bu anlatıcı masalı Türkçe sesiyle okur.',
    );
    // The catalogue of the story language is asked for, quietly, to know
    // whether the narrator has a voice in it.
    expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledWith('tr', { quiet: true });

    fireEvent.press(screen.getByTestId('story-cta'));
    // The same quiet line in the confirmation.
    const sheet = await confirmSheet();
    expect(sheet.getByTestId('narration-confirm-sheet-language-text')).toHaveTextContent(
      'Bu anlatıcı masalı Türkçe sesiyle okur.',
    );
    await confirmNarration();
    expect(mockShowDialog).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('AudioGeneration', {
      storyId: 's-1',
      voiceProfileId: 'vp-3',
      replace: false,
    });
  });

  it('says a ready-made narrator will sound accented when it has no voice in the story language', async () => {
    mockVoiceStore.voiceProfiles = [voice('vp-3', 'Emma', 'PRESET', 'en-US')];
    // The Turkish catalogue is loaded and has no Emma.
    mockVoiceStore.catalogueFor.mockReturnValue([catalogueVoice('Achernar')]);
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    expect(screen.getByTestId('narrator-language-note')).toHaveTextContent(
      'Bu anlatıcı İngilizce, masal Türkçe. Aksan kaymaları olabilir.',
    );
    // Still no blocking dialog for a ready-made narrator.
    fireEvent.press(screen.getByTestId('story-cta'));
    expect((await confirmSheet()).getByTestId('narration-confirm-sheet-language-text')).toHaveTextContent(
      'Bu anlatıcı İngilizce, masal Türkçe. Aksan kaymaları olabilir.',
    );
    await confirmNarration();
    expect(mockShowDialog).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).toHaveBeenCalledWith(
      'AudioGeneration',
      expect.objectContaining({ voiceProfileId: 'vp-3' }),
    );
  });

  it('prefers a voice of the story language as the default narrator', async () => {
    mockVoiceStore.voiceProfiles = [OWN_EN(), voice('vp-2', 'Deniz', 'PRESET')];
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(chosenNarrator()).toMatch(/^Deniz,/);
  });

  it('keeps the own voice across a language switch when no own voice speaks the new language', async () => {
    mockVoiceStore.voiceProfiles = [voice('vp-1', 'Annem', 'CLONE'), voice('vp-3', 'Emma', 'PRESET', 'en-US')];
    const view = await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    fireEvent.press(screen.getByTestId('language-chip-en'));
    await waitFor(() => expect(mockNavigation.setParams).toHaveBeenCalled());
    view.rerender(<StoryDetailScreen />);
    await screen.findByRole('header', { name: 'The Town Musicians of Bremen' });

    expect(chosenNarrator()).toMatch(/^Annem,/);
    fireEvent.press(screen.getByTestId('story-cta'));
    expect((await confirmSheet()).getByTestId('narration-confirm-sheet-language-text')).toHaveTextContent(
      'Dil uyuşmuyor. Bu ses Türkçe, masal İngilizce. Aksan kaymaları olabilir ama dinlenebilir.',
    );
  });

  it('is translated', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    mockVoiceStore.voiceProfiles = [OWN_EN()];
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    fireEvent.press(screen.getByRole('button', { name: 'Listen in your voice' }));

    const sheet = await confirmSheet();
    expect(sheet.getByRole('header', { name: 'Narrate this story?' })).toBeOnTheScreen();
    expect(sheet.getByTestId('narration-confirm-sheet-voice-line')).toHaveTextContent('Your own voice, English');
    expect(sheet.getByTestId('narration-confirm-sheet-language-text')).toHaveTextContent(
      'Languages do not match. This voice is English, the story is Turkish. There may be some accent drift, but you can still listen.',
    );
    expect(sheet.getByRole('button', { name: 'Narrate' })).toBeOnTheScreen();
    expect(sheet.getByRole('button', { name: 'Cancel' })).toBeOnTheScreen();
  });
});

describe('StoryDetailScreen: narrator sheet', () => {
  async function openSheet() {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    fireEvent.press(screen.getByTestId('narrator-heading-link'));
    return within(await screen.findByTestId('narrator-sheet'));
  }

  it('lists the voices of the story language first, then the voices of other languages under their own heading', async () => {
    mockVoiceStore.voiceProfiles = [
      ...mockVoiceStore.voiceProfiles,
      voice('vp-en', 'Mom', 'CLONE', 'en-US'),
    ];
    const sheet = await openSheet();

    // No sheet title over the first section (V3-10); the list is named "Anlatıcı".
    expect(sheet.queryByRole('header', { name: 'Anlatıcı' })).toBeNull();
    expect(sheet.getByTestId('narrator-sheet-list').props.accessibilityLabel).toBe('Anlatıcı');
    expect(sheet.getByRole('header', { name: 'Senin sesin' })).toBeOnTheScreen();
    expect(sheet.getByRole('header', { name: 'Hazır anlatıcılar' })).toBeOnTheScreen();
    expect(sheet.getByRole('radio', { name: 'Annem, Türkçe, 12 Ekim kaydı' })).toBeSelected();
    expect(sheet.getByRole('radio', { name: 'Deniz, Türkçe' })).not.toBeSelected();
    // Voices of another language are not hidden: they come last, with their language.
    expect(sheet.getByRole('header', { name: 'Başka dildeki sesler' })).toBeOnTheScreen();
    const other = within(sheet.getByTestId('narrator-other-languages'));
    expect(other.getByRole('radio', { name: 'Mom, English, 12 Ekim kaydı' })).toBeOnTheScreen();
    expect(other.getByRole('radio', { name: 'Emma, English' })).toBeOnTheScreen();
    expect(
      sheet.getAllByRole('radio').map(node => node.props.testID as string),
    ).toEqual([
      'narrator-row-vp-1',
      'narrator-row-vp-2',
      'narrator-row-vp-en',
      'narrator-row-vp-3',
    ]);
    expect(sheet.getByText('Hazır anlatıcılar bu masalı Türkçe okur.')).toBeOnTheScreen();
  });

  it('a voice of another language can be chosen in the sheet', async () => {
    mockVoiceStore.voiceProfiles = [
      ...mockVoiceStore.voiceProfiles,
      voice('vp-en', 'Mom', 'CLONE', 'en-US'),
    ];
    const sheet = await openSheet();

    fireEvent.press(sheet.getByRole('radio', { name: 'Mom, English, 12 Ekim kaydı' }));

    await waitFor(() => expect(screen.queryByTestId('narrator-sheet')).toBeNull());
    expect(chosenNarrator()).toMatch(/^Mom,/);
    fireEvent.press(screen.getByTestId('story-cta'));
    expect((await confirmSheet()).getByTestId('narration-confirm-sheet-language-text')).toHaveTextContent(/^Dil uyuşmuyor/);
  });

  it('selecting a narrator applies at once, closes the sheet and is used for listening', async () => {
    const sheet = await openSheet();
    fireEvent.press(sheet.getByRole('radio', { name: 'Deniz' }));

    await waitFor(() => expect(screen.queryByTestId('narrator-sheet')).toBeNull());
    expect(chosenNarrator()).toMatch(/^Deniz,/);
    expect(screen.getByRole('button', { name: 'Deniz anlatsın' })).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('story-cta'));
    await confirmNarration();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('AudioGeneration', {
      storyId: 's-1',
      voiceProfileId: 'vp-2',
      replace: false,
    });
  });

  it('plays the sample of the own voice and of a ready-made narrator', async () => {
    const sheet = await openSheet();

    fireEvent.press(sheet.getByRole('button', { name: 'Annem örneğini dinle' }));
    await waitFor(() =>
      expect(mockAudioPlayer.playFromUrl).toHaveBeenCalledWith(
        'https://cdn.test/own.wav',
        expect.objectContaining({ title: 'Annem' }),
      ),
    );
    expect(mockVoiceStore.getVoiceSample).toHaveBeenCalledWith('vp-1');

    // Tapping the playing one stops it (only that sample).
    fireEvent.press(await sheet.findByRole('button', { name: 'Annem örneğini durdur' }));
    await waitFor(() => expect(mockAudioPlayer.stopPreview).toHaveBeenCalledWith('vp-1'));

    fireEvent.press(await sheet.findByRole('button', { name: 'Deniz örneğini dinle' }));
    await waitFor(() => expect(mockPreviewVoice).toHaveBeenCalledWith('vp-2-voice', 'GOOGLE'));
    await waitFor(() =>
      expect(mockAudioPlayer.playFromUrl).toHaveBeenLastCalledWith(
        'https://cdn.test/preset.mp3',
        expect.objectContaining({ title: 'Deniz' }),
      ),
    );
    expect(mockAudioPlayer.stopAndCleanup).not.toHaveBeenCalled();
  });

  it('says so when a sample cannot be played', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockVoiceStore.getVoiceSample.mockResolvedValueOnce(null);
    mockPreviewVoice.mockRejectedValueOnce(new Error('offline'));
    const sheet = await openSheet();

    fireEvent.press(sheet.getByRole('button', { name: 'Annem örneğini dinle' }));
    await waitFor(() =>
      expect(showToast.error).toHaveBeenCalledWith('Bu sesin örneği bulunamadı.'),
    );
    fireEvent.press(sheet.getByRole('button', { name: 'Deniz örneğini dinle' }));
    await waitFor(() => expect(showToast.error).toHaveBeenCalledWith('Örnek çalınamadı.'));
    expect(mockAudioPlayer.playFromUrl).not.toHaveBeenCalled();
  });

  it('stops a playing sample when the sheet closes', async () => {
    const sheet = await openSheet();
    fireEvent.press(sheet.getByRole('button', { name: 'Annem örneğini dinle' }));
    await sheet.findByRole('button', { name: 'Annem örneğini durdur' });

    fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
    await waitFor(() => expect(mockAudioPlayer.stopPreview).toHaveBeenCalledWith('vp-1'));
    await waitFor(() => expect(screen.queryByTestId('narrator-sheet')).toBeNull());
  });

  describe('ready-made narrators of the story language (catalogue)', () => {
    const TR_CATALOGUE = [catalogueVoice('Achernar', 'female'), catalogueVoice('Puck', 'male')];

    /** Deniz (added, voice id `vp-2-voice`) as the catalogue lists it. */
    const DENIZ_IN_CATALOGUE = { ...catalogueVoice('Deniz', 'female'), id: 'vp-2-voice', voiceId: 'vp-2-voice' };
    const THIRTY = Array.from({ length: 30 }, (_, i) => catalogueVoice(`Voice${String(i).padStart(2, '0')}`));
    const boneHeights = (sheet: ReturnType<typeof within>) =>
      within(sheet.getByTestId('narrator-catalogue-loading'))
        .UNSAFE_getAllByType(RowSkeleton)
        .map(bone => bone.props.height as number);

    it('asks for the narrators of the story language once the push has finished, before the sheet opens, quietly (NEW-2)', async () => {
      renderWithProviders(<StoryDetailScreen />);
      await act(async () => undefined);
      // The push stays light (V3-03): nothing is asked for during it.
      expect(mockVoiceStore.loadAvailableVoices).not.toHaveBeenCalled();

      finishTransition();
      expect(mockVoiceStore.catalogueFor).toHaveBeenCalledWith('tr');
      expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledTimes(1);
      expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledWith('tr', { quiet: true });
      // The sheet was never opened for it.
      expect(screen.queryByTestId('narrator-sheet')).toBeNull();
    });

    it('a first open after the prefetch answered has them at once, the added narrator named with its voice', async () => {
      const answer = holdCatalogue();
      await renderScreen();
      await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
      await answer([DENIZ_IN_CATALOGUE, ...THIRTY]);

      fireEvent.press(screen.getByTestId('narrator-heading-link'));
      const sheet = within(await screen.findByTestId('narrator-sheet'));
      expect(sheet.queryByTestId('narrator-catalogue-loading')).toBeNull();
      expect(sheet.getByTestId('narrator-row-vp-2').props.accessibilityLabel).toBe('Deniz, Türkçe, kadın sesi');
      expect(sheet.getAllByTestId(/^narrator-catalogue-tr-TR-Chirp3-HD-Voice\d\d$/)).toHaveLength(5);
      expect(sheet.getByTestId('narrator-see-all')).toBeOnTheScreen();
      // Asked for once: the open did not ask again.
      expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledTimes(1);
    });

    it('opens at its final height while they load: bones for the rows up to six and "Tümünü gör", replaced in place', async () => {
      const answer = holdCatalogue();
      const sheet = await openSheet();

      // Deniz is added: five catalogue rows (72dp faces), then "Tümünü gör" (68dp).
      expect(sheet.getByTestId('narrator-catalogue-loading').props.accessibilityLabel).toBe(
        'Anlatıcılar yükleniyor...',
      );
      expect(boneHeights(sheet)).toEqual([72, 72, 72, 72, 72, 68]);
      expect(sheet.queryByTestId('narrator-add-ready')).toBeNull();

      // The narrators take the place of the bones, one row for one bone.
      await answer(THIRTY);
      expect(sheet.queryByTestId('narrator-catalogue-loading')).toBeNull();
      expect(sheet.getAllByTestId(/^narrator-catalogue-tr-TR-Chirp3-HD-Voice\d\d$/)).toHaveLength(5);
      expect(sheet.getByRole('button', { name: 'Tümünü gör, 31 hazır anlatıcı' })).toBeOnTheScreen();
    });

    it('holds only the room the added narrators leave, and a short catalogue shrinks the sheet, never grows it', async () => {
      mockVoiceStore.voiceProfiles = [
        voice('vp-1', 'Annem', 'CLONE'),
        voice('vp-2', 'Deniz', 'PRESET'),
        voice('vp-4', 'Ece', 'PRESET'),
        voice('vp-5', 'Mert', 'PRESET'),
      ];
      const answer = holdCatalogue();
      const sheet = await openSheet();
      // Three added: three catalogue rows can follow, then "Tümünü gör".
      expect(boneHeights(sheet)).toEqual([72, 72, 72, 68]);

      await answer([catalogueVoice('Achernar', 'female'), catalogueVoice('Puck', 'male')]);
      expect(sheet.getAllByTestId(/^narrator-catalogue-tr-TR-Chirp3-HD-[A-Za-z]+$/)).toHaveLength(2);
      expect(sheet.queryByTestId('narrator-see-all')).toBeNull();
    });

    it('a prefetch that failed is asked again in the tap that opens the sheet, which opens on its bones', async () => {
      // No ready-made narrator of this language added: the fallback row would show.
      mockVoiceStore.voiceProfiles = [voice('vp-1', 'Annem', 'CLONE'), voice('vp-3', 'Emma', 'PRESET', 'en-US')];
      await renderScreen();
      await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
      // The prefetch failed (the default mock lists nothing).
      expect(mockVoiceStore.loadAvailableVoices).toHaveBeenCalledTimes(1);
      expect(mockVoiceStore.catalogueError).not.toBeNull();

      holdCatalogue();
      const load = mockVoiceStore.loadAvailableVoices.getMockImplementation()!;
      const sheetDrawnWhenAsked: boolean[] = [];
      mockVoiceStore.loadAvailableVoices.mockImplementation((...args: unknown[]) => {
        sheetDrawnWhenAsked.push(screen.queryByTestId('narrator-sheet') !== null);
        return load(...args);
      });
      fireEvent.press(screen.getByTestId('narrator-heading-link'));
      // Asked in the tap itself, before the sheet's first frame (the store
      // shares one request per language with the page's own effect).
      expect(sheetDrawnWhenAsked[0]).toBe(false);
      mockVoiceStore.loadAvailableVoices.mock.calls.forEach(call => expect(call).toEqual(['tr', { quiet: true }]));
      // So the sheet opens loading, never on the fallback row first.
      const sheet = within(screen.getByTestId('narrator-sheet'));
      expect(boneHeights(sheet)).toEqual([72, 72, 72, 72, 72, 72, 68]);
      expect(sheet.queryByTestId('narrator-add-ready')).toBeNull();
      await act(async () => undefined);
    });

    it('an added narrator keeps its voice line while the catalogue arrives, and names its voice on the next open', async () => {
      const answer = holdCatalogue();
      const sheet = await openSheet();
      const deniz = () => screen.getByTestId('narrator-row-vp-2').props.accessibilityLabel as string;
      expect(deniz()).toBe('Deniz, Türkçe');

      await answer([DENIZ_IN_CATALOGUE, catalogueVoice('Puck', 'male')]);
      // The same line after the catalogue arrived: nothing is rewritten under the user's eyes.
      expect(deniz()).toBe('Deniz, Türkçe');
      expect(sheet.queryByText('Türkçe, kadın sesi')).toBeNull();
      expect(sheet.getByRole('radio', { name: 'Puck, Türkçe, erkek sesi' })).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
      await waitFor(() => expect(screen.queryByTestId('narrator-sheet')).toBeNull());
      fireEvent.press(screen.getByTestId('narrator-heading-link'));
      await screen.findByTestId('narrator-sheet');
      expect(deniz()).toBe('Deniz, Türkçe, kadın sesi');
    });

    it('shows a loading line while they are requested', async () => {
      mockVoiceStore.isLoadingVoices = true;
      const sheet = await openSheet();
      expect(sheet.getByTestId('narrator-catalogue-loading').props.accessibilityLabel).toBe(
        'Anlatıcılar yükleniyor...',
      );
      // The narrators the user already has are listed meanwhile.
      expect(sheet.getByRole('radio', { name: 'Deniz, Türkçe' })).toBeOnTheScreen();
    });

    it('lists them after the added ones, by bare name and voice, with no lock or plan badge', async () => {
      mockVoiceStore.catalogueFor.mockReturnValue(TR_CATALOGUE);
      const sheet = await openSheet();
      expect(mockVoiceStore.loadAvailableVoices).not.toHaveBeenCalled();

      expect(sheet.getByRole('radio', { name: 'Achernar, Türkçe, kadın sesi' })).toBeOnTheScreen();
      expect(sheet.getByRole('radio', { name: 'Puck, Türkçe, erkek sesi' })).toBeOnTheScreen();
      expect(sheet.queryByText(/Premium|Standart|Yüksek kalite|HD|Chirp/)).toBeNull();
      expect(sheet.queryByTestId('icon-lock', { includeHiddenElements: true })).toBeNull();
      // The catalogue is in the sheet: no detour through the voice list.
      expect(sheet.queryByRole('button', { name: 'Hazır anlatıcı ekle' })).toBeNull();
    });

    it('lists a narrator the user already added once, as the added one, naming its voice', async () => {
      mockVoiceStore.voiceProfiles = [
        { ...voice('vp-2', 'Chirp3 Achernar (HD)', 'PRESET'), voiceId: 'tr-TR-Chirp3-HD-Achernar' },
      ];
      mockVoiceStore.catalogueFor.mockReturnValue(TR_CATALOGUE);
      const sheet = await openSheet();
      // An older profile carries the long name: the bare one is shown.
      expect(sheet.getAllByText('Achernar')).toHaveLength(1);
      expect(sheet.queryByText(/Chirp3|\(HD\)/)).toBeNull();
      expect(sheet.queryByTestId('narrator-catalogue-tr-TR-Chirp3-HD-Achernar')).toBeNull();
      expect(sheet.getByTestId('narrator-catalogue-tr-TR-Chirp3-HD-Puck')).toBeOnTheScreen();
      // Like the rows not added yet: its language, then its voice.
      expect(sheet.getByRole('radio', { name: 'Achernar, Türkçe, kadın sesi' })).toBeOnTheScreen();
    });

    it('choosing one adds it to the voices, selects it and closes the sheet', async () => {
      mockVoiceStore.catalogueFor.mockReturnValue(TR_CATALOGUE);
      const created = { ...voice('vp-new', 'Puck', 'PRESET'), voiceId: 'tr-TR-Chirp3-HD-Puck' };
      mockVoiceStore.createVoiceProfile.mockImplementation(async () => {
        runInAction(() => {
          mockVoiceStore.voiceProfiles = [...mockVoiceStore.voiceProfiles, created];
        });
        return { profile: created, error: null };
      });
      const sheet = await openSheet();

      fireEvent.press(sheet.getByRole('radio', { name: 'Puck, Türkçe, erkek sesi' }));

      await waitFor(() => expect(screen.queryByTestId('narrator-sheet')).toBeNull());
      expect(mockVoiceStore.checkCanCreate).toHaveBeenCalledWith('preset');
      expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledWith({
        name: 'Puck',
        provider: TTSProvider.GOOGLE,
        voiceId: 'tr-TR-Chirp3-HD-Puck',
        language: 'tr-TR',
      });
      expect(chosenNarrator()).toMatch(/^Puck,/);
      // No plan dialog: ready-made narrators are free for everyone.
      expect(mockShowDialog).not.toHaveBeenCalled();
    });

    it('explains over the open sheet when no narrator slot is free', async () => {
      mockVoiceStore.catalogueFor.mockReturnValue(TR_CATALOGUE);
      mockVoiceStore.checkCanCreate.mockResolvedValue(false);
      mockVoiceStore.slotBlock.mockReturnValue({ title: 'Hak doldu', message: 'Açıklama', showPaywall: false });
      const sheet = await openSheet();

      fireEvent.press(sheet.getByRole('radio', { name: 'Achernar, Türkçe, kadın sesi' }));

      await waitFor(() => expect(mockShowDialog).toHaveBeenCalledTimes(1));
      expect(mockVoiceStore.slotBlock).toHaveBeenCalledWith('preset', 'free');
      expect(mockVoiceStore.createVoiceProfile).not.toHaveBeenCalled();
      // No close-first step: the dialog opens over the sheet (its dialog outlet).
      expect(screen.queryByTestId('narrator-sheet')).not.toBeNull();
    });

    it('plays the sample of a catalogue narrator without adding it', async () => {
      mockVoiceStore.catalogueFor.mockReturnValue(TR_CATALOGUE);
      const sheet = await openSheet();

      fireEvent.press(sheet.getByRole('button', { name: 'Puck örneğini dinle' }));
      await waitFor(() =>
        expect(mockPreviewVoice).toHaveBeenCalledWith('tr-TR-Chirp3-HD-Puck', 'GOOGLE'),
      );
      await waitFor(() =>
        expect(mockAudioPlayer.playFromUrl).toHaveBeenCalledWith(
          'https://cdn.test/preset.mp3',
          expect.objectContaining({ title: 'Puck' }),
        ),
      );
      expect(await sheet.findByRole('button', { name: 'Puck örneğini durdur' })).toBeOnTheScreen();
      expect(mockVoiceStore.createVoiceProfile).not.toHaveBeenCalled();
    });

    it('a long catalogue lists its first narrators; "Tümünü gör" opens all of them for this story (V3-02)', async () => {
      const thirty = Array.from({ length: 30 }, (_, i) => catalogueVoice(`Voice${String(i).padStart(2, '0')}`));
      mockVoiceStore.catalogueFor.mockReturnValue(thirty);
      const sheet = await openSheet();

      // Deniz (added) and five of the catalogue: the section holds six rows.
      expect(sheet.getAllByTestId(/^narrator-catalogue-tr-TR-Chirp3-HD-Voice\d\d$/)).toHaveLength(5);
      fireEvent.press(sheet.getByRole('button', { name: 'Tümünü gör, 31 hazır anlatıcı' }));
      expect(mockNavigation.navigate).toHaveBeenCalledWith('NarratorCatalogue', {
        pickForStory: true,
        language: 'tr',
        storyId: 's-1',
      });
      await waitFor(() => expect(screen.queryByTestId('narrator-sheet')).toBeNull());
    });

    it('a sample the player cannot start resets its play button (never stuck)', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockVoiceStore.catalogueFor.mockReturnValue(TR_CATALOGUE);
      mockAudioPlayer.playFromUrl.mockRejectedValueOnce(new Error('decode'));
      const sheet = await openSheet();

      fireEvent.press(sheet.getByRole('button', { name: 'Puck örneğini dinle' }));
      await waitFor(() => expect(mockAudioPlayer.playFromUrl).toHaveBeenCalled());
      await waitFor(() => expect(sheet.getByRole('button', { name: 'Puck örneğini dinle' })).toBeEnabled());
      expect(sheet.queryByRole('button', { name: 'Puck örneğini durdur' })).toBeNull();
    });
  });

  it('"Yeni ses ekle" starts the own-voice flow after the slot check', async () => {
    const sheet = await openSheet();
    fireEvent.press(sheet.getByRole('button', { name: 'Yeni ses ekle' }));

    await waitFor(() =>
      expect(mockNavigation.navigate).toHaveBeenCalledWith('CreateVoiceProfile', { returnToStoryId: 's-1' }),
    );
    expect(mockVoiceStore.checkCanCreate).toHaveBeenCalledWith('clone');
    await waitFor(() => expect(screen.queryByTestId('narrator-sheet')).toBeNull());
  });

  it('offers "Kendi sesini ekle" to a user without an own voice', async () => {
    mockVoiceStore.voiceProfiles = [voice('vp-2', 'Deniz', 'PRESET')];
    const sheet = await openSheet();

    expect(sheet.queryByRole('button', { name: 'Yeni ses ekle' })).toBeNull();
    fireEvent.press(sheet.getByRole('button', { name: 'Kendi sesini ekle' }));
    await waitFor(() =>
      expect(mockNavigation.navigate).toHaveBeenCalledWith('CreateVoiceProfile', { returnToStoryId: 's-1' }),
    );
  });

  it('leads to the catalogue when no ready-made narrator reads this language', async () => {
    mockVoiceStore.voiceProfiles = [voice('vp-1', 'Annem', 'CLONE'), voice('vp-3', 'Emma', 'PRESET', 'en-US')];
    const sheet = await openSheet();

    fireEvent.press(sheet.getByRole('button', { name: 'Hazır anlatıcı ekle' }));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('NarratorCatalogue', {
      pickForStory: true,
      language: 'tr',
      storyId: 's-1',
    });
  });

  it('moves to a narrator that reads the new language after a language switch', async () => {
    mockVoiceStore.voiceProfiles = [voice('vp-2', 'Deniz', 'PRESET'), voice('vp-3', 'Emma', 'PRESET', 'en-US')];
    const view = await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(chosenNarrator()).toMatch(/^Deniz,/);

    fireEvent.press(screen.getByTestId('language-chip-en'));
    await waitFor(() => expect(mockNavigation.setParams).toHaveBeenCalled());
    view.rerender(<StoryDetailScreen />);

    await screen.findByRole('header', { name: 'The Town Musicians of Bremen' });
    await waitFor(() => expect(chosenNarrator()).toBe('Emma, Hazır anlatıcı'));
  });
});

describe('StoryDetailScreen: translation requests', () => {
  async function openSheet() {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    fireEvent.press(screen.getByRole('button', { name: 'Başka dilde iste' }));
    return within(await screen.findByTestId('translation-request-sheet'));
  }

  it('lists the enabled languages the tale does not have, with the requested one marked', async () => {
    const sheet = await openSheet();

    expect(sheet.getByRole('header', { name: 'Başka dilde iste' })).toBeOnTheScreen();
    expect(sheet.getByText('Deutsch')).toBeOnTheScreen();
    expect(sheet.getByText('Français')).toBeOnTheScreen();
    expect(sheet.queryByText('Türkçe')).toBeNull();
    expect(sheet.queryByText('English')).toBeNull();
    expect(sheet.getByText('İstendi')).toBeOnTheScreen();
    expect(sheet.getAllByText('Çeviri iste')).toHaveLength(1);
    expect(
      sheet.getByText(
        'İsteğin kaydedilir. Çeviri yayımlanınca masal o dilde de açılır. Ne zaman olacağını söyleyemiyoruz.',
      ),
    ).toBeOnTheScreen();
  });

  it('records a request at once and keeps it in the story', async () => {
    const sheet = await openSheet();
    fireEvent.press(sheet.getByRole('button', { name: 'Français çevirisi iste' }));

    expect(await sheet.findAllByText('İstendi')).toHaveLength(2);
    expect(mockRequestTranslation).toHaveBeenCalledWith('s-1', 'fr');
    await waitFor(() =>
      expect(mockStoryStore.currentStory?.requestedLanguages).toEqual(['de', 'fr']),
    );
    expect(showToast.error).not.toHaveBeenCalled();
  });

  it('withdraws a request', async () => {
    const sheet = await openSheet();
    fireEvent.press(sheet.getByRole('button', { name: 'Deutsch isteğini geri al' }));

    await waitFor(() => expect(sheet.queryByText('İstendi')).toBeNull());
    expect(mockCancelTranslationRequest).toHaveBeenCalledWith('s-1', 'de');
    expect(mockStoryStore.currentStory?.requestedLanguages).toEqual([]);
  });

  it('rolls back and says so when the request fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRequestTranslation.mockRejectedValueOnce(apiErrorFromResponse(500, { message: 'boom' }));
    const sheet = await openSheet();

    fireEvent.press(sheet.getByRole('button', { name: 'Français çevirisi iste' }));
    await waitFor(() =>
      expect(showToast.error).toHaveBeenCalledWith('İstek kaydedilemedi. Tekrar dene.'),
    );
    expect(sheet.getAllByText('İstendi')).toHaveLength(1);
    expect(mockStoryStore.currentStory?.requestedLanguages).toEqual(['de']);
  });

  it('rolls back a failed withdrawal', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCancelTranslationRequest.mockRejectedValueOnce(new Error('offline'));
    const sheet = await openSheet();

    fireEvent.press(sheet.getByRole('button', { name: 'Deutsch isteğini geri al' }));
    await waitFor(() =>
      expect(showToast.error).toHaveBeenCalledWith('İstek geri alınamadı. Tekrar dene.'),
    );
    expect(mockStoryStore.currentStory?.requestedLanguages).toEqual(['de']);
  });

  it('reloads the story when the translation was published in the meantime', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRequestTranslation.mockRejectedValueOnce(
      apiErrorFromResponse(409, {
        statusCode: 409,
        code: 'TRANSLATION_ALREADY_AVAILABLE',
        message: 'Bu masal o dilde zaten var.',
        storyId: 's-1-fr',
      }),
    );
    const sheet = await openSheet();
    expect(mockGetStoryById).toHaveBeenCalledTimes(1);

    fireEvent.press(sheet.getByRole('button', { name: 'Français çevirisi iste' }));

    await waitFor(() => expect(mockGetStoryById).toHaveBeenCalledTimes(2));
    expect(mockGetStoryById).toHaveBeenLastCalledWith('s-1');
    expect(showToast.info).toHaveBeenCalledWith('Bu masalın Fransızca çevirisi yayımlanmış.');
    expect(showToast.error).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('translation-request-sheet')).toBeNull());
  });

  it('hides the action when there is no language left to ask for', async () => {
    mockContentLanguage.languages = mockContentLanguage.languages.slice(0, 2);
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(screen.queryByRole('button', { name: 'Başka dilde iste' })).toBeNull();
  });
});

describe('StoryDetailScreen: a disabled action stays inert', () => {
  it('the action ignores a press while a language version opens', async () => {
    let resolveEnglish: (value: unknown) => void = () => undefined;
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    mockGetStoryById.mockImplementationOnce(() => new Promise(resolve => (resolveEnglish = resolve)));
    fireEvent.press(screen.getByTestId('language-chip-en'));

    // userEvent drives the real Pressable; fireEvent would call the handler
    // of the composite even while disabled.
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.press(screen.getByTestId('story-cta'));
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
    await act(async () => {
      resolveEnglish(parseStoryDetailFromJSON(ENGLISH_JSON));
    });
  });
});

describe('StoryDetailScreen: a light push (V3-03)', () => {
  it('mounts the sheets and the parts below the narrators only after the transition', async () => {
    renderWithProviders(<StoryDetailScreen />);
    await act(async () => undefined);

    // What is on screen when the page opens is there.
    expect(screen.getByRole('header', { name: 'Bremen Mızıkacıları' })).toBeOnTheScreen();
    expect(screen.getByTestId('narrator-cards')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: CTA_OWN })).toBeOnTheScreen();
    // The rest waits for the end of the page's own push.
    expect(mockNavigation.addListener).toHaveBeenCalledWith('transitionEnd', expect.any(Function));
    expect(screen.UNSAFE_queryAllByType(BottomSheet)).toHaveLength(0);
    expect(screen.queryByTestId('story-detail-more')).toBeNull();
    expect(screen.queryByTestId('story-credits')).toBeNull();
    expect(screen.queryByTestId('story-languages')).toBeNull();

    finishTransition();
    // The options, the narrators, the narration confirmation, the related
    // stories and the translation requests.
    expect(screen.UNSAFE_queryAllByType(BottomSheet)).toHaveLength(5);
    expect(screen.getByTestId('story-credits')).toBeOnTheScreen();
    expect(screen.getByTestId('story-languages')).toBeOnTheScreen();
  });

  it('without a transitionEnd the deferred parts mount after the fallback delay', async () => {
    renderWithProviders(<StoryDetailScreen />);
    await act(async () => undefined);
    act(() => {
      jest.advanceTimersByTime(TRANSITION_FALLBACK_MS - 1);
    });
    expect(screen.UNSAFE_queryAllByType(BottomSheet)).toHaveLength(0);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.UNSAFE_queryAllByType(BottomSheet)).toHaveLength(5);
    expect(screen.getByTestId('story-credits')).toBeOnTheScreen();
  });

  it('a sheet asked for during the push opens on the first tap, and its exit runs to its end', async () => {
    renderWithProviders(<StoryDetailScreen />);
    await act(async () => undefined);
    const held = holdTimings();

    fireEvent.press(screen.getByTestId('narrator-heading-link'));
    expect(screen.getByTestId('narrator-sheet')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Annem, Türkçe, 12 Ekim kaydı' })).toBeSelected();
    fireEvent(screen.getByTestId('narrator-sheet'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 520 } },
    });

    // Closed again before the push ended: it leaves, it is not torn down.
    fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
    expect(screen.getByTestId('narrator-sheet')).toBeOnTheScreen();
    act(() => held[held.length - 1].callback?.(true));
    expect(screen.queryByTestId('narrator-sheet')).toBeNull();

    // The options sheet too, still before the transition ended.
    fireEvent.press(screen.getByRole('button', { name: 'Diğer seçenekler' }));
    expect(screen.getByTestId('story-options-sheet')).toBeOnTheScreen();
    await act(async () => undefined);
  });

  it('the narrator cards and the dock are not drawn again by a change they do not show', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    const avatar = jest.spyOn(NarratorAvatarModule, 'NarratorAvatar');
    const dock = screen.getByTestId('story-dock').props;
    const cards = screen.getByTestId('narrator-cards').props;

    // The page draws again (the measured dock pads the scroll, a sheet
    // opens): neither part does.
    act(() => {
      fireEvent(screen.getByTestId('story-dock'), 'layout', { nativeEvent: { layout: { height: 91 } } });
    });
    fireEvent.press(screen.getByRole('button', { name: 'Diğer seçenekler' }));
    expect(screen.getByTestId('story-options-sheet')).toBeOnTheScreen();
    expect(screen.getByTestId('story-dock').props).toBe(dock);
    expect(screen.getByTestId('narrator-cards').props).toBe(cards);
    expect(avatar).not.toHaveBeenCalled();
    await act(async () => undefined);
  });

  it('the dock and the cards follow what they show', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    const dock = screen.getByTestId('story-dock').props;

    // The sample of the chosen narrator plays: the dock shows it.
    fireEvent.press(screen.getByTestId('story-sample'));
    await waitFor(() => expect(mockAudioPlayer.playFromUrl).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Annem örneğini durdur' })).toBeOnTheScreen();
    expect(screen.getByTestId('story-dock').props).not.toBe(dock);

    // Another card is chosen: the cards and the action follow.
    fireEvent.press(screen.getByTestId('narrator-card-vp-2'));
    expect(chosenNarrator()).toMatch(/^Deniz,/);
    expect(screen.getByRole('button', { name: 'Deniz anlatsın' })).toBeOnTheScreen();
    await act(async () => undefined);
  });
});

describe('StoryDetailScreen: the action waits for the narrations of the story (V3-04)', () => {
  const DENIZ = () => voice('vp-2', 'Deniz', 'PRESET');

  it('is busy until they are known: never "Deniz anlatsın" and no press, then "Dinle" opens the player', async () => {
    mockVoiceStore.voiceProfiles = [DENIZ()];
    mockSubscription.usage = usage(bucket(20, 2), bucket(5, 4));
    let answer: (value: unknown) => void = () => undefined;
    mockGetNarrationsByStory.mockReturnValue(new Promise(resolve => (answer = resolve)));
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(chosenNarrator()).toMatch(/^Deniz,/);

    const cta = screen.getByTestId('story-cta');
    expect(cta.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    // Only the spinner shows; its hidden label is the neutral "Dinle".
    expect(screen.getByTestId('story-cta-spinner')).toBeOnTheScreen();
    expect(cta.props.accessibilityLabel).toBe('Dinle');
    expect(screen.queryByText('Deniz anlatsın')).toBeNull();
    // Nothing is said about an allowance a narration might not need.
    expect(screen.queryByTestId('story-quota-left')).toBeNull();
    // The sample still plays meanwhile.
    expect(screen.getByTestId('story-sample')).toBeEnabled();

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.press(cta);
    expect(mockNavigation.navigate).not.toHaveBeenCalled();

    await act(async () => {
      answer([storyNarration('n-1', 'vp-2', 'READY')]);
    });
    expect(screen.queryByTestId('story-cta-spinner')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Dinle' }));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'n-1', autoplay: true });
    expect(mockNavigation.navigate).not.toHaveBeenCalledWith('AudioGeneration', expect.anything());
  });

  it('with no narration it names the narrator once the list arrived, with what is left', async () => {
    mockVoiceStore.voiceProfiles = [DENIZ()];
    mockSubscription.usage = usage(bucket(20, 2), bucket(5, 4));
    let answer: (value: unknown) => void = () => undefined;
    mockGetNarrationsByStory.mockReturnValue(new Promise(resolve => (answer = resolve)));
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(screen.getByTestId('story-cta-spinner')).toBeOnTheScreen();

    await act(async () => {
      answer([]);
    });
    expect(screen.getByRole('button', { name: 'Deniz anlatsın' })).toBeEnabled();
    expect(screen.getByTestId('story-quota-left')).toHaveTextContent('Bu ay 2 masal hakkın kaldı');
    fireEvent.press(screen.getByTestId('story-cta'));
    await confirmNarration();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('AudioGeneration', {
      storyId: 's-1',
      voiceProfileId: 'vp-2',
      replace: false,
    });
  });

  it('a READY narration of the newest page says "Dinle" at once, before the story list arrived', async () => {
    mockVoiceStore.voiceProfiles = [DENIZ()];
    runInAction(() => {
      mockStoryStore.userNarrations = [{ ...storyNarration('n-9', 'vp-2', 'READY'), storyId: 's-1' }];
    });
    mockGetNarrationsByStory.mockReturnValue(new Promise(() => undefined));
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });

    expect(screen.queryByTestId('story-cta-spinner')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Dinle' }));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'n-9', autoplay: true });
  });

  it('a failed request never keeps it busy: it goes on with what is known', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockVoiceStore.voiceProfiles = [DENIZ()];
    mockGetNarrationsByStory.mockRejectedValue(apiErrorFromResponse(500, { message: 'boom' }));
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(screen.queryByTestId('story-cta-spinner')).toBeNull();
    expect(screen.getByRole('button', { name: 'Deniz anlatsın' })).toBeEnabled();
  });

  it('a request that does not answer stops being waited for', async () => {
    mockVoiceStore.voiceProfiles = [DENIZ()];
    mockGetNarrationsByStory.mockReturnValue(new Promise(() => undefined));
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(screen.getByTestId('story-cta-spinner')).toBeOnTheScreen();

    act(() => {
      jest.advanceTimersByTime(NARRATIONS_WAIT_MS - 1);
    });
    expect(screen.getByTestId('story-cta-spinner')).toBeOnTheScreen();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByRole('button', { name: 'Deniz anlatsın' })).toBeEnabled();
  });

  it('a page without a narrator is not held up: "Anlatıcı seç" opens the sheet at once', async () => {
    mockVoiceStore.voiceProfiles = [];
    mockGetNarrationsByStory.mockReturnValue(new Promise(() => undefined));
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(screen.queryByTestId('story-cta-spinner')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Anlatıcı seç' }));
    expect(await screen.findByTestId('narrator-sheet')).toBeOnTheScreen();
  });
});

describe('StoryDetailScreen: below the narrators while the detail loads (V3-05)', () => {
  it('a tale without credits or other languages shows nothing there, before and after the detail', async () => {
    const single = {
      ...STORY_JSON,
      credit: { ...EMPTY_STORY_CREDIT },
      translations: [],
      requestedLanguages: [],
      availableLanguages: ['tr'],
    };
    mockContentLanguage.languages = mockContentLanguage.languages.slice(0, 1);
    runInAction(() => {
      mockStoryStore.stories = [parseStoryFromJSON(single)];
    });
    let resolveDetail: (value: unknown) => void = () => undefined;
    mockGetStoryById.mockReturnValue(new Promise(resolve => (resolveDetail = resolve)));
    renderWithProviders(<StoryDetailScreen />);
    await act(async () => undefined);
    finishTransition();

    expect(screen.getByRole('header', { name: 'Bremen Mızıkacıları' })).toBeOnTheScreen();
    // Nothing is announced that would be withdrawn.
    expect(screen.queryByTestId('story-detail-more-loading')).toBeNull();
    expect(screen.queryByTestId('story-credits')).toBeNull();

    await act(async () => {
      resolveDetail(parseStoryDetailFromJSON(single));
    });
    expect(screen.queryByTestId('story-detail-more-loading')).toBeNull();
    expect(screen.queryByTestId('story-languages')).toBeNull();
    expect(screen.queryByTestId('story-credits')).toBeNull();
  });

  it('the languages wait on bones when the list copy names another one, then fade in', async () => {
    mockContentLanguage.languages = mockContentLanguage.languages.slice(0, 2);
    runInAction(() => {
      mockStoryStore.stories = [parseStoryFromJSON({ ...STORY_JSON, availableLanguages: ['tr', 'en'] })];
    });
    let resolveDetail: (value: unknown) => void = () => undefined;
    mockGetStoryById.mockReturnValue(new Promise(resolve => (resolveDetail = resolve)));
    renderWithProviders(<StoryDetailScreen />);
    await act(async () => undefined);
    finishTransition();

    expect(screen.getByTestId('story-detail-more-loading')).toBeOnTheScreen();
    expect(screen.getByTestId('story-credits')).toBeOnTheScreen();

    await act(async () => {
      resolveDetail(parseStoryDetailFromJSON(STORY_JSON));
    });
    expect(screen.queryByTestId('story-detail-more-loading')).toBeNull();
    const languages = screen.getByTestId('story-languages');
    expect(within(languages).getByTestId('language-chip-en')).toBeOnTheScreen();
    // The first real content after its bones fades in once (FadeIn from 0).
    expect(flatStyle(languages).opacity).toBe(0);
    expect(languages.props.needsOffscreenAlphaCompositing).toBe(true);
  });

  it('languages drawn without bones (from the cache) are not faded on their own', async () => {
    await act(async () => {
      await mockStoryStore.getStoryDetail('s-1');
    });
    await renderScreen();
    expect(screen.queryByTestId('story-detail-more-loading')).toBeNull();
    expect(flatStyle(screen.getByTestId('story-languages')).opacity).toBe(1);
  });
});

describe('StoryDetailScreen: hero, related stories and the source', () => {
  /** A list item of GET /stories/:id/related. */
  const item = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    id,
    title,
    ageGroup: 'THREE_TO_SIX',
    category: 'WORLD_CLASSICS',
    language: 'tr',
    estimatedDuration: 5,
    credit: EMPTY_STORY_CREDIT,
    ...extra,
  });
  const RELATED = parseRelatedStoriesFromJSON({
    languages: [item('s-1-en', 'The Town Musicians of Bremen', { language: 'en' })],
    parts: [{ ...item('s-1-p2', 'Bremen Mızıkacıları 2'), partNumber: 2 }],
    category: [
      item('c-1', 'Parmak Kız', { credit: { ...EMPTY_STORY_CREDIT, translationMethod: 'MACHINE' } }),
      item('c-2', 'Kibritçi Kız'),
      item('c-3', 'Altın Kuş', { isPremium: true }),
    ],
  });

  /** The page with GET /stories/:id/related answering `related` (inside act). */
  async function renderWithRelated(related: RelatedStories | Error = RELATED) {
    let answer: (value: RelatedStories) => void = () => undefined;
    let fail: (error: Error) => void = () => undefined;
    mockGetRelatedStories.mockReturnValue(
      new Promise<RelatedStories>((resolve, reject) => {
        answer = resolve;
        fail = reject;
      }),
    );
    const view = await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(screen.getByTestId('related-loading')).toBeOnTheScreen();
    await act(async () => {
      if (related instanceof Error) fail(related);
      else answer(related);
    });
    return view;
  }

  it('the title reads on the picture in every palette: the shade under its last line is canvas at 92% or more', () => {
    // On the smallest band (360dp wide) the title's last line sits inside the solid part,
    // and both lines inside the shaded bottom part.
    const band = storyHeroHeight(360, 640, 0);
    const solid = band * (1 - HERO_SHADE_STOPS.locations[2]);
    const shaded = band * (1 - HERO_SHADE_STOPS.locations[0]);
    expect(37 * HERO_TITLE_MAX_SCALE + 4).toBeLessThanOrEqual(solid);
    expect(HERO_TITLE_LINES * 37 * HERO_TITLE_MAX_SCALE + 4).toBeLessThanOrEqual(shaded);
    for (const key of PALETTE_KEYS) {
      const T = themes[key];
      for (const picture of ['#FFFFFF', '#000000', '#FFD54A']) {
        const ratio = contrastRatio(T.text, withAlpha(T.bg, HERO_SOLID_ALPHA), picture);
        expect({ key, picture, ok: ratio >= 4.5 }).toEqual({ key, picture, ok: true });
      }
    }
    // The stops: the picture is clear above its last 30%, then heavier down to solid canvas.
    expect(HERO_SHADE_STOPS.alphas).toEqual([0, 0.5, HERO_SOLID_ALPHA, 1]);
    expect(HERO_SHADE_STOPS.locations).toEqual([0.7, 0.79, 0.87, 1]);
  });

  it('the band is taller than wide, capped by the window, and reaches under the status bar', () => {
    expect(storyHeroHeight(360, 800, 24)).toBe(Math.round(360 * 1.15) + 24);
    // A short, wide window: at most 56% of its height.
    expect(storyHeroHeight(800, 400, 0)).toBe(Math.round(400 * 0.56));
  });

  it('the top bar floats over the picture and takes the canvas colour once it has scrolled away', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(flatStyle(screen.getByTestId('story-topbar-fill')).backgroundColor).toBe(themes['gece-mavisi'].bg);
    expect(TOP_BAR_BODY).toBe(8 + 44 + 2 + 8);
  });

  it('shows three related stories as shelf covers, the other languages and parts first, with "Tümü"', async () => {
    await renderWithRelated();

    expect(mockGetRelatedStories).toHaveBeenCalledWith('s-1');
    expect(screen.getByRole('header', { name: 'İlgili masallar' })).toBeOnTheScreen();
    const list = within(screen.getByTestId('related-list'));
    expect(list.getByTestId('related-s-1-en')).toBeOnTheScreen();
    expect(list.getByTestId('related-s-1-p2')).toBeOnTheScreen();
    expect(list.getByTestId('related-c-1')).toBeOnTheScreen();
    expect(list.queryByTestId('related-c-2')).toBeNull();
    // A version names its language, a part its number; the AI translation
    // mark is on the cover and read with the card.
    expect(
      screen.getByRole('button', { name: 'The Town Musicians of Bremen masalını aç, English' }),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Bremen Mızıkacıları 2 masalını aç, Bölüm 2' })).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Parmak Kız masalını aç, Yapay zekâ ile çevrildi' }),
    ).toBeOnTheScreen();
    expect(within(screen.getByTestId('related-c-1')).getByTestId('cover-translation')).toBeOnTheScreen();
    // The link reads like the narrators' one.
    expect(screen.getByRole('button', { name: 'İlgili masalların tümünü gör' })).toBeOnTheScreen();
  });

  it('a related card opens its own story page on top of this one', async () => {
    await renderWithRelated();
    fireEvent.press(screen.getByTestId('related-s-1-p2'));
    expect(mockNavigation.push).toHaveBeenCalledWith('StoryDetail', { storyId: 's-1-p2' });
  });

  it('"Tümü" opens everything grouped; a story picked there opens once the sheet has gone', async () => {
    await renderWithRelated();
    fireEvent.press(screen.getByTestId('related-heading-link'));
    const sheet = within(await screen.findByTestId('related-sheet'));

    for (const heading of ['Başka dillerde', 'Diğer bölümler', 'Aynı türden masallar']) {
      expect(sheet.getByRole('header', { name: heading })).toBeOnTheScreen();
    }
    expect(within(screen.getByTestId('related-group-languages')).getByTestId('related-sheet-s-1-en')).toBeOnTheScreen();
    expect(within(screen.getByTestId('related-group-parts')).getByTestId('related-sheet-s-1-p2')).toBeOnTheScreen();
    const category = within(screen.getByTestId('related-group-category'));
    expect(category.getAllByRole('button').map(node => node.props.testID)).toEqual([
      'related-sheet-c-1',
      'related-sheet-c-2',
      'related-sheet-c-3',
    ]);
    // A premium story the plan does not play carries the lock on its cover.
    expect(
      within(screen.getByTestId('related-sheet-c-3')).getByTestId('cover-lock', { includeHiddenElements: true }),
    ).toBeOnTheScreen();

    fireEvent.press(sheet.getByTestId('related-sheet-c-2'));
    await waitFor(() => expect(screen.queryByTestId('related-sheet')).toBeNull());
    expect(mockNavigation.push).toHaveBeenCalledWith('StoryDetail', { storyId: 'c-2' });
  });

  it('a locked related story explains the plans instead of opening', async () => {
    await renderWithRelated(
      parseRelatedStoriesFromJSON({ languages: [], parts: [], category: [item('c-3', 'Altın Kuş', { isPremium: true })] }),
    );
    fireEvent.press(screen.getByTestId('related-c-3'));
    expect(mockNavigation.push).not.toHaveBeenCalled();
    expect(lastDialog().title).toBe('Bu masal ücretli planlarda');
  });

  it('hides the section when nothing is related or the request fails', async () => {
    const view = await renderWithRelated(NO_RELATED_STORIES);
    expect(screen.queryByTestId('related-section')).toBeNull();
    expect(screen.queryByTestId('related-loading')).toBeNull();
    view.unmount();

    resetRelatedStoriesForTests();
    await renderWithRelated(new Error('offline'));
    expect(screen.queryByTestId('related-loading')).toBeNull();
    expect(screen.queryByTestId('related-section')).toBeNull();
  });

  it('holds the related row on bones while it loads', async () => {
    await renderScreen();
    await screen.findByRole('header', { name: 'Bremen Mızıkacıları' });
    expect(screen.getByTestId('related-loading')).toBeOnTheScreen();
  });

  it('"Kaynak ve lisans" is the last section, folded into one row', async () => {
    mockGetStoryById.mockImplementation(() =>
      Promise.resolve(
        parseStoryDetailFromJSON({
          ...STORY_JSON,
          credit: { ...STORY_JSON.credit, attribution: 'The Fox, A. Writer, CC BY 4.0', licenseName: 'CC BY 4.0' },
        }),
      ),
    );
    await renderWithRelated();
    const more = within(screen.getByTestId('story-detail-more'));
    const order = more
      .getAllByTestId(/^(story-credits|story-languages|related-section|story-source)$/)
      .map(node => node.props.testID);
    expect(order).toEqual(['story-credits', 'story-languages', 'related-section', 'story-source']);
    expect(screen.queryByTestId('story-source-rows')).toBeNull();
    const toggle = screen.getByTestId('story-source-toggle');
    expect(within(toggle).getByTestId('icon-chevronDown', { includeHiddenElements: true })).toBeOnTheScreen();
    fireEvent.press(toggle);
    expect(screen.getByTestId('story-source-rows')).toBeOnTheScreen();
    expect(within(toggle).getByTestId('icon-chevronUp', { includeHiddenElements: true })).toBeOnTheScreen();
  });
});
