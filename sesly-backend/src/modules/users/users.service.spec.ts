import { Test } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TTSProviderFactory } from '../tts-providers/tts-provider.factory';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createMockUser, createMockVoiceProfile } from '../../test-utils/mock-factories';
import { NotFoundException } from '@nestjs/common';
import { TTSProvider, VoiceDeletionRequestStatus, SubscriptionPlan, SubscriptionStatus } from '../../common/enums/prisma.enums';

const mockFirebaseAuth = {
  deleteUser: jest.fn(),
  getUserByEmail: jest.fn(),
};
jest.mock('firebase-admin', () => ({
  apps: [{}],
  auth: () => mockFirebaseAuth,
}));

describe('UsersService', () => {
  let service: UsersService;
  let prisma: MockPrismaService;
  let storageService: jest.Mocked<any>;
  let ttsProviderFactory: jest.Mocked<any>;
  let mockCloningProvider: jest.Mocked<any>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    
    storageService = {
      uploadFile: jest.fn().mockResolvedValue('https://storage.googleapis.com/sesly-bucket/avatars/new.jpg'),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      deleteFolder: jest.fn().mockResolvedValue(undefined),
      getReadUrl: jest.fn(async (value: string | null) => (value ? `signed:${value}` : null)),
    };

    mockFirebaseAuth.deleteUser.mockReset().mockResolvedValue(undefined);
    mockFirebaseAuth.getUserByEmail.mockReset().mockRejectedValue({ code: 'auth/user-not-found' });

    mockCloningProvider = {
      deleteVoiceClone: jest.fn().mockResolvedValue(undefined),
    };

    ttsProviderFactory = {
      getCloningProvider: jest.fn().mockReturnValue(mockCloningProvider),
    };

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storageService },
        { provide: TTSProviderFactory, useValue: ttsProviderFactory },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCurrentUser', () => {
    it('should return a UserResponseDto if user is found', async () => {
      const mockUser = createMockUser({ id: 'user-1' });
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getCurrentUser('user-1');
      expect(result.id).toBe('user-1');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        include: { subscription: true },
      });
    });

    it('should return an allow-listed shape without secrets, with profileImageUrl', async () => {
      const mockUser = {
        ...createMockUser({
          id: 'user-1',
          avatarUrl: 'https://storage.googleapis.com/sesly-bucket/avatars/user-1/a.jpg',
          passwordHash: 'hash',
          providerId: 'firebase-uid',
          emailVerificationToken: 'verify-token',
          passwordResetToken: 'reset-token',
        }),
        subscription: {
          plan: SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: null,
          stripeCustomerId: 'cus_123',
          stripeSubscriptionId: 'sub_123',
        },
      };
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result: any = await service.getCurrentUser('user-1');
      const json = JSON.stringify(result);

      for (const secret of ['hash', 'firebase-uid', 'verify-token', 'reset-token', 'cus_123', 'sub_123']) {
        expect(json).not.toContain(secret);
      }
      expect(result.passwordHash).toBeUndefined();
      expect(result.subscription).toBeUndefined();
      expect(result.subscriptionTier).toBe('PRO');
      expect(result.avatarUrl).toBe('signed:https://storage.googleapis.com/sesly-bucket/avatars/user-1/a.jpg');
      expect(result.profileImageUrl).toBe(result.avatarUrl);
    });

    it('should resolve an expired admin-granted plan to FREE', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...createMockUser({ id: 'user-1' }),
        subscription: {
          plan: SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date(Date.now() - 60_000),
        },
      });

      const result = await service.getCurrentUser('user-1');
      expect(result.subscriptionTier).toBe('FREE');
    });

    it('should throw NotFoundException if user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getCurrentUser('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateUser', () => {
    it('should successfully update user details without changing email', async () => {
      const mockUser = createMockUser({ id: 'user-1', firstName: 'NewName' });
      prisma.user.findUnique.mockResolvedValue(null); // For email check: no conflicting email
      prisma.user.update.mockResolvedValue(mockUser);

      const result = await service.updateUser('user-1', { firstName: 'NewName' });
      expect(result.firstName).toBe('NewName');
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('writes the name only, never the email (the address belongs to the Firebase account)', async () => {
      prisma.user.update.mockResolvedValue(createMockUser({ id: 'user-1', firstName: 'Ali' }));

      await service.updateUser('user-1', { firstName: 'Ali', email: 'new@example.com' } as any);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { firstName: 'Ali' },
        include: { subscription: true },
      });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('should throw NotFoundException if deleting user that does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deleteUser('invalid-id')).rejects.toThrow(NotFoundException);
    });

    it('should perform cleanups and delete user from database', async () => {
      const mockUser = createMockUser({
        id: 'user-1',
        email: 'user1@example.com',
        providerId: 'firebase-uid-1',
        avatarUrl: 'https://storage.googleapis.com/sesly-bucket/avatars/user-1/old.jpg',
      });
      const mockVoice1 = createMockVoiceProfile({
        id: 'voice-1',
        userId: 'user-1',
        provider: TTSProvider.CARTESIA,
        voiceId: 'cartesia-voice-123',
        sampleAudioUrl: 'voice-samples/user-1/voice-1.mp3',
        consentAudioUrl: 'https://storage.googleapis.com/sesly-bucket/voice-samples/user-1/voice-1/consent/c.wav',
      });
      const mockVoice2 = createMockVoiceProfile({
        id: 'voice-2',
        userId: 'user-1',
        provider: TTSProvider.GOOGLE,
        voiceId: 'google-voice-123',
        sampleAudioUrl: null,
        consentAudioUrl: null,
      });

      const userWithProfiles = {
        ...mockUser,
        voiceProfiles: [mockVoice1, mockVoice2],
        subscription: {
          id: 'sub-1',
          storePurchaseId: 'purchase-1',
        },
      };

      prisma.user.findUnique.mockResolvedValue(userWithProfiles);
      prisma.voiceDeletionRequest.create.mockResolvedValue({ id: 'req-1' } as any);
      prisma.audio.findMany.mockResolvedValue([{ id: 'audio-1' }, { id: 'audio-2' }]);
      prisma.user.delete.mockResolvedValue(mockUser);

      const result = await service.deleteUser('user-1');

      expect(result.message).toBe('Account deleted successfully');

      // Object keys are extracted WITHOUT the bucket name (bare keys pass through)
      expect(storageService.deleteFile).toHaveBeenCalledWith('voice-samples/user-1/voice-1.mp3');
      expect(storageService.deleteFile).toHaveBeenCalledWith('voice-samples/user-1/voice-1/consent/c.wav');
      expect(storageService.deleteFile).toHaveBeenCalledWith('avatars/user-1/old.jpg');
      expect(storageService.deleteFile).not.toHaveBeenCalledWith(expect.stringContaining('sesly-bucket'));

      // Generated audio lives at audio/<audioId>/, plus user-scoped prefixes
      expect(storageService.deleteFolder).toHaveBeenCalledWith('voice-samples/user-1/');
      expect(storageService.deleteFolder).toHaveBeenCalledWith('audio/audio-1/');
      expect(storageService.deleteFolder).toHaveBeenCalledWith('audio/audio-2/');
      expect(storageService.deleteFolder).toHaveBeenCalledWith('avatars/user-1/');
      expect(storageService.deleteFolder).not.toHaveBeenCalledWith('generated-audio/user-1/');

      // Firebase Auth account removed by stored uid
      expect(mockFirebaseAuth.deleteUser).toHaveBeenCalledWith('firebase-uid-1');

      // Verify Cartesia deletion logic
      expect(ttsProviderFactory.getCloningProvider).toHaveBeenCalledWith(TTSProvider.CARTESIA);
      expect(mockCloningProvider.deleteVoiceClone).toHaveBeenCalledWith('cartesia-voice-123');
      expect(prisma.voiceDeletionRequest.create).toHaveBeenCalledTimes(2);

      // Verify Cartesia deletion request completed successfully
      expect(prisma.voiceDeletionRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: expect.objectContaining({
          status: VoiceDeletionRequestStatus.COMPLETED,
          completedAt: expect.any(Date),
        }),
      });

      // A store subscription cannot be cancelled server side: only logged.

      // Verify database delete cascade triggered
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('should not try to delete third-party avatar URLs and should tolerate a missing Firebase user', async () => {
      const mockUser = createMockUser({
        id: 'user-1',
        email: 'user1@example.com',
        providerId: 'gone-uid',
        avatarUrl: 'https://lh3.googleusercontent.com/a/photo.jpg',
      });
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, voiceProfiles: [], subscription: null });
      prisma.audio.findMany.mockResolvedValue([]);
      prisma.user.delete.mockResolvedValue(mockUser);
      mockFirebaseAuth.deleteUser.mockRejectedValue({ code: 'auth/user-not-found' });

      const result = await service.deleteUser('user-1');

      expect(result.message).toBe('Account deleted successfully');
      expect(storageService.deleteFile).not.toHaveBeenCalled();
      expect(mockFirebaseAuth.getUserByEmail).toHaveBeenCalledWith('user1@example.com');
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });

    it('should handle Cartesia deletion failures gracefully, logging and marking request as FAILED', async () => {
      const mockUser = createMockUser({ id: 'user-1' });
      const mockVoice = createMockVoiceProfile({
        id: 'voice-1',
        userId: 'user-1',
        provider: TTSProvider.CARTESIA,
        voiceId: 'cartesia-voice-123',
        sampleAudioUrl: null,
        consentAudioUrl: null,
      });

      const userWithProfiles = {
        ...mockUser,
        voiceProfiles: [mockVoice],
        subscription: null,
      };

      prisma.user.findUnique.mockResolvedValue(userWithProfiles);
      prisma.voiceDeletionRequest.create.mockResolvedValue({ id: 'req-failed' } as any);
      prisma.audio.findMany.mockResolvedValue([]);
      mockCloningProvider.deleteVoiceClone.mockRejectedValue(new Error('API Rate Limit'));
      prisma.user.delete.mockResolvedValue(mockUser);

      await service.deleteUser('user-1');

      expect(prisma.voiceDeletionRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-failed' },
        data: expect.objectContaining({
          status: VoiceDeletionRequestStatus.FAILED,
          notes: 'API Rate Limit',
        }),
      });
    });
  });

  describe('deleteUser voice clones (kind-based)', () => {
    it('deletes each voice row first, uses its final state, and never deletes a Cartesia preset upstream', async () => {
      const mockUser = createMockUser({ id: 'user-1' });
      const training = createMockVoiceProfile({
        id: 'voice-1',
        userId: 'user-1',
        provider: TTSProvider.CARTESIA,
        kind: 'CLONE',
        voiceId: 'pending-1',
        sampleAudioUrl: null,
        consentAudioUrl: null,
      });
      const stockPreset = createMockVoiceProfile({
        id: 'voice-2',
        userId: 'user-1',
        provider: TTSProvider.CARTESIA,
        kind: 'PRESET',
        voiceId: 'cartesia-stock-voice',
        sampleAudioUrl: null,
        consentAudioUrl: null,
      });
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        voiceProfiles: [training, stockPreset],
        subscription: null,
      });
      // The clone finished training between the snapshot and the delete.
      prisma.voiceProfile.delete
        .mockResolvedValueOnce({ ...training, voiceId: 'fresh-clone', voiceCloningKey: 'fresh-clone' })
        .mockResolvedValueOnce(stockPreset);
      prisma.voiceDeletionRequest.create.mockResolvedValue({ id: 'req-1' } as any);
      prisma.audio.findMany.mockResolvedValue([{ id: 'audio-1' }]);
      prisma.user.delete.mockResolvedValue(mockUser);

      await service.deleteUser('user-1');

      expect(mockCloningProvider.deleteVoiceClone).toHaveBeenCalledTimes(1);
      expect(mockCloningProvider.deleteVoiceClone).toHaveBeenCalledWith('fresh-clone');
      const statuses = prisma.voiceDeletionRequest.create.mock.calls.map((c: any[]) => c[0].data.status);
      expect(statuses).toEqual([VoiceDeletionRequestStatus.IN_PROGRESS, VoiceDeletionRequestStatus.NO_OP]);
      // Audio ids were collected before the cascade removed the rows.
      expect(storageService.deleteFolder).toHaveBeenCalledWith('audio/audio-1/');
      expect(storageService.deleteFolder).toHaveBeenCalledWith('voice-samples/user-1/');
    });
  });

  describe('getStats', () => {
    it('should correctly sum duration and count completed models', async () => {
      prisma.storyNarration.count.mockResolvedValue(5);
      prisma.voiceProfile.count.mockResolvedValue(2);
      prisma.audio.aggregate.mockResolvedValue({
        _sum: { duration: 7200 }, // 7200 seconds = 2.0 hours
      } as any);

      const result = await service.getStats('user-1');

      expect(result).toEqual({
        storiesCompleted: 5,
        hoursListened: 2.0,
        voicesTrained: 2,
      });

      expect(prisma.storyNarration.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', completedAt: { not: null } },
      });
      expect(prisma.voiceProfile.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: 'READY' },
      });
      expect(prisma.audio.aggregate).toHaveBeenCalledWith({
        where: {
          status: 'READY',
          narrations: { some: { userId: 'user-1' } },
        },
        _sum: { duration: true },
      });
    });
  });

  describe('getUserProfile', () => {
    it('should throw NotFoundException if profile does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserProfile('invalid-id')).rejects.toThrow(NotFoundException);
    });

    it('should retrieve full user profile stats and usage logs', async () => {
      const mockUser = createMockUser({ id: 'user-1' });
      const fullProfile = {
        ...mockUser,
        subscription: { id: 'sub-1', plan: SubscriptionPlan.PRO },
        voiceProfiles: [{ id: 'voice-1', name: 'My Voice', status: 'READY' }],
        usageLimits: [{ storiesGenerated: 3, textToSpeechCount: 15 }],
      };

      prisma.user.findUnique.mockResolvedValue(fullProfile);

      const result = await service.getUserProfile('user-1');

      expect(result.user.id).toBe('user-1');
      expect(result.subscription?.plan).toBe(SubscriptionPlan.PRO);
      expect(result.voiceProfiles[0].name).toBe('My Voice');
      expect(result.usage.storiesGenerated).toBe(3);
    });
  });

  describe('uploadAvatar', () => {
    it('should throw NotFoundException if user to upload avatar for does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const mockFile = {
        buffer: Buffer.from('image'),
        originalname: 'avatar.jpg',
        mimetype: 'image/jpeg',
      } as any;

      await expect(service.uploadAvatar('invalid-id', mockFile)).rejects.toThrow(NotFoundException);
    });

    it('should successfully upload new avatar and delete old avatar if exists', async () => {
      const mockUser = createMockUser({
        id: 'user-1',
        avatarUrl: 'https://storage.googleapis.com/sesly-bucket/avatars/old-avatar.jpg',
      });

      prisma.user.findUnique.mockResolvedValue(mockUser);
      storageService.uploadFile.mockResolvedValueOnce('https://storage.googleapis.com/sesly-bucket/avatars/new-avatar.jpg');
      prisma.user.update.mockResolvedValue({
        ...mockUser,
        avatarUrl: 'https://storage.googleapis.com/sesly-bucket/avatars/new-avatar.jpg',
      });

      const mockFile = {
        buffer: Buffer.from('new-image'),
        originalname: 'new-avatar.jpg',
        mimetype: 'image/jpeg',
      } as any;

      const result = await service.uploadAvatar('user-1', mockFile);

      // The response carries a readable (presigned) URL, same as GET /users/me
      expect(result.avatarUrl).toBe('signed:https://storage.googleapis.com/sesly-bucket/avatars/new-avatar.jpg');
      expect(result.profileImageUrl).toBe(result.avatarUrl);
      expect(storageService.deleteFile).toHaveBeenCalledWith('avatars/old-avatar.jpg');
      expect(storageService.uploadFile).toHaveBeenCalledWith(
        mockFile.buffer,
        expect.stringContaining('avatars/user-1/'),
        'image/jpeg'
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { avatarUrl: 'https://storage.googleapis.com/sesly-bucket/avatars/new-avatar.jpg' },
      });
    });
  });
});
