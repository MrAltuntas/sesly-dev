import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ConflictException,
    ForbiddenException,
    ServiceUnavailableException,
    Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { CreateVoiceProfileDto } from './dto/create-voice-profile.dto';
import { CreateVoiceProfileV2Dto } from './dto/create-voice-profile-v2.dto';
import { PreviewVoiceDto } from './dto/preview-voice.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { generateUniqueFileName } from '../../common/utils/file.utils';
import { TTSProviderFactory } from '../tts-providers/tts-provider.factory';
import {
    TTSProvider,
    VoiceProfileKind,
} from '../../common/enums/prisma.enums';
import {
    cloneCreationLimitError,
    cloneSlotLimitError,
    getCloneCreationAllowance,
    presetSlotLimitError,
} from '../../common/constants/voice-slots.constants';
import { resolveEffectivePlan } from '../../common/utils/subscription-plan';
import { isPremiumVoice } from '../../common/utils/voice-tier';
import { extractStorageKey } from '../../common/utils/storage-key';
import {
    findPresetVoice,
    hasPresetVoices,
    presetPreviewText,
} from '../../common/constants/google-preset-voices';
import { resolveContentLanguages } from '../stories/content-language';
import { voiceContentLanguage } from '../../common/utils/voice-language';
import { languageCodeOf } from '../../common/constants/voice-languages';
import { requireCloneLanguage, resolveCloneLanguages } from './clone-languages';
import { toPublicVoiceProfile, PublicVoiceProfile } from './voice-profile.mapper';
import { resolveUserUiLanguage } from '../../common/i18n/user-ui-language';
import {
    buildCloneConfig,
    cloneContentFor,
    CloneConfigResponse,
    CLONE_PLACEHOLDER_VOICE_ID,
    PENDING_VOICE_ID_PREFIX,
} from './clone-config.constants';
import {
    buildVoiceSlotInfo,
    getCloneCreationUsage,
    refundCloneCreationForProfile,
    tryConsumeCloneCreation,
    VoiceSlotInfo,
} from './clone-quota';
import {
    deleteUpstreamCloneWithAudit,
    deleteVoiceProfileStorage,
    voiceProfileFolder,
} from './voice-clone-cleanup';
import {
    VOICE_TRAINING_JOB,
    VOICE_TRAINING_QUEUE,
    VoiceTrainingJob,
    voiceTrainingJobOptions,
} from './processors/voice-training.job';

/**
 * Version segment of the ready-made voice preview cache key. Bump it when
 * the way a preset preview is synthesized changes, so files rendered with
 * the old settings are never served again (the old objects stay in storage).
 * v2: Chirp 3 HD only catalogue, rate and pitch applied once, no pitch for
 * Chirp voices.
 */
export const PRESET_PREVIEW_CACHE_VERSION = 'v2';

export interface CloneUploadInput {
    referenceAudio: Express.Multer.File;
    consentAudio?: Express.Multer.File;
    consentVersion?: string | null;
    speechStartMs?: number | null;
}

@Injectable()
export class VoiceProfilesService {
    private readonly logger = new Logger(VoiceProfilesService.name);

    constructor(
        private prisma: PrismaService,
        private storageService: StorageService,
        private ttsProviderFactory: TTSProviderFactory,
        @InjectQueue(VOICE_TRAINING_QUEUE) private voiceTrainingQueue: Queue,
        private notificationsService: NotificationsService,
        private settings: SettingsService,
    ) {
    }

    /**
     * GET /voice-profiles/clone-config[?language=en]
     *
     * The reading script, intro steps, tips and consent text in the language
     * the user will speak, plus the languages on offer. Without `language`
     * the Turkish texts are served, so app builds in the field see what they
     * always did. A language that is not an enabled voice language is a
     * coded 400 VOICE_LANGUAGE_NOT_SUPPORTED.
     */
    getCloneConfig(language?: string | string[]): CloneConfigResponse {
        const requested = Array.isArray(language) ? language[0] : language;
        return buildCloneConfig(
            requireCloneLanguage(this.settings, requested),
            resolveCloneLanguages(this.settings),
        );
    }

