/**
 * AudioGenerationScreen: the narration wait screen (playful system: cover on a
 * category glow, Baloo 2 title, a 12dp progress track in the action colour).
 *
 * The audio player store is an observable plain object: a test moves the
 * progress, the slow flag, the error, the quota block and the conflict the
 * way the real store does. Quota blocks are parsed by the real
 * `parseQuotaBlock` from the backend's 403 bodies (contract fixtures), so the
 * copy on screen is the copy a real refusal produces.
 */

import React from 'react';
import { BackHandler, Platform } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { observable, runInAction } from 'mobx';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { DEFAULT_STORY_EXTRAS, Story } from '../../models/Story';
import { AgeGroup, StoryCategory } from '../../types/enums';
import { parseQuotaBlock, type QuotaBlock } from '../../models/Quota';
import type { PlanId } from '../../models/Plans';
import { apiErrorFromResponse, type FailureKind } from '../../services/ApiError';
import { ProgressBar, pickPlaceholderIndex, resetCoverAssignments } from '../../components/design';
import {
  backendPremiumStoryError,
  backendQuotaCloneLifetimeError,
  backendQuotaCloneMonthlyError,
  backendQuotaCloneMonthlyPremiumError,
  backendQuotaPresetMonthlyError,
} from '../../test-utils/contract-fixtures';
import {
  getNarrationMeta,
  rememberNarrationMeta,
  resetNarrationMetaForTests,
  type NarrationMeta,
} from '../../stores/narrationMeta';
import AudioGenerationScreen, {
  TEXT_STAGE_MS,
  generationStage,
  pairNarrationMeta,
} from './AudioGenerationScreen';

jest.setTimeout(60000);

const STORY: Story = {
  id: 's-1',
  title: 'Bremen Mızıkacıları',
  description: null,
  ageGroup: AgeGroup.THREE_TO_SIX,
  category: StoryCategory.WORLD_CLASSICS,
  estimatedDuration: 6,
  coverImageUrl: null,
  isPremium: false,
  isFavorite: false,
  ...DEFAULT_STORY_EXTRAS,
};
const VOICE = { id: 'vp-1', name: 'Zeynep' };

interface PlayerMock {
  isGenerating: boolean;
  generationProgress: number;
  generatingNarrationId: string | null;
  generationReadyId: string | null;
  generationSlow: boolean;
  quotaBlock: QuotaBlock | null;
  hasError: boolean;
  errorMessage: string;
  errorKind: FailureKind | null;
  conflictExistingNarrationId: string | null;
  conflictExistingNarrationStatus: string | null;
  generatingStory: Story | null;
  generatingVoiceProfile: { id: string; name: string } | null;
  // The story in the player (another one than the job, or nothing).
  audioId: string;
  currentStory: Story | null;
  currentVoiceProfile: { id: string; name: string } | null;
  isStoryLoaded: boolean;
  isPlaying: boolean;
  beginGenerationSession: jest.Mock;
  generateAudio: jest.Mock;
  failGeneration: jest.Mock;
  stopGenerating: jest.Mock;
  setError: jest.Mock;
  clearError: jest.Mock;
  clearConflict: jest.Mock;
  resumeGenerationPoll: jest.Mock;
}

let mockPlayer: PlayerMock;
let mockVoiceStore: {
  voiceProfiles: Array<{ id: string; name: string }>;
  loadVoiceProfiles: jest.Mock;
};
const mockStoryStore = { peekStory: jest.fn((_id: string): Story | null => null) };
let mockSubscription: { planId: PlanId; usage: null } = { planId: 'free', usage: null };
const mockGetStoryById = jest.fn();
const mockEnsurePush = jest.fn(() => Promise.resolve(true));

jest.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => mockPlayer,
}));
jest.mock('../../hooks/useVoiceProfile', () => ({
  useVoiceProfile: () => mockVoiceStore,
}));
jest.mock('../../hooks/useStory', () => ({
  useStory: () => mockStoryStore,
}));
jest.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => mockSubscription,
}));
jest.mock('../../services/StoryService', () => ({
  __esModule: true,
  default: { getStoryById: (...args: unknown[]) => mockGetStoryById(...args) },
}));
jest.mock('../../services/PushNotificationService', () => ({
  ensurePushPermission: () => mockEnsurePush(),
}));

const mockNav = {
  replace: jest.fn(),
  navigate: jest.fn(),
  dispatch: jest.fn(),
  goBack: jest.fn(),
  canGoBack: jest.fn(() => true),
  isFocused: jest.fn(() => true),
};
let mockRouteParams: Record<string, unknown> | undefined;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockRouteParams }),
}));

function makePlayer(patch: Partial<PlayerMock> = {}): PlayerMock {
  // The jest mocks stay plain (MobX would wrap them into actions).
  const player: PlayerMock = observable(
    {
      isGenerating: false,
      generationProgress: 0,
      generatingNarrationId: null as string | null,
      generationReadyId: null as string | null,
      generationSlow: false,
      quotaBlock: null as QuotaBlock | null,
      hasError: false,
      errorMessage: '',
      errorKind: null as FailureKind | null,
      conflictExistingNarrationId: null as string | null,
      conflictExistingNarrationStatus: null as string | null,
      generatingStory: null as Story | null,
      generatingVoiceProfile: null as { id: string; name: string } | null,
      audioId: '',
      currentStory: null as Story | null,
      currentVoiceProfile: null as { id: string; name: string } | null,
      isStoryLoaded: false,
      isPlaying: false,
      beginGenerationSession: jest.fn(),
      generateAudio: jest.fn(),
      failGeneration: jest.fn(),
      stopGenerating: jest.fn(),
      setError: jest.fn(),
      clearError: jest.fn(),
      clearConflict: jest.fn(),
      resumeGenerationPoll: jest.fn(),
      ...patch,
    },
    {
      quotaBlock: observable.ref,
      beginGenerationSession: false,
      generateAudio: false,
      failGeneration: false,
      stopGenerating: false,
      setError: false,
      clearError: false,
      clearConflict: false,
      resumeGenerationPoll: false,
    },
  );
  // The real store flips these synchronously.
  player.beginGenerationSession.mockImplementation(() => {
    runInAction(() => {
      player.isGenerating = true;
      player.hasError = false;
      player.errorMessage = '';
      player.errorKind = null;
      player.quotaBlock = null;
      player.generationSlow = false;
      player.generationProgress = 0;
      player.generationReadyId = null;
      player.generatingNarrationId = null;
      player.conflictExistingNarrationId = null;
      player.conflictExistingNarrationStatus = null;
    });
  });
  if (!patch.generateAudio) {
    // Only the job fields: the story in the player is never touched.
    player.generateAudio.mockImplementation(async (story: Story, voice: typeof VOICE) => {
      runInAction(() => {
        player.generatingStory = story;
        player.generatingVoiceProfile = voice;
        player.generatingNarrationId = 'n-1';
      });
    });
  }
  // A start failure the screen hands over (a missing voice, a failed fetch).
  player.failGeneration.mockImplementation((_error: unknown, fallback: string) => {
    runInAction(() => {
      player.isGenerating = false;
      player.hasError = true;
      player.errorMessage = fallback;
    });
  });
  player.setError.mockImplementation((message: string) => {
    runInAction(() => {
      player.hasError = true;
      player.errorMessage = message;
    });
  });
  player.stopGenerating.mockImplementation(() => {
    runInAction(() => {
      player.isGenerating = false;
    });
  });
  player.clearError.mockImplementation(() => {
    runInAction(() => {
      player.hasError = false;
      player.errorMessage = '';
      player.errorKind = null;
      player.quotaBlock = null;
    });
  });
  player.clearConflict.mockImplementation(() => {
    runInAction(() => {
      player.conflictExistingNarrationId = null;
      player.conflictExistingNarrationStatus = null;
    });
  });
  return player;
}

