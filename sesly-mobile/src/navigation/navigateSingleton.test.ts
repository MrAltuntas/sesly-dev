/**
 * navigateSingleton: Profile, Notifications, Subscription and DataDeletion
 * always navigate with `{ pop: true }`, so an existing copy below is reused.
 * The behaviour against a real stack is in navigationStack.test.tsx.
 */

import { SINGLETON_ROUTES, navigateSingleton, type SingletonNavigation } from './navigateSingleton';

function makeNav() {
  const navigate = jest.fn();
  return { nav: { navigate } as unknown as SingletonNavigation, navigate };
}

describe('navigateSingleton', () => {
  it.each(SINGLETON_ROUTES)('opens %s with pop: true', name => {
    const { nav, navigate } = makeNav();

    navigateSingleton(nav, name);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(name, undefined, { pop: true });
  });

  it('calls navigate on the navigation object it was given', () => {
    const calls: unknown[] = [];
    const nav = {
      navigate(this: unknown) {
        calls.push(this);
      },
    } as unknown as SingletonNavigation;

    navigateSingleton(nav, 'Notifications');

    expect(calls).toEqual([nav]);
  });

  it('covers exactly the four single-copy screens', () => {
    expect([...SINGLETON_ROUTES].sort()).toEqual(['DataDeletion', 'Notifications', 'Profile', 'Subscription']);
  });
});
