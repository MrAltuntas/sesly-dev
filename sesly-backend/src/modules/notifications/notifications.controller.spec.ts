import { NotificationsController } from './notifications.controller';

describe('NotificationsController', () => {
  let service: Record<string, jest.Mock>;
  let controller: NotificationsController;

  beforeEach(() => {
    service = {
      listNotifications: jest.fn().mockResolvedValue({ items: [] }),
      getUnreadCount: jest.fn().mockResolvedValue({ unreadCount: 0 }),
      markAsRead: jest.fn().mockResolvedValue({ updated: 1 }),
      markAllAsRead: jest.fn().mockResolvedValue({ updated: 3 }),
      registerDevice: jest.fn().mockResolvedValue({ message: 'Device registered' }),
      unregisterDevice: jest.fn().mockResolvedValue({ removed: 1 }),
    };
    controller = new NotificationsController(service as any);
  });

  it('list parses page/limit query strings, defaults invalid values', async () => {
    await controller.listNotifications('user-1', '2', '50');
    expect(service.listNotifications).toHaveBeenLastCalledWith('user-1', 2, 50);

    await controller.listNotifications('user-1');
    expect(service.listNotifications).toHaveBeenLastCalledWith('user-1', 1, 20);

    await controller.listNotifications('user-1', 'abc', 'xyz');
    expect(service.listNotifications).toHaveBeenLastCalledWith('user-1', 1, 20);
  });

  it('every route is scoped to the authenticated user', async () => {
    await controller.getUnreadCount('user-1');
    await controller.markAsRead('user-1', 'n1');
    await controller.markAllAsRead('user-1');
    await controller.registerDevice('user-1', { token: 't', platform: 'ios' } as any);
    await controller.unregisterDevice('user-1', { token: 't' } as any);

    expect(service.getUnreadCount).toHaveBeenCalledWith('user-1');
    expect(service.markAsRead).toHaveBeenCalledWith('user-1', 'n1');
    expect(service.markAllAsRead).toHaveBeenCalledWith('user-1');
    expect(service.registerDevice).toHaveBeenCalledWith('user-1', { token: 't', platform: 'ios' });
    expect(service.unregisterDevice).toHaveBeenCalledWith('user-1', { token: 't' });
  });
});
