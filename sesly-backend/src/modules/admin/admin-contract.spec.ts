import { AdminService, DEFAULT_REJECT_REASON } from './admin.service';
import { AdminAnalyticsService } from './services/admin-analytics.service';
import { AdminStorageService } from './services/admin-storage.service';
import { AudioService } from '../audio/audio.service';
import { BroadcastSegment } from './dto/broadcast.dto';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';

describe('Admin contract', () => {
  let prisma: MockPrismaService;
  let storage: any;
  let notifications: any;

  beforeEach(() => {
    prisma = createMockPrismaService();
    storage = {
      getReadUrl: jest.fn(async (v: string | null) => (v ? `signed:${v}` : null)),
      deleteFile: jest.fn(),
      fileExists: jest.fn().mockResolvedValue(true),
      listAllFilesWithMetadata: jest.fn(),
    };
    notifications = {
      notifyVoiceFailed: jest.fn(),
      sendBroadcast: jest.fn(),
    };
  });

  describe('moderation (A2)', () => {
    const service = () => new AdminService(prisma as any, notifications, {} as any, storage);

    it('lists voice profiles with a safe user subset and presigned sampleUrl', async () => {
      prisma.voiceProfile.findMany.mockResolvedValue([
        {
          id: 'vp1',
          name: 'Anne',
          provider: 'CARTESIA',
          status: 'FAILED',
          errorReason: 'Kayıt çok kısa.',
          sampleAudioUrl: 'voice-samples/u/vp1.mp3',
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { id: 'u', email: 'a@b.c', firstName: 'A', lastName: 'B' },
        },
      ]);
      prisma.voiceProfile.count.mockResolvedValue(1);

      const page = await service().listVoiceProfilesForModeration(1, 20, 'FAILED');

      const args = prisma.voiceProfile.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ status: 'FAILED' });
      expect(args.orderBy).toEqual({ updatedAt: 'desc' });
      expect(args.select.user).toEqual({
        select: { id: true, email: true, firstName: true, lastName: true },
      });
      expect(args.include).toBeUndefined();
      expect(page).toMatchObject({ total: 1, page: 1, limit: 20, totalPages: 1 });
      expect(page.data[0]).toMatchObject({
        errorMessage: 'Kayıt çok kısa.',
        sampleUrl: 'signed:voice-samples/u/vp1.mp3',
      });
    });

    it('reject marks FAILED with the reason and sends the VOICE_FAILED notification', async () => {
      prisma.voiceProfile.findUnique.mockResolvedValue({ id: 'vp1', userId: 'u', name: 'Anne' });
      prisma.voiceProfile.update.mockImplementation(async ({ data }: any) => ({
        id: 'vp1',
        name: 'Anne',
        provider: 'CARTESIA',
        status: data.status,
        errorReason: data.errorReason,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await service().rejectVoiceProfile('vp1');

      expect(prisma.voiceProfile.update.mock.calls[0][0].data).toEqual({
        status: 'FAILED',
        errorReason: DEFAULT_REJECT_REASON,
      });
      expect(notifications.notifyVoiceFailed).toHaveBeenCalledWith('u', 'Anne', 'vp1', DEFAULT_REJECT_REASON);
      expect(result.errorMessage).toBe(DEFAULT_REJECT_REASON);
    });
  });

  describe('broadcast (A9)', () => {
    it('targets the whole segment (in-app for all) and returns the push outcome', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
      notifications.sendBroadcast.mockResolvedValue({ count: 2, pushSent: true, pushDelivered: 1 });
      const service = new AdminService(prisma as any, notifications, {} as any, storage);

      const result = await service.broadcast({
        title: 'Yeni masallar',
        body: 'Göz at',
        segment: BroadcastSegment.ALL,
      });

      expect(result).toEqual({ count: 2, pushSent: true, pushDelivered: 1 });
      expect(notifications.sendBroadcast).toHaveBeenCalledWith(['u1', 'u2'], {
        title: 'Yeni masallar',
        body: 'Göz at',
      });
      // Promo consent gates the push inside NotificationsService, not the audience.
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).not.toContain('promoNotifications');
    });
  });

  describe('analytics (A4, A5)', () => {
    it('system subscriptions: paid-only revenue rounded, currency TRY', async () => {
      const count = prisma.subscription.count as jest.Mock;
      count.mockResolvedValue(3);
      (prisma.subscription.findMany as jest.Mock).mockResolvedValue([
        { plan: 'PRO' },
        { plan: 'PRO' },
        { plan: 'CREATOR' },
      ]);
      (prisma.user.count as jest.Mock).mockResolvedValue(10);
      (prisma.story.count as jest.Mock).mockResolvedValue(4);
      (prisma.voiceProfile.count as jest.Mock).mockResolvedValue(2);
      (prisma.audio.count as jest.Mock).mockResolvedValue(8);
      (prisma.voiceProfile.groupBy as jest.Mock).mockResolvedValue([]);
      (prisma.subscription.groupBy as jest.Mock).mockResolvedValue([]);

      const stats = await new AdminAnalyticsService(prisma as any).getSystemStats();

      expect(stats.subscriptions.estimatedMonthlyRevenue).toBe(399.98) // 2 x 199.99 (PRO); CREATOR is admin-grant only, no price;
      expect(stats.subscriptions.currency).toBe('TRY');
      expect(stats.subscriptions).toHaveProperty('paid');
      expect(stats.audio.successRate).toMatch(/%$/);
      const totalWhere = count.mock.calls.find((c) => c[0]?.where?.plan)[0].where;
      expect(totalWhere).toMatchObject({ status: 'ACTIVE', plan: { not: 'FREE' } });
    });

    it('usage: computed from this month narrations, premium/standard split', async () => {
      (prisma.storyNarration.findMany as jest.Mock).mockResolvedValue([
        { userId: 'a', voiceProfile: { provider: 'CARTESIA', voiceId: 'x', voiceCloningKey: 'k' } },
        { userId: 'a', voiceProfile: { provider: 'GOOGLE', voiceId: 'tr-TR-Wavenet-A', voiceCloningKey: null } },
        { userId: 'b', voiceProfile: { provider: 'GOOGLE', kind: 'PRESET', voiceId: 'tr-TR-Chirp3-HD-Kore', voiceCloningKey: null } },
      ]);

      const usage = await new AdminAnalyticsService(prisma as any).getUsageStats();

      expect(usage).toMatchObject({
        totalStoriesGenerated: 3,
        activeUsers: 2,
        averageStoriesPerUser: 1.5,
        premiumNarrations: 1,
        standardNarrations: 2,
      });
      expect(usage).not.toHaveProperty('totalTTSCount');
      expect(usage).not.toHaveProperty('averageTTSPerUser');
      const where = (prisma.storyNarration.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.status).toEqual({ not: 'FAILED' });
    });
  });

  describe('storage (A8)', () => {
    it('treats avatars + collection covers as referenced and skips voice-previews/', async () => {
      storage.listAllFilesWithMetadata.mockResolvedValue([
        { name: 'avatars/u/1-me.jpg', sizeBytes: 1, updatedAt: '' },
        { name: 'stories/cover/c.png', sizeBytes: 1, updatedAt: '' },
        { name: 'voice-previews/GOOGLE/tr-TR/x.mp3', sizeBytes: 1, updatedAt: '' },
        { name: 'audio/a1/segments/0.mp3', sizeBytes: 1, updatedAt: '' },
      ]);
      (prisma.audio.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.audioSegment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.voiceProfile.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.story.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.user.findMany as jest.Mock).mockResolvedValue([
        { avatarUrl: 'https://storage.googleapis.com/bucket/avatars/u/1-me.jpg' },
      ]);
      (prisma.collection.findMany as jest.Mock).mockResolvedValue([
        { coverImageUrl: 'https://storage.googleapis.com/bucket/stories/cover/c.png' },
      ]);

      const svc = new AdminStorageService(prisma as any, storage);
      const orphans = await svc.listOrphans(1, 20);

      expect(orphans.data.map((o) => o.key)).toEqual(['audio/a1/segments/0.mp3']);

      const stats = await svc.getStats();
      expect(stats.byPrefix['avatars/'].count).toBe(1);
      expect(stats.byPrefix['stories/cover/'].count).toBe(1);
      expect(stats.byType.audio.count).toBe(1);
      expect(stats.byType.image.count).toBe(2);
    });
  });

  describe('audio (A3)', () => {
    const audioService = () =>
      new AudioService(
        prisma as any,
        storage,
        notifications,
        { sendToUser: jest.fn() } as any,
        { add: jest.fn() } as any,
        {} as any,
        {} as any,
      );

    it('admin delete flips linked narrations to FAILED instead of leaving them READY', async () => {
      (prisma.audio.findUnique as jest.Mock).mockResolvedValue({ id: 'a1', audioUrl: null, segments: [] });
      (prisma.storyNarration.findMany as jest.Mock).mockResolvedValue([
        { id: 'n1', userId: 'u1', storyId: 's1' },
      ]);
      (prisma.storyNarration.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await audioService().adminDeleteAudio('a1');

      expect(prisma.storyNarration.updateMany).toHaveBeenCalledWith({
        where: { audioId: 'a1', id: { in: ['n1'] } },
        data: expect.objectContaining({ status: 'FAILED' }),
      });
      expect(prisma.audio.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
    });

    it('admin list: user resolved, url presigned only when READY', async () => {
      (prisma.audio.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'a1', userId: 'u1', title: 't', status: 'READY', duration: 10,
          totalSegments: 1, readySegments: 1, audioUrl: 'audio/a1/full.mp3',
          createdAt: new Date(), voiceProfile: { id: 'v', name: 'Anne' },
        },
        {
          id: 'a2', userId: 'u2', title: 't', status: 'GENERATING', duration: null,
          totalSegments: 2, readySegments: 1, audioUrl: null,
          createdAt: new Date(), voiceProfile: { id: 'v', name: 'Anne' },
        },
      ]);
      (prisma.audio.count as jest.Mock).mockResolvedValue(2);
      (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', email: 'a@b.c' }]);

      const page = await audioService().adminListAudio({ page: 1, limit: 20 });

      expect(page.data[0]).toMatchObject({
        user: { id: 'u1', email: 'a@b.c' },
        voiceProfile: { id: 'v', name: 'Anne' },
        url: 'signed:audio/a1/full.mp3',
      });
      expect(page.data[1]).toMatchObject({ user: null, url: null, progress: 50 });
    });
  });
});
