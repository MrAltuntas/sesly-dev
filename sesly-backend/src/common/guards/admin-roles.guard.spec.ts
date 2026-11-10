import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRolesGuard } from './admin-roles.guard';
import { AdminRoles } from '../decorators/admin-roles.decorator';
import { AdminUsersController } from '../../modules/admin/controllers/admin-users.controller';
import { AdminContentController } from '../../modules/admin/controllers/admin-content.controller';
import { AdminOpsController } from '../../modules/admin/controllers/admin-ops.controller';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MODERATOR';

function createContext(cls: any, handler: any, user: any) {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('AdminRolesGuard', () => {
  const guard = new AdminRolesGuard(new Reflector());

  const allowed = (cls: any, method: string, role: Role | undefined) => {
    const ctx = createContext(cls, cls.prototype[method], role ? { id: 'a1', role } : { id: 'a1' });
    try {
      return guard.canActivate(ctx);
    } catch (e) {
      if (e instanceof ForbiddenException) return false;
      throw e;
    }
  };

  describe('generic behaviour', () => {
    class Open {
      handler() {}
    }
    @AdminRoles('ADMIN')
    class Locked {
      handler() {}
      @AdminRoles('SUPER_ADMIN')
      superOnly() {}
    }

    it('no @AdminRoles metadata -> allowed', () => {
      expect(guard.canActivate(createContext(Open, Open.prototype.handler, undefined))).toBe(true);
    });

    it('missing request.user -> 403 "Admin access required"', () => {
      expect(() => guard.canActivate(createContext(Locked, Locked.prototype.handler, undefined))).toThrow(
        new ForbiddenException('Admin access required'),
      );
    });

    it('a user-app token (no role claim) -> 403', () => {
      expect(() =>
        guard.canActivate(createContext(Locked, Locked.prototype.handler, { id: 'u1', email: 'x' })),
      ).toThrow(ForbiddenException);
    });

    it('wrong role -> 403 naming the required roles', () => {
      expect(() =>
        guard.canActivate(createContext(Locked, Locked.prototype.handler, { role: 'MODERATOR' })),
      ).toThrow(/Required: ADMIN/);
    });

    it('method-level metadata overrides the class-level list (not merged)', () => {
      expect(guard.canActivate(createContext(Locked, Locked.prototype.superOnly, { role: 'SUPER_ADMIN' }))).toBe(true);
      expect(() =>
        guard.canActivate(createContext(Locked, Locked.prototype.superOnly, { role: 'ADMIN' })),
      ).toThrow(ForbiddenException);
    });

    it('exact-match roles, no implicit hierarchy: SUPER_ADMIN is rejected where it is not listed', () => {
      expect(() =>
        guard.canActivate(createContext(Locked, Locked.prototype.handler, { role: 'SUPER_ADMIN' })),
      ).toThrow(ForbiddenException);
    });
  });

  /**
   * Role matrix against the REAL controller metadata. If someone widens or
   * narrows @AdminRoles on a risky route, this table fails.
   */
  describe('route role matrix (real controllers)', () => {
    const matrix: Array<[string, any, string, Role[]]> = [
      // AdminUsersController (class: SUPER_ADMIN, ADMIN, MODERATOR)
      ['GET users', AdminUsersController, 'getAllUsers', ['SUPER_ADMIN', 'ADMIN', 'MODERATOR']],
      ['GET users/:id', AdminUsersController, 'getUserById', ['SUPER_ADMIN', 'ADMIN', 'MODERATOR']],
      ['GET users/stats', AdminUsersController, 'getUserStats', ['SUPER_ADMIN', 'ADMIN', 'MODERATOR']],
      ['PATCH users/:id/deactivate', AdminUsersController, 'deactivateUser', ['SUPER_ADMIN', 'ADMIN']],
      ['DELETE users/:id', AdminUsersController, 'deleteUser', ['SUPER_ADMIN']],
      ['PATCH users/:id/subscription', AdminUsersController, 'grantUserSubscription', ['SUPER_ADMIN', 'ADMIN']],
      ['POST finance/promocodes', AdminUsersController, 'createPromoCode', ['SUPER_ADMIN', 'ADMIN']],
      ['GET finance/promocodes', AdminUsersController, 'getPromoCodes', ['SUPER_ADMIN', 'ADMIN']],
      ['POST finance/grant-access', AdminUsersController, 'grantAccess', ['SUPER_ADMIN', 'ADMIN']],
      // AdminContentController (class: SUPER_ADMIN, ADMIN, MODERATOR)
      ['GET stories', AdminContentController, 'getAllStories', ['SUPER_ADMIN', 'ADMIN', 'MODERATOR']],
      ['POST stories', AdminContentController, 'createStory', ['SUPER_ADMIN', 'ADMIN']],
      ['PATCH stories/:id', AdminContentController, 'updateStory', ['SUPER_ADMIN', 'ADMIN']],
      ['DELETE stories/:id', AdminContentController, 'deleteStory', ['SUPER_ADMIN']],
      ['PATCH stories/:id/segments', AdminContentController, 'updateStorySegments', ['SUPER_ADMIN', 'ADMIN']],
      ['DELETE stories/:id/segments', AdminContentController, 'clearStorySegments', ['SUPER_ADMIN', 'ADMIN']],
      ['POST stories/:id/segments/llm-fill', AdminContentController, 'llmFillStorySegments', ['SUPER_ADMIN', 'ADMIN']],
      ['GET stories/llm-tasks', AdminContentController, 'listStoryLlmTasks', ['SUPER_ADMIN', 'ADMIN', 'MODERATOR']],
      ['POST stories/:id/translate', AdminContentController, 'translateStory', ['SUPER_ADMIN', 'ADMIN']],
      ['POST stories/translate-batch', AdminContentController, 'translateStoriesBatch', ['SUPER_ADMIN', 'ADMIN']],
      ['POST stories/:id/level/assess', AdminContentController, 'assessStoryLevel', ['SUPER_ADMIN', 'ADMIN']],
      ['POST stories/level/assess-batch', AdminContentController, 'assessStoryLevelsBatch', ['SUPER_ADMIN', 'ADMIN']],
      ['GET stories/review', AdminContentController, 'getReviewList', ['SUPER_ADMIN', 'ADMIN', 'MODERATOR']],
      ['GET stories/import-batches', AdminContentController, 'listImportBatches', ['SUPER_ADMIN', 'ADMIN', 'MODERATOR']],
      ['PATCH stories/:id/review', AdminContentController, 'setStoryReviewed', ['SUPER_ADMIN', 'ADMIN']],
      ['GET stories/ids', AdminContentController, 'listStoryIds', ['SUPER_ADMIN', 'ADMIN', 'MODERATOR']],
      ['PATCH stories/bulk/review', AdminContentController, 'bulkReview', ['SUPER_ADMIN', 'ADMIN']],
      ['POST stories/:id/cover', AdminContentController, 'setStoryCover', ['SUPER_ADMIN', 'ADMIN']],
      ['POST stories/covers/match', AdminContentController, 'matchCovers', ['SUPER_ADMIN', 'ADMIN']],
      ['POST stories/bulk/publish', AdminContentController, 'bulkPublish', ['SUPER_ADMIN', 'ADMIN']],
      ['POST stories/bulk/archive', AdminContentController, 'bulkArchive', ['SUPER_ADMIN', 'ADMIN']],
      ['POST stories/bulk/delete-preview', AdminContentController, 'bulkDeletePreview', ['SUPER_ADMIN']],
      ['POST stories/bulk/delete', AdminContentController, 'bulkDelete', ['SUPER_ADMIN']],
      ['DELETE audio/:id', AdminContentController, 'deleteAudio', ['SUPER_ADMIN', 'ADMIN']],
      ['GET moderation/voice-profiles', AdminContentController, 'listVoiceProfilesForModeration', ['SUPER_ADMIN', 'ADMIN', 'MODERATOR']],
      ['POST moderation/:id/reject', AdminContentController, 'rejectVoiceProfile', ['SUPER_ADMIN', 'ADMIN', 'MODERATOR']],
      ['POST collections', AdminContentController, 'createCollection', ['SUPER_ADMIN', 'ADMIN']],
      ['DELETE collections/:id', AdminContentController, 'deleteCollection', ['SUPER_ADMIN', 'ADMIN']],
      ['POST legal', AdminContentController, 'createLegalDocument', ['SUPER_ADMIN', 'ADMIN']],
      ['POST legal/:slug/publish', AdminContentController, 'publishLegalDocument', ['SUPER_ADMIN', 'ADMIN']],
      // AdminOpsController (class: SUPER_ADMIN, ADMIN)
      ['GET analytics/system', AdminOpsController, 'getSystemStats', ['SUPER_ADMIN', 'ADMIN']],
      ['POST ops/data/broadcast', AdminOpsController, 'broadcast', ['SUPER_ADMIN', 'ADMIN']],
      ['POST ops/system/maintenance', AdminOpsController, 'setMaintenanceMode', ['SUPER_ADMIN', 'ADMIN']],
      ['POST ops/voice-clone-test', AdminOpsController, 'voiceCloneTest', ['SUPER_ADMIN', 'ADMIN']],
      ['GET storage/orphans', AdminOpsController, 'listStorageOrphans', ['SUPER_ADMIN', 'ADMIN']],
      ['DELETE storage/orphans/:key', AdminOpsController, 'deleteStorageOrphan', ['SUPER_ADMIN']],
    ];

    const roles: Role[] = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'];

    it.each(matrix)('%s -> only %j', (_route, cls, method, allowedRoles) => {
      expect(typeof cls.prototype[method]).toBe('function');
      for (const role of roles) {
        expect({ role, ok: allowed(cls, method, role) }).toEqual({ role, ok: allowedRoles.includes(role) });
      }
      expect(allowed(cls, method, undefined)).toBe(false);
    });
  });
});
