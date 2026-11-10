/**
 * QueueSheet: "Sıradakiler", the listening queue (docs/release-pass/
 * SPEC-audio.md 6.5).
 *
 * Mounted once by QueueSheetHost and opened through `queueSheet.open(origin)`
 * (the player's queue button, the Library app bar, "Sırayı aç" on the add
 * snackbars). The queue is local (QueueStore), so the sheet opens with its
 * rows at once and has no loading state.
 *
 *   header   "Sıradakiler" and, with any entry, "Düzenle" / "Bitti"
 *   summary  "3 masal, 18 dk" (real lengths only) and "Sırayı çal" while
 *            nothing plays from the queue, or after its last story ended;
 *            "Sırayı temizle" in its place while editing
 *   rows     index (or the now-playing bars on the current row), cover,
 *            title, "Kerem anlatıyor, 6 dk"; the current row is raised
 *
 * A tap plays the queue from that entry. Opened from the player the sheet
 * stays open and the player switches in place; from anywhere else it closes
 * and the player opens on that story (already starting, with autoplay). The
 * close goes first: the start and the player follow in the commit after it,
 * once the sheet's exit runs, so neither holds the sheet up.
 *
 * Edit mode gives every row but the current one a remove button and, in a
 * queue of two or more, a drag handle (PanResponder: no new dependency, works
 * inside the sheet's window). A queue of one is edited too (RC-2): its row
 * can be removed and "Sırayı temizle" empties it.
 * A drag commits one `queueStore.move` on release; the rows it moved get fresh
 * translation values at 0 in the render that draws the new order, so nothing
 * flashes and no late native end event can push a row onto its neighbour
 * (item 10: rows looked like they vanished after a reorder). Remove and
 * clear act at once with "Geri al" in a snackbar inside the sheet (no
 * confirmation dialog: iOS refuses a dialog over a sheet). Every row also
 * offers move up, move down and remove as accessibility actions.
 *
 * The height is fixed when the sheet opens (header, summary, up to six rows
 * and the bottom inset, at most 88%) and never changes while it is open: a
 * removed row leaves room at the bottom and nothing above it moves. A queue
 * emptied while open shows its empty state inside that height, ending above
 * the snackbar the sheet shows ("Sıra temizlendi"), with the icon when it
 * fits. A short queue opens at least as tall as that empty state needs, so
 * "Kütüphaneye git" never ends under the message (RB-5); where a large font
 * still makes it longer than its body, it is scrolled to its end, with the
 * button in view.
 *
 * A removed row stays mounted, folded to no height and hidden, while its
 * "Geri al" can bring it back: the restored row is the same view with its
 * cover already drawn, never an empty square for a frame (RC-7).
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AccessibilityActionEvent,
  AccessibilityActionInfo,
  Animated,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import i18n from '../../i18n';
import { BottomSheet } from '../design/BottomSheet';
import { Button } from '../design/Button';
import { BUTTON_METRICS, BUTTON_PAD_V, BUTTON_TOUCH } from '../design/buttonMetrics';
import { Icon, ICON_SIZE } from '../design/Icon';
import { PictureCover, useCoverSpread } from '../design/PictureCover';
import { IconButton, StateIcon } from '../design/rows';
import { sheetSnackbarClearance, snackbar } from '../design/Snackbar';
import { usePressSink, usePressTint } from '../design/Tactile';
import {
  LIP,
  SCREEN_PAD_H,
  SPACE,
  Theme,
  TextStyles,
  dockBottom,
  textStylesFor,
  themedStyles,
  useT,
} from '../../theme/theme';
import { EASE, animateTo, useReducedMotion } from '../../theme/motion';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { queueStore, type QueueEntry } from '../../stores/QueueStore';
import { playQueueFrom } from '../../stores/queuePlayback';
import { removeFromQueueWithFeedback } from '../../stores/queueActions';
import type { QueueSheetOrigin } from '../../stores/queueSheet';
import { resolveNarrationDurationMs } from '../../utils/narrationDurations';
import { showToast } from '../../utils/toast';

// ─────────────────────────────────────────────────────────────
// Geometry (SPEC-audio 9)
// ─────────────────────────────────────────────────────────────

/** Minimum row height; rows grow with a large font, all by the same amount. */
export const QUEUE_ROW_MIN_HEIGHT = 60;
/** Between rows: a pitch of 64 at the default font size. */
export const QUEUE_ROW_GAP = SPACE.xs;
/** Rows the sheet is sized for when it opens; more scroll. */
export const QUEUE_VISIBLE_ROWS = 6;
export const QUEUE_SUMMARY_HEIGHT = 40;
/** Remove button and drag handle, square. */
export const QUEUE_CONTROL_SIZE = 44;
export const QUEUE_COVER_SIZE = 40;
/** Index number or the now-playing bars. */
export const QUEUE_LEADING_WIDTH = 24;
/** A removed row stays mounted this long: the undo's 6 s and some slack (RC-7). */
export const QUEUE_GHOST_MS = 8000;
/** At most this many removed rows are kept mounted. */
const QUEUE_GHOST_MAX = 5;
/** A ghost never moves. */
const GHOST_SHIFT = new Animated.Value(0);
/**
 * The translation values of the rows for one order and one drag. A value in
 * `touched` was set or animated by the drag and is replaced by a fresh one
 * at 0 when the set renews; the others are kept, so their rows do not redraw.
 */
interface ShiftSet {
  order: string;
  values: Map<string, Animated.Value>;
  touched: Set<string>;
}

/** Where a touched value is heading (the target of its last animation). */
const shiftTargets = new WeakMap<Animated.Value, number>();
function targetOf(value: Animated.Value | undefined): number {
  return (value && shiftTargets.get(value)) ?? 0;
}

