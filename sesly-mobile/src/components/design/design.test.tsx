/**
 * The app mark and the dialog behind `useDialog`.
 */

import React from 'react';
import { Modal, Text } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '../../test-utils/render-helpers';
import { OptionsDialog, SeslyMark } from './index';
import { DialogProvider, useDialog } from '../../hooks/useDialog';
import type { DialogOptions } from '../../hooks/useDialog';

describe('SeslyMark', () => {
  it('renders the mark with its label', () => {
    renderWithProviders(<SeslyMark size={30} />);
    expect(screen.getByLabelText('Sesly')).toBeTruthy();
  });
});

describe('dialog via useDialog', () => {
  function Trigger({ options }: { options: DialogOptions }) {
    const { showDialog } = useDialog();
    return <Text onPress={() => showDialog(options)}>ac</Text>;
  }

  const deleteOptions = (onDelete: () => void): DialogOptions => ({
    title: 'Sesi sil',
    message: 'Bu ses kalıcı olarak silinecek.',
    buttons: [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: onDelete },
    ],
  });

  it('closes the dialog and runs the button', () => {
    const onDelete = jest.fn();
    renderWithProviders(
      <DialogProvider>
        <Trigger options={deleteOptions(onDelete)} />
      </DialogProvider>,
    );
    expect(screen.queryByText('Sesi sil')).toBeNull();

    fireEvent.press(screen.getByText('ac'));
    expect(screen.getByText('Bu ses kalıcı olarak silinecek.')).toBeTruthy();

    fireEvent.press(screen.getByText('Sil'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Sesi sil')).toBeNull();
  });

  it('a button that reports the result in a new dialog leaves that one open', () => {
    function Chained() {
      const { showDialog } = useDialog();
      return (
        <Trigger
          options={deleteOptions(() =>
            showDialog({ title: 'Silinemedi', message: 'Bağlantını kontrol edip yeniden dene.' }),
          )}
        />
      );
    }
    renderWithProviders(
      <DialogProvider>
        <Chained />
      </DialogProvider>,
    );
    fireEvent.press(screen.getByText('ac'));
    fireEvent.press(screen.getByText('Sil'));
    expect(screen.getByText('Silinemedi')).toBeOnTheScreen();
    expect(screen.queryByText('Sesi sil')).toBeNull();
  });

  it('the Android back button closes a dialog, but not one that is not cancelable', () => {
    const { rerender } = renderWithProviders(
      <DialogProvider>
        <Trigger options={deleteOptions(jest.fn())} />
      </DialogProvider>,
    );
    fireEvent.press(screen.getByText('ac'));
    fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
    expect(screen.queryByText('Sesi sil')).toBeNull();

    rerender(
      <DialogProvider>
        <Trigger options={{ title: 'Ses oluşturulamadı', cancelable: false }} />
      </DialogProvider>,
    );
    fireEvent.press(screen.getByText('ac'));
    fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
    expect(screen.getByText('Ses oluşturulamadı')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Tamam'));
    expect(screen.queryByText('Ses oluşturulamadı')).toBeNull();
  });

  it('defaults to a single Tamam button', () => {
    const onClose = jest.fn();
    renderWithProviders(<OptionsDialog visible options={{ title: 'Bilgi' }} onClose={onClose} />);
    fireEvent.press(screen.getByText('Tamam'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('useDialog outside the provider throws', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    function Orphan() {
      useDialog();
      return null;
    }
    expect(() => renderWithProviders(<Orphan />)).toThrow('DialogProvider');
    error.mockRestore();
  });
});
