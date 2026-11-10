/**
 * HomeScreen (design/v4/playful, frame a): greeting with the bell and the
 * avatar, the "Bu gecenin masalı" hero (a story a day, the player for a
 * ready narration), category tiles and shelves from one request per
 * category, cheap first render (four covers a shelf, the later shelves a
 * frame later, memoised shelves), the cover menu, premium locks, the
 * collections of the content language, loading / offline / error / empty
 * states, scroll to top, palettes.
 */

import React from 'react';
import { Animated, Dimensions, FlatList, ScrollView } from 'react-native';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { NavigationContext, NavigationRouteContext } from '@react-navigation/native';
import { runInAction } from 'mobx';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { mockNavigation } from '../../test-utils/mocks/navigation';
import i18n from '../../i18n';
import { SPACE, makeTextStyles, themes } from '../../theme/theme';
import { DURATION } from '../../theme/motion';
import { contrastRatio } from '../../theme/color';
import { PALETTE_KEYS, type PaletteKey } from '../../theme/palettes';
import { resetCoverAssignments } from '../../components/design';
import { coverCardHeight, coverLip, textLineBox } from '../../components/design/PictureCover';
import { DEFAULT_STORY_EXTRAS, EMPTY_STORY_CREDIT, Story } from '../../models/Story';
import { parseStoryNarrationFromJSON, type StoryNarration } from '../../models/Narration';
import { ApiError, classifyFailure, type FailureKind } from '../../services/ApiError';
import { getConnectivityStore } from '../../stores/ConnectivityStore';
import { getContentLanguageStore } from '../../hooks/useContentLanguage';
import { getNarrationMeta, resetNarrationMetaForTests } from '../../stores/narrationMeta';
import { mockNarrationJSON, mockStoryJSON } from '../../test-utils/mock-data';
import { AgeGroup, StoryCategory } from '../../types/enums';
import HomeScreen, {
  FIRST_SHELVES,
  HERO_HEIGHT,
  HOME_CATEGORIES,
  SHELF_COVER_HEIGHT,
  SHELF_COVER_WIDTH,
  SHELF_GAP,
  SHELF_INITIAL_COVERS,
  SHELF_TITLE_LINES,
  dayOfYear,
  dayPartOf,
  featuredTagKey,
  greetingName,
  heroLanguageChip,
  pickFeaturedStory,
  shelfItemLayout,
  shelfListHeight,
} from './HomeScreen';

jest.setTimeout(60000);

const story = (id: string, title: string, patch: Partial<Story> = {}): Story => ({
  id,
  title,
  description: null,
  ageGroup: AgeGroup.THREE_TO_SIX,
  category: StoryCategory.WORLD_CLASSICS,
  estimatedDuration: 6,
  coverImageUrl: null,
  isPremium: false,
  isFavorite: false,
  ...DEFAULT_STORY_EXTRAS,
  ...patch,
});

const STORIES: Story[] = [
  story('s-1', 'Bremen Mızıkacıları'),
  story('s-2', 'Ninni Mırıldanan Deniz Feneri', {
    category: StoryCategory.BEDTIME,
    estimatedDuration: 5,
    availableLanguages: ['tr', 'en'],
  }),
  story('s-3', 'Keloğlan ile Altın Başaklar', { category: StoryCategory.TURKISH_CLASSICS }),
  story('s-4', 'Parmak Kız', {
    credit: { ...EMPTY_STORY_CREDIT, translationMethod: 'MACHINE' },
  }),
];

/** The category shelves as the per-category requests answer them. */
function shelvesOf(stories: readonly Story[]): Map<string, Story[]> {
  const map = new Map<string, Story[]>();
  stories.forEach(item => map.set(String(item.category), [...(map.get(String(item.category)) ?? []), item]));
  return map;
}

function narration(id: string, storyId: string, status = 'READY'): StoryNarration {
  return parseStoryNarrationFromJSON({
    ...mockNarrationJSON,
    id,
    storyId,
    status,
    completedAt: status === 'READY' ? '2026-10-12T21:00:00.000Z' : null,
    story: { ...mockStoryJSON, id: storyId, title: 'Ninni Mırıldanan Deniz Feneri' },
  });
}

interface MockStoryStore {
  contentLanguageChanged?: jest.Mock;
  stories: Story[];
  favoriteStories: Story[];
  errorMessage: string;
  listErrorKind: FailureKind | null;
  shelfByCategory: Map<string, Story[]>;
  hasLoadedShelves: boolean;
  isLoadingShelves: boolean;
  shelvesErrorKind: FailureKind | null;
  loadStories: jest.Mock;
  loadFavorites: jest.Mock;
  refresh: jest.Mock;
  loadCategoryShelves: jest.Mock;
  loadNarrationsForStory: jest.Mock;
  getNarrationsForStory: jest.Mock;
  peekStory: jest.Mock;
  getFavoriteState: jest.Mock;
  toggleFavorite: jest.Mock;
}

let mockStoryStore: MockStoryStore;
const savedIds = new Set<string>();
// The top bar bell asks for the unread count (components/common/TopBarAccount).
const mockGetUnreadCount = jest.fn(() => Promise.resolve(0));
jest.mock('../../services/NotificationService', () => ({
  __esModule: true,
  default: { getUnreadCount: () => mockGetUnreadCount() },
}));
jest.mock('../../hooks/useStory', () => ({
  useStory: () => mockStoryStore,
  getStoryStore: () => mockStoryStore,
}));

let mockAuthStore: {
  backendUser: { firstName: string } | null;
  user: { displayName: string; email?: string } | null;
};
jest.mock('../../hooks/useAuth', () => ({ useAuth: () => mockAuthStore }));

/** The plan: a plain free-plan stand-in, or a real SubscriptionStore on Mini. */
let mockSubscription: { hasPremiumStories: boolean } = { hasPremiumStories: false };
jest.mock('../../hooks/useSubscription', () => ({ useSubscription: () => mockSubscription }));
/** A real SubscriptionStore on the Mini plan (no GET /usage yet: the tier decides). */
function miniPlan(): { hasPremiumStories: boolean } {
  const { SubscriptionStore } = jest.requireActual('../../hooks/useSubscription');
  const store = new SubscriptionStore();
  store.setTierFromUser('MINI');
  return store;
}

const mockShowDialog = jest.fn();
jest.mock('../../hooks/useDialog', () => ({
  useDialog: () => ({ showDialog: mockShowDialog, hideDialog: jest.fn() }),
}));

const mockCollectionList = jest.fn();
jest.mock('../../services/CollectionService', () => ({
  __esModule: true,
  default: { list: (...args: unknown[]) => mockCollectionList(...args) },
}));

// The content language store is real: the catalogue languages and the
// stored pick come from these.
const mockGetLanguages = jest.fn();
const mockPrefsGet = jest.fn();
jest.mock('../../services/UserPreferencesService', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockPrefsGet(...args),
    readCached: () => Promise.resolve(null),
    getCachedSync: () => null,
  },
}));

// The real StoryStore (some tests) asks StoryService.
const mockGetStories = jest.fn();
const mockGetFavoriteStories = jest.fn();
const mockServiceToggleFavorite = jest.fn();
jest.mock('../../services/StoryService', () => ({
  __esModule: true,
  default: {
    getStories: (...args: unknown[]) => mockGetStories(...args),
    getLanguages: (...args: unknown[]) => mockGetLanguages(...args),
    getFavoriteStories: (...args: unknown[]) => mockGetFavoriteStories(...args),
    toggleFavorite: (...args: unknown[]) => mockServiceToggleFavorite(...args),
  },
}));

const mockGetNarrationsByStory = jest.fn();
jest.mock('../../services/NarrationService', () => ({
  __esModule: true,
  default: { getNarrationsByStory: (...args: unknown[]) => mockGetNarrationsByStory(...args) },
}));

