import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { StoryLanguageFilterDto } from './story-query.dto';

export class StorySearchDto extends StoryLanguageFilterDto {
  @ApiProperty({
    description:
      'Text searched in the title and the content. Turkish-aware, accent- and case-insensitive: "kucuk" finds "Küçük", "YILDIZ" finds "Yıldız". LIKE wildcards (%, _) match literally.',
    example: 'bedtime story',
    minLength: 1,
  })
  @IsString()
  @IsNotEmpty({ message: 'Search query cannot be empty' })
  @MinLength(1, { message: 'Search query must be at least 1 character' })
  q: string;
}
