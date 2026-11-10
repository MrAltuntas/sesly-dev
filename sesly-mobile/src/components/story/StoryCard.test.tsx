/**
 * StoryCard (design/v4/playful, frame b `.grid`): cover with the level
 * badge, title, the category dot and duration, the translation mark, the
 * own language code under a language filter, the bookmark badge over the
 * cover (outside the card button, sinking with the cover), the premium mark
 * and the lock, no long press or queueing on a card, the grid layout, both palettes. Also
 * the save snackbar and its undo.
 */

import React from 'react';
import { Animated, Dimensions } from 'react-native';
import { act, fireEvent, renderHook, screen, within } from '@testing-library/react-native';
import { runInAction } from 'mobx';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { glassRing } from '../../theme/surfaces';
import { DEFAULT_STORY_EXTRAS, EMPTY_STORY_CREDIT, Story } from '../../models/Story';
import { AgeGroup, StoryCategory } from '../../types/enums';
import {
  COVER_BADGE_INSET,
  GRID_COLUMN_GAP,
  GRID_META_GAP,
  GRID_META_LINE_HEIGHT,
  GRID_SKELETON_TITLE_LINES,
  GRID_TITLE_GAP,
  GRID_TITLE_LINE_HEIGHT,
  StoryCard,
  StoryGridSkeleton,
  storyGridLayout,
} from './StoryCard';
import { announceSaveOutcome, resaveStory } from './saveFeedback';
import { coverLip, coverRadius, snackbar } from '../design';
import { useStory } from '../../hooks/useStory';

jest.setTimeout(30000);

const mockToggleFavorite = jest.fn();
jest.mock('../../services/StoryService', () => ({
  __esModule: true,
  default: {
    toggleFavorite: (...args: unknown[]) => mockToggleFavorite(...args),
    getFavoriteStories: jest.fn(() =>
      Promise.resolve({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } }),
    ),
  },
}));

// A card never queues: anything it reached in the queue would show here.
const mockQueueAdd = jest.fn();
jest.mock('../../stores/queueActions', () => ({
  addToQueueWithFeedback: (...args: unknown[]) => mockQueueAdd(...args),
}));

const story = (patch: Partial<Story> = {}): Story => ({
  id: 's-1',
  title: 'Parmak Kız',
  description: null,
  ageGroup: AgeGroup.THREE_TO_SIX,
  category: StoryCategory.WORLD_CLASSICS,
  estimatedDuration: 6,
  coverImageUrl: null,
  isPremium: false,
  isFavorite: false,
  ...DEFAULT_STORY_EXTRAS,
  languageLevel: 'A2',
  availableLanguages: ['tr', 'en'],
  ...patch,
});

type TestNode = { props: Record<string, unknown>; parent: TestNode | null };

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(6).filter(Boolean));

const findStyled = (root: ReturnType<typeof screen.getByTestId>, key: string, value: unknown) =>
  root.findAll((node: { props: { style?: unknown } }) => flatStyle(node)[key] === value);

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
 * A column layout model of a rendered block: fixed and minimum heights,
 * paddings, margins and gaps, a row as tall as its tallest child, absolute
 * layers left out.
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
    const kids = hostChildren(node).filter(kid => flatStyle(kid).position !== 'absolute');
    const heights = kids.map(blockHeight);
    const content =
      style.flexDirection === 'row'
        ? Math.max(0, ...heights)
        : heights.reduce((sum, height) => sum + height, 0) +
          (style.rowGap ?? style.gap ?? 0) * Math.max(0, kids.length - 1);
    box = Math.max(style.minHeight ?? 0, padTop + content + padBottom);
  }
  return marginTop + box + marginBottom;
}

const isInside = (node: TestNode, ancestor: TestNode) => {
  for (let at: TestNode | null = node.parent; at; at = at.parent) if (at === ancestor) return true;
  return false;
};

