/**
 * The playful dialog and the `useDialog()` contract on top of it: the
 * window (no Modal animation, the back button), presence (the card stays
 * while it leaves, a new dialog during the exit comes back) and the
 * follow-up dialog chain (docs/release-pass/SPEC-design.md 2.2, 5.2).
 */

import React, { useRef } from 'react';
import { Dimensions, Modal, Platform, Text, TextInput } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { DURATION } from '../../theme/motion';
import { raisedFace } from '../../theme/surfaces';
import { Dialog, OptionsDialog, orderDialogButtons } from './Dialog';
import type { DialogAction } from './Dialog';
import { isAnyWindowWaiting, lastWindowEnter, resetSheetPresence } from './sheetPresence';
import { WINDOW_FALLBACK_MS } from './usePresence';
import { DialogProvider, useDialog } from '../../hooks/useDialog';

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

interface HeldTiming {
  toValue: number;
  duration?: number;
  callback?: (finished?: boolean) => void;
}

/** Holds every withTiming: nothing ends until the test calls the callback. */
function holdTimings(): HeldTiming[] {
  const held: HeldTiming[] = [];
  jest.spyOn(Reanimated, 'withTiming').mockImplementation(((
    toValue: number,
    config?: { duration?: number },
    callback?: (finished?: boolean) => void,
  ) => {
    held.push({ toValue, duration: config?.duration, callback });
    return toValue;
  }) as unknown as typeof Reanimated.withTiming);
  return held;
}

const last = <T,>(list: T[]): T => list[list.length - 1];

function Question(props: Partial<React.ComponentProps<typeof Dialog>>) {
  return (
    <Dialog
      visible
      title="Soru"
      actions={[
        { label: 'Vazgeç', onPress: jest.fn() },
        { label: 'Sil', onPress: jest.fn(), tone: 'danger' },
      ]}
      onDismiss={jest.fn()}
      {...props}
    />
  );
}

