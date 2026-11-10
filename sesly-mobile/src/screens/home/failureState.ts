/**
 * The error state of a list screen by why its load failed (SPEC-startup
 * 4.3): offline shows "İnternete bağlı değilsin" with the wifi-off icon,
 * maintenance "Sesly bakımda" with the maintenance sentence, anything else
 * the screen's own copy ("Sorun bizde. Biraz sonra tekrar dene.").
 *
 *   const copy = failureCopy(storyStore.listErrorKind, {
 *     title: t('error.title'),
 *     message: t('error.message'),
 *   });
 *   <StateView icon={copy.icon} title={copy.title} message={copy.message} />
 *
 * Read while rendering, so it follows the UI language.
 */

import i18n from '../../i18n';
import { msg } from '../../i18n/messages';
import type { IconName } from '../../components/design';
import type { FailureKind } from '../../services/ApiError';

export interface FailureCopy {
  readonly icon: IconName;
  readonly title: string;
  readonly message: string;
}

export function failureCopy(
  kind: FailureKind | null | undefined,
  fallback: { readonly title: string; readonly message: string },
): FailureCopy {
  if (kind === 'offline') {
    return {
      icon: 'wifiOff',
      title: i18n.t('states:offline.title'),
      message: i18n.t('states:offline.message'),
    };
  }
  if (kind === 'maintenance') {
    return { icon: 'alert', title: i18n.t('states:maintenance.title'), message: msg('api.maintenance') };
  }
  return { icon: 'alert', title: fallback.title, message: fallback.message };
}
