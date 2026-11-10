import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export const DEVICE_PLATFORMS = ['ios', 'android'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/** FCM registration tokens are ~160-250 chars; the cap only stops abuse. */
const TOKEN_MAX_LENGTH = 4096;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Body for POST /notifications/register. */
export class RegisterDeviceDto {
  @ApiProperty({
    example: 'dGVzdC10b2tlbi...:APA91bH...',
    description: 'FCM registration token from @react-native-firebase/messaging getToken()',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(TOKEN_MAX_LENGTH)
  token: string;

  @ApiProperty({ enum: DEVICE_PLATFORMS, example: 'android' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsIn(DEVICE_PLATFORMS)
  platform: DevicePlatform;
}

/** Body for POST /notifications/unregister (call on logout, before dropping the JWT). */
export class UnregisterDeviceDto {
  @ApiProperty({ description: 'The same FCM token that was registered' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(TOKEN_MAX_LENGTH)
  token: string;
}

export class RegisteredDeviceDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: DEVICE_PLATFORMS })
  platform: DevicePlatform;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ description: 'First registration of this token for this user' })
  registeredAt: Date;

  @ApiProperty({ description: 'Last (re-)registration' })
  updatedAt: Date;
}

export class RegisterDeviceResponseDto {
  @ApiProperty({ example: 'Device registered' })
  message: string;

  @ApiProperty({ type: RegisteredDeviceDto })
  device: RegisteredDeviceDto;
}

export class UnregisterDeviceResponseDto {
  @ApiProperty({ example: 'Device unregistered' })
  message: string;

  @ApiProperty({ description: 'Rows removed (0 when the token was unknown; still 200)' })
  removed: number;
}
