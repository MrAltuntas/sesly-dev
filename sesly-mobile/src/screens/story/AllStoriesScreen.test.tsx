/**
 * AllStoriesScreen ("Yeni eklenenler"): the content language, newest first, the
 * cover grid of Keşfet, saving ("Göster" pops back to Main), saved marks
 * after a story page, premium locks, states, back.
 */

import React from 'react';
import { FlatList } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { mockNavigation, setMockFocused } from '../../test-utils/mocks/navigation';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { DEFAULT_STORY_EXTRAS, Story } from '../../models/Story';
import { AgeGroup, StoryCategory, SubscriptionTier } from '../../types/enums';
import { getSubscriptionStore } from '../../hooks/useSubscription';
import { ApiError, API_ERROR_CODES } from '../../services/ApiError';
import type { FavoriteChange } from '../../hooks/useStory';
import { AllStoriesScreen } from './AllStoriesScreen';

jest.setTimeout(60000);

const mockGetStories = jest.fn();
const mockToggleFavorite = jest.fn();
jest.mock('../../services/StoryService', () => ({
  __esModule: true,
  default: {
    getStories: (...args: unknown[]) => mockGetStories(...args),
    toggleFavorite: (...args: unknown[]) => mockToggleFavorite(...args),
  },
}));