/** Every Animated.timing lands at once, so a press shows its end state. */
function landTimingsAtOnce() {
  return jest.spyOn(Animated, 'timing').mockImplementation(((
    value: Animated.Value,
    config: { toValue: number },
  ) => ({
    start: (done?: (result: { finished: boolean }) => void) => {
      value.setValue(config.toValue);
      done?.({ finished: true });
    },
    stop: () => undefined,
    reset: () => undefined,
  })) as unknown as typeof Animated.timing);
}

beforeEach(() => {
  mockToggleFavorite.mockReset().mockResolvedValue(undefined);
  mockQueueAdd.mockReset();
});

describe('storyGridLayout', () => {
  it('fits three 96dp columns on a 360dp phone and shares wider screens evenly', () => {
    expect(storyGridLayout(320)).toEqual({ columns: 3, cardWidth: 98 });
    expect(storyGridLayout(312)).toEqual({ columns: 3, cardWidth: 96 });
    // Never fewer than three columns.
    expect(storyGridLayout(260).columns).toBe(3);
    const wide = storyGridLayout(700);
    expect(wide.columns).toBe(6);
    expect(wide.cardWidth * wide.columns + GRID_COLUMN_GAP * (wide.columns - 1)).toBeLessThanOrEqual(700);
  });
});

