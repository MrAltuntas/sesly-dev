/**
 * Dialog: the confirmation window of the playful design.
 *
 * A chunky card on its lip over the scrim: 28dp radius, a Baloo 2 title
 * written as a question, one body sentence, an optional slot (a text
 * field), then the buttons. The confirming action (the last one) is the
 * primary button, a destructive one is the primary button in the error
 * colour, the rest ("Vazgeç") are neutral raised buttons. Two buttons share
 * a row; one or three stack.
 *
 * Motion (docs/release-pass/SPEC-design.md 2.2): the window does not
 * animate (`ModalWindow`); the scrim fades and the card fades and grows
 * from 0.94, `DURATION.base` in and `DURATION.exit` out. While it leaves
 * the card keeps its content and takes no touches; shown again during the
 * exit, it comes back from where it is. On Android the enter starts once
 * the window is on screen with its real size (`usePresence`
 * `waitForWindow`, the Modal's `onShow`), so the fade and the scale run
 * where they can be seen.
 *
 * The window root never changes its native shape: it is always its own
 * view (`collapsable={false}`). With `pointerEvents` alone flipping it
 * between a flattened and a real view, the commit that closes the dialog
 * moved the scrim and the card into a new parent, and when that commit also
 * removed the screen under the dialog (a "Çık" that navigates back) Android
 * still held both in the leaving screen's transition and crashed
 * (VR-01, "The specified child already has a parent").
 *
 * `OptionsDialog` renders the same card from the `DialogOptions` object that
 * `useDialog().showDialog()` has always taken, so no caller changes. A
 * button's `afterClose` runs once the dialog's window is gone: navigation
 * goes there, never into `onPress`.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useTranslation } from 'react-i18next';
import { LIP, SPACE, Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { Button } from './Button';
import { ModalWindow } from './ModalWindow';
import { SurfaceLevelProvider } from './SurfaceLevel';
import { DIALOG_MOTION, usePresence } from './usePresence';

// ─────────────────────────────────────────────────────────────
// Dialog
// ─────────────────────────────────────────────────────────────

export interface DialogAction {
  label: string;
  onPress: () => void;
  /** 'danger': the action destroys something (error colour). */
  tone?: 'default' | 'danger';
  /** Shown but not pressable (a form in the slot is not complete yet). */
  disabled?: boolean;
  testID?: string;
}

export interface DialogProps {
  visible: boolean;
  title: string;
  message?: string;
  /** Left to right; the confirming action goes last. */
  actions: DialogAction[];
  /**
   * The scrim and the Android back button, unless `dismissOnScrim` is
   * false.
   */
  onDismiss: () => void;
  /** false: neither the scrim nor the Android back button closes it, only an action. */
  dismissOnScrim?: boolean;
  /**
   * Content after the message (a `TextField`). The card then rises with
   * the keyboard. Focus an input from `onOpened` through a ref, never with
   * `autoFocus` (the card is still growing then).
   */
  children?: React.ReactNode;
  /** The enter finished. */
  onOpened?: () => void;
  /** The exit finished and the window is gone. */
  onClosed?: () => void;
  testID?: string;
}

const noop = () => undefined;

interface DialogContent {
  title: string;
  message?: string;
  actions: DialogAction[];
}

export const Dialog: React.FC<DialogProps> = ({
  visible,
  title,
  message,
  actions,
  onDismiss,
  dismissOnScrim = true,
  children,
  onOpened,
  onClosed,
  testID,
}) => {
  const T = useT();
  const { t } = useTranslation('common');
  const styles = stylesFor(T);
  const text = textStylesFor(T);
  // Android: the enter waits for the window's real size, so the card is
  // never centred in the provisional, shorter window and the scrim covers
  // the navigation bar from its first frame.
  const presence = usePresence({ visible, motion: DIALOG_MOTION, waitForWindow: true, onOpened, onClosed });
  const { progress, travel, reduced, closing } = presence;

  // The leaving card keeps what it showed (a caller may clear its state on close).
  const frozen = useRef<DialogContent>({ title, message, actions });
  if (visible) frozen.current = { title, message, actions };
  const shown = frozen.current;

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => {
    const t01 = reduced ? travel.value : progress.value;
    return { opacity: progress.value, transform: [{ scale: 0.94 + 0.06 * t01 }] };
  });

  const dismissible = dismissOnScrim && !closing;
  const Root = children ? KeyboardAvoidingView : View;
  const rootProps = children ? { behavior: 'padding' as const } : {};

  return (
    <ModalWindow
      visible={presence.mounted}
      onRequestClose={dismissible ? onDismiss : noop}
      onDismiss={presence.onDismiss}
      onShow={presence.onWindowShown}
    >
      <Root
        {...rootProps}
        style={styles.root}
        // Always a native view: the pointerEvents flip of the exit must
        // never re-parent the scrim and the card (VR-01, above).
        collapsable={false}
        pointerEvents={closing ? 'none' : 'auto'}
        onLayout={presence.onRootLayout}
        testID="dialog-window"
      >
        <Animated.View testID="dialog-scrim-layer" style={[StyleSheet.absoluteFill, scrimStyle]}>
          <Pressable
            style={styles.scrim}
            onPress={dismissible ? onDismiss : undefined}
            accessibilityRole={dismissOnScrim ? 'button' : undefined}
            accessibilityLabel={dismissOnScrim ? t('close') : undefined}
            accessible={dismissOnScrim}
            testID="dialog-scrim"
          />
        </Animated.View>
        {/* The card is a surface: its neutral buttons draw one step up. */}
        <SurfaceLevelProvider level="surface">
          <Animated.View
            testID={testID ?? 'dialog'}
            accessibilityViewIsModal
            // The VoiceOver escape gesture, like the scrim and the back button.
            onAccessibilityEscape={dismissible ? onDismiss : undefined}
            style={[styles.card, cardStyle]}
          >
            <Text accessibilityRole="header" style={text.heading}>
              {shown.title}
            </Text>
            {shown.message ? <Text style={[text.bodySmall, styles.message]}>{shown.message}</Text> : null}
            {children ? <View style={styles.slot}>{children}</View> : null}
            <View style={[styles.actions, shown.actions.length === 2 ? styles.actionsRow : styles.actionsColumn]}>
              {shown.actions.map((action, index) => {
                const confirming = index === shown.actions.length - 1;
                return (
                  <Button
                    key={`${action.label}-${index}`}
                    variant={confirming ? 'primary' : 'secondary'}
                    tone={action.tone === 'danger' ? 'danger' : 'default'}
                    size="md"
                    label={action.label}
                    onPress={closing ? undefined : action.onPress}
                    disabled={action.disabled}
                    testID={action.testID}
                    block
                    style={shown.actions.length === 2 ? styles.actionHalf : undefined}
                  />
                );
              })}
            </View>
          </Animated.View>
        </SurfaceLevelProvider>
      </Root>
    </ModalWindow>
  );
};

