/**
 * ForceUpdateScreen: blocking "Güncelleme gerekli" gate, the boot route when
 * the stored GET /app/config says the installed version is below the
 * platform minimum, or reached later when the background refresh says so
 * (BootStore). There is no way past it except updating: no back gesture (set
 * in RootNavigator) and the Android back button is swallowed.
 *
 * Without a store link (iOS before the backend has the App Store URL) a plain
 * line says where to update, so the screen is never a dead end. Android
 * always has the Play listing.
 *
 * Not drawn in the mockups; it uses the full-screen state of the playful
 * system (brand bar, round icon badge, Baloo 2 title, one sentence, primary
 * button).
 */

import React, { useEffect } from 'react';
import { BackHandler, Linking, Platform } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { FullScreenState } from '../../components/states/FullScreenState';
import { showToast } from '../../utils/toast';
import { FALLBACK_ANDROID_STORE_URL } from '../../models/AppConfig';

type ForceUpdateParams = {
  ForceUpdate: { message?: string; storeUrl?: string | null } | undefined;
};

export async function openStoreUrl(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch (error) {
    console.warn('[ForceUpdate] openURL failed:', error);
    showToast.error(i18n.t('states:forceUpdate.storeFailed'));
  }
}

const ForceUpdateScreen: React.FC = () => {
  const route = useRoute<RouteProp<ForceUpdateParams, 'ForceUpdate'>>();
  const { t } = useTranslation('states');
  // The sentence is the one the backend sends; without one, ours in the UI
  // language.
  const message = route.params?.message?.trim() || t('forceUpdate.message');
  const storeUrl =
    route.params?.storeUrl ?? (Platform.OS === 'android' ? FALLBACK_ANDROID_STORE_URL : null);

  // Swallow the Android back button: this gate must not be skippable.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  return (
    <FullScreenState
      testID="force-update-screen"
      icon="info"
      title={t('forceUpdate.title')}
      message={message}
      action={
        storeUrl
          ? {
              label: t('forceUpdate.action'),
              icon: 'download',
              onPress: () => {
                void openStoreUrl(storeUrl);
              },
              testID: 'force-update-action',
            }
          : undefined
      }
      note={storeUrl ? undefined : t('forceUpdate.appStoreHint')}
      noteTestID="force-update-store-hint"
    />
  );
};

export default ForceUpdateScreen;