jest.mock('../../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));
const mockToast = jest.requireMock('../../utils/toast').showToast as Record<
  'success' | 'error' | 'info',
  jest.Mock
>;

let mockMiniPlayerInset = 0;
jest.mock('../../components/audio/useMiniPlayerInset', () => ({
  useMiniPlayerInset: () => mockMiniPlayerInset,
}));

// Every CoverCard render, by its testID (the memo test counts them).
const mockCoverRenders: string[] = [];
jest.mock('../../components/design', () => {
  const actual = jest.requireActual('../../components/design');
  const ReactActual = jest.requireActual('react');
  return {
    ...actual,
    CoverCard: (props: { testID?: string }) => {
      mockCoverRenders.push(props.testID ?? '');
      return ReactActual.createElement(actual.CoverCard, props);
    },
  };
});

// useScrollToTop listens to the tab navigator of the screen.
const tabPressListeners: ((event: { defaultPrevented?: boolean }) => void)[] = [];
const mockTabNavigation = {
  getState: () => ({ type: 'tab', routes: [{ key: 'stories-route' }] }),
  getParent: () => undefined,
  isFocused: () => true,
  addListener: (event: string, listener: (event: { defaultPrevented?: boolean }) => void) => {
    if (event === 'tabPress') tabPressListeners.push(listener);
    return () => {
      const index = tabPressListeners.indexOf(listener);
      if (index >= 0) tabPressListeners.splice(index, 1);
    };
  },
};

const HomeTree: React.FC = () => (
  <NavigationContext.Provider value={mockTabNavigation as never}>
    <NavigationRouteContext.Provider value={{ key: 'stories-route', name: 'Stories' } as never}>
      <HomeScreen />
    </NavigationRouteContext.Provider>
  </NavigationContext.Provider>
);

const pageOf = (data: Story[]) => ({ data, meta: { page: 1, limit: 20, total: data.length, totalPages: 1 } });

beforeEach(() => {
  // 21:14, the mockup's clock: bedtime.
  jest.setSystemTime(new Date(2026, 9, 15, 21, 14));
  resetCoverAssignments();
  resetNarrationMetaForTests();
  mockCoverRenders.length = 0;
  tabPressListeners.length = 0;
  mockMiniPlayerInset = 0;
  mockSubscription = { hasPremiumStories: false };
  mockStoryStore = {
    contentLanguageChanged: jest.fn(),
    stories: STORIES,
    favoriteStories: [],
    errorMessage: '',
    listErrorKind: null,
    shelfByCategory: shelvesOf(STORIES),
    hasLoadedShelves: true,
    isLoadingShelves: false,
    shelvesErrorKind: null,
    loadStories: jest.fn().mockResolvedValue(undefined),
    loadFavorites: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    loadCategoryShelves: jest.fn().mockResolvedValue(undefined),
    loadNarrationsForStory: jest.fn().mockResolvedValue(undefined),
    getNarrationsForStory: jest.fn(() => []),
    peekStory: jest.fn(() => null),
    // The saved state the store holds, flipped by its toggle.
    getFavoriteState: jest.fn((id: string) => savedIds.has(id)),
    toggleFavorite: jest.fn(async (id: string) => {
      if (savedIds.has(id)) savedIds.delete(id);
      else savedIds.add(id);
      return 'done';
    }),
  };
  savedIds.clear();
  mockAuthStore = { backendUser: { firstName: 'zeynep' }, user: null };
  mockCollectionList.mockReset().mockResolvedValue([]);
  mockGetNarrationsByStory.mockReset().mockResolvedValue([]);
  mockGetStories.mockReset();
  mockGetLanguages.mockReset().mockResolvedValue({
    defaultLanguage: 'tr',
    languages: [
      { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', isDefault: true, storyCount: 182, levels: [] },
      { code: 'en', nativeName: 'English', englishName: 'English', isDefault: false, storyCount: 157, levels: ['A1'] },
    ],
  });
  mockPrefsGet.mockReset().mockResolvedValue({ contentLanguage: null, effectiveContentLanguage: 'tr' });
  mockGetFavoriteStories.mockReset().mockResolvedValue(pageOf([]));
  mockServiceToggleFavorite.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  getContentLanguageStore().reset();
  await i18n.changeLanguage('tr');
});

/**
 * Render and let the mount work settle; `deferred: false` stops before the
 * frame that mounts the shelves after the first FIRST_SHELVES.
 */
async function renderHome(
  theme: PaletteKey = 'gece-mavisi',
  options: { deferred?: boolean } = {},
) {
  const view = renderWithProviders(<HomeTree />, { theme });
  await act(async () => undefined);
  if (options.deferred !== false) {
    await act(async () => {
      jest.advanceTimersByTime(20);
    });
  }
  return view;
}

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      jest.advanceTimersByTime(20);
    });
  }
}

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(6).filter(Boolean));
const face = (id: string) => flatStyle(screen.getByTestId(`${id}-face`));
const shelfIds = () =>
  screen
    .queryAllByTestId(/^home-shelf-[A-Za-z_]+$/)
    .map(node => String(node.props.testID).replace('home-shelf-', ''));

describe('selection logic', () => {
  const bedtime = [
    story('b-1', 'Uykulu Ay', { category: StoryCategory.BEDTIME }),
    story('b-2', 'Yıldız Toplayan Kız', { category: StoryCategory.BEDTIME }),
    story('b-3', 'Bulut Yatağı', { category: StoryCategory.BEDTIME }),
  ];

  it('counts the day of the year from January 1st', () => {
    expect(dayOfYear(new Date(2026, 0, 1, 0, 5))).toBe(1);
    expect(dayOfYear(new Date(2026, 1, 1, 23, 59))).toBe(32);
    expect(dayOfYear(new Date(2026, 11, 31, 12))).toBe(365);
    expect(dayOfYear(new Date(2028, 11, 31, 12))).toBe(366);
  });

  it('features another bedtime story every day, the first story without one', () => {
    const list = [STORIES[0], ...bedtime];
    expect(pickFeaturedStory(list, true, new Date(2026, 0, 1))?.id).toBe('b-2');
    expect(pickFeaturedStory(list, true, new Date(2026, 0, 2))?.id).toBe('b-3');
    expect(pickFeaturedStory(list, true, new Date(2026, 0, 3))?.id).toBe('b-1');
    // The same day keeps its story from morning to night.
    expect(pickFeaturedStory(list, true, new Date(2026, 0, 3, 23, 50))?.id).toBe('b-1');
    expect(pickFeaturedStory([STORIES[0], STORIES[2]], true)?.id).toBe('s-1');
    expect(pickFeaturedStory([], true)).toBeNull();
  });

  it('never features a premium story without premium stories', () => {
    const list = [
      story('p-1', 'Altın Kuş', { category: StoryCategory.BEDTIME, isPremium: true }),
      story('p-2', 'Gümüş Kuş', { category: StoryCategory.BEDTIME, isPremium: true }),
      story('f-1', 'Ay Işığı', { category: StoryCategory.BEDTIME }),
      story('w-1', 'Kırmızı Kurdele', { isPremium: true }),
    ];
    for (let day = 1; day <= 6; day += 1) {
      expect(pickFeaturedStory(list, false, new Date(2026, 0, day))?.id).toBe('f-1');
    }
    // No free bedtime story: the first free story; nothing free: no hero.
    expect(pickFeaturedStory([list[0], STORIES[0]], false)?.id).toBe('s-1');
    expect(pickFeaturedStory([list[0], list[3]], false)).toBeNull();
    // Mini and Premium get premium stories too.
    expect(pickFeaturedStory(list, true, new Date(2026, 0, 1))?.id).toBe('p-2');
  });

  it('names the part of the day, bedtime from 21 on, and the hero tag by it', () => {
    expect(dayPartOf(7)).toBe('morning');
    expect(dayPartOf(13)).toBe('day');
    expect(dayPartOf(18)).toBe('evening');
    expect(dayPartOf(21)).toBe('night');
    expect(dayPartOf(2)).toBe('night');
    expect(featuredTagKey('morning')).toBe('featured.tagDay');
    expect(featuredTagKey('day')).toBe('featured.tagDay');
    expect(featuredTagKey('evening')).toBe('featured.tagNight');
    expect(featuredTagKey('night')).toBe('featured.tagNight');
  });

  it('writes the first name with a Turkish capital', () => {
    expect(greetingName('zeynep')).toBe('Zeynep');
    expect(greetingName('ipek')).toBe('İpek');
    expect(greetingName('  ')).toBe('');
    expect(greetingName(null)).toBe('');
  });

  it('lays shelf covers out without measuring', () => {
    expect(shelfItemLayout(null, 0)).toEqual({ length: SHELF_COVER_WIDTH, offset: 16, index: 0 });
    expect(shelfItemLayout(null, 3)).toEqual({
      length: SHELF_COVER_WIDTH,
      offset: 16 + (SHELF_COVER_WIDTH + SHELF_GAP) * 3,
      index: 3,
    });
  });
});

