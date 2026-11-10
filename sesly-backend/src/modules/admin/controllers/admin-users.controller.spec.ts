import { NotFoundException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AdminUsersController } from './admin-users.controller';
import { AdminJwtAuthGuard } from '../../../common/guards/admin-jwt-auth.guard';
import { AdminRolesGuard } from '../../../common/guards/admin-roles.guard';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { GrantSubscriptionPlan } from '../dto/grant-subscription.dto';
import { AdminSubscriptionPlan } from '../dto/grant-access.dto';
import { PromoCodeType } from '../dto/create-promocode.dto';

describe('AdminUsersController', () => {
  let adminUsers: Record<string, jest.Mock>;
  let adminService: Record<string, jest.Mock>;
  let controller: AdminUsersController;

  beforeEach(() => {
    adminUsers = {
      getUserStats: jest.fn().mockResolvedValue({ totalUsers: 1 }),
      getAllUsers: jest.fn().mockResolvedValue({ data: [] }),
      getUserById: jest.fn().mockResolvedValue({ id: 'u1' }),
      deactivateUser: jest.fn().mockResolvedValue({ message: 'User deactivated successfully' }),
      deleteUser: jest.fn().mockResolvedValue({ message: 'User deleted successfully' }),
      grantSubscription: jest.fn().mockResolvedValue({ message: 'ok' }),
    };
    adminService = {
      createPromoCode: jest.fn().mockResolvedValue({ id: 'p' }),
      getPromoCodes: jest.fn().mockResolvedValue([]),
      grantAccess: jest.fn().mockResolvedValue({ id: 's' }),
    };
    controller = new AdminUsersController(adminUsers as any, adminService as any);
  });

  it('bypasses the user JWT guard but stacks the admin JWT + roles guards', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AdminUsersController)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminUsersController)).toEqual([AdminJwtAuthGuard, AdminRolesGuard]);
  });

  it.each([
    ['getUserStats', RequestMethod.GET, 'users/stats'],
    ['getAllUsers', RequestMethod.GET, 'users'],
    ['getUserById', RequestMethod.GET, 'users/:id'],
    ['deactivateUser', RequestMethod.PATCH, 'users/:id/deactivate'],
    ['deleteUser', RequestMethod.DELETE, 'users/:id'],
    ['grantUserSubscription', RequestMethod.PATCH, 'users/:id/subscription'],
    ['createPromoCode', RequestMethod.POST, 'finance/promocodes'],
    ['getPromoCodes', RequestMethod.GET, 'finance/promocodes'],
    ['grantAccess', RequestMethod.POST, 'finance/grant-access'],
  ])('%s is %s /admin/%s', (method, verb, path) => {
    const handler = (AdminUsersController.prototype as any)[method];
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(verb);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
  });

  it('list: defaults page 1 / limit 20, forwards search', async () => {
    await controller.getAllUsers({} as any);
    expect(adminUsers.getAllUsers).toHaveBeenCalledWith(1, 20, undefined);

    await controller.getAllUsers({ page: 2, limit: 50, search: 'ayse' } as any);
    expect(adminUsers.getAllUsers).toHaveBeenLastCalledWith(2, 50, 'ayse');
  });

  it('detail / stats delegate', async () => {
    await expect(controller.getUserById('u1')).resolves.toEqual({ id: 'u1' });
    expect(adminUsers.getUserById).toHaveBeenCalledWith('u1');
    await expect(controller.getUserStats()).resolves.toEqual({ totalUsers: 1 });
  });

  it('delete: the target comes from the route param and the full cleanup service is used', async () => {
    await expect(controller.deleteUser('u-target')).resolves.toEqual({ message: 'User deleted successfully' });
    expect(adminUsers.deleteUser).toHaveBeenCalledWith('u-target');
  });

  it('delete / deactivate: a 404 from the service propagates', async () => {
    adminUsers.deleteUser.mockRejectedValue(new NotFoundException());
    adminUsers.deactivateUser.mockRejectedValue(new NotFoundException());

    await expect(controller.deleteUser('ghost')).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.deactivateUser('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('grant subscription: user id from the path, plan/duration from the body', async () => {
    const dto = { plan: GrantSubscriptionPlan.PRO, durationDays: 30, reason: 'destek' };

    await controller.grantUserSubscription('u1', dto);

    expect(adminUsers.grantSubscription).toHaveBeenCalledWith('u1', dto);
  });

  it('finance endpoints delegate to AdminService', async () => {
    const promo = { code: 'YAZ', type: PromoCodeType.PERCENTAGE, value: 10 };
    await controller.createPromoCode(promo);
    expect(adminService.createPromoCode).toHaveBeenCalledWith(promo);

    await controller.getPromoCodes();
    expect(adminService.getPromoCodes).toHaveBeenCalled();

    const grant = { userEmail: 'a@b.c', plan: AdminSubscriptionPlan.CREATOR, durationDays: 7, reason: 'r' };
    await controller.grantAccess(grant);
    expect(adminService.grantAccess).toHaveBeenCalledWith(grant);
  });
});
