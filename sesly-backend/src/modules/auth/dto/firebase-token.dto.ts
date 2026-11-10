import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FirebaseTokenDto {
  @ApiProperty({
    description: 'Firebase ID token from Firebase Authentication',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjFlOWdkazcifQ...',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @ApiPropertyOptional({
    description: 'User first name (optional, used for email registration)',
    example: 'Süleyman',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({
    description: 'User last name (optional, used for email registration)',
    example: 'Karaca',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;
}
