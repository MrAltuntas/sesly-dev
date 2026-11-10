import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import * as admin from 'firebase-admin';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { TTSProviderFactory } from '../tts-providers/tts-provider.factory';
import { TTSProvider } from '../../common/enums/prisma.enums';
import { extractStorageKey } from '../../common/utils/storage-key';
import { bumpTokenVersion } from '../../common/utils/token-version';
import { deleteUpstreamCloneWithAudit } from '../voice-profiles/voice-clone-cleanup';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private ttsProviderFactory: TTSProviderFactory,
  ) {}

  private async toUserResponse(
    user: Parameters<typeof UserResponseDto.fromUser>[0] & { avatarUrl?: string | null },
  ): Promise<UserResponseDto> {
    const avatar = await this.storageService.getReadUrl(user.avatarUrl ?? null);
    return UserResponseDto.fromUser(user, avatar);
  }

  async getCurrentUser(userId: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscription: true, // Include subscription to get plan
      },
    });

    if (!user) {
      throw new NotFoundException('errors.auth.userNotFound');
    }

    return this.toUserResponse(user);
  }

  /**
   * Name only. The email address belongs to Firebase Auth (sign in and
   * password reset go through it), so it is never changed here.
   */
  async updateUser(userId: string, updateUserDto: UpdateUserDto): Promise<UserResponseDto> {
    const { firstName, lastName } = updateUserDto;

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
      },
      include: {
        subscription: true, // Include subscription to get plan
      },
    });

    return this.toUserResponse(updatedUser);
  }

  /**
   * Full account deletion (DELETE /users/me and DELETE /admin/users/:id).
   *
   * KVKK / GDPR: removes every artifact we hold for the user:
   *   1. voice samples / consent recordings in GCS + provider-side voice
   *      clones (audit row in voice_deletion_requests outlives the user)
   *   2. generated narration audio at its real prefix `audio/<audioId>/`
   *   3. avatar uploads under `avatars/<userId>/`
   *   4. store subscriptions: nothing to call (App Store / Google Play
   *      billing can only be stopped by the user in the store); the
   *      store_purchases rows go with the cascade, freeing the purchase
   *   5. the Firebase Auth account
   *   6. the DB row (cascades to every user-owned table)
   * Storage/provider failures are logged and do not block the DB deletion.
   */
  async deleteUser(userId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        voiceProfiles: true,
        subscription: true,
      },
    });

    if (!user) {
      throw new NotFoundException('errors.auth.userNotFound');
    }

    // Revoke every token right away: the storage / provider cleanup below can
    // take a while and the row itself only disappears at the very end. Never
    // blocks the deletion.
    try {
      await this.prisma.user.update({ where: { id: userId }, data: bumpTokenVersion() });
    } catch {
      this.logger.warn(`Token revocation before account deletion failed for ${userId}`);
    }

    // Narration audio ids first: deleting voice profiles below cascades their
    // Audio rows, and the files at audio/<audioId>/ must still be found.
    const audios =
      (await this.prisma.audio.findMany({
        where: { userId },
        select: { id: true },
      })) ?? [];

    // 1. Voice profile files + cloned voices at the provider
    for (const snapshot of user.voiceProfiles) {
      // Delete the row first and use the state Prisma returns: if a clone
      // finished training after the snapshot above, that row already carries
      // the new upstream id; if it finishes later, the training processor
      // finds the row gone and deletes the upstream voice itself.
      let profile = snapshot;
      try {
        const deleted = await this.prisma.voiceProfile.delete({ where: { id: snapshot.id } });
        if (deleted) profile = deleted;
      } catch {
        this.logger.warn(`Voice profile ${snapshot.id} already gone during account deletion`);
      }

      for (const url of [profile.sampleAudioUrl, profile.consentAudioUrl]) {
        const key = extractStorageKey(url);
        if (!key) continue;
        try {
          await this.storageService.deleteFile(key);
        } catch (error) {
          this.logger.error(`Failed to delete voice profile file ${key} (${profile.id})`, error);
        }
      }

      // Upstream clone + audit row (voice_deletion_requests outlives the
      // user). Keyed off `kind`: only CLONE profiles with a real upstream id
      // call Cartesia; presets and pending placeholders get a NO_OP row. A
      // clone still training is handled by the processor, which deletes the
      // upstream voice when it finds the profile gone. FAILED upstream
      // deletions are retried by the voice maintenance sweeper.
      await deleteUpstreamCloneWithAudit(
        this.prisma,
        () => this.ttsProviderFactory.getCloningProvider(TTSProvider.CARTESIA),
        this.logger,
        profile,
      );
    }

    // Everything else the clone pipeline wrote for this user (raw reference,
    // normalized wav, consent audio, test sample, previews) lives under
    // voice-samples/<userId>/.
    await this.deleteFolderSafely(`voice-samples/${userId}/`);

    // 2. Generated narration audio: merged file + segments at audio/<audioId>/
    for (const audio of audios) {
      await this.deleteFolderSafely(`audio/${audio.id}/`);
    }

    // 3. Avatar uploads (the current one may also be a third-party URL, e.g.
    //    a Google profile photo, which is not ours to delete).
    const avatarKey = extractStorageKey(user.avatarUrl);
    if (avatarKey) {
      try {
        await this.storageService.deleteFile(avatarKey);
      } catch (error) {
        this.logger.error(`Failed to delete avatar ${avatarKey}`, error);
      }
    }
    await this.deleteFolderSafely(`avatars/${userId}/`);

    // 4. Store subscriptions cannot be cancelled from here; log it so support
    //    can tell the user to cancel in the store.
    if (user.subscription?.storePurchaseId) {
      this.logger.warn(`Deleted user ${userId} had a store subscription; it renews until cancelled in the store`);
    }

    // 5. Firebase Auth account
    await this.deleteFirebaseUser(user.providerId, user.email);

    // 6. Delete user (cascade will handle related data)
    await this.prisma.user.delete({
      where: { id: userId },
    });

    this.logger.log(`User deleted: ${userId}`);

    return { message: 'Account deleted successfully' };
  }

  private async deleteFolderSafely(prefix: string): Promise<void> {
    try {
      await this.storageService.deleteFolder(prefix);
    } catch (error) {
      this.logger.error(`Failed to delete storage prefix ${prefix}`, error);
    }
  }

  /**
   * Delete the Firebase Auth user. `providerId` holds the Firebase uid for
   * accounts created through POST /auth/firebase. If it is missing or not a
   * Firebase uid (legacy passport logins stored the Google/Apple subject),
   * fall back to the account registered with the same email.
   * "Not found" is success (idempotent); other errors are logged, not thrown.
   */
  private async deleteFirebaseUser(providerId: string | null, email: string): Promise<void> {
    if (!admin.apps?.length) {
      this.logger.warn('Firebase Admin not initialized; skipping Firebase user deletion');
      return;
    }

    const isNotFound = (error: any) => error?.code === 'auth/user-not-found';

    try {
      if (providerId) {
        try {
          await admin.auth().deleteUser(providerId);
          this.logger.log(`Firebase user deleted: ${providerId}`);
          return;
        } catch (error: any) {
          if (!isNotFound(error)) throw error;
        }
      }

      try {
        const record = await admin.auth().getUserByEmail(email);
        await admin.auth().deleteUser(record.uid);
        this.logger.log(`Firebase user deleted by email lookup: ${record.uid}`);
      } catch (error: any) {
        if (!isNotFound(error)) throw error;
        this.logger.log('No Firebase user found for deleted account (already gone)');
      }
    } catch (error: any) {
      this.logger.error(`Failed to delete Firebase user: ${error?.message ?? error}`);
    }
  }

  /**
   * Simple counters used by the mobile Profile screen stats strip.
   * `hoursListened` is a rough proxy: we sum Audio.duration for READY
   * narrations owned by this user. Not real playback tracking — documented
   * on the DTO.
   */
  async getStats(userId: string): Promise<{
    storiesCompleted: number;
    hoursListened: number;
    voicesTrained: number;
  }> {
    const [storiesCompleted, voicesTrained, durationAgg] = await Promise.all([
      this.prisma.storyNarration.count({
        where: { userId, completedAt: { not: null } },
      }),
      this.prisma.voiceProfile.count({
        where: { userId, status: 'READY' },
      }),
      // Sum duration (seconds) of READY audios that belong to this user's narrations.
      this.prisma.audio.aggregate({
        where: {
          status: 'READY',
          // A shared audio is counted once for each user who has it.
          narrations: { some: { userId } },
        },
        _sum: { duration: true },
      }),
    ]);

    const totalSeconds = durationAgg._sum.duration ?? 0;
    const hoursListened = Math.round((totalSeconds / 3600) * 10) / 10; // 1 decimal place

    return {
      storiesCompleted,
      hoursListened,
      voicesTrained,
    };
  }

  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscription: true,
        voiceProfiles: {
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
          },
        },
        usageLimits: {
          where: {
            month: new Date().getMonth() + 1,
            year: new Date().getFullYear(),
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('errors.auth.userNotFound');
    }

    const sub = user.subscription;

    return {
      user: await this.toUserResponse(user),
      // Safe subset only: no Stripe/Apple/Google identifiers.
      subscription: sub
        ? {
            plan: sub.plan,
            status: sub.status,
            extraVoiceSlots: sub.extraVoiceSlots,
            currentPeriodStart: sub.currentPeriodStart,
            currentPeriodEnd: sub.currentPeriodEnd,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          }
        : null,
      voiceProfiles: user.voiceProfiles,
      usage: user.usageLimits[0] || null,
    };
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('errors.auth.userNotFound');
    }

    // Delete old avatar if it lives in our bucket
    const oldKey = extractStorageKey(user.avatarUrl);
    if (oldKey) {
      try {
        await this.storageService.deleteFile(oldKey);
      } catch (error) {
        this.logger.warn('Failed to delete old avatar', error);
      }
    }

    // Upload new avatar
    const key = `avatars/${userId}/${Date.now()}-${file.originalname}`;
    const avatarUrl = await this.storageService.uploadFile(file.buffer, key, file.mimetype);

    // Update user
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });

    this.logger.log(`Avatar uploaded for user ${userId}`);

    const readableUrl = await this.storageService.getReadUrl(avatarUrl);
    return {
      message: 'Avatar uploaded successfully',
      avatarUrl: readableUrl,
      profileImageUrl: readableUrl,
    };
  }
}
