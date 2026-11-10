/**
 * StoryLibraryScreen, the "Keşfet" tab (design/v4/playful, frame b): the one
 * header row (title label, search field, filters button), the search field
 * (its own text, the debounce, the search key), the filter card (hidden by
 * default, opened as list content; Dil, Seviye, Tür, Yaş chips; the
 * language sheet for many languages), the removable picks of a closed card,
 * result header with the sort sheet, the grid of cover cards (grouped or
 * flat, memoised), saving with its undo, saved marks after a refocus,
 * premium locks, states.
 *
 * Runs on the real DiscoverStore; StoryService and the other stores are
 * mocks. Jest fake timers are global.
 */

import React from 'react';
import { AccessibilityInfo, Animated, BackHandler, FlatList, TextInput } from 'react-native';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { observable, runInAction } from 'mobx';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { mockNavigation, setMockFocused, setMockRouteParams } from '../../test-utils/mocks/navigation';
import i18n from '../../i18n';
import { makeTextStyles, themes } from '../../theme/theme';
import { DEFAULT_STORY_EXTRAS, EMPTY_STORY_CREDIT, Story } from '../../models/Story';
import { AgeGroup, StoryCategory, SubscriptionTier } from '../../types/enums';
import { DiscoverStore } from '../../hooks/useDiscover';
import { getSubscriptionStore } from '../../hooks/useSubscription';
import { ApiError, API_ERROR_CODES } from '../../services/ApiError';
import type { FavoriteChange } from '../../hooks/useStory';
import { GRID_COLUMN_GAP } from '../../components/story/StoryCard';
import { CURVE, DURATION } from '../../theme/motion';
import {
  FILTER_LABEL_MAX_SCALE,
  FILTER_LABEL_WIDTH,
  HEADER_BUTTON_SIZE,
  SEARCH_DEBOUNCE_MS,
  SEARCH_OVERLAY_END,
  StoryLibraryScreen,
  activeFilterCount,
  isAtListTop,
  isPanelOutOfView,
  LIST_MOVE,
  PANEL_ENTERING,
  PANEL_EXITING,
  PICKS_ENTERING,
  PICKS_EXITING,
} from './StoryLibraryScreen';

jest.setTimeout(60000);

const mockGetStories = jest.fn();
const mockSearchStories = jest.fn();
const mockToggleFavorite = jest.fn();

jest.mock('../../services/StoryService', () => ({
  __esModule: true,
  default: {
    getStories: (...args: unknown[]) => mockGetStories(...args),
    searchStories: (...args: unknown[]) => mockSearchStories(...args),
    toggleFavorite: (...args: unknown[]) => mockToggleFavorite(...args),
  },
}));

jest.mock('../../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));
const mockToast = jest.requireMock('../../utils/toast').showToast as {
  success: jest.Mock;
  error: jest.Mock;
  info: jest.Mock;
};

/** Renders of the story card (the real, memoised one inside). */
const mockCardRenders = { count: 0 };
jest.mock('../../components/story/StoryCard', () => {
  const actual = jest.requireActual('../../components/story/StoryCard');
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const Counted = ReactActual.memo((props: Record<string, unknown>) => {
    mockCardRenders.count += 1;
    return ReactActual.createElement(actual.StoryCard, props);
  });
  return { ...actual, StoryCard: Counted, default: Counted };
});

let mockDiscoverStore: DiscoverStore;
jest.mock('../../hooks/useDiscover', () => {
  const actual = jest.requireActual('../../hooks/useDiscover');
  return { ...actual, useDiscover: () => mockDiscoverStore };
});

const mockStoryStore = {
  stories: [] as Story[],
  favoriteStories: [] as Story[],
  currentStory: null,
  favoritesVersion: 0,
  favoriteChanges: [] as FavoriteChange[],
  getFavoriteState: jest.fn(() => false),
  toggleFavorite: jest.fn(() => Promise.resolve()),
  loadFavorites: jest.fn(() => Promise.resolve()),
  refresh: jest.fn(() => Promise.resolve()),
};
jest.mock('../../hooks/useStory', () => ({ useStory: () => mockStoryStore }));

/** A save or unsave made on another screen, as StoryStore records it. */
function recordChange(id: string, saved: boolean, translationGroupId: string | null = null) {
  mockStoryStore.favoritesVersion += 1;
  mockStoryStore.favoriteChanges = [
    ...mockStoryStore.favoriteChanges,
    { version: mockStoryStore.favoritesVersion, story: { id, translationGroupId }, saved },
  ];
}

/** The story page StoryStore holds, with the language versions it listed. */
function openStoryPage(id: string, versionIds: string[]) {
  (mockStoryStore as { currentStory: unknown }).currentStory = {
    id,
    translations: versionIds.map(version => ({
      id: version,
      language: version.endsWith('-en') ? 'en' : 'tr',
      title: version,
    })),
  };
}

interface MockContentLanguage {
  effective: string;
  languagesWithStories: { code: string; nativeName: string }[];
  levels: string[];
  /** Levels per language code, read by `levelsFor`. */
  levelsByLanguage: Record<string, string[]>;
  levelsFor: (codes: readonly string[]) => string[];
  load: jest.Mock;
  nativeName: (code: string) => string;
}
let mockContentLanguage: MockContentLanguage;
jest.mock('../../hooks/useContentLanguage', () => ({
  contentLanguageLabel: jest.requireActual('../../hooks/useContentLanguage').contentLanguageLabel,
  useContentLanguage: () => mockContentLanguage,
  // DiscoverStore reads the prefer language from here.
  getContentLanguageStore: () => mockContentLanguage,
}));

// The tab press listener needs a real tab navigator; here it is only called.
const mockNavigationModule = jest.requireMock('@react-navigation/native') as { useScrollToTop: unknown };
const mockScrollToTop = jest.fn();
mockNavigationModule.useScrollToTop = mockScrollToTop;

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
  languageLevel: 'A2',
  ...patch,
});

const GROUPED: Story[] = [
  story('s-1', 'Parmak Kız', {
    availableLanguages: ['tr', 'en'],
    translationGroupId: 'g-1',
    credit: {
      ...EMPTY_STORY_CREDIT,
      authorName: 'Hans Christian Andersen',
      translationMethod: 'MACHINE',
    },
  }),
  story('s-2', 'Bremen Mızıkacıları', {
    availableLanguages: ['tr', 'en'],
    credit: { ...EMPTY_STORY_CREDIT, collectorName: 'Grimm Kardeşler' },
  }),
  story('s-3', 'Minicik Karıncanın Büyük Yolculuğu', {
    credit: { ...EMPTY_STORY_CREDIT, origin: 'FOLK_ANONYMOUS' },
  }),
];

const FLAT: Story[] = [
  story('s-1', 'Parmak Kız', { isFavorite: true, isFavoriteAnyLanguage: true }),
  story('s-1-en', 'Thumbelina', {
    language: 'en',
    availableLanguages: ['en', 'tr'],
    isFavoriteAnyLanguage: true,
    credit: { ...EMPTY_STORY_CREDIT, translationMethod: 'MACHINE' },
  }),
];

const pageOf = (data: Story[], total = data.length, page = 1, totalPages = 1) => ({
  data,
  meta: { page, limit: 20, total, totalPages },
});

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

async function flush() {
  await act(async () => undefined);
  await act(async () => undefined);
}

/** The filter card's height as the tests lay it out (its bottom is 4dp lower). */
const PANEL_HEIGHT = 180;
const PANEL_BOTTOM = PANEL_HEIGHT + 4;

/** The native layout of the open filter card. */
function measurePanel(height = PANEL_HEIGHT) {
  act(() => {
    fireEvent(screen.getByTestId('discover-panel-body'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height } },
    });
  });
}

/**
 * Renders Keşfet. The filter card is hidden by default; most tests work on
 * its chips, so it is opened with the filters button unless `filtersOpen`
 * is false.
 */
async function renderDiscover(
  theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi',
  { filtersOpen = true }: { filtersOpen?: boolean } = {},
) {
  const view = renderWithProviders(<StoryLibraryScreen />, { theme, withDialog: true });
  await flush();
  if (filtersOpen) {
    fireEvent.press(screen.getByTestId('discover-filters-toggle'));
    measurePanel();
  }
  return view;
}

/**
 * Opens the search from its icon, and gives the field the focus the tap
 * asks for (the test renderer fires no focus event of its own).
 */
function openSearch() {
  fireEvent.press(screen.getByTestId('discover-search-open'));
  fireEvent(screen.getByTestId('discover-search'), 'focus');
}

/** Whether the search field is unfolded over the title. */
const searchIsOpen = () =>
  screen.getByTestId('discover-search-overlay', { includeHiddenElements: true }).props.pointerEvents ===
  'box-none';

async function typeAndWait(term: string) {
  if (!screen.queryByTestId('discover-search')) openSearch();
  fireEvent.changeText(screen.getByTestId('discover-search'), term);
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
  await flush();
}

const row = (id: string) => within(screen.getByTestId(id));

beforeEach(() => {
  mockDiscoverStore = new DiscoverStore();
  // Most tests run on the whole catalogue (every language unpicked, one card
  // per tale), the scope Keşfet opened on before the content language became
  // its default; that default has its own block ("opens on the content language").
  runInAction(() => {
    mockDiscoverStore.languagePicks = [];
  });
  mockGetStories.mockReset().mockImplementation((params: { language?: string[] }) =>
    Promise.resolve(params.language ? pageOf(FLAT, 21) : pageOf(GROUPED, 12)),
  );
  mockSearchStories.mockReset().mockResolvedValue(pageOf([GROUPED[1]], 1));
  mockToggleFavorite.mockReset().mockResolvedValue(undefined);
  mockContentLanguage = observable(
    {
      effective: 'tr',
      languagesWithStories: [
        { code: 'tr', nativeName: 'Türkçe' },
        { code: 'en', nativeName: 'English' },
      ],
      levels: ['A1', 'A2', 'B1'],
      levelsByLanguage: { tr: [], en: ['A1', 'A2', 'B1'] } as Record<string, string[]>,
      // Like the store: every level without a pick, else those of the picks.
      levelsFor(codes: readonly string[]): string[] {
        if (codes.length === 0) return this.levels;
        return ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].filter(level =>
          codes.some(code => (this.levelsByLanguage[code] ?? []).includes(level)),
        );
      },
      load: jest.fn(() => Promise.resolve()),
      nativeName: (code: string) => (code === 'tr' ? 'Türkçe' : code === 'en' ? 'English' : code),
    },
    { load: false, nativeName: false, levelsFor: false },
  );
  mockStoryStore.getFavoriteState.mockReturnValue(false);
  mockStoryStore.favoritesVersion = 0;
  mockStoryStore.favoriteChanges = [];
  mockStoryStore.currentStory = null;
  mockCardRenders.count = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  getSubscriptionStore().reset();
});

