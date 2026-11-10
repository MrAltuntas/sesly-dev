import { ApiProperty } from '@nestjs/swagger';
import { resolveEffectivePlan, PlanSource } from '../../../common/utils/subscription-plan';

/**
 * Explicit, allow-listed user shape for GET/PATCH /users/me.
 *
 * Built field by field (never `Object.assign(this, user)`), so secrets on
 * the User row (passwordHash,
 * providerId, ...) and on the Subscription row (Apple/Google ids)
 * can never leak, even if the row gains new columns later.
 */
export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ required: false, nullable: true })
  firstName: string | null;

  @ApiProperty({ required: false, nullable: true })
  lastName: string | null;

  @ApiProperty()
  provider: string;

  @ApiProperty()
  emailVerified: boolean;

  @ApiProperty({
    nullable: true,
    description: 'Readable avatar URL (presigned when stored in our bucket)',
  })
  avatarUrl: string | null;

  @ApiProperty({ nullable: true, description: 'Same value as avatarUrl' })
  profileImageUrl: string | null;

  @ApiProperty({ description: 'Effective plan (expired grants resolve to FREE)' })
  subscriptionTier: string;

  @ApiProperty({ required: false, nullable: true })
  subscriptionExpiresAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromUser(
    user: {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
      provider: string;
      emailVerified: boolean;
      createdAt: Date;
      updatedAt: Date;
      subscription?: (PlanSource & { currentPeriodEnd?: Date | null }) | null;
    },
    readableAvatarUrl: string | null,
  ): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.firstName = user.firstName ?? null;
    dto.lastName = user.lastName ?? null;
    dto.provider = user.provider;
    dto.emailVerified = user.emailVerified;
    dto.avatarUrl = readableAvatarUrl;
    dto.profileImageUrl = readableAvatarUrl;
    dto.subscriptionTier = resolveEffectivePlan(user.subscription ?? null);
    dto.subscriptionExpiresAt = user.subscription?.currentPeriodEnd ?? null;
    dto.createdAt = user.createdAt;
    dto.updatedAt = user.updatedAt;
    return dto;
  }
}
