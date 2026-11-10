import { IsString, IsEnum, IsInt, IsOptional, IsBoolean, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export enum PromoCodeType {
    PERCENTAGE = 'PERCENTAGE',
    FIXED_AMOUNT = 'FIXED_AMOUNT',
    FREE_TRIAL = 'FREE_TRIAL',
}

export class CreatePromoCodeDto {
    @IsString()
    code: string;

    @IsEnum(PromoCodeType)
    type: PromoCodeType;

    @IsInt()
    value: number;

    @IsOptional()
    @IsInt()
    maxUses?: number;

    @IsOptional()
    @IsDateString()
    expiresAt?: Date;
}
