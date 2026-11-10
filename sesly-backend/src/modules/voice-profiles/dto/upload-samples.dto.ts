import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Text fields of the multipart POST /voice-profiles/:id/upload-samples body.
 * Files (`referenceAudio` required, `consentAudio` optional) are handled by
 * the FileFieldsInterceptor.
 *
 * `consentVersion` is validated in the service (not here) so a missing or
 * stale value produces the machine-readable 400 `CONSENT_REQUIRED`.
 */
export class UploadSamplesDto {
  @ApiPropertyOptional({
    description: 'Consent text version the user accepted (must equal clone-config consentVersion).',
    example: '2026-10-v2',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  consentVersion?: string;

  @ApiPropertyOptional({
    description:
      'Client-detected speech onset in milliseconds (integer >= 0, sent as a string). The server trims leading silence up to 250 ms before it.',
    example: '850',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,7}$/, { message: 'speechStartMs must be a non-negative integer' })
  speechStartMs?: string;
}
