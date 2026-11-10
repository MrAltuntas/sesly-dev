import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  IsNotEmpty,
  IsEnum,
  IsInt,
  IsBoolean,
  IsOptional,
  Min,
  Max,
  IsIn,
  IsNumber,
  Matches,
  MaxLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import {
  AgeGroup,
  ContentWarning,
  LanguageLevel,
  StoryCategory,
  StoryOrigin,
  StoryRightsBasis,
  StoryStatus,
  StoryTextFidelity,
  TranslationMethod,
} from '../../../common/enums/prisma.enums';
import {
  CONTENT_LANGUAGE_CODES,
  CONTENT_LANGUAGE_MESSAGE,
} from '../../../common/constants/content-languages';
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '../../../common/utils/slug';
import { normaliseLanguageParam } from '../../stories/story-query.util';
import {
  OptionalContentWarnings,
  OptionalDate,
  OptionalEnum,
  OptionalText,
  OptionalUrl,
  OptionalYear,
  blankToNull,
} from './story-field.decorators';
import {
  SONIC3_EXTENDED_EMOTIONS,
  SONIC3_SPEED_MIN,
  SONIC3_SPEED_MAX,
} from '../../tts-providers/cartesia/cartesia-emotions.constants';

export class CreateStoryDto {
  @ApiProperty({ example: 'Küçük Prens', description: 'Story title' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'Bir zamanlar küçük bir prens varmış...', description: 'Story content (full text)' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    enum: AgeGroup,
    example: 'SIX_TO_TEN',
    required: false,
    description:
      'Age band. Sent: a MANUAL choice. Absent or blank on create: THREE_TO_SIX is stored as a placeholder and the model proposes one in the background (setting llm.autoAssessAgeGroup).',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsEnum(AgeGroup, { message: 'Geçersiz yaş grubu.' })
  ageGroup?: AgeGroup;

  @ApiProperty({ enum: StoryCategory, example: 'WORLD_CLASSICS' })
  @IsEnum(StoryCategory)
  category: StoryCategory;

  @ApiProperty({
    example: 'tr',
    description: 'Content language of the story (default tr). One story row per language.',
    required: false,
    enum: CONTENT_LANGUAGE_CODES,
  })
  @IsOptional()
  @Transform(({ value }) => normaliseLanguageParam(value))
  @IsIn(CONTENT_LANGUAGE_CODES as string[], { message: CONTENT_LANGUAGE_MESSAGE })
  language?: string;

  @ApiProperty({ example: 15, description: 'Estimated duration in minutes (auto-calculated from content if not provided)', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  estimatedDuration?: number;

  @ApiProperty({ example: 'https://...', description: 'Cover image URL', required: false })
  @IsString()
  @IsOptional()
  coverImageUrl?: string;

  @ApiProperty({
    required: false,
    description:
      'With an uploaded cover: write it to every story of the tale (all languages and parts). The panel sends true by default ("Bu kapağı tüm dillere ve bölümlere uygula").',
  })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'applyCoverToTale true ya da false olmalıdır.' })
  applyCoverToTale?: boolean;

  @ApiProperty({
    required: false,
    description:
      'Credit of the cover picture as JSON text: { illustrator, licenseName, licenseUrl, source, attribution } (a <slug>.credit.json with licence / licenceUrl is accepted as it is). With an uploaded cover it goes with that cover (blank or absent: none); without one it replaces the credit of the current cover. See src/modules/stories/cover-credit.ts.',
  })
  @IsOptional()
  @IsString({ message: 'Kapak resmi künyesi JSON metni olmalıdır.' })
  @MaxLength(5000, { message: 'Kapak resmi künyesi en fazla 5000 karakter olabilir.' })
  coverCredit?: string;

  @ApiProperty({ example: false, description: 'Is premium story (requires Pro subscription)', required: false })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  isPremium?: boolean;

  @ApiProperty({
    example: 'peaceful',
    description: 'Default Cartesia emotion applied when no per-segment override exists',
    required: false,
    enum: SONIC3_EXTENDED_EMOTIONS as unknown as string[],
  })
  @IsOptional()
  @IsString()
  @IsIn(SONIC3_EXTENDED_EMOTIONS as unknown as string[])
  defaultEmotion?: string;

  @ApiProperty({
    example: 0.85,
    description: `Default Cartesia speed multiplier (${SONIC3_SPEED_MIN}-${SONIC3_SPEED_MAX})`,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(SONIC3_SPEED_MIN)
  @Max(SONIC3_SPEED_MAX)
  defaultSpeed?: number;

  @ApiProperty({
    example: 'pron_dict_xyz',
    description: 'Cartesia pronunciation dictionary id applied to every segment',
    required: false,
  })
  @IsOptional()
  @IsString()
  cartesiaPronunciationDictId?: string;

  // ---------- Catalogue ----------

  @ApiProperty({
    required: false,
    example: 'kirmizi-baslikli-kiz',
    description: 'URL slug, unique per language. Generated from the title when absent.',
  })
  @IsOptional()
  @Transform(({ value }) => blankToNull(value))
  @Matches(SLUG_PATTERN, {
    message: 'Kısa ad yalnızca küçük harf, rakam ve tire içerebilir (ör. kirmizi-baslikli-kiz).',
  })
  @MaxLength(SLUG_MAX_LENGTH, { message: `Kısa ad en fazla ${SLUG_MAX_LENGTH} karakter olabilir.` })
  slug?: string | null;

  @ApiProperty({
    required: false,
    enum: StoryStatus,
    description:
      'DRAFT when absent on create. PUBLISHED requires origin and textFidelity, plus rights data for texts we did not write.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsEnum(StoryStatus, { message: 'Durum şu değerlerden biri olmalıdır: DRAFT, PUBLISHED, ARCHIVED.' })
  status?: StoryStatus;

  @OptionalText('Özet', 1000)
  summary?: string | null;

  // ---------- Public credit ----------

  @OptionalText('Özgün başlık', 300)
  originalTitle?: string | null;

  // Deliberately not limited to CONTENT_LANGUAGES: the original of a tale is
  // often in a language we do not narrate in (Danish, Persian, ...).
  @ApiProperty({ required: false, nullable: true, example: 'da', description: 'ISO 639 code of the language the tale was first written in' })
  @IsOptional()
  @Transform(({ value }) => {
    const cleaned = blankToNull(value);
    return typeof cleaned === 'string' ? cleaned.toLowerCase() : cleaned;
  })
  @Matches(/^[a-z]{2,3}$/, { message: 'Özgün dil iki ya da üç harfli bir dil kodu olmalıdır (ör. da, fa).' })
  originalLanguage?: string | null;

  @OptionalText('Yazar', 200)
  authorName?: string | null;

  @OptionalYear('Yazarın ölüm yılı')
  authorDeathYear?: number | null;

  @OptionalText('Derleyen', 200)
  collectorName?: string | null;

  @OptionalYear('Derleyenin ölüm yılı')
  collectorDeathYear?: number | null;

  @OptionalText('Çevirmen', 200)
  translatorName?: string | null;

  @OptionalYear('Çevirmenin ölüm yılı')
  translatorDeathYear?: number | null;

  @OptionalText('Uyarlayan', 200)
  adaptedBy?: string | null;

  @OptionalYear('İlk yayım yılı')
  firstPublishedYear?: number | null;

  @OptionalYear('Baskı yılı')
  editionYear?: number | null;

  @OptionalText('Kaynak adı', 300)
  sourceName?: string | null;

  @OptionalUrl('Kaynak bağlantısı')
  sourceUrl?: string | null;

  @OptionalText('Kaynak baskı', 500)
  sourceEdition?: string | null;

  @OptionalEnum('Köken', StoryOrigin)
  origin?: StoryOrigin | null;

  @OptionalEnum('Metin sadakati', StoryTextFidelity)
  textFidelity?: StoryTextFidelity | null;

  // ---------- Internal rights audit (never sent to the mobile API) ----------

  @OptionalDate('Kaynağın alındığı tarih')
  sourceRetrievedAt?: string | null;

  @OptionalEnum('Hak dayanağı', StoryRightsBasis)
  rightsBasis?: StoryRightsBasis | null;

  @OptionalText('Hak notu', 4000)
  rightsNote?: string | null;

  @OptionalUrl('Lisans bağlantısı')
  licenseUrl?: string | null;

  @OptionalText('Lisans', 200)
  licenseName?: string | null;

  @OptionalText('Atıf metni', 2000)
  attribution?: string | null;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Internal labels. An array, or (multipart form) one comma separated string. Never sent to the mobile API.',
  })
  @IsOptional()
  @Transform(({ value }) => {
    const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : value;
    return Array.isArray(items)
      ? [...new Set(items.map((t) => (typeof t === 'string' ? t.trim() : t)).filter((t) => t !== ''))]
      : items;
  })
  @IsArray({ message: 'Etiketler bir dizi olmalıdır.' })
  @ArrayMaxSize(20, { message: 'En fazla 20 etiket olabilir.' })
  @IsString({ each: true, message: 'Her etiket metin olmalıdır.' })
  @MaxLength(50, { each: true, message: 'Bir etiket en fazla 50 karakter olabilir.' })
  tags?: string[];

  @OptionalContentWarnings()
  contentWarnings?: ContentWarning[];

  @OptionalDate('Hakların doğrulandığı tarih')
  rightsVerifiedAt?: string | null;

  @OptionalText('Hakları doğrulayan', 200)
  rightsVerifiedBy?: string | null;

  // ---------- Translation ----------

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Id of the story this one was translated from. Also puts both stories in one translation group.',
  })
  @IsOptional()
  @Transform(({ value }) => blankToNull(value))
  @IsString({ message: 'Çevirinin kaynağı bir masal kimliği olmalıdır.' })
  @MaxLength(100, { message: 'Çevirinin kaynağı en fazla 100 karakter olabilir.' })
  translatedFromId?: string | null;

  @OptionalEnum('Çeviri yöntemi', TranslationMethod)
  translationMethod?: TranslationMethod | null;

  // ---------- Language level ----------

  @OptionalEnum('Dil seviyesi', LanguageLevel)
  languageLevel?: LanguageLevel | null;

  @OptionalText('Dil seviyesi notu', 2000)
  languageLevelNote?: string | null;
}
