/**
 * TimerSheet: "Uyku zamanlayıcısı" (design v4 playful, SPEC-audio 7.5).
 *
 *   [ Uyku zamanlayıcısı ............................. (Switch) ]
 *   [ Masal bitince | Süre dolunca ]
 *   +-------------------- timer-body, one fixed height --------------------+
 *   | duration: minute wheel / stop line / quick picks or the countdown    |
 *   | stories:  stepper (with a queue) / stop line / upcoming or the hint  |
 *   +----------------------------------------------------------------------+
 *   [ Son bir dakikada sesi yavaşça kıs ......................... (Switch) ]
 *
 * The body has one height in every mode and state (`timerBodyHeight`), so
 * the title, the switch and the mode choice never move when the mode, the
 * story count or the running state changes. Content is top-aligned in it.
 *
 *   - "Süre dolunca": the minute wheel (1 to 180) and its stop line. The
 *     timer starts, or restarts, once the wheel has rested for a second. The
 *     46dp slot under the line holds the quick picks while no duration runs
 *     and the countdown with "+5 dk" while one does (they cross-fade); the
 *     wheel stays, and the line names the real deadline.
 *   - "Masal bitince": with stories queued after the playing one, a stepper
 *     (up to all of them), the stop line and "Sırada: ..."; without, the stop
 *     line, why there is nothing to count and "Sırayı aç".
 *
 * Off, nothing is dimmed or blocked: the switch turns the timer on in the
 * mode shown, and every other control turns it on in its own mode (a mode,
 * a story count, a quick pick, a wheel that rested). Everything applies at
 * once through `SleepTimerService`; there is no Uygula or Vazgeç.
 *
 * Rendering: the sheet re-renders when the timer's state changes, not every
 * second. The countdown is its own observer (`Countdown`), the wheel is
 * memoised and gets stable callbacks, and the sheet's local state is set
 * while it renders the opening (no remount of the wheel). A stop line keeps
 * the time it shows until its inputs change or the time moves by 30 s, so it
 * never flips between two minutes.
 *
 * The two mode bodies stay mounted on top of each other inside the body and
 * cross-fade on the native driver, from the segmented control's own pill
 * position (`position`): the body changes in the frames the pill slides in,
 * at the press, before the sheet renders the new mode (LR-3R). The hidden
 * one takes no touches and is hidden from screen readers. A mode switch is
 * an opacity change, never a mount of the wheel (LR-3: the stories body
 * stayed up to 3.5 s under the "Süre dolunca" pill while the wheel mounted).
 * The wheel mounts with the sheet when it opens in "Süre dolunca", else once
 * the sheet has come up (`onOpened`), or at the switch if that comes first;
 * it keeps its scroll position while hidden and is set to the timer's minute
 * when it is shown again. It mounts with only the rows around its minute
 * (`deferRows`) and gets the rest once the sheet is up and the wheel is in
 * use, so the opening commit stays light (LR-4R: the tile took 1.1 s to open
 * the sheet while 180 rows mounted).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PixelRatio, ScrollView, StyleSheet, Text, TextStyle, View } from 'react-native';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '../design/BottomSheet';
import { Button } from '../design/Button';
import { Chip, SegmentedControl, Switch, SwitchRow } from '../design/controls';
import { SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { animateTo, useReducedMotion } from '../../theme/motion';
import sleepTimerService, { SleepTimerMode } from '../../services/SleepTimerService';
import { MinuteWheel, MinuteWheelHandle, WHEEL_HEIGHT, WHEEL_TOP_PAD } from './MinuteWheel';
import { Stepper } from './Stepper';
import { SLEEP_DRAIN_HEIGHT, SleepDrainLine } from './SleepDrainLine';
import {
  ShownStop,
  TIMER_MAX_MINUTES,
  TIMER_MIN_MINUTES,
  TimerChip,
  UpcomingStory,
  clockParams,
  durationStop,
  formatCountdown,
  holdStop,
  maxStoryCount,
  storiesValueText,
  storyStop,
  timerChips,
} from './playerMath';

/** The wheel has "rested" after this long without moving. */
export const WHEEL_REST_MS = 1000;
/** How often the clock times are refreshed while nothing else changes. */
const CLOCK_REFRESH_MS = 15000;
/** Every text in the body grows with the system font only this far. */
export const TIMER_BODY_MAX_FONT_SCALE = 1.3;
/** The quick picks and the countdown row share this slot (dp). */
export const TIMER_SLOT_HEIGHT = 46;
/** One line of the stop line; it has SPACE.sm above and below. */
const STOP_LINE_HEIGHT = 20;