/** The set for `order`: the untouched values of rows still in it. */
function renewShifts(set: ShiftSet, order: string): ShiftSet {
  const ids = new Set(order ? order.split('|') : []);
  const values = new Map<string, Animated.Value>();
  set.values.forEach((value, id) => {
    if (ids.has(id) && !set.touched.has(id)) values.set(id, value);
  });
  return { order, values, touched: new Set() };
}

/** BottomSheet's handle area above the title. */
const SHEET_HANDLE_HEIGHT = 24;
/** BottomSheet's `maxHeight`. */
const SHEET_MAX_FRACTION = 0.88;

/** Height of every row at this font scale. */
export function queueRowHeight(text: TextStyles, fontScale = 1): number {
  const lines =
    Math.ceil((text.labelLarge.lineHeight ?? 0) * fontScale) +
    Math.ceil((text.meta.lineHeight ?? 0) * fontScale);
  return Math.max(QUEUE_ROW_MIN_HEIGHT, lines + 2 * SPACE.sm);
}

/** Distance from one row to the next (a drag moves by whole pitches). */
export function queueRowPitch(text: TextStyles, fontScale = 1): number {
  return queueRowHeight(text, fontScale) + QUEUE_ROW_GAP;
}

/** Face height of a sm button at this font scale. */
function smallFace(fontScale: number): number {
  const sm = BUTTON_METRICS.sm;
  return Math.max(sm.height, Math.ceil(sm.lineHeight * fontScale) + 2 * BUTTON_PAD_V);
}

/** A sm button on its lip ("Sırayı çal", "Sırayı temizle"). */
function smallButtonHeight(fontScale: number): number {
  return smallFace(fontScale) + BUTTON_METRICS.sm.lip;
}

/** A sm text button ("Düzenle" / "Bitti"): no lip, the full touch height. */
function smallTextButtonHeight(fontScale: number): number {
  return Math.max(BUTTON_TOUCH, smallFace(fontScale));
}

export interface QueueSheetSizeInput {
  /** Entries when the sheet opens. */
  entries: number;
  fontScale: number;
  windowHeight: number;
  bottomInset: number;
  /** For the lines of the empty state's hint (default 360). */
  windowWidth?: number;
}

/** The handle, the title row (with the edit toggle whenever there is an entry) and the gap under it. */
export function queueSheetHeaderHeight(entries: number, fontScale: number, text: TextStyles): number {
  const toggle = entries >= 1;
  const titleLine = Math.ceil(((toggle ? text.subheading : text.heading).lineHeight ?? 0) * fontScale);
  return SHEET_HANDLE_HEIGHT + Math.max(titleLine, toggle ? smallTextButtonHeight(fontScale) : 0) + SPACE.sm;
}

/**
 * The sheet's fixed height for a queue of this length: the header (with the
 * edit toggle whenever there is an entry), the summary row, up to six rows
 * and the bottom padding, but never less than the empty state needs if the
 * queue is emptied while open (`queueEmptyMinHeight`), at most 88% of the
 * window.
 */
export function queueSheetHeight(
  { entries, fontScale, windowHeight, bottomInset, windowWidth = 360 }: QueueSheetSizeInput,
  text: TextStyles,
): number {
  const header = queueSheetHeaderHeight(entries, fontScale, text);
  // Room for the button that may appear in it while the sheet is open.
  const summary = Math.max(
    QUEUE_SUMMARY_HEIGHT,
    smallButtonHeight(fontScale),
    Math.ceil((text.meta.lineHeight ?? 0) * fontScale),
  );
  const rows = Math.min(Math.max(0, entries), QUEUE_VISIBLE_ROWS) * queueRowPitch(text, fontScale);
  const body = Math.max(
    summary + rows,
    entries > 0 ? queueEmptyMinHeight({ fontScale, bottomInset, windowWidth }, text) : 0,
  );
  const total = header + body + dockBottom(bottomInset);
  return Math.min(Math.round(total), Math.floor(windowHeight * SHEET_MAX_FRACTION));
}

/** The empty state's queue badge. */
const EMPTY_ICON_SIZE = 76;
/** The badge on its lip and the gap to the title below it. */
export const QUEUE_EMPTY_ICON_BLOCK = EMPTY_ICON_SIZE + LIP.lg + SPACE.xl;
/** Above and below the empty state inside the sheet's fixed height. */
const EMPTY_COMPACT_PAD = SPACE.sm;

/**
 * Room the empty state keeps free at the bottom of the sheet's content for
 * the snackbar the sheet shows ("Sıra temizlendi", "Sıradan çıkarıldı"), so
 * "Kütüphaneye git" never sits under it (V3-08). The content already ends
 * `dockBottom` above the window's edge; the bar reaches higher.
 */
export function queueEmptySnackbarReserve(bottomInset: number, fontScale: number): number {
  return Math.max(0, sheetSnackbarClearance(bottomInset, fontScale) - dockBottom(bottomInset));
}

/** Width of a hint character as a share of its font size (Nunito, on the generous side). */
const HINT_CHAR_WIDTH = 0.52;
/** The hint's own width limit (`emptyHint`). */
const HINT_MAX_WIDTH = 300;

/**
 * The body an emptied sheet needs for its empty state without the icon: the
 * paddings, the title, the hint (its lines estimated from the window width),
 * "Kütüphaneye git" on its lip and the room kept for the snackbar (RB-5).
 */
