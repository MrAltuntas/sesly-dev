/**
 * Dialog Hook with Context
 * Global dialog management for the app. The window itself is the playful dialog
 * (components/design/Dialog).
 *
 * One dialog at a time. It renders in the top dialog outlet (a visible
 * sheet's window, a `presentation: 'modal'` screen; components/design/
 * DialogOutlet) or at the root when no outlet is mounted. On iOS a
 * `showDialog` while a sheet is leaving waits until it is gone, and the root
 * never presents during a sheet's exit (UIKit refuses a presentation while
 * another window is being dismissed). Android stacks the dialog's window
 * over the leaving sheet, so nothing waits there: a dialog shown from a
 * sheet's `onClosed` says so at once (`requestWindow`) and fades in over
 * the last of the sheet's scrim. `HandoffVeil` (mounted here, always,
 * Android only) holds that scrim in the app's window: the sheet hands it
 * over as its exit ends, the veil holds it while the dialog's window waits
 * for its real size and while the dialog is open, and fades out with the
 * dialog's exit (sheetPresence, usePresence `veilHandoff`).
 *
 * A button's `afterClose` runs once the dialog's window is gone: navigation
 * goes there, so the dialog and the screen under it never leave in one
 * commit (components/design/Dialog, VR-01).
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {Platform} from 'react-native';
import {OptionsDialog} from '../components/design/Dialog';
import type {DialogButton, DialogOptions} from '../components/design/Dialog';
import {
  DialogHostContext,
  HandoffVeil,
} from '../components/design/DialogOutlet';
import type {DialogHost} from '../components/design/DialogOutlet';
import {
  presentationBlocked,
  requestWindow,
  subscribeSheetPresence,
  whenAllClosed,
} from '../components/design/sheetPresence';

export type {DialogButton, DialogOptions};
export {DialogOutlet, withDialogOutlet} from '../components/design/DialogOutlet';

interface DialogContextType {
  showDialog: (options: DialogOptions) => void;
  hideDialog: () => void;
}

const DialogContext = createContext<DialogContextType | undefined>(undefined);

/** The dialog at the app root, held back while a sheet is leaving (iOS). */
const RootDialog: React.FC<{host: DialogHost}> = ({host}) => {
  const sheetLeaving = useSyncExternalStore(
    subscribeSheetPresence,
    presentationBlocked,
  );
  return (
    <OptionsDialog
      visible={host.visible && !sheetLeaving}
      options={host.options}
      onClose={host.onClose}
    />
  );
};

export const DialogProvider: React.FC<{children: React.ReactNode}> = ({
  children,
}) => {
  const [visible, setVisible] = useState(false);
  const [options, setOptions] = useState<DialogOptions>({
    title: '',
    message: '',
  });
  const [outlets, setOutlets] = useState<number[]>([]);
  /** Cancels a `showDialog` still waiting for a sheet to leave. */
  const pending = useRef<(() => void) | null>(null);
  /** Whether the dialog is shown (or asked to be) as of the latest call. */
  const shownRef = useRef(false);

  const showDialog = useCallback((dialogOptions: DialogOptions) => {
    pending.current?.();
    pending.current = null;
    let shown = false;
    const cancel = whenAllClosed(() => {
      shown = true;
      pending.current = null;
      // A new window opens in this batch (none when the card only swaps its
      // content): a root veil given back now holds for it.
      if (!shownRef.current) requestWindow();
      shownRef.current = true;
      setOptions(dialogOptions);
      setVisible(true);
    });
    if (!shown) pending.current = cancel;
  }, []);

  const hideDialog = useCallback(() => {
    pending.current?.();
    pending.current = null;
    shownRef.current = false;
    setVisible(false);
  }, []);

  const registerOutlet = useCallback((id: number) => {
    setOutlets(stack => [...stack, id]);
    return () => setOutlets(stack => stack.filter(entry => entry !== id));
  }, []);

  const contextValue = useMemo(
    () => ({
      showDialog,
      hideDialog,
    }),
    [showDialog, hideDialog],
  );

  const top = outlets.length > 0 ? outlets[outlets.length - 1] : null;
  const host = useMemo<DialogHost>(
    () => ({visible, options, onClose: hideDialog, top, registerOutlet}),
    [visible, options, hideDialog, top, registerOutlet],
  );

  return (
    <DialogContext.Provider value={contextValue}>
      <DialogHostContext.Provider value={host}>
        {children}
        {top === null ? <RootDialog host={host} /> : null}
        {/* Android: a leaving sheet's scrim, in the app's window (always mounted, last). */}
        {Platform.OS === 'android' ? <HandoffVeil /> : null}
      </DialogHostContext.Provider>
    </DialogContext.Provider>
  );
};

export const useDialog = (): DialogContextType => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within DialogProvider');
  }
  return context;
};
