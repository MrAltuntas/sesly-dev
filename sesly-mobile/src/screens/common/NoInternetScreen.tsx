/**
 * NoInternetScreen (design v4 playful full-screen state): the boot route of a
 * signed-in user whose session could not be checked and who has no cached
 * user to show (no connection, the server down, maintenance). Never Login:
 * the tokens are kept.
 *
 * `route.params.reason` picks the copy. "Tekrar dene" runs the session check
 * again: restored goes to Main, a refused or missing session to Login,
 * anything else stays and says so in place (no dialog). The screen also
 * retries by itself when the connection comes back, and goes to Main as soon
 * as the user is back in the AuthStore (an automatic retry that succeeded).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { RouteProp, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { observer } from 'mobx-react-lite';
import { OfflineState } from '../../components/states/OfflineState';
import type { IconName } from '../../components/design/Icon';
import { useAuth } from '../../hooks/useAuth';
import { connectivityStore } from '../../stores/ConnectivityStore';
import type { RestoreOutcome } from '../../session/restoreOutcome';
import type { NoInternetReason } from '../../boot/decideBootRoute';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type NoInternetParams = { NoInternet: { reason?: NoInternetReason } | undefined };

interface Copy {
  icon: IconName;
  title: string;
  message: string;
}

/** The copy for a reason (`t` of the states namespace); a failed retry swaps the offline sentence. */
function copyFor(reason: NoInternetReason, retryFailed: boolean, t: (key: string) => string): Copy {
  switch (reason) {
    case 'server':
      return { icon: 'alert', title: t('server.title'), message: t('server.message') };
    case 'maintenance':
      return { icon: 'clock', title: t('maintenance.title'), message: t('messages:api.maintenance') };
    default:
      return {
        icon: 'wifiOff',
        title: t('offline.title'),
        message: retryFailed ? t('offline.stillOfflineMessage') : t('offline.message'),
      };
  }
}

export const NoInternetScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<NoInternetParams, 'NoInternet'>>();
  const auth = useAuth();
  const isFocused = useIsFocused();
  const { t } = useTranslation('states');

  const [reason, setReason] = useState<NoInternetReason>(route.params?.reason ?? 'offline');
  const [retryFailed, setRetryFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const mounted = useRef(true);
  const inFlight = useRef(false);
  const left = useRef(false);
  const focused = useRef(isFocused);
  focused.current = isFocused;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const leave = useCallback(
    (name: 'Main' | 'Login') => {
      if (left.current) return;
      left.current = true;
      nav.reset({ index: 0, routes: [{ name }] });
    },
    [nav],
  );

  const retry = useCallback(async () => {
    if (inFlight.current || left.current) return;
    inFlight.current = true;
    setRetrying(true);
    let outcome: RestoreOutcome;
    try {
      outcome = await auth.retryRestore();
    } catch (error) {
      // retryRestore does not reject; if it ever does, stay here.
      console.warn('[NoInternet] retry failed:', error);
      outcome = 'server';
    } finally {
      inFlight.current = false;
      if (mounted.current) setRetrying(false);
    }
    if (!mounted.current) return;
    if (outcome === 'restored') {
      leave('Main');
    } else if (outcome === 'rejected' || outcome === 'none') {
      leave('Login');
    } else {
      setReason(outcome);
      setRetryFailed(true);
      // The sentence changes in place, without a dialog: a screen reader
      // hears the new one too.
      AccessibilityInfo.announceForAccessibility(copyFor(outcome, true, t).message);
    }
  }, [auth, leave, t]);

  // The connection came back: one retry per return, without a tap.
  useEffect(
    () =>
      connectivityStore.onReconnect(() => {
        if (focused.current) void retry();
      }),
    [retry],
  );

  // An automatic retry (AuthStore) put the user back: go on to Main.
  const signedIn = auth.backendUser !== null;
  useEffect(() => {
    if (signedIn && isFocused) leave('Main');
  }, [signedIn, isFocused, leave]);

  const copy = copyFor(reason, retryFailed, t);

  return (
    <OfflineState
      icon={copy.icon}
      title={copy.title}
      message={copy.message}
      onRetry={() => {
        void retry();
      }}
      retrying={retrying}
      testID="no-internet-screen"
    />
  );
});

export default NoInternetScreen;
