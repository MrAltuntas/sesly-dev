/**
 * BottomSheet: the sheet container of the playful design.
 *
 * Surface colour, 32dp top corners, a chunky drag handle, an optional
 * Baloo 2 title, then the content. It hugs its content up to 88% of the
 * screen (`fill`: 88% from the first frame; `height`: a fixed height).
 * Closes on the scrim, on the system back button, on the handle and when
 * dragged down by the handle or the header. Nothing in a sheet needs
 * "Uygula" or "Vazgeç" unless its content adds them.
 *
 * Motion (docs/release-pass/SPEC-design.md 2.2): the window does not
 * animate (`ModalWindow`); the scrim fades and the sheet rises from its own
 * height, `DURATION.sheetEnter` in and `DURATION.sheetExit` out, and a
 * released drag springs back with `SPRING_SHEET`. While it leaves the sheet
 * keeps its content, its title included, and takes no touches. The
 * translate always follows the sheet's latest measured height.
 *
 * Android: the enter waits until the window is on screen (the Modal's
 * `onShow`) with its real, edge-to-edge size (`usePresence`
 * `waitForWindow`): React Native lays a new Modal out at the
 * screen height without the bars first, and a sheet started then ended short
 * of the screen's bottom and snapped down. The exit keeps part of the
 * scrim's level (`veilHandoff`): with a dialog or a sheet opened from
 * `onClosed` the app's root veil takes it over (the two dim as one scrim,
 * `scrimAlpha`) and holds it under that window; with nothing opened the
 * scrim fades out in the sheet's own window. The window goes once it shows
 * nothing, just after `onClosed`.
 *
 * The bottom padding clears the navigation bar (`dockBottom`) with the
 * keyboard closed and is 12 with it open: the keyboard-controller
 * `KeyboardAvoidingView` already lifts the sheet above the keyboard, which
 * covers the navigation bar.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Dimensions,
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { KeyboardAvoidingView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { parseColor } from '../../theme/color';
import { SPACE, Theme, dockBottom, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { SPRING_SHEET } from '../../theme/motion';
import { DialogOutlet } from './DialogOutlet';
import { ModalWindow } from './ModalWindow';
import { markSheetClosing, registerSheet, unregisterSheet } from './sheetPresence';
import { SnackbarHost } from './Snackbar';
import { SurfaceLevelProvider } from './SurfaceLevel';
import { SHEET_MOTION, usePresence } from './usePresence';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Node at the right of the title (the timer's master switch). */
  headerTrailing?: React.ReactNode;
  children?: React.ReactNode;
  /** Padding around the content. Default: the screen gutter left and right. */
  contentStyle?: StyleProp<ViewStyle>;
  /**
   * Children inside a ScrollView that keeps taps while the keyboard is up
   * (forms, and content that may not fit a short screen or a large font).
   * Not for content that has its own list.
   */
  scrollable?: boolean;
  /** 88% of the screen from the first frame (content that loads, then is long). */
  fill?: boolean;
  /** A fixed height in dp, at most 88% (computed when the sheet opens). */
  height?: number;
  /** The enter finished. */
  onOpened?: () => void;
  /** The exit finished (on Android its empty window goes just after): start what comes next here. */
  onClosed?: () => void;
  testID?: string;
}

/** Drag on the handle and header: past this distance or speed the sheet closes. */
export function shouldDismissSheet(translationY: number, velocityY: number, height: number): boolean {
  'worklet';
  return translationY > Math.min(140, 0.3 * height) || velocityY > 1000;
}

/** How much of its own height the sheet is dragged down, 0 to 1 (the scrim fades by it). */
function draggedShare(dragY: number, height: number): number {
  'worklet';
  return height > 0 ? Math.min(Math.max(dragY / height, 0), 1) : 0;
}

/** Bottom padding with the keyboard open. */
const KEYBOARD_PAD = SPACE.md;