/** What the real store keeps for a 403 body: the parsed block, not generating. */
function refusedWith(body: Record<string, unknown>, plan: PlanId = 'free'): Partial<PlayerMock> {
  const block = parseQuotaBlock(apiErrorFromResponse(403, body), plan);
  if (!block) throw new Error('not a quota body');
  return {
    generateAudio: jest.fn(async () => {
      runInAction(() => {
        mockPlayer.isGenerating = false;
        mockPlayer.quotaBlock = block;
      });
    }),
  };
}

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

/**
 * "Yeniden hazırla" makes a new narration: the confirmation comes first and
 * "Seslendir" starts it once the sheet has gone.
 */
async function regenerateAndConfirm(taps = 1) {
  // The exit ends the way it does on a phone: from the animation's end
  // callback (Android), outside a React commit. (The jest Modal sends iOS's
  // onDismiss inside one, where a store change the screen observes is lost.)
  const os = jest.replaceProperty(Platform, 'OS', 'android');
  const ends: ((finished?: boolean) => void)[] = [];
  const timing = jest.spyOn(Reanimated, 'withTiming').mockImplementation(((
    toValue: number,
    _config?: unknown,
    callback?: (finished?: boolean) => void,
  ) => {
    if (callback) ends.push(callback);
    return toValue;
  }) as unknown as typeof Reanimated.withTiming);
  fireEvent.press(screen.getByRole('button', { name: 'Yeniden hazırla' }));
  const sheet = within(await screen.findByTestId('narration-confirm-sheet'));
  const confirm = sheet.getByRole('button', { name: 'Seslendir' });
  for (let tap = 0; tap < taps; tap += 1) fireEvent.press(confirm);
  await act(async () => {
    ends.splice(0).forEach(end => end(true));
  });
  timing.mockRestore();
  await waitFor(() => expect(screen.queryByTestId('narration-confirm-sheet')).toBeNull());
  os.restore();
}

async function renderScreen(theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi') {
  const utils = renderWithProviders(<AudioGenerationScreen />, { theme });
  await act(async () => undefined);
  return utils;
}

function setPlayer(patch: Partial<PlayerMock>) {
  act(() => {
    runInAction(() => {
      Object.assign(mockPlayer, patch);
    });
  });
}

function setProgress(value: number) {
  setPlayer({ generationProgress: value });
}

const BACKGROUND = 'Arka planda devam et';
const RESET_MAIN = { type: 'RESET', payload: { index: 0, routes: [{ name: 'Main' }] } };
const SINGLETON = { pop: true };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  resetCoverAssignments();
  resetNarrationMetaForTests();
  mockNav.canGoBack.mockReturnValue(true);
  mockNav.isFocused.mockReturnValue(true);
  mockRouteParams = { storyId: 's-1', voiceProfileId: 'vp-1' };
  mockSubscription = { planId: 'free', usage: null };
  mockPlayer = makePlayer();
  mockVoiceStore = {
    voiceProfiles: [VOICE],
    loadVoiceProfiles: jest.fn(() => Promise.resolve()),
  };
  mockStoryStore.peekStory.mockReset().mockReturnValue(null);
  mockGetStoryById.mockResolvedValue(STORY);
  mockEnsurePush.mockResolvedValue(true);
});

describe('generationStage', () => {
  it('names the stage of a percentage; a job the backend accepted is past starting', () => {
    expect(generationStage(0, false)).toBe('starting');
    expect(generationStage(0, false, true)).toBe('text');
    expect(generationStage(10, false)).toBe('text');
    expect(generationStage(30, false)).toBe('voicing');
    expect(generationStage(45, false)).toBe('voicing');
    expect(generationStage(60, false)).toBe('merging');
    expect(generationStage(90, false)).toBe('finishing');
    expect(generationStage(100, false)).toBe('finishing');
    expect(generationStage(100, true)).toBe('done');
    expect(generationStage(Number.NaN, false, true)).toBe('text');
  });

  it('once the text stage is over, a job at 0 or in the text band reads as voicing, never back', () => {
    // Not accepted yet: still starting, whatever the clock says.
    expect(generationStage(0, false, false, true)).toBe('starting');
    expect(generationStage(0, false, true, true)).toBe('voicing');
    expect(generationStage(Number.NaN, false, true, true)).toBe('voicing');
    expect(generationStage(10, false, true, true)).toBe('voicing');
    expect(generationStage(45, false, true, true)).toBe('voicing');
    expect(generationStage(72, false, true, true)).toBe('merging');
    expect(generationStage(95, false, true, true)).toBe('finishing');
    expect(generationStage(100, true, true, true)).toBe('done');
    expect(TEXT_STAGE_MS).toBeGreaterThanOrEqual(2000);
    expect(TEXT_STAGE_MS).toBeLessThanOrEqual(6000);
  });
});

describe('pairNarrationMeta', () => {
  it('reduces the job story and voice to what the player draws', () => {
    const meta = pairNarrationMeta('n-1', STORY, VOICE as never, 'vp-1');
    expect(meta).toEqual({
      narrationId: 'n-1',
      storyId: 's-1',
      voiceProfileId: 'vp-1',
      story: {
        id: 's-1',
        title: 'Bremen Mızıkacıları',
        coverImageUrl: null,
        translationGroupId: STORY.translationGroupId ?? null,
        category: StoryCategory.WORLD_CLASSICS,
      },
      voiceProfile: VOICE,
      narratorName: 'Zeynep',
      ownVoice: false,
      estimateMs: 0,
    });
  });

  it('names an own voice as such and keeps the route voice id without a profile', () => {
    const own = { id: 'vp-own', name: 'Annem', kind: 'CLONE', provider: 'CARTESIA' };
    expect(pairNarrationMeta('n-1', STORY, own as never)).toMatchObject({
      voiceProfileId: 'vp-own',
      ownVoice: true,
      narratorName: 'Annem',
    });
    expect(pairNarrationMeta('n-1', STORY, null, 'vp-1')).toMatchObject({
      voiceProfileId: 'vp-1',
      voiceProfile: null,
      narratorName: null,
      ownVoice: false,
    });
  });

  it('is null without a narration or a known story (the player then fetches it)', () => {
    expect(pairNarrationMeta('', STORY, null)).toBeNull();
    expect(pairNarrationMeta('n-1', null, null)).toBeNull();
    expect(pairNarrationMeta('n-1', { ...STORY, title: '' }, null)).toBeNull();
  });
});