// The folded search field is hidden from accessibility but still drawn.
const face = (id: string) => flatStyle(screen.getByTestId(`${id}-face`, { includeHiddenElements: true }));

describe('Keşfet, no language filter (frame b)', () => {
  it('loads one card per tale and the language options on mount, once', async () => {
    await renderDiscover();
    expect(mockContentLanguage.load).toHaveBeenCalled();
    expect(mockGetStories).toHaveBeenCalledTimes(1);
    expect(mockGetStories).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, grouped: true }),
    );
    expect(mockGetStories.mock.calls[0][0].language).toBeUndefined();
  });

  it('has the Baloo 2 tab title and the search behind its icon, no avatar and no mic (no voice search)', async () => {
    await renderDiscover('gece-mavisi', { filtersOpen: false });
    const title = screen.getByRole('header', { name: 'Keşfet' });
    // The tab title of Kütüphane and Sesim (Baloo 2 32), one line.
    expect(flatStyle(title)).toMatchObject(makeTextStyles(themes['gece-mavisi']).displayL);
    expect(flatStyle(title).fontSize).toBe(32);
    expect(title.props.numberOfLines).toBe(1);
    // Folded, the field is not offered; the icon opens it.
    expect(screen.queryByPlaceholderText('Masal ara')).toBeNull();
    expect(screen.getByRole('button', { name: 'Aramayı aç' })).toBeOnTheScreen();
    openSearch();
    // The short placeholder; the label keeps the long description.
    const field = screen.getByPlaceholderText('Masal ara');
    expect(field.props.accessibilityLabel).toBe('Masal, yazar ya da derleyen ara');
    expect(screen.queryByRole('button', { name: 'Profil' })).toBeNull();
    expect(screen.queryByTestId('icon-mic', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('discover-search-field-lip')).toBeOnTheScreen();
  });

  it('scrolls to the top when its tab is pressed again', async () => {
    await renderDiscover();
    expect(mockScrollToTop).toHaveBeenCalledWith(expect.objectContaining({ current: expect.anything() }));
  });

  it('draws the filter card: Dil, Seviye, Tür and Yaş rows with chips, "Hepsi" first and picked', async () => {
    await renderDiscover();
    expect(screen.getByText('Dil')).toBeOnTheScreen();
    expect(screen.getByText('Seviye')).toBeOnTheScreen();
    expect(screen.getByText('Tür')).toBeOnTheScreen();
    expect(screen.getByText('Yaş')).toBeOnTheScreen();

    // Languages as chips with their code.
    expect(screen.getByRole('checkbox', { name: 'Türkçe' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'English' })).not.toBeChecked();
    expect(screen.getByText('TR')).toBeOnTheScreen();
    expect(screen.getByText('EN')).toBeOnTheScreen();
    // The levels of the catalogue, easiest first.
    ['A1', 'A2', 'B1'].forEach(level =>
      expect(screen.getByRole('checkbox', { name: level })).not.toBeChecked(),
    );
    // Every age group after "Hepsi", which is picked while none is.
    const ages = row('discover-row-age').getAllByRole('radio');
    expect(ages.map(chip => chip.props.accessibilityLabel)).toEqual([
      'Hepsi',
      '0-3 yaş',
      '3-6 yaş',
      '6-10 yaş',
      '10+ yaş',
    ]);
    expect(ages[0]).toBeSelected();
    ages.slice(1).forEach(chip => expect(chip).not.toBeSelected());
    // The same "Hepsi" leads the Tür row.
    const categories = row('discover-row-category').getAllByRole('radio');
    expect(categories[0].props.accessibilityLabel).toBe('Hepsi');
    expect(categories[0]).toBeSelected();
  });

  it('heads the grid with the count in tales and the sort order', async () => {
    await renderDiscover();
    expect(screen.getByText('12 masal bulundu')).toBeOnTheScreen();
    expect(screen.getByText('Önerilen')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sırala: Önerilen' })).toBeOnTheScreen();
    expect(screen.getByTestId('icon-sort', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('draws the cards: level and duration on the cover, category dot, translation mark, no codes', async () => {
    await renderDiscover();
    expect(screen.getByText('Parmak Kız')).toBeOnTheScreen();
    expect(screen.getByText('Bremen Mızıkacıları')).toBeOnTheScreen();
    expect(screen.getAllByTestId('cover-level')).toHaveLength(3);
    expect(screen.getAllByText('6 dk')).toHaveLength(3);
    expect(screen.getAllByTestId('cover-duration')).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /, Yapay zekâ ile çevrildi$/ })).toHaveLength(1);
    // One card per tale: the content language, no code on the card.
    expect(screen.queryByLabelText(/Diller/)).toBeNull();
    const list = screen.UNSAFE_getByType(FlatList);
    expect(list.props.numColumns).toBeGreaterThanOrEqual(3);
    // A small first batch of rows.
    expect(list.props).toMatchObject({ initialNumToRender: 4, maxToRenderPerBatch: 3, windowSize: 7 });
  });

  it('opens the story detail from a card', async () => {
    await renderDiscover();
    fireEvent.press(screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını aç' }));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-2' });
  });

  it('leaves room at the end of the list for the tab bar only while no mini player shows', async () => {
    await renderDiscover();
    const T = themes['gece-mavisi'];
    const list = screen.UNSAFE_getByType(FlatList);
    expect(flatStyle({ props: { style: list.props.contentContainerStyle } }).paddingBottom).toBe(
      T.tabBarReservedHeight,
    );
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('follows the %s palette', async theme => {
    await renderDiscover(theme);
    const T = themes[theme];
    expect(flatStyle(screen.getByRole('header', { name: 'Keşfet' })).color).toBe(T.text);
    expect(flatStyle(screen.getByText('Parmak Kız')).color).toBe(T.text);
    expect(flatStyle(screen.getByText('12 masal bulundu')).color).toBe(T.text);
    expect(flatStyle(screen.getByText('Önerilen')).color).toBe(T.text2);
    expect(flatStyle(screen.getByText('Dil')).color).toBe(T.text3);
    expect(flatStyle(screen.getByTestId('discover-search', { includeHiddenElements: true })).color).toBe(T.text);
    expect(face('discover-search-field').backgroundColor).toBe(T.surface);
    expect(face('discover-filters').backgroundColor).toBe(T.surface);
    // Selected chip in the action colour, idle chips in the line colour.
    expect(face('discover-age-all').backgroundColor).toBe(T.action);
    expect(flatStyle(row('discover-row-age').getByText('Hepsi')).color).toBe(T.onAction);
    expect(face('discover-age-THREE_TO_SIX').backgroundColor).toBe(T.line);
    expect(face('discover-language-tr').backgroundColor).toBe(T.line);
  });

  it('is translated to English, with room for the "Language" label', async () => {
    await i18n.changeLanguage('en');
    await renderDiscover();
    expect(screen.getByRole('header', { name: 'Discover' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Open search' })).toBeOnTheScreen();
    openSearch();
    expect(screen.getByPlaceholderText('Search stories').props.accessibilityLabel).toBe(
      'Search stories, authors or collectors',
    );
    const label = screen.getByText('Language');
    expect(flatStyle(label).width).toBe(68);
    expect(FILTER_LABEL_WIDTH).toBe(68);
    expect(label.props.maxFontSizeMultiplier).toBe(FILTER_LABEL_MAX_SCALE);
    expect(FILTER_LABEL_MAX_SCALE).toBe(1.15);
    expect(label.props.numberOfLines).toBe(1);
    expect(screen.getByText('Level')).toBeOnTheScreen();
    expect(row('discover-row-age').getByRole('radio', { name: 'All' })).toBeSelected();
    expect(screen.getByText('12 stories found')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sort: Recommended' })).toBeOnTheScreen();
  });
});

describe('filters', () => {
  it('picks languages with chips, which switches to one card per language', async () => {
    await renderDiscover();
    fireEvent.press(screen.getByRole('checkbox', { name: 'Türkçe' }));
    await flush();
    expect(mockGetStories).toHaveBeenLastCalledWith(expect.objectContaining({ language: ['tr'] }));

    fireEvent.press(screen.getByRole('checkbox', { name: 'English' }));
    await flush();
    expect(mockGetStories).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: ['tr', 'en'] }),
    );
    expect(mockGetStories.mock.calls[mockGetStories.mock.calls.length - 1][0].grouped).toBeUndefined();
    expect(screen.getByRole('checkbox', { name: 'Türkçe' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'English' })).toBeChecked();

    expect(screen.getByText('21 sonuç bulundu')).toBeOnTheScreen();
    // A code only on a card of another language than the content language
    // (Turkish here), and both cards of the saved tale carry the filled bookmark.
    expect(screen.getByRole('button', { name: 'Parmak Kız masalını aç' })).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Thumbelina masalını aç, Yapay zekâ ile çevrildi, Diller: EN' }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Parmak Kız masalını kaydedilenlerden çıkar' }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Thumbelina masalını kaydedilenlerden çıkar' }),
    ).toBeOnTheScreen();

    // A second tap drops the language again.
    fireEvent.press(screen.getByRole('checkbox', { name: 'English' }));
    await flush();
    expect(mockGetStories).toHaveBeenLastCalledWith(expect.objectContaining({ language: ['tr'] }));
  });

  it('draws no Dil row for a catalogue of one language (no choice to make)', async () => {
    runInAction(() => {
      mockContentLanguage.languagesWithStories = [{ code: 'tr', nativeName: 'Türkçe' }];
    });
    await renderDiscover();
    expect(screen.queryByTestId('discover-row-language')).toBeNull();
    expect(screen.getByTestId('discover-row-age')).toBeOnTheScreen();
  });

  it('puts many languages behind one chip naming the picks, which opens the language sheet', async () => {
    runInAction(() => {
      mockContentLanguage.languagesWithStories = [
        { code: 'tr', nativeName: 'Türkçe' },
        { code: 'en', nativeName: 'English' },
        { code: 'de', nativeName: 'Deutsch' },
        { code: 'fr', nativeName: 'Français' },
      ];
    });
    await renderDiscover();
    expect(screen.queryByTestId('discover-language-tr')).toBeNull();
    // The row says "Dil" once; the chip says what is picked.
    const chip = screen.getByTestId('discover-chip-language');
    expect(within(chip).getByText('Hepsi')).toBeOnTheScreen();
    expect(within(chip).queryByText(/Dil/)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Dil' }));
    expect(screen.getByRole('header', { name: 'Dil' })).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('checkbox', { name: 'English' }));
    await flush();
    expect(within(screen.getByTestId('discover-chip-language')).getByText('English')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('checkbox', { name: 'Türkçe' }));
    await flush();
    expect(mockGetStories).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: ['en', 'tr'] }),
    );
    // Still open: nothing to confirm.
    expect(screen.getByRole('checkbox', { name: 'English' })).toBeChecked();

    fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
    await flush();
    expect(screen.getByRole('button', { name: 'Dil: Türkçe, English' })).toBeOnTheScreen();
    expect(within(screen.getByTestId('discover-chip-language')).getByText('Türkçe, English')).toBeOnTheScreen();
  });

  it('picks several levels with square chips', async () => {
    await renderDiscover();
    fireEvent.press(screen.getByRole('checkbox', { name: 'A2' }));
    await flush();
    fireEvent.press(screen.getByRole('checkbox', { name: 'A1' }));
    await flush();

    expect(mockGetStories).toHaveBeenLastCalledWith(
      expect.objectContaining({ grouped: true, languageLevel: ['A2', 'A1'] }),
    );
    expect(screen.getByRole('checkbox', { name: 'A1' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'A2' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'B1' })).not.toBeChecked();
    expect(face('discover-level-A1').minWidth).toBe(36);
  });

  it('picks one age group; "Hepsi" or a second tap clears it', async () => {
    await renderDiscover();
    const ages = () => row('discover-row-age');
    fireEvent.press(ages().getByRole('radio', { name: '6-10 yaş' }));
    await flush();
    expect(mockGetStories).toHaveBeenLastCalledWith(
      expect.objectContaining({ ageGroup: 'SIX_TO_TEN' }),
    );
    expect(ages().getByRole('radio', { name: '6-10 yaş' })).toBeSelected();
    expect(ages().getByRole('radio', { name: 'Hepsi' })).not.toBeSelected();

    fireEvent.press(ages().getByRole('radio', { name: 'Hepsi' }));
    await flush();
    expect(mockGetStories.mock.calls[mockGetStories.mock.calls.length - 1][0].ageGroup).toBeUndefined();
    expect(ages().getByRole('radio', { name: 'Hepsi' })).toBeSelected();

    fireEvent.press(ages().getByRole('radio', { name: '0-3 yaş' }));
    await flush();
    fireEvent.press(ages().getByRole('radio', { name: '0-3 yaş' }));
    await flush();
    expect(mockDiscoverStore.ageGroup).toBeNull();
    expect(ages().getByRole('radio', { name: 'Hepsi' })).toBeSelected();
  });

  it('the "Tür" row picks one story category; "Hepsi" or a second tap shows every category', async () => {
    await renderDiscover();
    const types = () => row('discover-row-category');
    for (const name of ['Uyku masalları', 'Dünya klasikleri']) {
      expect(types().getByRole('radio', { name })).not.toBeSelected();
    }
    fireEvent.press(types().getByRole('radio', { name: 'Dünya klasikleri' }));
    await flush();
    expect(mockGetStories).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 'WORLD_CLASSICS' }),
    );
    expect(types().getByRole('radio', { name: 'Dünya klasikleri' })).toBeSelected();
    expect(types().getByRole('radio', { name: 'Hepsi' })).not.toBeSelected();
    expect(face('discover-category-WORLD_CLASSICS').backgroundColor).toBe(themes['gece-mavisi'].action);

    fireEvent.press(types().getByRole('radio', { name: 'Dünya klasikleri' }));
    await flush();
    expect(mockGetStories.mock.calls[mockGetStories.mock.calls.length - 1][0].category).toBeUndefined();

    fireEvent.press(types().getByRole('radio', { name: 'Uyku masalları' }));
    await flush();
    fireEvent.press(types().getByRole('radio', { name: 'Hepsi' }));
    await flush();
    expect(mockDiscoverStore.category).toBeNull();
  });

  it('opens on the category a home tile asked for, once, with one request', async () => {
    setMockRouteParams({ category: 'BEDTIME' });
    await renderDiscover();
    expect(mockDiscoverStore.category).toBe('BEDTIME');
    expect(mockGetStories).toHaveBeenCalledTimes(1);
    expect(mockGetStories).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'BEDTIME' }));
    expect(mockNavigation.setParams).toHaveBeenCalledWith({ category: undefined });
    expect(row('discover-row-category').getByRole('radio', { name: 'Uyku masalları' })).toBeSelected();
  });

  it('a category from Home drops the term and the other filters, and the field empties', async () => {
    await renderDiscover();
    fireEvent.press(screen.getByRole('checkbox', { name: 'A1' }));
    await flush();
    await typeAndWait('kaz');
    expect(screen.getByTestId('discover-search').props.value).toBe('kaz');

    act(() => {
      mockDiscoverStore.showCategory('TURKISH_CLASSICS');
    });
    await flush();
    expect(mockDiscoverStore.levels).toEqual([]);
    expect(mockDiscoverStore.query).toBe('');
    expect(screen.getByTestId('discover-search').props.value).toBe('');
    expect(mockGetStories).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 'TURKISH_CLASSICS' }),
    );
  });

  it('sorts through the sort sheet', async () => {
    await renderDiscover();
    fireEvent.press(screen.getByRole('button', { name: 'Sırala: Önerilen' }));
    fireEvent.press(screen.getByRole('radio', { name: 'En yeni' }));
    await flush();

    expect(mockGetStories).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'newest' }));
    expect(screen.getByText('En yeni')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sırala: En yeni' })).toBeOnTheScreen();
  });

  it('draws no Dil or Seviye row while there is nothing to pick (no dimmed, dead rows)', async () => {
    runInAction(() => {
      mockContentLanguage.languagesWithStories = [];
      mockContentLanguage.levels = [];
    });
    await renderDiscover();
    expect(screen.queryByTestId('discover-row-language')).toBeNull();
    expect(screen.queryByTestId('discover-row-level')).toBeNull();
    // The age filter needs no catalogue data.
    expect(screen.getByTestId('discover-row-age')).toBeOnTheScreen();
  });

  it('hides Seviye when no story has a level, and shows it once the catalogue has one', async () => {
    runInAction(() => {
      mockContentLanguage.levels = [];
      mockContentLanguage.levelsByLanguage = { tr: [], en: [] };
    });
    await renderDiscover();
    expect(screen.getByTestId('discover-row-language')).toBeOnTheScreen();
    expect(screen.queryByTestId('discover-row-level')).toBeNull();

    await act(async () => {
      runInAction(() => {
        mockContentLanguage.levels = ['A1'];
        mockContentLanguage.levelsByLanguage = { tr: [], en: ['A1'] };
      });
    });
    expect(screen.getByRole('checkbox', { name: 'A1' })).toBeEnabled();
  });

  it('Seviye follows the languages on screen: a picked language without levels hides it', async () => {
    await renderDiscover();
    expect(screen.getByTestId('discover-row-level')).toBeOnTheScreen();

    // Turkish stories carry no level.
    fireEvent.press(screen.getByRole('checkbox', { name: 'Türkçe' }));
    await flush();
    expect(screen.queryByTestId('discover-row-level')).toBeNull();

    // English ones do.
    fireEvent.press(screen.getByRole('checkbox', { name: 'English' }));
    await flush();
    expect(screen.getByTestId('discover-row-level')).toBeOnTheScreen();
  });

  it('a level that is still picked keeps its chip, so it can be cleared', async () => {
    await renderDiscover();
    fireEvent.press(screen.getByRole('checkbox', { name: 'A1' }));
    await flush();

    await act(async () => {
      runInAction(() => {
        mockContentLanguage.levels = [];
        mockContentLanguage.levelsByLanguage = { tr: [], en: [] };
      });
    });
    expect(screen.getByRole('checkbox', { name: 'A1' })).toBeChecked();
    fireEvent.press(screen.getByRole('checkbox', { name: 'A1' }));
    await flush();
    expect(screen.queryByTestId('discover-row-level')).toBeNull();
  });

  it('lines the header and the grid up on the screen edge', async () => {
    await renderDiscover();
    const T = themes['gece-mavisi'];
    const style = (node: { props: { style?: unknown } }) =>
      Object.assign({}, ...[node.props.style].flat(5).filter(Boolean)) as Record<string, unknown>;

    const list = screen.UNSAFE_getByType(FlatList);
    expect(style({ props: { style: list.props.columnWrapperStyle } })).toMatchObject({
      paddingHorizontal: T.screenPadH,
      gap: GRID_COLUMN_GAP,
    });
    // The search field is 52dp on a 3dp lip; the filter labels share one column.
    expect(face('discover-search-field').minHeight).toBe(52);
    expect(flatStyle(screen.getByTestId('discover-search-field-lip', { includeHiddenElements: true })).top).toBe(3);
    expect(flatStyle(screen.getByText('Seviye')).width).toBe(FILTER_LABEL_WIDTH);
    // A content card's 16dp padding at the left; the chips scroll to the edge.
    expect(face('discover-filters')).toMatchObject({ paddingLeft: 16, paddingRight: 0 });
  });

  it('reloads a grouped list when the content language changes', async () => {
    await renderDiscover();
    expect(mockGetStories).toHaveBeenCalledTimes(1);
    await act(async () => {
      runInAction(() => {
        mockContentLanguage.effective = 'en';
      });
    });
    await flush();
    expect(mockGetStories).toHaveBeenCalledTimes(2);
  });
});

