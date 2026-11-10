/**
 * ModalWindow: the one place the app opens a React Native `Modal`
 * (docs/release-pass/SPEC-design.md 2.2). BottomSheet and Dialog draw their
 * own motion inside it, so the window itself never animates.
 *
 * - transparent, `animationType="none"`. No `statusBarTranslucent` or
 *   `navigationBarTranslucent`: this build is edge to edge
 *   (`edgeToEdgeEnabled`), where React Native makes every Modal window edge
 *   to edge and ignores both props, so the content is laid out under both
 *   bars like the activity.
 * - Android: the zero-size `SeslySystemBars` view keeps this window's
 *   navigation bar transparent with no contrast scrim
 *   (modules/sesly-system-bars). Nothing on iOS.
 * - Android: React Native lays a new Modal window out first at the screen
 *   height without the bars, and its real size arrives later through a
 *   state update on the JS thread. The content is laid out at least as tall
 *   as the app window (`appWindowHeight`, which the root veil measures; the
 *   Modal window has the same bounds), so its first layout is already the
 *   real one: a sheet or a dialog enters with its first frame instead of
 *   waiting for that update (usePresence `waitForWindow`). Before the veil
 *   measured anything the content just fills the window, as on iOS.
 * - A gesture handler root of its own: a Modal is a separate window, and
 *   gestures inside it need one.
 * - `onShow`: the window was shown (Android: the dialog window was added to
 *   the screen). usePresence starts an enter on Android only a frame after
 *   it, so the motion runs where it can be seen (`onWindowShown`).
 */

import React, { useSyncExternalStore } from 'react';
import { Modal, Platform, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { getModalSystemBars } from '../../../modules/sesly-system-bars';
import { appWindowHeight, subscribeSheetPresence } from './sheetPresence';

export interface ModalWindowProps {
  visible: boolean;
  /**
   * The Android back button. Always a function (Android dispatches it
   * unconditionally); pass a no-op to ignore the back button.
   */
  onRequestClose: () => void;
  /** iOS: the window is gone after `visible` turned false. */
  onDismiss?: () => void;
  /** The window was shown (once per presentation). */
  onShow?: () => void;
  children?: React.ReactNode;
}

export const ModalWindow: React.FC<ModalWindowProps> = ({ visible, onRequestClose, onDismiss, onShow, children }) => {
  const Bars = getModalSystemBars();
  const appHeight = useSyncExternalStore(subscribeSheetPresence, appWindowHeight);
  const rootStyle =
    Platform.OS === 'android' && appHeight > 0 ? [styles.fill, { minHeight: appHeight }] : styles.fill;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onRequestClose}
      onDismiss={onDismiss}
      onShow={onShow}
    >
      {Bars ? <Bars testID="modal-system-bars" style={styles.zero} /> : null}
      <GestureHandlerRootView style={rootStyle}>{children}</GestureHandlerRootView>
    </Modal>
  );
};

// No colours: one module-level sheet is fine.
const styles = StyleSheet.create({
  fill: { flex: 1 },
  zero: { position: 'absolute', width: 0, height: 0 },
});
