/**
 * QueueSheet and QueueSheetHost (SPEC-audio 6.5, 6.8): the header and the
 * summary, "Sırayı çal", taps by origin, edit mode, accessibility actions,
 * remove and clear with undo, the empty state, the now-playing bars, the
 * fixed height and the drag. Also the queue's icon glyphs.
 *
 * The queue and the sheet controller are real (memory only, no signed-in
 * user). The audio store is a small observable stand-in, the queue's play
 * function, the snackbar API and the navigation container ref are mocked.
 */

const mockToast = { success: jest.fn(), info: jest.fn(), error: jest.fn(), warning: jest.fn() };
jest.mock('../../utils/toast', () => ({
  get showToast() {
    return mockToast;
  },
}));
const mockPlayQueueFrom = jest.fn((_narrationId?: string) => Promise.resolve(true));
jest.mock('../../stores/queuePlayback', () => ({
  playQueueFrom: (narrationId?: string) => mockPlayQueueFrom(narrationId),
}));
// queueActions (remove with undo) reaches these; nothing here calls them.
jest.mock('../../services/NarrationService', () => ({
  __esModule: true,
  default: { getNarrationsByStory: jest.fn() },
}));
jest.mock('../../hooks/useStory', () => ({ getStoryStore: () => null }));
jest.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => mockAudio,
}));
// Every cover picture that mounts: a restored row must not mount a new one (RC-7).
const mockImageMounts = { count: 0 };
jest.mock('expo-image', () => {
  const React = require('react');
  const actual = jest.requireActual('expo-image');
  const Image = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    React.useEffect(() => {
      mockImageMounts.count += 1;
    }, []);
    return React.createElement(actual.Image, { ...props, ref });
  });
  return { ...actual, Image };
});
const mockDispatch = jest.fn();
jest.mock('../../navigation/navigationRef', () => ({
  navigationRef: {
    isReady: () => true,
    dispatch: (action: unknown) => mockDispatch(action),
  },
}));

import React from 'react';
import { AccessibilityInfo, Animated, Dimensions, Modal, ScrollView, StyleSheet } from 'react-native';
import { act, configure, fireEvent, screen } from '@testing-library/react-native';
import { observable, reaction, runInAction } from 'mobx';
import AsyncStorage from '@react-native-async-storage/async-storage';

import i18n from '../../i18n';
import { renderWithProviders } from '../../test-utils/render-helpers';
import { dockBottom, textStylesFor, themes } from '../../theme/theme';
import { queueStore } from '../../stores/QueueStore';
import { queueSheet, type QueueSheetOrigin } from '../../stores/queueSheet';
import type { NarrationMeta } from '../../stores/narrationMeta';
import {
  NARRATION_DURATIONS_STORAGE_KEY,
  rememberNarrationDuration,
  resetNarrationDurationsForTests,
} from '../../utils/narrationDurations';
import { consumeLibrarySegmentRequest } from '../library/librarySegment';
import { BUTTON_METRICS } from '../design/buttonMetrics';
import { Icon, SKIP_NUMBER_DROP, iconGlyph } from '../design/Icon';
import { snackbar } from '../design/Snackbar';
import { parseStoryNarrationFromJSON } from '../../models/Narration';
import { mockNarrationJSON, mockStoryJSON } from '../../test-utils/mock-data';
import { metaFromNarration } from '../../stores/narrationMeta';
import {
  NOW_PLAYING_BAR_LOW,
  NOW_PLAYING_BAR_MS,
  QUEUE_CONTROL_SIZE,
  QUEUE_EMPTY_ICON_BLOCK,
  QUEUE_GHOST_MS,
  QueueSheet,
  queueButtonLabel,
  queueEmptyIconFits,
  queueEmptyMinHeight,
  queueEmptySnackbarReserve,
  queueRowMeta,
  queueRowPitch,
  queueSheetHeaderHeight,
  queueSheetHeight,
  queueSummaryText,
} from './QueueSheet';
import { QueueSheetHost, openQueueLibrary, openQueuedPlayer } from './QueueSheetHost';

// The rows sit in an accessibilityViewIsModal sheet beside the scrim.
configure({ defaultIncludeHiddenElements: true });

const mockAudio = observable({
  isPlaying: false,
  audioId: '',
  pendingNarrationId: null as string | null,
  storyEnded: false,
});

const text = textStylesFor(themes['gece-mavisi']);
// React Native's jest window: 750 x 1334 at font scale 2.
const WINDOW = Dimensions.get('window');
const PITCH = queueRowPitch(text, WINDOW.fontScale);
const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, number | string | undefined>;
const MINUTE = 60_000;

function meta(id: string, title = `Masal ${id}`, narratorName: string | null = 'Kerem'): NarrationMeta {
  return {
    narrationId: id,
    storyId: `story-${id}`,
    voiceProfileId: 'voice-1',
    story: {
      id: `story-${id}`,
      title,
      coverImageUrl: null,
      translationGroupId: null,
      category: null,
    },
    voiceProfile: null,
    narratorName,
    ownVoice: false,
    estimateMs: 0,
  };
}

/** A queue of these narrations, each `minutes` long (null: length unknown). */
function seed(ids: string[], minutes: number | null = 6): void {
  ids.forEach(id => {
    queueStore.add(meta(id));
    if (minutes !== null) rememberNarrationDuration(id, minutes * MINUTE);
  });
}

const ids = () => queueStore.entries.map(entry => entry.narrationId);

const onClose = jest.fn();
const onOpenPlayer = jest.fn();
const onOpenLibrary = jest.fn();

function renderSheet(origin: QueueSheetOrigin = 'player') {
  return renderWithProviders(
    <QueueSheet
      visible
      origin={origin}
      onClose={onClose}
      onOpenPlayer={onOpenPlayer}
      onOpenLibrary={onOpenLibrary}
    />,
  );
}

function setAudio(state: Partial<typeof mockAudio>): void {
  act(() => {
    runInAction(() => Object.assign(mockAudio, state));
  });
}

function edit(): void {
  fireEvent.press(screen.getByTestId('queue-edit-toggle'));
}

/** A touch event with the history PanResponder reads its gesture from. */
function touch(y: number, previousY: number, timestamp: number) {
  return {
    nativeEvent: { pageX: 0, pageY: y, locationX: 0, locationY: y, timestamp, touches: [], changedTouches: [] },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: timestamp,
      touchBank: [
        {
          touchActive: true,
          startPageX: 0,
          startPageY: 0,
          startTimeStamp: 1,
          currentPageX: 0,
          currentPageY: y,
          currentTimeStamp: timestamp,
          previousPageX: 0,
          previousPageY: previousY,
          previousTimeStamp: timestamp - 1,
        },
      ],
    },
  };
}

beforeEach(async () => {
  queueStore.reset();
  resetNarrationDurationsForTests();
  // The lengths an earlier test stored would come back with the first read,
  // after the render and outside act ('a length that is not known yet').
  await AsyncStorage.removeItem(NARRATION_DURATIONS_STORAGE_KEY);
  runInAction(() => Object.assign(mockAudio, { isPlaying: false, audioId: '', pendingNarrationId: null, storyEnded: false }));
  queueSheet.close();
  Object.values(mockToast).forEach(fn => fn.mockReset());
  mockPlayQueueFrom.mockClear();
  mockDispatch.mockClear();
  onClose.mockClear();
  onOpenPlayer.mockClear();
  onOpenLibrary.mockClear();
  consumeLibrarySegmentRequest();
  await i18n.changeLanguage('tr');
});

afterAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('header and summary', () => {
  it("shows 'Sıradakiler', 'Düzenle' and '3 masal, 18 dk' from the real lengths", () => {
    seed(['a', 'b', 'c']);
    renderSheet();

    expect(screen.getByTestId('sheet-title')).toHaveTextContent('Sıradakiler');
    expect(screen.getByTestId('queue-edit-toggle')).toHaveTextContent('Düzenle');
    expect(screen.getByTestId('queue-summary-text')).toHaveTextContent('3 masal, 18 dk');
  });

  it('a length that is not known yet leaves the minutes out', () => {
    seed(['a', 'b']);
    queueStore.add(meta('c'));
    renderSheet();

    expect(screen.getByTestId('queue-summary-text')).toHaveTextContent('3 masal');
    expect(screen.getByTestId('queue-summary-text')).not.toHaveTextContent(/dk/);
  });

  it("one entry reads '1 story' in English, and it can be edited too (RC-2)", async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    seed(['a']);
    renderSheet();

    expect(screen.getByTestId('sheet-title')).toHaveTextContent('Up next');
    expect(screen.getByTestId('queue-summary-text')).toHaveTextContent('1 story, 6 min');
    expect(screen.getByTestId('queue-edit-toggle')).toHaveTextContent('Edit');
  });

  it("a queue button reads 'Sıradakiler' while the queue is empty, never '0 masal' (RC-4)", async () => {
    expect(queueButtonLabel(0)).toBe('Sıradakiler');
    expect(queueButtonLabel(1)).toBe('Sıradakiler, 1 masal');
    expect(queueButtonLabel(4)).toBe('Sıradakiler, 4 masal');
    await i18n.changeLanguage('en');
    expect(queueButtonLabel(0)).toBe('Up next');
    expect(queueButtonLabel(1)).not.toMatch(/0/);
  });

  it('the summary copy has a singular and a no-time variant in both languages', async () => {
    expect(queueSummaryText(3, 18)).toBe('3 masal, 18 dk');
    expect(queueSummaryText(1, 6)).toBe('1 masal, 6 dk');
    expect(queueSummaryText(2, null)).toBe('2 masal');
    expect(queueSummaryText(1, null)).toBe('1 masal');
    await i18n.changeLanguage('en');
    expect(queueSummaryText(1, 6)).toBe('1 story, 6 min');
    expect(queueSummaryText(1, null)).toBe('1 story');
    expect(queueSummaryText(2, 9)).toBe('2 stories, 9 min');
  });

  it("rows read 'Kerem anlatıyor, 6 dk' with their place in the queue", () => {
    seed(['a', 'b']);
    renderSheet();

    expect(screen.getByTestId('queue-row-a')).toHaveTextContent(/Masal a/);
    expect(screen.getByTestId('queue-row-a')).toHaveTextContent(/Kerem anlatıyor, 6 dk/);
    expect(screen.getByTestId('queue-row-a-index')).toHaveTextContent('1');
    expect(screen.getByTestId('queue-row-b-index')).toHaveTextContent('2');
  });

  it("a never-played row reads the story's minutes, as its Library row does, until the real length is known (NL-04)", () => {
    // "Ninni": card and Library row 4 dk; the backend stored 13 minutes.
    const ninni = parseStoryNarrationFromJSON({
      ...mockNarrationJSON,
      id: 'ninni',
      totalDuration: 13 * 60,
      story: { ...mockStoryJSON, title: 'Ninni', estimatedDuration: 4 },
      voiceProfile: {
        ...mockNarrationJSON.voiceProfile,
        id: 'voice-9',
        name: 'Chirp3 Achernar (HD)',
        provider: 'GOOGLE',
        kind: 'PRESET',
        voiceId: 'tr-TR-Chirp3-HD-Achernar',
      },
    });
    queueStore.add(metaFromNarration(ninni));
    renderSheet();

    expect(screen.getByTestId('queue-row-ninni')).toHaveTextContent(/Achernar anlatıyor, 4 dk/);
    expect(screen.getByTestId('queue-row-ninni')).not.toHaveTextContent(/13 dk/);

    // Played: the real length the player reported wins.
    act(() => rememberNarrationDuration('ninni', 5 * MINUTE));
    expect(screen.getByTestId('queue-row-ninni')).toHaveTextContent(/Achernar anlatıyor, 5 dk/);
  });

  it('row meta keeps only what is known: the estimate stands in for a real length', () => {
    queueStore.add({ ...meta('a', 'Ay', null), estimateMs: 4 * MINUTE });
    queueStore.add(meta('b', 'Deniz'));
    const [a, b] = queueStore.entries;

    expect(queueRowMeta(a)).toBe('4 dk');
    expect(queueRowMeta(b)).toBe('Kerem anlatıyor');
  });
});

describe('Sırayı çal', () => {
  it('is offered without a queue context and plays from the first entry', () => {
    seed(['a', 'b', 'c']);
    renderSheet();

    fireEvent.press(screen.getByTestId('queue-play-all'));

    expect(screen.getByTestId('queue-play-all')).toHaveTextContent(/Sırayı çal/);
    expect(mockPlayQueueFrom).toHaveBeenCalledWith('a');
  });

  it('is not offered while the queue plays', () => {
    seed(['a', 'b', 'c']);
    queueStore.startAt('b');
    setAudio({ isPlaying: true, audioId: 'b' });
    renderSheet();

    expect(screen.queryByTestId('queue-play-all')).toBeNull();
  });

  it('comes back once the last story of the queue ended', () => {
    seed(['a', 'b']);
    queueStore.startAt('b');
    setAudio({ audioId: 'b', storyEnded: false });
    renderSheet();
    expect(screen.queryByTestId('queue-play-all')).toBeNull();

    setAudio({ storyEnded: true });

    expect(screen.getByTestId('queue-play-all')).toBeOnTheScreen();
  });

  it('a context stored by an earlier session, with nothing in the player, still offers it', () => {
    seed(['a', 'b']);
    queueStore.startAt('b');
    renderSheet();

    expect(screen.getByTestId('queue-play-all')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('queue-play-all'));
    expect(mockPlayQueueFrom).toHaveBeenCalledWith('a');
  });

  it('a story that ended in the middle of the queue does not bring it back', () => {
    seed(['a', 'b']);
    queueStore.startAt('a');
    setAudio({ audioId: 'a', storyEnded: true });
    renderSheet();

    expect(screen.queryByTestId('queue-play-all')).toBeNull();
  });
});