export function queueEmptyMinHeight(
  { fontScale, bottomInset, windowWidth = 360 }: { fontScale: number; bottomInset: number; windowWidth?: number },
  text: TextStyles,
): number {
  const line = (lineHeight: number | undefined) => Math.ceil((lineHeight ?? 0) * fontScale);
  const hint = i18n.t('player:queue.empty.hint');
  const hintWidth = Math.max(1, Math.min(HINT_MAX_WIDTH, windowWidth - 2 * SCREEN_PAD_H));
  const hintLines = Math.max(
    1,
    Math.ceil((hint.length * HINT_CHAR_WIDTH * (text.bodySmall.fontSize ?? 14) * fontScale) / hintWidth),
  );
  const md = BUTTON_METRICS.md;
  const button = Math.max(md.height, Math.ceil(md.lineHeight * fontScale) + 2 * BUTTON_PAD_V) + md.lip;
  return (
    2 * EMPTY_COMPACT_PAD +
    line(text.heading.lineHeight) +
    SPACE.sm +
    hintLines * line(text.bodySmall.lineHeight) +
    SPACE.xl +
    button +
    queueEmptySnackbarReserve(bottomInset, fontScale)
  );
}

/**
 * The empty state of a sheet emptied while open shows its icon when the
 * icon, the text block (title, hint and button) and the paddings fit in the
 * body above the snackbar's room.
 */
export function queueEmptyIconFits(viewport: number, reserve: number, textBlock: number): boolean {
  return viewport - reserve - 2 * EMPTY_COMPACT_PAD - textBlock >= QUEUE_EMPTY_ICON_BLOCK;
}

// ─────────────────────────────────────────────────────────────
// Copy
// ─────────────────────────────────────────────────────────────

/** "3 masal, 18 dk", "1 masal, 6 dk", "3 masal" (a length unknown), "1 masal". */
export function queueSummaryText(n: number, minutes: number | null): string {
  if (n === 1) {
    return minutes !== null
      ? i18n.t('player:queue.summaryOne', { minutes })
      : i18n.t('player:queue.summaryOneNoTime');
  }
  return minutes !== null
    ? i18n.t('player:queue.summary', { n, minutes })
    : i18n.t('player:queue.summaryNoTime', { n });
}

/**
 * The label of a queue button (the player's top bar, the Library app bar):
 * "Sıradakiler" for an empty queue, else with the count ("Sıradakiler, 3
 * masal"), so no button ever reads "0 masal" (RC-4).
 */
export function queueButtonLabel(n: number): string {
  if (n <= 0) return i18n.t('player:queue.title');
  return n === 1 ? i18n.t('player:queue.a11yOpenOne') : i18n.t('player:queue.a11yOpen', { n });
}

/** Whole minutes of a row, from the real length when the player reported it. */
export function queueRowMinutes(entry: QueueEntry): number | null {
  const ms = resolveNarrationDurationMs(entry.narrationId, entry.estimateMs);
  return ms > 0 ? Math.max(1, Math.round(ms / 60000)) : null;
}

/** "Kerem anlatıyor, 6 dk", the parts that are known. */
export function queueRowMeta(entry: QueueEntry): string {
  const minutes = queueRowMinutes(entry);
  return [
    entry.narratorName ? i18n.t('library:row.narrator', { name: entry.narratorName }) : '',
    minutes !== null ? i18n.t('library:row.duration', { minutes }) : '',
  ]
    .filter(Boolean)
    .join(', ');
}

// ─────────────────────────────────────────────────────────────
// Now-playing bars (r14-bars, r12-12)
// ─────────────────────────────────────────────────────────────

/** One rise (or fall) per bar, ms: three periods, so the bars never sync up. */
export const NOW_PLAYING_BAR_MS = [520, 640, 580] as const;
/** Lowest bar, as a fraction of its height. */
export const NOW_PLAYING_BAR_LOW = 0.35;
/** Heights at rest (paused, reduced motion). */
const BAR_REST = [0.6, 1, 0.45] as const;
const BAR_HEIGHT = 14;
const BAR_WIDTH = 3;

/**
 * Three bars that rise and fall while the current story sounds: native
 * driven loops (no interval, no re-render), at rest while paused and under
 * reduced motion. Each bar slides up inside a clipped slot, so its rounded
 * top never squashes.
 */
