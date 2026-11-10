import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { PaginationHelper } from '../../../common/utils/pagination.helper';
import { PaginatedResponse } from '../../../common/types';
import { extractStorageKey } from '../../../common/utils/storage-key';
import {
  legacyTestSampleKey,
  voiceProfileFolder,
} from '../../voice-profiles/voice-clone-cleanup';

export type StorageClassification =
  | 'audio'
  | 'image'
  | 'voiceSample'
  | 'other';

export interface StorageTypeBucket {
  count: number;
  sizeBytes: number;
}

export interface StorageStatsResponse {
  byType: {
    audio: StorageTypeBucket;
    image: StorageTypeBucket;
    voiceSample: StorageTypeBucket;
    other: StorageTypeBucket;
  };
  /** Per real upload prefix (see STORAGE_PREFIXES) plus "other". */
  byPrefix: Record<string, StorageTypeBucket>;
  total: StorageTypeBucket;
  generatedAt: string;
}

/**
 * The prefixes the backend actually writes to (grep `uploadFile(`):
 *   audio/<audioId>/full.mp3 + audio/<audioId>/segments/N.mp3  (narrations)
 *   shared-audio/<audioId>/full.mp3 + .../segments/N.mp3       (shared ready-made voice narrations)
 *   stories/cover/<uuid>-<name>                                (admin covers)
 *   avatars/<userId>/<ts>-<name>                               (user avatars)
 *   voice-samples/<userId>/...                                 (clone uploads, test samples)
 *   voice-previews/<provider>/<lang>/<voiceId>/<prosody>.mp3   (preset preview cache)
 *   voice-clone-tests/<jobId>/...                              (admin clone tester)
 */
export const STORAGE_PREFIXES: Record<string, StorageClassification> = {
  'audio/': 'audio',
  'shared-audio/': 'audio',
  'stories/cover/': 'image',
  'avatars/': 'image',
  'voice-samples/': 'voiceSample',
  'voice-previews/': 'voiceSample',
  'voice-clone-tests/': 'other',
};

/**
 * Prefixes that are never DB-referenced by design and must not be offered
 * for orphan deletion. voice-previews/ is a regenerable cache keyed by
 * voice id (VoiceProfilesService.previewVoice).
 */
const ORPHAN_SCAN_EXCLUDED_PREFIXES = ['voice-previews/'];

/** DB-referenced object keys + folders of live voice profiles. */
interface ReferenceIndex {
  keys: Set<string>;
  liveFolders: string[];
}

export interface OrphanFile {
  key: string;
  sizeBytes: number;
  updatedAt: string;
  classifiedAs: StorageClassification;
}

