import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEmail, IsOptional } from 'class-validator';

export class AppleTokenDto {
  @ApiProperty({
    example: 'eyJraWQiOiJlWGF1bm1MIiwiYWxnIjoiUlMyNTYifQ...',
    description: 'Apple ID token from Apple Sign-In SDK',
  })
  @IsString()
  identityToken: string;

  @ApiProperty({
    example: 'c6e3a2e0e1234567890abcdef',
    description: 'Apple user identifier',
    required: false,
  })
  @IsOptional()
  @IsString()
  user?: string;

  @ApiProperty({
    example: 'user@example.com',
    description: 'User email (only provided on first sign-in)',
    required: false,
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    example: 'John',
    description: 'User first name',
    required: false,
  })
  @IsOptional()
  @IsString()
  givenName?: string;

  @ApiProperty({
    example: 'Doe',
    description: 'User last name',
    required: false,
  })
  @IsOptional()
  @IsString()
  familyName?: string;
}
