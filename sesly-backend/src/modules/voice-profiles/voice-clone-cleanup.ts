import { Logger } from '@nestjs/common';
import {
  TTSProvider,
  VoiceDeletionRequestStatus,
  VoiceProfileKind,
} from '../../common/enums/prisma.enums';
import { extractStorageKey } from '../../common/utils/storage-key';
import { PENDING_VOICE_ID_PREFIX } from './clone-config.constants';

/**
 * Shared KVKK deletion helpers for a single voice profile. Used by
 * VoiceProfilesService (DELETE /voice-profiles/:id), UsersService (account
 * deletion), the training processor (profile deleted mid-training) and the
 * maintenance sweeper (retrying failed upstream deletions).
 *
 * GCS layout written by the clone pipeline:
 *   voice-samples/<uid>/<pid>/reference/<file>                  raw upload
 *   voice-samples/<uid>/<pid>/reference/<file>.normalized.wav   what Cartesia got
 *   voice-samples/<uid>/<pid>/consent/<file>                    consent audio
 *   voice-samples/<uid>/<pid>/test-sample.mp3                   "listen" sample
 *   voice-samples/<uid>/<pid>/previews/<hash>.mp3               preview clips
 *   voice-samples/<uid>/<pid>.mp3                               legacy test sample
 */

export function voiceProfileFolder(userId: string, profileId: string): string {
  return `voice-samples/${userId}/${profileId}/`;
}

export function testSampleKey(userId: string, profileId: string): string {
  return `${voiceProfileFolder(userId, profileId)}test-sample.mp3`;
}

export function legacyTestSampleKey(userId: string, profileId: string): string {
  return `voice-samples/${userId}/${profileId}.mp3`;
}

export interface CleanupStorage {
  deleteFile(key: string): Promise<void>;
  deleteFolder(prefix: string): Promise<void>;
}

export interface CleanupProfile {
  id: string;
  userId: string;
  name: string;
  provider: string;
  kind?: string | null;
  voiceId?: string | null;
  voiceCloningKey?: string | null;
  sampleAudioUrl?: string | null;
  consentAudioUrl?: string | null;
}

/**
 * Upstream voice id to delete for a profile, or null when there is nothing
 * upstream (presets, or a clone still carrying its `pending-` placeholder).
 * A clone whose training is still in flight is covered by the processor's
 * post-clone existence check.
 */
export function upstreamCloneId(profile: CleanupProfile): string | null {
  if (profile.kind !== VoiceProfileKind.CLONE) return null;
  if (profile.voiceCloningKey && !profile.voiceCloningKey.startsWith(PENDING_VOICE_ID_PREFIX)) {
    return profile.voiceCloningKey;
  }
  if (profile.voiceId && !profile.voiceId.startsWith(PENDING_VOICE_ID_PREFIX)) {
    return profile.voiceId;
  }
  return null;
}

/**
 * Delete every stored object for a voice profile. Best effort: failures are
 * logged, never thrown, so the DB deletion always proceeds.
 */
export async function deleteVoiceProfileStorage(
  storage: CleanupStorage,
  logger: Logger,
  profile: Pick<CleanupProfile, 'id' | 'userId' | 'sampleAudioUrl' | 'consentAudioUrl'>,
): Promise<void> {
  const keys = new Set<string>();
  for (const url of [profile.sampleAudioUrl, profile.consentAudioUrl]) {
    const key = extractStorageKey(url);
    if (key) keys.add(key);
  }
  keys.add(legacyTestSampleKey(profile.userId, profile.id));

  for (const key of keys) {
    try {
      await storage.deleteFile(key);
    } catch (error: any) {
      // Missing objects are expected (legacy key rarely exists).
      logger.warn(`Voice profile ${profile.id}: could not delete ${key}: ${error?.message ?? error}`);
    }
  }

  const folder = voiceProfileFolder(profile.userId, profile.id);
  try {
    await storage.deleteFolder(folder);
  } catch (error: any) {
    logger.error(`Voice profile ${profile.id}: could not delete ${folder}`, error);
  }
}

export interface DeletionAuditPrisma {
  voiceDeletionRequest: {
    create(args: any): Promise<{ id: string }>;
    update(args: any): Promise<unknown>;
  };
}

export interface CloneDeleter {
  deleteVoiceClone(voiceId: string): Promise<void>;
}

/**
 * Delete the upstream clone (if any) and write the voice_deletion_requests
 * audit row, which outlives the profile and the user:
 *   - CLONE with an upstream id: IN_PROGRESS, then COMPLETED or FAILED+notes
 *     (FAILED rows are retried by the maintenance sweeper)
 *   - everything else: NO_OP
 * Never throws.
 *
 * @returns true when nothing is left upstream (COMPLETED or NO_OP).
 */
export async function deleteUpstreamCloneWithAudit(
  prisma: DeletionAuditPrisma,
  resolveDeleter: () => CloneDeleter,
  logger: Logger,
  profile: CleanupProfile,
): Promise<boolean> {
  const upstreamId = upstreamCloneId(profile);
  const base = {
    userId: profile.userId,
    voiceProfileId: profile.id,
    voiceProfileName: profile.name,
    provider: profile.provider,
  };

  try {
    if (!upstreamId) {
      await prisma.voiceDeletionRequest.create({
        data: {
          ...base,
          providerVoiceId: profile.voiceId ?? '',
          status: VoiceDeletionRequestStatus.NO_OP,
          completedAt: new Date(),
        },
      });
      return true;
    }

    const requestRow = await prisma.voiceDeletionRequest.create({
      data: {
        ...base,
        provider: profile.provider || TTSProvider.CARTESIA,
        providerVoiceId: upstreamId,
        status: VoiceDeletionRequestStatus.IN_PROGRESS,
        attemptCount: 1,
        lastAttemptedAt: new Date(),
      },
    });

    try {
      await resolveDeleter().deleteVoiceClone(upstreamId);
      await prisma.voiceDeletionRequest.update({
        where: { id: requestRow.id },
        data: {
          status: VoiceDeletionRequestStatus.COMPLETED,
          completedAt: new Date(),
        },
      });
      return true;
    } catch (error: any) {
      logger.error(`Failed to call deleteVoiceClone for ${upstreamId}`, error);
      await prisma.voiceDeletionRequest.update({
        where: { id: requestRow.id },
        data: {
          status: VoiceDeletionRequestStatus.FAILED,
          notes: (error?.message ?? String(error)).slice(0, 500),
        },
      });
      return false;
    }
  } catch (error: any) {
    logger.error(`Voice deletion audit failed for profile ${profile.id}`, error);
    return false;
  }
}