describe('search', () => {
  it('searches after the debounce with the scope of the list', async () => {
    await renderDiscover();
    openSearch();
    fireEvent.changeText(screen.getByTestId('discover-search'), 'grimm');
    expect(mockSearchStories).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    await flush();

    expect(mockSearchStories).toHaveBeenCalledWith(
      'grimm',
      expect.objectContaining({ page: 1, grouped: true }),
    );
    expect(screen.getByText('1 masal bulundu')).toBeOnTheScreen();
    expect(screen.queryByText('Parmak Kız')).toBeNull();
    // The search endpoint takes no age group, no category and no sort key.
    expect(screen.queryByTestId('discover-row-age')).toBeNull();
    expect(screen.queryByTestId('discover-row-category')).toBeNull();
    expect(screen.queryByTestId('discover-sort')).toBeNull();
  });

  it('typing re-renders no card and sends one search 400 ms after the last key', async () => {
    await renderDiscover();
    openSearch();
    mockCardRenders.count = 0;
    const input = screen.getByTestId('discover-search');
    for (const term of ['k', 'ka', 'kaz', 'kaz ', 'kaz k']) fireEvent.changeText(input, term);
    expect(mockCardRenders.count).toBe(0);
    expect(input.props.value).toBe('kaz k');

    await act(async () => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(mockSearchStories).not.toHaveBeenCalled();
    expect(mockCardRenders.count).toBe(0);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    await flush();
    expect(mockSearchStories).toHaveBeenCalledTimes(1);
    expect(mockSearchStories).toHaveBeenCalledWith('kaz k', expect.anything());
    expect(mockDiscoverStore.query).toBe('kaz k');
  });

  it('a save re-renders only the card it changed', async () => {
    await renderDiscover();
    mockCardRenders.count = 0;
    fireEvent.press(screen.getByRole('button', { name: 'Parmak Kız masalını kaydet' }));
    await flush();
    // The saved card (and the toast's undo path) only: the other two keep their props.
    expect(mockCardRenders.count).toBe(1);
  });

  it('the search key applies the term at once, and the debounce sends nothing more', async () => {
    await renderDiscover();
    openSearch();
    fireEvent.changeText(screen.getByTestId('discover-search'), 'grimm');
    fireEvent(screen.getByTestId('discover-search'), 'submitEditing');
    await flush();
    expect(mockSearchStories).toHaveBeenCalledTimes(1);
    expect(mockSearchStories).toHaveBeenCalledWith('grimm', expect.anything());

    await act(async () => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    await flush();
    expect(mockSearchStories).toHaveBeenCalledTimes(1);
  });

  it('says it is loading instead of the old count while new results come', async () => {
    await renderDiscover();
    mockSearchStories.mockImplementation(() => new Promise(() => undefined));
    await typeAndWait('grimm');
    expect(screen.queryByText('12 masal bulundu')).toBeNull();
    expect(screen.getByTestId('discover-count-updating')).toHaveTextContent('Yükleniyor...');
    expect(screen.getByTestId('discover-updating')).toBeOnTheScreen();
  });

  it('says that a picked category or age is left out of a search', async () => {
    await renderDiscover();
    expect(screen.queryByTestId('discover-search-note')).toBeNull();
    fireEvent.press(row('discover-row-category').getByRole('radio', { name: 'Uyku masalları' }));
    await flush();
    await typeAndWait('kaz');
    expect(screen.getByText('Aramada tür ve yaş seçimi kullanılmaz.')).toBeOnTheScreen();
  });

  it('clears the term with the tile in the search field', async () => {
    await renderDiscover();
    await typeAndWait('grimm');

    expect(flatStyle(screen.getByTestId('discover-search-clear-face')).backgroundColor).toBe(
      themes['gece-mavisi'].surface2,
    );
    const loads = mockGetStories.mock.calls.length;
    fireEvent.press(screen.getByTestId('discover-search-clear'));
    // At once: no debounce wait for an emptied field.
    await flush();

    expect(screen.getByText('12 masal bulundu')).toBeOnTheScreen();
    expect(screen.queryByTestId('discover-search-clear')).toBeNull();
    expect(mockGetStories.mock.calls.length).toBe(loads + 1);
    // Nothing more once the debounce would have run.
    await act(async () => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    await flush();
    expect(mockGetStories.mock.calls.length).toBe(loads + 1);
  });

  it('a plain search with no result offers "Aramayı temizle", which drops the term only', async () => {
    mockSearchStories.mockResolvedValue(pageOf([], 0));
    await renderDiscover();
    fireEvent.press(row('discover-row-category').getByRole('radio', { name: 'Uyku masalları' }));
    await flush();
    await typeAndWait('zzz');

    const empty = within(screen.getByTestId('discover-no-results'));
    expect(empty.getByText('Sonuç yok')).toBeOnTheScreen();
    expect(screen.queryByTestId('discover-count')).toBeNull();
    // The search field stays above the empty state.
    expect(screen.getByTestId('discover-search')).toBeOnTheScreen();

    fireEvent.press(empty.getByRole('button', { name: 'Aramayı temizle' }));
    await flush();
    expect(screen.getByText('12 masal bulundu')).toBeOnTheScreen();
    expect(screen.getByTestId('discover-search').props.value).toBe('');
    // The category the search left out is still picked.
    expect(mockDiscoverStore.category).toBe('BEDTIME');
  });

  it('a search with filters offers "Hepsini temizle"; filters alone "Filtreleri temizle"', async () => {
    mockSearchStories.mockResolvedValue(pageOf([], 0));
    await renderDiscover();
    fireEvent.press(screen.getByRole('checkbox', { name: 'A1' }));
    await flush();
    await typeAndWait('zzz');
    const empty = within(screen.getByTestId('discover-no-results'));
    fireEvent.press(empty.getByRole('button', { name: 'Hepsini temizle' }));
    await flush();
    expect(mockDiscoverStore.levels).toEqual([]);
    expect(screen.getByTestId('discover-search').props.value).toBe('');
    // "Clear" is back on the default language (Turkish, no levels): the
    // second half runs on the whole catalogue again.
    expect(mockDiscoverStore.languages).toEqual(['tr']);
    act(() => {
      mockDiscoverStore.showAllLanguages();
    });
    await flush();

    mockGetStories.mockResolvedValue(pageOf([], 0));
    fireEvent.press(screen.getByRole('checkbox', { name: 'A2' }));
    await flush();
    fireEvent.press(within(screen.getByTestId('discover-no-results')).getByRole('button', { name: 'Filtreleri temizle' }));
    await flush();
    expect(mockDiscoverStore.levels).toEqual([]);
  });
});

describe('opens on the content language', () => {
  beforeEach(() => {
    mockDiscoverStore = new DiscoverStore();
  });

  it('lists the content language only, its chip picked but not counted as a filter', async () => {
    await renderDiscover();
    expect(mockGetStories).toHaveBeenCalledTimes(1);
    expect(mockGetStories).toHaveBeenCalledWith(expect.objectContaining({ page: 1, language: ['tr'] }));
    expect(mockGetStories.mock.calls[0][0].grouped).toBeUndefined();
    expect(screen.getByRole('checkbox', { name: 'Türkçe' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'English' })).not.toBeChecked();
    // Hidden card: no count on the button, no pick chips.
    fireEvent.press(screen.getByTestId('discover-filters-toggle'));
    expect(screen.getByTestId('discover-filters-toggle')).toHaveProp('accessibilityLabel', 'Filtreleri göster');
    expect(screen.queryByTestId('discover-picks')).toBeNull();
  });

  it('follows the content language while the Dil row is untouched', async () => {
    await renderDiscover();
    await act(async () => {
      runInAction(() => {
        mockContentLanguage.effective = 'en';
      });
    });
    await flush();
    expect(mockGetStories).toHaveBeenLastCalledWith(expect.objectContaining({ language: ['en'] }));
    // On an English list the English card names no language, a Turkish one does.
    expect(screen.getByRole('button', { name: 'Parmak Kız masalını aç, Diller: TR' })).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Thumbelina masalını aç, Yapay zekâ ile çevrildi' }),
    ).toBeOnTheScreen();
  });

  it('a search with nothing in the content language offers every language', async () => {
    mockSearchStories.mockResolvedValueOnce(pageOf([], 0)).mockResolvedValue(pageOf([GROUPED[1]], 1));
    await renderDiscover();
    await typeAndWait('keloğlan');
    expect(mockSearchStories).toHaveBeenLastCalledWith('keloğlan', expect.objectContaining({ language: ['tr'] }));
    const empty = within(screen.getByTestId('discover-no-results'));
    expect(empty.getByText('Türkçe masallarda bulunamadı. Diğer dillerde de arayabilirsin.')).toBeOnTheScreen();
    fireEvent.press(empty.getByRole('button', { name: 'Tüm dillerde ara' }));
    await flush();
    expect(mockSearchStories).toHaveBeenLastCalledWith(
      'keloğlan',
      expect.objectContaining({ grouped: true, prefer: 'tr' }),
    );
    expect(screen.getByText('Bremen Mızıkacıları')).toBeOnTheScreen();
  });
});

describe('saving', () => {
  it('fills the bookmark, then shows "kaydedildi" with "Göster", which opens Kütüphane', async () => {
    await renderDiscover();
    fireEvent.press(screen.getByRole('button', { name: 'Parmak Kız masalını kaydet' }));
    // Optimistic.
    expect(
      screen.getByRole('button', { name: 'Parmak Kız masalını kaydedilenlerden çıkar' }),
    ).toBeOnTheScreen();
    await flush();

    expect(mockToggleFavorite).toHaveBeenCalledWith('s-1', true);
    expect(mockToast.success).toHaveBeenCalledWith(
      'Parmak Kız kaydedildi',
      undefined,
      expect.objectContaining({ label: 'Göster' }),
    );
    mockToast.success.mock.calls[0][2].onPress();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Main', { screen: 'Library' });
  });

  it('an unsave says so with "Geri al", which saves the row again', async () => {
    mockGetStories.mockResolvedValue(
      pageOf([{ ...GROUPED[0], isFavorite: true, isFavoriteAnyLanguage: true }, ...GROUPED.slice(1)], 12),
    );
    await renderDiscover();
    fireEvent.press(screen.getByRole('button', { name: 'Parmak Kız masalını kaydedilenlerden çıkar' }));
    await flush();
    expect(mockToggleFavorite).toHaveBeenLastCalledWith('s-1', false);
    expect(mockToast.info).toHaveBeenCalledWith(
      'Parmak Kız kaydedilenlerden çıkarıldı',
      undefined,
      expect.objectContaining({ label: 'Geri al' }),
    );
    expect(screen.getByRole('button', { name: 'Parmak Kız masalını kaydet' })).toBeOnTheScreen();

    await act(async () => {
      mockToast.info.mock.calls[0][2].onPress();
    });
    await flush();
    expect(mockToggleFavorite).toHaveBeenLastCalledWith('s-1', true);
    expect(
      screen.getByRole('button', { name: 'Parmak Kız masalını kaydedilenlerden çıkar' }),
    ).toBeOnTheScreen();
    // The undo says nothing more when it works.
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('goes through StoryStore when it holds the story, so other lists follow', async () => {
    mockStoryStore.stories = [GROUPED[1]];
    mockStoryStore.toggleFavorite.mockImplementationOnce(async () => {
      mockStoryStore.getFavoriteState.mockReturnValue(true);
    });
    await renderDiscover();
    fireEvent.press(screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını kaydet' }));
    await flush();

    expect(mockStoryStore.toggleFavorite).toHaveBeenCalledWith('s-2', { quiet: true });
    expect(mockToggleFavorite).not.toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalled();
    mockStoryStore.stories = [];
  });

  it('empties the bookmark again and says so once when saving fails', async () => {
    mockToggleFavorite.mockRejectedValueOnce(new Error('offline'));
    await renderDiscover();
    fireEvent.press(screen.getByRole('button', { name: 'Parmak Kız masalını kaydet' }));
    await flush();

    expect(screen.getByRole('button', { name: 'Parmak Kız masalını kaydet' })).toBeOnTheScreen();
    expect(mockToast.error).toHaveBeenCalledTimes(1);
    expect(mockToast.error).toHaveBeenCalledWith('Kaydedilemedi. Tekrar dene.');
    expect(mockToast.success).not.toHaveBeenCalled();
  });
});

describe('saved marks after a refocus', () => {
  it('a blur and a refocus without a save make no request', async () => {
    await renderDiscover();
    expect(mockGetStories).toHaveBeenCalledTimes(1);
    act(() => setMockFocused(false));
    act(() => setMockFocused(true));
    await flush();
    expect(mockGetStories).toHaveBeenCalledTimes(1);
    expect(mockSearchStories).not.toHaveBeenCalled();
  });

  it('a save made on a story page fills the bookmark on the way back, with no request', async () => {
    await renderDiscover();
    act(() => setMockFocused(false));
    // The story page saved the English version of Parmak Kız (same tale key).
    recordChange('s-1-en', true, 'g-1');
    recordChange('s-2', true);
    act(() => setMockFocused(true));
    await flush();

    expect(mockGetStories).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Parmak Kız masalını kaydedilenlerden çıkar' }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını kaydedilenlerden çıkar' }),
    ).toBeOnTheScreen();
    // The grouped row is another version: saved in some language, not itself.
    expect(mockDiscoverStore.items[0]).toMatchObject({ isFavorite: false, isFavoriteAnyLanguage: true });
    expect(mockDiscoverStore.items[1]).toMatchObject({ isFavorite: true, isFavoriteAnyLanguage: true });
  });

  it('changes made before the blur are not written again', async () => {
    recordChange('s-2', true);
    await renderDiscover();
    act(() => setMockFocused(false));
    act(() => setMockFocused(true));
    await flush();
    expect(screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını kaydet' })).toBeOnTheScreen();
  });

  it('a flat list of several languages asks the server when a changed story has no tale key', async () => {
    await renderDiscover();
    fireEvent.press(screen.getByRole('checkbox', { name: 'Türkçe' }));
    fireEvent.press(screen.getByRole('checkbox', { name: 'English' }));
    await flush();
    const calls = mockGetStories.mock.calls.length;
    act(() => setMockFocused(false));
    recordChange('s-1', false);
    act(() => setMockFocused(true));
    await flush();
    expect(mockGetStories.mock.calls.length).toBe(calls + 1);
    expect(mockGetStories).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, language: ['tr', 'en'] }),
    );
  });

  it('a list of one language holds each tale once: it patches its rows with no request', async () => {
    await renderDiscover();
    fireEvent.press(screen.getByRole('checkbox', { name: 'Türkçe' }));
    await flush();
    const calls = mockGetStories.mock.calls.length;
    act(() => setMockFocused(false));
    recordChange('s-1', false);
    act(() => setMockFocused(true));
    await flush();
    expect(mockGetStories).toHaveBeenCalledTimes(calls);
    expect(screen.getByRole('button', { name: 'Parmak Kız masalını kaydet' })).toBeOnTheScreen();
  });

  it('a save of another language version fills the grouped card, the versions named by the story page', async () => {
    await renderDiscover();
    act(() => setMockFocused(false));
    // The story page switched Parmak Kız to English and saved it; the API
    // sends no tale key, the page lists the versions.
    openStoryPage('s-1-en', ['s-1', 's-1-en']);
    recordChange('s-1-en', true);
    act(() => setMockFocused(true));
    await flush();

    expect(mockGetStories).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Parmak Kız masalını kaydedilenlerden çıkar' }),
    ).toBeOnTheScreen();
    // Saved in another language, not this version itself.
    expect(mockDiscoverStore.items[0]).toMatchObject({ id: 's-1', isFavorite: false, isFavoriteAnyLanguage: true });
    expect(mockDiscoverStore.items[1]).toMatchObject({ id: 's-2', isFavoriteAnyLanguage: false });
  });

  it('a flat list writes an unsave into every version the story page named, with no request', async () => {
    await renderDiscover();
    fireEvent.press(screen.getByRole('checkbox', { name: 'Türkçe' }));
    await flush();
    const calls = mockGetStories.mock.calls.length;
    act(() => setMockFocused(false));
    openStoryPage('s-1', ['s-1', 's-1-en']);
    recordChange('s-1', false);
    act(() => setMockFocused(true));
    await flush();

    expect(mockGetStories.mock.calls.length).toBe(calls);
    expect(screen.getByRole('button', { name: 'Parmak Kız masalını kaydet' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Thumbelina masalını kaydet' })).toBeOnTheScreen();
  });

  it('fetches the pages again when more changes were made than are kept', async () => {
    await renderDiscover();
    act(() => setMockFocused(false));
    recordChange('s-2', true);
    recordChange('s-3', true);
    // The oldest change is gone from the log.
    mockStoryStore.favoriteChanges = mockStoryStore.favoriteChanges.slice(1);
    act(() => setMockFocused(true));
    await flush();
    expect(mockGetStories).toHaveBeenCalledTimes(2);
  });
});

describe('premium stories', () => {
  const premiumPage = () =>
    pageOf([story('p-1', 'Altın Kaz', { isPremium: true }), ...GROUPED.slice(1)], 3);

  it('marks a premium story and, on the free plan, locks it: no bookmark, a tap offers the plans', async () => {
    mockGetStories.mockResolvedValue(premiumPage());
    await renderDiscover();
    expect(screen.getByTestId('story-card-p-1-premium')).toBeOnTheScreen();
    expect(screen.queryByTestId('story-card-p-1-save')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Altın Kaz, Premium, kilitli' }));
    await flush();
    expect(mockNavigation.navigate).not.toHaveBeenCalledWith('StoryDetail', expect.anything());
    expect(screen.getByText('Bu masal ücretli planlarda')).toBeOnTheScreen();
    expect(screen.getByText('Mini ya da Premium planla dinleyebilirsin.')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Planları gör'));
    await flush();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Subscription', { reason: 'premiumStory' }, { pop: true });
  });

  it('opens a premium story on Mini, a paid plan', async () => {
    getSubscriptionStore().setTierFromUser(SubscriptionTier.MINI);
    mockGetStories.mockResolvedValue(premiumPage());
    await renderDiscover();
    expect(screen.getByTestId('story-card-p-1-premium')).toBeOnTheScreen();
    expect(screen.getByTestId('story-card-p-1-save')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Altın Kaz masalını aç' }));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 'p-1' });
  });
});

describe('filters on demand (owner feedback, 360dp)', () => {
  const scrollTo = (y: number) =>
    act(() => {
      fireEvent.scroll(screen.getByTestId('discover-list'), {
        nativeEvent: {
          contentOffset: { x: 0, y },
          contentSize: { width: 360, height: 4000 },
          layoutMeasurement: { width: 360, height: 600 },
        },
      });
    });
  const toggle = () => screen.getByTestId('discover-filters-toggle');
  const list = () => within(screen.getByTestId('discover-list'));
  const bubble = (n: string) => within(toggle()).queryByText(n, { includeHiddenElements: true });
  const glyphColor = () =>
    flatStyle(
      within(toggle())
        .getByTestId('icon-sliders', { includeHiddenElements: true })
        .findAll((node: { type: unknown }) => node.type === 'Text')[0],
    ).color;

  it('is hidden by default: no card and no picks, only the grid under the header row', async () => {
    await renderDiscover('gece-mavisi', { filtersOpen: false });
    expect(screen.queryByTestId('discover-panel')).toBeNull();
    expect(screen.queryByTestId('discover-filters')).toBeNull();
    expect(screen.queryByText('Dil')).toBeNull();
    expect(screen.queryByTestId('discover-active-filters')).toBeNull();
    expect(screen.getByText('12 masal bulundu')).toBeOnTheScreen();
    expect(screen.getByText('Parmak Kız')).toBeOnTheScreen();
    expect(toggle().props.accessibilityLabel).toBe('Filtreleri göster');
    expect(bubble('0')).toBeNull();
  });

  it('puts the title, the search icon and the filters button on one header row, outside the list', async () => {
    await renderDiscover('gece-mavisi', { filtersOpen: false });
    const topNode = screen.getByTestId('discover-top');
    const top = within(topNode);
    expect(top.getByRole('header', { name: 'Keşfet' })).toBeOnTheScreen();
    expect(top.getByTestId('discover-search-open')).toBeOnTheScreen();
    expect(top.getByTestId('discover-filters-toggle')).toBeOnTheScreen();
    expect(flatStyle(screen.getByTestId('discover-actions'))).toMatchObject({ flexDirection: 'row', gap: 8 });
    // In this order: the title, the search icon, the filters button.
    const order = ['discover-search-open', 'discover-filters-toggle'];
    type Node = { props: { testID?: string; accessibilityRole?: string }; children: (Node | string)[] };
    const ids: string[] = [];
    const walk = (node: Node | string) => {
      if (typeof node === 'string') return;
      if (node.props.accessibilityRole === 'header' && !ids.includes('title')) ids.push('title');
      if (node.props.testID && order.includes(node.props.testID) && !ids.includes(node.props.testID)) {
        ids.push(node.props.testID);
      }
      node.children.forEach(walk);
    };
    walk(topNode as unknown as Node);
    expect(ids).toEqual(['title', ...order]);
    // Nothing of the header row scrolls with the list.
    expect(list().queryByTestId('discover-search', { includeHiddenElements: true })).toBeNull();
    expect(list().queryByTestId('discover-search-open')).toBeNull();
    expect(list().queryByTestId('discover-filters-toggle')).toBeNull();
    expect(list().queryByRole('header', { name: 'Keşfet' })).toBeNull();
  });

  it('the button opens the card at the top of the list, sliding it in as the rows move down, and closes it', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    const scrollToOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    try {
      await renderDiscover('gece-mavisi', { filtersOpen: false });
      // Every row of the grid is a cell that slides to its new place.
      expect(screen.getByTestId('discover-list').props.itemLayoutAnimation).toBe(LIST_MOVE);
      timing.mockClear();
      fireEvent.press(toggle());
      measurePanel();
      // The start of the list content, above the result line.
      const header = within(screen.getByTestId('discover-list-header'));
      expect(header.getByTestId('discover-filters')).toBeOnTheScreen();
      expect(screen.getByText('Dil')).toBeOnTheScreen();
      expect(toggle().props.accessibilityLabel).toBe('Filtreleri gizle');
      expect(glyphColor()).toBe(themes['gece-mavisi'].action);
      // The card comes in from above and leaves upwards, as Reanimated
      // layout animations (UI thread); the blocks under it slide with the
      // rows. Nothing runs on the JS side, no height is animated.
      const panel = screen.getByTestId('discover-panel');
      expect(panel.props.entering).toBe(PANEL_ENTERING);
      expect(panel.props.exiting).toBe(PANEL_EXITING);
      expect(panel.props.needsOffscreenAlphaCompositing).toBe(true);
      expect(flatStyle(panel).height).toBeUndefined();
      expect(screen.getByTestId('discover-result-line').props.layout).toBe(LIST_MOVE);
      expect(timing).not.toHaveBeenCalled();
      // At the top nothing had to scroll.
      expect(scrollToOffset).not.toHaveBeenCalled();

      fireEvent.press(toggle());
      expect(screen.queryByTestId('discover-panel')).toBeNull();
      expect(toggle().props.accessibilityLabel).toBe('Filtreleri göster');
      expect(glyphColor()).toBe(themes['gece-mavisi'].text);
      expect(scrollToOffset).not.toHaveBeenCalled();
    } finally {
      timing.mockRestore();
      scrollToOffset.mockRestore();
    }
  });

  it('the open card is plain list content: it scrolls away with the grid, no overlay and no motion', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    try {
      await renderDiscover();
      const panel = list().getByTestId('discover-panel');
      // Laid out in the content: not absolute, no transform, no spacer.
      expect(flatStyle(panel).position).toBeUndefined();
      expect(flatStyle(panel).transform).toBeUndefined();
      expect(screen.queryByTestId('discover-panel-space')).toBeNull();
      timing.mockClear();

      // Within its own height it is still in view.
      scrollTo(PANEL_BOTTOM - 10);
      expect(toggle().props.accessibilityLabel).toBe('Filtreleri gizle');
      // Past it, it stays in the content (gone up under the header row with
      // the grid); nothing animates, and the button offers it again.
      scrollTo(PANEL_BOTTOM + 300);
      expect(list().getByTestId('discover-panel')).toBeOnTheScreen();
      expect(timing).not.toHaveBeenCalled();
      expect(toggle().props.accessibilityLabel).toBe('Filtreleri göster');
      // Back up: in view again.
      scrollTo(20);
      expect(toggle().props.accessibilityLabel).toBe('Filtreleri gizle');
      expect(timing).not.toHaveBeenCalled();
    } finally {
      timing.mockRestore();
    }
  });

  it('further down, a tap scrolls to the top first and opens the card once there', async () => {
    const scrollToOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    try {
      await renderDiscover('gece-mavisi', { filtersOpen: false });
      scrollTo(800);
      fireEvent.press(toggle());
      expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
      // Nothing is inserted above the rows on the way up.
      expect(screen.queryByTestId('discover-panel')).toBeNull();
      scrollTo(300);
      expect(screen.queryByTestId('discover-panel')).toBeNull();
      scrollTo(0);
      expect(list().getByTestId('discover-filters')).toBeOnTheScreen();
      expect(toggle().props.accessibilityLabel).toBe('Filtreleri gizle');
    } finally {
      scrollToOffset.mockRestore();
    }
  });

  it('a finger on the grid on the way up keeps the card closed', async () => {
    await renderDiscover('gece-mavisi', { filtersOpen: false });
    scrollTo(800);
    fireEvent.press(toggle());
    fireEvent(screen.getByTestId('discover-list'), 'scrollBeginDrag');
    scrollTo(0);
    expect(screen.queryByTestId('discover-panel')).toBeNull();
  });

  it('scrolled out of sight, a tap scrolls back up to the open card instead of closing it', async () => {
    const scrollToOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    try {
      await renderDiscover();
      scrollTo(PANEL_BOTTOM + 100);
      fireEvent.press(toggle());
      expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
      expect(list().getByTestId('discover-panel')).toBeOnTheScreen();
      scrollTo(0);
      fireEvent.press(toggle());
      expect(screen.queryByTestId('discover-panel')).toBeNull();
    } finally {
      scrollToOffset.mockRestore();
    }
  });

  it('the button counts the picks in a bubble while the card is not in view', async () => {
    await renderDiscover();
    fireEvent.press(screen.getByTestId('discover-age-THREE_TO_SIX'));
    await flush();
    fireEvent.press(screen.getByTestId('discover-category-BEDTIME'));
    await flush();
    // Open and in view: the picks are on screen, so no count.
    expect(toggle().props.accessibilityLabel).toBe('Filtreleri gizle');
    expect(bubble('2')).toBeNull();
    // Scrolled out of sight: the count comes back.
    scrollTo(PANEL_BOTTOM + 100);
    expect(toggle().props.accessibilityLabel).toBe('Filtreleri göster, 2 filtre seçili');
    expect(bubble('2')).toBeOnTheScreen();
    scrollTo(0);
    fireEvent.press(toggle());
    expect(toggle().props.accessibilityLabel).toBe('Filtreleri göster, 2 filtre seçili');
    expect(bubble('2')).toBeOnTheScreen();
    // One pick says "1 filtre seçili".
    fireEvent.press(screen.getByTestId('discover-active-age'));
    await flush();
    expect(toggle().props.accessibilityLabel).toBe('Filtreleri göster, 1 filtre seçili');
    expect(bubble('1')).toBeOnTheScreen();
    // Cleared: no bubble, no count in the label.
    act(() => mockDiscoverStore.clearFilters());
    await flush();
    expect(toggle().props.accessibilityLabel).toBe('Filtreleri göster');
    expect(bubble('1')).toBeNull();
  });

  it('closed with picks, they show as removable chips at the top of the list', async () => {
    await renderDiscover();
    fireEvent.press(screen.getByRole('checkbox', { name: 'English' }));
    await flush();
    fireEvent.press(screen.getByRole('checkbox', { name: 'A1' }));
    await flush();
    fireEvent.press(screen.getByTestId('discover-age-THREE_TO_SIX'));
    await flush();
    // Open: the card shows the picks itself.
    expect(screen.queryByTestId('discover-active-filters')).toBeNull();

    fireEvent.press(toggle());
    // The row fades in where the card was and slides with the rows; its
    // wrapper reaches the screen edges, so every chip is a target.
    const picksRow = list().getByTestId('discover-active-filters-row');
    expect(picksRow.props.entering).toBe(PICKS_ENTERING);
    expect(picksRow.props.exiting).toBe(PICKS_EXITING);
    expect(picksRow.props.layout).toBe(LIST_MOVE);
    expect(flatStyle(picksRow)).toMatchObject({ marginTop: 4, marginHorizontal: -themes['gece-mavisi'].screenPadH });
    const picks = within(list().getByTestId('discover-active-filters'));
    expect(picks.getAllByRole('button').map(chip => chip.props.accessibilityLabel)).toEqual([
      'English filtresini kaldır',
      'A1 filtresini kaldır',
      '3-6 yaş filtresini kaldır',
      'Filtreleri temizle',
    ]);
    expect(picks.getByText('Temizle')).toBeOnTheScreen();
    expect(picks.getAllByTestId('icon-close', { includeHiddenElements: true })).toHaveLength(3);
    // Above the result line, which keeps a block's distance under them.
    expect(flatStyle(screen.getByTestId('discover-result-line')).marginTop).toBe(16);

    fireEvent.press(picks.getByRole('button', { name: 'A1 filtresini kaldır' }));
    await flush();
    expect(mockDiscoverStore.levels).toEqual([]);
    expect(mockDiscoverStore.languages).toEqual(['en']);
    fireEvent.press(screen.getByRole('button', { name: 'English filtresini kaldır' }));
    await flush();
    expect(mockDiscoverStore.languages).toEqual([]);
    // One pick left: no "Temizle".
    expect(screen.queryByTestId('discover-active-clear')).toBeNull();
    fireEvent.press(screen.getByTestId('discover-active-age'));
    await flush();
    expect(mockDiscoverStore.ageGroup).toBeNull();
    expect(screen.queryByTestId('discover-active-filters')).toBeNull();
    // Without picks the result line is the first block under the header row.
    expect(flatStyle(screen.getByTestId('discover-result-line')).marginTop).toBe(4);
  });

  it('"Temizle" drops every pick at once', async () => {
    await renderDiscover();
    fireEvent.press(screen.getByTestId('discover-age-THREE_TO_SIX'));
    await flush();
    fireEvent.press(screen.getByTestId('discover-category-BEDTIME'));
    await flush();
    fireEvent.press(toggle());
    fireEvent.press(screen.getByTestId('discover-active-clear'));
    await flush();
    expect(mockDiscoverStore.hasFilters).toBe(false);
    expect(screen.queryByTestId('discover-active-filters')).toBeNull();
  });

  it('is translated to English', async () => {
    await i18n.changeLanguage('en');
    try {
      await renderDiscover();
      expect(toggle().props.accessibilityLabel).toBe('Hide filters');
      fireEvent.press(screen.getByTestId('discover-age-THREE_TO_SIX'));
      await flush();
      fireEvent.press(toggle());
      expect(toggle().props.accessibilityLabel).toBe('Show filters, 1 filter on');
      expect(screen.getByRole('button', { name: /^Remove the .+ filter$/ })).toBeOnTheScreen();
    } finally {
      await act(async () => {
        await i18n.changeLanguage('tr');
      });
    }
  });

  it('under reduced motion nothing moves: the jump to the top, the card and the rows are instant', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const scrollToOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    try {
      await renderDiscover('gece-mavisi', { filtersOpen: false });
      expect(screen.getByTestId('discover-list').props.itemLayoutAnimation).toBeUndefined();
      scrollTo(800);
      fireEvent.press(toggle());
      await flush();
      expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
      expect(list().getByTestId('discover-filters')).toBeOnTheScreen();
      const panel = screen.getByTestId('discover-panel');
      expect(panel.props.entering).toBeUndefined();
      expect(panel.props.exiting).toBeUndefined();
      expect(screen.getByTestId('discover-result-line').props.layout).toBeUndefined();

      // Closed with a pick: the picks row shows at once too.
      fireEvent.press(screen.getByTestId('discover-age-THREE_TO_SIX'));
      await flush();
      fireEvent.press(toggle());
      const picks = screen.getByTestId('discover-active-filters-row');
      expect(picks.props.entering).toBeUndefined();
      expect(picks.props.exiting).toBeUndefined();
      expect(picks.props.layout).toBeUndefined();
    } finally {
      scrollToOffset.mockRestore();
      jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockRestore();
    }
  });

  it('builds its motion from the tokens: enter in, exit out, the rows in step with the card', () => {
    type Builder = Record<'duration' | 'easing', (value: unknown) => Builder>;
    const calls: Record<string, [string, unknown][]> = {};
    const curves = new Map<unknown, string>();
    jest.isolateModules(() => {
      // A fresh module registry: the builders are recorded before the
      // screen module builds its constants from them.
      const reanimated = jest.requireMock('react-native-reanimated') as Record<string, unknown> & {
        Easing: { bezier: (...points: number[]) => unknown };
      };
      const bezier = reanimated.Easing.bezier;
      reanimated.Easing.bezier = (...points: number[]) => {
        const curve = bezier(...points) ?? {};
        curves.set(curve, points.join(','));
        return curve;
      };
      for (const name of ['FadeInUp', 'FadeOutUp', 'LinearTransition', 'FadeIn', 'FadeOut']) {
        const builder = reanimated[name] as Builder;
        calls[name] = [];
        for (const method of ['duration', 'easing'] as const) {
          const original = builder[method].bind(builder);
          builder[method] = (value: unknown) => {
            calls[name].push([method, method === 'easing' ? curves.get(value) : value]);
            return original(value);
          };
        }
      }
      require('./StoryLibraryScreen');
    });
    const standard = CURVE.standard.join(',');
    const exit = CURVE.exit.join(',');
    expect(calls.FadeInUp).toEqual([['duration', DURATION.enter], ['easing', standard]]);
    expect(calls.FadeOutUp).toEqual([['duration', DURATION.exit], ['easing', exit]]);
    expect(calls.LinearTransition).toEqual([['duration', DURATION.enter], ['easing', standard]]);
    expect(calls.FadeIn).toEqual([['duration', DURATION.enter], ['easing', standard]]);
    expect(calls.FadeOut).toEqual([['duration', DURATION.exit], ['easing', exit]]);
  });

  it('counts every pick and knows when the card is out of view', () => {
    expect(
      activeFilterCount({ languages: [], languageFilterActive: false, levels: [], category: null, ageGroup: null }),
    ).toBe(0);
    expect(
      activeFilterCount({
        languages: ['tr', 'en'],
        languageFilterActive: true,
        levels: ['A1'],
        category: 'BEDTIME',
        ageGroup: 'THREE_TO_SIX',
      }),
    ).toBe(5);
    // The default language is no pick.
    expect(
      activeFilterCount({ languages: ['tr'], languageFilterActive: false, levels: [], category: null, ageGroup: null }),
    ).toBe(0);
    expect(isAtListTop(0)).toBe(true);
    expect(isAtListTop(0.5)).toBe(true);
    expect(isAtListTop(-12)).toBe(true);
    expect(isAtListTop(2)).toBe(false);
    expect(isPanelOutOfView(183, 184)).toBe(false);
    expect(isPanelOutOfView(184, 184)).toBe(true);
    // Not measured yet: only the top counts as in view.
    expect(isPanelOutOfView(0, 0)).toBe(false);
    expect(isPanelOutOfView(5, 0)).toBe(true);
  });
});

describe('search behind its icon (owner feedback, 360dp)', () => {
  const overlay = () => screen.getByTestId('discover-search-overlay', { includeHiddenElements: true });
  const input = () => screen.getByTestId('discover-search');
  const hidden = { includeHiddenElements: true } as const;
  /** The native layout of the overlay (the screen edge to the filters button). */
  const measureOverlay = (width = 260) =>
    act(() => {
      fireEvent(overlay(), 'layout', { nativeEvent: { layout: { x: 16, y: 8, width, height: 56 } } });
    });
  const translateX = (id: string) =>
    (flatStyle(screen.getByTestId(id, hidden)).transform as { translateX: number }[])[0].translateX;
  const backHandlers = (spy: jest.SpyInstance) =>
    spy.mock.calls.filter(call => call[0] === 'hardwareBackPress').map(call => call[1] as () => boolean);

  it('folded: only the icon, the field drawn but neither a target nor read out', async () => {
    await renderDiscover('gece-mavisi', { filtersOpen: false });
    expect(searchIsOpen()).toBe(false);
    expect(overlay().props.pointerEvents).toBe('none');
    expect(overlay().props.importantForAccessibility).toBe('no-hide-descendants');
    expect(screen.queryByTestId('discover-search')).toBeNull();
    const open = screen.getByRole('button', { name: 'Aramayı aç' });
    expect(within(open).getByTestId('icon-search', hidden)).toBeTruthy();
    expect(face('discover-search-open')).toMatchObject({ width: HEADER_BUTTON_SIZE });
  });

  it('a tap opens the field over the title and focuses it (the keyboard opens), the filters still reachable', async () => {
    const focus = jest.spyOn(TextInput.prototype, 'focus');
    const timing = jest.spyOn(Animated, 'timing');
    try {
      await renderDiscover('gece-mavisi', { filtersOpen: false });
      measureOverlay();
      // Folded, the mask keeps only the icon's width at the right, and the
      // field inside stands where it will open.
      expect(translateX('discover-search-mask')).toBe(260 - HEADER_BUTTON_SIZE);
      expect(translateX('discover-search-slide')).toBe(-(260 - HEADER_BUTTON_SIZE));

      fireEvent.press(screen.getByRole('button', { name: 'Aramayı aç' }));
      // Focused one frame after the field opened (focused while folded, it
      // would lose the focus and the keyboard at once).
      expect(focus).not.toHaveBeenCalled();
      await waitFor(() => expect(focus).toHaveBeenCalledTimes(1));
      expect(searchIsOpen()).toBe(true);
      expect(overlay().props.importantForAccessibility).toBe('auto');
      expect(input()).toBeOnTheScreen();
      // The reveal runs with the enter motion, on the native driver.
      expect(timing).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ toValue: 1, duration: DURATION.enter, useNativeDriver: true }),
      );
      // From the screen edge to the filters button, over the title, which
      // is still there underneath; the icon under the field is not read out.
      const T = themes['gece-mavisi'];
      expect(flatStyle(overlay())).toMatchObject({
        position: 'absolute',
        left: T.screenPadH,
        right: T.screenPadH + SEARCH_OVERLAY_END,
      });
      expect(SEARCH_OVERLAY_END).toBe(HEADER_BUTTON_SIZE + 8);
      expect(flatStyle(screen.getByTestId('discover-search-slide', hidden)).backgroundColor).toBe(T.bg);
      expect(screen.getByRole('header', { name: 'Keşfet' })).toBeOnTheScreen();
      expect(screen.queryByTestId('discover-search-open')).toBeNull();
      // The bar does not grow: nothing in the list moves.
      expect(within(screen.getByTestId('discover-list')).queryByTestId('discover-search')).toBeNull();

      // The filters button stays a target beside the field.
      fireEvent.press(screen.getByTestId('discover-filters-toggle'));
      expect(screen.getByTestId('discover-panel')).toBeOnTheScreen();
      expect(searchIsOpen()).toBe(true);
    } finally {
      focus.mockRestore();
      timing.mockRestore();
    }
  });

  it('never folds by itself: opened from the icon it stays open when it loses focus while empty', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    try {
      await renderDiscover('gece-mavisi', { filtersOpen: false });
      measureOverlay();
      openSearch();
      timing.mockClear();
      // The focus goes at once (owner report): the empty field stays open,
      // and no fold runs.
      fireEvent(input(), 'blur');
      expect(searchIsOpen()).toBe(true);
      expect(input().props.value).toBe('');
      expect(timing).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 0 }));
      expect(screen.getByRole('button', { name: 'Aramayı kapat' })).toBeOnTheScreen();

      // Text keeps it open without focus too.
      fireEvent(input(), 'focus');
      await typeAndWait('kaz');
      fireEvent(input(), 'blur');
      expect(searchIsOpen()).toBe(true);
      expect(input().props.value).toBe('kaz');

      // Emptied (focused or not), or left with blanks: still open.
      fireEvent.changeText(input(), '');
      await flush();
      expect(searchIsOpen()).toBe(true);
      expect(mockDiscoverStore.query).toBe('');
      fireEvent(input(), 'focus');
      fireEvent.changeText(input(), '   ');
      fireEvent(input(), 'blur');
      await flush();
      expect(searchIsOpen()).toBe(true);
      expect(input().props.value).toBe('   ');
      expect(timing).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 0 }));
    } finally {
      timing.mockRestore();
    }
  });

  it('the back button folds an empty field, and leaves a field with text to the tab', async () => {
    const addListener = jest.spyOn(BackHandler, 'addEventListener');
    const blur = jest.spyOn(TextInput.prototype, 'blur');
    try {
      await renderDiscover('gece-mavisi', { filtersOpen: false });
      // Folded, back is not taken.
      expect(backHandlers(addListener)).toHaveLength(0);

      openSearch();
      let handlers = backHandlers(addListener);
      expect(handlers).toHaveLength(1);
      let handled = false;
      act(() => {
        handled = handlers[0]();
      });
      expect(handled).toBe(true);
      expect(searchIsOpen()).toBe(false);
      expect(blur).toHaveBeenCalled();

      // Blurred and holding only blanks, it is empty: back folds it and
      // drops the blanks.
      openSearch();
      fireEvent.changeText(input(), '   ');
      fireEvent(input(), 'blur');
      handlers = backHandlers(addListener);
      act(() => {
        handled = handlers[handlers.length - 1]();
      });
      expect(handled).toBe(true);
      expect(searchIsOpen()).toBe(false);
      expect(screen.getByTestId('discover-search', hidden).props.value).toBe('');

      await typeAndWait('kaz');
      handlers = backHandlers(addListener);
      act(() => {
        handled = handlers[handlers.length - 1]();
      });
      expect(handled).toBe(false);
      expect(searchIsOpen()).toBe(true);
      expect(input().props.value).toBe('kaz');
    } finally {
      addListener.mockRestore();
      blur.mockRestore();
    }
  });

  it('the clear tile empties the field and keeps it open, focused or not; empty, the close tile folds it', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    try {
      await renderDiscover('gece-mavisi', { filtersOpen: false });
      await typeAndWait('kaz');
      fireEvent.press(screen.getByRole('button', { name: 'Aramayı temizle' }));
      await flush();
      // Open and empty, with the close tile in the clear tile's place.
      expect(searchIsOpen()).toBe(true);
      expect(input().props.value).toBe('');
      expect(screen.getByText('12 masal bulundu')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Aramayı temizle' })).toBeNull();
      timing.mockClear();
      fireEvent.press(screen.getByRole('button', { name: 'Aramayı kapat' }));
      expect(searchIsOpen()).toBe(false);
      expect(screen.getByRole('button', { name: 'Aramayı aç' })).toBeOnTheScreen();
      expect(timing).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ toValue: 0, duration: DURATION.exit, useNativeDriver: true }),
      );

      // A term left after the keyboard went away: the clear tile drops it
      // and the field stays open, empty, until its close tile.
      await typeAndWait('grimm');
      fireEvent(input(), 'blur');
      expect(searchIsOpen()).toBe(true);
      fireEvent.press(screen.getByRole('button', { name: 'Aramayı temizle' }));
      await flush();
      expect(searchIsOpen()).toBe(true);
      expect(input().props.value).toBe('');
      expect(mockDiscoverStore.query).toBe('');
      fireEvent.press(screen.getByRole('button', { name: 'Aramayı kapat' }));
      expect(searchIsOpen()).toBe(false);
    } finally {
      timing.mockRestore();
    }
  });

  it('empties but stays open when the store drops the term (a category from Home)', async () => {
    await renderDiscover('gece-mavisi', { filtersOpen: false });
    await typeAndWait('kaz');
    fireEvent(input(), 'blur');
    act(() => {
      mockDiscoverStore.showCategory('TURKISH_CLASSICS');
    });
    await flush();
    expect(searchIsOpen()).toBe(true);
    expect(input().props.value).toBe('');
  });

  it('opens with the field shown for a term kept from an earlier visit', async () => {
    act(() => {
      mockDiscoverStore.setQuery('kaz');
    });
    await renderDiscover('gece-mavisi', { filtersOpen: false });
    expect(searchIsOpen()).toBe(true);
    expect(input().props.value).toBe('kaz');
  });

  it('under reduced motion the field opens at once, with a short fade', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const timing = jest.spyOn(Animated, 'timing');
    try {
      await renderDiscover('gece-mavisi', { filtersOpen: false });
      measureOverlay();
      timing.mockClear();
      openSearch();
      expect(translateX('discover-search-mask')).toBe(0);
      expect(translateX('discover-search-slide')).toBe(0);
      expect(timing).toHaveBeenCalledTimes(1);
      expect(timing).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ toValue: 1, duration: DURATION.fast, useNativeDriver: true }),
      );
    } finally {
      timing.mockRestore();
      jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockRestore();
    }
  });

  it('is translated to English', async () => {
    await i18n.changeLanguage('en');
    try {
      await renderDiscover('gece-mavisi', { filtersOpen: false });
      fireEvent.press(screen.getByRole('button', { name: 'Open search' }));
      fireEvent(input(), 'focus');
      expect(screen.getByRole('button', { name: 'Close search' })).toBeOnTheScreen();
    } finally {
      await act(async () => {
        await i18n.changeLanguage('tr');
      });
    }
  });

});

