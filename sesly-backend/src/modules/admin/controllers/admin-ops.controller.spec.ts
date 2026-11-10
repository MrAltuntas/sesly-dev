import { BadRequestException, ForbiddenException, RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AdminOpsController } from './admin-ops.controller';
import { AdminJwtAuthGuard } from '../../../common/guards/admin-jwt-auth.guard';
import { AdminRolesGuard } from '../../../common/guards/admin-roles.guard';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { ADMIN_ROLES_KEY } from '../../../common/decorators/admin-roles.decorator';
import { BroadcastSegment } from '../dto/broadcast.dto';

describe('AdminOpsController', () => {
  let analytics: Record<string, jest.Mock>;
  let adminService: Record<string, jest.Mock>;
  let storage: Record<string, jest.Mock>;
  let tester: { runStoryTest: jest.Mock };
  let settings: { describe: jest.Mock; update: jest.Mock; reset: jest.Mock };
  let geminiModels: { listTextModels: jest.Mock };
  let emailTemplates: Record<string, jest.Mock>;
  let email: { sendTemplateTest: jest.Mock };
  let controller: AdminOpsController;

  const audioFile = { originalname: 'ref.m4a', buffer: Buffer.from('x') } as Express.Multer.File;

  beforeEach(() => {
    analytics = {
      getSystemStats: jest.fn().mockResolvedValue({ s: 1 }),
      getRecentActivity: jest.fn().mockResolvedValue({ a: 1 }),
      getPopularStories: jest.fn().mockResolvedValue({ p: 1 }),
      getUsageStats: jest.fn().mockResolvedValue({ u: 1 }),
    };
    adminService = {
      broadcast: jest.fn().mockResolvedValue({ count: 2, pushSent: true, pushDelivered: 1 }),
      setMaintenanceMode: jest.fn().mockResolvedValue({ enabled: true }),
      getMaintenanceMode: jest.fn().mockResolvedValue({ enabled: false }),
    };
    storage = {
      getStats: jest.fn().mockResolvedValue({ total: {} }),
      listOrphans: jest.fn().mockResolvedValue({ data: [] }),
      deleteOrphan: jest.fn().mockResolvedValue({ deleted: true }),
    };
    tester = { runStoryTest: jest.fn().mockResolvedValue({ jobId: 'j' }) };
    settings = {
      describe: jest.fn().mockReturnValue({ groups: [] }),
      update: jest.fn().mockResolvedValue({ groups: [{ id: 'llm' }] }),
      reset: jest.fn().mockResolvedValue({ key: 'llm.gemini.model', source: 'env' }),
    };
    geminiModels = {
      listTextModels: jest.fn().mockResolvedValue({ models: ['gemini-x-flash'], reason: null, fetchedAt: 't' }),
    };
    emailTemplates = {
      describe: jest.fn().mockResolvedValue({ templates: [] }),
      getOne: jest.fn().mockResolvedValue({ kind: 'welcome', language: 'tr' }),
      save: jest.fn().mockResolvedValue({ source: 'custom' }),
      reset: jest.fn().mockResolvedValue({ source: 'default' }),
      preview: jest.fn().mockResolvedValue({ html: '<html>', problems: [] }),
    };
    email = { sendTemplateTest: jest.fn().mockResolvedValue({ sent: true, to: 'a@b.co', subject: '[Test] x' }) };
    controller = new AdminOpsController(
      analytics as any,
      adminService as any,
      storage as any,
      tester as any,
      settings as any,
      geminiModels as any,
      emailTemplates as any,
      email as any,
    );
  });

  describe('route security metadata', () => {
    it('bypasses the user JWT guard but stacks the admin JWT + roles guards', () => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, AdminOpsController)).toBe(true);
      expect(Reflect.getMetadata(GUARDS_METADATA, AdminOpsController)).toEqual([AdminJwtAuthGuard, AdminRolesGuard]);
      expect(Reflect.getMetadata(PATH_METADATA, AdminOpsController)).toBe('admin');
    });

    it.each([
      ['getSystemStats', RequestMethod.GET, 'analytics/system'],
      ['getUsageStats', RequestMethod.GET, 'analytics/usage'],
      ['voiceCloneTest', RequestMethod.POST, 'ops/voice-clone-test'],
      ['broadcast', RequestMethod.POST, 'ops/data/broadcast'],
      ['setMaintenanceMode', RequestMethod.POST, 'ops/system/maintenance'],
      ['getMaintenanceMode', RequestMethod.GET, 'ops/system/maintenance'],
      ['getStorageStats', RequestMethod.GET, 'storage/stats'],
      ['listStorageOrphans', RequestMethod.GET, 'storage/orphans'],
      ['deleteStorageOrphan', RequestMethod.DELETE, 'storage/orphans/:key'],
      ['getSettings', RequestMethod.GET, 'settings'],
      ['getGeminiModelOptions', RequestMethod.GET, 'settings/options/gemini-models'],
      ['updateSettings', RequestMethod.PATCH, 'settings'],
      ['resetSetting', RequestMethod.DELETE, 'settings/:key'],
      ['getEmailTemplates', RequestMethod.GET, 'email-templates'],
      ['getEmailTemplate', RequestMethod.GET, 'email-templates/:kind/:language'],
      ['saveEmailTemplate', RequestMethod.PUT, 'email-templates/:kind/:language'],
      ['resetEmailTemplate', RequestMethod.DELETE, 'email-templates/:kind/:language'],
      ['previewEmailTemplate', RequestMethod.POST, 'email-templates/:kind/:language/preview'],
      ['sendTestEmail', RequestMethod.POST, 'email-templates/:kind/:language/test'],
    ])('%s is %s /admin/%s', (method, verb, path) => {
      const handler = (AdminOpsController.prototype as any)[method];
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(verb);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    });
  });

  describe('runtime settings', () => {
    const rolesOf = (method: string) =>
      Reflect.getMetadata(ADMIN_ROLES_KEY, (AdminOpsController.prototype as any)[method]);

    const guardFor = (method: string, role: string | undefined) => {
      const guard = new AdminRolesGuard(new Reflector());
      const context: any = {
        getHandler: () => (AdminOpsController.prototype as any)[method],
        getClass: () => AdminOpsController,
        switchToHttp: () => ({ getRequest: () => ({ user: role ? { id: 'a1', role } : undefined }) }),
      };
      return () => guard.canActivate(context);
    };

    it('writes carry a SUPER_ADMIN-only role override, reads inherit the class roles', () => {
      expect(rolesOf('updateSettings')).toEqual(['SUPER_ADMIN']);
      expect(rolesOf('resetSetting')).toEqual(['SUPER_ADMIN']);
      expect(rolesOf('getSettings')).toBeUndefined();
      expect(rolesOf('getGeminiModelOptions')).toBeUndefined();
      expect(Reflect.getMetadata(ADMIN_ROLES_KEY, AdminOpsController)).toEqual(['SUPER_ADMIN', 'ADMIN']);
    });

    it.each(['updateSettings', 'resetSetting'])('%s: SUPER_ADMIN passes, ADMIN and MODERATOR get 403', (method) => {
      expect(guardFor(method, 'SUPER_ADMIN')()).toBe(true);
      expect(guardFor(method, 'ADMIN')).toThrow(ForbiddenException);
      expect(guardFor(method, 'MODERATOR')).toThrow(ForbiddenException);
      expect(guardFor(method, undefined)).toThrow(ForbiddenException);
    });

    it.each(['getSettings', 'getGeminiModelOptions'])('%s: ADMIN may read, MODERATOR may not', (method) => {
      expect(guardFor(method, 'SUPER_ADMIN')()).toBe(true);
      expect(guardFor(method, 'ADMIN')()).toBe(true);
      expect(guardFor(method, 'MODERATOR')).toThrow(ForbiddenException);
    });

    it('GET /admin/settings returns the grouped registry view', () => {
      expect(controller.getSettings()).toEqual({ groups: [] });
      expect(settings.describe).toHaveBeenCalledTimes(1);
    });

    it('GET /admin/settings/options/gemini-models returns the service result as is', async () => {
      await expect(controller.getGeminiModelOptions()).resolves.toEqual({
        models: ['gemini-x-flash'],
        reason: null,
        fetchedAt: 't',
      });
    });

    it('PATCH /admin/settings passes the values map and the admin id', async () => {
      const values = { 'llm.gemini.temperature': 0.3 };
      await expect(controller.updateSettings({ values }, 'admin-1')).resolves.toEqual({ groups: [{ id: 'llm' }] });
      expect(settings.update).toHaveBeenCalledWith(values, 'admin-1');

      await controller.updateSettings({ values }, undefined as any);
      expect(settings.update).toHaveBeenLastCalledWith(values, null);
    });

    it('PATCH /admin/settings surfaces the service validation error', async () => {
      settings.update.mockRejectedValue(new BadRequestException('Bilinmeyen ayar anahtarı: "x".'));
      await expect(controller.updateSettings({ values: { x: 1 } }, 'admin-1')).rejects.toThrow(
        'Bilinmeyen ayar anahtarı: "x".',
      );
    });

    it('DELETE /admin/settings/:key resets the override with the admin id', async () => {
      await expect(controller.resetSetting('llm.gemini.model', 'admin-1')).resolves.toEqual({
        key: 'llm.gemini.model',
        source: 'env',
      });
      expect(settings.reset).toHaveBeenCalledWith('llm.gemini.model', 'admin-1');

      await controller.resetSetting('llm.gemini.model', undefined as any);
      expect(settings.reset).toHaveBeenLastCalledWith('llm.gemini.model', null);
    });
  });

  describe('analytics delegation', () => {
    it('passes query DTOs through and returns the service result', async () => {
      await expect(controller.getSystemStats()).resolves.toEqual({ s: 1 });
      await expect(controller.getUsageStats()).resolves.toEqual({ u: 1 });
      const q = { page: 2, limit: 5 } as any;
      await expect(controller.getRecentActivity(q)).resolves.toEqual({ a: 1 });
      expect(analytics.getRecentActivity).toHaveBeenCalledWith(q);
      await controller.getPopularStories(q);
      expect(analytics.getPopularStories).toHaveBeenCalledWith(q);
    });
  });

  describe('voice clone test', () => {
    it('missing audio file -> 400, tester not called', async () => {
      await expect(controller.voiceCloneTest(undefined as any, 'story-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(tester.runStoryTest).not.toHaveBeenCalled();
    });

    it.each([undefined, '', 123 as any])('invalid storyId %p -> 400', async (storyId) => {
      await expect(controller.voiceCloneTest(audioFile, storyId)).rejects.toBeInstanceOf(BadRequestException);
      expect(tester.runStoryTest).not.toHaveBeenCalled();
    });

    it.each([
      ['true', true],
      [true, true],
      ['false', false],
      [false, false],
      [undefined, false],
      ['1', false],
    ])('skipPreprocessing %p -> %p (multipart sends strings)', async (raw, expected) => {
      await controller.voiceCloneTest(audioFile, 'story-1', raw as any);

      expect(tester.runStoryTest).toHaveBeenCalledWith(audioFile, 'story-1', { skipPreprocessing: expected });
    });
  });

  describe('ops', () => {
    it('broadcast: forwards the DTO and returns the notification outcome untouched', async () => {
      const dto = { title: 'T', body: 'B', segment: BroadcastSegment.FREE };

      await expect(controller.broadcast(dto)).resolves.toEqual({ count: 2, pushSent: true, pushDelivered: 1 });
      expect(adminService.broadcast).toHaveBeenCalledWith(dto);
    });

    it('maintenance toggle / read', async () => {
      await expect(controller.setMaintenanceMode(true)).resolves.toEqual({ enabled: true });
      expect(adminService.setMaintenanceMode).toHaveBeenCalledWith(true);
      await expect(controller.getMaintenanceMode()).resolves.toEqual({ enabled: false });
    });

  });

  describe('storage', () => {
    it('orphans list defaults to page 1 / limit 20', async () => {
      await controller.listStorageOrphans({} as any);
      expect(storage.listOrphans).toHaveBeenCalledWith(1, 20);
      await controller.listStorageOrphans({ page: 3, limit: 50 } as any);
      expect(storage.listOrphans).toHaveBeenLastCalledWith(3, 50);
    });

    it('orphan delete passes the (already URL-decoded) key through without decoding it again', async () => {
      await controller.deleteStorageOrphan('audio/a1/100%-done.mp3');
      expect(storage.deleteOrphan).toHaveBeenCalledWith('audio/a1/100%-done.mp3');
    });

    it('stats', async () => {
      await expect(controller.getStorageStats()).resolves.toEqual({ total: {} });
    });
  });

  describe('email templates', () => {
    const rolesOf = (method: string) =>
      Reflect.getMetadata(ADMIN_ROLES_KEY, (AdminOpsController.prototype as any)[method]);

    const guardFor = (method: string, role: string | undefined) => {
      const guard = new AdminRolesGuard(new Reflector());
      const context: any = {
        getHandler: () => (AdminOpsController.prototype as any)[method],
        getClass: () => AdminOpsController,
        switchToHttp: () => ({ getRequest: () => ({ user: role ? { id: 'a1', role } : undefined }) }),
      };
      return () => guard.canActivate(context);
    };

    it.each(['saveEmailTemplate', 'resetEmailTemplate', 'sendTestEmail'])(
      '%s: SUPER_ADMIN only',
      (method) => {
        expect(rolesOf(method)).toEqual(['SUPER_ADMIN']);
        expect(guardFor(method, 'SUPER_ADMIN')()).toBe(true);
        expect(guardFor(method, 'ADMIN')).toThrow(ForbiddenException);
        expect(guardFor(method, 'MODERATOR')).toThrow(ForbiddenException);
      },
    );

    it.each(['getEmailTemplates', 'getEmailTemplate', 'previewEmailTemplate'])(
      '%s: ADMIN may use it, MODERATOR may not',
      (method) => {
        expect(rolesOf(method)).toBeUndefined();
        expect(guardFor(method, 'ADMIN')()).toBe(true);
        expect(guardFor(method, 'MODERATOR')).toThrow(ForbiddenException);
      },
    );

    it('delegates list, read, save, reset and preview with kind, language and admin id', async () => {
      await expect(controller.getEmailTemplates()).resolves.toEqual({ templates: [] });
      await controller.getEmailTemplate('welcome', 'tr');
      expect(emailTemplates.getOne).toHaveBeenCalledWith('welcome', 'tr');

      const fields = { subject: 'S', heading: 'H', body: 'B' };
      await controller.saveEmailTemplate('password_reset', 'en', fields, 'admin-1');
      expect(emailTemplates.save).toHaveBeenCalledWith('password_reset', 'en', fields, 'admin-1');

      await controller.resetEmailTemplate('welcome', 'en', undefined as any);
      expect(emailTemplates.reset).toHaveBeenCalledWith('welcome', 'en', null);

      await controller.previewEmailTemplate('welcome', 'tr', { heading: 'Taslak' });
      expect(emailTemplates.preview).toHaveBeenCalledWith('welcome', 'tr', { heading: 'Taslak' });
    });

    it('test email: the recipient is split from the draft fields', async () => {
      await expect(
        controller.sendTestEmail('welcome', 'tr', { to: 'a@b.co', heading: 'Taslak' }),
      ).resolves.toEqual({ sent: true, to: 'a@b.co', subject: '[Test] x' });
      expect(email.sendTemplateTest).toHaveBeenCalledWith('welcome', 'tr', 'a@b.co', { heading: 'Taslak' });
    });
  });
});
