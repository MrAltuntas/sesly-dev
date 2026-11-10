import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CONTENT_WARNINGS,
  CONTENT_WARNING_LABELS,
  isContentWarning,
  normalizeContentWarnings,
} from './content-warnings';
import { CreateStoryDto } from '../../modules/admin/dto/create-story.dto';
import { ContentWarning } from '../enums/prisma.enums';

describe('content warnings', () => {
  it('the enum and its Turkish labels', () => {
    expect(CONTENT_WARNINGS).toEqual(['SCARY', 'VIOLENCE', 'DEATH', 'SAD_ENDING', 'BAD_EXAMPLE', 'OLD_LANGUAGE', 'LONELINESS']);
    expect(CONTENT_WARNINGS).toEqual(Object.values(ContentWarning));
    expect(Object.keys(CONTENT_WARNING_LABELS)).toEqual([...CONTENT_WARNINGS]);
    expect(CONTENT_WARNING_LABELS).toEqual({
      SCARY: 'Korkutucu sahne',
      VIOLENCE: 'Şiddet',
      DEATH: 'Ölüm',
      SAD_ENDING: 'Üzücü son',
      BAD_EXAMPLE: 'Kötü davranış örneği',
      OLD_LANGUAGE: 'Eski dil / ağır anlatım',
      LONELINESS: 'Yalnızlık / ayrılık',
    });
    // UI text rules: no em dash, ellipsis character or arrows.
    expect(Object.values(CONTENT_WARNING_LABELS).join(' ')).not.toMatch(/[—…→]/);
  });

  it('normalize keeps known values once, in enum order', () => {
    expect(normalizeContentWarnings(['DEATH', 'SCARY', 'DEATH', 'zombi', 7, null])).toEqual(['SCARY', 'DEATH']);
    expect(normalizeContentWarnings(null)).toEqual([]);
    expect(normalizeContentWarnings('SCARY')).toEqual([]);
    expect(isContentWarning('SAD_ENDING')).toBe(true);
    expect(isContentWarning('sad_ending')).toBe(false);
    // The old Turkish keys are gone (migration 20261022120000 converted them).
    expect(isContentWarning('korkutucu')).toBe(false);
    expect(normalizeContentWarnings(['uzucu-son', 'olum'])).toEqual([]);
  });

  describe('admin DTO field', () => {
    const errorsFor = async (contentWarnings: unknown) => {
      const dto = plainToInstance(CreateStoryDto, { contentWarnings });
      const errors = await validate(dto, { skipMissingProperties: true });
      return { dto, errors: errors.filter((e) => e.property === 'contentWarnings') };
    };

    it('takes an array or a comma separated form value, any case; a blank clears it', async () => {
      await expect(errorsFor(['SCARY', 'DEATH', 'SCARY'])).resolves.toMatchObject({
        dto: { contentWarnings: ['SCARY', 'DEATH'] },
        errors: [],
      });
      await expect(errorsFor(' scary, Sad_Ending ')).resolves.toMatchObject({
        dto: { contentWarnings: ['SCARY', 'SAD_ENDING'] },
        errors: [],
      });
      await expect(errorsFor('')).resolves.toMatchObject({ dto: { contentWarnings: [] }, errors: [] });
    });

    it('refuses a value outside the enum (an old Turkish key too) with a Turkish message', async () => {
      const { errors } = await errorsFor(['SCARY', 'zombi']);
      expect(errors).toHaveLength(1);
      expect(Object.values(errors[0].constraints ?? {}).join(' ')).toContain('İçerik uyarısı');
      expect((await errorsFor(42)).errors).toHaveLength(1);
      expect((await errorsFor(['korkutucu'])).errors).toHaveLength(1);
      expect(Object.values(errors[0].constraints ?? {}).join(' ')).toContain('SCARY, VIOLENCE');
    });
  });
});