/**
 * Height of the timer body: the wheel block, the stop line and the slot
 * (194dp at font scale 1, 200dp at 1.3 and above). The stories layouts fit
 * inside it at 1.3: 74 + 68 + 52 with a queue, 68 + 52 + 48 without.
 */
export function timerBodyHeight(fontScale: number): number {
  const scale = Math.min(
    Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1,
    TIMER_BODY_MAX_FONT_SCALE,
  );
  return (
    WHEEL_TOP_PAD +
    WHEEL_HEIGHT +
    2 * SPACE.sm +
    Math.ceil(STOP_LINE_HEIGHT * scale) +
    TIMER_SLOT_HEIGHT
  );
}

export interface TimerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The exit finished (start what comes next here, such as another sheet). */
  onClosed?: () => void;
  /** Title of the story that is playing. */
  currentTitle: string;
  /** Audio seconds left in the playing story; null while unknown. */
  remainingSec: number | null;
  /** Stories queued after the playing one, with their real lengths. */
  queue: readonly UpcomingStory[];
  /** Playback speed: story lengths are divided by it. */
  speed: number;
  /** "Sırayı aç" in the stories mode without a queue; no button without it. */
  onOpenQueue?: () => void;
}

const CHIP_KEYS: Record<TimerChip['kind'], string> = {
  thisStory: 'timer.chipThisStory',
  withNext: 'timer.chipWithNext',
  last: 'timer.chipLast',
};

/**
 * One mode's body, over the other one in the fixed-height body. Hidden, it is
 * transparent, takes no touches and is hidden from screen readers.
 */
const ModeBody: React.FC<{
  shown: boolean;
  opacity: Animated.Value | Animated.AnimatedInterpolation<number>;
  testID: string;
  children: React.ReactNode;
}> = ({ shown, opacity, testID, children }) => (
  <Animated.View
    pointerEvents={shown ? 'box-none' : 'none'}
    accessibilityElementsHidden={!shown}
    importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
    style={[StyleSheet.absoluteFill, { opacity }]}
    testID={testID}
  >
    {children}
  </Animated.View>
);

/** The only reader of the seconds: the rest of the sheet never renders for a tick. */
const Countdown: React.FC<{ style: TextStyle }> = observer(({ style }) => {
  const store = sleepTimerService.store;
  return (
    <Text
      style={style}
      numberOfLines={1}
      maxFontSizeMultiplier={TIMER_BODY_MAX_FONT_SCALE}
      testID="timer-countdown"
    >
      {formatCountdown(store.isDurationRunning ? store.remainingSeconds : store.durationMin * 60)}
    </Text>
  );
});

