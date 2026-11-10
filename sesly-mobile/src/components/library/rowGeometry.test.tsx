/**
 * Row geometry of the feature components (docs/release-pass/SPEC-design.md
 * 1.4, 1.5; SPEC-audio 9 for the queue): the library row card, SheetRow,
 * the Sesim NarratorRow, SettingRow, the queue row and the plain option rows
 * of the sheets. Each asserts its minimum height, its padding, its corners,
 * its lip (a face with a lip sinks by exactly that lip, a face without one
 * only tints) and, where a row can be chosen, the 2dp ring that is always
 * drawn so choosing never moves the content.
 */

const mockToast = { success: jest.fn(), info: jest.fn(), error: jest.fn(), warning: jest.fn() };
jest.mock('../../utils/toast', () => ({
  get showToast() {
    return mockToast;
  },
}));
jest.mock('../../stores/queuePlayback', () => ({ playQueueFrom: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../services/NarrationService', () => ({
  __esModule: true,
  default: { getNarrationsByStory: jest.fn() },
}));
jest.mock('../../hooks/useStory', () => ({ getStoryStore: () => null }));
jest.mock('../../hooks/useAudioPlayer', () => ({ useAudioPlayer: () => mockAudio }));
jest.mock('../../navigation/navigationRef', () => ({
  navigationRef: { isReady: () => true, dispatch: jest.fn() },
}));

import React from 'react';
import { Animated, Dimensions, StyleSheet, Text } from 'react-native';
import { act, configure, fireEvent, screen } from '@testing-library/react-native';
import { observable, runInAction } from 'mobx';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { LIP, RADIUS, SPACE, textStylesFor, themes } from '../../theme/theme';
import { queueStore } from '../../stores/QueueStore';
import type { NarrationMeta } from '../../stores/narrationMeta';
import { resetNarrationDurationsForTests } from '../../utils/narrationDurations';
import { DEFAULT_STORY_EXTRAS, Story } from '../../models/Story';
import { AgeGroup, StoryCategory } from '../../types/enums';
import {
  LIBRARY_CARD_GAP,
  LIBRARY_CARD_LEADING,
  LIBRARY_CARD_LIP,
  LIBRARY_CARD_MIN_HEIGHT,
  LIBRARY_CARD_PADDING,
  LIBRARY_CARD_RADIUS,
  LibraryRowCard,
} from './LibraryRowCard';
import { LIBRARY_COVER_RADIUS, LIBRARY_COVER_WIDTH, LIBRARY_ROW_HEIGHT } from './NarrationRow';
import { SavedStoryRow } from './SavedStoryRow';
import { SHEET_ROW_MIN_HEIGHT, SheetRow } from '../detail/SheetRow';
import { NarratorAvatar, roundedAvatarRadius } from '../detail/NarratorAvatar';
import { StoryOptionsSheet } from '../detail/StoryOptionsSheet';
import { NarratorRow } from '../voice/VoiceCards';
import { ROW_GAP, ROW_ICON_TILE, ROW_LABEL_INSET, ROW_PAD_H, SettingRow } from '../profile/SettingRow';
import { ChoiceSheet } from '../profile/ChoiceSheet';
import { OPTION_ROW_MIN_HEIGHT, OptionSheet } from '../story/FilterSheets';
import { QUEUE_COVER_SIZE, QUEUE_ROW_GAP, QUEUE_ROW_MIN_HEIGHT, QueueSheet, queueRowHeight } from '../audio/QueueSheet';

jest.setTimeout(60000);

// Sheets put their rows in an accessibilityViewIsModal window beside the scrim.
configure({ defaultIncludeHiddenElements: true });

const mockAudio = observable({
  isPlaying: false,
  audioId: '',
  pendingNarrationId: null as string | null,
  storyEnded: false,
});

const T = themes['gece-mavisi'];
const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