export const BottomSheet: React.FC<BottomSheetProps> = ({
  visible,
  onClose,
  title,
  headerTrailing,
  children,
  contentStyle,
  scrollable = false,
  fill = false,
  height,
  onOpened,
  onClosed,
  testID,
}) => {
  const T = useT();
  const { t } = useTranslation('common');
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const styles = stylesFor(T);
  const text = textStylesFor(T);

  // Until its enter starts the sheet waits a full screen below (also while
  // an Android window still has its provisional, shorter size).
  const hiddenH = Math.max(windowHeight, Dimensions.get('screen').height);
  const sheetH = useSharedValue(hiddenH);
  const dragY = useSharedValue(0);
  const keyboard = useReanimatedKeyboardAnimation();
  /** The sheet's latest measured height; `sheetH` follows it once the enter started. */
  const measuredH = useRef<number | null>(null);
  const followsLayout = useRef(false);
  const hiddenRef = useRef(hiddenH);
  hiddenRef.current = hiddenH;

  const presenceKey = useRef({}).current;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const handleEnter = useCallback(() => {
    followsLayout.current = true;
    if (measuredH.current !== null) sheetH.value = measuredH.current;
  }, [sheetH]);
  const handleGone = useCallback(() => {
    // The window and its content went: the next open measures again.
    followsLayout.current = false;
    measuredH.current = null;
    sheetH.value = hiddenRef.current;
    dragY.value = 0;
  }, [dragY, sheetH]);
  const handleClosed = useCallback(() => {
    // A close confirmed only after the sheet was opened again: it is open now.
    if (!visibleRef.current) unregisterSheet(presenceKey);
    onClosed?.();
  }, [onClosed, presenceKey]);
  // The scrim the root veil takes over keeps the fade of a dismissing drag.
  const dragFactor = useCallback(() => 1 - draggedShare(dragY.value, sheetH.value), [dragY, sheetH]);
  // The scrim and the root veil are both `T.scrim`: they dim as one.
  const scrimAlpha = useMemo(() => parseColor(T.scrim).a, [T.scrim]);

  const presence = usePresence({
    visible,
    motion: SHEET_MOTION,
    waitForLayout: true,
    waitForWindow: true,
    veilHandoff: true,
    veilFactor: dragFactor,
    scrimAlpha,
    onEnter: handleEnter,
    onOpened,
    onGone: handleGone,
    onClosed: handleClosed,
  });
  const { progress, veil, travel, reduced, closing, onLayout: presenceLayout } = presence;

  // The leaving sheet keeps its title. Children are never frozen: a choice
  // made in the tap that closes the sheet stays visible while it leaves.
  const frozen = useRef({ title, headerTrailing });
  if (visible) frozen.current = { title, headerTrailing };
  const header = frozen.current;

  // Registered before paint, so a dialog shown in the same tick sees it.
  useLayoutEffect(() => {
    if (visible) registerSheet(presenceKey);
    else markSheetClosing(presenceKey);
  }, [visible, presenceKey]);
  useEffect(() => () => unregisterSheet(presenceKey), [presenceKey]);

  // Back from a drag that closed it: settle where it belongs.
  useEffect(() => {
    if (visible && dragY.value !== 0) dragY.value = withSpring(0, SPRING_SHEET);
  }, [visible, dragY]);

  const closingRef = useRef(closing);
  closingRef.current = closing;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const requestClose = useCallback(() => {
    if (!closingRef.current) onCloseRef.current();
  }, []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-6, 6])
        .enabled(!closing)
        .onUpdate(event => {
          dragY.value = Math.max(0, event.translationY);
        })
        .onEnd((event, success) => {
          if (success && shouldDismissSheet(event.translationY, event.velocityY, sheetH.value)) {
            scheduleOnRN(requestClose);
          } else {
            dragY.value = withSpring(0, SPRING_SHEET);
          }
        })
        .withTestId('sheet-drag'),
    [closing, dragY, requestClose, sheetH],
  );

  // Every layout, also during the enter: the translate follows the real
  // height, so a late resize never leaves a gap or a snap.
  const onSheetLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const h = event.nativeEvent.layout.height;
      measuredH.current = h;
      if (followsLayout.current) sheetH.value = h;
      presenceLayout();
    },
    [presenceLayout, sheetH],
  );

  const bottom = dockBottom(insets.bottom);
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: veil.value * (1 - draggedShare(dragY.value, sheetH.value)),
  }));
  const sheetStyle = useAnimatedStyle(() => {
    const t01 = reduced ? travel.value : progress.value;
    return {
      paddingBottom: bottom - (bottom - KEYBOARD_PAD) * keyboard.progress.value,
      transform: [{ translateY: (1 - t01) * sheetH.value + Math.max(0, dragY.value) }],
    };
  });

  const sized = height !== undefined || fill;
  const sizeStyle = height !== undefined ? { height } : fill ? styles.fill : null;

  return (
    <ModalWindow
      visible={presence.mounted}
      onRequestClose={requestClose}
      onDismiss={presence.onDismiss}
      onShow={presence.onWindowShown}
    >
      <KeyboardAvoidingView
        behavior="padding"
        style={styles.root}
        onLayout={presence.onRootLayout}
        testID="sheet-window"
      >
        <Animated.View
          testID="sheet-scrim-layer"
          style={[StyleSheet.absoluteFill, scrimStyle]}
          pointerEvents={closing ? 'none' : 'auto'}
        >
          <Pressable
            style={styles.scrim}
            onPress={requestClose}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.closeSheet')}
            testID="sheet-scrim"
          />
        </Animated.View>
        <Animated.View
          testID={testID}
          accessibilityViewIsModal
          // VoiceOver cannot reach the scrim beside a modal view: its escape
          // gesture closes the sheet instead.
          onAccessibilityEscape={requestClose}
          pointerEvents={closing ? 'none' : 'auto'}
          onLayout={onSheetLayout}
          style={[styles.sheet, sizeStyle, sheetStyle]}
        >
          <SurfaceLevelProvider level="surface">
            <GestureDetector gesture={pan}>
              <View testID="sheet-drag">
                <Pressable
                  onPress={requestClose}
                  accessible={false}
                  style={styles.handleArea}
                  testID="sheet-handle"
                >
                  <View style={styles.handle} />
                </Pressable>
                {header.title || header.headerTrailing ? (
                  <View style={styles.header}>
                    {/* A title that shares its row with a control (the timer's
                        switch) is that control's label: one step down the scale,
                        on one line, shrinking before it would wrap. */}
                    <Text
                      accessibilityRole="header"
                      // A title alone may take a second line (large font, 360dp)
                      // instead of being cut.
                      numberOfLines={header.headerTrailing ? 1 : 2}
                      adjustsFontSizeToFit={!!header.headerTrailing}
                      minimumFontScale={0.85}
                      testID="sheet-title"
                      style={[header.headerTrailing ? text.subheading : text.heading, styles.title]}
                    >
                      {header.title ?? ''}
                    </Text>
                    {header.headerTrailing}
                  </View>
                ) : null}
              </View>
            </GestureDetector>
            <View style={[styles.content, sized ? styles.contentFill : null, contentStyle]}>
              {scrollable ? (
                <ScrollView
                  style={styles.scroll}
                  bounces={false}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  testID="sheet-scroll"
                >
                  {children}
                </ScrollView>
              ) : (
                children
              )}
            </View>
          </SurfaceLevelProvider>
        </Animated.View>
        {/* Messages shown while the sheet is open must be in its window. */}
        <SnackbarHost inSheet />
        {/* A dialog shown while the sheet is up opens in its window. */}
        {visible ? <DialogOutlet /> : null}
      </KeyboardAvoidingView>
    </ModalWindow>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: T.scrim },
    sheet: {
      backgroundColor: T.surface,
      borderTopLeftRadius: T.r.sheet,
      borderTopRightRadius: T.r.sheet,
      maxHeight: '88%',
    },
    fill: { height: '88%' },
    handleArea: { height: 24, alignItems: 'center', justifyContent: 'center' },
    handle: { width: 40, height: 5, borderRadius: T.r.pill, backgroundColor: T.line },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.md,
      paddingHorizontal: T.screenPadH,
      paddingTop: 0,
      paddingBottom: SPACE.sm,
    },
    title: { flex: 1, minWidth: 0 },
    content: { paddingHorizontal: T.screenPadH, flexShrink: 1 },
    contentFill: { flex: 1 },
    scroll: { flexGrow: 0 },
  });

const stylesFor = themedStyles(makeStyles);