const NowPlayingBars: React.FC<{ active: boolean; testID?: string }> = ({ active, testID }) => {
  const T = useT();
  const styles = stylesFor(T);
  const reduced = useReducedMotion();
  const values = useRef(BAR_REST.map(rest => new Animated.Value(rest))).current;
  const offsets = useRef(
    values.map(value =>
      value.interpolate({ inputRange: [0, 1], outputRange: [BAR_HEIGHT, 0], extrapolate: 'clamp' }),
    ),
  ).current;

  useEffect(() => {
    if (!active || reduced) {
      values.forEach((value, i) => {
        value.stopAnimation();
        value.setValue(BAR_REST[i]);
      });
      return undefined;
    }
    const loops = values.map((value, i) => {
      const duration = NOW_PLAYING_BAR_MS[i];
      return Animated.loop(
        Animated.sequence([
          Animated.timing(value, { toValue: 1, duration, easing: EASE.symmetric, useNativeDriver: true }),
          Animated.timing(value, {
            toValue: NOW_PLAYING_BAR_LOW,
            duration,
            easing: EASE.symmetric,
            useNativeDriver: true,
          }),
        ]),
      );
    });
    loops.forEach(loop => loop.start());
    return () => loops.forEach(loop => loop.stop());
  }, [active, reduced, values]);

  return (
    <View style={styles.bars} testID={testID} pointerEvents="none">
      {offsets.map((offset, i) => (
        <View key={i} style={styles.barSlot}>
          <Animated.View style={[styles.bar, { transform: [{ translateY: offset }] }]} />
        </View>
      ))}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// Row
// ─────────────────────────────────────────────────────────────

/** What a row's drag handle reports to the list. */
interface DragController {
  begin(index: number): void;
  move(dy: number): void;
  end(): void;
}

interface QueueRowProps {
  entry: QueueEntry;
  index: number;
  count: number;
  current: boolean;
  /** The current story sounds (the bars move). */
  playing: boolean;
  editing: boolean;
  /** Lifted by a drag. */
  lifted: boolean;
  rowHeight: number;
  placeholderIndex?: number;
  translateY: Animated.Value;
  drag: DragController;
  onPlay: (narrationId: string) => void;
  onRemove: (entry: QueueEntry) => void;
  onMove: (from: number, to: number) => void;
  /**
   * Removed, while "Geri al" can bring it back (RC-7): folded to no height,
   * transparent, untouchable and hidden from screen readers, with its cover
   * still drawn. Its test ids start with `queue-ghost-`.
   */
  ghost?: boolean;
}

/**
 * An observer, so a row draws again only for its own changes (its length
 * becoming known, being lifted): a drag's grant and release, or a play and
 * pause, do not redraw fifty covers on a slow phone.
 */
const QueueRow: React.FC<QueueRowProps> = observer(({
  entry,
  index,
  count,
  current,
  playing,
  editing,
  lifted,
  rowHeight,
  placeholderIndex,
  translateY,
  drag,
  onPlay,
  onRemove,
  onMove,
  ghost = false,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const text = textStylesFor(T);
  const { t } = useTranslation('player');
  const raised = !ghost && (current || lifted);
  const pressable = !editing && !ghost;
  // A raised row sinks onto its lip; a flat row dims (SPEC-design 1.3).
  const sink = usePressSink(LIP.md, pressable && raised);
  const tint = usePressTint(!pressable || raised);

  const indexRef = useRef(index);
  indexRef.current = index;
  const handle = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // The list must not take the finger while a row is carried.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => drag.begin(indexRef.current),
      onPanResponderMove: (_event, gesture) => drag.move(gesture.dy),
      onPanResponderRelease: () => drag.end(),
      onPanResponderTerminate: () => drag.end(),
    }),
  ).current;

  const title = entry.story.title || t('untitled');
  const meta = queueRowMeta(entry);
  const id = entry.narrationId;
  const removable = !current && !ghost;
  // A row of a queue of one has nowhere to be carried to.
  const draggable = removable && count >= 2;
  // Both ids spelled out, so the Maestro flow check can see `queue-row-<id>`.
  const tid = ghost ? `queue-ghost-${id}` : `queue-row-${id}`;

  // A ghost is hidden from screen readers and offers nothing.
  const actions: AccessibilityActionInfo[] = [];
  if (!ghost && index > 0) actions.push({ name: 'moveUp', label: t('queue.moveUp') });
  if (!ghost && index < count - 1) actions.push({ name: 'moveDown', label: t('queue.moveDown') });
  if (removable) actions.push({ name: 'remove', label: t('queue.removeOne', { title }) });
  const moveActions = actions.filter(action => action.name !== 'remove');

  const onAction = (event: AccessibilityActionEvent) => {
    switch (event.nativeEvent.actionName) {
      case 'moveUp':
        if (index > 0) onMove(index, index - 1);
        break;
      case 'moveDown':
        if (index < count - 1) onMove(index, index + 1);
        break;
      case 'remove':
        if (removable) onRemove(entry);
        break;
      default:
        break;
    }
  };

  return (
    <Animated.View
      testID={tid}
      pointerEvents={ghost ? 'none' : 'auto'}
      accessibilityElementsHidden={ghost}
      importantForAccessibility={ghost ? 'no-hide-descendants' : 'auto'}
      style={[
        styles.rowSlot,
        { minHeight: rowHeight, zIndex: lifted ? 1 : 0, transform: [{ translateY }] },
        ghost ? styles.ghost : null,
      ]}
    >
      {raised ? <View testID={`${tid}-lip`} style={styles.rowLip} /> : null}
      <Animated.View
        testID={`${tid}-face`}
        style={[
          styles.rowFace,
          { minHeight: rowHeight },
          raised ? styles.rowFaceRaised : null,
          { opacity: tint.opacity, transform: [{ translateY: sink.translateY }] },
        ]}
      >
        <Pressable
          testID={`${tid}-body`}
          onPress={pressable ? () => onPlay(id) : undefined}
          onPressIn={raised ? sink.onPressIn : tint.onPressIn}
          onPressOut={raised ? sink.onPressOut : tint.onPressOut}
          accessibilityRole={pressable ? 'button' : undefined}
          accessibilityLabel={meta ? `${title}, ${meta}` : title}
          accessibilityState={{ selected: current }}
          accessibilityActions={actions}
          onAccessibilityAction={onAction}
          style={styles.rowBody}
        >
          <View style={styles.leading}>
            {current ? (
              <NowPlayingBars active={playing} testID={`${tid}-bars`} />
            ) : (
              <Text
                testID={`${tid}-index`}
                style={[text.meta, styles.index]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {index + 1}
              </Text>
            )}
          </View>
          <PictureCover
            story={entry.story}
            width={QUEUE_COVER_SIZE}
            shape="square"
            radius={T.r.sm}
            flat
            placeholderIndex={placeholderIndex}
            style={styles.cover}
          />
          <View style={styles.rowText}>
            <Text style={[text.labelLarge, styles.title]} numberOfLines={1}>
              {title}
            </Text>
            {meta ? (
              <Text style={[text.meta, styles.meta]} numberOfLines={1}>
                {meta}
              </Text>
            ) : null}
          </View>
        </Pressable>
        {editing && removable ? (
          <>
            <IconButton
              icon="close"
              accessibilityLabel={t('queue.removeOne', { title })}
              onPress={() => onRemove(entry)}
              color={T.text2}
              testID={`${tid}-remove`}
              style={styles.control}
            />
            {draggable ? (
              <View
                testID={`${tid}-drag`}
                style={styles.control}
                accessible
                // Every row has one: the story tells them apart.
                accessibilityLabel={`${title}, ${t('queue.drag')}`}
                accessibilityActions={moveActions}
                onAccessibilityAction={onAction}
                {...handle.panHandlers}
              >
                <Icon name="drag" size={ICON_SIZE} color={T.text2} />
              </View>
            ) : null}
          </>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
});

// ─────────────────────────────────────────────────────────────
// Sheet
// ─────────────────────────────────────────────────────────────

export interface QueueSheetProps {
  visible: boolean;
  /** Who opened it: from the player a tap switches in place. */
  origin: QueueSheetOrigin;
  onClose: () => void;
  /** Open the player on this narration (it is already starting, with autoplay). */
  onOpenPlayer: (narrationId: string) => void;
  /** Show Masallarım (the sheet is closing). */
  onOpenLibrary: () => void;
}

/** Fixed while the sheet is open. */
interface OpenSizing {
  open: boolean;
  /** Undefined for an empty queue: the sheet hugs its empty state. */
  height: number | undefined;
  /** The current row is in view on open. */
  scrollY: number;
  /** The header was sized with the edit toggle: its slot stays while open. */
  toggle: boolean;
  /**
   * A message was up when an empty queue opened (a clear, the sheet closed
   * and opened again within its 6 s): the hugging empty state keeps room for
   * it below "Kütüphaneye git".
   */
  snackbarAtOpen: boolean;
}

export const QueueSheet: React.FC<QueueSheetProps> = observer(
  ({ visible, origin, onClose, onOpenPlayer, onOpenLibrary }) => {
    const T = useT();
    const styles = stylesFor(T);
    const text = textStylesFor(T);
    const { t } = useTranslation('player');
    const audio = useAudioPlayer();
    const insets = useSafeAreaInsets();
    const { height: windowHeight, width: windowWidth, fontScale } = useWindowDimensions();
    const reduced = useReducedMotion();
    const [editing, setEditing] = useState(false);

    const entries = queueStore.entries;
    const count = entries.length;
    const currentId = queueStore.currentId;
    const rowHeight = queueRowHeight(text, fontScale);
    const pitch = rowHeight + QUEUE_ROW_GAP;
    const spread = useCoverSpread(entries.map(entry => entry.story));

    // The height (and where the list starts) is decided when the sheet opens.
    const sizing = useRef<OpenSizing>({
      open: false,
      height: undefined,
      scrollY: 0,
      toggle: false,
      snackbarAtOpen: false,
    });
    const openedNow = visible && !sizing.current.open;
    if (openedNow) {
      const currentIndex = queueStore.index;
      const visibleRows = Math.min(count, QUEUE_VISIBLE_ROWS);
      const maxScroll = Math.max(0, (count - visibleRows) * pitch);
      sizing.current = {
        open: true,
        height:
          count > 0
            ? queueSheetHeight(
                { entries: count, fontScale, windowHeight, windowWidth, bottomInset: insets.bottom },
                text,
              )
            : undefined,
        scrollY:
          currentIndex >= QUEUE_VISIBLE_ROWS - 1 ? Math.min(maxScroll, (currentIndex - 1) * pitch) : 0,
        toggle: count >= 1,
        snackbarAtOpen: count === 0 && snackbar.getState().current !== null,
      };
    } else if (!visible && sizing.current.open) {
      sizing.current = { ...sizing.current, open: false };
    }
    const { height, scrollY, toggle: sizedWithToggle, snackbarAtOpen } = sizing.current;
    const snackbarReserve = queueEmptySnackbarReserve(insets.bottom, fontScale);

    // The empty state inside the fixed height: the body and the text block
    // are measured, so the icon shows only where it fits (V3-08).
    const [emptyViewport, setEmptyViewport] = useState<number | null>(null);
    const [emptyTextBlock, setEmptyTextBlock] = useState<number | null>(null);
    const onEmptyViewportLayout = useCallback((event: LayoutChangeEvent) => {
      setEmptyViewport(Math.round(event.nativeEvent.layout.height));
    }, []);
    const onEmptyTextLayout = useCallback((event: LayoutChangeEvent) => {
      setEmptyTextBlock(Math.round(event.nativeEvent.layout.height));
    }, []);
    // An empty state longer than its body (a large font) is shown from its
    // end: "Kütüphaneye git" stays in view above the message (RB-5).
    const emptyScrollRef = useRef<ScrollView>(null);
    const emptyViewportRef = useRef<number | null>(null);
    emptyViewportRef.current = emptyViewport;
    const onEmptyContentSize = useCallback((_width: number, contentHeight: number) => {
      const viewport = emptyViewportRef.current;
      if (viewport !== null && contentHeight > viewport) {
        emptyScrollRef.current?.scrollToEnd({ animated: false });
      }
    }, []);

    // ── Rows kept for their undo (RC-7) ──
    // A row that leaves stays mounted as a ghost for as long as its "Geri al"
    // is offered: the undo brings back the same view, cover already drawn.
    const ghosts = useRef(
      new Map<string, { entry: QueueEntry; until: number; placeholderIndex?: number }>(),
    ).current;
    const seenEntries = useRef(entries);
    // The pictures the rows had, so a ghost keeps its own.
    const seenSpread = useRef(spread);
    if (openedNow) {
      // A new opening starts with what the queue holds now.
      ghosts.clear();
      seenEntries.current = entries;
    } else if (seenEntries.current !== entries) {
      const now = Date.now();
      const kept = new Set(entries.map(entry => entry.narrationId));
      seenEntries.current.forEach(entry => {
        if (kept.has(entry.narrationId)) return;
        ghosts.set(entry.narrationId, {
          entry,
          until: now + QUEUE_GHOST_MS,
          placeholderIndex: seenSpread.current.get(entry.story.id),
        });
      });
      kept.forEach(id => ghosts.delete(id));
      ghosts.forEach((ghost, id) => {
        if (ghost.until <= now) ghosts.delete(id);
      });
      // A clear takes many at once: only the last few are worth keeping.
      while (ghosts.size > QUEUE_GHOST_MAX) {
        const oldest = ghosts.keys().next().value;
        if (oldest === undefined) break;
        ghosts.delete(oldest);
      }
      seenEntries.current = entries;
    }
    seenSpread.current = spread;
    const ghostRows = [...ghosts.values()];

    // Nothing left to edit.
    useEffect(() => {
      if (count === 0 && editing) setEditing(false);
    }, [count, editing]);

    // ── Playback ──
    // Outside the player the sheet starts to leave first (NL-07): the start
    // and the player's first render are heavy on a slow phone, and done in
    // the tap they held the sheet up for seconds.
    const pendingPlay = useRef<string | null>(null);
    const play = useCallback(
      (narrationId?: string) => {
        const id = narrationId ?? queueStore.entries[0]?.narrationId;
        if (!id) return;
        if (origin === 'player') {
          void playQueueFrom(id);
          return;
        }
        pendingPlay.current = id;
        onClose();
      },
      [onClose, origin],
    );

    // The commit that closed the sheet: BottomSheet (a child, so its effect
    // ran first) has started its exit, which runs on the UI thread. The start
    // comes before the navigation, so the player finds the narration pending,
    // renders at once and starts nothing twice.
    useEffect(() => {
      if (visible) return;
      const id = pendingPlay.current;
      if (!id) return;
      pendingPlay.current = null;
      void playQueueFrom(id);
      onOpenPlayer(id);
    }, [visible, onOpenPlayer]);

    const openLibrary = useCallback(() => {
      onClose();
      onOpenLibrary();
    }, [onClose, onOpenLibrary]);

    // ── Editing ──
    const remove = useCallback((entry: QueueEntry) => {
      removeFromQueueWithFeedback(entry.narrationId);
    }, []);
    const move = useCallback((from: number, to: number) => queueStore.move(from, to), []);
    const clear = useCallback(() => {
      const snapshot = queueStore.clear();
      setEditing(false);
      showToast.info(t('queue.cleared'), undefined, {
        label: t('common:undo'),
        onPress: () => queueStore.restoreSnapshot(snapshot),
      });
    }, [t]);

    // ── Drag ──
    // Every row moves on its own Animated.Value, the carried row included (it
    // never switches to another value mid-drag). The values belong to one
    // order and one drag: a drop, a new drag or a cut-short drag never writes
    // 0 into a value a native animation has driven. On Fabric the end event
    // of a native animation (also one JS has stopped) arrives later with the
    // value it reached, and JS writes it back and commits it to the view
    // (see usePressTint): a `setValue(0)` at the drop was overwritten by a
    // shift of a whole pitch, and the row was drawn over its neighbour, which
    // looked like rows vanishing (item 10). Instead the rows that moved get
    // fresh values at 0, in the same render as the new order; their old
    // values are detached, so a late end event moves nothing.
    const order = entries.map(entry => entry.narrationId).join('|');
    const shiftSet = useRef<ShiftSet>({ order, values: new Map(), touched: new Set() });
    if (shiftSet.current.order !== order) shiftSet.current = renewShifts(shiftSet.current, order);
    const [dragId, setDragId] = useState<string | null>(null);
    const liftedRef = useRef<string | null>(null);
    liftedRef.current = dragId;
    const dragState = useRef({ from: -1, hover: -1, id: '' });
    // A newer drag (or a reset) makes the end of an older return motion stale.
    const dragToken = useRef(0);
    const latest = useRef({ entries, pitch, reduced });
    latest.current = { entries, pitch, reduced };

    /** The value a row draws its translation from. */
    const shiftOf = useCallback((id: string) => {
      const set = shiftSet.current;
      let value = set.values.get(id);
      if (!value) {
        value = new Animated.Value(0);
        set.values.set(id, value);
      }
      return value;
    }, []);

    /** The same, about to move: it is replaced by a fresh one after this drag. */
    const moveOf = useCallback(
      (id: string) => {
        shiftSet.current.touched.add(id);
        return shiftOf(id);
      },
      [shiftOf],
    );

    /** Fresh values for the rows this drag moved (drawn by the next render). */
    const renew = useCallback(() => {
      dragToken.current += 1;
      shiftSet.current = renewShifts(shiftSet.current, shiftSet.current.order);
    }, []);

    const resetDrag = useCallback(() => {
      if (dragState.current.from < 0 && liftedRef.current === null) return;
      dragState.current = { from: -1, hover: -1, id: '' };
      renew();
      setDragId(null);
    }, [renew]);

    const drag = useRef<DragController>({
      begin(index) {
        const entry = latest.current.entries[index];
        if (!entry || dragState.current.from >= 0) return;
        // A row still returning from the last drag starts from a fresh value.
        renew();
        dragState.current = { from: index, hover: index, id: entry.narrationId };
        setDragId(entry.narrationId);
      },
      move(dy) {
        const state = dragState.current;
        if (state.from < 0) return;
        const { entries: rows, pitch: step, reduced: still } = latest.current;
        moveOf(state.id).setValue(dy);
        const hover = Math.min(Math.max(state.from + Math.round(dy / step), 0), rows.length - 1);
        if (hover === state.hover) return;
        state.hover = hover;
        // The rows between the lifted one and the finger make room by one pitch.
        rows.forEach((row, i) => {
          if (i === state.from) return;
          const to = state.from < i && i <= hover ? -step : hover <= i && i < state.from ? step : 0;
          const set = shiftSet.current;
          const moved = set.touched.has(row.narrationId);
          // Untouched rows rest at 0: a long queue starts no idle animations.
          if ((moved ? targetOf(set.values.get(row.narrationId)) : 0) === to) return;
          const value = moveOf(row.narrationId);
          shiftTargets.set(value, to);
          animateTo(value, to, 'fast', still);
        });
      },
      end() {
        const { from, hover, id } = dragState.current;
        if (from < 0) return;
        dragState.current = { from: -1, hover: -1, id: '' };
        if (hover >= 0 && hover !== from) {
          // The new order renews the moved rows' values in the render that
          // draws it, with nothing lifted: one batched render, no frame with
          // a row offset in its new place.
          queueStore.move(from, hover);
          renew();
          setDragId(null);
          return;
        }
        const token = dragToken.current;
        animateTo(moveOf(id), 0, 'fast', latest.current.reduced, {
          onDone: () => {
            // A newer drag already took over (its begin renewed the values).
            if (token !== dragToken.current) return;
            renew();
            setDragId(null);
          },
        });
      },
    }).current;

    // The order changed under a drag (an add or a remove from elsewhere): the
    // drag ends; the rows already drew at 0 in their new places.
    useLayoutEffect(() => {
      if (dragState.current.from >= 0) resetDrag();
    }, [order, resetDrag]);

    // A drag cut short (the sheet closed under the finger, edit mode ended)
    // leaves no row lifted: the sheet stays mounted, and its next open would
    // find the list unable to scroll.
    useEffect(() => {
      if (!visible || !editing) resetDrag();
    }, [visible, editing, resetDrag]);

    // ── Derived ──
    // The context is live while the player holds (or is starting) its story;
    // one stored from an earlier session with nothing loaded plays nothing.
    const liveContext =
      !!currentId && (audio.audioId === currentId || audio.pendingNarrationId === currentId);
    const playingCurrent = audio.isPlaying && liveContext;
    const endedOnLast =
      !!currentId && queueStore.next === null && audio.storyEnded && audio.audioId === currentId;
    const showPlayAll = !editing && count > 0 && (!liveContext || endedOnLast);
    // From one entry on (RC-2): a queue of one is edited too.
    const showToggle = count > 0;

    // A toggle that goes away while open (the queue emptied) leaves an empty
    // slot of its height: the title keeps its size and nothing moves.
    const headerTrailing = showToggle ? (
      <Button
        variant="text"
        size="sm"
        label={editing ? t('queue.done') : t('queue.edit')}
        onPress={() => setEditing(value => !value)}
        testID="queue-edit-toggle"
      />
    ) : sizedWithToggle ? (
      <View style={{ height: smallTextButtonHeight(fontScale) }} testID="queue-edit-toggle-slot" />
    ) : undefined;

    const emptyState = ({
      icon,
      compact,
      hidden = false,
      reserve = 0,
    }: {
      icon: boolean;
      compact: boolean;
      /** Not measured yet: drawn once its icon is decided, so nothing jumps. */
      hidden?: boolean;
      /** Extra room at the bottom of the hugging state (a message up at open). */
      reserve?: number;
    }) => (
      <View
        style={[
          compact ? styles.emptyCompact : styles.empty,
          reserve > 0 ? { paddingBottom: SPACE.sm + reserve } : null,
          hidden ? styles.hidden : null,
        ]}
        testID="queue-empty"
      >
        {icon ? (
          <View style={styles.emptyIcon}>
            <StateIcon icon="queue" size={EMPTY_ICON_SIZE} testID="queue-empty-icon" />
          </View>
        ) : null}
        <View
          style={styles.emptyText}
          onLayout={compact ? onEmptyTextLayout : undefined}
          testID="queue-empty-text"
        >
          <Text style={[text.heading, styles.emptyTitle]}>{t('queue.empty.title')}</Text>
          <Text style={[text.bodySmall, styles.emptyHint]}>{t('queue.empty.hint')}</Text>
          <Button
            variant="secondary"
            size="md"
            label={t('queue.empty.action')}
            onPress={openLibrary}
            testID="queue-empty-action"
            style={styles.emptyAction}
          />
        </View>
      </View>
    );

    let body: React.ReactNode;
    if (count === 0 && height === undefined) {
      body = emptyState({
        icon: true,
        compact: false,
        reserve: snackbarAtOpen ? snackbarReserve : 0,
      });
    } else {
      // Emptied while open, inside the height it opened with: it ends above
      // the sheet's snackbar, and shows the icon when there is room for it.
      // The list stays in its place, folded, with the rows its undo may bring
      // back (RC-7): the three slots below never change their order.
      const emptied = count === 0;
      let emptyBody: React.ReactNode = null;
      if (emptied) {
        const measured = emptyViewport !== null && emptyTextBlock !== null;
        const iconFits =
          measured && queueEmptyIconFits(emptyViewport, snackbarReserve, emptyTextBlock);
        emptyBody = (
          <ScrollView
            ref={emptyScrollRef}
            testID="queue-empty-scroll"
            style={styles.fill}
            contentContainerStyle={[styles.emptyScroll, { paddingBottom: snackbarReserve }]}
            bounces={false}
            onLayout={onEmptyViewportLayout}
            onContentSizeChange={onEmptyContentSize}
          >
            {emptyState({ icon: iconFits, compact: true, hidden: !measured })}
          </ScrollView>
        );
      }
      body = (
        <>
          {emptied ? null : (
            <View style={styles.summary} testID="queue-summary">
              <Text style={[text.meta, styles.summaryText]} numberOfLines={1} testID="queue-summary-text">
                {queueSummaryText(count, queueStore.totalMinutes)}
              </Text>
              {editing ? (
                // In the summary, not after the last row: the sheet keeps the
                // height it opened with, so a button after the rows would sit
                // below the fold of a short queue. A face on its lip keeps the
                // row at its 40dp, as "Sırayı çal" does.
                <Button
                  variant="secondary"
                  tone="danger"
                  size="sm"
                  label={t('queue.clear')}
                  onPress={clear}
                  testID="queue-clear"
                />
              ) : showPlayAll ? (
                <Button
                  variant="primary"
                  size="sm"
                  icon="play"
                  label={t('queue.playAll')}
                  onPress={() => play()}
                  testID="queue-play-all"
                />
              ) : null}
            </View>
          )}
          <ScrollView
            testID="queue-list"
            style={emptied ? styles.folded : styles.fill}
            pointerEvents={emptied ? 'none' : 'auto'}
            accessibilityElementsHidden={emptied}
            importantForAccessibility={emptied ? 'no-hide-descendants' : 'auto'}
            contentContainerStyle={styles.list}
            contentOffset={scrollY > 0 ? { x: 0, y: scrollY } : undefined}
            scrollEnabled={dragId === null && !emptied}
            bounces={false}
          >
            {/* One keyed list: a row that comes back from its ghost is the same view (RC-7). */}
            {[
              ...entries.map((entry, index) => (
                <QueueRow
                  key={entry.narrationId}
                  entry={entry}
                  index={index}
                  count={count}
                  current={entry.narrationId === currentId}
                  playing={playingCurrent && entry.narrationId === currentId}
                  editing={editing}
                  lifted={dragId === entry.narrationId}
                  rowHeight={rowHeight}
                  placeholderIndex={spread.get(entry.story.id)}
                  translateY={shiftOf(entry.narrationId)}
                  drag={drag}
                  onPlay={play}
                  onRemove={remove}
                  onMove={move}
                />
              )),
              ...ghostRows.map(ghost => (
                <QueueRow
                  key={ghost.entry.narrationId}
                  entry={ghost.entry}
                  index={0}
                  count={count}
                  current={false}
                  playing={false}
                  editing={false}
                  lifted={false}
                  rowHeight={rowHeight}
                  placeholderIndex={ghost.placeholderIndex}
                  translateY={GHOST_SHIFT}
                  drag={drag}
                  onPlay={play}
                  onRemove={remove}
                  onMove={move}
                  ghost
                />
              )),
            ]}
          </ScrollView>
          {emptyBody}
        </>
      );
    }

    return (
      <BottomSheet
        visible={visible}
        onClose={onClose}
        onClosed={() => {
          setEditing(false);
          // Nothing to undo into a closed sheet.
          ghosts.clear();
          // The next open has another height: its empty state is measured again.
          setEmptyViewport(null);
          setEmptyTextBlock(null);
        }}
        title={t('queue.title')}
        headerTrailing={headerTrailing}
        height={height}
        contentStyle={styles.content}
        testID="queue-sheet"
      >
        {body}
      </BottomSheet>
    );
  },
);

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    content: { paddingHorizontal: 0 },
    fill: { flex: 1 },
    // The list of an emptied sheet: still mounted for its ghosts, no room taken.
    folded: { flexGrow: 0, flexShrink: 0, height: 0, opacity: 0 },
    summary: {
      minHeight: QUEUE_SUMMARY_HEIGHT,
      paddingHorizontal: T.screenPadH,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.md,
    },
    summaryText: { flex: 1, minWidth: 0, color: T.text2 },
    // Row padding (8) puts the covers on the screen gutter.
    list: { paddingHorizontal: T.screenPadH - SPACE.sm },
    rowSlot: { marginBottom: QUEUE_ROW_GAP },
    // A removed row kept for its undo: no height, no gap, drawn but not seen.
    ghost: { height: 0, minHeight: 0, marginBottom: 0, overflow: 'hidden', opacity: 0 },
    rowLip: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: LIP.md,
      bottom: -LIP.md,
      borderRadius: T.r.lg,
      backgroundColor: T.lip,
    },
    rowFace: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: T.r.lg,
      paddingHorizontal: SPACE.sm,
    },
    rowFaceRaised: { backgroundColor: T.surface2 },
    rowBody: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
    leading: { width: QUEUE_LEADING_WIDTH, alignItems: 'center', justifyContent: 'center' },
    index: { color: T.text3, textAlign: 'center' },
    cover: { marginLeft: SPACE.sm },
    rowText: { flex: 1, minWidth: 0, marginLeft: SPACE.md, justifyContent: 'center' },
    title: { color: T.text },
    meta: { color: T.text2 },
    control: {
      width: QUEUE_CONTROL_SIZE,
      height: QUEUE_CONTROL_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bars: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: SPACE.xxs,
      height: BAR_HEIGHT,
    },
    barSlot: {
      width: BAR_WIDTH,
      height: BAR_HEIGHT,
      borderRadius: BAR_WIDTH / 2,
      overflow: 'hidden',
    },
    bar: {
      width: BAR_WIDTH,
      height: BAR_HEIGHT,
      borderRadius: BAR_WIDTH / 2,
      backgroundColor: T.action,
    },
    empty: {
      alignItems: 'center',
      paddingHorizontal: T.screenPadH,
      paddingTop: SPACE.lg,
      paddingBottom: SPACE.sm,
    },
    emptyCompact: {
      alignItems: 'center',
      paddingHorizontal: T.screenPadH,
      paddingVertical: EMPTY_COMPACT_PAD,
    },
    emptyScroll: { flexGrow: 1, justifyContent: 'center' },
    // The icon's gap is its own, so the text block measures the same with it.
    emptyIcon: { marginBottom: SPACE.xl },
    emptyText: { alignSelf: 'stretch', alignItems: 'center' },
    emptyTitle: { textAlign: 'center' },
    emptyHint: { marginTop: SPACE.sm, textAlign: 'center', maxWidth: 300 },
    hidden: { opacity: 0 },
    emptyAction: { marginTop: SPACE.xl, alignSelf: 'center' },
  });

const stylesFor = themedStyles(makeStyles);

export default QueueSheet;
