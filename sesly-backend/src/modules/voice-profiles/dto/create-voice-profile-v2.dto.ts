import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  MaxLength,
  IsOptional,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { TTSProvider } from '@common/enums/prisma.enums';
import { IsVoiceProfileLanguage } from './voice-language.validator';

export class CreateVoiceProfileV2Dto {
  @ApiProperty({
    example: "Emel's Voice",
    description: 'Name for the voice profile',
  })
  @IsString()
  @MaxLength(50)
  name: string;

  @ApiProperty({
    enum: TTSProvider,
    example: TTSProvider.GOOGLE,
    description:
      'GOOGLE = ready-made narrator voice (PRESET). CARTESIA = start a voice clone (CLONE); only voiceId "custom-cloning-pending" is accepted.',
    default: TTSProvider.GOOGLE,
  })
  @IsEnum(TTSProvider)
  provider: TTSProvider;

  @ApiProperty({
    example: 'tr-TR-Chirp3-HD-Achernar',
    description:
      'GOOGLE: a voice id from GET /voice-profiles/available-voices (required). CARTESIA: "custom-cloning-pending" (may be omitted).',
    required: false,
  })
  @ValidateIf((o) => o.provider === TTSProvider.GOOGLE || o.voiceId !== undefined)
  @IsString()
  @IsNotEmpty({
    message:
      'Google provider only supports ready-made voices. voiceId is required.',
  })
  voiceId?: string;

  @ApiProperty({
    example: 'tr',
    description:
      'CARTESIA (clone): the language the user will speak in the recording, one of supportedLanguages ' +
      'of GET /voice-profiles/clone-config ("tr", "en"; a locale such as "en-US" is accepted). Default tr. ' +
      'It selects the reading script and consent text, is stored on the profile and is sent to Cartesia ' +
      'as the clone language. GOOGLE (ready-made): optional and informational, the language always comes ' +
      'from the voice id.',
    required: false,
    default: 'tr',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  @IsVoiceProfileLanguage()
  language?: string;
}