describe('StoryCard', () => {
  it('shows the title, the level and duration badges on the cover and the category meta', () => {
    renderWithProviders(<StoryCard story={story()} width={96} onPress={() => {}} />);
    expect(screen.getByText('Parmak Kız')).toBeOnTheScreen();
    expect(screen.getByText('A2')).toBeOnTheScreen();
    expect(screen.getByTestId('cover-level')).toBeOnTheScreen();
    expect(within(screen.getByTestId('cover-duration')).getByText('6 dk')).toBeOnTheScreen();
    expect(screen.getByText('Dünya klasiği')).toBeOnTheScreen();
    // One card per tale: no language code.
    expect(screen.queryByLabelText(/Diller/)).toBeNull();
  });

  it('draws no level badge when the story has no level', () => {
    renderWithProviders(
      <StoryCard story={story({ languageLevel: null })} width={96} onPress={() => {}} />,
    );
    expect(screen.queryByTestId('cover-level')).toBeNull();
  });

  it('shows one filled code for its own language under a language filter', () => {
    renderWithProviders(
      <StoryCard story={story({ language: 'en' })} languages="own" width={96} onPress={() => {}} />,
    );
    // The code is read as part of the card, not as a stop of its own.
    expect(screen.getByRole('button', { name: 'Parmak Kız masalını aç, Diller: EN' })).toBeOnTheScreen();
    expect(screen.queryByLabelText('Diller: EN')).toBeNull();
    expect(screen.queryByText('TR')).toBeNull();
  });

  it('marks only machine translations, never human ones', () => {
    const { rerender } = renderWithProviders(
      <StoryCard
        story={story({ credit: { ...EMPTY_STORY_CREDIT, translationMethod: 'HUMAN' } })}
        width={96}
        onPress={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Parmak Kız masalını aç' })).toBeOnTheScreen();
    expect(screen.queryByText('Çeviri')).toBeNull();
    expect(screen.queryByText('Yapay zekâ ile çevrildi')).toBeNull();
    expect(screen.queryByLabelText('Çeviri')).toBeNull();
    rerender(
      <StoryCard
        story={story({ credit: { ...EMPTY_STORY_CREDIT, translationMethod: 'MACHINE' } })}
        width={96}
        onPress={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Parmak Kız masalını aç, Yapay zekâ ile çevrildi' })).toBeOnTheScreen();
    // The mark is on the cover (bottom right, glass), as on the Home shelves,
    // not in the meta row under the title.
    const cover = screen.getByTestId('story-card-s-1-open-cover');
    expect(within(cover).getByTestId('cover-translation')).toBeOnTheScreen();
    expect(within(screen.getByTestId('story-card-s-1-open-meta')).queryByTestId('icon-aiTranslation', { includeHiddenElements: true })).toBeNull();
  });

  it('opens the story and toggles the bookmark separately, each with the story', () => {
    const onPress = jest.fn();
    const onToggleSave = jest.fn();
    const tale = story();
    renderWithProviders(<StoryCard story={tale} width={96} onPress={onPress} onToggleSave={onToggleSave} />);

    fireEvent.press(screen.getByRole('button', { name: 'Parmak Kız masalını aç' }));
    expect(onPress).toHaveBeenCalledWith(tale);
    expect(onToggleSave).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'Parmak Kız masalını kaydet' }));
    expect(onToggleSave).toHaveBeenCalledWith(tale);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('puts the bookmark badge 4dp in from the top right corner, outside the card button', () => {
    renderWithProviders(<StoryCard story={story()} width={98} onPress={() => {}} onToggleSave={() => {}} />);
    const save = screen.getByRole('button', { name: 'Parmak Kız masalını kaydet' });
    expect(save.props.testID).toBe('story-card-s-1-save');
    expect(flatStyle(save)).toMatchObject({
      position: 'absolute',
      top: COVER_BADGE_INSET,
      right: COVER_BADGE_INSET,
      width: 28,
      height: 28,
    });
    expect(COVER_BADGE_INSET).toBe(4);
    // A 28dp circle, no lip; its own screen reader stop beside the card button.
    expect(flatStyle(screen.getByTestId('story-card-s-1-save-face'))).toMatchObject({ width: 28, borderRadius: 14 });
    expect(screen.queryByTestId('story-card-s-1-save-lip')).toBeNull();
    const card = screen.getByTestId('story-card-s-1-open') as unknown as TestNode;
    expect(isInside(save as unknown as TestNode, card)).toBe(false);
    expect(
      isInside(save as unknown as TestNode, screen.getByTestId('story-card-s-1-open-overlay') as unknown as TestNode),
    ).toBe(true);
    // The overlay covers the cover's face at its 20dp corner.
    expect(coverRadius(98, 'upright')).toBe(20);
    expect(flatStyle(screen.getByTestId('story-card-s-1-open-overlay'))).toMatchObject({ width: 98, height: 147 });
  });

  it('sinks the bookmark with the cover while the card is held', () => {
    landTimingsAtOnce();
    renderWithProviders(<StoryCard story={story()} width={98} onPress={() => {}} onToggleSave={() => {}} />);
    const overlayY = () => flatStyle(screen.getByTestId('story-card-s-1-open-overlay')).transform;
    expect(overlayY()).toEqual([{ translateY: 0 }]);
    fireEvent(screen.getByTestId('story-card-s-1-open'), 'pressIn');
    expect(overlayY()).toEqual([{ translateY: 3 }]);
    expect(flatStyle(screen.getByTestId('story-card-s-1-open-cover-picture')).transform).toEqual([{ translateY: 3 }]);
    fireEvent(screen.getByTestId('story-card-s-1-open'), 'pressOut');
    expect(overlayY()).toEqual([{ translateY: 0 }]);
  });

  it('has no bookmark without a handler', () => {
    renderWithProviders(<StoryCard story={story()} width={96} onPress={() => {}} />);
    expect(screen.queryByTestId('story-card-s-1-save')).toBeNull();
    expect(screen.queryByTestId('story-card-s-1-open-overlay')).toBeNull();
  });

  it('fills the bookmark in the action colour when the tale is saved in any language', () => {
    renderWithProviders(
      <StoryCard
        story={story({ isFavorite: false, isFavoriteAnyLanguage: true })}
        width={96}
        onPress={() => {}}
        onToggleSave={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Parmak Kız masalını kaydedilenlerden çıkar' }),
    ).toBeOnTheScreen();
    const glyph = screen.getByTestId('icon-bookmarkOn', { includeHiddenElements: true });
    const action = themes['gece-mavisi'].action;
    expect(glyph.findAll((node: { props: { color?: unknown } }) => node.props.color === action).length).toBeGreaterThan(0);
  });

  it('marks a premium story quietly and keeps its bookmark when the plan plays it', () => {
    renderWithProviders(
      <StoryCard story={story({ isPremium: true })} width={96} premium onPress={() => {}} onToggleSave={() => {}} />,
    );
    expect(screen.getByText('Premium')).toBeOnTheScreen();
    expect(screen.queryByTestId('icon-lock', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByRole('button', { name: 'Parmak Kız masalını kaydet' })).toBeOnTheScreen();
  });

  it('locks a premium story the plan does not play: the lock, no bookmark, no menu', () => {
    const onPress = jest.fn();
    const onToggleSave = jest.fn();
    renderWithProviders(
      <StoryCard
        story={story({ isPremium: true })}
        width={96}
        premium
        locked
        onPress={onPress}
        onToggleSave={onToggleSave}
      />,
    );
    expect(screen.getByText('Premium')).toBeOnTheScreen();
    expect(screen.getByTestId('icon-lock', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByTestId('story-card-s-1-save')).toBeNull();
    const card = screen.getByRole('button', { name: 'Parmak Kız, Premium, kilitli' });
    expect(card.props.onLongPress).toBeUndefined();
    // The tap still reaches the list, which offers the plans.
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onToggleSave).not.toHaveBeenCalled();
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('uses the %s palette', theme => {
    const T = themes[theme];
    renderWithProviders(
      <StoryCard story={story()} width={96} onPress={() => {}} onToggleSave={() => {}} />,
      { theme },
    );
    expect(flatStyle(screen.getByText('Parmak Kız')).color).toBe(T.text);
    expect(flatStyle(screen.getByText('Dünya klasiği')).color).toBe(T.text3);
    // The category dot of a world classic, and the bookmark badge: an
    // opaque surface disc with a 1dp ring that holds on a night cover.
    const card = screen.getByTestId('story-card-s-1');
    expect(findStyled(card, 'backgroundColor', T.cat.dunya.color).length).toBeGreaterThan(0);
    expect(flatStyle(screen.getByTestId('story-card-s-1-save-face'))).toMatchObject({
      backgroundColor: T.surface,
      borderWidth: 1,
      borderColor: glassRing(T),
    });
    expect(flatStyle(screen.getByTestId('cover-level')).backgroundColor).toBe(T.badge);
  });

  it('is translated to English', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(
      <StoryCard story={story()} width={96} onPress={() => {}} onToggleSave={() => {}} />,
    );
    expect(screen.getByText('6 min')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save Parmak Kız' })).toBeOnTheScreen();
  });

  it('names the paid plans on a premium card in English (Mini plays them too)', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(
      <StoryCard story={story({ isPremium: true })} width={96} premium locked onPress={() => {}} />,
    );
    expect(screen.getByText('Paid plans')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Parmak Kız, Premium, locked' })).toBeOnTheScreen();
  });

  it('is memoised: the same props draw nothing again', () => {
    expect((StoryCard as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });
});

describe('StoryCard has no long press and no queueing (owner feedback, item 8)', () => {
  it('a long press does nothing: no menu, no "Sıraya ekle", no accessibility action', () => {
    const onPress = jest.fn();
    const onToggleSave = jest.fn();
    renderWithProviders(<StoryCard story={story()} width={96} onPress={onPress} onToggleSave={onToggleSave} />);
    const card = screen.getByTestId('story-card-s-1-open');
    expect(card.props.onLongPress).toBeUndefined();
    expect(card.props.accessibilityActions ?? []).toEqual([]);
    fireEvent(card, 'longPress');
    expect(screen.queryByText('Sıraya ekle')).toBeNull();
    expect(screen.queryByTestId('story-card-s-1-menu')).toBeNull();
    expect(screen.queryByTestId('story-option-queue')).toBeNull();
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(onPress).not.toHaveBeenCalled();
    expect(onToggleSave).not.toHaveBeenCalled();
  });

  it('every action a card has is a visible control: the tap opens the story, the bookmark saves', () => {
    const onPress = jest.fn();
    const onToggleSave = jest.fn();
    const tale = story();
    renderWithProviders(<StoryCard story={tale} width={96} onPress={onPress} onToggleSave={onToggleSave} />);
    fireEvent.press(screen.getByRole('button', { name: 'Parmak Kız masalını aç' }));
    expect(onPress).toHaveBeenCalledWith(tale);
    fireEvent.press(screen.getByTestId('story-card-s-1-save'));
    expect(onToggleSave).toHaveBeenCalledWith(tale);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});

describe('StoryGridSkeleton', () => {
  it('draws the asked number of rows with covers on the grid radius', () => {
    renderWithProviders(<StoryGridSkeleton rows={2} testID="skeleton" />);
    const skeleton = screen.getByTestId('skeleton', { includeHiddenElements: true });
    expect(skeleton.children).toHaveLength(2);
    // No top padding of its own: the grid starts where the real one does.
    expect(flatStyle(skeleton).paddingTop).toBeUndefined();
    expect(findStyled(skeleton, 'borderRadius', coverRadius(98, 'upright')).length).toBeGreaterThan(0);
  });

  it('a skeleton card is as tall as a real card with a two-line title, so later rows do not move (V3-06)', () => {
    const T = themes['gece-mavisi'];
    const { cardWidth } = storyGridLayout(Dimensions.get('window').width - T.screenPadH * 2);
    // The real card's text under the cover, as CoverCard draws it.
    const real = renderWithProviders(
      <StoryCard story={story({ languageLevel: null })} width={cardWidth} onPress={jest.fn()} />,
    );
    const title = flatStyle(screen.getByText('Parmak Kız'));
    const metaRow = screen.getByTestId('story-card-s-1-open-meta');
    const metaText = metaRow.findAll((node: HostNode) => node.type === 'Text')[0];
    const meta = { gap: flatStyle(metaRow).marginTop as number, line: flatStyle(metaText).lineHeight as number };
    real.unmount();
    // The constants the skeleton is drawn with are the card's own.
    expect([GRID_TITLE_GAP, GRID_TITLE_LINE_HEIGHT]).toEqual([title.marginTop, title.lineHeight]);
    expect([GRID_META_GAP, GRID_META_LINE_HEIGHT]).toEqual([meta.gap, meta.line]);

    renderWithProviders(<StoryGridSkeleton rows={2} testID="grid" />);
    const grid = screen.getByTestId('grid', { includeHiddenElements: true });
    const [firstRow] = hostChildren(grid);
    const [column] = hostChildren(firstRow);
    const cover = Math.round(cardWidth * 1.5) + coverLip(cardWidth);
    const twoLineCard =
      cover + title.marginTop + GRID_SKELETON_TITLE_LINES * title.lineHeight + meta.gap + meta.line;
    expect(GRID_SKELETON_TITLE_LINES).toBe(2);
    expect(blockHeight(column)).toBe(twoLineCard);
    // Two title bones, 85% and 60% wide, one on each title line, and the meta bone.
    const [, titleBlock, metaBlock] = hostChildren(column);
    const lines = hostChildren(titleBlock);
    expect(lines.map(line => flatStyle(line).height)).toEqual([title.lineHeight, title.lineHeight]);
    expect(lines.map(line => flatStyle(hostChildren(line)[0]).width)).toEqual(['85%', '60%']);
    expect(flatStyle(metaBlock)).toMatchObject({ marginTop: meta.gap, height: meta.line });
    expect(flatStyle(hostChildren(metaBlock)[0]).width).toBe('45%');
  });
});

describe('announceSaveOutcome', () => {
  let show: jest.SpyInstance;
  beforeEach(() => {
    show = jest.spyOn(snackbar, 'show').mockImplementation(() => 0);
  });

  const lastAction = () => show.mock.calls[show.mock.calls.length - 1][0].onAction as () => void;

  it('shows "kaydedildi" with "Göster", which opens the saved list', () => {
    const onShow = jest.fn();
    announceSaveOutcome('saved', story(), false, onShow);
    expect(show).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'Parmak Kız kaydedildi', actionLabel: 'Göster' }),
    );
    lastAction()();
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('says once that saving or removing failed', () => {
    announceSaveOutcome('failed', story(), false, jest.fn());
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'Kaydedilemedi. Tekrar dene.' }));
    announceSaveOutcome('failed', story(), true, jest.fn());
    expect(show).toHaveBeenCalledTimes(2);
    expect(show).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'Kayıt kaldırılamadı. Tekrar dene.' }),
    );
  });

  it('says nothing for a tap that a later tap took over', () => {
    announceSaveOutcome('superseded', story(), false, jest.fn());
    expect(show).not.toHaveBeenCalled();
  });

  it('offers "Geri al" after an unsave, which runs the list\'s own undo', async () => {
    const undo = jest.fn(() => Promise.resolve('saved' as const));
    announceSaveOutcome('removed', story(), true, jest.fn(), undo);
    expect(show).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: 'Parmak Kız kaydedilenlerden çıkarıldı',
        actionLabel: 'Geri al',
      }),
    );
    await act(async () => lastAction()());
    expect(undo).toHaveBeenCalledTimes(1);
    // A working undo says nothing more: the bookmark fills again.
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('says so when the undo fails', async () => {
    announceSaveOutcome('removed', story(), true, jest.fn(), () => Promise.resolve('failed' as const));
    await act(async () => lastAction()());
    expect(show).toHaveBeenCalledTimes(2);
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'Kaydedilemedi. Tekrar dene.' }));
  });

  const storyStore = () => renderHook(() => useStory()).result.current;
  const getFavoriteStories = () =>
    jest.requireMock('../../services/StoryService').default.getFavoriteStories as jest.Mock;

  it('saves the tale again through StoryStore without an undo of its own', async () => {
    const store = storyStore();
    runInAction(() => {
      store.stories = [story()];
    });
    announceSaveOutcome('removed', story(), true, jest.fn());
    await act(async () => lastAction()());
    expect(mockToggleFavorite).toHaveBeenCalledWith('s-1', true);
    // Every copy the store holds is saved again, and lists that follow the
    // change log see it.
    expect(store.getFavoriteState('s-1')).toBe(true);
    expect(store.stories[0].isFavoriteAnyLanguage).toBe(true);
    expect(store.favoriteChanges[store.favoriteChanges.length - 1]).toMatchObject({
      story: { id: 's-1' },
      saved: true,
    });
  });

  it('sends nothing for a tale that is saved again already (a second tap)', async () => {
    const store = storyStore();
    runInAction(() => {
      store.stories = [story({ isFavorite: true, isFavoriteAnyLanguage: true })];
    });
    await expect(resaveStory(story())).resolves.toBe('saved');
    expect(mockToggleFavorite).not.toHaveBeenCalled();
  });

  it('reloads the saved list for a tale the store holds no copy of', async () => {
    const store = storyStore();
    runInAction(() => {
      store.stories = [];
    });
    getFavoriteStories().mockClear();
    let outcome: string | undefined;
    await act(async () => {
      outcome = await resaveStory(story({ id: 's-9' }));
    });
    expect(outcome).toBe('saved');
    expect(mockToggleFavorite).toHaveBeenCalledWith('s-9', true);
    expect(getFavoriteStories()).toHaveBeenCalled();
  });

  it('reports a failed save again and leaves the tale unsaved', async () => {
    const store = storyStore();
    runInAction(() => {
      store.stories = [story({ id: 's-3' })];
    });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockToggleFavorite.mockRejectedValueOnce(new Error('offline'));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await resaveStory(story({ id: 's-3' }));
    });
    expect(outcome).toBe('failed');
    expect(store.getFavoriteState('s-3')).toBe(false);
    // Quiet: the caller says it once.
    expect(show).not.toHaveBeenCalled();
  });
});