/** Lets every Animated.timing land at once, so a sink or a tint can be read. */
function instantTiming(): jest.SpyInstance {
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

const story = (id: string, patch: Partial<Story> = {}): Story => ({
  id,
  title: `Masal ${id}`,
  description: null,
  ageGroup: AgeGroup.THREE_TO_SIX,
  category: StoryCategory.WORLD_CLASSICS,
  estimatedDuration: 6,
  coverImageUrl: null,
  isPremium: false,
  isFavorite: true,
  ...DEFAULT_STORY_EXTRAS,
  ...patch,
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('library row card', () => {
  it('is a row card: 48dp picture, 12dp padding, at least 72dp, 20dp corners on the 3dp lip', () => {
    expect(LIBRARY_CARD_LEADING).toBe(48);
    expect(LIBRARY_COVER_WIDTH).toBe(LIBRARY_CARD_LEADING);
    expect(LIBRARY_COVER_RADIUS).toBe(RADIUS.md);
    expect(LIBRARY_CARD_PADDING).toBe(SPACE.md);
    expect(LIBRARY_CARD_MIN_HEIGHT).toBe(LIBRARY_CARD_LEADING + 2 * LIBRARY_CARD_PADDING);
    expect(LIBRARY_CARD_MIN_HEIGHT).toBe(72);
    expect(LIBRARY_CARD_RADIUS).toBe(RADIUS.lg);
    expect(LIBRARY_CARD_LIP).toBe(LIP.md);
    // The three text lines are taller than the cover: the real row and its
    // skeleton both use this height, never less than the card minimum.
    expect(LIBRARY_ROW_HEIGHT).toBeGreaterThanOrEqual(LIBRARY_CARD_MIN_HEIGHT);

    renderWithProviders(
      <LibraryRowCard onPress={jest.fn()} accessibilityLabel="Masal" testID="row" trailing={<Text>x</Text>}>
        <Text>Masal</Text>
      </LibraryRowCard>,
    );
    expect(flat(screen.getByTestId('row-face'))).toMatchObject({
      minHeight: 72,
      borderRadius: 20,
      paddingHorizontal: 12,
      gap: 12,
      backgroundColor: T.surface,
    });
    // The pressable body fills the face, so every point of the card opens it.
    expect(flat(screen.getByTestId('row'))).toMatchObject({ paddingVertical: 12, gap: 12, alignSelf: 'stretch' });
    expect(flat(screen.getByTestId('row-lip'))).toMatchObject({ top: LIP.md, borderRadius: 20, backgroundColor: T.lip });
  });

  it('sinks by exactly its lip while pressed and comes back up', () => {
    instantTiming();
    renderWithProviders(
      <LibraryRowCard onPress={jest.fn()} accessibilityLabel="Masal" testID="row">
        <Text>Masal</Text>
      </LibraryRowCard>,
    );
    const face = () => flat(screen.getByTestId('row-face')).transform;
    expect(face()).toEqual([{ translateY: 0 }]);
    fireEvent(screen.getByTestId('row'), 'pressIn');
    expect(face()).toEqual([{ translateY: LIBRARY_CARD_LIP }]);
    fireEvent(screen.getByTestId('row'), 'pressOut');
    expect(face()).toEqual([{ translateY: 0 }]);
  });

  it('a card without a tap is one accessible block that never sinks', () => {
    const timing = instantTiming();
    renderWithProviders(
      <LibraryRowCard accessibilityLabel="Masal" testID="row">
        <Text>Masal</Text>
      </LibraryRowCard>,
    );
    const body = screen.getByTestId('row');
    expect(body.props.accessible).toBe(true);
    expect(body.props.onPress).toBeUndefined();
    fireEvent(body, 'pressIn');
    expect(timing).not.toHaveBeenCalled();
    expect(flat(screen.getByTestId('row-face')).transform).toEqual([{ translateY: 0 }]);
  });

  it('spaces the cards 12dp apart, unless the caller places the card itself', () => {
    renderWithProviders(
      <>
        <LibraryRowCard accessibilityLabel="A" testID="a">
          <Text>A</Text>
        </LibraryRowCard>
        <LibraryRowCard accessibilityLabel="B" testID="b" spaced={false}>
          <Text>B</Text>
        </LibraryRowCard>
      </>,
    );
    const wrap = (id: string) => flat(screen.getByTestId(`${id}-card`));
    expect(LIBRARY_CARD_GAP).toBe(12);
    expect(wrap('a')).toMatchObject({ marginBottom: 12, paddingBottom: LIP.md, marginHorizontal: T.screenPadH });
    expect(wrap('b').marginBottom).toBeUndefined();
  });

  it('a saved row keeps its bookmark target at the card edge, the cover on the 12dp inset', () => {
    renderWithProviders(<SavedStoryRow story={story('s1')} onOpen={jest.fn()} onUnsave={jest.fn()} />);
    const face = flat(screen.getByTestId('library-saved-s1-face'));
    expect(face).toMatchObject({ minHeight: 72, paddingHorizontal: 12, paddingRight: 0, borderRadius: 20 });
  });
});

describe('SheetRow', () => {
  it('is a 64dp row card with 12dp padding inside a 2dp ring that is always drawn', () => {
    expect(SHEET_ROW_MIN_HEIGHT).toBe(ROW_ICON_TILE + 2 * SPACE.md);
    renderWithProviders(
      <>
        <SheetRow title="A" onPress={jest.fn()} testID="plain" />
        <SheetRow title="B" selected onPress={jest.fn()} testID="chosen" />
        <SheetRow title="C" dimmed disabled onPress={jest.fn()} testID="busy" />
      </>,
    );
    const face = (id: string) => flat(screen.getByTestId(`${id}-face`));
    for (const id of ['plain', 'chosen', 'busy']) {
      expect(face(id)).toMatchObject({
        minHeight: 64,
        paddingVertical: 12,
        paddingHorizontal: 12,
        gap: 12,
        borderRadius: 20,
        borderWidth: 2,
        backgroundColor: T.surface2,
      });
    }
    // The ring is clear until chosen; only its colour and the lip's change.
    expect(face('plain').borderColor).toBe('transparent');
    expect(face('chosen').borderColor).toBe(T.action);
    expect(flat(screen.getByTestId('plain-lip')).backgroundColor).toBe(T.lip);
    expect(flat(screen.getByTestId('chosen-lip')).backgroundColor).toBe(T.actionLip);
  });

  it('sinks by its 3dp lip while pressed', () => {
    instantTiming();
    renderWithProviders(<SheetRow title="A" onPress={jest.fn()} testID="row" />);
    fireEvent(screen.getByTestId('row'), 'pressIn');
    expect(flat(screen.getByTestId('row-face')).transform).toEqual([{ translateY: LIP.md }]);
  });

  it('leading tiles take the radius role of their size', () => {
    expect(roundedAvatarRadius(40)).toBe(RADIUS.sm);
    expect(roundedAvatarRadius(48)).toBe(RADIUS.md);
    renderWithProviders(
      <>
        <NarratorAvatar name="Defne" shape="rounded" size={40} testID="tile" />
        <NarratorAvatar name="zeynep" tone="own" shape="rounded" size={48} testID="picture" />
        <NarratorAvatar name="Ayla" testID="circle" />
      </>,
    );
    expect(flat(screen.getByTestId('tile'))).toMatchObject({ width: 40, borderRadius: 12 });
    expect(flat(screen.getByTestId('picture'))).toMatchObject({ width: 48, borderRadius: 16 });
    expect(flat(screen.getByTestId('circle'))).toMatchObject({ width: 40, borderRadius: 20 });
  });

  it('the story options are row cards with the 40dp icon tile', () => {
    renderWithProviders(
      <StoryOptionsSheet
        visible
        onClose={jest.fn()}
        options={[{ key: 'queue', title: 'Sıraya ekle', icon: 'queue', onPress: jest.fn() }]}
      />,
    );
    expect(flat(screen.getByTestId('story-option-queue-tile'))).toMatchObject({
      width: 40,
      height: 40,
      borderRadius: RADIUS.sm,
    });
    expect(flat(screen.getByTestId('story-option-queue-face'))).toMatchObject({ minHeight: 64, paddingVertical: 12 });
  });
});

describe('NarratorRow (Sesim)', () => {
  it('is a 64dp row card: the 40dp tile, 12dp padding, 20dp corners, sinking by its 3dp lip', () => {
    instantTiming();
    renderWithProviders(
      <NarratorRow id="v-1" name="Ayla" line="Türkçe, kadın sesi" onPress={jest.fn()} onTogglePreview={jest.fn()} />,
    );
    expect(flat(screen.getByTestId('narrator-v-1-face'))).toMatchObject({
      minHeight: ROW_ICON_TILE + 2 * SPACE.md,
      paddingHorizontal: 12,
      borderRadius: 20,
    });
    expect(flat(screen.getByTestId('narrator-v-1-lip'))).toMatchObject({ top: LIP.md, borderRadius: 20 });
    expect(flat(screen.getByTestId('narrator-add-v-1'))).toMatchObject({ paddingVertical: 12, gap: 12 });
    expect(flat(screen.getByTestId('narrator-avatar-v-1-tile'))).toMatchObject({ width: 40, borderRadius: 12 });

    fireEvent(screen.getByTestId('narrator-add-v-1'), 'pressIn');
    expect(flat(screen.getByTestId('narrator-v-1-face')).transform).toEqual([{ translateY: LIP.md }]);
  });

  it('a row that only previews never sinks', () => {
    const timing = instantTiming();
    renderWithProviders(<NarratorRow id="v-2" name="Kerem" line="Türkçe" onTogglePreview={jest.fn()} />);
    expect(screen.queryByTestId('narrator-add-v-2')).toBeNull();
    expect(flat(screen.getByTestId('narrator-v-2-face')).transform).toEqual([{ translateY: 0 }]);
    expect(timing).not.toHaveBeenCalled();
  });
});

describe('SettingRow', () => {
  it('is a 56dp setting row with 12dp sides and a 12dp gap, labels at 64', () => {
    expect(ROW_PAD_H).toBe(12);
    expect(ROW_GAP).toBe(12);
    expect(ROW_LABEL_INSET).toBe(ROW_PAD_H + ROW_ICON_TILE + ROW_GAP);
    renderWithProviders(
      <>
        <SettingRow icon="bell" label="Bildirimler" onPress={jest.fn()} testID="row" />
        <SettingRow label="Sürüm" indent testID="indented" />
      </>,
    );
    expect(flat(screen.getByTestId('row-face'))).toMatchObject({
      minHeight: 56,
      paddingHorizontal: 12,
      paddingVertical: 8,
      columnGap: 12,
    });
    expect(flat(screen.getByTestId('row-tile'))).toMatchObject({ width: 40, height: 40, borderRadius: 12 });
    expect(flat(screen.getByTestId('indented')).paddingLeft).toBe(64);
  });

  it('has no lip: a press dims it and never moves it', () => {
    instantTiming();
    renderWithProviders(<SettingRow icon="bell" label="Bildirimler" onPress={jest.fn()} testID="row" />);
    fireEvent(screen.getByTestId('row'), 'pressIn');
    const face = flat(screen.getByTestId('row-face'));
    expect(face.transform).toBeUndefined();
    expect(face.opacity).toBeLessThan(1);
    fireEvent(screen.getByTestId('row'), 'pressOut');
    expect(flat(screen.getByTestId('row-face')).opacity).toBe(1);
  });
});

describe('queue row', () => {
  const MINUTE = 60_000;
  const meta = (id: string): NarrationMeta => ({
    narrationId: id,
    storyId: `story-${id}`,
    voiceProfileId: 'voice-1',
    story: { id: `story-${id}`, title: `Masal ${id}`, coverImageUrl: null, translationGroupId: null, category: null },
    voiceProfile: null,
    narratorName: 'Kerem',
    ownVoice: false,
    estimateMs: 6 * MINUTE,
  });

  beforeEach(() => {
    resetNarrationDurationsForTests();
    queueStore.reset();
    runInAction(() => Object.assign(mockAudio, { isPlaying: false, audioId: '', pendingNarrationId: null, storyEnded: false }));
  });

  it('keeps its own geometry (SPEC-audio 9): 60dp, 8dp padding, 20dp corners, a 64dp pitch', () => {
    const text = textStylesFor(T);
    expect(queueRowHeight(text, 1)).toBe(QUEUE_ROW_MIN_HEIGHT);
    expect(QUEUE_ROW_MIN_HEIGHT + QUEUE_ROW_GAP).toBe(64);
    expect(QUEUE_COVER_SIZE).toBe(ROW_ICON_TILE);
    // A large font grows every row by the same amount, never under the minimum.
    expect(queueRowHeight(text, 1.3)).toBeGreaterThanOrEqual(QUEUE_ROW_MIN_HEIGHT);
  });

  it('the current row is raised on the 3dp lip with the same padding as the flat ones', () => {
    queueStore.add(meta('a'));
    queueStore.add(meta('b'));
    act(() => {
      queueStore.startAt('a');
    });
    runInAction(() => Object.assign(mockAudio, { audioId: 'a', isPlaying: true }));
    renderWithProviders(
      <QueueSheet visible origin="player" onClose={jest.fn()} onOpenPlayer={jest.fn()} onOpenLibrary={jest.fn()} />,
    );
    const height = queueRowHeight(textStylesFor(T), Dimensions.get('window').fontScale);
    const face = (id: string) => flat(screen.getByTestId(`queue-row-${id}-face`));
    for (const id of ['a', 'b']) {
      expect(face(id)).toMatchObject({ minHeight: height, borderRadius: 20, paddingHorizontal: SPACE.sm });
    }
    expect(face('a').backgroundColor).toBe(T.surface2);
    expect(face('b').backgroundColor).toBeUndefined();
    expect(flat(screen.getByTestId('queue-row-a-lip'))).toMatchObject({ top: LIP.md, borderRadius: 20 });
    expect(screen.queryByTestId('queue-row-b-lip')).toBeNull();
  });
});

describe('plain option rows of the sheets', () => {
  it('Keşfet option rows: 56dp, 16dp sides, a 12dp gap, a tint and no lip', () => {
    instantTiming();
    renderWithProviders(
      <OptionSheet
        visible
        onClose={jest.fn()}
        title="Sırala"
        options={[
          { value: 'a', label: 'Önerilen' },
          { value: 'b', label: 'En yeni' },
        ]}
        selected={['a']}
        onSelect={jest.fn()}
        testID="sheet"
      />,
    );
    expect(OPTION_ROW_MIN_HEIGHT).toBe(56);
    for (const id of ['sheet-a', 'sheet-b']) {
      expect(flat(screen.getByTestId(id))).toMatchObject({ minHeight: 56, paddingHorizontal: 16, paddingVertical: 8 });
      expect(flat(screen.getByTestId(`${id}-body`)).gap).toBe(12);
    }
    expect(flat(screen.getByTestId('sheet-a-check'))).toMatchObject({ width: 24, height: 24, borderRadius: 12 });
    fireEvent(screen.getByTestId('sheet-b'), 'pressIn');
    expect(flat(screen.getByTestId('sheet-b-body')).opacity).toBeLessThan(1);
    expect(flat(screen.getByTestId('sheet-b')).transform).toBeUndefined();
  });

  it('choice sheet options: row cards with 12dp padding inside the always-present ring', () => {
    renderWithProviders(
      <ChoiceSheet
        visible
        title="Masal dili"
        options={[
          { value: 'tr', label: 'Türkçe' },
          { value: 'en', label: 'English' },
        ]}
        value="tr"
        onSelect={jest.fn()}
        onClose={jest.fn()}
        testID="choice"
      />,
    );
    const face = (id: string) => flat(screen.getByTestId(`choice-${id}-face`));
    for (const id of ['tr', 'en']) {
      expect(face(id)).toMatchObject({ paddingVertical: 12, paddingHorizontal: 12, borderWidth: 2, borderRadius: 20 });
    }
    expect(face('tr').borderColor).toBe(T.action);
    expect(face('en').borderColor).toBe('transparent');
  });
});
