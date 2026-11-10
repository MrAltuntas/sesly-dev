import {
  NOTIFICATION_TOGGLE_DEFAULTS,
  UserPreferencesService,
  notificationToggleOnWhere,
} from './user-preferences.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createSettingsStub } from '../../test-utils/settings-stub';

describe('UserPreferencesService notification toggles', () => {
  let prisma: MockPrismaService;
  let service: UserPreferencesService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new UserPreferencesService(prisma as any, createSettingsStub() as any);
  });

  it('defaults match what the mobile Settings screen shows (on, on, off)', () => {
    expect(NOTIFICATION_TOGGLE_DEFAULTS).toEqual({
      voiceReadyNotifications: true,
      narrationReadyNotifications: true,
      promoNotifications: false,
    });
  });

  it('missing row resolves to defaults without creating one', async () => {
    prisma.userPreferences.findUnique.mockResolvedValue(null);

    await expect(service.getNotificationToggles('u')).resolves.toEqual(NOTIFICATION_TOGGLE_DEFAULTS);
    expect(prisma.userPreferences.create).not.toHaveBeenCalled();
    expect(prisma.userPreferences.upsert).not.toHaveBeenCalled();
  });

  it('stored values win over defaults', async () => {
    prisma.userPreferences.findUnique.mockResolvedValue({
      voiceReadyNotifications: false,
      narrationReadyNotifications: true,
      promoNotifications: true,
    });

    await expect(service.getNotificationToggles('u')).resolves.toEqual({
      voiceReadyNotifications: false,
      narrationReadyNotifications: true,
      promoNotifications: true,
    });
  });

  it('bulk filter: opt-in toggles need an explicit true row, default-on toggles exclude explicit false', () => {
    expect(notificationToggleOnWhere('promoNotifications')).toEqual({
      preferences: { is: { promoNotifications: true } },
    });
    expect(notificationToggleOnWhere('narrationReadyNotifications')).toEqual({
      NOT: { preferences: { is: { narrationReadyNotifications: false } } },
    });
  });
});
