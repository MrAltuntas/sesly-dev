import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ANDROID_CHANNEL_ID, NotificationsService, pushPreferenceFor } from './notifications.service';
import { RegisterDeviceDto, UnregisterDeviceDto } from './dto/register-device.dto';
import { UserPreferencesService } from '../user-preferences/user-preferences.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createSettingsStub } from '../../test-utils/settings-stub';

const mockApps: unknown[] = [{}];
const mockMessaging = {
  sendEachForMulticast: jest.fn(),
  sendEach: jest.fn(),
};
jest.mock('firebase-admin', () => ({
  get apps() {
    return mockApps;
  },
  messaging: () => mockMessaging,
}));

/** BatchResponse where every token in the request succeeded. */
const allOk = async (msg: { tokens?: string[] } | unknown[]) => {
  const n = Array.isArray(msg) ? msg.length : (msg.tokens ?? []).length;
  return {
    successCount: n,
    failureCount: 0,
    responses: Array.from({ length: n }, (_, i) => ({ success: true, messageId: `m${i}` })),
  };
};

const fail = (code: string) => ({ success: false, error: { code, message: code } });

describe('NotificationsService', () => {
  let prisma: MockPrismaService;
  let gateway: { sendToUser: jest.Mock };
  let service: NotificationsService;

  beforeEach(() => {
    mockApps.length = 0;
    mockApps.push({});
    mockMessaging.sendEachForMulticast.mockReset().mockImplementation(allOk);
    mockMessaging.sendEach.mockReset().mockImplementation(allOk);

    prisma = createMockPrismaService();
    gateway = { sendToUser: jest.fn() };
    prisma.notification.create.mockImplementation(async ({ data }: any) => ({
      id: 'n1',
      createdAt: new Date(),
      ...data,
    }));
    prisma.userDevice.findMany.mockResolvedValue([]);
    prisma.userDevice.deleteMany.mockResolvedValue({ count: 0 });
    prisma.userPreferences.findUnique.mockResolvedValue(null); // no row = defaults
    service = new NotificationsService(
      prisma as any,
      gateway as any,
      new UserPreferencesService(prisma as any, createSettingsStub() as any),
    );
  });

  const persisted = () => prisma.notification.create.mock.calls[0][0].data;
  const devices = (...tokens: string[]) =>
    prisma.userDevice.findMany.mockResolvedValue(tokens.map((deviceToken) => ({ deviceToken })));

  describe('Turkish domain notifications', () => {
    it('voice ready: socket carries voiceProfileId, Turkish copy, data.voiceProfileId', async () => {
      await service.notifyVoiceReady('u', 'Anne', 'vp1');

      expect(gateway.sendToUser).toHaveBeenCalledWith('u', 'voice_status', {
        voiceProfileId: 'vp1',
        status: 'READY',
      });
      expect(persisted()).toMatchObject({
        type: 'VOICE_READY',
        title: 'Ses profilin hazır',
        body: '"Anne" sesi artık kullanılabilir.',
        data: { type: 'VOICE_READY', voiceProfileId: 'vp1' },
      });
    });

    it('voice failed: socket {voiceProfileId,status,errorMessage}; body never has the raw reason', async () => {
      await service.notifyVoiceFailed('u', 'Anne', 'vp1', 'Kayıt çok kısa.');

      expect(gateway.sendToUser).toHaveBeenCalledWith('u', 'voice_status', {
        voiceProfileId: 'vp1',
        status: 'FAILED',
        errorMessage: 'Kayıt çok kısa.',
      });
      expect(persisted()).toMatchObject({
        title: 'Ses hazırlanamadı',
        body: '"Anne" sesi hazırlanırken bir sorun oluştu. Lütfen tekrar dene.',
        data: { type: 'VOICE_FAILED', voiceProfileId: 'vp1' },
      });
    });

    it('narration ready/failed carry narrationId + storyId', async () => {
      await service.notifyNarrationReady('u', 'Keloğlan', 'n1', 's1');
      expect(persisted()).toMatchObject({
        title: 'Masalın hazır',
        body: '"Keloğlan" masalını şimdi dinleyebilirsin.',
        data: { type: 'NARRATION_READY', narrationId: 'n1', storyId: 's1' },
      });

      prisma.notification.create.mockClear();
      await service.notifyNarrationFailed('u', 'Keloğlan', 'n1', 's1', 'x');
      expect(persisted()).toMatchObject({
        title: 'Masal hazırlanamadı',
        body: '"Keloğlan" masalı hazırlanırken bir sorun oluştu. Lütfen tekrar dene.',
        data: { type: 'NARRATION_FAILED', narrationId: 'n1', storyId: 's1' },
      });
    });

    it('a user with uiLanguage en gets the English copy on the row, the socket and the push', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue({ uiLanguage: 'en' });
      devices('tok-1');

      await service.notifyNarrationReady('u', 'The Snow Queen', 'n1', 's1');

      expect(persisted()).toMatchObject({
        title: 'Your story is ready',
        body: 'You can listen to "The Snow Queen" now.',
      });
      expect(gateway.sendToUser).toHaveBeenCalledWith(
        'u',
        'notification',
        expect.objectContaining({ title: 'Your story is ready', body: 'You can listen to "The Snow Queen" now.' }),
      );
      const pushed = mockMessaging.sendEachForMulticast.mock.calls[0][0];
      expect(pushed.notification).toEqual({
        title: 'Your story is ready',
        body: 'You can listen to "The Snow Queen" now.',
      });

      prisma.notification.create.mockClear();
      await service.notifyVoiceReady('u', 'Mom', 'vp1');
      expect(persisted()).toMatchObject({ title: 'Your voice is ready', body: '"Mom" is ready to use.' });

      prisma.notification.create.mockClear();
      await service.notifyVoiceFailed('u', 'Mom', 'vp1', 'x');
      expect(persisted()).toMatchObject({
        title: 'Your voice could not be prepared',
        body: 'Something went wrong while preparing "Mom". Please try again.',
      });

      prisma.notification.create.mockClear();
      await service.notifyNarrationFailed('u', '', 'n1', 's1', 'x');
      expect(persisted()).toMatchObject({
        title: 'Your story could not be prepared',
        body: 'Something went wrong while preparing "Story". Please try again.',
      });
    });

    it('a story without a title is "Masal" in Turkish', async () => {
      await service.notifyNarrationReady('u', '', 'n1', 's1');
      expect(persisted()).toMatchObject({ body: '"Masal" masalını şimdi dinleyebilirsin.' });
    });

    it('never throws into the pipeline, even when the row cannot be persisted', async () => {
      prisma.notification.create.mockRejectedValue(new Error('db down'));

      await expect(service.notifyNarrationReady('u', 'Keloğlan', 'n1', 's1')).resolves.toBeUndefined();
      await expect(service.notifyVoiceFailed('u', 'Anne', 'vp1', 'x')).resolves.toBeUndefined();
      // socket status events still went out
      expect(gateway.sendToUser).toHaveBeenCalledWith('u', 'narration_status', expect.anything());
    });
  });

  describe('FCM send path', () => {
    it('multicasts to all active tokens with the contract payload', async () => {
      devices('tokA', 'tokB');

      await service.notifyNarrationReady('u', 'Keloğlan', 'nar1', 's1');

      expect(prisma.userDevice.findMany).toHaveBeenCalledWith({
        where: { userId: 'u', isActive: true },
        select: { deviceToken: true },
      });
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledTimes(1);
      expect(mockMessaging.sendEachForMulticast.mock.calls[0][0]).toEqual({
        tokens: ['tokA', 'tokB'],
        notification: { title: 'Masalın hazır', body: '"Keloğlan" masalını şimdi dinleyebilirsin.' },
        data: { type: 'NARRATION_READY', notificationId: 'n1', narrationId: 'nar1', storyId: 's1' },
        android: { priority: 'high', notification: { channelId: 'sesly-default' } },
        apns: { payload: { aps: { sound: 'default' } } },
      });
      expect(ANDROID_CHANNEL_ID).toBe('sesly-default');
    });

    it('keeps the row + socket and reports pushSent=true on delivery', async () => {
      devices('tokA');

      const res = await service.sendNotification('u', {
        type: 'VOICE_READY',
        title: 't',
        body: 'b',
        data: { voiceProfileId: 'vp1' },
      });

      expect(res).toEqual({ notificationId: 'n1', pushSent: true });
      expect(persisted()).toMatchObject({ userId: 'u', type: 'VOICE_READY', data: { type: 'VOICE_READY', voiceProfileId: 'vp1' } });
      expect(gateway.sendToUser).toHaveBeenCalledWith(
        'u',
        'notification',
        expect.objectContaining({ id: 'n1', type: 'VOICE_READY', read: false }),
      );
    });

    it('FCM data is strings only: drops null/undefined/objects and reserved keys', async () => {
      devices('tokA');

      await service.sendNotification('u', {
        type: 'INFO',
        title: 't',
        body: 'b',
        data: { storyId: 's1', count: 3, flag: true, gone: undefined, nil: null, from: 'x', type: 'SPOOF', notificationId: 'SPOOF' } as any,
      });

      const data = mockMessaging.sendEachForMulticast.mock.calls[0][0].data;
      expect(data).toEqual({ type: 'INFO', notificationId: 'n1', storyId: 's1', count: '3', flag: 'true' });
      expect(Object.values(data).every((v) => typeof v === 'string')).toBe(true);
    });

    it('no active devices: no FCM call, pushSent=false', async () => {
      const res = await service.sendNotification('u', { type: 'VOICE_READY', title: 't', body: 'b' });

      expect(res.pushSent).toBe(false);
      expect(mockMessaging.sendEachForMulticast).not.toHaveBeenCalled();
    });

    it('Firebase not initialized: row + socket only, pushSent=false', async () => {
      mockApps.length = 0;
      devices('tokA');

      const res = await service.sendNotification('u', { type: 'VOICE_READY', title: 't', body: 'b' });

      expect(res).toEqual({ notificationId: 'n1', pushSent: false });
      expect(mockMessaging.sendEachForMulticast).not.toHaveBeenCalled();
      expect(gateway.sendToUser).toHaveBeenCalled();
    });

    it('FCM throwing never reaches the caller', async () => {
      devices('tokA');
      mockMessaging.sendEachForMulticast.mockRejectedValue(new Error('app/network-error'));

      await expect(
        service.sendNotification('u', { type: 'VOICE_READY', title: 't', body: 'b' }),
      ).resolves.toEqual({ notificationId: 'n1', pushSent: false });
      await expect(service.notifyVoiceReady('u', 'Anne', 'vp1')).resolves.toBeUndefined();
    });
  });

  describe('dead token cleanup', () => {
    it('removes not-registered + invalid tokens, keeps transient failures', async () => {
      devices('ok', 'gone', 'bad', 'flaky');
      mockMessaging.sendEachForMulticast.mockResolvedValue({
        successCount: 1,
        failureCount: 3,
        responses: [
          { success: true, messageId: 'm' },
          fail('messaging/registration-token-not-registered'),
          fail('messaging/invalid-registration-token'),
          fail('messaging/internal-error'),
        ],
      });

      const res = await service.sendNotification('u', { type: 'VOICE_READY', title: 't', body: 'b' });

      expect(res.pushSent).toBe(true);
      expect(prisma.userDevice.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.userDevice.deleteMany).toHaveBeenCalledWith({
        where: { deviceToken: { in: ['gone', 'bad'] } },
      });
    });

    it('all tokens dead: pushSent=false, all removed', async () => {
      devices('gone');
      mockMessaging.sendEachForMulticast.mockResolvedValue({
        successCount: 0,
        failureCount: 1,
        responses: [fail('messaging/registration-token-not-registered')],
      });

      const res = await service.sendNotification('u', { type: 'NARRATION_READY', title: 't', body: 'b' });

      expect(res.pushSent).toBe(false);
      expect(prisma.userDevice.deleteMany).toHaveBeenCalledWith({
        where: { deviceToken: { in: ['gone'] } },
      });
    });

    it('cleanup failure is swallowed', async () => {
      devices('gone');
      mockMessaging.sendEachForMulticast.mockResolvedValue({
        successCount: 0,
        failureCount: 1,
        responses: [fail('messaging/invalid-registration-token')],
      });
      prisma.userDevice.deleteMany.mockRejectedValue(new Error('db down'));

      await expect(
        service.sendNotification('u', { type: 'VOICE_READY', title: 't', body: 'b' }),
      ).resolves.toEqual({ notificationId: 'n1', pushSent: false });
    });
  });

  describe('preference filtering', () => {
    it('maps types to the Settings toggles', () => {
      expect(pushPreferenceFor('VOICE_READY')).toBe('voiceReadyNotifications');
      expect(pushPreferenceFor('VOICE_FAILED')).toBe('voiceReadyNotifications');
      expect(pushPreferenceFor('NARRATION_READY')).toBe('narrationReadyNotifications');
      expect(pushPreferenceFor('NARRATION_FAILED')).toBe('narrationReadyNotifications');
      expect(pushPreferenceFor('BROADCAST')).toBe('promoNotifications');
      expect(pushPreferenceFor('INFO')).toBeNull();
    });

    it('narration toggle off: no push, but the in-app row + socket remain', async () => {
      devices('tokA');
      prisma.userPreferences.findUnique.mockResolvedValue({
        voiceReadyNotifications: true,
        narrationReadyNotifications: false,
        promoNotifications: false,
      });

      await service.notifyNarrationReady('u', 'Keloğlan', 'nar1', 's1');
      expect(mockMessaging.sendEachForMulticast).not.toHaveBeenCalled();
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(gateway.sendToUser).toHaveBeenCalledWith('u', 'notification', expect.anything());

      // the voice toggle is independent
      await service.notifyVoiceFailed('u', 'Anne', 'vp1', 'x');
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledTimes(1);
    });

    it('voice toggle off blocks VOICE_READY and VOICE_FAILED', async () => {
      devices('tokA');
      prisma.userPreferences.findUnique.mockResolvedValue({
        voiceReadyNotifications: false,
        narrationReadyNotifications: true,
        promoNotifications: true,
      });

      await service.notifyVoiceReady('u', 'Anne', 'vp1');
      await service.notifyVoiceFailed('u', 'Anne', 'vp1', 'x');

      expect(mockMessaging.sendEachForMulticast).not.toHaveBeenCalled();
      expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    });

    it('missing preferences row uses defaults: voice/narration on, promo off', async () => {
      devices('tokA');

      await service.notifyVoiceReady('u', 'Anne', 'vp1');
      await service.notifyNarrationReady('u', 'Keloğlan', 'nar1', 's1');
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledTimes(2);

      const res = await service.sendNotification('u', { type: 'BROADCAST', title: 't', body: 'b' });
      expect(res.pushSent).toBe(false);
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledTimes(2);
      // the lookup never creates a row
      expect(prisma.userPreferences.create).not.toHaveBeenCalled();
    });

    it('ungated (system) types push regardless of toggles', async () => {
      devices('tokA');
      prisma.userPreferences.findUnique.mockResolvedValue({
        voiceReadyNotifications: false,
        narrationReadyNotifications: false,
        promoNotifications: false,
      });

      const res = await service.sendNotification('u', { type: 'INFO', title: 't', body: 'b' });
      expect(res.pushSent).toBe(true);
    });
  });

  describe('broadcast', () => {
    beforeEach(() => {
      let i = 0;
      prisma.notification.createManyAndReturn.mockImplementation(async ({ data }: any) =>
        data.map((d: any) => ({ id: `bn${++i}`, userId: d.userId, createdAt: new Date() })),
      );
    });

    it('in-app row for every target; push only to promo opt-ins, per-user notificationId', async () => {
      prisma.userDevice.findMany.mockResolvedValue([
        { userId: 'u2', deviceToken: 'tok2' },
        { userId: 'u2', deviceToken: 'tok2b' },
      ]);

      const res = await service.sendBroadcast(['u1', 'u2', 'u3', 'u2'], {
        title: 'Yeni masallar',
        body: 'Göz at',
      });

      expect(res).toEqual({ count: 3, pushSent: true, pushDelivered: 1 });

      const rows = prisma.notification.createManyAndReturn.mock.calls[0][0].data;
      expect(rows.map((r: any) => r.userId)).toEqual(['u1', 'u2', 'u3']);
      expect(rows[0]).toMatchObject({ type: 'BROADCAST', title: 'Yeni masallar', body: 'Göz at', data: { type: 'BROADCAST' } });
      expect(gateway.sendToUser).toHaveBeenCalledTimes(3);

      const where = prisma.userDevice.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        isActive: true,
        userId: { in: ['u1', 'u2', 'u3'] },
        user: { preferences: { is: { promoNotifications: true } } },
      });

      const messages = mockMessaging.sendEach.mock.calls[0][0];
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({
        token: 'tok2',
        notification: { title: 'Yeni masallar', body: 'Göz at' },
        data: { type: 'BROADCAST', notificationId: 'bn2' },
        android: { priority: 'high', notification: { channelId: 'sesly-default' } },
        apns: { payload: { aps: { sound: 'default' } } },
      });
    });

    it('nobody opted in: in-app only, pushSent=false', async () => {
      prisma.userDevice.findMany.mockResolvedValue([]);

      const res = await service.sendBroadcast(['u1', 'u2'], { title: 't', body: 'b' });

      expect(res).toEqual({ count: 2, pushSent: false, pushDelivered: 0 });
      expect(mockMessaging.sendEach).not.toHaveBeenCalled();
      expect(prisma.notification.createManyAndReturn).toHaveBeenCalledTimes(1);
    });

    it('removes dead tokens and survives a failing FCM batch', async () => {
      prisma.userDevice.findMany.mockResolvedValue([
        { userId: 'u1', deviceToken: 'dead' },
        { userId: 'u2', deviceToken: 'live' },
      ]);
      mockMessaging.sendEach.mockResolvedValue({
        successCount: 1,
        failureCount: 1,
        responses: [fail('messaging/registration-token-not-registered'), { success: true, messageId: 'm' }],
      });

      const res = await service.sendBroadcast(['u1', 'u2'], { title: 't', body: 'b' });
      expect(res).toEqual({ count: 2, pushSent: true, pushDelivered: 1 });
      expect(prisma.userDevice.deleteMany).toHaveBeenCalledWith({ where: { deviceToken: { in: ['dead'] } } });

      mockMessaging.sendEach.mockRejectedValue(new Error('quota'));
      await expect(service.sendBroadcast(['u1'], { title: 't', body: 'b' })).resolves.toEqual({
        count: 1,
        pushSent: false,
        pushDelivered: 0,
      });
    });

    it('empty segment: nothing written, nothing pushed', async () => {
      const res = await service.sendBroadcast([], { title: 't', body: 'b' });

      expect(res).toEqual({ count: 0, pushSent: false, pushDelivered: 0 });
      expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
      expect(prisma.userDevice.findMany).not.toHaveBeenCalled();
    });
  });

  describe('device registration', () => {
    beforeEach(() => {
      prisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
      prisma.userDevice.upsert.mockImplementation(async (args: any) => ({
        id: 'd1',
        platform: args.create.platform,
        isActive: true,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      }));
    });

    it('register: idempotent upsert, moves the token off other accounts', async () => {
      const res = await service.registerDevice('u', { token: 'tokA', platform: 'ios' });

      expect(prisma.userDevice.deleteMany).toHaveBeenCalledWith({
        where: { deviceToken: 'tokA', userId: { not: 'u' } },
      });
      expect(prisma.userDevice.upsert).toHaveBeenCalledWith({
        where: { deviceToken: 'tokA' },
        create: { userId: 'u', deviceToken: 'tokA', platform: 'IOS', isActive: true },
        update: { platform: 'IOS', isActive: true },
      });
      expect(res).toEqual({
        message: 'Device registered',
        device: {
          id: 'd1',
          platform: 'ios',
          isActive: true,
          registeredAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-02'),
        },
      });
    });

    it('unregister: removes only the caller row, unknown token is fine', async () => {
      prisma.userDevice.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.unregisterDevice('u', { token: 'nope' })).resolves.toEqual({
        message: 'Device unregistered',
        removed: 0,
      });
      expect(prisma.userDevice.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u', deviceToken: 'nope' },
      });
    });

    it('DTO: {token, platform ios|android}, platform case-insensitive, old shape rejected', async () => {
      const check = async (cls: any, body: object) =>
        validate(plainToInstance(cls, body) as object, { whitelist: true, forbidNonWhitelisted: true });

      const ok = plainToInstance(RegisterDeviceDto, { token: ' tokA ', platform: 'IOS' });
      expect(ok).toMatchObject({ token: 'tokA', platform: 'ios' });
      expect(await validate(ok)).toHaveLength(0);

      expect(await check(RegisterDeviceDto, { token: 'x', platform: 'web' })).not.toHaveLength(0);
      expect(await check(RegisterDeviceDto, { token: '', platform: 'android' })).not.toHaveLength(0);
      expect(await check(RegisterDeviceDto, { deviceToken: 'x', platform: 'ANDROID' })).not.toHaveLength(0);
      expect(await check(UnregisterDeviceDto, { token: 'x' })).toHaveLength(0);
      expect(await check(UnregisterDeviceDto, {})).not.toHaveLength(0);
    });
  });
});
