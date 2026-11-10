import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

/**
 * POST /subscriptions/apple/validate. Replaces the deprecated verifyReceipt
 * body (receiptData): StoreKit 2 hands the app a signed transaction (JWS),
 * which the backend verifies against the Apple root certificates.
 */
export class AppleTransactionDto {
  @ApiProperty({
    description:
      'StoreKit 2 signed transaction (JWS, Transaction.jwsRepresentation; expo-iap: purchase.purchaseToken on iOS). Buy with appAccountToken = the Sesly user id.',
    example: 'eyJhbGciOiJFUzI1NiIsIng1YyI6...',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  signedTransaction: string;

  @ApiProperty({
    description: 'Product id the app believes it bought (informational; the signed transaction decides).',
    example: 'io.sesly.pro_monthly',
    required: false,
  })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiProperty({
    description: 'DEPRECATED and ignored. The purchase is always bound to the authenticated user.',
    required: false,
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  userId?: string;
}
