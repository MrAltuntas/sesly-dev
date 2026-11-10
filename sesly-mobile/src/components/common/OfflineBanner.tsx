/**
 * OfflineBanner: one quiet row, "Çevrimdışısın", while NetInfo says the
 * device is offline (ConnectivityStore). Renders nothing online, so it keeps
 * no space. MainScaffold mounts it as the first child of the bottom chrome,
 * above the mini player and the tab bar; lists keep their rows and a playing
 * story stays controllable.
 *
 * No motion: it appears and goes with the connection.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { Icon } from '../design/Icon';
import { connectivityStore } from '../../stores/ConnectivityStore';
import { Theme, themedStyles, useT, useTextStyles } from '../../theme/theme';

/** Height of the row (dp). */
export const OFFLINE_BANNER_HEIGHT = 28;

export const OfflineBanner: React.FC = observer(() => {
  const T = useT();
  const text = useTextStyles();
  const styles = stylesFor(T);
  const { t } = useTranslation('states');

  if (!connectivityStore.offline) {
    return null;
  }
  return (
    <View
      testID="offline-banner"
      style={styles.row}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Icon name="wifiOff" size={16} color={T.text2} />
      <Text style={[text.meta, styles.label]} numberOfLines={1}>
        {t('banner.offline')}
      </Text>
    </View>
  );
});

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    row: {
      minHeight: OFFLINE_BANNER_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: T.space.tight,
      paddingHorizontal: T.space.lg,
      backgroundColor: T.surface2,
    },
    label: { color: T.text2 },
  });

const stylesFor = themedStyles(makeStyles);

export default OfflineBanner;