// ─────────────────────────────────────────────────────────────
// The `useDialog()` contract
// ─────────────────────────────────────────────────────────────

export interface DialogButton {
  text: string;
  onPress?: () => void;
  /**
   * Runs once the dialog closed and its window is gone (its `onClosed`, or
   * when it unmounted while leaving). Navigation goes here: a screen removed
   * in the commit that closes the dialog takes the dialog's window with it
   * mid-exit. A dialog shown again before that runs it after its own close.
   */
  afterClose?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

export interface DialogOptions {
  title: string;
  message?: string;
  buttons?: DialogButton[];
  /**
   * false: neither a tap on the scrim nor the Android back button closes
   * the dialog; only its buttons do.
   */
  cancelable?: boolean;
  /** Not drawn (the dialog has no icon). Kept for callers. */
  icon?: string;
  /** Not drawn. Kept for callers. */
  iconColor?: string;
}

/**
 * Buttons in display order: "Vazgeç" first, the rest as the caller listed
 * them, so the confirming action always ends at the bottom right.
 */
export function orderDialogButtons(buttons: readonly DialogButton[]): DialogButton[] {
  return [
    ...buttons.filter(button => button.style === 'cancel'),
    ...buttons.filter(button => button.style !== 'cancel'),
  ];
}

export interface OptionsDialogProps {
  visible: boolean;
  options: DialogOptions;
  onClose: () => void;
}

export const OptionsDialog: React.FC<OptionsDialogProps> = ({ visible, options, onClose }) => {
  const { t } = useTranslation('common');
  const { title, message, buttons = [], cancelable = true } = options;

  /** `afterClose` of the pressed buttons, run once the window is gone. */
  const afterClose = useRef<Array<() => void>>([]);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const runAfterClose = useCallback(() => {
    if (visibleRef.current) return;
    const queued = afterClose.current;
    afterClose.current = [];
    queued.forEach(run => run());
  }, []);
  // Unmounted while leaving (its outlet went away): what waits runs now.
  useEffect(() => runAfterClose, [runAfterClose]);

  const actions: DialogAction[] =
    buttons.length === 0
      ? [{ label: t('ok'), onPress: onClose }]
      : orderDialogButtons(buttons).map(button => ({
          label: button.text,
          tone: button.style === 'destructive' ? 'danger' : 'default',
          // Close first: a button that shows a follow-up dialog then leaves
          // it visible (both updates land in one render, the card swaps in place).
          onPress: () => {
            if (button.afterClose) afterClose.current.push(button.afterClose);
            onClose();
            button.onPress?.();
          },
        }));

  return (
    <Dialog
      visible={visible}
      title={title}
      message={message}
      actions={actions}
      onDismiss={onClose}
      dismissOnScrim={cancelable}
      onClosed={runAfterClose}
    />
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: 'center', paddingHorizontal: T.screenPadH },
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: T.scrim },
    card: {
      width: '100%',
      maxWidth: 420,
      alignSelf: 'center',
      backgroundColor: T.surface,
      borderBottomWidth: LIP.lg,
      borderBottomColor: T.lip,
      borderRadius: T.r.xxl,
      padding: SPACE.xl,
    },
    message: { marginTop: SPACE.sm, color: T.text2 },
    slot: { marginTop: SPACE.lg },
    actions: { marginTop: SPACE.xl, gap: SPACE.sm },
    // Two buttons share a row, the confirming action at the right. Each is
    // centred on the row's cross axis: a stretched button (a two-line label
    // beside a one-line one) would grow its lip instead of its face.
    actionsRow: { flexDirection: 'row' },
    actionsColumn: { flexDirection: 'column-reverse' },
    actionHalf: { flex: 1, alignSelf: 'center' },
  });

const stylesFor = themedStyles(makeStyles);

export default Dialog;