describe('states and paging', () => {
  it('shows a grid skeleton while the first page loads, with the result line kept in place', async () => {
    mockGetStories.mockImplementation(() => new Promise(() => undefined));
    await renderDiscover();
    expect(screen.getByTestId('discover-loading', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('discover-count')).toBeNull();
    // The line the count will take is already there, so the grid does not jump.
    expect(flatStyle(screen.getByTestId('discover-result-line'))).toMatchObject({ minHeight: 24 });
  });

  it('keeps the grid undimmed while new results load, with a thin bar in its slot', async () => {
    await renderDiscover();
    expect(screen.queryByTestId('discover-updating')).toBeNull();
    mockGetStories.mockImplementation(() => new Promise(() => undefined));
    await act(async () => {
      void mockDiscoverStore.load();
    });
    expect(screen.getByTestId('discover-updating')).toBeOnTheScreen();
    expect(screen.getByText('Parmak Kız')).toBeOnTheScreen();
    expect(flatStyle(screen.getByTestId('discover-list')).opacity).toBeUndefined();
  });

  it('shows an error with a retry that loads again', async () => {
    mockGetStories.mockRejectedValueOnce(new Error('server'));
    await renderDiscover();
    expect(screen.getByTestId('discover-error')).toBeOnTheScreen();
    expect(screen.getByText('Masallar yüklenemedi')).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    await flush();
    expect(screen.getByText('Parmak Kız')).toBeOnTheScreen();
  });

  it('says the phone is offline when the request never reached the server', async () => {
    mockGetStories.mockRejectedValueOnce(
      new ApiError({ status: 0, code: API_ERROR_CODES.NETWORK, message: 'Network Error' }),
    );
    await renderDiscover();
    expect(screen.getByText('İnternete bağlı değilsin')).toBeOnTheScreen();
    expect(screen.queryByText('Masallar yüklenemedi')).toBeNull();
    expect(screen.getByTestId('icon-wifiOff', { includeHiddenElements: true })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    await flush();
    expect(screen.getByText('Parmak Kız')).toBeOnTheScreen();
  });

  it('shows the empty catalogue state without filters', async () => {
    mockGetStories.mockResolvedValue(pageOf([], 0));
    await renderDiscover();
    expect(screen.getByTestId('discover-empty')).toBeOnTheScreen();
    expect(screen.getByText('Henüz masal yok')).toBeOnTheScreen();
  });

  it('loads the next page at the end of the list', async () => {
    mockGetStories
      .mockReset()
      .mockResolvedValueOnce(pageOf(GROUPED, 4, 1, 2))
      .mockResolvedValueOnce(pageOf([story('s-4', 'Karga ile Testi')], 4, 2, 2));
    await renderDiscover();

    await act(async () => {
      screen.getByTestId('discover-list').props.onEndReached();
    });
    await flush();

    expect(mockGetStories).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(screen.getByText('Karga ile Testi')).toBeOnTheScreen();
  });

  it('refreshes the list and the language options on pull, the spinner at the top of the list', async () => {
    await renderDiscover();
    const refresh = screen.getByTestId('discover-list').props.refreshControl;
    // The list starts under the header row, so the spinner needs no offset.
    expect(refresh.props.progressViewOffset).toBeUndefined();
    await act(async () => {
      await refresh.props.onRefresh();
    });
    expect(mockGetStories).toHaveBeenCalledTimes(2);
    expect(mockContentLanguage.load).toHaveBeenLastCalledWith(true);
  });

  it('a remount with the kept list writes the saves made while it was gone, with no request', async () => {
    const view = await renderDiscover();
    view.unmount();
    recordChange('s-2', true);
    await renderDiscover();
    expect(mockGetStories).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını kaydedilenlerden çıkar' }),
    ).toBeOnTheScreen();
  });

  it('a list unmounted out of view still gets the saves made after its blur', async () => {
    const view = await renderDiscover();
    act(() => setMockFocused(false));
    // Saved on the story page pushed over the tab, then the tab went away.
    recordChange('s-2', true);
    view.unmount();
    setMockFocused(true);
    await renderDiscover();
    expect(mockGetStories).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını kaydedilenlerden çıkar' }),
    ).toBeOnTheScreen();
  });

  it('keeps the list it already has when the tab is opened again', async () => {
    await mockDiscoverStore.load();
    mockGetStories.mockClear();
    await renderDiscover();
    expect(mockGetStories).not.toHaveBeenCalled();
    expect(screen.getByText('Parmak Kız')).toBeOnTheScreen();
  });
});
