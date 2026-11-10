/**
 * The cached /users/me record (@sesly/me) and the cache owner check.
 * AsyncStorage is the global in-memory mock.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseUserFromJSON, type User } from '../models/User';
import { SubscriptionTier } from '../types/enums';
import { mockUserJSON } from '../test-utils/mock-data';
import {
  CACHED_USER_STORAGE_KEY,
  clearCachedUser,
  readCachedUser,
  writeCachedUser,
} from './userCache';

const mockClearAudioCache = jest.fn();
jest.mock('../services/CacheService', () => ({
  __esModule: true,
  default: {
    clearAudioCache: (...a: unknown[]) => mockClearAudioCache(...a),
  },
}));

// Imported after the mock so it binds to the fake CacheService.
import { LAST_USER_ID_STORAGE_KEY, claimCacheOwner } from './cacheOwner';

const user: User = parseUserFromJSON({
  ...mockUserJSON,
  subscriptionTier: 'PRO',
  subscriptionExpiresAt: '2026-12-01T00:00:00.000Z',
});

/** Let the fire-and-forget removals settle. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(async () => {
  await AsyncStorage.clear();
  mockClearAudioCache.mockReset().mockResolvedValue(undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('userCache', () => {
  it('round trip: what is written reads back as the same user', async () => {
    await writeCachedUser(user);

    const raw = await AsyncStorage.getItem(CACHED_USER_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toMatchObject({ v: 1, user: { id: user.id } });

    const read = readCachedUser(raw);
    expect(read).toEqual(user);
    expect(read?.subscriptionTier).toBe(SubscriptionTier.PRO);
    expect(read?.createdAt).toBeInstanceOf(Date);
    expect(read?.subscriptionExpiresAt).toEqual(new Date('2026-12-01T00:00:00.000Z'));
  });

  it('stores the documented key and never a token', async () => {
    await writeCachedUser(user);

    expect(CACHED_USER_STORAGE_KEY).toBe('@sesly/me');
    const raw = (await AsyncStorage.getItem(CACHED_USER_STORAGE_KEY)) as string;
    expect(raw).not.toMatch(/token/i);
  });

  it('null raw value: null, nothing removed', async () => {
    expect(readCachedUser(null)).toBeNull();
    await flush();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['a JSON string', '"me"'],
    ['an unknown version', JSON.stringify({ v: 2, user: mockUserJSON })],
    ['no version', JSON.stringify({ user: mockUserJSON })],
    ['a user without an id', JSON.stringify({ v: 1, user: { ...mockUserJSON, id: '' } })],
    ['no user', JSON.stringify({ v: 1 })],
  ])('%s: returns null and removes the key', async (_label, raw) => {
    await AsyncStorage.setItem(CACHED_USER_STORAGE_KEY, raw);

    expect(readCachedUser(raw)).toBeNull();
    await flush();

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(CACHED_USER_STORAGE_KEY);
    await expect(AsyncStorage.getItem(CACHED_USER_STORAGE_KEY)).resolves.toBeNull();
  });

  it('clearCachedUser removes the record', async () => {
    await writeCachedUser(user);
    await clearCachedUser();
    await expect(AsyncStorage.getItem(CACHED_USER_STORAGE_KEY)).resolves.toBeNull();
  });

  it('write and clear never throw on a storage failure', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('locked'));

    await expect(writeCachedUser(user)).resolves.toBeUndefined();
    await expect(clearCachedUser()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('write does not throw for a user whose dates cannot be serialised', async () => {
    const broken = { ...user, createdAt: new Date('not a date') };
    await expect(writeCachedUser(broken)).resolves.toBeUndefined();
    await expect(AsyncStorage.getItem(CACHED_USER_STORAGE_KEY)).resolves.toBeNull();
  });
});

describe('claimCacheOwner', () => {
  it('the same user as last time: no audio cache clear', async () => {
    await AsyncStorage.setItem(LAST_USER_ID_STORAGE_KEY, 'user-1');

    await claimCacheOwner('user-1');

    expect(mockClearAudioCache).not.toHaveBeenCalled();
    await expect(AsyncStorage.getItem(LAST_USER_ID_STORAGE_KEY)).resolves.toBe('user-1');
  });

  it('a different user: clears the audio cache without waiting and stores the new owner', async () => {
    await AsyncStorage.setItem(LAST_USER_ID_STORAGE_KEY, 'user-1');
    let finishClear: () => void = () => undefined;
    mockClearAudioCache.mockReturnValue(
      new Promise<void>(resolve => {
        finishClear = resolve;
      }),
    );

    await claimCacheOwner('user-2');

    // Resolved while the clear is still running.
    expect(mockClearAudioCache).toHaveBeenCalledTimes(1);
    await expect(AsyncStorage.getItem(LAST_USER_ID_STORAGE_KEY)).resolves.toBe('user-2');
    finishClear();
  });

  it('no stored owner yet counts as a different user', async () => {
    await claimCacheOwner('user-1');

    expect(mockClearAudioCache).toHaveBeenCalledTimes(1);
    await expect(AsyncStorage.getItem(LAST_USER_ID_STORAGE_KEY)).resolves.toBe('user-1');
  });

  it('a failing clear or storage read never throws', async () => {
    mockClearAudioCache.mockRejectedValue(new Error('disk'));
    await expect(claimCacheOwner('user-3')).resolves.toBeUndefined();
    await flush();

    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('locked'));
    await expect(claimCacheOwner('user-4')).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });
});
