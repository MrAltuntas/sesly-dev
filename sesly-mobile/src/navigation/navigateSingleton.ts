/**
 * The one way to open a screen that must exist at most once in the stack:
 * Profile, Notifications, Subscription and DataDeletion.
 *
 * React Navigation 7's `navigate` no longer goes back to a screen that is
 * already in the stack; it pushes a second copy (Profile, Notifications,
 * then "Bildirim tercihleri" stacked a second Profile). `{ pop: true }`
 * restores the old rule: when the route is already below, the stack pops back
 * to it (with the new params), otherwise it is pushed as usual.
 *
 *   navigateSingleton(nav, 'Subscription');
 */

import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from './RootNavigator';

export const SINGLETON_ROUTES = ['Profile', 'Notifications', 'Subscription', 'DataDeletion'] as const;

export type SingletonRoute = (typeof SINGLETON_ROUTES)[number];

/** Any navigation object of the root stack, a tab screen's or the container ref. */
export type SingletonNavigation = Pick<NavigationProp<RootStackParamList>, 'navigate'>;

type NavigateWithPop = <Name extends SingletonRoute>(
  name: Name,
  params: RootStackParamList[Name] | undefined,
  options: { pop: boolean },
) => void;

export function navigateSingleton<Name extends SingletonRoute>(
  nav: SingletonNavigation,
  name: Name,
  params?: RootStackParamList[Name],
): void {
  // navigate's argument tuple is a conditional type that a generic route name
  // cannot resolve; every singleton route takes optional params, so this
  // narrower signature is the same call.
  (nav.navigate as NavigateWithPop).call(nav, name, params, { pop: true });
}
