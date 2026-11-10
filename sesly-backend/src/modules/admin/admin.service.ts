import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePromoCodeDto } from './dto/create-promocode.dto';
import { GrantAccessDto, AdminSubscriptionPlan } from './dto/grant-access.dto';
import { BroadcastDto, BroadcastSegment } from './dto/broadcast.dto';
import { MaintenanceService } from './services/maintenance.service';
import { StorageService } from '../storage/storage.service';
import { PaginationHelper } from '../../common/utils/pagination.helper';
import { VoiceProfileStatus } from '../../common/enums/prisma.enums';
import { PAID_PLANS, paidPeriodActiveWhere } from '../../common/utils/subscription-plan';
import { recomputeSubscription } from '../subscriptions/store/entitlement';
import { serverText } from '../../common/i18n/server-text';
import { resolveUserUiLanguage } from '../../common/i18n/user-ui-language';

/**
 * i18n key of the user-facing default when an admin rejects without a reason;
 * stored on the profile in the owner's UI language (a reason the admin types
 * is stored as typed).
 */
export const DEFAULT_REJECT_REASON_KEY = 'messages.voiceFailure.rejected';

/** The default reason in Turkish (the text an owner without a stored language gets). */
export const DEFAULT_REJECT_REASON = serverText(DEFAULT_REJECT_REASON_KEY, 'tr');

@Injectable()
export class AdminService {
    private readonly logger = new Logger(AdminService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly notificationsService: NotificationsService,
        private readonly maintenanceService: MaintenanceService,
        private readonly storageService: StorageService,
    ) { }

    // Finance Methods
    async createPromoCode(dto: CreatePromoCodeDto) {
        const existing = await this.prisma.promoCode.findUnique({
            where: { code: dto.code },
        });

        if (existing) {
            throw new BadRequestException('Promo code already exists');
        }

        return this.prisma.promoCode.create({
            data: {
                ...dto,
            },
        });
    }

    async getPromoCodes() {
        return this.prisma.promoCode.findMany({
            orderBy: { createdAt: 'desc' },
        });
    }

