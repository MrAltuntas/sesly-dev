import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmptyObject, IsObject } from 'class-validator';

export class UpdateSettingsDto {
  @ApiProperty({
    description:
      'Map of setting key to new value. Keys and value ranges are validated against the settings registry (see GET /admin/settings).',
    example: { 'llm.gemini.temperature': 0.3, 'tts.defaultProvider': 'cartesia' },
    type: 'object',
    additionalProperties: true,
  })
  @IsObject({ message: 'values bir nesne olmalıdır.' })
  @IsNotEmptyObject({}, { message: 'Değiştirilecek en az bir ayar gönderilmelidir.' })
  values: Record<string, unknown>;
}