describe('HomeScreen', () => {
  it('keeps the greeting to one compact heading line, with no question above it (owner feedback)', async () => {
    await renderHome();
    expect(screen.queryByText('Bugün hangi masalı dinleyelim?')).toBeNull();
    const title = within(screen.getByTestId('home-greeting')).getByRole('header', {
      name: 'İyi geceler, Zeynep',
    });
    expect(flatStyle(title)).toMatchObject({ fontSize: 21, lineHeight: 28 });
    expect(flatStyle(screen.getByTestId('home-greeting')).marginTop).toBe(8);
  });

  it('greets by the time of day and name, with the bell and the avatar (no wordmark)', async () => {
    await renderHome();
    expect(screen.getByRole('header', { name: 'İyi geceler, Zeynep' })).toBeOnTheScreen();
    expect(screen.queryByText('sesly')).toBeNull();
    expect(screen.getByTestId('home-bell')).toBeOnTheScreen();
    expect(screen.getByText('Z')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Profil' }));
    expect(mockNavigation.navigate.mock.calls.map(([name]) => name)).toContain('Profile');
  });

  it('greets without a name when none is known, and by the morning clock', async () => {
    jest.setSystemTime(new Date(2026, 9, 15, 8, 0));
    mockAuthStore = { backendUser: null, user: null };
    await renderHome();
    expect(screen.getByRole('header', { name: 'Günaydın' })).toBeOnTheScreen();
  });

  it("features tonight's story in the hero: category tag, title, glass chips, play", async () => {
    await renderHome();
    expect(screen.getByText('Bu gecenin masalı')).toBeOnTheScreen();
    const hero = within(screen.getByTestId('home-featured'));
    expect(hero.getByText('Ninni Mırıldanan Deniz Feneri')).toBeOnTheScreen();
    expect(hero.getByText('5 dk')).toBeOnTheScreen();
    expect(hero.getByText('3-6 yaş')).toBeOnTheScreen();
    // A story in the content language names no language.
    expect(hero.queryByText('Türkçe')).toBeNull();
    // Its narrations are asked for, so the play button can start one.
    expect(mockStoryStore.loadNarrationsForStory).toHaveBeenCalledWith('s-2');

    fireEvent.press(screen.getByTestId('home-featured-open'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-2' });
  });

  it('says "Bugünün masalı" in the morning and "Bu gecenin masalı" in the evening', async () => {
    jest.setSystemTime(new Date(2026, 9, 15, 9, 0));
    const view = await renderHome();
    expect(within(screen.getByTestId('home-featured-tag')).getByText('Bugünün masalı')).toBeOnTheScreen();
    view.unmount();

    jest.setSystemTime(new Date(2026, 9, 15, 21, 30));
    await renderHome();
    expect(within(screen.getByTestId('home-featured-tag')).getByText('Bu gecenin masalı')).toBeOnTheScreen();
  });

  it('plays a ready narration of the featured story in the player, started at once', async () => {
    mockStoryStore.getNarrationsForStory.mockImplementation((id: string) =>
      id === 's-2' ? [narration('n-old', 's-2', 'GENERATING'), narration('n-7', 's-2')] : [],
    );
    await renderHome();
    fireEvent.press(
      screen.getByRole('button', { name: 'Ninni Mırıldanan Deniz Feneri masalını dinle' }),
    );
    expect(mockNavigation.navigate).toHaveBeenCalledWith('AudioPlayer', {
      narrationId: 'n-7',
      autoplay: true,
    });
    // The player has the title before any request.
    expect(getNarrationMeta('n-7')?.story.title).toBe('Ninni Mırıldanan Deniz Feneri');
  });

  it('opens the story page from the play button when nothing is narrated yet', async () => {
    mockStoryStore.getNarrationsForStory.mockReturnValue([narration('n-1', 's-2', 'GENERATING')]);
    await renderHome();
    fireEvent.press(screen.getByTestId('home-featured-listen'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-2' });
    expect(mockNavigation.navigate).not.toHaveBeenCalledWith('AudioPlayer', expect.anything());
  });

  it('never features a premium story for a free user; Mini gets it', async () => {
    mockStoryStore.stories = [
      story('p-1', 'Altın Kuş', { category: StoryCategory.BEDTIME, isPremium: true }),
      story('f-1', 'Ay Işığı'),
    ];
    mockStoryStore.shelfByCategory = shelvesOf(mockStoryStore.stories);
    const view = await renderHome();
    expect(within(screen.getByTestId('home-featured')).getByText('Ay Işığı')).toBeOnTheScreen();
    view.unmount();

    mockSubscription = miniPlan();
    await renderHome();
    expect(within(screen.getByTestId('home-featured')).getByText('Altın Kuş')).toBeOnTheScreen();
  });

  it('names the language level on the hero; the language only when it is not the content language', async () => {
    mockStoryStore.stories = [
      story('s-9', 'Sleepy Moon', { category: StoryCategory.BEDTIME, language: 'en', languageLevel: 'A1' }),
    ];
    await renderHome();
    expect(screen.getByText('English A1')).toBeOnTheScreen();
    expect(heroLanguageChip({ language: 'en', languageLevel: 'A1' }, 'en')).toBe('A1');
    expect(heroLanguageChip({ language: 'tr', languageLevel: null }, 'tr')).toBe('');
    expect(heroLanguageChip({ language: 'tr', languageLevel: null }, 'en')).toBe('Türkçe');
  });

  it('an English UI without a pick gets an English Home: no language chip, English requests', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    mockStoryStore.stories = [
      story('s-9', 'Sleepy Moon', { category: StoryCategory.BEDTIME, language: 'en', languageLevel: 'A1' }),
    ];
    mockStoryStore.favoriteStories = [
      story('f-en', 'Saved Moon', { language: 'en' }),
      story('f-tr', 'Keloğlan', { language: 'tr' }),
    ];
    await renderHome();
    expect(getContentLanguageStore().effective).toBe('en');
    const hero = within(screen.getByTestId('home-featured'));
    expect(hero.getByText('A1')).toBeOnTheScreen();
    expect(hero.queryByText('English A1')).toBeNull();
    // The collections of English, and the saved shelf keeps the English tale only.
    expect(mockCollectionList).toHaveBeenLastCalledWith('en');
    const savedShelf = within(screen.getByTestId('home-shelf-saved'));
    expect(savedShelf.getByText('Saved Moon')).toBeOnTheScreen();
    expect(savedShelf.queryByText('Keloğlan')).toBeNull();
  });

  it('draws a 184dp hero with a 56dp play button on a 3dp lip and its overlays 12 in', async () => {
    await renderHome();
    expect(HERO_HEIGHT).toBe(184);
    expect(face('home-featured-listen')).toMatchObject({ width: 56, height: 56, borderRadius: 28 });
    expect(flatStyle(screen.getByTestId('home-featured-listen-lip')).top).toBe(3);
    const glyph = within(screen.getByTestId('home-featured-listen')).getByTestId('icon-play', {
      includeHiddenElements: true,
    });
    expect(flatStyle(glyph)).toMatchObject({ width: 24, height: 24 });
    // The tag and the bottom row 12 from every edge.
    const tagBox = flatStyle(screen.getByTestId('home-featured-tag-box'));
    expect(tagBox).toMatchObject({ top: 12, left: 12 });
    const bottom = flatStyle(screen.getByTestId('home-featured-bottom'));
    expect(bottom).toMatchObject({ left: 12, right: 12, bottom: 12, gap: 8 });
  });

  it('keeps two lines of the hero title clear of the tag at the largest font', async () => {
    await renderHome();
    const title = screen.getByTestId('home-featured-title');
    const titleStyle = flatStyle(title);
    const titleScale: number = title.props.maxFontSizeMultiplier;
    const tag = screen.getByTestId('home-featured-tag');
    const tagHeight: number = flatStyle(tag).minHeight;
    const tagLabel = within(tag).getByText('Bu gecenin masalı');
    const tagScale: number = tagLabel.props.maxFontSizeMultiplier;
    // A Tag stays at its minimum height while its label fits at the cap.
    expect(flatStyle(tagLabel).lineHeight * tagScale).toBeLessThanOrEqual(tagHeight);
    const chips = within(screen.getByTestId('home-featured')).getByText('5 dk');
    expect(chips.props.maxFontSizeMultiplier).toBe(tagScale);

    const top = flatStyle(screen.getByTestId('home-featured-tag-box')).top as number;
    const bottomInset = flatStyle(screen.getByTestId('home-featured-bottom')).bottom as number;
    const textBlock = 2 * titleStyle.lineHeight * titleScale + titleStyle.marginBottom + tagHeight;
    const gapUnderTag = HERO_HEIGHT - bottomInset - textBlock - (top + tagHeight);
    expect(titleScale).toBe(1.2);
    expect(gapUnderTag).toBeGreaterThanOrEqual(SPACE.sm);
  });

  it('has a tile per category with stories; a tile opens Keşfet filtered to it', async () => {
    await renderHome();
    expect(screen.getByRole('button', { name: 'Uyku masalları' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Türk masalları' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Dünya klasikleri' })).toBeOnTheScreen();
    // No educational story on the shelves: no tile that leads nowhere.
    expect(screen.queryByTestId('home-category-EDUCATIONAL')).toBeNull();

    fireEvent.press(screen.getByTestId('home-category-TURKISH_CLASSICS'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Main', {
      screen: 'Discover',
      params: { category: 'TURKISH_CLASSICS' },
    });
  });

  it('draws tile bones and a shelf skeleton while the category shelves load', async () => {
    mockStoryStore.hasLoadedShelves = false;
    mockStoryStore.isLoadingShelves = true;
    mockStoryStore.shelfByCategory = new Map();
    await renderHome();
    expect(screen.getByTestId('home-tiles-loading').props.accessibilityState).toEqual({ busy: true });
    expect(screen.queryByTestId('home-categories')).toBeNull();
    expect(screen.getByTestId('home-shelves-loading')).toBeOnTheScreen();
    // A load is running: mounting does not start a second one.
    expect(mockStoryStore.loadCategoryShelves).not.toHaveBeenCalled();
    // The hero and "Yeni eklenenler" do not wait for the shelves.
    expect(screen.getByTestId('home-featured')).toBeOnTheScreen();
    expect(screen.getByTestId('home-shelf-new')).toBeOnTheScreen();
  });

  it('builds the shelves from one request per category; a failing category drops only its tile', async () => {
    const { StoryStore } = jest.requireActual('../../hooks/useStory');
    const store = new StoryStore();
    mockStoryStore = store;
    // Page 1 holds bedtime stories only; the categories answer on their own.
    const page1 = Array.from({ length: 6 }, (_, i) =>
      story(`b-${i}`, `Uyku masalı ${i}`, { category: StoryCategory.BEDTIME }),
    );
    mockGetStories.mockImplementation((params: { category?: string }) => {
      switch (params.category) {
        case undefined:
          return Promise.resolve(pageOf(page1));
        case 'TURKISH_CLASSICS':
          return Promise.reject(new ApiError({ message: 'Sunucu hatası', status: 500 }));
        case 'EDUCATIONAL':
          return Promise.resolve(
            pageOf([
              story('e-1', 'Sayı Ormanı', { category: StoryCategory.EDUCATIONAL }),
              story('e-2', 'Renkler Şehri', { category: StoryCategory.EDUCATIONAL }),
            ]),
          );
        case 'WORLD_CLASSICS':
          return Promise.resolve(pageOf([story('w-1', 'Altın Kaz')]));
        default:
          return Promise.resolve(pageOf(page1.slice(0, 3)));
      }
    });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await renderHome();
    await settle();

    const categoryCalls = mockGetStories.mock.calls
      .map(([params]) => params as { category?: string; limit: number; language?: string; grouped?: boolean })
      .filter(params => params.category);
    expect(categoryCalls.map(params => params.category)).toEqual([...HOME_CATEGORIES]);
    // One language per shelf (flat), never a grouped list with tales of other languages.
    expect(categoryCalls.every(params => params.limit === 10 && params.language === 'tr' && !params.grouped)).toBe(true);

    expect(screen.queryByTestId('home-category-TURKISH_CLASSICS')).toBeNull();
    expect(screen.getByTestId('home-category-EDUCATIONAL')).toBeOnTheScreen();
    expect(screen.getByTestId('home-category-WORLD_CLASSICS')).toBeOnTheScreen();
    expect(screen.getByTestId('home-category-BEDTIME')).toBeOnTheScreen();
    // Shelves in HOME_CATEGORIES order after the new ones.
    expect(shelfIds()).toEqual(['new', 'BEDTIME', 'WORLD_CLASSICS', 'EDUCATIONAL']);
    expect(within(screen.getByTestId('home-shelf-EDUCATIONAL')).getByText('Sayı Ormanı')).toBeOnTheScreen();
  });

  it('lists the other stories on the "Yeni eklenenler" shelf as cover cards', async () => {
    await renderHome();
    expect(screen.getByRole('header', { name: 'Yeni eklenenler' })).toBeOnTheScreen();
    // The featured story is not repeated on the new shelf.
    const shelf = within(screen.getByTestId('home-shelf-new'));
    expect(shelf.queryByTestId('home-tile-s-2')).toBeNull();
    expect(shelf.getByTestId('home-tile-s-1')).toBeOnTheScreen();
    expect(screen.getAllByTestId('cover-duration').length).toBeGreaterThan(0);
    expect(screen.getAllByText('6 dk').length).toBeGreaterThan(0);

    fireEvent.press(screen.getAllByRole('button', { name: 'Parmak Kız masalını aç, Yapay zekâ ile çevrildi' })[0]);
    expect(mockNavigation.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-4' });
  });

  it('marks a translated story with the translation icon on its cover, next to the minutes', async () => {
    await renderHome();
    // The mark is read as part of the card, not as a stop of its own.
    expect(screen.getAllByRole('button', { name: 'Parmak Kız masalını aç, Yapay zekâ ile çevrildi' }).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Yapay zekâ ile çevrildi')).toBeNull();
    // On the picture: the sparkles on the duration's glass at the bottom
    // right, the minutes at the bottom left; nothing under the title.
    const T = themes['gece-mavisi'];
    const card = within(screen.getAllByTestId('home-tile-s-4')[0]);
    const mark = card.getByTestId('cover-translation');
    expect(within(mark).getByTestId('icon-aiTranslation', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(flatStyle(mark)).toMatchObject({ position: 'absolute', right: SPACE.tight, bottom: SPACE.tight });
    const glass = mark.findAll((node: ReturnType<typeof screen.getByTestId>) => typeof node.type === 'string' && flatStyle(node).backgroundColor === T.glass);
    expect(glass).toHaveLength(1);
    expect(flatStyle(glass[0])).toMatchObject({ height: 22, borderRadius: 11 });
    expect(flatStyle(card.getByTestId('cover-duration'))).toMatchObject({
      left: SPACE.tight,
      bottom: SPACE.tight,
      backgroundColor: T.glass,
    });
    expect(screen.queryByTestId('home-tile-s-4-meta')).toBeNull();
    // An original-language story has no mark.
    expect(within(screen.getAllByTestId('home-tile-s-1')[0]).queryByTestId('cover-translation')).toBeNull();
  });

  it('has one shelf per category, with no dot before any title, and "Tümü" leads on', async () => {
    await renderHome();
    expect(screen.getByRole('header', { name: 'Dünya klasikleri' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Türk masalları' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Uyku masalları' })).toBeOnTheScreen();
    // Owner feedback: no coloured dot in front of a shelf title, category or not.
    for (const shelf of ['new', 'TURKISH_CLASSICS', 'WORLD_CLASSICS', 'BEDTIME']) {
      expect(screen.getByTestId(`home-shelf-${shelf}-header`)).toBeOnTheScreen();
      expect(screen.queryByTestId(`home-shelf-${shelf}-header-dot`)).toBeNull();
    }

    fireEvent.press(screen.getByTestId('home-shelf-new-header-link'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('AllStories');
    fireEvent.press(screen.getByTestId('home-shelf-TURKISH_CLASSICS-header-link'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Main', {
      screen: 'Discover',
      params: { category: 'TURKISH_CLASSICS' },
    });
    // The link reads which shelf it opens.
    expect(screen.getByRole('button', { name: 'Türk masalları, tümünü gör' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Yeni eklenenler, tümünü gör' })).toBeOnTheScreen();
  });

  it('spaces the shelves 20 apart with 12 from a header to its covers', async () => {
    await renderHome();
    expect(flatStyle(screen.getByTestId('home-shelf-new-header'))).toMatchObject({
      marginTop: 20,
      paddingHorizontal: 16,
    });
    expect(flatStyle(screen.getByTestId('home-shelf-new-list')).marginTop).toBe(12);
  });

  describe('nothing moves while Home loads (HOME-SHIFT)', () => {
    const { fontScale, scale } = Dimensions.get('window');
    /** A shelf card with two title lines at the test window's font scale (the marks are on the cover). */
    const cardHeight = () =>
      coverCardHeight({
        width: SHELF_COVER_WIDTH,
        coverHeight: SHELF_COVER_HEIGHT,
        titleLines: 2,
        fontScale,
        pixelRatio: scale,
      });
    const listHeight = (id: string) => flatStyle(screen.getByTestId(`home-shelf-${id}-list`)).height;
    const hidden = { includeHiddenElements: true };
    /** The skeleton shelf `id` from its heading to the bottom of its first caption. */
    const skeletonHeights = (id: string) => {
      const caption = flatStyle(screen.getByTestId(`${id}-caption-0`, hidden));
      return {
        heading: flatStyle(screen.getByTestId(`${id}-heading`, hidden)).height,
        list: SHELF_COVER_HEIGHT + coverLip(SHELF_COVER_WIDTH) + caption.marginTop + caption.height,
        marks: screen.queryByTestId(`${id}-caption-0-marks`, hidden) !== null,
      };
    };

    // A short (one line), a medium (two lines) and a long (three or more lines) title.
    const SHORT = 'Ay';
    const MEDIUM = 'Keloğlan ile Altın Başaklar';
    const LONG = 'Bremen Mızıkacıları ve Ormanın Derinindeki Gizli Şatonun Bekçisi';

    it('every shelf list has the fixed height of a card with two title lines, for 1-, 2- and 3-line titles', async () => {
      mockStoryStore.stories = [
        STORIES[1],
        story('t-1', SHORT),
        story('t-2', MEDIUM),
        story('t-3', LONG),
      ];
      mockStoryStore.shelfByCategory = new Map([
        ['BEDTIME', [story('b-1', SHORT, { category: StoryCategory.BEDTIME })]],
        ['TURKISH_CLASSICS', [story('k-1', MEDIUM, { category: StoryCategory.TURKISH_CLASSICS })]],
        ['WORLD_CLASSICS', [story('w-1', LONG)]],
      ]);
      await renderHome();
      expect(SHELF_TITLE_LINES).toBe(2);
      // 146 + 3 + 8 + two lines (36 each at the test window's font scale 2).
      expect(cardHeight()).toBe(shelfListHeight(fontScale, scale));
      for (const id of ['new', 'BEDTIME', 'TURKISH_CLASSICS', 'WORLD_CLASSICS']) {
        expect(listHeight(id)).toBe(cardHeight());
      }
      // Every title reserves exactly two lines: a long one is cut, never grows the shelf.
      for (const title of [SHORT, MEDIUM, LONG]) {
        for (const node of screen.getAllByText(title)) expect(node.props.numberOfLines).toBe(2);
      }
      // Under the list the next block starts 20 lower; the list starts 12 under its header.
      expect(flatStyle(screen.getByTestId('home-shelf-BEDTIME-header')).marginTop).toBe(SPACE.xl);
      expect(flatStyle(screen.getByTestId('home-shelf-BEDTIME-list')).marginTop).toBe(SPACE.md);
    });

    it('a lock or a translation mark sits on the cover, so every shelf keeps the same height', async () => {
      // World classics hold the translated "Parmak Kız"; a premium bedtime story is locked on the free plan.
      mockStoryStore.shelfByCategory = new Map([
        ['BEDTIME', [story('p-1', 'Yıldız Toplayan Kız', { category: StoryCategory.BEDTIME, isPremium: true })]],
        ['TURKISH_CLASSICS', [STORIES[2]]],
        ['WORLD_CLASSICS', [STORIES[0], STORIES[3]]],
      ]);
      const view = await renderHome();
      for (const id of ['BEDTIME', 'WORLD_CLASSICS', 'TURKISH_CLASSICS']) {
        expect(listHeight(id)).toBe(cardHeight());
      }
      const lock = within(screen.getByTestId('home-shelf-BEDTIME')).getByTestId('cover-lock', hidden);
      expect(flatStyle(lock)).toMatchObject({
        position: 'absolute',
        right: SPACE.tight,
        top: SPACE.tight,
        backgroundColor: themes['gece-mavisi'].glass,
      });
      expect(within(lock).getByTestId('icon-lock', hidden)).toBeOnTheScreen();
      expect(within(screen.getByTestId('home-shelf-WORLD_CLASSICS')).getByTestId('cover-translation')).toBeOnTheScreen();
      view.unmount();

      // Mini plays premium stories: no lock, the same height.
      mockSubscription = miniPlan();
      await renderHome();
      expect(listHeight('BEDTIME')).toBe(cardHeight());
      expect(within(screen.getByTestId('home-shelf-BEDTIME')).queryByTestId('cover-lock', hidden)).toBeNull();
    });

    it('the first-load skeleton shelves are as tall as the real shelves', async () => {
      mockStoryStore.stories = [];
      mockStoryStore.loadStories.mockReturnValue(new Promise(() => {}));
      await renderHome();
      for (const i of [0, 1]) {
        const skeleton = skeletonHeights(`home-loading-shelf-${i}-bones`);
        // The real heading's one line, then the list of a card with two title lines.
        expect(skeleton.heading).toBe(textLineBox(makeTextStyles(themes['gece-mavisi']).heading.lineHeight ?? 0, fontScale, scale));
        expect(skeleton.list).toBeCloseTo(cardHeight(), 6);
        expect(skeleton.marks).toBe(false);
        expect(flatStyle(screen.getByTestId(`home-loading-shelf-${i}`, hidden)).marginTop).toBe(SPACE.xl);
      }
    });

    it('holds the later shelves with skeletons of their own height until their frame comes', async () => {
      await renderHome('gece-mavisi', { deferred: false });
      expect(shelfIds()).toEqual(['new', 'BEDTIME']);
      // Right under the first shelves, nothing is empty: Türk masalları and Dünya klasikleri wait as skeletons.
      expect(screen.getByTestId('home-shelves-loading', hidden).props.accessibilityState).toEqual({ busy: true });
      const turkish = skeletonHeights('home-shelf-TURKISH_CLASSICS-loading-bones');
      const world = skeletonHeights('home-shelf-WORLD_CLASSICS-loading-bones');
      expect(turkish.list).toBeCloseTo(cardHeight(), 6);
      expect(turkish.marks).toBe(false);
      // Dünya klasikleri has the translated "Parmak Kız": its mark goes on
      // the cover, so its skeleton is just as tall.
      expect(world.list).toBeCloseTo(cardHeight(), 6);
      expect(world.marks).toBe(false);
      expect(flatStyle(screen.getByTestId('home-shelf-TURKISH_CLASSICS-loading', hidden)).marginTop).toBe(SPACE.xl);
      expect(screen.queryByTestId('home-shelf-EDUCATIONAL-loading', hidden)).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(20);
      });
      expect(shelfIds()).toEqual(['new', 'BEDTIME', 'TURKISH_CLASSICS', 'WORLD_CLASSICS']);
      expect(screen.queryByTestId('home-shelves-loading', hidden)).toBeNull();
      expect(listHeight('TURKISH_CLASSICS')).toBe(cardHeight());
      expect(listHeight('WORLD_CLASSICS')).toBe(cardHeight());
    });

    it('before the category shelves are in, a skeleton per category holds their place, before and after the later frame', async () => {
      mockStoryStore.hasLoadedShelves = false;
      mockStoryStore.isLoadingShelves = true;
      mockStoryStore.shelfByCategory = new Map();
      const view = await renderHome('gece-mavisi', { deferred: false });
      const pending = () =>
        screen
          .queryAllByTestId(/^home-shelf-[A-Z_]+-loading$/, hidden)
          .map(node => String(node.props.testID).replace(/^home-shelf-|-loading$/g, ''));
      expect(shelfIds()).toEqual(['new']);
      expect(pending()).toEqual([...HOME_CATEGORIES]);
      for (const category of HOME_CATEGORIES) {
        expect(skeletonHeights(`home-shelf-${category}-loading-bones`).list).toBeCloseTo(cardHeight(), 6);
      }

      await act(async () => {
        jest.advanceTimersByTime(20);
      });
      expect(pending()).toEqual([...HOME_CATEGORIES]);

      // The shelves arrive: the skeletons give way to them.
      mockStoryStore.hasLoadedShelves = true;
      mockStoryStore.isLoadingShelves = false;
      mockStoryStore.shelfByCategory = shelvesOf(STORIES);
      view.rerender(<HomeTree />);
      expect(pending()).toEqual([]);
      expect(shelfIds()).toEqual(['new', 'BEDTIME', 'TURKISH_CLASSICS', 'WORLD_CLASSICS']);
    });
  });

  it('shows saved stories on their own shelf only when there are some', async () => {
    const view = await renderHome();
    expect(screen.queryByRole('header', { name: 'Kaydedilenler' })).toBeNull();
    view.unmount();

    mockStoryStore.favoriteStories = [STORIES[2]];
    await renderHome();
    expect(screen.getByRole('header', { name: 'Kaydedilenler' })).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('home-shelf-saved-header-link'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Main', { screen: 'Library' });
  });

  it('keeps collections reachable as cards', async () => {
    mockCollectionList.mockResolvedValue([
      { id: 'c-1', slug: 'uyku-vakti', title: 'Uyku vakti', storyCount: 4 },
    ]);
    await renderHome();
    expect(screen.getByRole('header', { name: 'Koleksiyonlar' })).toBeOnTheScreen();
    expect(screen.getByText('4 masal')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Uyku vakti' }));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('CollectionDetail', { slug: 'uyku-vakti' });
    fireEvent.press(screen.getByTestId('home-shelf-collections-link'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Collections');
  });

  it('asks for the collections of the content language, and again when it changes', async () => {
    await renderHome();
    expect(mockCollectionList).toHaveBeenCalledTimes(1);
    expect(mockCollectionList).toHaveBeenLastCalledWith('tr');

    mockCollectionList.mockResolvedValue([
      { id: 'c-9', slug: 'bedtime', title: 'Bedtime', storyCount: 3 },
    ]);
    await act(async () => {
      runInAction(() => {
        getContentLanguageStore().contentLanguage = 'en';
      });
    });
    expect(mockCollectionList).toHaveBeenCalledTimes(2);
    expect(mockCollectionList).toHaveBeenLastCalledWith('en');
    expect(screen.getByRole('button', { name: 'Bedtime' })).toBeOnTheScreen();
  });

  it('keeps the collections row when refreshing it fails, but never one of another language', async () => {
    mockCollectionList.mockResolvedValueOnce([
      { id: 'c-1', slug: 'uyku-vakti', title: 'Uyku vakti', storyCount: 4 },
    ]);
    await renderHome();
    expect(screen.getByRole('button', { name: 'Uyku vakti' })).toBeOnTheScreen();

    mockCollectionList.mockRejectedValueOnce(new ApiError({ message: 'Sunucu hatası', status: 500 }));
    await act(async () => {
      await screen.getByTestId('home-scroll').props.refreshControl.props.onRefresh();
    });
    expect(mockCollectionList).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Uyku vakti' })).toBeOnTheScreen();

    mockCollectionList.mockRejectedValueOnce(new ApiError({ message: 'Sunucu hatası', status: 500 }));
    await act(async () => {
      runInAction(() => {
        getContentLanguageStore().contentLanguage = 'en';
      });
    });
    await settle();
    expect(mockCollectionList).toHaveBeenLastCalledWith('en');
    expect(screen.queryByRole('button', { name: 'Uyku vakti' })).toBeNull();
    expect(screen.queryByTestId('home-collections')).toBeNull();
  });

  it('has no search field and no filter chips', async () => {
    await renderHome();
    expect(screen.queryByPlaceholderText(/ara/i)).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByTestId('icon-search', { includeHiddenElements: true })).toBeNull();
  });

  it('loads stories, favourites, the category shelves and collections on first mount', async () => {
    mockStoryStore.stories = [];
    mockStoryStore.hasLoadedShelves = false;
    await renderHome();
    expect(mockStoryStore.loadStories).toHaveBeenCalledTimes(1);
    expect(mockStoryStore.loadFavorites).toHaveBeenCalledTimes(1);
    expect(mockStoryStore.loadCategoryShelves).toHaveBeenCalledTimes(1);
    expect(mockStoryStore.loadCategoryShelves).toHaveBeenCalledWith(HOME_CATEGORIES, { limit: 10 });
    expect(mockCollectionList).toHaveBeenCalledTimes(1);
  });

  it('does not load the shelves again when the store already has them', async () => {
    await renderHome();
    expect(mockStoryStore.loadCategoryShelves).not.toHaveBeenCalled();
    expect(mockStoryStore.loadStories).not.toHaveBeenCalled();
  });

  it('shows the skeleton under the greeting while the first load runs, in the real shapes', async () => {
    mockStoryStore.stories = [];
    mockStoryStore.loadStories.mockReturnValue(new Promise(() => {}));
    await renderHome();
    expect(screen.getByTestId('home-loading').props.accessibilityState).toEqual({ busy: true });
    expect(screen.getByTestId('home-greeting')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-empty')).toBeNull();
    // Each skeleton shelf sits where a real shelf header starts.
    expect(flatStyle(screen.getByTestId('home-loading-shelf-0', { includeHiddenElements: true })).marginTop).toBe(
      20,
    );
  });

  it('after the first load the content cross-fades in over the skeleton: no frame without either (LA-2)', async () => {
    let finishLoad: () => void = () => undefined;
    mockStoryStore.stories = [];
    mockStoryStore.loadStories.mockReturnValue(
      new Promise<void>(resolve => {
        finishLoad = resolve;
      }),
    );
    const timing = jest.spyOn(Animated, 'timing');
    renderWithProviders(<HomeTree />);
    await act(async () => undefined);
    const shown = (id: string) => screen.queryByTestId(id, { includeHiddenElements: true });
    const opacity = (id: string) => flatStyle(screen.getByTestId(id, { includeHiddenElements: true })).opacity;
    expect(screen.getByTestId('home-loading')).toBeOnTheScreen();
    expect(shown('home-content')).toBeNull();
    expect(opacity('home-body-skeleton')).toBe(1);

    // The stories arrive (sign-in): the content mounts under the skeleton,
    // and its fade is handed to the native driver in that same commit.
    timing.mockClear();
    mockStoryStore.stories = STORIES;
    await act(async () => {
      finishLoad();
    });
    expect(screen.getByTestId('home-featured')).toBeOnTheScreen();
    expect(opacity('home-content')).toBe(0);
    // Still drawn while the fade has not moved: the screen is never empty.
    expect(opacity('home-body-skeleton')).toBe(1);
    expect(screen.queryByTestId('home-loading')).toBeNull();
    expect(
      timing.mock.calls.some(
        ([, config]) => config.duration === DURATION.enter && config.toValue === 1 && config.useNativeDriver,
      ),
    ).toBe(true);

    // The fade ends: the content alone.
    await settle();
    expect(shown('home-body-skeleton')).toBeNull();
    expect(opacity('home-content')).toBe(1);
  });

  it('content kept by the store shows at once, with no skeleton and no fade', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    await renderHome();
    expect(screen.queryByTestId('home-body-skeleton', { includeHiddenElements: true })).toBeNull();
    expect(flatStyle(screen.getByTestId('home-content')).opacity).toBe(1);
    expect(timing.mock.calls.some(([, config]) => config.duration === DURATION.enter)).toBe(false);
  });

  it('renders four covers of a shelf first, and lists without measuring', async () => {
    mockStoryStore.stories = [
      STORIES[1],
      ...Array.from({ length: 10 }, (_, i) => story(`n-${i}`, `Masal ${i}`)),
    ];
    await renderHome('gece-mavisi', { deferred: false });
    const newShelf = within(screen.getByTestId('home-shelf-new'));
    // Ten stories after the featured one; the first frame draws four.
    expect(newShelf.queryAllByTestId(/^home-tile-n-\d+$/)).toHaveLength(SHELF_INITIAL_COVERS);
    for (const list of screen.UNSAFE_getAllByType(FlatList)) {
      expect(list.props).toMatchObject({
        initialNumToRender: 4,
        maxToRenderPerBatch: 4,
        windowSize: 3,
        getItemLayout: shelfItemLayout,
      });
    }
  });

  it('mounts the first two shelves with the content and the others a frame later', async () => {
    await renderHome('gece-mavisi', { deferred: false });
    expect(FIRST_SHELVES).toBe(2);
    expect(shelfIds()).toEqual(['new', 'BEDTIME']);
    expect(screen.getByTestId('home-featured')).toBeOnTheScreen();
    expect(screen.getByTestId('home-categories')).toBeOnTheScreen();

    await act(async () => {
      jest.advanceTimersByTime(20);
    });
    expect(shelfIds()).toEqual(['new', 'BEDTIME', 'TURKISH_CLASSICS', 'WORLD_CLASSICS']);
  });

  it('a change on another shelf draws no cover of "Yeni eklenenler" again', async () => {
    const view = await renderHome();
    expect(mockCoverRenders).toContain('home-tile-s-1');
    mockCoverRenders.length = 0;

    // A tale saved somewhere else joins the saved shelf.
    mockStoryStore.favoriteStories = [story('f-9', 'Gizli Bahçe', { isFavorite: true })];
    view.rerender(<HomeTree />);
    expect(screen.getByRole('header', { name: 'Kaydedilenler' })).toBeOnTheScreen();
    expect(mockCoverRenders).toContain('home-tile-f-9');
    expect(mockCoverRenders.filter(id => /home-tile-s-/.test(id))).toEqual([]);
  });

  it('a save through the story store draws that tale again and no other cover', async () => {
    const { StoryStore } = jest.requireActual('../../hooks/useStory');
    const store = new StoryStore();
    mockStoryStore = store;
    mockGetStories.mockImplementation((params: { category?: string }) =>
      Promise.resolve(
        pageOf(params.category ? STORIES.filter(item => item.category === params.category) : STORIES),
      ),
    );
    await renderHome();
    await settle();
    expect(shelfIds()).toEqual(['new', 'BEDTIME', 'TURKISH_CLASSICS', 'WORLD_CLASSICS']);
    expect(mockCoverRenders).toContain('home-tile-s-1');
    mockCoverRenders.length = 0;

    // s-3 is on "Yeni eklenenler" and on the Türk masalları shelf.
    await act(async () => {
      await store.toggleFavorite('s-3', { quiet: true });
    });
    expect(mockServiceToggleFavorite).toHaveBeenCalledWith('s-3', true);
    expect(shelfIds()).toEqual(['new', 'saved', 'BEDTIME', 'TURKISH_CLASSICS', 'WORLD_CLASSICS']);
    expect(mockCoverRenders).toContain('home-tile-s-3');
    // Every other cover on every shelf keeps its render.
    expect(mockCoverRenders.filter(id => id !== 'home-tile-s-3')).toEqual([]);
  });

  it('shows a tale with the same picture on every shelf', async () => {
    const tale = story('s-3', 'Keloğlan ile Altın Başaklar', { category: StoryCategory.TURKISH_CLASSICS });
    mockStoryStore.stories = [STORIES[1], STORIES[0], tale, STORIES[3]];
    mockStoryStore.shelfByCategory = new Map([
      ['TURKISH_CLASSICS', [tale, story('t-2', 'Nasreddin Hoca')]],
    ]);
    await renderHome();
    const pictureOn = (shelfId: string) => {
      const card = within(screen.getByTestId(`home-shelf-${shelfId}`)).getByTestId('home-tile-s-3');
      return within(card).getByTestId(/^cover-placeholder-/, { includeHiddenElements: true }).props.testID;
    };
    // Second on "Yeni eklenenler", first on its category shelf.
    expect(pictureOn('new')).toBe(pictureOn('TURKISH_CLASSICS'));
  });

  it('a cover has no long press and offers no queueing (owner feedback, item 8)', async () => {
    await renderHome();
    for (const id of ['s-1', 's-4']) {
      const card = within(screen.getByTestId('home-shelf-new')).getByTestId(`home-tile-${id}`);
      const button = within(card).getAllByRole('button')[0];
      expect(button.props.onLongPress).toBeUndefined();
      fireEvent(button, 'longPress');
    }
    expect(screen.queryByText('Sıraya ekle')).toBeNull();
    expect(screen.queryByTestId('home-story-menu')).toBeNull();
    expect(mockGetNarrationsByStory).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).not.toHaveBeenCalledWith('StoryDetail', expect.anything());
    // The tap is the one action: the story page, where saving and queueing are buttons.
    fireEvent.press(within(screen.getByTestId('home-shelf-new')).getByTestId('home-tile-s-4'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-4' });
  });

  it('locks premium covers for a free user and explains the plans; Mini opens them', async () => {
    const premium = story('p-1', 'Altın Kuş', { isPremium: true });
    mockStoryStore.stories = [...STORIES, premium];
    const view = await renderHome();
    const card = within(screen.getByTestId('home-shelf-new')).getByTestId('home-tile-p-1');
    expect(within(card).getByTestId('icon-lock', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Altın Kuş, Premium, kilitli' })).toBeOnTheScreen();
    fireEvent.press(card);
    expect(mockNavigation.navigate).not.toHaveBeenCalledWith('StoryDetail', { storyId: 'p-1' });
    const dialog = mockShowDialog.mock.calls[0][0];
    expect(dialog.title).toBe('Bu masal ücretli planlarda');
    dialog.buttons[0].onPress();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Subscription', { reason: 'premiumStory' }, { pop: true });
    view.unmount();

    mockShowDialog.mockClear();
    mockSubscription = miniPlan();
    await renderHome();
    const open = within(screen.getByTestId('home-shelf-new')).getByTestId('home-tile-p-1');
    expect(within(open).queryByTestId('icon-lock', { includeHiddenElements: true })).toBeNull();
    fireEvent.press(open);
    expect(mockNavigation.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 'p-1' });
    expect(mockShowDialog).not.toHaveBeenCalled();
  });

  it('shows the offline state when the first load fails without a connection', async () => {
    mockStoryStore.stories = [];
    mockStoryStore.errorMessage = 'Masallar yüklenemedi';
    mockStoryStore.listErrorKind = classifyFailure(
      new ApiError({ message: 'Network Error', status: 0, code: 'NETWORK_ERROR' }),
    );
    await renderHome();
    expect(screen.getByText('İnternete bağlı değilsin')).toBeOnTheScreen();
    expect(screen.getByText('Masalları açmak için bağlantı gerekiyor.')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('home-error')).getByTestId('icon-wifiOff', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });

  it('a failed load on the server side offers a retry with the existing copy', async () => {
    mockStoryStore.stories = [];
    mockStoryStore.errorMessage = 'Masallar yüklenemedi';
    mockStoryStore.listErrorKind = classifyFailure(new ApiError({ message: 'Sunucu hatası', status: 500 }));
    await renderHome();
    expect(screen.getByText('Masallar yüklenemedi')).toBeOnTheScreen();
    expect(screen.getByText('Sorun bizde. Biraz sonra tekrar dene.')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    });
    expect(mockStoryStore.loadStories).toHaveBeenCalledTimes(2);
  });

  it('tries again by itself when the connection comes back', async () => {
    let reconnect: (() => void) | undefined;
    jest.spyOn(getConnectivityStore(), 'onReconnect').mockImplementation(listener => {
      reconnect = listener;
      return () => undefined;
    });
    mockStoryStore.stories = [];
    mockStoryStore.errorMessage = 'Masallar yüklenemedi';
    mockStoryStore.listErrorKind = 'offline';
    mockStoryStore.shelvesErrorKind = 'offline';
    mockCollectionList.mockRejectedValueOnce(
      new ApiError({ message: 'Network Error', status: 0, code: 'NETWORK_ERROR' }),
    );
    await renderHome();
    expect(mockStoryStore.loadStories).toHaveBeenCalledTimes(1);
    expect(mockCollectionList).toHaveBeenCalledTimes(1);
    await act(async () => reconnect?.());
    // The stories, the shelves and the collections that failed with them.
    expect(mockStoryStore.loadStories).toHaveBeenCalledTimes(2);
    expect(mockStoryStore.loadCategoryShelves).toHaveBeenCalledWith(HOME_CATEGORIES, { limit: 10 });
    expect(mockCollectionList).toHaveBeenCalledTimes(2);
  });

  it('back online with stories on screen, loads only the shelves and collections that failed', async () => {
    let reconnect: (() => void) | undefined;
    jest.spyOn(getConnectivityStore(), 'onReconnect').mockImplementation(listener => {
      reconnect = listener;
      return () => undefined;
    });
    mockStoryStore.shelvesErrorKind = 'offline';
    mockStoryStore.shelfByCategory = new Map();
    mockCollectionList.mockRejectedValueOnce(
      new ApiError({ message: 'Network Error', status: 0, code: 'NETWORK_ERROR' }),
    );
    await renderHome();
    expect(screen.queryByTestId('home-categories')).toBeNull();

    mockCollectionList.mockResolvedValue([{ id: 'c-1', slug: 'uyku-vakti', title: 'Uyku vakti', storyCount: 4 }]);
    await act(async () => reconnect?.());
    expect(mockStoryStore.loadStories).not.toHaveBeenCalled();
    expect(mockStoryStore.loadCategoryShelves).toHaveBeenCalledTimes(1);
    expect(mockCollectionList).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Uyku vakti' })).toBeOnTheScreen();

    // Nothing failed any more: a later reconnect sends nothing.
    mockStoryStore.shelvesErrorKind = null;
    await act(async () => reconnect?.());
    expect(mockStoryStore.loadCategoryShelves).toHaveBeenCalledTimes(1);
    expect(mockCollectionList).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state when there are no stories at all', async () => {
    mockStoryStore.stories = [];
    await renderHome();
    expect(screen.getByText('Henüz masal yok')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Tekrar dene' })).toBeNull();
  });

  it('survives a failing collections request', async () => {
    mockCollectionList.mockRejectedValue(new Error('500'));
    await renderHome();
    expect(screen.getByText('Bu gecenin masalı')).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Koleksiyonlar' })).toBeNull();
  });

  it('refreshes stories, favourites, shelves, collections and the hero narrations on pull', async () => {
    await renderHome();
    const main = screen.getByTestId('home-scroll');
    await act(async () => {
      await main.props.refreshControl.props.onRefresh();
    });
    expect(mockStoryStore.refresh).toHaveBeenCalledTimes(1);
    // Once on mount (nothing saved yet), once on the pull.
    expect(mockStoryStore.loadFavorites).toHaveBeenCalledTimes(2);
    expect(mockStoryStore.loadCategoryShelves).toHaveBeenCalledWith(HOME_CATEGORIES, { limit: 10 });
    expect(mockCollectionList).toHaveBeenCalledTimes(2);
    expect(mockStoryStore.loadNarrationsForStory).toHaveBeenCalledTimes(2);
    expect(main.props.refreshControl.props.refreshing).toBe(false);
  });

  it('starts the refresh spinner under the greeting', async () => {
    await renderHome();
    fireEvent(screen.getByTestId('home-greeting'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 12, width: 360, height: 56 } },
    });
    expect(screen.getByTestId('home-scroll').props.refreshControl.props.progressViewOffset).toBe(68);
  });

  it('ends the scroll above the tab bar and the mini player, with no extra gap', async () => {
    const view = await renderHome();
    const T = themes['gece-mavisi'];
    expect(flatStyle({ props: { style: screen.getByTestId('home-scroll').props.contentContainerStyle } }).paddingBottom).toBe(
      T.tabBarReservedHeight,
    );
    view.unmount();

    mockMiniPlayerInset = 75;
    await renderHome();
    expect(flatStyle({ props: { style: screen.getByTestId('home-scroll').props.contentContainerStyle } }).paddingBottom).toBe(
      T.tabBarReservedHeight + 75,
    );
  });

  it('scrolls back to the top when the focused tab is pressed again', async () => {
    await renderHome();
    const scroll = screen.UNSAFE_getAllByType(ScrollView).find(node => node.props.testID === 'home-scroll')!;
    const scrollTo = jest.spyOn(scroll.instance as { scrollTo: (o: unknown) => void }, 'scrollTo');
    expect(tabPressListeners).toHaveLength(1);
    act(() => tabPressListeners[0]({ defaultPrevented: false }));
    await act(async () => {
      jest.advanceTimersByTime(20);
    });
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s palette', async scheme => {
    await renderHome(scheme);
    const T = themes[scheme];
    expect(flatStyle(screen.getByRole('header', { name: 'İyi geceler, Zeynep' }))).toMatchObject({
      color: T.text,
      fontSize: 21,
    });
    // One action colour: the play button, with the dark glyph colour.
    expect(face('home-featured-listen').backgroundColor).toBe(T.action);
    expect(flatStyle(screen.getByTestId('home-featured-listen-lip')).backgroundColor).toBe(T.actionLip);
    // The tag in the featured story's category colour (bedtime), dark text on it.
    expect(flatStyle(screen.getByTestId('home-featured-tag')).backgroundColor).toBe(T.cat.uyku.color);
    expect(flatStyle(screen.getByText('Bu gecenin masalı')).color).toBe(T.onCat);
    // Glass chips on the picture.
    expect(flatStyle(within(screen.getByTestId('home-featured')).getByText('5 dk')).color).toBe(T.text);
    // Category tiles in their tile colours.
    expect(face('home-category-BEDTIME').backgroundColor).toBe(T.cat.uyku.tileBg);
    expect(face('home-category-WORLD_CLASSICS').backgroundColor).toBe(T.cat.dunya.tileBg);
  });

  it.each(PALETTE_KEYS)('in %s the category tiles stand out from the canvas and keep their meaning', async scheme => {
    await renderHome(scheme);
    const T = themes[scheme];
    for (const [category, slot] of [
      ['BEDTIME', 'uyku'],
      ['WORLD_CLASSICS', 'dunya'],
    ] as const) {
      const tile = face(`home-category-${category}`).backgroundColor as string;
      expect(tile).toBe(T.cat[slot].tileBg);
      expect(tile).not.toBe(T.bg);
      expect(contrastRatio(tile, T.bg)).toBeGreaterThan(1.05);
      // A neutral tile (mürekkep) still says its kind: the icon in the
      // category colour; a filled tile carries the dark glyph.
      expect(T.cat[slot].tileIcon).toBe(scheme === 'murekkep' ? T.cat[slot].color : T.onCat);
    }
    // The hero's play button on its picture card, the action colour.
    expect(face('home-featured-listen').backgroundColor).toBe(T.action);
  });

  it('draws 100 x 146 shelf covers', async () => {
    await renderHome();
    const card = screen.getAllByTestId('home-tile-s-4')[0];
    expect(flatStyle(card).width).toBe(100);
    expect(SHELF_COVER_HEIGHT).toBe(146);
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    await renderHome();
    expect(screen.getByRole('header', { name: 'Good night, Zeynep' })).toBeOnTheScreen();
    expect(screen.getByText("Tonight's story")).toBeOnTheScreen();
    const hero = within(screen.getByTestId('home-featured'));
    expect(hero.getByText('5 min')).toBeOnTheScreen();
    expect(hero.getByText('Ages 3-6')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'New stories' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Listen to Ninni Mırıldanan Deniz Feneri' })).toBeOnTheScreen();
  });

  it('falls back to the Firebase display name and then to a neutral initial', async () => {
    mockAuthStore = { backendUser: null, user: { displayName: 'ipek Demir' } };
    const view = await renderHome();
    expect(screen.getByText('İ')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'İyi geceler, İpek' })).toBeOnTheScreen();
    view.unmount();

    mockAuthStore = { backendUser: null, user: null };
    await renderHome();
    expect(screen.getByText('S')).toBeOnTheScreen();
  });
});
