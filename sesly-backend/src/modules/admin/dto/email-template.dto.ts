import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Text fields of an email template. Only shape and an outer length bound
 * here; the real rules (required fields, per field length, placeholders,
 * text rules) are in validateEmailTemplateFields so save, preview and test
 * report the same Turkish problems.
 */
const OUTER_MAX = 10000;

export class EmailTemplateDraftDto {
  @ApiPropertyOptional({ example: "Sesly'ye hoş geldin" })
  @IsOptional()
  @IsString({ message: 'subject metin olmalıdır.' })
  @MaxLength(OUTER_MAX)
  subject?: string;

  @ApiPropertyOptional({ example: 'Masallar artık sevdiğin sesle anlatılıyor.' })
  @IsOptional()
  @IsString({ message: 'preheader metin olmalıdır.' })
  @MaxLength(OUTER_MAX)
  preheader?: string;

  @ApiPropertyOptional({ example: "Sesly'ye hoş geldin" })
  @IsOptional()
  @IsString({ message: 'heading metin olmalıdır.' })
  @MaxLength(OUTER_MAX)
  heading?: string;

  @ApiPropertyOptional({ example: 'Merhaba {{name}},\n\nAramıza katıldığın için çok mutluyuz.' })
  @IsOptional()
  @IsString({ message: 'body metin olmalıdır.' })
  @MaxLength(OUTER_MAX)
  body?: string;

  @ApiPropertyOptional({ example: "Sesly'yi keşfet" })
  @IsOptional()
  @IsString({ message: 'buttonLabel metin olmalıdır.' })
  @MaxLength(OUTER_MAX)
  buttonLabel?: string;

  @ApiPropertyOptional({ example: '' })
  @IsOptional()
  @IsString({ message: 'note metin olmalıdır.' })
  @MaxLength(OUTER_MAX)
  note?: string;

  @ApiPropertyOptional({ example: 'Bu e-postayı yeni bir Sesly hesabı açtığın için aldın.' })
  @IsOptional()
  @IsString({ message: 'footer metin olmalıdır.' })
  @MaxLength(OUTER_MAX)
  footer?: string;
}

/** PUT body: the whole text. A missing optional field is saved empty. */
export class SaveEmailTemplateDto extends EmailTemplateDraftDto {}

/** Test email: recipient plus optional unsaved edits. */
export class SendTestEmailDto extends EmailTemplateDraftDto {
  @ApiProperty({ example: 'ben@sesly.io', description: 'Recipient of the test email' })
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi girilmelidir.' })
  @MaxLength(254)
  to: string;
}
