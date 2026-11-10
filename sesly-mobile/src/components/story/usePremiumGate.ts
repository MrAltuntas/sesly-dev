/**
 * usePremiumGate: premium stories in a story list (Keşfet, Yeni eklenenler,
 * a collection).
 *
 * Premium stories play on every paid plan: Mini and Premium (owner
 * decision; `hasPremiumStories`, from GET /usage when it answered). On the
 * free plan a premium card carries the lock, has no bookmark, and a tap
 * opens "Bu masal ücretli planlarda" with "Planları gör" instead of the
 * story page, which would only answer 403.
 *
 *   const gate = usePremiumGate();
 *   const locked = gate.isLocked(story);       // in the screen's render (observer)
 *   if (gate.isLocked(story)) gate.showPlans(); else open(story);
 *
 * Read it in an observer's render: the lock follows a plan change at once.
 * Needs the DialogProvider (the app root has it).
 */

import { useCallback, useMemo } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import i18n from '../../i18n';
import { msg } from '../../i18n/messages';
import { useDialog } from '../../hooks/useDialog';
import { useSubscription } from '../../hooks/useSubscription';
import { navigateSingleton } from '../../navigation/navigateSingleton';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import type { Story } from '../../models/Story';

export interface PremiumGate {
  /** The plan plays no premium story (the free plan). */
  readonly locksPremium: boolean;
  /** This story cannot be opened on the plan. */
  isLocked: (story: Pick<Story, 'isPremium'>) => boolean;
  /** "Bu masal ücretli planlarda", with "Planları gör" opening the plans. */
  showPlans: () => void;
}

export function usePremiumGate(): PremiumGate {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showDialog } = useDialog();
  const locksPremium = !useSubscription().hasPremiumStories;

  const showPlans = useCallback(() => {
    showDialog({
      title: msg('quota.premiumStory.title'),
      message: msg('quota.premiumStory.message'),
      buttons: [
        { text: msg('quota.seePlans'), onPress: () => navigateSingleton(nav, 'Subscription', { reason: 'premiumStory' }) },
        { text: i18n.t('common:cancel'), style: 'cancel' },
      ],
    });
  }, [nav, showDialog]);

  return useMemo(
    () => ({
      locksPremium,
      isLocked: (story: Pick<Story, 'isPremium'>) => locksPremium && story.isPremium,
      showPlans,
    }),
    [locksPremium, showPlans],
  );
}
