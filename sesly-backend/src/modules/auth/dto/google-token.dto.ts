import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class GoogleTokenDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjE4MmU...',
    description: 'Google ID token from Google Sign-In SDK',
  })
  @IsString()
  idToken: string;
}