describe('a tap on a row', () => {
  it('starts the queue from that entry; from the player the sheet stays open', () => {
    seed(['a', 'b', 'c']);
    renderSheet('player');

    fireEvent.press(screen.getByTestId('queue-row-b-body'));

    expect(mockPlayQueueFrom).toHaveBeenCalledWith('b');
    expect(onClose).not.toHaveBeenCalled();
    expect(onOpenPlayer).not.toHaveBeenCalled();
  });

  it.each(['library', 'toast'] as const)('from %s the sheet closes and the player opens on it', origin => {
    seed(['a', 'b', 'c']);
    const view = renderSheet(origin);

    fireEvent.press(screen.getByTestId('queue-row-c-body'));

    // The close goes first; nothing heavy runs in the tap (NL-07).
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockPlayQueueFrom).not.toHaveBeenCalled();
    expect(onOpenPlayer).not.toHaveBeenCalled();

    // The commit that hides the sheet starts the queue, then opens the player.
    view.rerender(
      <QueueSheet
        visible={false}
        origin={origin}
        onClose={onClose}
        onOpenPlayer={onOpenPlayer}
        onOpenLibrary={onOpenLibrary}
      />,
    );

    expect(mockPlayQueueFrom).toHaveBeenCalledTimes(1);
    expect(mockPlayQueueFrom).toHaveBeenCalledWith('c');
    expect(onOpenPlayer).toHaveBeenCalledWith('c');
    const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
    expect(order(onClose)).toBeLessThan(order(mockPlayQueueFrom));
    // Pending before the player renders: it starts nothing twice.
    expect(order(mockPlayQueueFrom)).toBeLessThan(order(onOpenPlayer));
  });

  it("'Sırayı çal' outside the player also closes first, then plays from the first entry", () => {
    seed(['a', 'b']);
    const view = renderSheet('library');

    fireEvent.press(screen.getByTestId('queue-play-all'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockPlayQueueFrom).not.toHaveBeenCalled();

    view.rerender(
      <QueueSheet
        visible={false}
        origin="library"
        onClose={onClose}
        onOpenPlayer={onOpenPlayer}
        onOpenLibrary={onOpenLibrary}
      />,
    );

    expect(mockPlayQueueFrom).toHaveBeenCalledWith('a');
    expect(onOpenPlayer).toHaveBeenCalledWith('a');
  });

  it('a close without a tap (the scrim, back) starts nothing', () => {
    seed(['a', 'b']);
    const view = renderSheet('library');

    view.rerender(
      <QueueSheet
        visible={false}
        origin="library"
        onClose={onClose}
        onOpenPlayer={onOpenPlayer}
        onOpenLibrary={onOpenLibrary}
      />,
    );

    expect(mockPlayQueueFrom).not.toHaveBeenCalled();
    expect(onOpenPlayer).not.toHaveBeenCalled();
  });

  it('does nothing in edit mode', () => {
    seed(['a', 'b']);
    renderSheet('library');
    edit();

    fireEvent.press(screen.getByTestId('queue-row-b-body'));

    expect(mockPlayQueueFrom).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('edit mode', () => {
  it('shows a remove button and a drag handle on every row but the current one', () => {
    seed(['a', 'b', 'c']);
    queueStore.startAt('a');
    renderSheet();
    expect(screen.queryByTestId('queue-row-b-remove')).toBeNull();
    expect(screen.queryByTestId('queue-row-b-drag')).toBeNull();

    edit();

    expect(screen.getByTestId('queue-edit-toggle')).toHaveTextContent('Bitti');
    expect(screen.queryByTestId('queue-row-a-remove')).toBeNull();
    expect(screen.queryByTestId('queue-row-a-drag')).toBeNull();
    for (const id of ['b', 'c']) {
      expect(screen.getByTestId(`queue-row-${id}-remove`)).toBeOnTheScreen();
      expect(screen.getByTestId(`queue-row-${id}-drag`)).toBeOnTheScreen();
    }
    // "Sırayı temizle" takes the summary's action slot while editing.
    expect(screen.getByTestId('queue-clear')).toHaveTextContent(/Sırayı temizle/);

    edit();
    expect(screen.queryByTestId('queue-row-b-remove')).toBeNull();
    expect(screen.queryByTestId('queue-clear')).toBeNull();
  });

  it('every control is at least 44dp', () => {
    seed(['a', 'b', 'c']);
    renderSheet();
    edit();

    for (const testID of ['queue-row-b-remove', 'queue-row-b-drag']) {
      const box = flat(screen.getByTestId(testID));
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(QUEUE_CONTROL_SIZE).toBe(44);
    // The text toggle is a full touch height without a lip.
    expect(Number(flat(screen.getByTestId('queue-edit-toggle-face')).minHeight)).toBeGreaterThanOrEqual(44);
    // sm buttons on a lip: the face, the lip and the vertical hit slop.
    const reach = (testID: string) => {
      const slop = screen.getByTestId(testID).props.hitSlop as { top: number; bottom: number };
      return BUTTON_METRICS.sm.height + BUTTON_METRICS.sm.lip + slop.top + slop.bottom;
    };
    expect(reach('queue-clear')).toBeGreaterThanOrEqual(44);
    edit();
    expect(reach('queue-play-all')).toBeGreaterThanOrEqual(44);
  });

  it('the remove button and the drag handle name the story', () => {
    seed(['a', 'b', 'c']);
    renderSheet();
    edit();

    expect(screen.getByTestId('queue-row-b-remove').props.accessibilityLabel).toBe(
      'Masal b masalını sıradan çıkar',
    );
    // One handle per row: a screen reader tells them apart by the story.
    expect(screen.getByTestId('queue-row-b-drag').props.accessibilityLabel).toBe(
      'Masal b, Sürükleyerek taşı',
    );
    expect(screen.getByTestId('queue-row-c-drag').props.accessibilityLabel).toBe(
      'Masal c, Sürükleyerek taşı',
    );
  });

  it('one entry left after a remove can still be edited: the toggle stays', () => {
    seed(['a', 'b']);
    renderSheet();
    edit();
    fireEvent.press(screen.getByTestId('queue-row-b-remove'));
    expect(screen.getByTestId('queue-edit-toggle')).toHaveTextContent('Bitti');
    // The last row still has its remove button, but nothing to be carried to.
    expect(screen.getByTestId('queue-row-a-remove')).toBeOnTheScreen();
    expect(screen.queryByTestId('queue-row-a-drag')).toBeNull();

    edit();
    expect(screen.getByTestId('queue-edit-toggle')).toHaveTextContent('Düzenle');
  });

  it('the header keeps its height when the toggle goes away with the last entry', () => {
    seed(['a']);
    renderSheet();
    edit();
    fireEvent.press(screen.getByTestId('queue-row-a-remove'));

    expect(screen.getByTestId('queue-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('queue-edit-toggle')).toBeNull();
    // An empty slot of the toggle's height holds the title row, and the
    // title stays at the size it had beside the toggle.
    const slot = flat(screen.getByTestId('queue-edit-toggle-slot'));
    expect(Number(slot.height)).toBeGreaterThanOrEqual(48);
    expect(Number(flat(screen.getByTestId('sheet-title')).fontSize)).toBe(text.subheading.fontSize);
  });

  it('a sheet opened with one entry offers Düzenle, a remove button and no drag handle (RC-2)', () => {
    seed(['a']);
    renderSheet();
    expect(Number(flat(screen.getByTestId('sheet-title')).fontSize)).toBe(text.subheading.fontSize);

    edit();

    expect(screen.getByTestId('queue-row-a-remove').props.accessibilityLabel).toBe(
      'Masal a masalını sıradan çıkar',
    );
    expect(screen.queryByTestId('queue-row-a-drag')).toBeNull();
    expect(screen.getByTestId('queue-clear')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('queue-row-a-remove'));

    expect(ids()).toEqual([]);
    expect(screen.getByTestId('queue-empty')).toBeOnTheScreen();
    const [message, , action] = mockToast.info.mock.calls[0];
    expect(message).toBe('Sıradan çıkarıldı');
    act(() => action.onPress());
    expect(ids()).toEqual(['a']);
    expect(screen.getByTestId('queue-row-a')).toBeOnTheScreen();
  });

  it('a queue of one that is playing is emptied with Sırayı temizle (its row has no remove)', () => {
    seed(['a']);
    queueStore.startAt('a');
    renderSheet();
    edit();

    expect(screen.queryByTestId('queue-row-a-remove')).toBeNull();
    fireEvent.press(screen.getByTestId('queue-clear'));

    expect(ids()).toEqual([]);
    expect(mockToast.info.mock.calls[0][0]).toBe('Sıra temizlendi');
  });
});

describe('accessibility actions', () => {
  it('move a row up and down; the first has no move up, the last no move down', () => {
    seed(['a', 'b', 'c']);
    renderSheet();
    const names = (id: string) =>
      (screen.getByTestId(`queue-row-${id}-body`).props.accessibilityActions as { name: string }[]).map(
        action => action.name,
      );
    expect(names('a')).toEqual(['moveDown', 'remove']);
    expect(names('b')).toEqual(['moveUp', 'moveDown', 'remove']);
    expect(names('c')).toEqual(['moveUp', 'remove']);

    fireEvent(screen.getByTestId('queue-row-c-body'), 'accessibilityAction', {
      nativeEvent: { actionName: 'moveUp' },
    });
    expect(ids()).toEqual(['a', 'c', 'b']);

    fireEvent(screen.getByTestId('queue-row-a-body'), 'accessibilityAction', {
      nativeEvent: { actionName: 'moveDown' },
    });
    expect(ids()).toEqual(['c', 'a', 'b']);
  });

  it('the current row can move but offers no remove', () => {
    seed(['a', 'b']);
    queueStore.startAt('b');
    renderSheet();
    const body = screen.getByTestId('queue-row-b-body');

    expect((body.props.accessibilityActions as { name: string }[]).map(a => a.name)).toEqual(['moveUp']);
    fireEvent(body, 'accessibilityAction', { nativeEvent: { actionName: 'remove' } });
    expect(ids()).toEqual(['a', 'b']);

    fireEvent(body, 'accessibilityAction', { nativeEvent: { actionName: 'moveUp' } });
    expect(ids()).toEqual(['b', 'a']);
    expect(queueStore.currentId).toBe('b');
  });

  it('remove as an action takes the row out with an undo', () => {
    seed(['a', 'b', 'c']);
    renderSheet();

    fireEvent(screen.getByTestId('queue-row-b-body'), 'accessibilityAction', {
      nativeEvent: { actionName: 'remove' },
    });

    expect(ids()).toEqual(['a', 'c']);
    expect(mockToast.info).toHaveBeenCalledWith('Sıradan çıkarıldı', undefined, expect.anything());
  });
});

describe('remove and clear', () => {
  it("remove acts at once and 'Geri al' puts the row back at its index", () => {
    seed(['a', 'b', 'c']);
    renderSheet();
    edit();

    fireEvent.press(screen.getByTestId('queue-row-b-remove'));

    expect(ids()).toEqual(['a', 'c']);
    expect(screen.queryByTestId('queue-row-b')).toBeNull();
    const [message, , action] = mockToast.info.mock.calls[0];
    expect(message).toBe('Sıradan çıkarıldı');
    expect(action.label).toBe('Geri al');

    act(() => action.onPress());

    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(screen.getByTestId('queue-row-b')).toBeOnTheScreen();
  });

  it("clear empties the queue at once, without a dialog, and 'Geri al' brings it back with its context", () => {
    seed(['a', 'b', 'c']);
    queueStore.startAt('b');
    renderSheet();
    edit();

    fireEvent.press(screen.getByTestId('queue-clear'));

    expect(ids()).toEqual([]);
    expect(queueStore.currentId).toBeNull();
    expect(screen.getByTestId('queue-empty')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^queue-row-/)).toHaveLength(0);
    const [message, , action] = mockToast.info.mock.calls[0];
    expect(message).toBe('Sıra temizlendi');
    expect(action.label).toBe('Geri al');

    act(() => action.onPress());

    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(queueStore.currentId).toBe('b');
    // Edit mode ended with the clear.
    expect(screen.getByTestId('queue-edit-toggle')).toHaveTextContent('Düzenle');
  });

  it("a removed row stays mounted, folded and hidden, and 'Geri al' brings back the same view with its cover (RC-7)", () => {
    seed(['a', 'b', 'c']);
    renderSheet();
    edit();
    const mounted = mockImageMounts.count;

    fireEvent.press(screen.getByTestId('queue-row-b-remove'));

    // Kept as a ghost: no height, not seen, not touched, not read.
    const ghost = screen.getByTestId('queue-ghost-b');
    expect(flat(ghost)).toMatchObject({ height: 0, minHeight: 0, marginBottom: 0, opacity: 0, overflow: 'hidden' });
    expect(ghost.props.pointerEvents).toBe('none');
    expect(ghost.props.accessibilityElementsHidden).toBe(true);
    expect(ghost.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(screen.getByTestId('queue-ghost-b-body').props.accessibilityActions).toEqual([]);
    expect(screen.queryByTestId('queue-ghost-b-remove')).toBeNull();

    const [, , action] = mockToast.info.mock.calls[0];
    act(() => action.onPress());

    // The row is back in its place, and no cover picture was mounted for it.
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(screen.getByTestId('queue-row-b')).toBeOnTheScreen();
    expect(screen.queryByTestId('queue-ghost-b')).toBeNull();
    expect(flat(screen.getByTestId('queue-row-b')).opacity).toBeUndefined();
    expect(mockImageMounts.count).toBe(mounted);
  });

  it('a cleared queue brought back by its undo mounts no cover again, and the last row removed neither', () => {
    seed(['a', 'b', 'c']);
    renderSheet();
    edit();
    const mounted = mockImageMounts.count;

    fireEvent.press(screen.getByTestId('queue-clear'));
    expect(screen.getByTestId('queue-empty')).toBeOnTheScreen();
    act(() => mockToast.info.mock.calls[0][2].onPress());

    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(mockImageMounts.count).toBe(mounted);
  });

  it('ghosts last only for the undo window and never into the next opening', () => {
    seed(['a', 'b', 'c']);
    const view = renderSheet();
    edit();
    fireEvent.press(screen.getByTestId('queue-row-b-remove'));
    expect(screen.getByTestId('queue-ghost-b')).toBeOnTheScreen();

    // After the undo window, the next change of the queue lets it go.
    act(() => {
      jest.advanceTimersByTime(QUEUE_GHOST_MS + 1);
    });
    fireEvent.press(screen.getByTestId('queue-row-c-remove'));
    expect(screen.queryByTestId('queue-ghost-b')).toBeNull();
    expect(screen.getByTestId('queue-ghost-c')).toBeOnTheScreen();

    // Closed and opened again: nothing of the last opening is kept.
    view.rerender(
      <QueueSheet visible={false} origin="player" onClose={onClose} onOpenPlayer={onOpenPlayer} onOpenLibrary={onOpenLibrary} />,
    );
    act(() => {
      jest.runOnlyPendingTimers();
    });
    view.rerender(
      <QueueSheet visible origin="player" onClose={onClose} onOpenPlayer={onOpenPlayer} onOpenLibrary={onOpenLibrary} />,
    );
    expect(screen.queryByTestId('queue-ghost-c')).toBeNull();
  });

  it('the sheet height does not change after a remove or a clear', () => {
    seed(['a', 'b', 'c']);
    renderSheet();
    const height = flat(screen.getByTestId('queue-sheet')).height;
    expect(height).toBe(
      queueSheetHeight({ entries: 3, fontScale: WINDOW.fontScale, windowHeight: WINDOW.height, bottomInset: 0 }, text),
    );
    edit();

    fireEvent.press(screen.getByTestId('queue-row-b-remove'));
    expect(flat(screen.getByTestId('queue-sheet')).height).toBe(height);

    fireEvent.press(screen.getByTestId('queue-clear'));
    expect(flat(screen.getByTestId('queue-sheet')).height).toBe(height);
  });
});

describe('sheet height', () => {
  const input = { fontScale: 1, windowHeight: 800, bottomInset: 0 };

  it('header, summary, the rows and the bottom padding, at most six rows', () => {
    // Header: handle 24, the 48dp text toggle beside the title, 8 below.
    const header = 24 + 48 + 8;
    // Summary 40, rows 64 apart, bottom padding 20.
    expect(queueSheetHeight({ ...input, entries: 3 }, text)).toBe(header + 40 + 3 * 64 + 20);
    expect(queueSheetHeight({ ...input, entries: 6 }, text)).toBe(header + 40 + 6 * 64 + 20);
    expect(queueSheetHeight({ ...input, entries: 30 }, text)).toBe(header + 40 + 6 * 64 + 20);
    // One entry: the toggle too (RC-2), and the body is as tall as the
    // empty state it shows if that entry is removed (RB-5), not 40 + 64.
    const emptyMin = queueEmptyMinHeight({ fontScale: 1, bottomInset: 0, windowWidth: 360 }, text);
    expect(emptyMin).toBeGreaterThan(40 + 64);
    expect(queueSheetHeight({ ...input, entries: 1 }, text)).toBe(header + emptyMin + 20);
  });

  it('the empty state minimum: paddings, title, the hint lines, the button on its lip and the snackbar room', () => {
    const reserve = queueEmptySnackbarReserve(0, 1);
    // 360dp: the Turkish hint takes two lines of 19.
    expect(queueEmptyMinHeight({ fontScale: 1, bottomInset: 0, windowWidth: 360 }, text)).toBe(
      2 * 8 + 28 + 8 + 2 * 19 + 20 + 46 + reserve,
    );
    // A narrow window wraps the hint once more; a large font grows every line.
    expect(queueEmptyMinHeight({ fontScale: 1, bottomInset: 0, windowWidth: 240 }, text)).toBe(
      2 * 8 + 28 + 8 + 3 * 19 + 20 + 46 + reserve,
    );
    expect(queueEmptyMinHeight({ fontScale: 1.3, bottomInset: 0, windowWidth: 360 }, text)).toBeGreaterThan(
      queueEmptyMinHeight({ fontScale: 1, bottomInset: 0, windowWidth: 360 }, text),
    );
    // A navigation bar under the sheet: more room for the message.
    expect(queueEmptyMinHeight({ fontScale: 1, bottomInset: 48, windowWidth: 360 }, text)).toBeGreaterThan(
      queueEmptyMinHeight({ fontScale: 1, bottomInset: 0, windowWidth: 360 }, text),
    );
  });

  it('never above 88% of the window, and clears the navigation bar', () => {
    expect(queueSheetHeight({ ...input, entries: 30, windowHeight: 500 }, text)).toBe(440);
    expect(queueSheetHeight({ ...input, entries: 3, bottomInset: 48 }, text)).toBe(80 + 40 + 3 * 64 + 56);
  });

  it('a large font grows the rows and the header', () => {
    const large = queueSheetHeight({ ...input, entries: 3, fontScale: 1.3 }, text);
    expect(large).toBeGreaterThan(queueSheetHeight({ ...input, entries: 3 }, text));
  });

  it('an empty queue hugs its empty state', () => {
    renderSheet();
    expect(flat(screen.getByTestId('queue-sheet')).height).toBeUndefined();
  });
});

describe('empty state', () => {
  it("shows the queue icon, the hint and 'Kütüphaneye git', which closes and opens the Library", () => {
    renderSheet('player');

    expect(screen.getByTestId('queue-empty-icon')).toBeOnTheScreen();
    expect(screen.getByText('Sıran boş')).toBeOnTheScreen();
    expect(
      screen.getByText("Masallarım'daki sıra düğmesine ya da masalın sayfasında Sıraya ekle'ye dokun."),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('queue-summary')).toBeNull();
    expect(screen.queryByTestId('queue-edit-toggle')).toBeNull();

    fireEvent.press(screen.getByTestId('queue-empty-action'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
  });

  /** A layout event for a measured view. */
  const layout = (testID: string, height: number) =>
    fireEvent(screen.getByTestId(testID), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height } },
    });

  /** Clear a queue of three in the open sheet and show the message it shows. */
  function clearWithMessage() {
    seed(['a', 'b', 'c']);
    renderSheet('library');
    edit();
    fireEvent.press(screen.getByTestId('queue-clear'));
    // The toast is mocked here: the real snackbar shows the same message.
    act(() => {
      snackbar.show({ message: 'Sıra temizlendi', actionLabel: 'Geri al', onAction: () => undefined });
    });
  }

  afterEach(() => {
    act(() => snackbar.dismiss());
    act(() => {
      jest.runOnlyPendingTimers();
    });
  });

  it("after 'Sırayı temizle', 'Kütüphaneye git' ends above the sheet's snackbar (V3-08)", () => {
    clearWithMessage();

    // Window distances up from the bottom edge (no safe area in tests). The
    // sheet's content ends above its bottom padding; the empty state ends
    // its reserve above that.
    const content = screen.getByTestId('queue-empty-scroll').props.contentContainerStyle;
    const reserve = Number(StyleSheet.flatten(content).paddingBottom);
    const emptyEnds = dockBottom(0) + reserve;
    // The bar as drawn: its offset, then its lip and one line of message at
    // this font scale, at least its minimum height.
    const bar = screen.getByTestId('sheet-snackbar');
    const barStyle = flat(bar);
    const message = flat(screen.getByText('Sıra temizlendi'));
    const barHeight = Math.max(
      Number(barStyle.minHeight),
      Math.ceil(Number(message.lineHeight) * WINDOW.fontScale) +
        2 * Number(message.paddingVertical) +
        Number(barStyle.borderBottomWidth),
    );
    const barTop = Number(flat(screen.getByTestId('sheet-snackbar-host')).bottom) + barHeight;

    expect(reserve).toBe(queueEmptySnackbarReserve(0, WINDOW.fontScale));
    expect(reserve).toBeGreaterThan(0);
    // No overlap, and the usual 8dp between them.
    expect(emptyEnds).toBeGreaterThanOrEqual(barTop + 8);
  });

  it('the emptied sheet shows the icon once measured, only where it fits', () => {
    clearWithMessage();
    const reserve = queueEmptySnackbarReserve(0, WINDOW.fontScale);

    // Not measured yet: drawn once the icon is decided, so nothing jumps.
    expect(screen.queryByTestId('queue-empty-icon')).toBeNull();
    expect(flat(screen.getByTestId('queue-empty')).opacity).toBe(0);

    // A short sheet: the text block alone fills what is above the snackbar.
    layout('queue-empty-text', 150);
    layout('queue-empty-scroll', reserve + 16 + 150 + QUEUE_EMPTY_ICON_BLOCK - 1);
    expect(screen.queryByTestId('queue-empty-icon')).toBeNull();
    expect(flat(screen.getByTestId('queue-empty')).opacity).toBeUndefined();

    // Room for the badge on its lip and its gap: the icon shows.
    layout('queue-empty-scroll', reserve + 16 + 150 + QUEUE_EMPTY_ICON_BLOCK);
    expect(screen.getByTestId('queue-empty-icon')).toBeOnTheScreen();
    expect(screen.getByTestId('queue-empty-action')).toBeOnTheScreen();
  });

  it('queueEmptyIconFits counts the reserve, the paddings and the text block', () => {
    expect(QUEUE_EMPTY_ICON_BLOCK).toBe(76 + 4 + 20);
    expect(queueEmptyIconFits(56 + 16 + 150 + 100, 56, 150)).toBe(true);
    expect(queueEmptyIconFits(56 + 16 + 150 + 99, 56, 150)).toBe(false);
    // The reserve grows with the navigation bar and the font scale.
    expect(queueEmptySnackbarReserve(48, 1)).toBeGreaterThan(queueEmptySnackbarReserve(0, 1));
    expect(queueEmptySnackbarReserve(0, 2)).toBeGreaterThan(queueEmptySnackbarReserve(0, 1));
  });

  it('an empty queue opened while a message is up keeps room for it below the button', () => {
    act(() => {
      snackbar.show({ message: 'Sıra temizlendi', actionLabel: 'Geri al', onAction: () => undefined });
    });
    renderSheet('library');

    const empty = flat(screen.getByTestId('queue-empty'));
    expect(empty.paddingBottom).toBe(8 + queueEmptySnackbarReserve(0, WINDOW.fontScale));
    expect(screen.getByTestId('queue-empty-icon')).toBeOnTheScreen();
  });

  it('a short queue opens tall enough for the empty state above the message (RB-5)', () => {
    // The body under the header, above the bottom padding, of a queue of
    // one to three, on phones and font sizes of every kind.
    for (const windowWidth of [320, 360, 411]) {
      for (const fontScale of [1, 1.15, 1.3]) {
        for (const bottomInset of [0, 24, 48]) {
          for (const entries of [1, 2, 3]) {
            const height = queueSheetHeight({ entries, fontScale, windowHeight: 914, windowWidth, bottomInset }, text);
            const body = height - queueSheetHeaderHeight(entries, fontScale, text) - dockBottom(bottomInset);
            expect(body).toBeGreaterThanOrEqual(queueEmptyMinHeight({ fontScale, bottomInset, windowWidth }, text));
          }
        }
      }
    }
  });

  it("the last row removed: 'Kütüphaneye git' ends above the 'Sıradan çıkarıldı' message", () => {
    seed(['a']);
    renderSheet('library');
    const height = Number(flat(screen.getByTestId('queue-sheet')).height);
    edit();
    fireEvent.press(screen.getByTestId('queue-row-a-remove'));
    act(() => {
      snackbar.show({ message: 'Sıradan çıkarıldı', actionLabel: 'Geri al', onAction: () => undefined });
    });

    // The body the empty state gets in this sheet holds it, its reserve included.
    const header = queueSheetHeaderHeight(1, WINDOW.fontScale, text);
    const viewport = height - header - dockBottom(0);
    expect(viewport).toBeGreaterThanOrEqual(
      queueEmptyMinHeight({ fontScale: WINDOW.fontScale, bottomInset: 0, windowWidth: WINDOW.width }, text),
    );
    const content = screen.getByTestId('queue-empty-scroll').props.contentContainerStyle;
    expect(Number(StyleSheet.flatten(content).paddingBottom)).toBe(queueEmptySnackbarReserve(0, WINDOW.fontScale));
    expect(screen.getByTestId('queue-empty-action')).toBeOnTheScreen();
  });

  it('an empty state longer than its body is shown from its end, the button in view', () => {
    const scrollToEnd = (ScrollView.prototype as unknown as { scrollToEnd: jest.Mock }).scrollToEnd;
    clearWithMessage();
    scrollToEnd.mockClear();
    const scroll = screen.getByTestId('queue-empty-scroll');

    layout('queue-empty-scroll', 200);
    fireEvent(scroll, 'contentSizeChange', 360, 180);
    expect(scrollToEnd).not.toHaveBeenCalled();

    fireEvent(scroll, 'contentSizeChange', 360, 260);
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  });

  it('an empty queue opened with no message up hugs its empty state', () => {
    renderSheet('library');

    expect(flat(screen.getByTestId('queue-empty')).paddingBottom).toBe(8);
  });

  it('the Library opens on Masallarım, back on the tab shell', () => {
    openQueueLibrary();

    expect(consumeLibrarySegmentRequest()).toBe('mine');
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'NAVIGATE',
        payload: expect.objectContaining({ name: 'Main', params: { screen: 'Library' }, pop: true }),
      }),
    );
  });
});

describe('now-playing bars', () => {
  function captureLoops() {
    const loops: { start: jest.Mock; stop: jest.Mock }[] = [];
    jest.spyOn(Animated, 'loop').mockImplementation(() => {
      const loop = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
      loops.push(loop);
      return loop;
    });
    return loops;
  }

  it('three native loops while the current story plays, no interval and no re-render timer', () => {
    const loops = captureLoops();
    const timing = jest.spyOn(Animated, 'timing');
    seed(['a', 'b']);
    queueStore.startAt('a');
    renderSheet();
    expect(screen.getByTestId('queue-row-a-bars')).toBeOnTheScreen();
    expect(screen.queryByTestId('queue-row-a-index')).toBeNull();
    expect(loops).toHaveLength(0);
    const interval = jest.spyOn(global, 'setInterval');

    setAudio({ isPlaying: true, audioId: 'a' });

    expect(loops).toHaveLength(3);
    loops.forEach(loop => expect(loop.start).toHaveBeenCalledTimes(1));
    const configs = timing.mock.calls.map(call => call[1]);
    expect(configs).toHaveLength(6);
    configs.forEach(config => expect(config.useNativeDriver).toBe(true));
    expect(configs.map(config => config.duration)).toEqual(
      NOW_PLAYING_BAR_MS.flatMap(ms => [ms, ms]),
    );
    expect(configs.map(config => config.toValue)).toEqual([1, NOW_PLAYING_BAR_LOW, 1, NOW_PLAYING_BAR_LOW, 1, NOW_PLAYING_BAR_LOW]);
    expect(interval).not.toHaveBeenCalled();

    setAudio({ isPlaying: false });
    loops.forEach(loop => expect(loop.stop).toHaveBeenCalledTimes(1));
    expect(interval).not.toHaveBeenCalled();
  });

  it('a story starting from the queue already moves the bars', () => {
    const loops = captureLoops();
    seed(['a', 'b']);
    queueStore.startAt('b');
    setAudio({ isPlaying: true, audioId: 'a', pendingNarrationId: 'b' });
    renderSheet();

    expect(loops).toHaveLength(3);
  });

  it('another story playing leaves the bars still', () => {
    const loops = captureLoops();
    seed(['a', 'b']);
    queueStore.startAt('a');
    setAudio({ isPlaying: true, audioId: 'other' });
    renderSheet();

    expect(screen.getByTestId('queue-row-a-bars')).toBeOnTheScreen();
    expect(loops).toHaveLength(0);
  });

  it('under reduced motion the bars stay still', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const loops = captureLoops();
    seed(['a', 'b']);
    queueStore.startAt('a');
    setAudio({ isPlaying: true, audioId: 'a' });
    renderSheet();
    await act(async () => undefined);

    // The first frame did not know yet; the answer stops every loop.
    loops.forEach(loop => expect(loop.stop).toHaveBeenCalled());
    const started = loops.length;
    setAudio({ isPlaying: false });
    setAudio({ isPlaying: true });
    expect(loops).toHaveLength(started);
  });
});

describe('drag', () => {
  /**
   * The queue's orders while the test runs. Every mutation of QueueStore
   * replaces `entries` once (its actions are bound and cannot be spied on),
   * so one order per `move`.
   */
  function watchOrders() {
    const orders: string[][] = [];
    const dispose = reaction(
      () => queueStore.entries,
      entries => orders.push(entries.map(entry => entry.narrationId)),
    );
    afterEachDispose.push(dispose);
    return orders;
  }
  const afterEachDispose: (() => void)[] = [];
  afterEach(() => {
    afterEachDispose.splice(0).forEach(dispose => dispose());
  });

  it('carrying a row two places up calls queueStore.move once, and the list cannot scroll meanwhile', () => {
    seed(['a', 'b', 'c', 'd']);
    queueStore.startAt('a');
    renderSheet();
    edit();
    const moves = watchOrders();
    const handle = screen.getByTestId('queue-row-d-drag');
    const list = () => screen.UNSAFE_getByType(ScrollView);

    act(() => {
      handle.props.onResponderGrant(touch(0, 0, 1));
    });
    expect(list().props.scrollEnabled).toBe(false);
    // The lifted row is raised.
    expect(screen.getByTestId('queue-row-d-lip')).toBeOnTheScreen();
    // Two places up, in two steps.
    const half = -PITCH;
    const twoUp = -2 * PITCH - 6;
    act(() => {
      handle.props.onResponderMove(touch(half, 0, 2));
      handle.props.onResponderMove(touch(twoUp, half, 3));
    });
    expect(moves).toEqual([]);
    act(() => {
      handle.props.onResponderRelease(touch(twoUp, twoUp, 4));
    });

    // One move, from index 3 to index 1.
    expect(moves).toEqual([['a', 'd', 'b', 'c']]);
    expect(ids()).toEqual(['a', 'd', 'b', 'c']);
    expect(queueStore.currentId).toBe('a');
    expect(list().props.scrollEnabled).toBe(true);
    expect(screen.queryByTestId('queue-row-d-lip')).toBeNull();
  });

  it('only the rows between the carried one and the finger make room, one pitch each', () => {
    seed(['a', 'b', 'c', 'd', 'e', 'f']);
    renderSheet();
    edit();
    const handle = screen.getByTestId('queue-row-f-drag');
    act(() => {
      handle.props.onResponderGrant(touch(0, 0, 1));
    });
    const timing = jest.spyOn(Animated, 'timing');
    const targets = () => timing.mock.calls.map(([, config]) => config.toValue);

    // One place up: one row ('e') moves down into the room; the other four
    // start no animation.
    act(() => handle.props.onResponderMove(touch(-PITCH, 0, 2)));
    expect(targets()).toEqual([PITCH]);
    // Two places up: one more ('d'); 'e' is already there.
    act(() => handle.props.onResponderMove(touch(-2 * PITCH, -PITCH, 3)));
    expect(targets()).toEqual([PITCH, PITCH]);
    // Back one place: only 'd' returns.
    act(() => handle.props.onResponderMove(touch(-PITCH, -2 * PITCH, 4)));
    expect(targets()).toEqual([PITCH, PITCH, 0]);
    timing.mock.calls.forEach(([, config]) => expect(config.useNativeDriver).toBe(true));

    act(() => handle.props.onResponderRelease(touch(-PITCH, -PITCH, 5)));
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'f', 'e']);
  });

  it('a drag back to its own place moves nothing', () => {
    seed(['a', 'b', 'c']);
    renderSheet();
    edit();
    const moves = watchOrders();
    const handle = screen.getByTestId('queue-row-b-drag');

    act(() => {
      handle.props.onResponderGrant(touch(0, 0, 1));
      handle.props.onResponderMove(touch(PITCH, 0, 2));
      handle.props.onResponderMove(touch(10, PITCH, 3));
      handle.props.onResponderRelease(touch(10, 10, 4));
    });

    expect(moves).toEqual([]);
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('the list cannot take the finger from a carried row', () => {
    seed(['a', 'b']);
    renderSheet();
    edit();
    const handle = screen.getByTestId('queue-row-b-drag');

    expect(handle.props.onResponderTerminationRequest(touch(0, 0, 1))).toBe(false);
  });

  it('a drag cut short by the sheet closing leaves nothing lifted, and the next drag works', async () => {
    seed(['a', 'b', 'c']);
    renderWithProviders(<QueueSheetHost />);
    act(() => queueSheet.open('library'));
    edit();
    const list = () => screen.UNSAFE_getByType(ScrollView);
    act(() => {
      const handle = screen.getByTestId('queue-row-c-drag');
      handle.props.onResponderGrant(touch(0, 0, 1));
      handle.props.onResponderMove(touch(-PITCH, 0, 2));
    });
    expect(list().props.scrollEnabled).toBe(false);

    // The sheet closes under the finger; no release ever arrives.
    act(() => queueSheet.close());
    await act(async () => undefined);
    act(() => queueSheet.open('library'));

    expect(list().props.scrollEnabled).toBe(true);
    expect(screen.queryByTestId('queue-row-c-lip')).toBeNull();
    expect(ids()).toEqual(['a', 'b', 'c']);
    // Edit mode ended with the close; a new drag is taken and commits once.
    edit();
    const moves = watchOrders();
    const handle = screen.getByTestId('queue-row-a-drag');
    act(() => {
      handle.props.onResponderGrant(touch(0, 0, 10));
      handle.props.onResponderMove(touch(PITCH, 0, 11));
      handle.props.onResponderRelease(touch(PITCH, PITCH, 12));
    });
    expect(moves).toEqual([['b', 'a', 'c']]);
  });

  it('a drag past the ends stops at the first and the last place', () => {
    seed(['a', 'b', 'c']);
    renderSheet();
    edit();
    const handle = screen.getByTestId('queue-row-b-drag');

    act(() => {
      handle.props.onResponderGrant(touch(0, 0, 1));
      handle.props.onResponderMove(touch(900, 0, 2));
      handle.props.onResponderRelease(touch(900, 900, 3));
    });

    expect(ids()).toEqual(['a', 'c', 'b']);
  });
});

/**
 * Item 10 (Redmi 8 release build): after a reorder rows looked like they
 * vanished. The rows' shifts run on the native driver; on Fabric the end
 * event of a native animation, also one JS has stopped, arrives after the
 * drop with the value it reached, JS writes it back to the node and commits
 * it to the view. The old drop wrote `setValue(0)` into the same values, so
 * that late event put a row a whole pitch off, drawn over its neighbour.
 * These tests replay that late event on every value the drag moved.
 */
describe('drag: rows stay visible and land in order (item 10)', () => {
  /** Every Animated.Value the drag sets or animates, in order. */
  function watchValues() {
    const values = new Set<Animated.Value>();
    const timing = jest.spyOn(Animated, 'timing');
    const setValue = jest.spyOn(Animated.Value.prototype, 'setValue');
    return {
      values: () => {
        timing.mock.calls.forEach(([value]) => values.add(value as Animated.Value));
        setValue.mock.contexts.forEach(value => values.add(value as Animated.Value));
        return [...values];
      },
      restore: () => {
        timing.mockRestore();
        setValue.mockRestore();
      },
    };
  }

  /**
   * What React Native does when a native animation's end event arrives:
   * `__onAnimatedValueUpdateReceived(value)` and an update of the props
   * nodes the value still drives (Animation.__startNativeAnimation).
   */
  function lateNativeEnd(values: Animated.Value[], reached: number) {
    act(() => {
      values.forEach(value => {
        const node = value as unknown as {
          __onAnimatedValueUpdateReceived: (v: number) => void;
          _updateValue: (v: number, flush: boolean) => void;
        };
        node.__onAnimatedValueUpdateReceived(reached);
        node._updateValue(reached, true);
      });
    });
  }

  /** The rows in the order they are drawn. */
  const drawnOrder = () =>
    screen.getAllByTestId(/^queue-row-[a-z0-9]+$/).map(node => String(node.props.testID).slice('queue-row-'.length));

  /** The translation a row is drawn with (0 when it has none). */
  function shiftOfRow(id: string): number {
    const transform = flat(screen.getByTestId(`queue-row-${id}`)).transform as unknown as
      | { translateY?: number }[]
      | undefined;
    return transform?.find(t => t.translateY !== undefined)?.translateY ?? 0;
  }

  /** Every row in its own slot, not lifted, not dimmed, not a ghost. */
  function expectAllVisible(order: string[]) {
    expect(drawnOrder()).toEqual(order);
    order.forEach(id => {
      expect(shiftOfRow(id)).toBe(0);
      expect(screen.queryByTestId(`queue-row-${id}-lip`)).toBeNull();
      expect(flat(screen.getByTestId(`queue-row-${id}-face`)).opacity ?? 1).toBe(1);
    });
    expect(screen.queryAllByTestId(/^queue-ghost-/)).toHaveLength(0);
  }

  function carry(id: string, dy: number, t0: number) {
    const handle = screen.getByTestId(`queue-row-${id}-drag`);
    act(() => {
      handle.props.onResponderGrant(touch(0, 0, t0));
    });
    act(() => {
      // In whole steps, as a finger passes the rows.
      const steps = Math.max(1, Math.round(Math.abs(dy) / PITCH));
      for (let i = 1; i <= steps; i += 1) {
        const y = (dy * i) / steps;
        handle.props.onResponderMove(touch(y, (dy * (i - 1)) / steps, t0 + i));
      }
    });
    act(() => {
      handle.props.onResponderRelease(touch(dy, dy, t0 + 50));
    });
  }

  let watcher: ReturnType<typeof watchValues>;
  afterEach(() => watcher?.restore());

  it('a row carried up lands in its place, and no late native end event moves a row', () => {
    seed(['a', 'b', 'c', 'd', 'e']);
    renderSheet();
    edit();
    watcher = watchValues();

    carry('d', -2 * PITCH, 1);

    expect(ids()).toEqual(['a', 'd', 'b', 'c', 'e']);
    expectAllVisible(['a', 'd', 'b', 'c', 'e']);
    // The end events of the shifts ('b', 'c' moved down by a pitch) and of the carried row.
    lateNativeEnd(watcher.values(), PITCH);
    expectAllVisible(['a', 'd', 'b', 'c', 'e']);
  });

  it('a row carried down lands in its place, also after the late end events', () => {
    seed(['a', 'b', 'c', 'd', 'e']);
    renderSheet();
    edit();
    watcher = watchValues();

    carry('b', 2 * PITCH, 1);

    expect(ids()).toEqual(['a', 'c', 'd', 'b', 'e']);
    lateNativeEnd(watcher.values(), -PITCH);
    expectAllVisible(['a', 'c', 'd', 'b', 'e']);
  });

  it('to the first and to the last place', () => {
    seed(['a', 'b', 'c', 'd']);
    renderSheet();
    edit();
    watcher = watchValues();

    carry('c', -2 * PITCH, 1);
    expect(ids()).toEqual(['c', 'a', 'b', 'd']);
    lateNativeEnd(watcher.values(), PITCH);
    expectAllVisible(['c', 'a', 'b', 'd']);

    carry('c', 3 * PITCH, 100);
    expect(ids()).toEqual(['a', 'b', 'd', 'c']);
    lateNativeEnd(watcher.values(), -PITCH);
    expectAllVisible(['a', 'b', 'd', 'c']);
  });

  it('rapid successive drags, each started before the last one settled, all land', () => {
    seed(['a', 'b', 'c', 'd', 'e', 'f']);
    renderSheet();
    edit();
    watcher = watchValues();

    carry('f', -5 * PITCH, 1);
    carry('a', 2 * PITCH, 60);
    carry('d', -PITCH, 120);
    // A drag back to its own place in between: its return motion is cut by the next grab.
    const handle = screen.getByTestId('queue-row-b-drag');
    act(() => {
      handle.props.onResponderGrant(touch(0, 0, 200));
      handle.props.onResponderMove(touch(PITCH, 0, 201));
      handle.props.onResponderMove(touch(0, PITCH, 202));
      handle.props.onResponderRelease(touch(0, 0, 203));
    });
    carry('e', -PITCH, 300);

    const expected = ['f', 'b', 'c', 'd', 'e', 'a'];
    expect(ids()).toEqual(expected);
    lateNativeEnd(watcher.values(), PITCH);
    expectAllVisible(expected);
  });

  it('the end of an older return motion never drops a newer drag', () => {
    seed(['a', 'b', 'c']);
    renderSheet();
    edit();
    const onDone: ((result: { finished: boolean }) => void)[] = [];
    const timing = jest.spyOn(Animated, 'timing').mockImplementation(
      (value, config) =>
        ({
          start: (callback?: (result: { finished: boolean }) => void) => {
            (value as Animated.Value).setValue(config.toValue as number);
            if (callback) onDone.push(callback);
          },
          stop: () => undefined,
          reset: () => undefined,
        }) as Animated.CompositeAnimation,
    );
    try {
      // Dropped on its own place: the carried row starts back.
      const b = screen.getByTestId('queue-row-b-drag');
      act(() => {
        b.props.onResponderGrant(touch(0, 0, 1));
        b.props.onResponderMove(touch(10, 0, 2));
        b.props.onResponderRelease(touch(10, 10, 3));
      });
      // A new drag before that motion ended.
      const c = screen.getByTestId('queue-row-c-drag');
      act(() => c.props.onResponderGrant(touch(0, 0, 4)));
      expect(screen.getByTestId('queue-row-c-lip')).toBeOnTheScreen();
      // The old motion ends now (stopped by native): the new drag stays lifted.
      act(() => onDone.forEach(done => done({ finished: false })));
      expect(screen.getByTestId('queue-row-c-lip')).toBeOnTheScreen();
      expect(screen.UNSAFE_getByType(ScrollView).props.scrollEnabled).toBe(false);
      act(() => {
        c.props.onResponderMove(touch(-2 * PITCH, 0, 5));
        c.props.onResponderRelease(touch(-2 * PITCH, -2 * PITCH, 6));
      });
      expect(ids()).toEqual(['c', 'a', 'b']);
      expectAllVisible(['c', 'a', 'b']);
    } finally {
      timing.mockRestore();
    }
  });

  it('a reorder while a story of the queue plays: the playing row moves aside and keeps its bars', () => {
    seed(['a', 'b', 'c', 'd']);
    queueStore.startAt('b');
    setAudio({ isPlaying: true, audioId: 'b' });
    renderSheet();
    edit();
    watcher = watchValues();

    // 'd' passes over the playing row to the first place.
    carry('d', -3 * PITCH, 1);
    // The player reports while the rows settle (it redraws the sheet).
    setAudio({ isPlaying: false });
    setAudio({ isPlaying: true });

    expect(ids()).toEqual(['d', 'a', 'b', 'c']);
    expect(queueStore.currentId).toBe('b');
    lateNativeEnd(watcher.values(), PITCH);
    expect(drawnOrder()).toEqual(['d', 'a', 'b', 'c']);
    ['d', 'a', 'b', 'c'].forEach(id => expect(shiftOfRow(id)).toBe(0));
    // The playing row is still raised (its own lip) with its bars, and has no handle.
    expect(screen.getByTestId('queue-row-b-lip')).toBeOnTheScreen();
    expect(screen.getByTestId('queue-row-b-bars')).toBeOnTheScreen();
    expect(screen.queryByTestId('queue-row-b-drag')).toBeNull();
  });

  it('rows the drag did not touch keep their values: they do not redraw', () => {
    seed(['a', 'b', 'c', 'd', 'e']);
    renderSheet();
    edit();
    const valueOf = (id: string) =>
      screen.UNSAFE_getAllByProps({ entry: queueStore.entries.find(e => e.narrationId === id) })[0]?.props
        .translateY as Animated.Value;
    const before = valueOf('e');

    carry('b', PITCH, 1);

    expect(ids()).toEqual(['a', 'c', 'b', 'd', 'e']);
    expect(valueOf('e')).toBe(before);
  });
});

describe('QueueSheetHost', () => {
  it("is not created before the first open; queueSheet.open('toast') shows the sheet, close hides it", async () => {
    seed(['a', 'b']);
    renderWithProviders(<QueueSheetHost />);
    expect(screen.queryByTestId('queue-sheet')).toBeNull();

    act(() => queueSheet.open('toast'));
    expect(screen.getByTestId('queue-sheet')).toBeOnTheScreen();
    expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(true);

    act(() => queueSheet.close());
    await act(async () => undefined);
    expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(false);
    expect(screen.queryByTestId('queue-row-a')).toBeNull();
    // Opened again: back with its rows.
    act(() => queueSheet.open('library'));
    expect(screen.getByTestId('queue-row-a')).toBeOnTheScreen();
  });

  it('a tap from the Library closes the sheet and opens the player with autoplay', () => {
    seed(['a', 'b']);
    renderWithProviders(<QueueSheetHost />);
    act(() => queueSheet.open('library'));
    // What the sheet was doing when the start ran.
    const atStart: { visible: boolean; touches: unknown }[] = [];
    mockPlayQueueFrom.mockImplementationOnce(() => {
      atStart.push({
        visible: queueSheet.visible,
        touches: screen.getByTestId('queue-sheet').props.pointerEvents,
      });
      return Promise.resolve(true);
    });

    fireEvent.press(screen.getByTestId('queue-row-b-body'));

    expect(mockPlayQueueFrom).toHaveBeenCalledWith('b');
    // The sheet was already leaving (its exit runs, it takes no touches) when
    // the start began, and the player opened after the start (NL-07).
    expect(atStart).toEqual([{ visible: false, touches: 'none' }]);
    expect(mockPlayQueueFrom.mock.invocationCallOrder[0]).toBeLessThan(
      mockDispatch.mock.invocationCallOrder[0],
    );
    expect(queueSheet.visible).toBe(false);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'NAVIGATE',
        payload: expect.objectContaining({
          name: 'AudioPlayer',
          params: { narrationId: 'b', autoplay: true },
          pop: true,
        }),
      }),
    );
  });

  it('a tap from the player keeps the sheet open and navigates nowhere', () => {
    seed(['a', 'b']);
    renderWithProviders(<QueueSheetHost />);
    act(() => queueSheet.open('player'));

    fireEvent.press(screen.getByTestId('queue-row-b-body'));

    expect(queueSheet.visible).toBe(true);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('opening the player twice for one narration asks for the one already in the stack', () => {
    openQueuedPlayer('n-1');
    expect(mockDispatch.mock.calls[0][0].payload).toMatchObject({ name: 'AudioPlayer', pop: true });
  });
});

describe('queue icons', () => {
  it("'queue' and 'drag' are the list and reorder glyphs", () => {
    expect(iconGlyph('queue')).toBe('list-outline');
    expect(iconGlyph('queue', true)).toBe('list');
    expect(iconGlyph('drag')).toBe('reorder-three-outline');
    expect(iconGlyph('drag', true)).toBe('reorder-three');
  });

  it("the skip number sits on the arc's centre, below the arrowhead (NP-20)", () => {
    renderWithProviders(<Icon name="fwd15" color="#123456" size={28} />);
    const number = flat(screen.getByTestId('icon-fwd15-number'));
    const transform = (number.transform as unknown as { translateY: number }[])[0];

    expect(transform.translateY).toBeCloseTo(28 * SKIP_NUMBER_DROP);
    expect(transform.translateY).toBeGreaterThan(1.5);
    // Every line box at least 1.3 times its font size.
    expect(Number(number.lineHeight)).toBeGreaterThanOrEqual(Number(number.fontSize) * 1.3);
  });
});
