/**
 * showToast: the app-wide "tell the user something briefly" API.
 *
 * Since design v3 these messages are snackbars at the bottom of the screen
 * (components/design/Snackbar). The old signature is kept so every existing
 * call site keeps working:
 *
 *   showToast.success('Masal kaydedildi');
 *   showToast.error('Bağlantı kurulamadı', 'Hata');   // the title is dropped
 *   showToast.success('Parmak Kız kaydedildi', undefined, {
 *     label: 'Göster',
 *     onPress: () => ...,
 *   });
 *
 * A snackbar is one line, so the old title ("Hata", "Başarılı") is not shown;
 * it is used only when the message itself is empty.
 */

import { snackbar } from '../components/design/Snackbar';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export type ToastLevel = 'success' | 'error' | 'info' | 'warning';

/** Errors and warnings stay a little longer than confirmations. */
export const TOAST_DURATION: Record<ToastLevel, number> = {
  success: 3000,
  info: 3000,
  warning: 3500,
  error: 4000,
};

function show(level: ToastLevel, message: string, title?: string, action?: ToastAction): void {
  const text = (message ?? '').trim() || (title ?? '').trim();
  if (!text) return;
  snackbar.show({
    message: text,
    actionLabel: action?.label,
    onAction: action?.onPress,
    // An action needs time to be read and reached.
    duration: action ? Math.max(TOAST_DURATION[level], 6000) : TOAST_DURATION[level],
    // The leading mark: a check for a confirmation, an alert for a problem.
    tone: level === 'info' ? 'neutral' : level,
  });
}

export const showToast = {
  success: (message: string, title?: string, action?: ToastAction) =>
    show('success', message, title, action),
  error: (message: string, title?: string, action?: ToastAction) =>
    show('error', message, title, action),
  info: (message: string, title?: string, action?: ToastAction) =>
    show('info', message, title, action),
  warning: (message: string, title?: string, action?: ToastAction) =>
    show('warning', message, title, action),
};
