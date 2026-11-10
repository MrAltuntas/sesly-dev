import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

/**
 * POST /subscriptions/google/validate. The token is re-read from the Play
 * Developer API; the other fields are only cross-checked.
 */
export class GooglePurchaseDto {
  @ApiProperty({
    description: 'Purchase token from Google Play Billing (buy with obfuscatedAccountId = the Sesly user id)',
    example: 'gkjhfgkjhfgkjhfg.AO-J1Ox...',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  purchaseToken: string;

  @ApiProperty({
    description: 'Product id (subscription id) the app bought: mini_monthly, pro_monthly or pro_yearly. Unknown ids are rejected (PRODUCT_UNKNOWN).',
    example: 'pro_monthly',
    required: false,
  })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiProperty({
    description: 'Package name of the app; when sent it must be GOOGLE_PACKAGE_NAME (default com.sesly).',
    example: 'com.sesly',
    required: false,
  })
  @IsOptional()
  @IsString()
  packageName?: string;

  @ApiProperty({
    description: 'DEPRECATED and ignored. The purchase is always bound to the authenticated user.',
    required: false,
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  userId?: string;
}
