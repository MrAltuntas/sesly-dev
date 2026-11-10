/**
 * OfflineState: the brand bar, the wifi-off badge, "İnternete bağlı
 * değilsin", one sentence and "Tekrar dene". The caller owns the retry.
 *
 * `title`, `message` and `icon` replace the offline copy for the other
 * reasons the app cannot reach Sesly (server down, maintenance) and for the
 * still-offline line after a retry.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { FullScreenState } from './FullScreenState';
import type { IconName } from '../design/Icon';

export interface OfflineStateProps {
  onRetry: () => void;
  /** The retry is running. */
  retrying?: boolean;
  /** Default `states:offline.title`. */
  title?: string;
  /** Default `states:offline.message`. */
  message?: string;
  /** Default 'wifiOff'. */
  icon?: IconName;
  testID?: string;
}

export const OfflineState: React.FC<OfflineStateProps> = ({
  onRetry,
  retrying,
  title,
  message,
  icon,
  testID,
}) => {
  const { t } = useTranslation('states');
  return (
    <FullScreenState
      testID={testID ?? 'offline-state'}
      icon={icon ?? 'wifiOff'}
      title={title ?? t('offline.title')}
      message={message ?? t('offline.message')}
      action={{
        label: t('common:retry'),
        onPress: onRetry,
        icon: 'restart',
        loading: retrying,
        testID: 'offline-retry',
      }}
    />
  );
};

export default OfflineState;