jest.mock('../../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));
const mockToast = jest.requireMock('../../utils/toast').showToast as {
  success: jest.Mock;
  info: jest.Mock;
};

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

const story = (id: string, title: string, patch: Partial<Story> = {}): Story => ({
  id,
  title,
  description: null,
  ageGroup: AgeGroup.THREE_TO_SIX,
  category: StoryCategory.BEDTIME,
  estimatedDuration: 5,
  coverImageUrl: null,
  isPremium: false,
  isFavorite: false,
  ...DEFAULT_STORY_EXTRAS,
  ...patch,
});

const pageOf = (data: Story[], page = 1, totalPages = 1) => ({
  data,
  meta: { page, limit: 20, total: data.length, totalPages },
});

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

/** A save or unsave made on another screen, as StoryStore records it. */
function recordChange(id: string, saved: boolean) {
  mockStoryStore.favoritesVersion += 1;
  mockStoryStore.favoriteChanges = [
    ...mockStoryStore.favoriteChanges,
    { version: mockStoryStore.favoritesVersion, story: { id, translationGroupId: null }, saved },
  ];
}

async function renderAll(theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi') {
  const view = renderWithProviders(<AllStoriesScreen />, { theme, withDialog: true });
  await act(async () => undefined);
  await act(async () => undefined);
  return view;
}

beforeEach(() => {
  mockGetStories
    .mockReset()
    .mockResolvedValue(pageOf([story('s-1', 'Uykulu Ay'), story('s-2', 'Karga ile Testi')]));
  mockToggleFavorite.mockReset().mockResolvedValue(undefined);
  mockStoryStore.favoritesVersion = 0;
  mockStoryStore.favoriteChanges = [];
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  getSubscriptionStore().reset();
});

describe('AllStoriesScreen', () => {
  it('lists the content language in the cover grid, newest first, under a back app bar', async () => {
    await renderAll();
    // The Home shelf it continues: one language, no grouping.
    expect(mockGetStories).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, language: ['tr'], sort: 'newest' }),
    );
    expect(screen.getByRole('header', { name: 'Yeni eklenenler' })).toBeOnTheScreen();
    expect(screen.getByText('Uykulu Ay')).toBeOnTheScreen();
    expect(screen.getByText('Karga ile Testi')).toBeOnTheScreen();
    expect(screen.getByTestId('story-card-s-1')).toBeOnTheScreen();
    expect(screen.UNSAFE_getByType(FlatList).props.numColumns).toBeGreaterThanOrEqual(3);

    fireEvent.press(screen.getByTestId('appbar-back'));
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });

  it('opens a story and saves one; "Göster" pops back to Main on its Kütüphane tab', async () => {
    await renderAll();
    fireEvent.press(screen.getByRole('button', { name: 'Uykulu Ay masalını aç' }));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-1' });

    fireEvent.press(screen.getByRole('button', { name: 'Uykulu Ay masalını kaydet' }));
    await act(async () => undefined);
    await act(async () => undefined);
    expect(mockToggleFavorite).toHaveBeenCalledWith('s-1', true);
    expect(mockToast.success).toHaveBeenCalledWith(
      'Uykulu Ay kaydedildi',
      undefined,
      expect.objectContaining({ label: 'Göster' }),
    );
    mockToast.success.mock.calls[0][2].onPress();
    // Main is below this screen: no second Main is pushed.
    expect(mockNavigation.popTo).toHaveBeenCalledWith('Main', { screen: 'Library' });
    expect(mockNavigation.navigate).not.toHaveBeenCalledWith('Main', expect.anything());
  });

  it('an unsave offers "Geri al", which saves the tale again', async () => {
    mockGetStories
      .mockReset()
      .mockResolvedValue(pageOf([story('s-1', 'Uykulu Ay', { isFavorite: true, isFavoriteAnyLanguage: true })]));
    await renderAll();
    fireEvent.press(screen.getByRole('button', { name: 'Uykulu Ay masalını kaydedilenlerden çıkar' }));
    await act(async () => undefined);
    await act(async () => undefined);
    expect(mockToggleFavorite).toHaveBeenLastCalledWith('s-1', false);
    expect(mockToast.info).toHaveBeenCalledWith(
      'Uykulu Ay kaydedilenlerden çıkarıldı',
      undefined,
      expect.objectContaining({ label: 'Geri al' }),
    );
    await act(async () => {
      mockToast.info.mock.calls[0][2].onPress();
    });
    await act(async () => undefined);
    expect(mockToggleFavorite).toHaveBeenLastCalledWith('s-1', true);
    expect(
      screen.getByRole('button', { name: 'Uykulu Ay masalını kaydedilenlerden çıkar' }),
    ).toBeOnTheScreen();
  });

  it('shows the bookmark saved on a story page when it comes back, with no request', async () => {
    await renderAll();
    expect(mockGetStories).toHaveBeenCalledTimes(1);
    act(() => setMockFocused(false));
    recordChange('s-2', true);
    act(() => setMockFocused(true));
    await act(async () => undefined);

    expect(
      screen.getByRole('button', { name: 'Karga ile Testi masalını kaydedilenlerden çıkar' }),
    ).toBeOnTheScreen();
    const card = screen.getByTestId('story-card-s-2');
    const filled = card.findAll((node: { props: { testID?: string } }) => node.props.testID === 'icon-bookmarkOn');
    expect(filled.length).toBeGreaterThan(0);
    expect(mockGetStories).toHaveBeenCalledTimes(1);
  });

  it('locks a premium story on the free plan and offers the plans', async () => {
    mockGetStories
      .mockReset()
      .mockResolvedValue(pageOf([story('p-1', 'Altın Kaz', { isPremium: true }), story('s-1', 'Uykulu Ay')]));
    await renderAll();
    expect(screen.getByTestId('story-card-p-1-premium')).toBeOnTheScreen();
    expect(screen.getByTestId('icon-lock', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByTestId('story-card-p-1-save')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Altın Kaz, Premium, kilitli' }));
    await act(async () => undefined);
    expect(mockNavigation.navigate).not.toHaveBeenCalledWith('StoryDetail', expect.anything());
    expect(screen.getByText('Bu masal ücretli planlarda')).toBeOnTheScreen();
  });

  it('opens a premium story on Mini', async () => {
    getSubscriptionStore().setTierFromUser(SubscriptionTier.MINI);
    mockGetStories.mockReset().mockResolvedValue(pageOf([story('p-1', 'Altın Kaz', { isPremium: true })]));
    await renderAll();
    expect(screen.getByTestId('story-card-p-1-premium')).toBeOnTheScreen();
    expect(screen.queryByTestId('icon-lock', { includeHiddenElements: true })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Altın Kaz masalını aç' }));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 'p-1' });
  });

  it('says the phone is offline when the list could not be reached', async () => {
    mockGetStories
      .mockReset()
      .mockRejectedValueOnce(new ApiError({ status: 0, code: API_ERROR_CODES.NETWORK, message: 'Network Error' }));
    await renderAll();
    expect(screen.getByTestId('all-stories-error')).toBeOnTheScreen();
    expect(screen.getByText('İnternete bağlı değilsin')).toBeOnTheScreen();
  });

  it('shows a skeleton, then an error with retry, then the empty state', async () => {
    mockGetStories.mockReset().mockRejectedValueOnce(new Error('offline'));
    await renderAll();
    expect(screen.getByTestId('all-stories-error')).toBeOnTheScreen();

    mockGetStories.mockResolvedValue(pageOf([]));
    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    await act(async () => undefined);
    await act(async () => undefined);
    expect(screen.getByTestId('all-stories-empty')).toBeOnTheScreen();
    expect(screen.getByText('Henüz masal yok')).toBeOnTheScreen();
  });

  it('shows the skeleton while loading', async () => {
    mockGetStories.mockReset().mockImplementation(() => new Promise(() => undefined));
    await renderAll();
    expect(screen.getByTestId('all-stories-loading', { includeHiddenElements: true })).toBeTruthy();
  });

  it('pages and refreshes', async () => {
    mockGetStories
      .mockReset()
      .mockResolvedValueOnce(pageOf([story('s-1', 'Uykulu Ay')], 1, 2))
      .mockResolvedValue(pageOf([story('s-3', 'Parmak Kız')], 2, 2));
    await renderAll();
    const list = screen.getByTestId('all-stories-list');
    await act(async () => {
      list.props.onEndReached();
    });
    await act(async () => undefined);
    expect(mockGetStories).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(screen.getByText('Parmak Kız')).toBeOnTheScreen();

    await act(async () => {
      await screen.getByTestId('all-stories-list').props.refreshControl.props.onRefresh();
    });
    expect(mockGetStories).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('follows the %s theme', async theme => {
    await renderAll(theme);
    const T = themes[theme];
    expect(flatStyle(screen.getByText('Uykulu Ay')).color).toBe(T.text);
    expect(flatStyle(screen.getAllByText('Uyku masalı')[0]).color).toBe(T.text3);
    expect(flatStyle(screen.getByTestId('story-card-s-1-save-face')).backgroundColor).toBe(T.surface);
    expect(flatStyle(screen.getByTestId('appbar-back-face')).backgroundColor).toBe(T.surface);
  });

  it('is translated to English', async () => {
    await i18n.changeLanguage('en');
    await renderAll();
    expect(screen.getByRole('header', { name: 'New stories' })).toBeOnTheScreen();
  });
});
