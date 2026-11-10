import { ApiProperty } from '@nestjs/swagger';

export enum VoiceProfileStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
}

export enum TrainingDuration {
  SHORT = 'SHORT',
  MEDIUM = 'MEDIUM',
  LONG = 'LONG',
}

export class VoiceProfileResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'TTS provider (GOOGLE, CARTESIA)' })
  provider: string;

  @ApiProperty({ enum: ['PRESET', 'CLONE'], description: 'PRESET = ready-made voice, CLONE = user recorded voice' })
  kind: 'PRESET' | 'CLONE';

  @ApiProperty({ required: false, nullable: true, description: 'ISO time of the KVKK clone consent (CLONE only)' })
  consentAt: string | null;

  @ApiProperty({ description: 'Provider-specific voice ID' })
  voiceId: string;

  @ApiProperty({ description: 'Locale as stored on the profile', default: 'tr-TR' })
  language: string;

  @ApiProperty({
    description:
      'Normalised content language code of the voice (tr, en), same vocabulary as story.language. ' +
      'A clone: the language the user chose to speak. A ready-made voice: the language it was added for.',
    example: 'tr',
  })
  contentLanguage: string;

  @ApiProperty({ enum: TrainingDuration, required: false })
  trainingDuration?: TrainingDuration | null;

  @ApiProperty({ enum: VoiceProfileStatus })
  status: VoiceProfileStatus;

  @ApiProperty({ required: false })
  voiceModelId?: string | null;

  @ApiProperty({ required: false })
  sampleAudioUrl?: string | null;

  @ApiProperty({ description: 'Premium (HD) voice, same rule as the narration quota' })
  isPremium: boolean;

  @ApiProperty({ required: false, description: 'User-facing failure reason (FAILED only)' })
  errorMessage?: string | null;

  @ApiProperty({ required: false, deprecated: true, description: 'Same as errorMessage' })
  errorReason?: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
