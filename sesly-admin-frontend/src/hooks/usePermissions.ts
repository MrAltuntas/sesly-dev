import { useAuth } from "@/contexts/AuthContext";
import { AdminRole } from "@/types/api.types";

// Mirrors the backend @AdminRoles() matrix. Keep in sync with
// sesly-backend/src/modules/admin/controllers/admin-{content,users,ops}.controller.ts:
//   admin-content (class: SUPER_ADMIN, ADMIN, MODERATOR)
//     stories read + meta + llm-tasks, segment preview, audio read, moderation, collection
//     list + attach/detach/reorder, legal read: all tiers
//     story create/update + segments + llm-fill, translation link/unlink,
//     translate + level assess (single and batch), audio delete, collection
//     create/update/delete, legal writes: SUPER_ADMIN, ADMIN
//     story review toggle, bulk publish / archive, cover upload + match: SUPER_ADMIN, ADMIN
//     story delete, bulk delete (+ preview): SUPER_ADMIN
//   admin-users (class: SUPER_ADMIN, ADMIN, MODERATOR)
//     users stats/list/detail: all tiers
//     deactivate, subscription, finance/*: SUPER_ADMIN, ADMIN
//     user delete: SUPER_ADMIN
//   admin-ops (class: SUPER_ADMIN, ADMIN)
//     analytics, voice-clone-test, broadcast, maintenance, storage read,
//     settings read: SUPER_ADMIN, ADMIN
//     settings update + reset: SUPER_ADMIN
//     email templates read + preview: SUPER_ADMIN, ADMIN
//     email template save, reset, test email: SUPER_ADMIN
//     storage orphan delete: SUPER_ADMIN
export function usePermissions() {
  const { admin } = useAuth();

  const isSuperAdmin = admin?.role === AdminRole.SUPER_ADMIN;
  const isAdmin = admin?.role === AdminRole.ADMIN || isSuperAdmin;
  // "Any admin tier" (MODERATOR and above).
  const isModerator = admin?.role === AdminRole.MODERATOR || isAdmin;

  // Users (admin-users controller)
  const canViewUsers = isModerator;
  const canDeactivateUser = isAdmin;
  const canDeleteUser = isSuperAdmin;

  // Stories (admin-content controller)
  const canViewStories = isModerator;
  const canCreateStory = isAdmin;
  const canEditStory = isAdmin;
  const canDeleteStory = isSuperAdmin;
  // Review view, bulk publish / archive, cover uploads: ADMIN+; bulk delete: SUPER_ADMIN.
  const canReviewStories = isAdmin;

  // Audio (admin-content controller)
  const canViewAudio = isModerator;
  const canDeleteAudio = isAdmin;

  // Moderation (admin-content controller, no method-level override)
  const canViewModeration = isModerator;
  const canRejectVoice = isModerator;

  // Collections: create/update/delete are ADMIN+, story attach/detach/reorder
  // have no method-level override so every tier may call them.
  const canViewCollections = isModerator;
  const canEditCollections = isAdmin;
  const canManageCollectionStories = isModerator;

  // Legal
  const canViewLegal = isModerator;
  const canEditLegal = isAdmin;

  // Finance (admin-users controller, ADMIN+ per route)
  const canViewFinance = isAdmin;
  const canCreatePromoCode = isAdmin;
  const canGrantAccess = isAdmin;

  // Ops (admin-ops controller, ADMIN+ at class level)
  const canViewAnalytics = isAdmin;
  const canSendBroadcast = isAdmin;
  const canRunVoiceTest = isAdmin;
  const canToggleMaintenance = isAdmin;
  const canViewStorage = isAdmin;
  const canDeleteStorage = isSuperAdmin;

  // Settings page: every tier can open it. The maintenance card is gated by
  // canToggleMaintenance. Runtime settings (admin-ops): GET /admin/settings is
  // SUPER_ADMIN + ADMIN, PATCH and DELETE are SUPER_ADMIN only.
  const canViewSettings = isModerator;
  const canViewSystemSettings = isAdmin;
  const canEditSystemSettings = isSuperAdmin;

  // Email templates (admin-ops): read and preview ADMIN+, save, reset and
  // test email SUPER_ADMIN only.
  const canViewEmailTemplates = isAdmin;
  const canEditEmailTemplates = isSuperAdmin;

  return {
    isSuperAdmin,
    isAdmin,
    isModerator,
    canViewUsers,
    canDeactivateUser,
    canDeleteUser,
    canViewStories,
    canCreateStory,
    canEditStory,
    canDeleteStory,
    canReviewStories,
    canViewAudio,
    canDeleteAudio,
    canViewModeration,
    canRejectVoice,
    canViewCollections,
    canEditCollections,
    canManageCollectionStories,
    canViewLegal,
    canEditLegal,
    canViewFinance,
    canCreatePromoCode,
    canGrantAccess,
    canViewAnalytics,
    canSendBroadcast,
    canRunVoiceTest,
    canToggleMaintenance,
    canViewStorage,
    canDeleteStorage,
    canViewSettings,
    canViewSystemSettings,
    canEditSystemSettings,
    canViewEmailTemplates,
    canEditEmailTemplates,
  };
}

export type Permissions = ReturnType<typeof usePermissions>;
export type PermissionKey = {
  [K in keyof Permissions]: Permissions[K] extends boolean ? K : never;
}[keyof Permissions];
