/**
 * CollectionsScreen and CollectionDetailScreen in the playful style: row
 * cards on their lip, a Baloo 2 header, the cover grid of Keşfet, the
 * premium lock (free plan only), the content language on every request,
 * states (offline among them), refreshes that keep the rows, saves that
 * never overlap, saved marks caught up on refocus, paging.
 */

import React from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { runInAction } from 'mobx';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { mockNavigation, setMockFocused, setMockRouteParams } from '../../test-utils/mocks/navigation';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { DEFAULT_STORY_EXTRAS, Story } from '../../models/Story';
import { Collection } from '../../models/Collection';
import { ApiError } from '../../services/ApiError';
import { getContentLanguageStore } from '../../hooks/useContentLanguage';
import { AgeGroup, StoryCategory } from '../../types/enums';
import CollectionsScreen, { COLLECTION_ROW_HEIGHT, COLLECTION_SUBTITLE_LINES } from './CollectionsScreen';
import CollectionDetailScreen, { withSavedState } from './CollectionDetailScreen';

jest.setTimeout(60000);

const mockList = jest.fn();
const mockGetBySlug = jest.fn();
const mockGetStories = jest.fn();
jest.mock('../../services/CollectionService', () => ({
  __esModule: true,
  default: {
    list: (...args: unknown[]) => mockList(...args),
    getBySlug: (...args: unknown[]) => mockGetBySlug(...args),
    getStories: (...args: unknown[]) => mockGetStories(...args),
  },
}));

const mockToggleFavorite = jest.fn();
jest.mock('../../services/StoryService', () => ({
  __esModule: true,
  default: { toggleFavorite: (...args: unknown[]) => mockToggleFavorite(...args) },
}));

jest.mock('../../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));
const mockToast = jest.requireMock('../../utils/toast').showToast as {
  success: jest.Mock;
  error: jest.Mock;
  info: jest.Mock;
};

const mockStoryStore = {
  stories: [] as Story[],
  favoriteStories: [] as Story[],
  currentStory: null as (Story & { translations: [] }) | null,
  favoritesVersion: 0,
  favoriteChanges: [] as { version: number; story: { id: string; translationGroupId: string | null }; saved: boolean }[],
  getFavoriteState: jest.fn(() => false),
  toggleFavorite: jest.fn(() => Promise.resolve('done')),
  loadFavorites: jest.fn(() => Promise.resolve()),
  refresh: jest.fn(() => Promise.resolve()),
  peekStory: jest.fn(() => null),
};
jest.mock('../../hooks/useStory', () => ({
  useStory: () => mockStoryStore,
  getStoryStore: () => mockStoryStore,
}));

/** The plan: a plain free-plan stand-in, or a real SubscriptionStore on Mini. */
let mockSubscription: { hasPremiumStories: boolean } = { hasPremiumStories: false };
jest.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => mockSubscription,
}));
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

const collection = (patch: Partial<Collection> = {}): Collection => ({
  id: 'c-1',
  slug: 'uyku-vakti',
  title: 'Uyku vakti',
  subtitle: 'Kısa ve sakin',
  description: 'Günün sonunda dinlenecek sakin masallar.',
  tone: 'ACCENT',
  coverImageUrl: null,
  isActive: true,
  sortOrder: 1,
  storyCount: 2,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...patch,
});

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

