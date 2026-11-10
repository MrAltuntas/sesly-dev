/**
 * Where a successful sign-in or sign-up lands.
 *
 * The stack is reset to Main alone (docs/release-pass/SPEC-startup.md 5.6),
 * so back never returns to Login or Registration. "Sesimi kaydet" on
 * onboarding left the 'record' intent: it is read and removed here and the
 * reset opens Sesim, where the own-voice card applies the plan and slot
 * rules (7.10).
 */

import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { type OnboardingIntent, takeOnboardingIntent } from '../../boot/onboardingIntent';

/** Main's params for an onboarding intent (none: the Stories tab). */
export function mainParamsForIntent(intent: OnboardingIntent | null): RootStackParamList['Main'] {
  return intent === 'record' ? { screen: 'Voices' } : undefined;
}

/** Takes the onboarding intent and resets the stack to `[Main]`. Never throws. */
export async function enterAppAfterSignIn(
  navigation: Pick<NativeStackNavigationProp<RootStackParamList>, 'reset'>,
): Promise<void> {
  const intent = await takeOnboardingIntent();
  navigation.reset({ index: 0, routes: [{ name: 'Main', params: mainParamsForIntent(intent) }] });
}