describe('AudioGenerationScreen', () => {
  it('starts the narration and shows story, narrator and the real percentage', async () => {
    await renderScreen();

    expect(mockPlayer.beginGenerationSession).toHaveBeenCalledTimes(1);
    expect(mockEnsurePush).toHaveBeenCalledTimes(1);
    expect(mockGetStoryById).toHaveBeenCalledWith('s-1');
    expect(mockPlayer.generateAudio).toHaveBeenCalledWith(STORY, VOICE, { replace: false });

    expect(screen.getByRole('header', { name: 'Masalın hazırlanıyor' })).toBeOnTheScreen();
    expect(screen.getByTestId('generation-subtitle')).toHaveTextContent(
      'Bremen Mızıkacıları, Zeynep anlatacak',
    );
    expect(screen.getByTestId('generation-cover')).toBeOnTheScreen();
    // Accepted at 0: the text stage, no "%0", an indeterminate bar.
    expect(screen.getByTestId('generation-stage')).toHaveTextContent('Metin hazırlanıyor');
    expect(screen.getByTestId('generation-percent')).toHaveTextContent('');
    expect(screen.getByTestId('generation-bar').props.accessibilityValue).toBeUndefined();
    expect(screen.getByTestId('generation-note')).toHaveTextContent(
      'Birkaç dakika sürebilir. Beklemene gerek yok, hazır olunca haber veririz.',
    );

    setProgress(45);
    expect(screen.getByTestId('generation-stage')).toHaveTextContent('Seslendiriliyor');
    expect(screen.getByTestId('generation-percent')).toHaveTextContent('%45');
    expect(screen.getByTestId('generation-bar').props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 45,
    });

    setProgress(72);
    expect(screen.getByTestId('generation-stage')).toHaveTextContent('Parçalar birleştiriliyor');
    setProgress(95);
    expect(screen.getByTestId('generation-stage')).toHaveTextContent('Neredeyse hazır');
  });

  it('says Başlatılıyor until the backend has accepted the job', async () => {
    mockPlayer = makePlayer({ generateAudio: jest.fn(() => new Promise(() => undefined)) });
    await renderScreen();

    expect(screen.getByTestId('generation-stage')).toHaveTextContent('Başlatılıyor');
    expect(screen.getByTestId('generation-percent')).toHaveTextContent('');
    setPlayer({ generatingNarrationId: 'n-1' });
    expect(screen.getByTestId('generation-stage')).toHaveTextContent('Metin hazırlanıyor');
  });

  it('passes the replace param to the store', async () => {
    mockRouteParams = { storyId: 's-1', voiceProfileId: 'vp-1', replace: true };
    await renderScreen();

    expect(mockPlayer.generateAudio).toHaveBeenCalledWith(STORY, VOICE, { replace: true });
  });

  it('refreshes the voice list when the narrator is not loaded yet', async () => {
    mockVoiceStore.voiceProfiles = [];
    mockVoiceStore.loadVoiceProfiles.mockImplementation(async () => {
      mockVoiceStore.voiceProfiles = [VOICE];
    });
    await renderScreen();

    expect(mockVoiceStore.loadVoiceProfiles).toHaveBeenCalledTimes(1);
    expect(mockPlayer.generateAudio).toHaveBeenCalledWith(STORY, VOICE, { replace: false });
  });

  it('only shows the progress of a job that is already running for this pair', async () => {
    mockPlayer = makePlayer({
      isGenerating: true,
      generationProgress: 60,
      generatingNarrationId: 'n-1',
      generatingStory: STORY,
      generatingVoiceProfile: VOICE,
    });
    await renderScreen();

    expect(mockPlayer.beginGenerationSession).not.toHaveBeenCalled();
    expect(mockPlayer.generateAudio).not.toHaveBeenCalled();
    expect(mockGetStoryById).not.toHaveBeenCalled();
    // A poll that gave up on a long job follows it again.
    expect(mockPlayer.resumeGenerationPoll).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('generation-percent')).toHaveTextContent('%60');
    expect(screen.getByTestId('generation-subtitle')).toHaveTextContent(
      'Bremen Mızıkacıları, Zeynep anlatacak',
    );
  });

  it('back on a running slow job after notifications were declined: the Library note, no new start', async () => {
    mockEnsurePush.mockResolvedValue(false);
    mockPlayer = makePlayer({
      isGenerating: true,
      generationSlow: true,
      generationProgress: 40,
      generatingNarrationId: 'n-1',
      generatingStory: STORY,
      generatingVoiceProfile: VOICE,
    });
    await renderScreen();

    expect(mockPlayer.beginGenerationSession).not.toHaveBeenCalled();
    expect(screen.getByTestId('generation-note')).toHaveTextContent(
      "Beklenenden uzun sürüyor. Hazır olunca Kütüphane'de bulacaksın.",
    );
  });

  it('the story in the player is not the running job, even for the same pair', async () => {
    mockPlayer = makePlayer({
      isGenerating: true,
      generationProgress: 60,
      generatingStory: { ...STORY, id: 's-other' },
      generatingVoiceProfile: { id: 'vp-other', name: 'Kerem' },
      audioId: 'n-playing',
      currentStory: STORY,
      currentVoiceProfile: VOICE,
      isStoryLoaded: true,
      isPlaying: true,
    });
    await renderScreen();

    expect(mockPlayer.beginGenerationSession).toHaveBeenCalledTimes(1);
    expect(mockPlayer.generateAudio).toHaveBeenCalledWith(STORY, VOICE, { replace: false });
  });

  it('does not show the story of a previous job or the one playing', async () => {
    mockPlayer = makePlayer({
      generatingStory: { ...STORY, id: 's-old', title: 'Uykulu Ay' },
      generatingVoiceProfile: { id: 'vp-old', name: 'Kerem' },
      currentStory: { ...STORY, id: 's-playing', title: 'Deniz Feneri' },
      currentVoiceProfile: { id: 'vp-playing', name: 'Aoede' },
      isStoryLoaded: true,
      isPlaying: true,
      generateAudio: jest.fn(() => new Promise(() => undefined)),
    });
    mockGetStoryById.mockReturnValue(new Promise(() => undefined));
    await renderScreen();

    expect(screen.queryByText(/Uykulu Ay/)).toBeNull();
    expect(screen.queryByText(/Kerem/)).toBeNull();
    expect(screen.queryByText(/Deniz Feneri/)).toBeNull();
    // The line is laid out empty, so nothing moves when the story arrives.
    expect(screen.getByTestId('generation-subtitle')).toHaveTextContent('');
    expect(screen.queryByTestId('generation-cover')).toBeNull();
    expect(screen.getByTestId('generation-cover-loading')).toBeOnTheScreen();
  });

  describe('first frame', () => {
    // A tale key whose picture differs from the one the bare id would pick.
    const tale = ['tg-bremen', 'tg-bremen-2', 'tg-bremen-3'].find(
      key => pickPlaceholderIndex(key) !== pickPlaceholderIndex(STORY.id),
    )!;
    const KNOWN: Story = { ...STORY, translationGroupId: tale };

    it('draws the story the app already holds before the job has it: cover seed, glow, subtitle', async () => {
      mockStoryStore.peekStory.mockImplementation(id => (id === 's-1' ? KNOWN : null));
      // The job never gets its story: everything drawn comes from the held copy.
      mockPlayer = makePlayer({ generateAudio: jest.fn(() => new Promise(() => undefined)) });
      renderWithProviders(<AudioGenerationScreen />, { theme: 'kitaplik' });

      expect(mockPlayer.generatingStory).toBeNull();
      expect(screen.getByTestId(`cover-placeholder-${pickPlaceholderIndex(tale) + 1}`)).toBeOnTheScreen();
      expect(screen.queryByTestId(`cover-placeholder-${pickPlaceholderIndex(STORY.id) + 1}`)).toBeNull();
      expect(screen.getByTestId('generation-subtitle')).toHaveTextContent(
        'Bremen Mızıkacıları, Zeynep anlatacak',
      );
      expect(screen.UNSAFE_getAllByProps({ stopColor: themes.kitaplik.cat.dunya.color })).toHaveLength(3);
      expect(flatStyle(screen.getByTestId('generation-subtitle'))).toMatchObject({ minHeight: 23 });
      expect(screen.getByTestId('generation-subtitle').props.numberOfLines).toBe(2);
      // The job started with that copy, without a request for the story.
      expect(mockGetStoryById).not.toHaveBeenCalled();
      expect(mockPlayer.generateAudio).toHaveBeenCalledWith(KNOWN, VOICE, { replace: false });
    });

    it('a story with content warnings says so before listening, with its age group; one without says nothing', async () => {
      mockStoryStore.peekStory.mockReturnValue({
        ...KNOWN,
        ageGroup: 'THREE_TO_SIX' as Story['ageGroup'],
        contentWarnings: ['SCARY'],
      });
      mockPlayer = makePlayer({ generateAudio: jest.fn(() => new Promise(() => undefined)) });
      const view = renderWithProviders(<AudioGenerationScreen />);
      expect(screen.getByTestId('generation-content-note')).toHaveTextContent(
        '3-6 yaş için. Korkutucu bir sahne içeriyor.',
      );
      view.unmount();

      mockStoryStore.peekStory.mockReturnValue(KNOWN);
      renderWithProviders(<AudioGenerationScreen />);
      expect(screen.queryByTestId('generation-content-note')).toBeNull();
    });

    it('a story with a cover key draws the picture of its tale', async () => {
      const key = ['ck-1', 'ck-2', 'ck-3'].find(k => pickPlaceholderIndex(k) !== pickPlaceholderIndex(tale))!;
      mockStoryStore.peekStory.mockReturnValue({ ...KNOWN, coverKey: key });
      mockPlayer = makePlayer({ generateAudio: jest.fn(() => new Promise(() => undefined)) });
      renderWithProviders(<AudioGenerationScreen />);
      expect(screen.getByTestId(`cover-placeholder-${pickPlaceholderIndex(key) + 1}`)).toBeOnTheScreen();
    });

    it('nothing swaps once the job has its story', async () => {
      mockStoryStore.peekStory.mockReturnValue(KNOWN);
      renderWithProviders(<AudioGenerationScreen />);
      const picture = `cover-placeholder-${pickPlaceholderIndex(tale) + 1}`;
      const firstSubtitle = screen.getByTestId('generation-subtitle').props.children;
      expect(screen.getByTestId(picture)).toBeOnTheScreen();

      await act(async () => undefined);

      expect(mockPlayer.generatingStory).toEqual(KNOWN);
      expect(screen.getByTestId(picture)).toBeOnTheScreen();
      expect(screen.getByTestId('generation-subtitle').props.children).toBe(firstSubtitle);
      expect(mockGetStoryById).not.toHaveBeenCalled();
    });

    it('fetches a story the app does not hold once, with a bone for its cover meanwhile', async () => {
      let answer: (story: Story) => void = () => undefined;
      mockGetStoryById.mockReturnValue(new Promise<Story>(resolve => (answer = resolve)));
      renderWithProviders(<AudioGenerationScreen />);

      expect(screen.getByTestId('generation-cover-loading')).toBeOnTheScreen();
      expect(screen.queryByTestId('generation-cover')).toBeNull();
      expect(screen.getByTestId('generation-subtitle')).toHaveTextContent('');

      await act(async () => answer(KNOWN));

      expect(mockGetStoryById).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('generation-cover-loading')).toBeNull();
      expect(screen.getByTestId(`cover-placeholder-${pickPlaceholderIndex(tale) + 1}`)).toBeOnTheScreen();
    });

    it('prepares it again without fetching the story a second time', async () => {
      mockPlayer = makePlayer({
        generateAudio: jest.fn(async () => {
          runInAction(() => {
            mockPlayer.isGenerating = false;
            mockPlayer.conflictExistingNarrationId = 'n-old';
            mockPlayer.conflictExistingNarrationStatus = 'READY';
          });
        }),
      });
      await renderScreen();
      expect(mockGetStoryById).toHaveBeenCalledTimes(1);

      await regenerateAndConfirm();

      await waitFor(() =>
        expect(mockPlayer.generateAudio).toHaveBeenLastCalledWith(STORY, VOICE, { replace: true }),
      );
      expect(mockGetStoryById).toHaveBeenCalledTimes(1);
    });
  });

  it('READY opens the player with the ready narration and autoplay', async () => {
    await renderScreen();
    setPlayer({ generationProgress: 100, isGenerating: false, generationReadyId: 'n-1' });
    expect(screen.getByTestId('generation-stage')).toHaveTextContent('Hazır');
    expect(screen.getByTestId('generation-percent')).toHaveTextContent('%100');
    expect(mockNav.replace).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(mockNav.replace).toHaveBeenCalledTimes(1);
    expect(mockNav.replace).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'n-1', autoplay: true });
  });

  describe('the player opens on a known narration (SPEC-audio D6)', () => {
    /** The meta the player would read at the moment it is pushed. */
    function metaAtReplace(): Array<NarrationMeta | null> {
      const seen: Array<NarrationMeta | null> = [];
      mockNav.replace.mockImplementation((_route: string, params: { narrationId: string }) => {
        seen.push(getNarrationMeta(params.narrationId));
      });
      return seen;
    }

    it('READY remembers the job story and narrator before the player is pushed', async () => {
      const seen = metaAtReplace();
      await renderScreen();
      expect(getNarrationMeta('n-1')).toBeNull();

      setPlayer({ generationProgress: 100, isGenerating: false, generationReadyId: 'n-1' });
      act(() => {
        jest.advanceTimersByTime(400);
      });

      expect(mockNav.replace).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'n-1', autoplay: true });
      // Known when the player renders its first frame: no loading line, no fetch.
      expect(seen).toEqual([
        expect.objectContaining({
          narrationId: 'n-1',
          storyId: 's-1',
          voiceProfileId: 'vp-1',
          story: expect.objectContaining({ id: 's-1', title: 'Bremen Mızıkacıları' }),
          narratorName: 'Zeynep',
          ownVoice: false,
        }),
      ]);
    });

    it('a job that was running when the screen opened gets its meta too', async () => {
      const seen = metaAtReplace();
      mockPlayer = makePlayer({
        isGenerating: true,
        generationProgress: 60,
        generatingNarrationId: 'n-1',
        generatingStory: STORY,
        generatingVoiceProfile: VOICE,
      });
      await renderScreen();
      setPlayer({ generationProgress: 100, isGenerating: false, generationReadyId: 'n-1' });
      act(() => {
        jest.advanceTimersByTime(400);
      });

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ narrationId: 'n-1', story: { title: 'Bremen Mızıkacıları' } });
    });

    it('"Dinle" after READY while another story played remembers it as well', async () => {
      const seen = metaAtReplace();
      mockPlayer = makePlayer({ audioId: 'n-playing', isStoryLoaded: true, isPlaying: true });
      await renderScreen();
      setPlayer({ generationProgress: 100, isGenerating: false, generationReadyId: 'n-1' });

      fireEvent.press(screen.getByRole('button', { name: 'Dinle' }));
      expect(seen).toEqual([expect.objectContaining({ narrationId: 'n-1', narratorName: 'Zeynep' })]);
    });

    it('"Dinle" on an already narrated pair remembers the existing narration', async () => {
      const seen = metaAtReplace();
      mockPlayer = makePlayer({
        generateAudio: jest.fn(async (story: Story, voice: typeof VOICE) => {
          runInAction(() => {
            mockPlayer.generatingStory = story;
            mockPlayer.generatingVoiceProfile = voice;
            mockPlayer.isGenerating = false;
            mockPlayer.conflictExistingNarrationId = 'n-old';
            mockPlayer.conflictExistingNarrationStatus = 'READY';
          });
        }),
      });
      await renderScreen();

      fireEvent.press(screen.getByRole('button', { name: 'Dinle' }));
      expect(seen).toEqual([
        expect.objectContaining({ narrationId: 'n-old', storyId: 's-1', narratorName: 'Zeynep' }),
      ]);
    });

    it('keeps a fuller meta the app already knows (a story detail row with its length)', async () => {
      const known: NarrationMeta = {
        narrationId: 'n-1',
        storyId: 's-1',
        voiceProfileId: 'vp-1',
        story: {
          id: 's-1',
          title: 'Bremen Mızıkacıları',
          coverImageUrl: 'https://cdn/x.png',
          translationGroupId: null,
          category: 'WORLD_CLASSICS',
        },
        voiceProfile: null,
        narratorName: 'Zeynep',
        ownVoice: false,
        estimateMs: 360000,
      };
      rememberNarrationMeta(known);
      await renderScreen();
      setPlayer({ generationProgress: 100, isGenerating: false, generationReadyId: 'n-1' });
      act(() => {
        jest.advanceTimersByTime(400);
      });

      expect(mockNav.replace).toHaveBeenCalledTimes(1);
      expect(getNarrationMeta('n-1')).toBe(known);
    });

    it('without a known story the player is left to fetch it', async () => {
      // The job never gets its story and the app held none.
      mockPlayer = makePlayer({ generateAudio: jest.fn(() => new Promise(() => undefined)) });
      mockGetStoryById.mockReturnValue(new Promise(() => undefined));
      await renderScreen();
      setPlayer({ generationProgress: 100, isGenerating: false, generationReadyId: 'n-1' });
      act(() => {
        jest.advanceTimersByTime(400);
      });

      expect(mockNav.replace).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'n-1', autoplay: true });
      expect(getNarrationMeta('n-1')).toBeNull();
    });
  });

  describe('stage while the backend reports 0', () => {
    it('reads Metin hazırlanıyor for a few seconds after the job is accepted, then Seslendiriliyor', async () => {
      await renderScreen();
      expect(screen.getByTestId('generation-stage')).toHaveTextContent('Metin hazırlanıyor');

      act(() => {
        jest.advanceTimersByTime(TEXT_STAGE_MS - 100);
      });
      expect(screen.getByTestId('generation-stage')).toHaveTextContent('Metin hazırlanıyor');

      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(screen.getByTestId('generation-stage')).toHaveTextContent('Seslendiriliyor');
      // Still no percentage and an indeterminate bar.
      expect(screen.getByTestId('generation-percent')).toHaveTextContent('');
      expect(screen.getByTestId('generation-bar').props.accessibilityValue).toBeUndefined();

      // A first small percentage never takes it back to the text stage.
      setProgress(10);
      expect(screen.getByTestId('generation-stage')).toHaveTextContent('Seslendiriliyor');
      setProgress(72);
      expect(screen.getByTestId('generation-stage')).toHaveTextContent('Parçalar birleştiriliyor');
      setPlayer({ generationProgress: 100, isGenerating: false, generationReadyId: 'n-1' });
      expect(screen.getByTestId('generation-stage')).toHaveTextContent('Hazır');
    });

    it('the clock starts when the backend accepts the job, not when the screen opens', async () => {
      mockPlayer = makePlayer({ generateAudio: jest.fn(() => new Promise(() => undefined)) });
      await renderScreen();
      act(() => {
        jest.advanceTimersByTime(TEXT_STAGE_MS * 2);
      });
      expect(screen.getByTestId('generation-stage')).toHaveTextContent('Başlatılıyor');

      setPlayer({ generatingNarrationId: 'n-1' });
      expect(screen.getByTestId('generation-stage')).toHaveTextContent('Metin hazırlanıyor');
      act(() => {
        jest.advanceTimersByTime(TEXT_STAGE_MS);
      });
      expect(screen.getByTestId('generation-stage')).toHaveTextContent('Seslendiriliyor');
    });

    it('a new job (retry) starts on the text stage again', async () => {
      await renderScreen();
      act(() => {
        jest.advanceTimersByTime(TEXT_STAGE_MS);
      });
      expect(screen.getByTestId('generation-stage')).toHaveTextContent('Seslendiriliyor');

      setPlayer({ isGenerating: false, hasError: true, errorMessage: 'Ses sentezi başarısız oldu' });
      mockPlayer.generateAudio.mockImplementation(async () => {
        runInAction(() => {
          mockPlayer.generatingNarrationId = 'n-2';
        });
      });
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
      });

      expect(screen.getByTestId('generation-stage')).toHaveTextContent('Metin hazırlanıyor');
      act(() => {
        jest.advanceTimersByTime(TEXT_STAGE_MS);
      });
      expect(screen.getByTestId('generation-stage')).toHaveTextContent('Seslendiriliyor');
    });

    it('back on a job that was already running: past the text stage at once', async () => {
      mockPlayer = makePlayer({
        isGenerating: true,
        generationProgress: 0,
        generatingNarrationId: 'n-1',
        generatingStory: STORY,
        generatingVoiceProfile: VOICE,
      });
      await renderScreen();

      expect(mockPlayer.beginGenerationSession).not.toHaveBeenCalled();
      expect(screen.getByTestId('generation-stage')).toHaveTextContent('Seslendiriliyor');
    });

    it('is Narrating in English', async () => {
      await i18n.changeLanguage('en');
      await renderScreen();
      expect(screen.getByTestId('generation-stage')).toHaveTextContent('Preparing the text');
      act(() => {
        jest.advanceTimersByTime(TEXT_STAGE_MS);
      });
      expect(screen.getByTestId('generation-stage')).toHaveTextContent('Narrating');
    });
  });

  it('a finished job of an earlier session never opens the player for a new one', async () => {
    mockPlayer = makePlayer({ generationProgress: 100, generationReadyId: 'n-old' });
    await renderScreen();
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    // The new session cleared it before the effect could read it.
    expect(mockPlayer.beginGenerationSession).toHaveBeenCalledTimes(1);
    expect(mockNav.replace).not.toHaveBeenCalled();
  });

  it('READY while another story plays: no navigation, the dock offers Dinle', async () => {
    mockPlayer = makePlayer({
      audioId: 'n-playing',
      currentStory: { ...STORY, id: 's-playing', title: 'Deniz Feneri' },
      isStoryLoaded: true,
      isPlaying: true,
    });
    await renderScreen();
    setPlayer({ generationProgress: 100, isGenerating: false, generationReadyId: 'n-1' });
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(mockNav.replace).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: BACKGROUND })).toBeNull();
    // The primary takes the background action's place, md like it.
    expect(flatStyle(screen.getByTestId('generation-listen-face'))).toMatchObject({
      minHeight: 44,
      backgroundColor: themes['gece-mavisi'].action,
    });

    // The decision stays when the other story pauses meanwhile.
    setPlayer({ isPlaying: false });
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockNav.replace).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'Dinle' }));
    expect(mockNav.replace).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'n-1', autoplay: true });
  });

  it('READY with a story loaded but paused opens the player as usual', async () => {
    mockPlayer = makePlayer({ audioId: 'n-paused', isStoryLoaded: true, isPlaying: false });
    await renderScreen();
    setPlayer({ generationProgress: 100, isGenerating: false, generationReadyId: 'n-1' });
    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(mockNav.replace).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'n-1', autoplay: true });
  });

  it('a failed job never opens the player', async () => {
    await renderScreen();
    setPlayer({
      isGenerating: false,
      hasError: true,
      errorMessage: 'Ses sentezi başarısız oldu',
      generationReadyId: null,
    });
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockNav.replace).not.toHaveBeenCalled();
    expect(screen.getByText('Ses sentezi başarısız oldu')).toBeOnTheScreen();
  });

  it('continues in the background back to the story, or to Main without history', async () => {
    await renderScreen();

    fireEvent.press(screen.getByRole('button', { name: BACKGROUND }));
    expect(mockNav.goBack).toHaveBeenCalledTimes(1);
    expect(mockNav.dispatch).not.toHaveBeenCalled();

    mockNav.canGoBack.mockReturnValue(false);
    fireEvent.press(screen.getByRole('button', { name: BACKGROUND }));
    expect(mockNav.dispatch).toHaveBeenCalledWith(RESET_MAIN);
  });

  it('goes back from the app bar and from hardware back, to Main when there is no history', async () => {
    const addListener = jest.spyOn(BackHandler, 'addEventListener');
    await renderScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
    expect(mockNav.goBack).toHaveBeenCalledTimes(1);

    const handler = addListener.mock.calls[addListener.mock.calls.length - 1][1];
    expect(handler()).toBe(true);
    expect(mockNav.goBack).toHaveBeenCalledTimes(2);

    mockNav.canGoBack.mockReturnValue(false);
    fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
    expect(mockNav.dispatch).toHaveBeenCalledWith(RESET_MAIN);

    // The plans opened above it: their back is theirs.
    mockNav.isFocused.mockReturnValue(false);
    expect(handler()).toBe(false);
    expect(mockNav.goBack).toHaveBeenCalledTimes(2);
    expect(mockNav.dispatch).toHaveBeenCalledTimes(1);
  });

  it('says that the pair was already being prepared when the store follows that job', async () => {
    mockPlayer = makePlayer({
      generateAudio: jest.fn(async () => {
        runInAction(() => {
          mockPlayer.conflictExistingNarrationStatus = 'GENERATING';
          mockPlayer.generatingNarrationId = 'n-0';
        });
      }),
    });
    await renderScreen();

    expect(
      screen.getByText('Bu masal bu anlatıcıyla zaten hazırlanıyordu. Onu bekliyoruz.'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: BACKGROUND })).toBeOnTheScreen();
  });

  describe('slow and notifications', () => {
    it('a slow job says it takes longer, keeps its progress and the background action', async () => {
      await renderScreen();
      setProgress(30);
      setPlayer({ generationSlow: true });

      expect(screen.getByTestId('generation-note')).toHaveTextContent(
        'Beklenenden uzun sürüyor. Hazır olunca haber veririz.',
      );
      expect(screen.queryByText('Masal hazırlanamadı')).toBeNull();
      expect(screen.getByTestId('generation-percent')).toHaveTextContent('%30');
      expect(screen.getByRole('button', { name: BACKGROUND })).toBeOnTheScreen();

      // Ready after all: the player opens as usual.
      setPlayer({ generationProgress: 100, isGenerating: false, generationReadyId: 'n-1' });
      act(() => {
        jest.advanceTimersByTime(400);
      });
      expect(mockNav.replace).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'n-1', autoplay: true });
    });

    it('after a declined notification ask it points to the Library instead of promising a message', async () => {
      mockEnsurePush.mockResolvedValue(false);
      await renderScreen();

      expect(screen.getByTestId('generation-note')).toHaveTextContent(
        'Birkaç dakika sürebilir. Beklemene gerek yok, hazır olunca Kütüphane\'de bulacaksın.',
      );
      setPlayer({ generationSlow: true });
      expect(screen.getByTestId('generation-note')).toHaveTextContent(
        'Beklenenden uzun sürüyor. Hazır olunca Kütüphane\'de bulacaksın.',
      );
    });
  });

  describe('already narrated', () => {
    beforeEach(() => {
      mockPlayer = makePlayer({
        generateAudio: jest.fn(async () => {
          runInAction(() => {
            mockPlayer.isGenerating = false;
            mockPlayer.conflictExistingNarrationId = 'n-old';
            mockPlayer.conflictExistingNarrationStatus = 'READY';
          });
        }),
      });
    });

    it('offers the existing narration as the dock primary', async () => {
      await renderScreen();

      expect(screen.getByText('Bu masal zaten hazır')).toBeOnTheScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Dinle' }));

      expect(mockPlayer.clearConflict).toHaveBeenCalledTimes(1);
      expect(mockNav.replace).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'n-old', autoplay: true });
    });

    it('listen over regenerate over back, both md block', async () => {
      await renderScreen();
      const T = themes['gece-mavisi'];

      const listen = flatStyle(screen.getByTestId('generation-listen-existing-face'));
      const regenerate = flatStyle(screen.getByTestId('generation-regenerate-face'));
      expect(listen).toMatchObject({ minHeight: 44, backgroundColor: T.action });
      expect(regenerate).toMatchObject({ minHeight: 44 });
      expect(regenerate.backgroundColor).not.toBe(T.action);
      expect(flatStyle(screen.getByTestId('generation-regenerate-lip')).top).toBe(2);
      expect(flatStyle(screen.getByTestId('generation-regenerate'))).toMatchObject({ alignSelf: 'stretch' });

      const labels = screen.getAllByRole('button').map(b => b.props.accessibilityLabel);
      expect(labels.slice(-3)).toEqual(['Dinle', 'Yeniden hazırla', 'Geri dön']);
    });

    it('prepares it again with replace', async () => {
      await renderScreen();
      mockPlayer.generateAudio.mockImplementation(async () => undefined);

      await regenerateAndConfirm();

      await waitFor(() =>
        expect(mockPlayer.generateAudio).toHaveBeenLastCalledWith(STORY, VOICE, { replace: true }),
      );
      expect(mockPlayer.clearConflict).toHaveBeenCalled();
      expect(mockPlayer.beginGenerationSession).toHaveBeenCalledTimes(2);
      // Back on the progress view.
      expect(screen.getByRole('button', { name: BACKGROUND })).toBeOnTheScreen();
    });

    it('reports a failed second attempt through the store', async () => {
      await renderScreen();
      mockPlayer.generateAudio.mockRejectedValue(new Error('offline'));

      await regenerateAndConfirm();

      await waitFor(() => expect(mockPlayer.failGeneration).toHaveBeenCalledTimes(1));
      expect(mockPlayer.failGeneration).toHaveBeenCalledWith(
        expect.any(Error),
        'Masal yeniden hazırlanamadı',
      );
      expect(await screen.findByText('Masal hazırlanamadı')).toBeOnTheScreen();
    });

    it('"Yeniden hazırla" asks first: the story, the voice and the cost; "Vazgeç" starts nothing', async () => {
      await renderScreen();
      expect(mockPlayer.generateAudio).toHaveBeenCalledTimes(1);

      fireEvent.press(screen.getByRole('button', { name: 'Yeniden hazırla' }));
      const sheet = within(await screen.findByTestId('narration-confirm-sheet'));
      expect(sheet.getByRole('header', { name: 'Baştan hazırlansın mı?' })).toBeOnTheScreen();
      expect(sheet.getByTestId('narration-confirm-sheet-title')).toHaveTextContent('Bremen Mızıkacıları');
      expect(sheet.getByTestId('narration-confirm-sheet-story-line')).toHaveTextContent('Türkçe, yaklaşık 6 dk, 3-6 yaş');
      expect(sheet.getByTestId('narration-confirm-sheet-replaces')).toHaveTextContent('Yenisi eskisinin yerini alır.');
      expect(sheet.getByTestId('narration-confirm-sheet-voice-line')).toHaveTextContent('Hazır anlatıcı');
      expect(sheet.getByTestId('narration-confirm-sheet-cost')).toHaveTextContent(
        'Bu seslendirme hazır anlatıcı hakkından 1 kullanır.',
      );

      fireEvent.press(sheet.getByRole('button', { name: 'Vazgeç' }));
      await waitFor(() => expect(screen.queryByTestId('narration-confirm-sheet')).toBeNull());
      expect(mockPlayer.generateAudio).toHaveBeenCalledTimes(1);
      expect(mockPlayer.clearConflict).not.toHaveBeenCalled();
      expect(screen.getByText('Bu masal zaten hazır')).toBeOnTheScreen();
    });

    it('a double tap on "Seslendir" prepares it again once', async () => {
      await renderScreen();
      mockPlayer.generateAudio.mockImplementation(async () => undefined);
      await regenerateAndConfirm(2);
      await waitFor(() => expect(mockPlayer.generateAudio).toHaveBeenCalledTimes(2));
      expect(mockPlayer.generateAudio).toHaveBeenLastCalledWith(STORY, VOICE, { replace: true });
      expect(mockPlayer.beginGenerationSession).toHaveBeenCalledTimes(2);
    });

    it('goes back', async () => {
      await renderScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Geri dön' }));
      expect(mockNav.goBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('generation limit', () => {
    it('FREE ready-made stories used up: the plans first, then OK, never a retry', async () => {
      mockPlayer = makePlayer(refusedWith(backendQuotaPresetMonthlyError));
      await renderScreen();

      expect(screen.getByTestId('generation-limit')).toBeOnTheScreen();
      expect(screen.getByText('Bu ayki masal hakkın doldu')).toBeOnTheScreen();
      // The limit, the renewal date in the UI language, the upsell.
      expect(
        screen.getByText(
          /^Ücretsiz planda hazır anlatıcılarla ayda 20 masal dinleyebilirsin\. \d+ \S+ yenilenir\. Mini ve Premium planlarda sınırsız\.$/,
        ),
      ).toBeOnTheScreen();
      // Neither the backend's sentence nor a retry that would be refused again.
      expect(screen.queryByText(/hazır anlatıcı seslerle/)).toBeNull();
      expect(screen.queryByText('Tekrar dene')).toBeNull();
      expect(screen.queryByText('Masal hazırlanamadı')).toBeNull();
      expect(screen.queryByRole('button', { name: BACKGROUND })).toBeNull();

      const T = themes['gece-mavisi'];
      expect(flatStyle(screen.getByTestId('generation-plans-face'))).toMatchObject({
        minHeight: 44,
        backgroundColor: T.action,
      });
      expect(flatStyle(screen.getByTestId('generation-limit-ok-face')).backgroundColor).not.toBe(T.action);

      fireEvent.press(screen.getByRole('button', { name: 'Planları gör' }));
      expect(mockNav.navigate).toHaveBeenCalledWith('Subscription', { reason: 'quota' }, SINGLETON);

      fireEvent.press(screen.getByRole('button', { name: 'Tamam' }));
      expect(mockNav.goBack).toHaveBeenCalledTimes(1);
    });

    it('FREE own-voice story used up (refused by the generate call): it does not renew, ready-made instead', async () => {
      mockPlayer = makePlayer(refusedWith(backendQuotaCloneLifetimeError));
      await renderScreen();

      expect(screen.getByText('Kendi sesinle masal hakkın doldu')).toBeOnTheScreen();
      expect(screen.getByText(/Bu hak yenilenmez\./)).toBeOnTheScreen();
      expect(screen.queryByText(/yenilenir/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Planları gör' })).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Tamam' })).toBeNull();

      fireEvent.press(screen.getByRole('button', { name: 'Hazır anlatıcıyla dinle' }));
      expect(mockNav.goBack).toHaveBeenCalledTimes(1);
      expect(mockNav.navigate).not.toHaveBeenCalled();
    });

    it('MINI own-voice month used up: the plans (Premium has more) and a ready-made narrator', async () => {
      mockPlayer = makePlayer(refusedWith(backendQuotaCloneMonthlyError, 'mini'));
      await renderScreen();

      expect(screen.getByText('Bu ay kendi sesinle masal hakkın doldu')).toBeOnTheScreen();
      expect(screen.getByText(/Premium planda daha fazlası var\./)).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Planları gör' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Hazır anlatıcıyla dinle' })).toBeOnTheScreen();
    });

    it('PRO own-voice month used up: only the ready-made narrator, as the primary', async () => {
      mockPlayer = makePlayer(refusedWith(backendQuotaCloneMonthlyPremiumError, 'premium'));
      await renderScreen();

      expect(screen.getByTestId('generation-limit')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Planları gör' })).toBeNull();
      expect(screen.queryByText(/Premium planda/)).toBeNull();
      expect(flatStyle(screen.getByTestId('generation-ready-made-face'))).toMatchObject({
        minHeight: 44,
        backgroundColor: themes['gece-mavisi'].action,
      });
      const dockLabels = screen
        .getAllByRole('button')
        .map(b => b.props.accessibilityLabel)
        .filter(label => label !== 'Geri');
      expect(dockLabels).toEqual(['Hazır anlatıcıyla dinle']);
    });

    it('a premium story on the free plan: its own copy and the plans', async () => {
      mockPlayer = makePlayer(refusedWith(backendPremiumStoryError));
      await renderScreen();

      expect(screen.getByText('Bu masal ücretli planlarda')).toBeOnTheScreen();
      expect(screen.getByText('Mini ya da Premium planla dinleyebilirsin.')).toBeOnTheScreen();
      expect(screen.queryByText(/Pro aboneliği/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Planları gör' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Tamam' })).toBeOnTheScreen();
    });

    it('a fresh attempt leaves the limit state', async () => {
      mockPlayer = makePlayer(refusedWith(backendQuotaPresetMonthlyError));
      await renderScreen();
      expect(screen.getByTestId('generation-limit')).toBeOnTheScreen();

      act(() => {
        mockPlayer.beginGenerationSession();
      });
      expect(screen.queryByTestId('generation-limit')).toBeNull();
      expect(screen.getByRole('button', { name: BACKGROUND })).toBeOnTheScreen();
    });

    it('is in English in an English UI, without the backend sentence', async () => {
      await i18n.changeLanguage('en');
      mockPlayer = makePlayer(refusedWith(backendQuotaCloneLifetimeError));
      await renderScreen();

      expect(screen.getByText('You have used your own-voice story')).toBeOnTheScreen();
      expect(
        screen.getByText(
          'The free plan includes 1 story in your own voice. It does not renew. Switch to Mini or Premium for more stories in your own voice.',
        ),
      ).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'See plans' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Listen with a ready-made narrator' })).toBeOnTheScreen();
      expect(screen.queryByText(/[çğıöşüÇĞİÖŞÜ]/)).toBeNull();
    });
  });

  describe('errors', () => {
    it('shows the store error and retries from the dock', async () => {
      mockPlayer = makePlayer({
        generateAudio: jest.fn(async () => {
          runInAction(() => {
            mockPlayer.isGenerating = false;
            mockPlayer.hasError = true;
            mockPlayer.errorMessage = 'Ses sentezi başarısız oldu';
          });
        }),
      });
      await renderScreen();

      expect(screen.getByText('Masal hazırlanamadı')).toBeOnTheScreen();
      expect(screen.getByText('Ses sentezi başarısız oldu')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: BACKGROUND })).toBeNull();
      expect(flatStyle(screen.getByTestId('generation-retry-face'))).toMatchObject({ minHeight: 44 });

      mockPlayer.generateAudio.mockImplementation(async () => undefined);
      fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));

      await waitFor(() => expect(mockPlayer.generateAudio).toHaveBeenCalledTimes(2));
      expect(mockPlayer.clearError).toHaveBeenCalledTimes(1);
      expect(mockPlayer.clearConflict).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: BACKGROUND })).toBeOnTheScreen();
    });

    it('an offline start says so, with the wifi-off state', async () => {
      mockPlayer = makePlayer({
        generateAudio: jest.fn(async () => {
          runInAction(() => {
            mockPlayer.isGenerating = false;
            mockPlayer.hasError = true;
            mockPlayer.errorKind = 'offline';
            mockPlayer.errorMessage = 'İnternet bağlantısı yok';
          });
        }),
      });
      await renderScreen();

      expect(screen.getByText('İnternete bağlı değilsin')).toBeOnTheScreen();
      expect(screen.getByText('Masalı hazırlamak için internet bağlantısı gerekiyor.')).toBeOnTheScreen();
      expect(screen.queryByText('Masal hazırlanamadı')).toBeNull();
      expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeOnTheScreen();
    });

    it('a server failure keeps the screen copy', async () => {
      mockPlayer = makePlayer({
        generateAudio: jest.fn(async () => {
          runInAction(() => {
            mockPlayer.isGenerating = false;
            mockPlayer.hasError = true;
            mockPlayer.errorKind = 'server';
          });
        }),
      });
      await renderScreen();

      expect(screen.getByText('Masal hazırlanamadı')).toBeOnTheScreen();
      expect(screen.getByText('Sorun bizde. Biraz sonra tekrar dene.')).toBeOnTheScreen();
    });

    it('reports a narrator that cannot be found', async () => {
      mockVoiceStore.voiceProfiles = [];
      await renderScreen();

      expect(mockVoiceStore.loadVoiceProfiles).toHaveBeenCalledTimes(1);
      expect(mockPlayer.generateAudio).not.toHaveBeenCalled();
      expect(mockPlayer.failGeneration).toHaveBeenCalledWith(
        expect.any(Error),
        'Masal hazırlanmaya başlanamadı',
      );
      expect(await screen.findByText('Masal hazırlanamadı')).toBeOnTheScreen();

      fireEvent.press(screen.getByRole('button', { name: 'Geri dön' }));
      expect(mockNav.goBack).toHaveBeenCalledTimes(1);
    });

    it('a story that cannot be fetched goes to the store with its error', async () => {
      const refused = apiErrorFromResponse(403, backendPremiumStoryError);
      mockGetStoryById.mockRejectedValue(refused);
      await renderScreen();

      expect(mockPlayer.generateAudio).not.toHaveBeenCalled();
      expect(mockPlayer.failGeneration).toHaveBeenCalledWith(refused, 'Masal hazırlanmaya başlanamadı');
    });

    it('falls back to its own message when the store has none', async () => {
      mockPlayer = makePlayer({
        generateAudio: jest.fn(async () => {
          runInAction(() => {
            mockPlayer.isGenerating = false;
            mockPlayer.hasError = true;
          });
        }),
      });
      await renderScreen();

      expect(screen.getByText('Sorun bizde. Biraz sonra tekrar dene.')).toBeOnTheScreen();
    });
  });

  it('does nothing without route params', async () => {
    mockRouteParams = undefined;
    await renderScreen();

    expect(mockPlayer.beginGenerationSession).not.toHaveBeenCalled();
    expect(mockPlayer.generateAudio).not.toHaveBeenCalled();
    expect(screen.getByRole('header', { name: 'Masalın hazırlanıyor' })).toBeOnTheScreen();
  });

  it('the bar is animated: indeterminate at 0, then a native-driven fill that eases to each value', async () => {
    await renderScreen();
    expect(screen.UNSAFE_getByType(ProgressBar).props.animated).toBe(true);
    fireEvent(screen.getByTestId('generation-bar'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 12 } },
    });
    setProgress(40);

    const fill = screen.getByTestId('generation-bar-fill');
    expect(flatStyle(fill)).toMatchObject({ width: 300, backgroundColor: themes['gece-mavisi'].action });
    expect(flatStyle(fill).transform).toBeDefined();
    expect(screen.getByTestId('generation-bar').props.accessibilityValue).toMatchObject({ now: 40 });
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', async scheme => {
    await renderScreen(scheme);
    setProgress(45);
    const T = themes[scheme];

    // Baloo 2 title, Nunito stage, Baloo 2 percentage.
    expect(flatStyle(screen.getByText('Masalın hazırlanıyor'))).toMatchObject({
      color: T.text,
      fontFamily: T.fontDisplay,
      textAlign: 'center',
    });
    expect(flatStyle(screen.getByTestId('generation-percent'))).toMatchObject({
      color: T.text,
      fontFamily: T.fontDisplay,
    });
    expect(flatStyle(screen.getByTestId('generation-stage')).color).toBe(T.text2);
    // A fat track in the line colour.
    expect(flatStyle(screen.getByTestId('generation-bar'))).toMatchObject({
      height: 12,
      backgroundColor: T.line,
    });
    // The background action is a secondary md block on its 2dp lip.
    expect(flatStyle(screen.getByTestId('generation-background-face'))).toMatchObject({
      backgroundColor: T.surface,
      minHeight: 44,
    });
    expect(flatStyle(screen.getByTestId('generation-background-lip'))).toMatchObject({
      backgroundColor: T.lip,
      top: 2,
    });
    expect(flatStyle(screen.getByTestId('generation-background'))).toMatchObject({ alignSelf: 'stretch' });
    expect(flatStyle(screen.getByTestId('generation-cover'))).toMatchObject({ width: 144 });
  });

  it.each([
    ['tr', 'Arka planda devam et'],
    ['en', 'Continue in the background'],
  ] as const)('the background label shows in full on one line at its own size (%s, NL-03)', async (lang, label) => {
    if (lang === 'en') await i18n.changeLanguage('en');
    await renderScreen();
    // The whole label, last word included, is the one text on the face.
    const text = screen.getByText(label);
    expect(text).toHaveTextContent(label, { exact: true });
    expect(screen.getByRole('button', { name: label })).toBeOnTheScreen();
    // One line at the md label size, never squeezed in the row and never
    // auto-fitted: Android's auto-fit path drew "Arka planda devam" with "et"
    // on a clipped second line and no ellipsis.
    expect(text.props).toMatchObject({ numberOfLines: 1, ellipsizeMode: 'tail', textBreakStrategy: 'simple' });
    expect(text.props.adjustsFontSizeToFit).toBeUndefined();
    expect(text.props.minimumFontScale).toBeUndefined();
    expect(flatStyle(text)).toMatchObject({ flexShrink: 0, fontSize: 15, lineHeight: 21, textAlign: 'center' });
    // Still a secondary md block with its clock icon, centred with the label.
    expect(flatStyle(screen.getByTestId('generation-background'))).toMatchObject({ alignSelf: 'stretch' });
    expect(flatStyle(screen.getByTestId('generation-background-face'))).toMatchObject({
      minHeight: 44,
      flexDirection: 'row',
      justifyContent: 'center',
    });
    expect(screen.getByTestId('icon-clock', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('centres the cover on a glow of the story category, on a full-width stage', async () => {
    await renderScreen('kitaplik');
    const glow = screen.getByTestId('generation-glow', { includeHiddenElements: true });
    expect(flatStyle(glow)).toMatchObject({ width: 270, height: 270, position: 'absolute', left: '50%' });
    expect(flatStyle(screen.getByTestId('generation-art'))).toMatchObject({
      alignSelf: 'stretch',
      alignItems: 'center',
    });
    // The Dünya klasikleri colour once the story of this route is known.
    expect(screen.UNSAFE_getAllByProps({ stopColor: themes.kitaplik.cat.dunya.color })).toHaveLength(3);
  });

  it('is translated into English, with the percent sign after the number', async () => {
    await i18n.changeLanguage('en');
    await renderScreen();
    setProgress(45);

    expect(screen.getByRole('header', { name: 'Your story is being prepared' })).toBeOnTheScreen();
    expect(screen.getByTestId('generation-subtitle')).toHaveTextContent(
      'Bremen Mızıkacıları, told by Zeynep',
    );
    expect(screen.getByTestId('generation-stage')).toHaveTextContent('Narrating');
    expect(screen.getByTestId('generation-percent')).toHaveTextContent('45%');
    expect(screen.getByRole('button', { name: 'Continue in the background' })).toBeOnTheScreen();
    setPlayer({ generationSlow: true });
    expect(screen.getByTestId('generation-note')).toHaveTextContent(
      'This is taking longer than usual. We will let you know when it is ready.',
    );
  });
});