    async grantAccess(dto: GrantAccessDto) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.userEmail },
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        // Calculate end date
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + dto.durationDays);

        const planMap = {
            [AdminSubscriptionPlan.PRO]: 'PRO',
            [AdminSubscriptionPlan.CREATOR]: 'CREATOR',
            [AdminSubscriptionPlan.MINI]: 'MINI',
        } as const;

        // Grant columns only (a store write can never shorten them), then
        // the row columns are re-derived from grant + store purchases.
        await this.prisma.subscription.upsert({
            where: { userId: user.id },
            create: {
                userId: user.id,
                plan: 'FREE',
                grantPlan: planMap[dto.plan],
                grantEndsAt: endDate,
            },
            update: {
                grantPlan: planMap[dto.plan],
                grantEndsAt: endDate,
            },
        });
        return recomputeSubscription(this.prisma, user.id);
    }

    // Moderation Methods

    /**
     * GET /admin/moderation/voice-profiles?status&page&limit
     * All statuses when `status` is omitted, newest activity first. Only a
     * safe user subset is selected (never passwordHash / tokens).
     */
    async listVoiceProfilesForModeration(
        page: number,
        limit: number,
        status?: VoiceProfileStatus,
    ) {
        const { page: p, limit: l } = PaginationHelper.normalizePaginationParams(page, limit);
        const where = status ? { status } : {};

        const [rows, total] = await Promise.all([
            this.prisma.voiceProfile.findMany({
                where,
                orderBy: { updatedAt: 'desc' },
                skip: PaginationHelper.calculateOffset(p, l),
                take: l,
                select: {
                    id: true,
                    name: true,
                    provider: true,
                    status: true,
                    errorReason: true,
                    sampleAudioUrl: true,
                    createdAt: true,
                    updatedAt: true,
                    user: {
                        select: { id: true, email: true, firstName: true, lastName: true },
                    },
                },
            }),
            this.prisma.voiceProfile.count({ where }),
        ]);

        const data = await Promise.all(
            rows.map(async (r) => ({
                id: r.id,
                name: r.name,
                provider: r.provider,
                status: r.status,
                errorMessage: r.errorReason ?? null,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt,
                user: r.user,
                sampleUrl: await this.storageService.getReadUrl(r.sampleAudioUrl),
            })),
        );

        return PaginationHelper.createPaginatedResponse(data, total, p, l);
    }

    /**
     * POST /admin/moderation/:id/reject { reason? }: marks the profile FAILED
     * with the (user-facing) reason and sends the Turkish VOICE_FAILED
     * notification + voice_status socket event.
     */
    async rejectVoiceProfile(id: string, reason?: string) {
        const profile = await this.prisma.voiceProfile.findUnique({
            where: { id },
            select: { id: true, userId: true, name: true },
        });

        if (!profile) {
            throw new NotFoundException('Voice profile not found');
        }

        const errorMessage =
            reason?.trim() ||
            serverText(
                DEFAULT_REJECT_REASON_KEY,
                await resolveUserUiLanguage(this.prisma, profile.userId),
            );

        const updated = await this.prisma.voiceProfile.update({
            where: { id },
            data: { status: 'FAILED', errorReason: errorMessage },
            select: {
                id: true,
                name: true,
                provider: true,
                status: true,
                errorReason: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        await this.notificationsService.notifyVoiceFailed(
            profile.userId,
            profile.name,
            profile.id,
            errorMessage,
        );

        return {
            id: updated.id,
            name: updated.name,
            provider: updated.provider,
            status: updated.status,
            errorMessage: updated.errorReason,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
        };
    }

    // Ops Methods
    async broadcast(dto: BroadcastDto) {
        // Segments follow the EFFECTIVE plan (resolveEffectivePlan), not the
        // stored plan column:
        //  PREMIUM = ACTIVE MINI/PRO/CREATOR whose paid period has not run out.
        //  FREE    = no row, FREE plan, EXPIRED (lapsed store subscriber or
        //            admin-deactivated) or a paid row whose period ran out
        //            (ended admin grant).
        // PAST_DUE / CANCELLED rows still inside their period are in neither.
        const now = new Date();
        const paidPlans = PAID_PLANS;
        const segmentWhere: Prisma.UserWhereInput =
            dto.segment === BroadcastSegment.PREMIUM
                ? {
                    subscription: {
                        is: {
                            plan: { in: paidPlans },
                            status: 'ACTIVE',
                            AND: [paidPeriodActiveWhere(now)],
                        },
                    },
                }
                : dto.segment === BroadcastSegment.FREE
                    ? {
                        OR: [
                            { subscription: { is: null } }, // No subscription record implies Free
                            { subscription: { is: { plan: 'FREE' } } },
                            { subscription: { is: { status: 'EXPIRED' } } },
                            {
                                subscription: {
                                    is: { plan: { in: paidPlans }, NOT: paidPeriodActiveWhere(now) },
                                },
                            },
                        ],
                    }
                    : {};

        const users = await this.prisma.user.findMany({
            where: segmentWhere,
            select: { id: true },
        });

        this.logger.log(`Broadcasting to ${users.length} users (Segment: ${dto.segment})`);

        // Every user in the segment gets the in-app notification. The push only
        // goes to promoNotifications opt-ins (Law 6563 / IYS: commercial push
        // needs prior consent; a missing preferences row counts as opted out).
        // Runs inline so the admin sees the real outcome; move to a Bull job if
        // the user base outgrows a single request.
        // -> { count, pushSent (>=1 push delivered), pushDelivered (users reached) }
        return this.notificationsService.sendBroadcast(
            users.map((u) => u.id),
            { title: dto.title, body: dto.body },
        );
    }

    async setMaintenanceMode(enabled: boolean) {
        const value = await this.maintenanceService.setEnabled(enabled);
        this.logger.log(`Maintenance mode set to: ${value}`);
        return { enabled: value };
    }

    async getMaintenanceMode() {
        const enabled = await this.maintenanceService.getEnabled();
        return { enabled };
    }
}
