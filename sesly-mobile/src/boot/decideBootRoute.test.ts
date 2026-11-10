/**
 * decideBootRoute: the first route from local data, rule by rule, and the
 * navigation state it becomes.
 */

import { BootRouteInput, bootRouteToState, decideBootRoute } from './decideBootRoute';
import type { ForceUpdateInfo } from '../models/AppConfig';
import type { RestoreOutcome } from '../session/restoreOutcome';

const UPDATE: ForceUpdateInfo = {
  message: 'Yeni sürüm hazır.',
  storeUrl: 'https://play.google.com/store/apps/details?id=com.sesly',
};

function input(overrides: Partial<BootRouteInput> = {}): BootRouteInput {
  return {
    forceUpdate: null,
    hasTokens: false,
    hasCachedUser: false,
    restore: 'pending',
    hasSeenOnboarding: false,
    ...overrides,
  };
}

describe('decideBootRoute', () => {
  describe('a cached force update', () => {
    it.each<[string, Partial<BootRouteInput>]>([
      ['signed in with a cached user', { hasTokens: true, hasCachedUser: true, restore: 'restored' }],
      ['tokens and a pending restore', { hasTokens: true, restore: 'pending' }],
      ['an offline restore', { hasTokens: true, restore: 'offline' }],
      ['signed out after onboarding', { hasSeenOnboarding: true, restore: 'none' }],
      ['a first launch', {}],
    ])('wins over everything (%s)', (_label, overrides) => {
      expect(decideBootRoute(input({ ...overrides, forceUpdate: UPDATE }))).toEqual({
        name: 'ForceUpdate',
        params: UPDATE,
      });
    });
  });

  it('goes to Main with tokens and a cached user, whatever the restore says so far', () => {
    for (const restore of ['pending', 'offline', 'server', 'maintenance'] as const) {
      expect(decideBootRoute(input({ hasTokens: true, hasCachedUser: true, restore }))).toEqual({
        name: 'Main',
      });
    }
  });

  it('waits for the restore with tokens and no cached user', () => {
    expect(decideBootRoute(input({ hasTokens: true, restore: 'pending' }))).toBe('wait');
    expect(
      decideBootRoute(input({ hasTokens: true, restore: 'pending', hasSeenOnboarding: true })),
    ).toBe('wait');
  });

  it.each<[RestoreOutcome, ReturnType<typeof decideBootRoute>]>([
    ['restored', { name: 'Main' }],
    ['rejected', { name: 'Login' }],
    ['none', { name: 'Login' }],
    ['offline', { name: 'NoInternet', params: { reason: 'offline' } }],
    ['server', { name: 'NoInternet', params: { reason: 'server' } }],
    ['maintenance', { name: 'NoInternet', params: { reason: 'maintenance' } }],
  ])('maps the restore outcome %s with tokens and no cache', (restore, expected) => {
    expect(decideBootRoute(input({ hasTokens: true, restore }))).toEqual(expected);
  });

  it('never sends a signed-in user with a failed check to Login', () => {
    for (const restore of ['offline', 'server', 'maintenance'] as const) {
      const route = decideBootRoute(input({ hasTokens: true, restore, hasSeenOnboarding: true }));
      expect(route).not.toEqual({ name: 'Login' });
    }
  });

  it('without tokens: Login once onboarding was seen, else Onboarding', () => {
    expect(decideBootRoute(input({ hasSeenOnboarding: true }))).toEqual({ name: 'Login' });
    expect(decideBootRoute(input({ hasSeenOnboarding: false }))).toEqual({ name: 'Onboarding' });
    // The restore outcome and a stray cache do not matter without tokens.
    expect(
      decideBootRoute(input({ hasSeenOnboarding: true, hasCachedUser: true, restore: 'restored' })),
    ).toEqual({ name: 'Login' });
    expect(decideBootRoute(input({ restore: 'offline' }))).toEqual({ name: 'Onboarding' });
  });
});

describe('bootRouteToState', () => {
  it('keeps the name and copies the params', () => {
    const route = { name: 'ForceUpdate', params: UPDATE } as const;
    const state = bootRouteToState(route);
    expect(state).toEqual({ name: 'ForceUpdate', params: UPDATE });
    expect(state.params).not.toBe(UPDATE);
  });

  it('has no params key for a route without params', () => {
    expect(bootRouteToState({ name: 'Main' })).toStrictEqual({ name: 'Main' });
    expect(bootRouteToState({ name: 'Onboarding' })).toStrictEqual({ name: 'Onboarding' });
    expect(bootRouteToState({ name: 'Login' })).toStrictEqual({ name: 'Login' });
  });

  it('carries the NoInternet reason and the Login first-run flag', () => {
    expect(bootRouteToState({ name: 'NoInternet', params: { reason: 'server' } })).toEqual({
      name: 'NoInternet',
      params: { reason: 'server' },
    });
    expect(bootRouteToState({ name: 'Login', params: { firstRun: true } })).toEqual({
      name: 'Login',
      params: { firstRun: true },
    });
  });
});