describe('Dialog', () => {
  it('shows the question, the consequence and the actions in order', () => {
    const cancel = jest.fn();
    const remove = jest.fn();
    renderWithProviders(
      <Dialog
        visible
        title="Zeynep sesi silinsin mi?"
        message="Kaydın ve ondan oluşturulan ses kalıcı olarak silinir. Geri alınamaz."
        actions={[
          { label: 'Vazgeç', onPress: cancel },
          { label: 'Sesi sil', onPress: remove, tone: 'danger' },
        ]}
        onDismiss={cancel}
      />,
    );

    expect(screen.getByRole('header', { name: 'Zeynep sesi silinsin mi?' })).toBeOnTheScreen();
    expect(
      screen.getByText('Kaydın ve ondan oluşturulan ses kalıcı olarak silinir. Geri alınamaz.'),
    ).toBeOnTheScreen();
    expect(screen.getAllByRole('button').map(node => node.props.accessibilityLabel)).toEqual([
      'Vazgeç',
      'Sesi sil',
    ]);

    fireEvent.press(screen.getByRole('button', { name: 'Sesi sil' }));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("two actions share the row, each centred, so a two-line label never stretches its neighbour's lip", () => {
    renderWithProviders(
      <Question
        actions={[
          { label: 'Vazgeç', onPress: jest.fn(), testID: 'cancel' },
          { label: 'Kaydı sil ve yeniden başla', onPress: jest.fn(), testID: 'go' },
        ]}
      />,
    );
    for (const id of ['cancel', 'go']) {
      // flex 1 shares the width; alignSelf centre keeps the face and lip their own height.
      expect(flatStyle(screen.getByTestId(id))).toMatchObject({ flex: 1, alignSelf: 'center' });
      expect(flatStyle(screen.getByTestId(`${id}-lip`)).top).toBe(2);
    }
    // One or three actions stack at full width instead.
    screen.unmount();
    renderWithProviders(<Question actions={[{ label: 'Tamam', onPress: jest.fn(), testID: 'ok' }]} />);
    expect(flatStyle(screen.getByTestId('ok'))).toMatchObject({ alignSelf: 'stretch' });
    expect(flatStyle(screen.getByTestId('ok')).flex).toBeUndefined();
  });

  it('renders nothing while hidden and leaves the body out when there is none', () => {
    const { rerender } = renderWithProviders(
      <Dialog visible={false} title="Gizli" actions={[]} onDismiss={jest.fn()} />,
    );
    expect(screen.queryByText('Gizli')).toBeNull();

    rerender(<Dialog visible title="Yalnız başlık" actions={[]} onDismiss={jest.fn()} />);
    expect(screen.getByText('Yalnız başlık')).toBeOnTheScreen();
    expect(screen.getByTestId('dialog').children).toHaveLength(2);
  });

  it('opens a transparent Modal that does not animate itself', () => {
    renderWithProviders(<Question />);
    expect(screen.UNSAFE_getByType(Modal).props).toMatchObject({
      transparent: true,
      animationType: 'none',
    });
  });

  it('closes on the scrim unless told not to', () => {
    const onDismiss = jest.fn();
    const { rerender } = renderWithProviders(
      <Dialog visible title="Soru" actions={[]} onDismiss={onDismiss} />,
    );
    fireEvent.press(screen.getByTestId('dialog-scrim', { includeHiddenElements: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    rerender(<Dialog visible title="Soru" actions={[]} onDismiss={onDismiss} dismissOnScrim={false} />);
    fireEvent.press(screen.getByTestId('dialog-scrim', { includeHiddenElements: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('the Android back button closes it by default and not with dismissOnScrim false', () => {
    const onDismiss = jest.fn();
    const { rerender } = renderWithProviders(<Question onDismiss={onDismiss} />);
    fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
    expect(onDismiss).toHaveBeenCalledTimes(1);

    rerender(<Question onDismiss={onDismiss} dismissOnScrim={false} />);
    // Still a function: Android dispatches it whatever the prop says.
    expect(typeof screen.UNSAFE_getByType(Modal).props.onRequestClose).toBe('function');
    fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('the VoiceOver escape gesture closes it like the scrim: not when it is not cancelable, not while it leaves', () => {
    holdTimings();
    const onDismiss = jest.fn();
    const { rerender } = renderWithProviders(<Question onDismiss={onDismiss} />);
    fireEvent(screen.getByTestId('dialog'), 'accessibilityEscape');
    expect(onDismiss).toHaveBeenCalledTimes(1);

    rerender(<Question onDismiss={onDismiss} dismissOnScrim={false} />);
    expect(screen.getByTestId('dialog').props.onAccessibilityEscape).toBeUndefined();
    fireEvent(screen.getByTestId('dialog'), 'accessibilityEscape');
    expect(onDismiss).toHaveBeenCalledTimes(1);

    rerender(<Question onDismiss={onDismiss} visible={false} />);
    expect(screen.getByTestId('dialog').props.onAccessibilityEscape).toBeUndefined();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('enters in DURATION.base and leaves in DURATION.exit', () => {
    const held = holdTimings();
    const { rerender } = renderWithProviders(<Question />);
    expect(held).toEqual([expect.objectContaining({ toValue: 1, duration: DURATION.base })]);
    rerender(<Question visible={false} />);
    expect(last(held)).toMatchObject({ toValue: 0, duration: DURATION.exit });
  });

  it('under reduced motion it only fades, in DURATION.fast', () => {
    jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const held = holdTimings();
    const { rerender } = renderWithProviders(<Question />);
    rerender(<Question visible={false} />);
    expect(held.map(entry => entry.duration)).toEqual([DURATION.fast, DURATION.fast]);
  });

  it('keeps the card until the exit ends, then reports onClosed once', () => {
    const held = holdTimings();
    const onClosed = jest.fn();
    const { rerender } = renderWithProviders(<Question onClosed={onClosed} title="Kalıyor mu?" />);
    // A caller that clears its title on close: the leaving card keeps it.
    rerender(<Question onClosed={onClosed} title="" visible={false} />);

    expect(screen.getByTestId('dialog')).toBeOnTheScreen();
    expect(screen.getByText('Kalıyor mu?')).toBeOnTheScreen();
    expect(onClosed).not.toHaveBeenCalled();

    act(() => last(held).callback?.(true));
    expect(screen.queryByTestId('dialog')).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('a scrim press, the back button or an action while it leaves does nothing', () => {
    holdTimings();
    const onDismiss = jest.fn();
    const onDelete = jest.fn();
    const actions: DialogAction[] = [{ label: 'Sil', onPress: onDelete }];
    const { rerender } = renderWithProviders(
      <Question onDismiss={onDismiss} actions={actions} />,
    );
    fireEvent.press(screen.getByTestId('dialog-scrim', { includeHiddenElements: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    rerender(<Question onDismiss={onDismiss} actions={actions} visible={false} />);
    fireEvent.press(screen.getByTestId('dialog-scrim', { includeHiddenElements: true }));
    fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
    fireEvent.press(screen.getByText('Sil'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('shown again during the exit, the same card comes back', () => {
    const held = holdTimings();
    const onClosed = jest.fn();
    const { rerender } = renderWithProviders(<Question onClosed={onClosed} />);
    rerender(<Question onClosed={onClosed} visible={false} />);
    const exit = last(held);

    rerender(<Question onClosed={onClosed} title="Yeni soru" />);
    expect(last(held)).toMatchObject({ toValue: 1, duration: DURATION.base });
    expect(screen.getAllByTestId('dialog')).toHaveLength(1);
    expect(screen.getByText('Yeni soru')).toBeOnTheScreen();

    act(() => exit.callback?.(true));
    expect(screen.getByTestId('dialog')).toBeOnTheScreen();
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('a disabled action is drawn but not pressable', () => {
    const onSave = jest.fn();
    renderWithProviders(
      <Question
        actions={[
          { label: 'Vazgeç', onPress: jest.fn() },
          { label: 'Kaydet', onPress: onSave, disabled: true },
        ]}
      />,
    );
    const save = screen.getByRole('button', { name: 'Kaydet' });
    expect(save.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders the slot after the message and focuses its input from onOpened', () => {
    function NameDialog() {
      const input = useRef<TextInput>(null);
      return (
        <Dialog
          visible
          title="Liste adı"
          message="Yeni listeye bir ad ver."
          actions={[{ label: 'Oluştur', onPress: jest.fn() }]}
          onDismiss={jest.fn()}
          onOpened={() => input.current?.focus()}
        >
          <TextInput ref={input} testID="name-input" />
        </Dialog>
      );
    }
    renderWithProviders(<NameDialog />);

    const card = screen.getByTestId('dialog');
    expect(card.children).toHaveLength(4);
    const input = screen.getByTestId('name-input');
    expect(input).toBeOnTheScreen();
    // The Reanimated mock ends the enter at once, so onOpened has run.
    expect(screen.UNSAFE_getByType(TextInput).instance.focus).toHaveBeenCalledTimes(1);
    expect(input.props.autoFocus).toBeUndefined();
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', scheme => {
    renderWithProviders(
      <Dialog
        visible
        title="Soru"
        message="Sonuç"
        actions={[
          { label: 'Vazgeç', onPress: jest.fn(), testID: 'dialog-cancel' },
          { label: 'Sil', onPress: jest.fn(), tone: 'danger' },
        ]}
        onDismiss={jest.fn()}
      />,
      { theme: scheme },
    );
    const T = themes[scheme];
    expect(flatStyle(screen.getByTestId('dialog'))).toMatchObject({
      backgroundColor: T.surface,
      borderBottomColor: T.lip,
      borderBottomWidth: 4,
      borderRadius: 28,
      padding: 20,
      maxWidth: 420,
    });
    expect(flatStyle(screen.getByTestId('dialog-scrim', { includeHiddenElements: true })).backgroundColor).toBe(T.scrim);
    expect(flatStyle(screen.getByText('Soru'))).toMatchObject({ color: T.text, fontFamily: 'Baloo2-SemiBold' });
    expect(flatStyle(screen.getByText('Sonuç'))).toMatchObject({ color: T.text2, marginTop: 8 });
    // "Vazgeç" is a neutral raised button (one step up from the card, never
    // the card colour), the destructive confirmation the primary button in
    // the error colour.
    expect(flatStyle(screen.getByText('Vazgeç')).color).toBe(T.text);
    expect(flatStyle(screen.getByTestId('dialog-cancel-face')).backgroundColor).toBe(raisedFace(T, 'surface'));
    expect(flatStyle(screen.getByText('Sil')).color).toBe(T.onAction);
  });
});

describe('Dialog on Android', () => {
  const SCREEN_H = Dimensions.get('screen').height;
  const windowLayout = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height } } });

  beforeEach(() => jest.replaceProperty(Platform, 'OS', 'android'));
  afterEach(() => resetSheetPresence());

  /** Android added the window: the Modal's onShow. */
  const showWindow = () =>
    act(() => {
      fireEvent(screen.UNSAFE_getByType(Modal), 'show');
      jest.advanceTimersByTime(17);
    });

  it('enters only once its window has the real size, never in the provisional one', () => {
    const held = holdTimings();
    const { rerender } = renderWithProviders(<Question />);
    showWindow();
    expect(held).toHaveLength(0);
    expect(isAnyWindowWaiting()).toBe(true);
    rerender(<Question />);
    expect(flatStyle(screen.getByTestId('dialog')).opacity).toBe(0);

    fireEvent(screen.getByTestId('dialog-window'), 'layout', windowLayout(SCREEN_H - 76));
    expect(held).toHaveLength(0);
    fireEvent(screen.getByTestId('dialog-window'), 'layout', windowLayout(SCREEN_H));
    expect(held).toEqual([expect.objectContaining({ toValue: 1, duration: DURATION.base })]);
    expect(isAnyWindowWaiting()).toBe(false);
  });

  it('a first window layout at the full height enters at once: no fallback wait, its timing noted for the veil', () => {
    const held = holdTimings();
    renderWithProviders(<Question />);
    showWindow();
    fireEvent(screen.getByTestId('dialog-window'), 'layout', windowLayout(SCREEN_H));
    expect(held).toEqual([expect.objectContaining({ toValue: 1, duration: DURATION.base })]);
    expect(isAnyWindowWaiting()).toBe(false);
    // A root veil held for this dialog fades out on the same timing.
    expect(lastWindowEnter()).toMatchObject({ duration: DURATION.base });
    // The fallback that would have started it is gone.
    act(() => jest.advanceTimersByTime(WINDOW_FALLBACK_MS));
    expect(held).toHaveLength(1);
  });

  it('enters after WINDOW_FALLBACK_MS when its window never reports the full size', () => {
    const held = holdTimings();
    renderWithProviders(<Question />);
    showWindow();
    fireEvent(screen.getByTestId('dialog-window'), 'layout', windowLayout(500));
    act(() => jest.advanceTimersByTime(WINDOW_FALLBACK_MS));
    expect(held).toEqual([expect.objectContaining({ toValue: 1, duration: DURATION.base })]);
  });

  it('onClosed comes in the batch that ends the exit (no effect in between)', () => {
    const held = holdTimings();
    const onClosed = jest.fn();
    const { rerender } = renderWithProviders(<Question onClosed={onClosed} />);
    showWindow();
    fireEvent(screen.getByTestId('dialog-window'), 'layout', windowLayout(SCREEN_H));
    rerender(<Question onClosed={onClosed} visible={false} />);
    act(() => {
      last(held).callback?.(true);
      expect(onClosed).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId('dialog')).toBeNull();
  });

  it('the fade and the scale start only once the window was shown (RB-3)', () => {
    const held = holdTimings();
    const { rerender } = renderWithProviders(<Question />);
    // The real size came first: still nothing until Android shows the window.
    fireEvent(screen.getByTestId('dialog-window'), 'layout', windowLayout(SCREEN_H));
    act(() => jest.advanceTimersByTime(WINDOW_FALLBACK_MS));
    expect(held).toHaveLength(0);
    rerender(<Question />);
    expect(flatStyle(screen.getByTestId('dialog')).opacity).toBe(0);
    expect(flatStyle(screen.getByTestId('dialog')).transform).toEqual([{ scale: 0.94 }]);

    act(() => fireEvent(screen.UNSAFE_getByType(Modal), 'show'));
    expect(held).toEqual([expect.objectContaining({ toValue: 1, duration: DURATION.base })]);
    expect(isAnyWindowWaiting()).toBe(false);
  });
});

describe('Dialog window root (VR-01)', () => {
  it('stays one native view through the exit: the pointerEvents flip never re-parents the scrim and the card', () => {
    const { rerender } = renderWithProviders(<Question />);
    const root = screen.getByTestId('dialog-window');
    expect(root.props.collapsable).toBe(false);
    expect(root.props.pointerEvents).toBe('auto');

    holdTimings();
    rerender(<Question visible={false} />);
    const closing = screen.getByTestId('dialog-window', { includeHiddenElements: true });
    expect(closing.props.pointerEvents).toBe('none');
    expect(closing.props.collapsable).toBe(false);
    // The same host view, and the scrim and the card still inside it.
    expect(closing).toBe(root);
    expect(closing).toContainElement(screen.getByTestId('dialog-scrim-layer', { includeHiddenElements: true }));
    expect(closing).toContainElement(screen.getByTestId('dialog', { includeHiddenElements: true }));
  });

  it('a dialog with a field (keyboard root) is never flattened either', () => {
    renderWithProviders(
      <Question>
        <TextInput testID="field" />
      </Question>,
    );
    expect(screen.getByTestId('dialog-window').props.collapsable).toBe(false);
  });
});

describe('orderDialogButtons', () => {
  it('puts the cancel button first and keeps the rest in the caller order', () => {
    expect(
      orderDialogButtons([
        { text: 'Sil', style: 'destructive' },
        { text: 'Arşivle' },
        { text: 'Vazgeç', style: 'cancel' },
      ]).map(button => button.text),
    ).toEqual(['Vazgeç', 'Sil', 'Arşivle']);
  });
});

describe('OptionsDialog (the useDialog contract)', () => {
  it('closes and runs the button', () => {
    const onClose = jest.fn();
    const onDelete = jest.fn();
    renderWithProviders(
      <OptionsDialog
        visible
        onClose={onClose}
        options={{
          title: 'Sesi sil',
          message: 'Geri alınamaz.',
          icon: 'delete',
          buttons: [
            { text: 'Sil', style: 'destructive', onPress: onDelete },
            { text: 'Vazgeç', style: 'cancel' },
          ],
        }}
      />,
    );
    // Cancel is drawn first whatever the caller order.
    expect(
      screen
        .getAllByRole('button')
        .map(node => node.props.accessibilityLabel),
    ).toEqual(['Vazgeç', 'Sil']);

    fireEvent.press(screen.getByText('Vazgeç'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Sil'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);
    // The dialog closes before the action runs.
    expect(onClose.mock.invocationCallOrder[1]).toBeLessThan(onDelete.mock.invocationCallOrder[0]);
  });

  it('runs afterClose only once the window is gone, never in the press (VR-01)', () => {
    const held = holdTimings();
    const calls: string[] = [];
    const options = {
      title: 'Kaydı bırakıyor musun?',
      buttons: [
        { text: 'Çık', style: 'destructive' as const, onPress: () => calls.push('press'), afterClose: () => calls.push('after') },
        { text: 'Kayda devam et', style: 'cancel' as const },
      ],
    };
    function Host() {
      const [visible, setVisible] = React.useState(true);
      return <OptionsDialog visible={visible} options={options} onClose={() => setVisible(false)} />;
    }
    renderWithProviders(<Host />);
    fireEvent.press(screen.getByText('Çık'));
    // The exit runs: the button ran, the follow-up waits.
    expect(calls).toEqual(['press']);
    expect(screen.getByTestId('dialog-window')).toBeOnTheScreen();

    act(() => last(held.filter(entry => entry.callback)).callback?.(true));
    expect(screen.queryByTestId('dialog-window')).toBeNull();
    expect(calls).toEqual(['press', 'after']);
  });

  it('a pressed afterClose also runs when the dialog unmounts during its exit, and only once', () => {
    holdTimings();
    const afterClose = jest.fn();
    const options = { title: 'Soru', buttons: [{ text: 'Tamam', afterClose }] };
    function Host({ shown }: { shown: boolean }) {
      const [visible, setVisible] = React.useState(true);
      return shown ? <OptionsDialog visible={visible} options={options} onClose={() => setVisible(false)} /> : null;
    }
    const { rerender } = renderWithProviders(<Host shown />);
    fireEvent.press(screen.getByText('Tamam'));
    expect(afterClose).not.toHaveBeenCalled();
    rerender(<Host shown={false} />);
    expect(afterClose).toHaveBeenCalledTimes(1);
  });

  it('a button without afterClose, or a cancel, queues nothing', () => {
    const held = holdTimings();
    const afterClose = jest.fn();
    const options = {
      title: 'Soru',
      buttons: [
        { text: 'Sil', style: 'destructive' as const, afterClose },
        { text: 'Vazgeç', style: 'cancel' as const },
      ],
    };
    function Host() {
      const [visible, setVisible] = React.useState(true);
      return <OptionsDialog visible={visible} options={options} onClose={() => setVisible(false)} />;
    }
    renderWithProviders(<Host />);
    fireEvent.press(screen.getByText('Vazgeç'));
    act(() => last(held.filter(entry => entry.callback)).callback?.(true));
    expect(afterClose).not.toHaveBeenCalled();
  });

  it('defaults to one OK button in the UI language', async () => {
    const onClose = jest.fn();
    const { rerender } = renderWithProviders(
      <OptionsDialog visible options={{ title: 'Bilgi' }} onClose={onClose} />,
    );
    fireEvent.press(screen.getByText('Tamam'));
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(() => i18n.changeLanguage('en'));
    rerender(<OptionsDialog visible options={{ title: 'Info' }} onClose={onClose} />);
    expect(screen.getByText('OK')).toBeOnTheScreen();
  });

  it('cancelable: false keeps the dialog open on a scrim tap and on the back button', () => {
    const onClose = jest.fn();
    renderWithProviders(
      <OptionsDialog visible options={{ title: 'Zorunlu', cancelable: false }} onClose={onClose} />,
    );
    fireEvent.press(screen.getByTestId('dialog-scrim', { includeHiddenElements: true }));
    fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
    expect(onClose).not.toHaveBeenCalled();

    // Its button still closes it.
    fireEvent.press(screen.getByText('Tamam'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('useDialog', () => {
  function Trigger({ onConfirm }: { onConfirm: () => void }) {
    const { showDialog, hideDialog } = useDialog();
    return (
      <>
        <Text
          onPress={() =>
            showDialog({
              title: 'Çıkış yapılsın mı?',
              buttons: [
                { text: 'Vazgeç', style: 'cancel' },
                { text: 'Çıkış yap', onPress: onConfirm },
              ],
            })
          }
        >
          ac
        </Text>
        <Text onPress={hideDialog}>kapat</Text>
      </>
    );
  }

  it('shows the dialog, runs the action and hides it', () => {
    const onConfirm = jest.fn();
    renderWithProviders(
      <DialogProvider>
        <Trigger onConfirm={onConfirm} />
      </DialogProvider>,
      { theme: 'gece-mavisi' },
    );
    expect(screen.queryByTestId('dialog')).toBeNull();

    fireEvent.press(screen.getByText('ac'));
    expect(flatStyle(screen.getByTestId('dialog')).borderRadius).toBe(28);
    fireEvent.press(screen.getByText('Çıkış yap'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('dialog')).toBeNull();

    fireEvent.press(screen.getByText('ac'));
    expect(screen.getByTestId('dialog')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('kapat'));
    expect(screen.queryByTestId('dialog')).toBeNull();
  });

  it('a button that shows a second dialog leaves it on screen', () => {
    function Chain() {
      const { showDialog } = useDialog();
      return (
        <Text
          onPress={() =>
            showDialog({
              title: 'Birinci',
              buttons: [
                { text: 'Vazgeç', style: 'cancel' },
                { text: 'Devam', onPress: () => showDialog({ title: 'Ikinci' }) },
              ],
            })
          }
        >
          ac
        </Text>
      );
    }
    renderWithProviders(
      <DialogProvider>
        <Chain />
      </DialogProvider>,
    );
    fireEvent.press(screen.getByText('ac'));
    fireEvent.press(screen.getByText('Devam'));

    expect(screen.getByText('Ikinci')).toBeOnTheScreen();
    expect(screen.queryByText('Birinci')).toBeNull();
    expect(screen.getAllByTestId('dialog')).toHaveLength(1);
  });

  it('a dialog shown during the exit of the last one comes back with the new options', () => {
    const held = holdTimings();
    let api: ReturnType<typeof useDialog> | null = null;
    function Grab() {
      api = useDialog();
      return null;
    }
    renderWithProviders(
      <DialogProvider>
        <Grab />
      </DialogProvider>,
    );
    act(() => api?.showDialog({ title: 'Birinci' }));
    act(() => api?.hideDialog());
    const exit = last(held);
    expect(exit.toValue).toBe(0);
    expect(screen.getByText('Birinci')).toBeOnTheScreen();

    act(() => api?.showDialog({ title: 'Ikinci' }));
    expect(last(held).toValue).toBe(1);
    expect(screen.getByText('Ikinci')).toBeOnTheScreen();

    // The interrupted exit's late end does not take it away.
    act(() => exit.callback?.(true));
    expect(screen.getByText('Ikinci')).toBeOnTheScreen();
  });
});
