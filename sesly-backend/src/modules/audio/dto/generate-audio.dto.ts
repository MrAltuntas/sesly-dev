import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class GenerateAudioDto {
    @ApiProperty({
        description: 'Text content to convert to audio',
        example: 'Bu bir test metnidir. Birden fazla cümle içerebilir.',
    })
    @IsString()
    @IsNotEmpty({ message: 'Text is required' })
    @MinLength(1, { message: 'Text cannot be empty' })
    text: string;

    @ApiProperty({
        description: 'Voice profile ID to use for generation',
        example: '550e8400-e29b-41d4-a716-446655440000',
    })
    @IsUUID()
    voiceProfileId: string;

    @ApiPropertyOptional({
        description: 'Optional title for the audio',
        example: 'My Audio Story',
    })
    @IsOptional()
    @IsString()
    title?: string;
}
