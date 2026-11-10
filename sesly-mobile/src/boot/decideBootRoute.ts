/**
 * The first route of a launch, decided from what the device already knows.
 *
 * Pure: BootStore gathers the input (the cached /app/config, the stored
 * tokens, the cached /users/me answer, the restore outcome, the onboarding
 * flag) and RootNavigator mounts on the answer as its initial state. Nothing
 * here waits for the network; `'wait'` tells BootStore that only the live
 * session check can decide (tokens without a cached user).
 */

import type { ForceUpdateInfo } from '../models/AppConfig';
import type { RestoreOutcome } from '../session/restoreOutcome';

/** Why the NoInternet route is shown (its copy follows the reason). */
export type NoInternetReason = 'offline' | 'server' | 'maintenance';

export type BootRoute =
  | { name: 'ForceUpdate'; params: ForceUpdateInfo }
  | { name: 'Main' }
  | { name: 'Login'; params?: { firstRun?: boolean } }
  | { name: 'Onboarding' }
  | { name: 'NoInternet'; params: { reason: NoInternetReason } };

export type BootRouteName = BootRoute['name'];

export interface BootRouteInput {
  /** From the cached config, evaluated now; null when no update is required. */
  forceUpdate: ForceUpdateInfo | null;
  hasTokens: boolean;
  /** The AuthStore already shows a cached user (only meaningful with tokens). */
  hasCachedUser: boolean;
  restore: RestoreOutcome | 'pending';
  hasSeenOnboarding: boolean;
}

/**
 * Rules, in order:
 * 1. a cached force update wins over everything: ForceUpdate;
 * 2. tokens and a cached user: Main (the live check runs in the background);
 * 3. tokens without a cached user: `'wait'` while the restore is pending,
 *    then restored: Main, rejected or none: Login, offline / server /
 *    maintenance: NoInternet with that reason;
 * 4. no tokens: Login once onboarding was seen, else Onboarding.
 */
export function decideBootRoute(input: BootRouteInput): BootRoute | 'wait' {
  if (input.forceUpdate) {
    return { name: 'ForceUpdate', params: input.forceUpdate };
  }
  if (input.hasTokens) {
    if (input.hasCachedUser) {
      return { name: 'Main' };
    }
    switch (input.restore) {
      case 'pending':
        return 'wait';
      case 'restored':
        return { name: 'Main' };
      case 'rejected':
      case 'none':
        return { name: 'Login' };
      case 'offline':
      case 'server':
      case 'maintenance':
        return { name: 'NoInternet', params: { reason: input.restore } };
    }
  }
  return input.hasSeenOnboarding ? { name: 'Login' } : { name: 'Onboarding' };
}

/** A root route as React Navigation's initial state takes it. */
export interface BootRouteState {
  name: BootRouteName;
  params?: object;
}

/**
 * The route as `{ name, params }` for `NavigationContainer initialState` and
 * `navigationRef.reset`. Params are copied (navigation state must not share
 * objects with the store); a route without params has no `params` key.
 */
export function bootRouteToState(route: BootRoute): BootRouteState {
  if ('params' in route && route.params !== undefined) {
    return { name: route.name, params: { ...route.params } };
  }
  return { name: route.name };
}