export const TimerSheet: React.FC<TimerSheetProps> = observer(
  ({ visible, onClose, onClosed, currentTitle, remainingSec, queue, speed, onOpenQueue }) => {
    const T = useT();
    const { t, i18n } = useTranslation('player');
    const styles = stylesFor(T);
    const reduced = useReducedMotion();
    const store = sleepTimerService.store;
    const language = i18n.language;

    const maxStories = maxStoryCount(queue);
    const hasQueue = queue.length > 0;

    const [draftMin, setDraftMin] = useState(store.durationMin);
    // A minute the wheel moved to that has not rested yet.
    const [pendingMin, setPendingMin] = useState<number | null>(null);
    // "Son seçim": the last duration as it was when the sheet opened.
    const [lastUsedMin, setLastUsedMin] = useState<number | null>(store.lastDurationMin);
    const [, setClock] = useState(0);
    // What each body's stop line shows (both bodies are drawn).
    const storyStopShown = useRef<ShownStop | null>(null);
    const durationStopShown = useRef<ShownStop | null>(null);
    // The "Süre dolunca" body is wanted before its mode is picked: from the
    // end of the sheet's enter until the sheet has gone again.
    const [wheelWanted, setWheelWanted] = useState(false);
    // The sheet's enter has ended in this opening; the wheel has all its rows.
    const [sheetUp, setSheetUp] = useState(false);
    const [allRows, setAllRows] = useState(false);

    // Set while rendering the opening, so the first frame of the sheet (and
    // the wheel's first offset) already has the values of this opening.
    const [openFor, setOpenFor] = useState(false);
    if (visible !== openFor) {
      setOpenFor(visible);
      if (visible) {
        setDraftMin(store.durationMin);
        setLastUsedMin(store.lastDurationMin);
        setPendingMin(null);
        storyStopShown.current = null;
        durationStopShown.current = null;
      }
    }

    const wheelRef = useRef<MinuteWheelHandle>(null);
    const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingRef = useRef<number | null>(null);

    const clearRest = useCallback(() => {
      if (restTimer.current) clearTimeout(restTimer.current);
      restTimer.current = null;
      pendingRef.current = null;
      setPendingMin(null);
    }, []);

    /** A minute the wheel rested on (or the sheet closed on) starts the timer with it. */
    const flushRest = useCallback(() => {
      const minutes = pendingRef.current;
      if (restTimer.current) clearTimeout(restTimer.current);
      restTimer.current = null;
      pendingRef.current = null;
      setPendingMin(null);
      if (minutes !== null && sleepTimerService.store.mode === 'duration') {
        sleepTimerService.startDuration(minutes);
      }
    }, []);

    useEffect(() => {
      if (!visible) {
        // Closed before the wheel rested: the choice still counts.
        flushRest();
        return;
      }
      // A sheet opened again while it was leaving still has its wheel.
      wheelRef.current?.setMinute(sleepTimerService.store.durationMin, false);
      const interval = setInterval(() => setClock(tick => tick + 1), CLOCK_REFRESH_MS);
      return () => clearInterval(interval);
    }, [visible, flushRest]);

    useEffect(
      () => () => {
        if (restTimer.current) clearTimeout(restTimer.current);
      },
      [],
    );

    // ── Actions ──────────────────────────────────────────────

    const handleSwitch = (next: boolean) => {
      if (!next) {
        clearRest();
        sleepTimerService.turnOff();
        return;
      }
      // A wheel still moving starts the timer on its own minute.
      if (pendingRef.current !== null && sleepTimerService.store.mode === 'duration') {
        flushRest();
        return;
      }
      clearRest();
      if (sleepTimerService.store.mode === 'duration') {
        // The minute the wheel shows, also one the switch dropped before it rested.
        sleepTimerService.startDuration(draftMin);
        return;
      }
      sleepTimerService.turnOn({ maxStories });
    };

    const handleMode = (mode: SleepTimerMode) => {
      clearRest();
      sleepTimerService.setMode(mode, { maxStories });
      if (!sleepTimerService.store.active) sleepTimerService.turnOn({ maxStories });
      const minutes = sleepTimerService.store.durationMin;
      setDraftMin(minutes);
      // The wheel stayed mounted: it shows the timer's minute, not one it was
      // left on before it rested (a mounting wheel opens on `draftMin`).
      wheelRef.current?.setMinute(minutes, false);
    };

    const handleOpened = useCallback(() => {
      setWheelWanted(true);
      setSheetUp(true);
    }, []);
    const handleClosed = useCallback(() => {
      // The window is gone and the wheel with it: the next opening in
      // "Masal bitince" comes up without it again, and every opening with
      // only the rows around its minute.
      setWheelWanted(false);
      setSheetUp(false);
      setAllRows(false);
      onClosed?.();
    }, [onClosed]);

    const handleStories = (next: number) => {
      sleepTimerService.setStoryCount(next, maxStories);
      if (!sleepTimerService.store.active) sleepTimerService.turnOn({ maxStories });
    };

    const handleWheel = useCallback(
      (minutes: number) => {
        setDraftMin(minutes);
        pendingRef.current = minutes;
        setPendingMin(minutes);
        if (restTimer.current) clearTimeout(restTimer.current);
        restTimer.current = setTimeout(flushRest, WHEEL_REST_MS);
      },
      [flushRest],
    );

    const handleChip = (minutes: number) => {
      clearRest();
      setDraftMin(minutes);
      wheelRef.current?.setMinute(minutes);
      sleepTimerService.startDuration(minutes);
    };

    const valueText = useCallback(
      (minutes: number) =>
        minutes === 1 ? t('timer.minutesValueOne') : t('timer.minutesValue', { n: minutes }),
      [t],
    );

    // ── Derived ──────────────────────────────────────────────

    const nowMs = Date.now();
    const off = !store.active;
    const running = store.isDurationRunning && store.endsAtMs !== null;
    const offHint = off ? t('timer.offHint') : undefined;
    const storyCount = Math.min(
      maxStories,
      Math.max(1, store.active && store.mode === 'stories' ? store.storiesLeft : store.storyCount),
    );

    // The stop lines of both bodies: their inputs, the time they name and the copy.
    const stop = storyStop({ currentTitle, remainingSec, queue, storyCount, speed, nowMs });
    const storyShown = holdStop(
      storyStopShown.current,
      `stories|${stop.title}|${storyCount}|${speed}`,
      stop.at,
    );
    storyStopShown.current = storyShown;
    const storiesStopText =
      storyShown.atMs !== null
        ? t('timer.storyStop', { title: stop.title, ...clockParams(new Date(storyShown.atMs), language) })
        : t('timer.storyStopNoTime', { title: stop.title });

    let durationStopText: string;
    if (running && pendingMin === null && store.endsAtMs !== null) {
      // The real deadline (also after "+5 dk"), not the wheel's value.
      const shown = holdStop(durationStopShown.current, `running|${store.endsAtMs}`, new Date(store.endsAtMs));
      durationStopShown.current = shown;
      durationStopText = t('timer.stopsAt', clockParams(new Date(shown.atMs as number), language));
    } else {
      // While the wheel moves, or before a duration runs, the line follows the wheel.
      const shown = holdStop(durationStopShown.current, `wheel|${draftMin}`, durationStop(draftMin, nowMs));
      durationStopShown.current = shown;
      durationStopText = t('timer.durationStop', {
        n: draftMin,
        ...clockParams(new Date(shown.atMs as number), language),
      });
    }

    const chips = timerChips({
      remainingSec,
      nextDurationSec: queue[0]?.durationSec ?? null,
      lastDurationMin: lastUsedMin,
      speed,
    });

    // The slot: quick picks (0) or the countdown (1), cross-faded.
    const slot = useRef(new Animated.Value(running ? 1 : 0)).current;
    const shownRunning = useRef(running);
    useEffect(() => {
      if (shownRunning.current === running) return;
      shownRunning.current = running;
      animateTo(slot, running ? 1 : 0, 'fast', reduced, { fade: true });
    }, [running, reduced, slot]);
    useEffect(() => () => slot.stopAnimation(), [slot]);
    const chipsOpacity = useMemo(
      () => slot.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' }),
      [slot],
    );

    // The bodies: stories (0) or duration (1), cross-faded by the segmented
    // control's own pill position (LR-3R): the body changes in the native
    // frames the pill slides in, at the press, not once the sheet has
    // rendered the new mode.
    const mode = store.mode;
    const modePos = useRef(new Animated.Value(mode === 'duration' ? 1 : 0)).current;
    useEffect(() => () => modePos.stopAnimation(), [modePos]);
    const storiesOpacity = useMemo(
      () => modePos.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' }),
      [modePos],
    );
    const durationOpacity = useMemo(
      () => modePos.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
      [modePos],
    );
    // Once shown in an opening, the wheel stays until the sheet has gone.
    if (visible && mode === 'duration' && !wheelWanted) setWheelWanted(true);
    const wheelMounted = wheelWanted || mode === 'duration';
    // All 180 rows of the wheel once the sheet is up and the wheel is in use
    // (LR-4R); until then only the rows around its minute, so the opening
    // commit stays light. Kept until the sheet has gone.
    if (sheetUp && mode === 'duration' && !allRows) setAllRows(true);

    const segments = useMemo(
      () => [
        { value: 'stories' as const, label: t('timer.modeStories') },
        { value: 'duration' as const, label: t('timer.modeDuration') },
      ],
      [t],
    );

    const bodyHeight = timerBodyHeight(PixelRatio.getFontScale());
    const stopColor = { color: off ? T.text2 : T.text };

    return (
      <BottomSheet
        visible={visible}
        onClose={onClose}
        onOpened={handleOpened}
        onClosed={handleClosed}
        title={t('timer.title')}
        headerTrailing={
          <Switch
            value={store.active}
            onValueChange={handleSwitch}
            accessibilityLabel={t('timer.title')}
            testID="timer-switch"
          />
        }
        scrollable
        contentStyle={styles.content}
        testID="timer-sheet"
      >
        <SegmentedControl
          segments={segments}
          value={mode}
          onChange={handleMode}
          position={modePos}
          accessibilityLabel={t('timer.modeLabel')}
          testID="timer-mode"
          style={styles.segments}
        />

        <View testID="timer-body" style={[styles.body, { height: bodyHeight }]}>
          <ModeBody shown={mode === 'stories'} opacity={storiesOpacity} testID="timer-stories">
            {hasQueue ? (
              <View style={styles.storiesRow} testID="timer-stories-row">
                <View style={styles.storiesText}>
                  <Text style={styles.rowLabel} maxFontSizeMultiplier={TIMER_BODY_MAX_FONT_SCALE}>
                    {t('timer.howMany')}
                  </Text>
                  <Text style={styles.rowDetail} maxFontSizeMultiplier={TIMER_BODY_MAX_FONT_SCALE}>
                    {t('timer.howManyHint')}
                  </Text>
                </View>
                <Stepper
                  value={storyCount}
                  min={1}
                  max={maxStories}
                  onChange={handleStories}
                  accessibilityLabel={t('timer.howMany')}
                  accessibilityHint={offHint}
                  valueText={storiesValueText(storyCount)}
                  decrementLabel={t('timer.fewerStories')}
                  incrementLabel={t('timer.moreStories')}
                  testID="timer-stepper"
                />
              </View>
            ) : null}
            <Text
              style={[styles.stopLine, stopColor]}
              numberOfLines={2}
              maxFontSizeMultiplier={TIMER_BODY_MAX_FONT_SCALE}
              testID="timer-stop-line-stories"
            >
              {storiesStopText}
            </Text>
            {hasQueue ? (
              <Text
                style={styles.note}
                numberOfLines={2}
                maxFontSizeMultiplier={TIMER_BODY_MAX_FONT_SCALE}
                testID="timer-upcoming"
              >
                {t('timer.upcoming', { titles: queue.map(entry => entry.title).join(', ') })}
              </Text>
            ) : (
              <>
                <Text
                  style={styles.note}
                  numberOfLines={2}
                  maxFontSizeMultiplier={TIMER_BODY_MAX_FONT_SCALE}
                  testID="timer-queue-hint"
                >
                  {t('timer.queueHint')}
                </Text>
                {onOpenQueue ? (
                  <Button
                    label={t('queue.open')}
                    variant="text"
                    onPress={onOpenQueue}
                    testID="timer-open-queue"
                    style={styles.openQueue}
                  />
                ) : null}
              </>
            )}
          </ModeBody>
          {wheelMounted ? (
            <ModeBody shown={mode === 'duration'} opacity={durationOpacity} testID="timer-wheel">
              <View style={styles.wheel}>
                <MinuteWheel
                  ref={wheelRef}
                  deferRows={!allRows}
                  value={draftMin}
                  min={TIMER_MIN_MINUTES}
                  max={TIMER_MAX_MINUTES}
                  onChange={handleWheel}
                  unit={t('timer.minutesUnit')}
                  accessibilityLabel={t('timer.wheelLabel')}
                  accessibilityHint={offHint}
                  valueText={valueText}
                  decrementLabel={t('timer.fewerMinutes')}
                  incrementLabel={t('timer.moreMinutes')}
                />
              </View>
              <Text
                style={[styles.stopLine, styles.stopLineCentered, stopColor]}
                numberOfLines={1}
                maxFontSizeMultiplier={TIMER_BODY_MAX_FONT_SCALE}
                testID="timer-stop-line-duration"
              >
                {durationStopText}
              </Text>
              <View style={styles.slot} testID="timer-slot">
                <Animated.View
                  pointerEvents={running ? 'none' : 'box-none'}
                  accessibilityElementsHidden={running}
                  importantForAccessibility={running ? 'no-hide-descendants' : 'auto'}
                  style={[StyleSheet.absoluteFill, { opacity: chipsOpacity }]}
                  testID="timer-chips-layer"
                >
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.chips}
                    contentContainerStyle={styles.chipsContent}
                    testID="timer-chips"
                  >
                    {chips.map(chip => (
                      <Chip
                        key={chip.kind}
                        label={t(CHIP_KEYS[chip.kind], { n: chip.minutes })}
                        role="button"
                        onPress={() => handleChip(chip.minutes)}
                        testID={`timer-chip-${chip.kind}`}
                        style={styles.chip}
                      />
                    ))}
                  </ScrollView>
                </Animated.View>
                <Animated.View
                  pointerEvents={running ? 'box-none' : 'none'}
                  accessibilityElementsHidden={!running}
                  importantForAccessibility={running ? 'auto' : 'no-hide-descendants'}
                  style={[StyleSheet.absoluteFill, styles.countdownRow, { opacity: slot }]}
                  testID="timer-running"
                >
                  <View style={styles.countdown}>
                    <Countdown style={styles.countdownValue} />
                    <Text
                      style={styles.countdownUnit}
                      numberOfLines={1}
                      maxFontSizeMultiplier={TIMER_BODY_MAX_FONT_SCALE}
                    >
                      {t('timer.left')}
                    </Text>
                  </View>
                  <Button
                    label={t('timer.addFive')}
                    accessibilityLabel={t('timer.addFiveLabel')}
                    variant="secondary"
                    size="sm"
                    pressDelay={0}
                    onPress={() => sleepTimerService.addMinutes()}
                    testID="timer-add-five"
                  />
                  {running ? <SleepDrainLine style={styles.countdownDrain} testID="timer-drain" /> : null}
                </Animated.View>
              </View>
            </ModeBody>
          ) : null}
        </View>

        <SwitchRow
          label={t('timer.fadeOut')}
          value={store.fadeOut}
          onValueChange={next => sleepTimerService.setFadeOut(next)}
          testID="timer-fade"
        />
      </BottomSheet>
    );
  },
);

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    content: { paddingHorizontal: 0 },
    segments: { marginHorizontal: T.screenPadH, marginBottom: SPACE.md },
    body: { overflow: 'hidden' },
    storiesRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.md,
      marginHorizontal: T.screenPadH,
      paddingVertical: SPACE.md,
      paddingLeft: SPACE.lg,
      paddingRight: SPACE.md,
      borderRadius: T.r.lg,
      backgroundColor: T.bg,
    },
    storiesText: { flex: 1, minWidth: 0 },
    rowLabel: { fontFamily: T.fontLabel, fontSize: 15, lineHeight: 21, color: T.text },
    rowDetail: { fontFamily: T.fontBody, fontSize: 12.5, lineHeight: 17, color: T.text2 },
    stopLine: {
      paddingHorizontal: T.screenPadH,
      paddingVertical: SPACE.sm,
      fontFamily: T.fontBody,
      fontSize: 14,
      lineHeight: STOP_LINE_HEIGHT,
      fontVariant: ['tabular-nums'],
    },
    stopLineCentered: { textAlign: 'center' },
    note: {
      paddingHorizontal: T.screenPadH,
      fontFamily: T.fontBody,
      fontSize: 14,
      lineHeight: STOP_LINE_HEIGHT,
      color: T.text2,
    },
    // The text button's label lines up with the text above it.
    openQueue: { alignSelf: 'flex-start', marginLeft: SPACE.xs },
    wheel: { paddingHorizontal: T.screenPadH },
    slot: { height: TIMER_SLOT_HEIGHT },
    chips: { height: TIMER_SLOT_HEIGHT },
    chipsContent: {
      height: TIMER_SLOT_HEIGHT,
      alignItems: 'center',
      gap: SPACE.sm,
      paddingHorizontal: T.screenPadH,
    },
    chip: { alignSelf: 'center' },
    countdownRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: SPACE.md,
      paddingHorizontal: T.screenPadH,
      // The drain line runs under the row.
      paddingBottom: SPACE.xs,
    },
    countdown: { flexDirection: 'row', alignItems: 'baseline', gap: SPACE.sm, flexShrink: 1, minWidth: 0 },
    countdownValue: {
      fontFamily: T.fontDisplay,
      fontSize: 28,
      lineHeight: 38,
      color: T.text,
      fontVariant: ['tabular-nums'],
    },
    countdownUnit: { fontFamily: T.fontBody, fontSize: 14, lineHeight: 20, color: T.text2 },
    countdownDrain: {
      position: 'absolute',
      left: T.screenPadH,
      right: T.screenPadH,
      bottom: 0,
      height: SLEEP_DRAIN_HEIGHT,
    },
  });

const stylesFor = themedStyles(makeStyles);

export default TimerSheet;
