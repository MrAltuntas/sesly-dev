import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body of POST /auth/password-reset. */
export class PasswordResetRequestDto {
  @ApiProperty({ example: 'ayse@example.com', description: 'Address of the account' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail({}, { message: 'errors.validation.email' })
  @MaxLength(254, { message: 'errors.validation.email' })
  email: string;

  @ApiPropertyOptional({
    example: 'en',
    description:
      'UI language of the app ("tr" | "en", a region suffix is ignored). Wins over Accept-Language and the stored language; an unknown value is ignored.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(35)
  lang?: string;
}
