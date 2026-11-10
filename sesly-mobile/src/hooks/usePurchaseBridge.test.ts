/**
 * usePurchaseBridge: the purchase store starts with the signed-in user and
 * stops on sign-out; usePurchases returns the one store.
 */

import { renderHook } from '@testing-library/react-native';

const mockStore = {
  start: jest.fn(async (_userId: string) => undefined),
  stop: jest.fn(),
};
jest.mock('../stores/PurchaseStore', () => ({ getPurchaseStore: () => mockStore }));

import { usePurchaseBridge, usePurchases } from './usePurchaseBridge';

describe('usePurchaseBridge', () => {
  it('starts for the user, starts again for another one and stops on sign-out', () => {
    const { rerender, unmount } = renderHook(({ userId }: { userId: string | null }) => usePurchaseBridge(userId), {
      initialProps: { userId: 'user-1' as string | null },
    });
    expect(mockStore.start).toHaveBeenCalledWith('user-1');

    rerender({ userId: 'user-2' });
    expect(mockStore.start).toHaveBeenLastCalledWith('user-2');

    rerender({ userId: null });
    expect(mockStore.stop).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('a failed start is only logged', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockStore.start.mockRejectedValueOnce(new Error('store down'));
    renderHook(() => usePurchaseBridge('user-1'));
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith('[iap] start failed:', expect.any(Error));
  });

  it('usePurchases returns the store', () => {
    const { result } = renderHook(() => usePurchases());
    expect(result.current).toBe(mockStore);
  });
});