/** A promise the test settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await act(async () => undefined);
  await act(async () => undefined);
}

const networkError = () => new ApiError({ message: 'Network Error', status: 0, code: 'NETWORK_ERROR' });

beforeEach(() => {
  mockSubscription = { hasPremiumStories: false };
  mockStoryStore.currentStory = null;
  mockStoryStore.favoritesVersion = 0;
  mockStoryStore.favoriteChanges = [];
  mockList.mockReset().mockResolvedValue([
    collection(),
    collection({ id: 'c-2', slug: 'klasikler', title: 'Klasikler', description: null, storyCount: 7 }),
  ]);
  mockGetBySlug.mockReset().mockResolvedValue(collection());
  mockGetStories
    .mockReset()
    .mockResolvedValue(
      pageOf([story('s-1', 'Uykulu Ay'), story('s-2', 'Düş Toplayan Bulut', { isPremium: true })]),
    );
  mockToggleFavorite.mockReset().mockResolvedValue(undefined);
  mockShowDialog.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  getContentLanguageStore().reset();
});

const setContentLanguage = (code: string) =>
  runInAction(() => {
    getContentLanguageStore().contentLanguage = code;
  });

describe('CollectionsScreen', () => {
  it('lists the collections as row cards with description and story count', async () => {
    renderWithProviders(<CollectionsScreen />);
    await settle();
    expect(screen.getByRole('header', { name: 'Koleksiyonlar' })).toBeOnTheScreen();
    expect(screen.getByText('Uyku vakti')).toBeOnTheScreen();
    expect(screen.getByText('Günün sonunda dinlenecek sakin masallar.')).toBeOnTheScreen();
    // Without a description the subtitle stands in.
    expect(screen.getByText('Kısa ve sakin')).toBeOnTheScreen();
    expect(screen.getByText('2 masal')).toBeOnTheScreen();
    expect(screen.getByText('7 masal')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('collection-row-klasikler'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('CollectionDetail', { slug: 'klasikler' });
    fireEvent.press(screen.getByTestId('appbar-back'));
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });

  it('gives every description two lines, so the rows keep one height', async () => {
    renderWithProviders(<CollectionsScreen />);
    await settle();
    expect(COLLECTION_SUBTITLE_LINES).toBe(2);
    expect(screen.getByText('Günün sonunda dinlenecek sakin masallar.').props.numberOfLines).toBe(2);
    expect(screen.getByText('Kısa ve sakin').props.numberOfLines).toBe(2);
  });

  it('loads in bones of a row card with two lines of description', () => {
    mockList.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<CollectionsScreen />);
    const skeleton = screen.getByTestId('collections-loading', { includeHiddenElements: true });
    const faces = skeleton.findAll(
      (node: { type: unknown; props: { style?: unknown } }) =>
        typeof node.type === 'string' &&
        flatStyle(node).height === COLLECTION_ROW_HEIGHT &&
        flatStyle(node).borderRadius === 20,
    );
    expect(COLLECTION_ROW_HEIGHT).toBe(81);
    expect(faces).toHaveLength(4);
  });

  it('asks for the collections of the content language, and again when it changes', async () => {
    renderWithProviders(<CollectionsScreen />);
    await settle();
    expect(mockList).toHaveBeenCalledWith('tr');

    mockList.mockResolvedValue([collection({ id: 'c-9', slug: 'bedtime', title: 'Bedtime' })]);
    await act(async () => setContentLanguage('en'));
    await settle();
    expect(mockList).toHaveBeenLastCalledWith('en');
    expect(screen.getByText('Bedtime')).toBeOnTheScreen();
    expect(screen.queryByText('Klasikler')).toBeNull();
  });

  it('shows the loading, error (with retry) and empty states', async () => {
    mockList.mockReset().mockRejectedValueOnce(new Error('Ağ hatası'));
    renderWithProviders(<CollectionsScreen />);
    expect(screen.getByTestId('collections-loading')).toBeOnTheScreen();
    await settle();
    expect(screen.getByTestId('collections-error')).toBeOnTheScreen();
    expect(screen.getByText('Koleksiyonlar yüklenemedi')).toBeOnTheScreen();
    expect(screen.getByText('Sorun bizde. Biraz sonra tekrar dene.')).toBeOnTheScreen();

    mockList.mockResolvedValue([]);
    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    await settle();
    expect(screen.getByTestId('collections-empty')).toBeOnTheScreen();
    expect(screen.getByText('Henüz koleksiyon yok')).toBeOnTheScreen();
  });

  it('says it is offline when the first load fails without a connection', async () => {
    mockList.mockReset().mockRejectedValueOnce(networkError());
    renderWithProviders(<CollectionsScreen />);
    await settle();
    expect(screen.getByText('İnternete bağlı değilsin')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('collections-error')).getByTestId('icon-wifiOff', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });

  it('a failed pull-to-refresh keeps the list and says so in a snackbar', async () => {
    renderWithProviders(<CollectionsScreen />);
    await settle();
    mockList.mockRejectedValueOnce(new ApiError({ message: 'Sunucu hatası', status: 500 }));
    await act(async () => {
      screen.getByTestId('collections-scroll').props.refreshControl.props.onRefresh();
    });
    await settle();
    expect(screen.getByText('Uyku vakti')).toBeOnTheScreen();
    expect(screen.queryByTestId('collections-error')).toBeNull();
    expect(mockToast.error).toHaveBeenCalledWith('Koleksiyonlar yüklenemedi');
    expect(screen.getByTestId('collections-scroll').props.refreshControl.props.refreshing).toBe(false);

    // Offline, the snackbar says that.
    mockList.mockRejectedValueOnce(networkError());
    await act(async () => {
      screen.getByTestId('collections-scroll').props.refreshControl.props.onRefresh();
    });
    await settle();
    expect(mockToast.error).toHaveBeenLastCalledWith('İnternete bağlı değilsin');
    expect(screen.getByText('Klasikler')).toBeOnTheScreen();
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('follows the %s theme', async theme => {
    renderWithProviders(<CollectionsScreen />, { theme });
    await settle();
    const T = themes[theme];
    expect(flatStyle(screen.getByText('Uyku vakti')).color).toBe(T.text);
    // A card on its lip, not a hairline row.
    expect(flatStyle(screen.getByTestId('collection-row-uyku-vakti-face')).backgroundColor).toBe(
      T.surface,
    );
    expect(flatStyle(screen.getByTestId('collection-row-uyku-vakti-lip')).backgroundColor).toBe(T.lip);
  });

  it('is translated to English', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<CollectionsScreen />);
    await settle();
    expect(screen.getByRole('header', { name: 'Collections' })).toBeOnTheScreen();
    expect(screen.getByText('7 stories')).toBeOnTheScreen();
  });
});

describe('withSavedState', () => {
  const rows = [
    story('a', 'A', { translationGroupId: 'tale-1' }),
    story('b', 'B', { translationGroupId: 'tale-1', language: 'en' }),
    story('c', 'C'),
  ];

  it('writes a saved state into the tale and its other language rows', () => {
    const next = withSavedState(rows, { id: 'a', translationGroupId: 'tale-1' }, true);
    expect(next.map(row => [row.id, row.isFavorite, row.isFavoriteAnyLanguage])).toEqual([
      ['a', true, true],
      ['b', false, true],
      ['c', false, false],
    ]);
  });

  it('keeps the same list when nothing changes', () => {
    expect(withSavedState(rows, { id: 'c', translationGroupId: null }, false)).toBe(rows);
    expect(withSavedState(rows, { id: 'zz', translationGroupId: null }, true)).toBe(rows);
  });
});

describe('CollectionDetailScreen', () => {
  beforeEach(() => setMockRouteParams({ slug: 'uyku-vakti' }));

  it('shows the count, the Baloo 2 title, the description and the stories in the grid', async () => {
    renderWithProviders(<CollectionDetailScreen />);
    await settle();
    expect(mockGetBySlug).toHaveBeenCalledWith('uyku-vakti', 'tr');
    expect(mockGetStories).toHaveBeenCalledWith('uyku-vakti', 1, 20, 'tr');
    expect(screen.getByText('2 masal')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Uyku vakti' })).toBeOnTheScreen();
    expect(screen.getByText('Günün sonunda dinlenecek sakin masallar.')).toBeOnTheScreen();
    expect(screen.getByText('Uykulu Ay')).toBeOnTheScreen();
    expect(screen.getByTestId('story-card-s-1')).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Uykulu Ay masalını aç' }));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-1' });
  });

  it('draws the loading header in the line boxes of the real header', async () => {
    const pending = deferred<Collection>();
    mockGetBySlug.mockReset().mockReturnValue(pending.promise);
    renderWithProviders(<CollectionDetailScreen />);
    const box = (id: string) => flatStyle(screen.getByTestId(id, { includeHiddenElements: true }));
    const loading = {
      count: box('collection-loading-count'),
      title: box('collection-loading-title'),
      description: box('collection-loading-description'),
    };
    await act(async () => pending.resolve(collection()));
    await settle();
    const count = flatStyle(screen.getByText('2 masal'));
    const title = flatStyle(screen.getByRole('header', { name: 'Uyku vakti' }));
    const description = flatStyle(screen.getByText('Günün sonunda dinlenecek sakin masallar.'));
    expect(loading.count.height).toBe(count.lineHeight);
    expect(loading.title).toMatchObject({ height: title.lineHeight, marginTop: title.marginTop });
    expect(loading.description).toMatchObject({
      height: description.lineHeight,
      marginTop: description.marginTop,
    });
  });

  it('asks in the content language for both requests and the next pages', async () => {
    setContentLanguage('en');
    mockGetStories
      .mockReset()
      .mockResolvedValueOnce(pageOf([story('s-1', 'Sleepy Moon')], 1, 2))
      .mockResolvedValueOnce(pageOf([story('s-3', 'Thumbelina')], 2, 2));
    renderWithProviders(<CollectionDetailScreen />);
    await settle();
    expect(mockGetBySlug).toHaveBeenCalledWith('uyku-vakti', 'en');
    expect(mockGetStories).toHaveBeenCalledWith('uyku-vakti', 1, 20, 'en');
    await act(async () => {
      screen.getByTestId('collection-list').props.onEndReached();
    });
    await settle();
    expect(mockGetStories).toHaveBeenLastCalledWith('uyku-vakti', 2, 20, 'en');
    expect(screen.getByText('Thumbelina')).toBeOnTheScreen();
  });

  it('locks premium stories on the free plan and explains the plans', async () => {
    renderWithProviders(<CollectionDetailScreen />);
    await settle();
    expect(screen.getByText('Premium')).toBeOnTheScreen();
    expect(screen.getByTestId('icon-lock', { includeHiddenElements: true })).toBeOnTheScreen();
    // A locked card has no bookmark.
    expect(screen.queryByRole('button', { name: 'Düş Toplayan Bulut masalını kaydet' })).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Düş Toplayan Bulut, Premium, kilitli' }));
    expect(mockNavigation.navigate).not.toHaveBeenCalledWith('StoryDetail', { storyId: 's-2' });
    const dialog = mockShowDialog.mock.calls[0][0];
    expect(dialog.title).toBe('Bu masal ücretli planlarda');
    expect(dialog.message).toBe('Mini ya da Premium planla dinleyebilirsin.');
    expect(dialog.buttons.map((button: { text: string }) => button.text)).toEqual([
      'Planları gör',
      'Vazgeç',
    ]);
    dialog.buttons[0].onPress();
    // One plans screen in the stack, however it is reached.
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Subscription', { reason: 'premiumStory' }, { pop: true });
  });

  it('opens premium stories on the Mini plan (a paid plan, like Premium)', async () => {
    mockSubscription = miniPlan();
    renderWithProviders(<CollectionDetailScreen />);
    await settle();
    expect(screen.queryByTestId('icon-lock', { includeHiddenElements: true })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Düş Toplayan Bulut masalını aç' }));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-2' });
    expect(mockShowDialog).not.toHaveBeenCalled();
  });

  it('saves a story with the snackbar, "Göster" goes back to the one Main, and a failure rolls back', async () => {
    renderWithProviders(<CollectionDetailScreen />);
    await settle();
    fireEvent.press(screen.getByRole('button', { name: 'Uykulu Ay masalını kaydet' }));
    await settle();
    expect(mockToggleFavorite).toHaveBeenCalledWith('s-1', true);
    expect(mockToast.success).toHaveBeenCalledWith(
      'Uykulu Ay kaydedildi',
      undefined,
      expect.objectContaining({ label: 'Göster' }),
    );
    mockToast.success.mock.calls[0][2].onPress();
    expect(mockNavigation.popTo).toHaveBeenCalledWith('Main', { screen: 'Library' });
    expect(mockNavigation.navigate).not.toHaveBeenCalledWith('Main', expect.anything());

    mockToggleFavorite.mockRejectedValueOnce(new Error('offline'));
    fireEvent.press(
      screen.getByRole('button', { name: 'Uykulu Ay masalını kaydedilenlerden çıkar' }),
    );
    await settle();
    expect(mockToast.error).toHaveBeenCalledWith('Kayıt kaldırılamadı. Tekrar dene.');
    expect(
      screen.getByRole('button', { name: 'Uykulu Ay masalını kaydedilenlerden çıkar' }),
    ).toBeOnTheScreen();
  });

  it('never sends two saves of one story at once: a tap while one runs is sent after it', async () => {
    const first = deferred<void>();
    mockToggleFavorite.mockReturnValueOnce(first.promise);
    renderWithProviders(<CollectionDetailScreen />);
    await settle();
    fireEvent.press(screen.getByRole('button', { name: 'Uykulu Ay masalını kaydet' }));
    await settle();
    // The second tap shows at once but waits for the first request.
    fireEvent.press(
      screen.getByRole('button', { name: 'Uykulu Ay masalını kaydedilenlerden çıkar' }),
    );
    await settle();
    expect(screen.getByRole('button', { name: 'Uykulu Ay masalını kaydet' })).toBeOnTheScreen();
    expect(mockToggleFavorite).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve());
    await settle();
    expect(mockToggleFavorite.mock.calls).toEqual([
      ['s-1', true],
      ['s-1', false],
    ]);
    expect(screen.getByRole('button', { name: 'Uykulu Ay masalını kaydet' })).toBeOnTheScreen();
    // One message, for the state that stuck, with an undo that saves again.
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalledTimes(1);
    expect(mockToast.info).toHaveBeenCalledWith(
      'Uykulu Ay kaydedilenlerden çıkarıldı',
      undefined,
      expect.objectContaining({ label: 'Geri al' }),
    );
    await act(async () => mockToast.info.mock.calls[0][2].onPress());
    await settle();
    expect(mockToggleFavorite).toHaveBeenLastCalledWith('s-1', true);
    expect(
      screen.getByRole('button', { name: 'Uykulu Ay masalını kaydedilenlerden çıkar' }),
    ).toBeOnTheScreen();
  });

  it('shows a save made on the story page when it is back in view, with no request', async () => {
    renderWithProviders(<CollectionDetailScreen />);
    await settle();
    expect(screen.getByRole('button', { name: 'Uykulu Ay masalını kaydet' })).toBeOnTheScreen();

    act(() => setMockFocused(false));
    mockStoryStore.currentStory = {
      ...story('s-1', 'Uykulu Ay', { isFavorite: true, isFavoriteAnyLanguage: true }),
      translations: [],
    };
    act(() => setMockFocused(true));
    await settle();
    expect(
      screen.getByRole('button', { name: 'Uykulu Ay masalını kaydedilenlerden çıkar' }),
    ).toBeOnTheScreen();
    expect(mockGetStories).toHaveBeenCalledTimes(1);
    expect(mockGetBySlug).toHaveBeenCalledTimes(1);
  });

  it('never lets an old story page copy undo the rows or a later unsave', async () => {
    // A story page seen before the collection opened: older than its rows.
    mockStoryStore.currentStory = {
      ...story('s-1', 'Uykulu Ay', { isFavorite: false, isFavoriteAnyLanguage: true }),
      translations: [],
    };
    renderWithProviders(<CollectionDetailScreen />);
    await settle();
    act(() => setMockFocused(false));
    act(() => setMockFocused(true));
    await settle();
    expect(screen.getByRole('button', { name: 'Uykulu Ay masalını kaydet' })).toBeOnTheScreen();

    // The story page saved it (a new copy), then another list unsaved it.
    act(() => setMockFocused(false));
    mockStoryStore.currentStory = {
      ...story('s-1', 'Uykulu Ay', { isFavorite: true, isFavoriteAnyLanguage: true }),
      translations: [],
    };
    mockStoryStore.favoritesVersion = 1;
    mockStoryStore.favoriteChanges = [{ version: 1, story: { id: 's-1', translationGroupId: null }, saved: false }];
    act(() => setMockFocused(true));
    await settle();
    expect(screen.getByRole('button', { name: 'Uykulu Ay masalını kaydet' })).toBeOnTheScreen();

    // Back in view again with nothing new: the unsave stays.
    act(() => setMockFocused(false));
    act(() => setMockFocused(true));
    await settle();
    expect(screen.getByRole('button', { name: 'Uykulu Ay masalını kaydet' })).toBeOnTheScreen();
    expect(mockGetStories).toHaveBeenCalledTimes(1);
  });

  it('catches up with saves made on other screens meanwhile', async () => {
    mockGetStories.mockResolvedValue(pageOf([story('s-1', 'Uykulu Ay'), story('s-5', 'Gece Kuşu')]));
    renderWithProviders(<CollectionDetailScreen />);
    await settle();
    act(() => setMockFocused(false));
    mockStoryStore.favoritesVersion = 2;
    mockStoryStore.favoriteChanges = [
      { version: 1, story: { id: 's-5', translationGroupId: null }, saved: true },
      { version: 2, story: { id: 's-9', translationGroupId: null }, saved: true },
    ];
    act(() => setMockFocused(true));
    await settle();
    expect(screen.getByRole('button', { name: 'Gece Kuşu masalını kaydedilenlerden çıkar' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Uykulu Ay masalını kaydet' })).toBeOnTheScreen();
    expect(mockGetStories).toHaveBeenCalledTimes(1);
  });

  it('loads further pages, and says so when the collection is empty', async () => {
    mockGetStories
      .mockReset()
      .mockResolvedValueOnce(pageOf([story('s-1', 'Uykulu Ay')], 1, 2))
      .mockResolvedValueOnce(pageOf([story('s-3', 'Parmak Kız')], 2, 2));
    const view = renderWithProviders(<CollectionDetailScreen />);
    await settle();
    await act(async () => {
      screen.getByTestId('collection-list').props.onEndReached();
    });
    await settle();
    expect(mockGetStories).toHaveBeenLastCalledWith('uyku-vakti', 2, 20, 'tr');
    expect(screen.getByText('Parmak Kız')).toBeOnTheScreen();
    view.unmount();

    mockGetStories.mockReset().mockResolvedValue(pageOf([]));
    renderWithProviders(<CollectionDetailScreen />);
    await settle();
    expect(screen.getByText('Bu koleksiyonda henüz masal yok.')).toBeOnTheScreen();
  });

  it('a failed next page keeps the stories, and the next end of the list tries again', async () => {
    mockGetStories
      .mockReset()
      .mockResolvedValueOnce(pageOf([story('s-1', 'Uykulu Ay')], 1, 2))
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(pageOf([story('s-3', 'Parmak Kız')], 2, 2));
    renderWithProviders(<CollectionDetailScreen />);
    await settle();
    await act(async () => {
      screen.getByTestId('collection-list').props.onEndReached();
    });
    await settle();
    expect(screen.getByText('Uykulu Ay')).toBeOnTheScreen();
    expect(screen.queryByTestId('collection-error')).toBeNull();
    await act(async () => {
      screen.getByTestId('collection-list').props.onEndReached();
    });
    await settle();
    expect(mockGetStories).toHaveBeenCalledTimes(3);
    expect(mockGetStories).toHaveBeenLastCalledWith('uyku-vakti', 2, 20, 'tr');
    expect(screen.getByText('Parmak Kız')).toBeOnTheScreen();
  });

  it('a failed pull-to-refresh keeps the collection and says so in a snackbar', async () => {
    renderWithProviders(<CollectionDetailScreen />);
    await settle();
    mockGetBySlug.mockRejectedValueOnce(new ApiError({ message: 'Sunucu hatası', status: 500 }));
    await act(async () => {
      screen.getByTestId('collection-list').props.refreshControl.props.onRefresh();
    });
    await settle();
    expect(screen.getByRole('header', { name: 'Uyku vakti' })).toBeOnTheScreen();
    expect(screen.getByText('Uykulu Ay')).toBeOnTheScreen();
    expect(screen.queryByTestId('collection-error')).toBeNull();
    expect(mockToast.error).toHaveBeenCalledWith('Koleksiyon yüklenemedi');
    expect(screen.getByTestId('collection-list').props.refreshControl.props.refreshing).toBe(false);
  });

  it('shows an error with retry when the collection cannot be loaded', async () => {
    mockGetBySlug.mockReset().mockRejectedValueOnce(new Error('Bulunamadı'));
    renderWithProviders(<CollectionDetailScreen />);
    expect(screen.getByTestId('collection-loading')).toBeOnTheScreen();
    await settle();
    expect(screen.getByTestId('collection-error')).toBeOnTheScreen();
    expect(screen.getByText('Koleksiyon yüklenemedi')).toBeOnTheScreen();

    mockGetBySlug.mockResolvedValue(collection());
    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    await settle();
    expect(screen.getByRole('header', { name: 'Uyku vakti' })).toBeOnTheScreen();
  });

  it('says it is offline when the collection cannot be reached', async () => {
    mockGetStories.mockReset().mockRejectedValueOnce(networkError());
    renderWithProviders(<CollectionDetailScreen />);
    await settle();
    expect(screen.getByText('İnternete bağlı değilsin')).toBeOnTheScreen();
    expect(screen.getByText('Masalları açmak için bağlantı gerekiyor.')).toBeOnTheScreen();
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('follows the %s theme', async theme => {
    renderWithProviders(<CollectionDetailScreen />, { theme });
    await settle();
    const T = themes[theme];
    expect(flatStyle(screen.getByRole('header', { name: 'Uyku vakti' })).color).toBe(T.text);
    expect(flatStyle(screen.getByRole('header', { name: 'Uyku vakti' })).fontSize).toBe(32);
    expect(flatStyle(screen.getByText('2 masal')).color).toBe(T.text3);
    expect(flatStyle(screen.getByText('Günün sonunda dinlenecek sakin masallar.')).color).toBe(T.text2);
    expect(flatStyle(screen.getByText('Premium')).color).toBe(T.text2);
  });
});