@Injectable()
export class AdminStorageService {
  private readonly logger = new Logger(AdminStorageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Classify a GCS object key into one of the storage buckets used
   * by the admin dashboard (audio / image / voiceSample / other).
   */
  private classify(key: string): StorageClassification {
    const prefix = this.prefixOf(key);
    return prefix ? STORAGE_PREFIXES[prefix] : 'other';
  }

  private prefixOf(key: string): string | null {
    for (const prefix of Object.keys(STORAGE_PREFIXES)) {
      if (key.startsWith(prefix)) return prefix;
    }
    return null;
  }

  /**
   * Aggregate bytes + counts across the bucket, grouped by our storage
   * classification buckets. Single pass over the bucket listing.
   */
  async getStats(): Promise<StorageStatsResponse> {
    const files = await this.storageService.listAllFilesWithMetadata();

    const empty = (): StorageTypeBucket => ({ count: 0, sizeBytes: 0 });
    const byType = {
      audio: empty(),
      image: empty(),
      voiceSample: empty(),
      other: empty(),
    };
    const total: StorageTypeBucket = empty();
    const byPrefix: Record<string, StorageTypeBucket> = { other: empty() };
    for (const prefix of Object.keys(STORAGE_PREFIXES)) {
      byPrefix[prefix] = empty();
    }

    for (const f of files) {
      const bucket = byType[this.classify(f.name)];
      bucket.count += 1;
      bucket.sizeBytes += f.sizeBytes;
      const prefixBucket = byPrefix[this.prefixOf(f.name) ?? 'other'];
      prefixBucket.count += 1;
      prefixBucket.sizeBytes += f.sizeBytes;
      total.count += 1;
      total.sizeBytes += f.sizeBytes;
    }

    return {
      byType,
      byPrefix,
      total,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Load every URL that is currently referenced from the DB into a Set,
   * so we can quickly decide whether a GCS object is orphaned.
   *
   * Strategy: the DB stores full GCS URLs (e.g. https://storage.googleapis.com/<bucket>/<key>)
   * or plain keys. We store two lookup entries per row: the raw value and,
   * if it's a URL, the trailing key path. The scan then checks "does any
   * referenced URL end with this key" OR "is this key referenced verbatim".
   */
  private async loadReferencedKeys(): Promise<ReferenceIndex> {
    const [audioRows, segmentRows, voiceProfileRows, storyRows, userRows, collectionRows] =
      await Promise.all([
        this.prisma.audio.findMany({
          select: { audioUrl: true },
          where: { audioUrl: { not: null } },
        }),
        this.prisma.audioSegment.findMany({
          select: { audioUrl: true },
          where: { audioUrl: { not: null } },
        }),
        this.prisma.voiceProfile.findMany({
          select: { id: true, userId: true, sampleAudioUrl: true, consentAudioUrl: true },
        }),
        this.prisma.story.findMany({
          select: { coverImageUrl: true },
          where: { coverImageUrl: { not: null } },
        }),
        this.prisma.user.findMany({
          select: { avatarUrl: true },
          where: { avatarUrl: { not: null } },
        }),
        this.prisma.collection.findMany({
          select: { coverImageUrl: true },
          where: { coverImageUrl: { not: null } },
        }),
      ]);

    const referenced = new Set<string>();
    const add = (value: string | null | undefined) => {
      if (!value) return;
      referenced.add(value);
      // If it's a full URL, also index the trailing path segments so
      // key-based lookups can match.
      const stripped = this.extractKeyFromMaybeUrl(value);
      if (stripped) referenced.add(stripped);
    };

    // Every VoiceProfile row is live (no soft delete). The clone pipeline keeps
    // files under the profile folder that no column points to (raw reference
    // upload, its .normalized.wav, preview cache), so the whole folder plus
    // the legacy flat test sample count as referenced.
    const liveFolders: string[] = [];

    for (const row of audioRows) add(row.audioUrl);
    for (const row of segmentRows) add(row.audioUrl);
    for (const row of voiceProfileRows) {
      add(row.sampleAudioUrl);
      add(row.consentAudioUrl);
      if (row.id && row.userId) {
        liveFolders.push(voiceProfileFolder(row.userId, row.id));
        referenced.add(legacyTestSampleKey(row.userId, row.id));
      }
    }
    for (const row of storyRows) add(row.coverImageUrl);
    for (const row of userRows) add(row.avatarUrl);
    for (const row of collectionRows) add(row.coverImageUrl);

    return { keys: referenced, liveFolders };
  }

  /**
   * Strip a full `https://storage.googleapis.com/<bucket>/<key>` URL
   * down to `<key>`. Returns null if it doesn't look like a GCS URL.
   */
  private extractKeyFromMaybeUrl(value: string): string | null {
    return extractStorageKey(value);
  }

  private isExcludedFromOrphanScan(key: string): boolean {
    return ORPHAN_SCAN_EXCLUDED_PREFIXES.some((p) => key.startsWith(p));
  }

  /**
   * Decide whether a given GCS object key is referenced from the DB.
   */
  private isReferenced(key: string, referenced: ReferenceIndex): boolean {
    // Stored full URLs were indexed as keys too (loadReferencedKeys), so one
    // Set lookup covers both shapes.
    if (referenced.keys.has(key)) return true;
    return referenced.liveFolders.some((folder) => key.startsWith(folder));
  }

  /**
   * List orphaned GCS objects (those not referenced by any DB row),
   * paginated after filtering so `total` reflects the true orphan count.
   */
  async listOrphans(
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<OrphanFile>> {
    const [files, referenced] = await Promise.all([
      this.storageService.listAllFilesWithMetadata(),
      this.loadReferencedKeys(),
    ]);

    const orphans: OrphanFile[] = files
      .filter((f) => !this.isExcludedFromOrphanScan(f.name))
      .filter((f) => !this.isReferenced(f.name, referenced))
      .map((f) => ({
        key: f.name,
        sizeBytes: f.sizeBytes,
        updatedAt: f.updatedAt,
        classifiedAs: this.classify(f.name),
      }));

    const total = orphans.length;
    const offset = PaginationHelper.calculateOffset(page, limit);
    const data = orphans.slice(offset, offset + limit);

    return PaginationHelper.createPaginatedResponse(data, total, page, limit);
  }

  /**
   * Delete a single orphaned GCS object. Re-checks the orphan status
   * under the current DB state right before deletion to avoid deleting
   * a file that was just attached to a DB record (race prevention).
   */
  async deleteOrphan(key: string): Promise<{ deleted: true; key: string }> {
    if (!key) {
      throw new NotFoundException('Object key is required');
    }

    if (this.isExcludedFromOrphanScan(key)) {
      throw new ConflictException(
        `Object ${key} is under a cache prefix and is never treated as an orphan`,
      );
    }

    const exists = await this.storageService.fileExists(key);
    if (!exists) {
      throw new NotFoundException(`GCS object not found: ${key}`);
    }

    const referenced = await this.loadReferencedKeys();
    if (this.isReferenced(key, referenced)) {
      throw new ConflictException(
        `Object ${key} is now referenced by a DB record; refusing to delete`,
      );
    }

    await this.storageService.deleteFile(key);
    this.logger.log(`Admin deleted orphan GCS object: ${key}`);

    return { deleted: true, key };
  }
}
