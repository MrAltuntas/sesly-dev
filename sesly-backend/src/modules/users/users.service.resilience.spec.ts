import { UsersService } from './users.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createMockUser, createMockVoiceProfile } from '../../test-utils/mock-factories';

/*
 * Account deletion (KVKK / GDPR) must always remove the DB row even when
 * storage, Cartesia or Firebase misbehave. These tests cover the
 * failure branches the main users.service.spec does not.
 */


const mockFirebaseAuth = { deleteUser: jest.fn(), getUserByEmail: jest.fn() };
const mockFirebaseState: { apps: unknown[] } = { apps: [{}] };
jest.mock('firebase-admin', () => ({
  get apps() {
    return mockFirebaseState.apps;
  },
  auth: () => mockFirebaseAuth,
}));

// Collaborators are injected as plain mocks; keep their heavy modules out.
jest.mock('../tts-providers/tts-provider.factory', () => ({ TTSProviderFactory: class TTSProviderFactory {} }));
jest.mock('../storage/storage.service', () => ({ StorageService: class StorageService {} }));

const USER = 'user-1';

describe('UsersService resilience', () => {
  let prisma: MockPrismaService;
  let storage: Record<string, jest.Mock>;
  let cloning: { deleteVoiceClone: jest.Mock };
  let service: UsersService;

  function build() {
    service = new UsersService(
      prisma as any,
      storage as any,
      { getCloningProvider: jest.fn(() => cloning) } as any,
    );
  }

  function userRow(overrides: Record<string, unknown> = {}) {
    return {
      ...createMockUser({
        id: USER,
        email: 'u1@test.sesly',
        providerId: 'firebase-uid-1',
        avatarUrl: 'avatars/user-1/old.jpg',
      }),
      voiceProfiles: [],
      subscription: { storePurchaseId: 'purchase-1' },
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = createMockPrismaService();
    storage = {
      deleteFile: jest.fn().mockResolvedValue(undefined),
      deleteFolder: jest.fn().mockResolvedValue(undefined),
      uploadFile: jest.fn().mockResolvedValue('avatars/user-1/new.png'),
      getReadUrl: jest.fn(async (v: string | null) => (v ? `signed:${v}` : null)),
    };
    cloning = { deleteVoiceClone: jest.fn().mockResolvedValue(undefined) };

    mockFirebaseAuth.deleteUser.mockReset().mockResolvedValue(undefined);
    mockFirebaseAuth.getUserByEmail.mockReset().mockRejectedValue({ code: 'auth/user-not-found' });
    mockFirebaseState.apps = [{}];

    prisma.audio.findMany.mockResolvedValue([]);
    prisma.user.delete.mockResolvedValue({ id: USER });
    prisma.voiceDeletionRequest.create.mockResolvedValue({ id: 'req-1' });
    prisma.user.update.mockImplementation(async (args: any) => ({ ...userRow(), ...args.data, subscription: null }));

    build();
  });

  // -------------------------------------------------------------------------
  describe('deleteUser', () => {
    it('revokes every token (tokenVersion bump) before the slow cleanup starts', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow());

      await service.deleteUser(USER);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER },
        data: { tokenVersion: { increment: 1 } },
      });
      const bumpAt = prisma.user.update.mock.invocationCallOrder[0];
      expect(bumpAt).toBeLessThan(storage.deleteFolder.mock.invocationCallOrder[0]);
      expect(bumpAt).toBeLessThan(prisma.user.delete.mock.invocationCallOrder[0]);
    });

    it('a failed token revocation never blocks the deletion', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow());
      prisma.user.update.mockRejectedValue(new Error('db hiccup'));

      await expect(service.deleteUser(USER)).resolves.toEqual({ message: 'Account deleted successfully' });
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: USER } });
    });

    it('still deletes the DB row when every external cleanup step fails', async () => {
      const profile = createMockVoiceProfile({
        id: 'vp-1',
        userId: USER,
        provider: 'CARTESIA',
        kind: 'CLONE',
        voiceCloningKey: 'cartesia-voice-1',
        sampleAudioUrl: 'voice-samples/user-1/vp-1/reference/a.wav',
        consentAudioUrl: null,
      });
      prisma.user.findUnique.mockResolvedValue(userRow({ voiceProfiles: [profile] }));
      prisma.audio.findMany.mockResolvedValue([{ id: 'audio-1' }]);
      prisma.voiceProfile.delete.mockRejectedValue(new Error('already gone'));
      storage.deleteFile.mockRejectedValue(new Error('GCS 500'));
      storage.deleteFolder.mockRejectedValue(new Error('GCS 500'));
      cloning.deleteVoiceClone.mockRejectedValue(new Error('Cartesia 503'));
      mockFirebaseAuth.deleteUser.mockRejectedValue({ code: 'auth/internal-error', message: 'boom' });

      await expect(service.deleteUser(USER)).resolves.toEqual({ message: 'Account deleted successfully' });

      // Every step was attempted...
      expect(storage.deleteFile).toHaveBeenCalledWith('voice-samples/user-1/vp-1/reference/a.wav');
      expect(storage.deleteFile).toHaveBeenCalledWith('avatars/user-1/old.jpg');
      expect(storage.deleteFolder).toHaveBeenCalledWith('voice-samples/user-1/');
      expect(storage.deleteFolder).toHaveBeenCalledWith('audio/audio-1/');
      expect(storage.deleteFolder).toHaveBeenCalledWith('avatars/user-1/');
      expect(mockFirebaseAuth.deleteUser).toHaveBeenCalledWith('firebase-uid-1');
      // ...the failed upstream deletion is recorded for the sweeper to retry...
      expect(prisma.voiceDeletionRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: expect.objectContaining({ status: 'FAILED' }),
      });
      // ...and the account row is gone regardless.
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: USER } });
    });

    it('a user with a store subscription is still deleted (the store keeps billing until cancelled there)', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow());
      await service.deleteUser(USER);
      expect(prisma.user.delete).toHaveBeenCalled();
    });

    it('a user without a store subscription is deleted the same way', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow({ subscription: null }));
      await service.deleteUser(USER);
      expect(prisma.user.delete).toHaveBeenCalled();
    });

    it('skips Firebase entirely when Firebase Admin is not initialised', async () => {
      mockFirebaseState.apps = [];
      prisma.user.findUnique.mockResolvedValue(userRow());

      await service.deleteUser(USER);

      expect(mockFirebaseAuth.deleteUser).not.toHaveBeenCalled();
      expect(mockFirebaseAuth.getUserByEmail).not.toHaveBeenCalled();
      expect(prisma.user.delete).toHaveBeenCalled();
    });

    it('deletes the Firebase user by uid and does not fall back to the email lookup', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow());
      await service.deleteUser(USER);
      expect(mockFirebaseAuth.deleteUser).toHaveBeenCalledTimes(1);
      expect(mockFirebaseAuth.getUserByEmail).not.toHaveBeenCalled();
    });

    it('without a providerId, finds the Firebase account by email and deletes it', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow({ providerId: null }));
      mockFirebaseAuth.getUserByEmail.mockResolvedValue({ uid: 'fb-by-email' });

      await service.deleteUser(USER);

      expect(mockFirebaseAuth.getUserByEmail).toHaveBeenCalledWith('u1@test.sesly');
      expect(mockFirebaseAuth.deleteUser).toHaveBeenCalledWith('fb-by-email');
    });

    it('a stale providerId (user-not-found) falls back to the email lookup', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow());
      mockFirebaseAuth.deleteUser
        .mockRejectedValueOnce({ code: 'auth/user-not-found' })
        .mockResolvedValueOnce(undefined);
      mockFirebaseAuth.getUserByEmail.mockResolvedValue({ uid: 'fb-by-email' });

      await service.deleteUser(USER);

      expect(mockFirebaseAuth.deleteUser).toHaveBeenNthCalledWith(1, 'firebase-uid-1');
      expect(mockFirebaseAuth.deleteUser).toHaveBeenNthCalledWith(2, 'fb-by-email');
    });

    it('an email-lookup error other than not-found is logged, not thrown', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow({ providerId: null }));
      mockFirebaseAuth.getUserByEmail.mockRejectedValue({ code: 'auth/quota-exceeded', message: 'quota' });

      await expect(service.deleteUser(USER)).resolves.toEqual({ message: 'Account deleted successfully' });
      expect(prisma.user.delete).toHaveBeenCalled();
    });

    it('a third-party avatar URL is not deleted from our bucket', async () => {
      prisma.user.findUnique.mockResolvedValue(
        userRow({ avatarUrl: 'https://lh3.googleusercontent.com/a/photo.jpg' }),
      );
      await service.deleteUser(USER);
      expect(storage.deleteFile).not.toHaveBeenCalled();
      expect(storage.deleteFolder).toHaveBeenCalledWith('avatars/user-1/');
    });
  });

  // -------------------------------------------------------------------------
  describe('uploadAvatar', () => {
    it('a failing delete of the old avatar does not block the new upload', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: USER, avatarUrl: 'avatars/user-1/old.jpg' });
      storage.deleteFile.mockRejectedValue(new Error('GCS 404'));
      const file = { originalname: 'me.png', buffer: Buffer.from('x'), mimetype: 'image/png' } as any;

      const res = await service.uploadAvatar(USER, file);

      expect(storage.uploadFile).toHaveBeenCalledWith(
        file.buffer,
        expect.stringMatching(/^avatars\/user-1\/\d+-me\.png$/),
        'image/png',
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER },
        data: { avatarUrl: 'avatars/user-1/new.png' },
      });
      expect(res).toEqual({
        message: 'Avatar uploaded successfully',
        avatarUrl: 'signed:avatars/user-1/new.png',
        profileImageUrl: 'signed:avatars/user-1/new.png',
      });
    });
  });
});
