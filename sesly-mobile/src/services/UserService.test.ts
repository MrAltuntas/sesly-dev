import { apiErrorFromResponse } from './ApiError';
import { SubscriptionTier } from '../types/enums';

const mockGet = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();
const mockUpload = jest.fn();

jest.mock('./ApiClient', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    upload: (...args: unknown[]) => mockUpload(...args),
  },
}));

import UserService from './UserService';

// Backend UserResponseDto.fromUser (users/dto/user-response.dto.ts).
const backendUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'u-1',
  email: 'veli@example.com',
  firstName: 'Ayse',
  lastName: 'Yilmaz',
  provider: 'google',
  emailVerified: true,
  avatarUrl: 'https://storage.googleapis.com/sesly/avatars/u-1.jpg?sig=1',
  profileImageUrl: 'https://storage.googleapis.com/sesly/avatars/u-1.jpg?sig=1',
  subscriptionTier: 'PRO',
  subscriptionExpiresAt: '2026-12-01T00:00:00.000Z',
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  mockGet.mockReset();
  mockPatch.mockReset();
  mockDelete.mockReset();
  mockUpload.mockReset();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('UserService.getCurrentUser', () => {
  it('GETs /users/me and parses the backend user', async () => {
    mockGet.mockResolvedValue(backendUser());

    const user = await UserService.getCurrentUser();

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet.mock.calls[0][0]).toBe('/users/me');
    expect(mockGet.mock.calls[0][1]).toBeUndefined();
    expect(user).toMatchObject({
      id: 'u-1',
      email: 'veli@example.com',
      firstName: 'Ayse',
      provider: 'GOOGLE',
      subscriptionTier: SubscriptionTier.PRO,
      profileImageUrl: 'https://storage.googleapis.com/sesly/avatars/u-1.jpg?sig=1',
    });
    expect(user.subscriptionExpiresAt).toEqual(new Date('2026-12-01T00:00:00.000Z'));
  });

  it('falls back to avatarUrl and FREE for older payloads', async () => {
    mockGet.mockResolvedValue(
      backendUser({ profileImageUrl: undefined, subscriptionTier: 'PREMIUM_OLD', subscriptionExpiresAt: null }),
    );
    const user = await UserService.getCurrentUser();
    expect(user.profileImageUrl).toBe('https://storage.googleapis.com/sesly/avatars/u-1.jpg?sig=1');
    expect(user.subscriptionTier).toBe(SubscriptionTier.FREE);
    expect(user.subscriptionExpiresAt).toBeNull();
  });

  it('rejects an invalid user and rethrows client errors', async () => {
    mockGet.mockResolvedValue(backendUser({ email: '' }));
    await expect(UserService.getCurrentUser()).rejects.toThrow(/email/);

    const error = apiErrorFromResponse(401, {});
    mockGet.mockRejectedValue(error);
    await expect(UserService.getCurrentUser()).rejects.toBe(error);
  });

  it('passes the request config through (the launch restore timeout)', async () => {
    mockGet.mockResolvedValue(backendUser());

    await UserService.getCurrentUser({ timeout: 8000 });

    expect(mockGet).toHaveBeenCalledWith('/users/me', { timeout: 8000 });
  });

  it('logs every failure except a 401, which the session flow owns', async () => {
    mockGet.mockRejectedValueOnce(apiErrorFromResponse(401, {}));
    await expect(UserService.getCurrentUser()).rejects.toMatchObject({ status: 401 });
    expect(console.error).not.toHaveBeenCalled();

    mockGet.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
    await expect(UserService.getCurrentUser()).rejects.toMatchObject({ status: 500 });
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe('UserService.updateProfile', () => {
  it('PATCHes /users/me with only the non-empty fields', async () => {
    mockPatch.mockResolvedValue(backendUser({ firstName: 'Fatma' }));

    const user = await UserService.updateProfile({ firstName: 'Fatma', lastName: '' });

    expect(mockPatch).toHaveBeenCalledWith('/users/me', { firstName: 'Fatma' });
    expect(user.firstName).toBe('Fatma');
  });

  it('rethrows validation errors', async () => {
    const error = apiErrorFromResponse(400, { message: ['email must be an email'] });
    mockPatch.mockRejectedValue(error);
    await expect(UserService.updateProfile({ email: 'x' })).rejects.toBe(error);
  });
});

describe('UserService.uploadAvatar', () => {
  it('uploads an avatar part to /users/me/avatar and returns the readable URL', async () => {
    const appendSpy = jest.spyOn(FormData.prototype, 'append');
    mockUpload.mockResolvedValue({
      message: 'Avatar uploaded successfully',
      avatarUrl: 'https://storage.googleapis.com/sesly/avatars/u-1/new.jpg?sig=2',
      profileImageUrl: 'https://storage.googleapis.com/sesly/avatars/u-1/new.jpg?sig=2',
    });
    const onProgress = jest.fn();

    const url = await UserService.uploadAvatar('file:///photos/me.jpg', onProgress);

    expect(url).toBe('https://storage.googleapis.com/sesly/avatars/u-1/new.jpg?sig=2');
    expect(mockUpload.mock.calls[0][0]).toBe('/users/me/avatar');
    expect(appendSpy).toHaveBeenCalledWith('avatar', {
      uri: 'file:///photos/me.jpg',
      type: 'image/jpeg',
      name: expect.stringMatching(/^avatar_\d+\.jpg$/),
    });

    const progressCb = mockUpload.mock.calls[0][2] as (e: { loaded: number; total?: number }) => void;
    progressCb({ loaded: 50, total: 200 });
    progressCb({ loaded: 50 });
    expect(onProgress.mock.calls).toEqual([[25]]);
  });

  it('rejects a response without avatarUrl and rethrows 413', async () => {
    mockUpload.mockResolvedValue({ message: 'ok' });
    await expect(UserService.uploadAvatar('file:///a.jpg')).rejects.toThrow(/avatarUrl/);

    const error = apiErrorFromResponse(413, {});
    mockUpload.mockRejectedValue(error);
    await expect(UserService.uploadAvatar('file:///a.jpg')).rejects.toBe(error);
  });
});

describe('UserService.deleteAccount', () => {
  it('DELETEs /users/me and rethrows errors', async () => {
    mockDelete.mockResolvedValue({ success: true });
    await expect(UserService.deleteAccount()).resolves.toBeUndefined();
    expect(mockDelete).toHaveBeenCalledWith('/users/me');

    const error = apiErrorFromResponse(500, {});
    mockDelete.mockRejectedValue(error);
    await expect(UserService.deleteAccount()).rejects.toBe(error);
  });
});