    /**
     * Legacy POST /voice-profiles. Creates a PENDING clone placeholder, same
     * as POST /voice-profiles/v2 with provider CARTESIA.
     */
    async createVoiceProfile(userId: string, dto: CreateVoiceProfileDto) {
        const profile = await this.createClonePlaceholder(userId, dto.name, {
            profileIcon: dto.profileIcon,
            language: dto.language,
        });
        return {
            profile,
            trainingText: '',
            estimatedDuration: 0,
        };
    }

    /**
     * GET /voice-profiles[?language=tr,en]
     *
     * `language` keeps only the voices of those content languages (clones:
     * the language the user spoke; ready-made voices: the language they were
     * added for). Filtered in memory on the normalised code: a user has a
     * handful of profiles and the stored locale has several spellings
     * ("tr", "tr-TR").
     */
    async getVoiceProfiles(userId: string, language?: string | string[]) {
        const profiles = await this.prisma.voiceProfile.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        });
        // Only a FAILED row without a stored reason needs the language.
        const uiLanguage = profiles.some((p) => p.status === 'FAILED' && !p.errorReason)
            ? await resolveUserUiLanguage(this.prisma, userId)
            : undefined;
        const all = profiles.map((profile) => toPublicVoiceProfile(profile, uiLanguage));
        // "tr-TR" filters like "tr".
        const wanted = this.parseLanguageCodes(language).map((code) => languageCodeOf(code) ?? code);
        if (wanted.length === 0) return all;
        return all.filter((profile) => wanted.includes(profile.contentLanguage));
    }

    /** "tr,en", ["tr", "en"] or "TR" as lower-case codes, duplicates dropped. */
    private parseLanguageCodes(requested?: string | string[]): string[] {
        const raw = (Array.isArray(requested) ? requested.join(',') : requested ?? '')
            .split(',')
            .map((code) => code.trim().toLowerCase())
            .filter((code) => code.length > 0);
        return [...new Set(raw)];
    }

    async getVoiceProfile(userId: string, profileId: string) {
        const profile = await this.prisma.voiceProfile.findFirst({
            where: { id: profileId, userId },
        });

        if (!profile) {
            throw new NotFoundException('errors.voiceProfiles.notFound');
        }

        return profile;
    }

    // =========================================================================
    // Slots (presets vs clones)
    // =========================================================================

    /**
     * GET /voice-profiles/slots. Keeps the pre-split top-level fields
     * (`canCreate` = preset.canCreate || clone.canCreate) and adds the
     * `preset` / `clone` breakdown. Uses the effective plan, so an expired
     * admin grant falls back to FREE.
     */
    async getVoiceSlotInfo(userId: string): Promise<VoiceSlotInfo> {
        const [subscription, presetUsed, cloneUsed, creations] = await Promise.all([
            this.prisma.subscription.findUnique({ where: { userId } }),
            this.prisma.voiceProfile.count({ where: { userId, kind: VoiceProfileKind.PRESET } }),
            // FAILED clones hold no usable voice; counting them would lock a
            // FREE user (1 clone slot) out of re-recording after one failure.
            this.prisma.voiceProfile.count({
                where: { userId, kind: VoiceProfileKind.CLONE, status: { not: 'FAILED' } },
            }),
            getCloneCreationUsage(this.prisma, userId),
        ]);

        return buildVoiceSlotInfo({
            plan: resolveEffectivePlan(subscription),
            extraSlots: subscription?.extraVoiceSlots ?? 0,
            presetUsed: presetUsed ?? 0,
            cloneUsed: cloneUsed ?? 0,
            creations: creations ?? { monthly: 0, lifetime: 0 },
        });
    }

    private assertPresetSlotAvailable(info: VoiceSlotInfo) {
        if (!info.preset.canCreate) {
            throw new ForbiddenException({
                code: 'PRESET_SLOT_LIMIT',
                limit: info.preset.limit,
                ...presetSlotLimitError(info.preset.limit),
            });
        }
    }

    /**
     * Clone slot + monthly creation checks, run when the PENDING placeholder
     * is created and again at upload (`alreadyCounted`: the profile being
     * uploaded is itself one of the counted clones).
     */
    private assertCloneAllowed(info: VoiceSlotInfo, alreadyCounted: boolean) {
        const otherClones = alreadyCounted ? info.clone.used - 1 : info.clone.used;
        if (otherClones >= info.clone.limit) {
            throw new ForbiddenException({
                code: 'CLONE_SLOT_LIMIT',
                limit: info.clone.limit,
                ...cloneSlotLimitError(info.clone.limit),
            });
        }
        if (!info.clone.creations.canCreate) {
            this.throwCreationLimit(info);
        }
    }

    /**
     * 403 CLONE_CREATION_LIMIT: the plan's clone creations are used up.
     * Counted creations, not existing clones, so deleting a voice does not
     * lift it. `period` / `renewsAt` say whether and when it renews.
     */
    private throwCreationLimit(info: VoiceSlotInfo): never {
        const { creations } = info.clone;
        throw new ForbiddenException({
            code: 'CLONE_CREATION_LIMIT',
            plan: info.plan,
            limit: creations.limit,
            used: creations.used,
            period: creations.period,
            renewsAt: creations.renewsAt,
            ...cloneCreationLimitError(getCloneCreationAllowance(info.plan), creations.renewsAt),
        });
    }

    // =========================================================================
    // Create
    // =========================================================================

    /**
     * POST /voice-profiles/v2
     *   - GOOGLE + a ready-made voice id -> PRESET, READY immediately
     *   - CARTESIA + "custom-cloning-pending" (or no voiceId) -> CLONE
     *     placeholder, PENDING until the recording is uploaded
     * An arbitrary Cartesia voice id is never accepted: Cartesia voices on
     * our account are other users' private clones.
     */
    async createVoiceProfileV2(userId: string, dto: CreateVoiceProfileV2Dto) {
        const provider = String(dto.provider || '').toUpperCase();

        if (provider === TTSProvider.CARTESIA) {
            if (dto.voiceId !== undefined && dto.voiceId !== CLONE_PLACEHOLDER_VOICE_ID) {
                throw new BadRequestException({
                    code: 'CLONE_ONLY_PROVIDER',
                    message: 'errors.voiceProfiles.providerCloneOnly',
                });
            }
            const profile = await this.createClonePlaceholder(userId, dto.name, {
                language: dto.language,
            });
            return { profile, availableVoices: [] };
        }

        if (provider !== TTSProvider.GOOGLE) {
            throw new BadRequestException('Unsupported TTS provider. Only "GOOGLE" and "CARTESIA" are supported.');
        }

        if (!dto.voiceId || dto.voiceId === CLONE_PLACEHOLDER_VOICE_ID) {
            throw new BadRequestException(
                'Google provider only supports ready-made voices. voiceId is required.',
            );
        }

        const info = await this.getVoiceSlotInfo(userId);
        this.assertPresetSlotAvailable(info);

        // Checked against the static catalogue, never a live provider call:
        // a slow Google answer used to make every Chirp id "not found".
        const voice = findPresetVoice(dto.voiceId);
        if (!voice) {
            throw new BadRequestException({
                code: 'VOICE_NOT_FOUND',
                message: 'errors.voiceProfiles.presetNotFound',
            });
        }

        const voiceProfile = await this.prisma.voiceProfile.create({
            data: {
                userId,
                name: dto.name,
                voiceId: dto.voiceId,
                provider: TTSProvider.GOOGLE,
                kind: VoiceProfileKind.PRESET,
                // The locale of the voice itself: a preset only speaks that one.
                language: voice.languageCode,
                status: 'READY', // Ready-made voices are usable immediately
            },
        });

        this.logger.log(`Preset voice profile created: ${voiceProfile.id} (${dto.voiceId})`);

        // No "voice ready" notification here: a ready-made voice is usable the
        // moment the user picks it, so a push/inbox entry would be noise.
        return {
            profile: toPublicVoiceProfile(voiceProfile),
            availableVoices: await this.listGoogleVoices([voice.contentLanguage]),
        };
    }

    private async createClonePlaceholder(
        userId: string,
        name: string,
        options: { profileIcon?: string; language?: string } = {},
    ): Promise<PublicVoiceProfile> {
        // The language the user will speak: decides the reading script, the
        // consent text and the Cartesia clone language. Checked before the
        // slot so an unsupported language never reads as a quota problem.
        const language = requireCloneLanguage(this.settings, options.language);

        const info = await this.getVoiceSlotInfo(userId);
        this.assertCloneAllowed(info, false);

        const voiceProfile = await this.prisma.voiceProfile.create({
            data: {
                userId,
                name,
                profileIcon: options.profileIcon,
                voiceId: `${PENDING_VOICE_ID_PREFIX}${randomUUID()}`,
                provider: TTSProvider.CARTESIA,
                kind: VoiceProfileKind.CLONE,
                language: language.locale,
                status: 'PENDING', // Waiting for the recording upload
            },
        });

        this.logger.log(`Pending clone profile created: ${voiceProfile.id}`);
        return toPublicVoiceProfile(voiceProfile);
    }

    // =========================================================================
    // Upload (clone recording)
    // =========================================================================

    /**
     * POST /voice-profiles/:id/upload-samples
     *
     * Order: ownership (404) -> CLONE kind (400) -> PENDING only (409
     * VOICE_ALREADY_UPLOADED, so a re-upload can never orphan an upstream
     * clone) -> current consent version (400 CONSENT_REQUIRED) -> clone slot
     * + creation allowance (403) -> store files -> atomic PENDING->PROCESSING claim
     * -> atomic creation counter increment -> enqueue.
     */
    async uploadVoiceSamples(userId: string, profileId: string, input: CloneUploadInput) {
        const profile = await this.getVoiceProfile(userId, profileId);

        if (profile.kind !== VoiceProfileKind.CLONE) {
            throw new BadRequestException({
                code: 'NOT_A_CLONE_PROFILE',
                message: 'errors.voiceProfiles.uploadNotAllowed',
            });
        }

        if (profile.status !== 'PENDING') {
            this.throwAlreadyUploaded(profile.status);
        }

        // The consent the user gave must be the current text of the language
        // this clone was started in (each language has its own version id).
        const consentVersion = cloneContentFor(profile.language).consentVersion;
        if (input.consentVersion !== consentVersion) {
            throw new BadRequestException({
                code: 'CONSENT_REQUIRED',
                consentVersion,
                language: voiceContentLanguage(profile),
                message: 'errors.voiceProfiles.consentRequired',
            });
        }

        const info = await this.getVoiceSlotInfo(userId);
        this.assertCloneAllowed(info, true);

        // 1. Store the raw files under the profile folder (deleted with it).
        const folder = voiceProfileFolder(userId, profileId);
        const { referenceAudio, consentAudio } = input;
        const referenceKey = `${folder}reference/${generateUniqueFileName(referenceAudio.originalname || 'reference.m4a')}`;
        const consentKey = consentAudio
            ? `${folder}consent/${generateUniqueFileName(consentAudio.originalname || 'consent.m4a')}`
            : null;

        try {
            await Promise.all([
                this.storageService.uploadFile(referenceAudio.buffer, referenceKey, referenceAudio.mimetype),
                consentAudio && consentKey
                    ? this.storageService.uploadFile(consentAudio.buffer, consentKey, consentAudio.mimetype)
                    : Promise.resolve(''),
            ]);
        } catch (error) {
            this.logger.error(`Clone upload storage failed for profile ${profileId}`, error as Error);
            await this.deleteFolderSafely(folder);
            throw new ServiceUnavailableException({
                code: 'VOICE_UPLOAD_FAILED',
                message: 'errors.voiceProfiles.uploadFailed',
            });
        }

        // 2. Claim the profile. The status condition makes a concurrent second
        //    upload lose cleanly instead of queueing a second clone.
        const consentAt = new Date();
        const claimed = await this.prisma.voiceProfile.updateMany({
            where: { id: profileId, userId, status: 'PENDING' },
            data: {
                status: 'PROCESSING',
                sampleAudioUrl: referenceKey,
                consentAudioUrl: consentKey,
                consentAt,
                consentVersion,
                errorReason: null,
            },
        });
        if (claimed.count !== 1) {
            await this.deleteFolderSafely(folder);
            const current = await this.prisma.voiceProfile.findFirst({
                where: { id: profileId, userId },
                select: { status: true },
            });
            if (!current) {
                throw new NotFoundException('errors.voiceProfiles.notFound');
            }
            this.throwAlreadyUploaded(current.status);
        }

        // 3. Creation counters (append-only, atomic against the allowance).
        //    The charge time goes on the profile, so a training that fails
        //    can give exactly this creation back (once, to its own month).
        const chargedAt = await tryConsumeCloneCreation(
            this.prisma,
            userId,
            getCloneCreationAllowance(info.plan),
        );
        if (!chargedAt) {
            await this.releaseClaim(profileId);
            await this.deleteFolderSafely(folder);
            this.throwCreationLimit(info);
        }
        await this.prisma.voiceProfile.updateMany({
            where: { id: profileId },
            data: { creationChargedAt: chargedAt },
        });

        // 4. Queue the training job (retried with backoff on transient errors).
        const job: VoiceTrainingJob = {
            profileId,
            referenceS3Key: referenceKey,
            consentS3Key: consentKey ?? undefined,
            speechStartMs: input.speechStartMs ?? null,
        };
        try {
            await this.voiceTrainingQueue.add(VOICE_TRAINING_JOB, job, voiceTrainingJobOptions(profileId));
        } catch (error) {
            this.logger.error(`Could not queue voice training for ${profileId}`, error as Error);
            await this.releaseClaim(profileId);
            await refundCloneCreationForProfile(this.prisma, profileId).catch(() => undefined);
            await this.deleteFolderSafely(folder);
            throw new ServiceUnavailableException({
                code: 'VOICE_QUEUE_UNAVAILABLE',
                message: 'errors.voiceProfiles.processingUnavailable',
            });
        }

        this.logger.log(`Voice training queued for profile: ${profileId}`);

        return {
            message: 'Upload successful, voice training started',
            profile: toPublicVoiceProfile({
                ...profile,
                status: 'PROCESSING',
                sampleAudioUrl: referenceKey,
                consentAt,
                errorReason: null,
            }),
        };
    }

    private throwAlreadyUploaded(status: string): never {
        throw new ConflictException({
            code: 'VOICE_ALREADY_UPLOADED',
            status,
            message: 'errors.voiceProfiles.alreadyUploaded',
        });
    }

    /** Undo a PENDING->PROCESSING claim that could not be completed. */
    private async releaseClaim(profileId: string) {
        await this.prisma.voiceProfile
            .updateMany({
                where: { id: profileId, status: 'PROCESSING' },
                data: {
                    status: 'PENDING',
                    sampleAudioUrl: null,
                    consentAudioUrl: null,
                    consentAt: null,
                    consentVersion: null,
                },
            })
            .catch((error) =>
                this.logger.error(`Could not release upload claim for ${profileId}`, error),
            );
    }

    private async deleteFolderSafely(folder: string) {
        try {
            await this.storageService.deleteFolder(folder);
        } catch (error) {
            this.logger.warn(`Could not delete storage prefix ${folder}: ${(error as Error)?.message ?? error}`);
        }
    }

    async getVoiceProfileStatus(userId: string, profileId: string) {
        const profile = await this.getVoiceProfile(userId, profileId);
        const publicProfile = toPublicVoiceProfile(profile);

        // Return the full shape required by the mobile parser
        // (id, name, status, provider, voiceId, createdAt, updatedAt are all required)
        return {
            id: profile.id,
            name: profile.name,
            status: profile.status,
            progress: profile.status === 'READY' ? 100 : 0,
            provider: profile.provider,
            kind: publicProfile.kind,
            voiceId: profile.voiceId ?? '',
            language: publicProfile.language,
            contentLanguage: publicProfile.contentLanguage,
            sampleAudioUrl: profile.sampleAudioUrl,
            consentAt: publicProfile.consentAt,
            createdAt: profile.createdAt instanceof Date
                ? profile.createdAt.toISOString()
                : profile.createdAt,
            updatedAt: profile.updatedAt instanceof Date
                ? profile.updatedAt.toISOString()
                : profile.updatedAt,
            errorMessage: publicProfile.errorMessage,
        };
    }

    // =========================================================================
    // Delete (KVKK)
    // =========================================================================

    /**
     * Deletes the DB row first (Prisma returns its final state atomically),
     * then every stored object (raw reference, normalized wav, consent audio,
     * test sample, previews) and the upstream clone with an audit row.
     *
     * Deleting the row first closes the race with an in-flight training job:
     * either the returned row already carries the new clone id (deleted here),
     * or the processor's conditional update finds the row gone and deletes the
     * upstream clone itself.
     */
    async deleteVoiceProfile(userId: string, profileId: string) {
        await this.getVoiceProfile(userId, profileId);

        // Narrations rendered with this voice cascade with the row; their
        // files live at audio/<audioId>/ and are synthetic copies of the
        // voice, so they go too.
        const audios =
            (await this.prisma.audio.findMany({
                where: { voiceProfileId: profileId },
                select: { id: true },
            })) ?? [];

        const deleted = await this.prisma.voiceProfile.delete({
            where: { id: profileId },
        });

        for (const audio of audios) {
            await this.deleteFolderSafely(`audio/${audio.id}/`);
        }
        await deleteVoiceProfileStorage(this.storageService, this.logger, deleted);
        await deleteUpstreamCloneWithAudit(
            this.prisma,
            () => this.ttsProviderFactory.getCloningProvider(TTSProvider.CARTESIA),
            this.logger,
            deleted,
        );

        this.logger.log(`Voice profile deleted: ${profileId}`);

        return {
            message: 'Voice profile deleted successfully',
        };
    }

    // =========================================================================
    // Samples + previews
    // =========================================================================

    /**
     * GET /voice-profiles/:id/sample. Stored sample (clone test sample or
     * the raw reference while training) when present, otherwise an on-demand
     * preview for READY profiles.
     */
    async getVoiceProfileSample(userId: string, profileId: string) {
        const profile = await this.getVoiceProfile(userId, profileId);

        const sampleKey = extractStorageKey(profile.sampleAudioUrl);
        if (sampleKey) {
            try {
                const signedUrl = await this.storageService.generatePresignedUrl(sampleKey, 3600);
                return { audioUrl: signedUrl, cached: true };
            } catch (error) {
                this.logger.warn(`Failed to generate signed URL for sample: ${profileId}`, error);
                // Fall through to preview generation
            }
        }

        if (profile.status !== 'READY') {
            return { audioUrl: null, message: 'Preview generation failed.' };
        }

        try {
            const previewResult = await this.renderProfilePreview(profile);
            return { audioUrl: previewResult.audioUrl, cached: previewResult.cached };
        } catch (error) {
            this.logger.warn(`Failed to generate preview for profile ${profileId}: ${(error as Error).message}`);
            return { audioUrl: null, message: 'Preview generation failed.' };
        }
    }

    /**
     * POST /voice-profiles/preview. Allowed for a ready-made Google voice or
     * a READY voice profile the caller owns; anything else is 403
     * PREVIEW_NOT_ALLOWED (no synthesizing with other users' clones).
     */
    async previewVoice(userId: string, dto: PreviewVoiceDto) {
        const provider = String(dto.provider || '').toUpperCase();
        const text = dto.text?.trim() || undefined;

        // Static catalogue lookup: no provider call before the synthesis.
        if (provider === TTSProvider.GOOGLE && findPresetVoice(dto.voiceId)) {
            return this.renderPresetPreview(dto.voiceId, text);
        }

        const owned = await this.prisma.voiceProfile.findFirst({
            where: { userId, voiceId: dto.voiceId, provider: provider as TTSProvider, status: 'READY' },
        });
        if (!owned) {
            throw new ForbiddenException({
                code: 'PREVIEW_NOT_ALLOWED',
                message: 'errors.voiceProfiles.previewNotAllowed',
            });
        }

        return this.renderProfilePreview(owned, text);
    }

    private renderProfilePreview(
        profile: { id: string; userId: string; provider: string; kind: string; voiceId: string; language: string },
        text?: string,
    ) {
        if (profile.kind !== VoiceProfileKind.CLONE && profile.provider === TTSProvider.GOOGLE) {
            return this.renderPresetPreview(profile.voiceId, text);
        }
        // Clone previews are the user's synthetic voice: keep them under the
        // profile folder so profile / account deletion removes them.
        const variant = text ? this.textHash(text) : 'default';
        return this.renderPreview({
            provider: profile.provider,
            voiceId: profile.voiceId,
            // Default line in the language of the voice itself.
            text: text ?? cloneContentFor(profile.language).testSampleText,
            language: profile.language,
            key: `${voiceProfileFolder(profile.userId, profile.id)}previews/${variant}.mp3`,
        });
    }

    private renderPresetPreview(voiceId: string, text?: string) {
        // Locale of the voice, read from its id (tr-TR-Chirp3-HD-Achernar -> tr-TR)
        const langCode = voiceId.split('-').slice(0, 2).join('-') || 'tr-TR';
        // The cached MP3 is rendered with the current Google prosody settings,
        // so the key carries a short hash of them: changing rate or pitch in
        // the admin panel makes every preset preview render again instead of
        // serving the stale file.
        // The version segment retires every preview rendered before the
        // current synthesis rules (see PRESET_PREVIEW_CACHE_VERSION).
        const prosody = this.googleProsodyHash();
        const folder = `voice-previews/GOOGLE/${PRESET_PREVIEW_CACHE_VERSION}/${langCode}/${voiceId}`;
        const key = text
            ? `${folder}/${prosody}-${this.textHash(text)}.mp3`
            : `${folder}/${prosody}.mp3`;
        return this.renderPreview({
            provider: TTSProvider.GOOGLE,
            voiceId,
            text: text ?? presetPreviewText(voiceId),
            language: langCode,
            key,
        });
    }

    private googleProsodyHash(): string {
        const rate = this.settings.get('tts.google.speakingRate');
        const pitch = this.settings.get('tts.google.pitch');
        return `p${createHash('sha256').update(`${rate}|${pitch}`).digest('hex').slice(0, 8)}`;
    }

    private textHash(text: string): string {
        return createHash('sha256').update(text).digest('hex').slice(0, 16);
    }

    private async renderPreview(params: {
        provider: string;
        voiceId: string;
        text: string;
        language: string;
        key: string;
    }) {
        const { provider, voiceId, key } = params;

        if (await this.storageService.fileExists(key)) {
            const signedUrl = await this.storageService.generatePresignedUrl(key, 3600);
            return { audioUrl: signedUrl, voiceId, provider, cached: true };
        }

        try {
            const audioBuffer = await this.ttsProviderFactory
                .getProvider(provider)
                .textToSpeech(params.text, voiceId, { language: params.language });
            await this.storageService.uploadFile(audioBuffer, key, 'audio/mpeg');
            const signedUrl = await this.storageService.generatePresignedUrl(key, 3600);
            this.logger.log(`Voice preview generated and cached: ${voiceId} (${provider})`);
            return { audioUrl: signedUrl, voiceId, provider, cached: false };
        } catch (error) {
            this.logger.error(`Failed to generate voice preview for ${voiceId}:`, error);
            throw new BadRequestException('errors.voiceProfiles.previewFailed');
        }
    }

    // =========================================================================
    // Ready-made voice catalogue
    // =========================================================================

    /**
     * GET /voice-profiles/available-voices
     *
     * The ready-made narrators: Google Chirp 3 HD voices from the static
     * catalogue (`google-preset-voices.ts`), never a live provider call.
     *
     * `language` is a content language code ("tr"), or several separated by
     * commas ("tr,en"). Absent means the default content language, so app
     * builds in the field keep getting the Turkish narrators. A language
     * without ready-made voices contributes nothing. Every voice carries
     * `contentLanguage` ("tr") and `languageCode` ("tr-TR").
     *
     * Without a provider filter the response is an object keyed by
     * lowercased provider name (`{ google: Voice[], cartesia: [] }`) because
     * the mobile narrator grid parses it that way. Cartesia is clone-only,
     * so its list is always empty. With a filter it is `{ provider, voices }`.
     */
    async getAvailableVoices(provider?: string, language?: string | string[]) {
        const languages = this.resolvePresetLanguages(language);

        if (provider) {
            const ttsProvider = this.ttsProviderFactory.getProvider(provider);
            return {
                provider: ttsProvider.getProviderName(),
                voices: this.withPremiumFlag(await ttsProvider.getAvailableVoices(languages)),
            };
        }

        // Multi-provider: object shape keyed by lowercased provider name.
        const providers = this.ttsProviderFactory.getAllProviders();
        const entries = await Promise.all(
            providers.map(async (p) => {
                const key = p.getProviderName().toLowerCase();
                try {
                    const voices = this.withPremiumFlag(await p.getAvailableVoices(languages));
                    return [key, voices] as const;
                } catch (error) {
                    this.logger.error(
                        `Failed to fetch voices for provider ${p.getProviderName()}: ${(error as Error).message}`,
                    );
                    return [key, []] as const;
                }
            }),
        );

        return Object.fromEntries(entries);
    }

    /**
     * Content languages of one available-voices request: the requested codes
     * that have ready-made voices (order kept, duplicates dropped), or the
     * default content language when none is requested.
     */
    private resolvePresetLanguages(requested?: string | string[]): string[] {
        const raw = this.parseLanguageCodes(requested);
        if (raw.length === 0) {
            return [resolveContentLanguages(this.settings).defaultLanguage];
        }
        return raw.filter(hasPresetVoices);
    }

    private async listGoogleVoices(languages: string[]) {
        return this.withPremiumFlag(
            await this.ttsProviderFactory.getProvider(TTSProvider.GOOGLE).getAvailableVoices(languages),
        );
    }

    /**
     * Tag every voice with `isPremium` using the SAME rule the narration
     * quota uses (`isPremiumVoice`). Ready-made voices are free for everyone,
     * so this is false for the whole catalogue; the field stays because app
     * builds in the field read it.
     */
    private withPremiumFlag<T extends { id: string; provider: string }>(
        voices: T[],
    ): Array<T & { isPremium: boolean }> {
        return voices.map((v) => ({
            ...v,
            isPremium: isPremiumVoice({ provider: v.provider, voiceId: v.id }),
        }));
    }
}
