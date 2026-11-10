import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Body of POST /admin/stories/:id/link-translation. */
export class LinkTranslationDto {
  @ApiProperty({ description: 'Id of the story that tells the same tale in another language' })
  @IsString({ message: 'Bağlanacak masalın kimliği gönderilmelidir.' })
  @IsNotEmpty({ message: 'Bağlanacak masalın kimliği gönderilmelidir.' })
  @MaxLength(100, { message: 'Masal kimliği en fazla 100 karakter olabilir.' })
  otherStoryId: string;
}
