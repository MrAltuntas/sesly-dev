import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AssessAgeGroupDto, TranslationRequestsQueryDto } from './story-llm.dto';
import { CreateStoryDto } from './create-story.dto';
import { UpdateStoryDto } from './update-story.dto';
import { CONTENT_LANGUAGE_MESSAGE } from '../../../common/constants/content-languages';

/** Same options as the global ValidationPipe in main.ts. */
async function check<T extends object>(cls: new () => T, plain: Record<string, any>) {
  const instance = plainToInstance(cls, plain);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return {
    instance,
    invalid: errors.map((e) => e.property),
    messages: errors.flatMap((e) => Object.values(e.constraints ?? {})),
  };
}

describe('age group and translation request DTOs', () => {
  describe('AssessAgeGroupDto (POST /admin/stories/:id/age-group/assess)', () => {
    it('an empty body is valid; force accepts booleans and their string forms', async () => {
      expect((await check(AssessAgeGroupDto, {})).invalid).toEqual([]);
      expect((await check(AssessAgeGroupDto, { force: true })).instance.force).toBe(true);
      expect((await check(AssessAgeGroupDto, { force: 'false' })).instance.force).toBe(false);
    });

    it('rejects anything else with a Turkish message, and unknown fields', async () => {
      expect((await check(AssessAgeGroupDto, { force: 'yes' })).messages).toEqual([
        'force true ya da false olmalıdır.',
      ]);
      expect((await check(AssessAgeGroupDto, { ageGroup: 'TEN_PLUS' })).invalid).toEqual(['ageGroup']);
    });
  });

  describe('TranslationRequestsQueryDto (GET /admin/stories/translation-requests)', () => {
    it('no parameter is valid; status and language are normalised', async () => {
      const none = await check(TranslationRequestsQueryDto, {});
      expect(none.invalid).toEqual([]);
      expect(none.instance.status).toBeUndefined();

      const both = await check(TranslationRequestsQueryDto, {
        status: ' FULFILLED ',
        language: 'EN-us',
        page: '2',
        limit: '50',
      });
      expect(both.invalid).toEqual([]);
      expect(both.instance).toMatchObject({ status: 'fulfilled', language: 'en', page: 2, limit: 50 });

      expect((await check(TranslationRequestsQueryDto, { status: '' })).invalid).toEqual([]);
    });

    it('rejects an unknown status, an unknown language and a limit above 100', async () => {
      expect((await check(TranslationRequestsQueryDto, { status: 'open' })).messages).toEqual([
        'Durum pending ya da fulfilled olmalıdır.',
      ]);
      expect((await check(TranslationRequestsQueryDto, { status: 5 })).invalid).toEqual(['status']);
      expect((await check(TranslationRequestsQueryDto, { language: 'da' })).messages).toEqual([
        CONTENT_LANGUAGE_MESSAGE,
      ]);
      expect((await check(TranslationRequestsQueryDto, { limit: '200' })).invalid).toEqual(['limit']);
    });
  });

  describe('ageGroup on the story form', () => {
    const base = { title: 'T', content: 'C', category: 'BEDTIME' };

    it('create: absent or blank means "let the model decide"', async () => {
      const absent = await check(CreateStoryDto, base);
      expect(absent.invalid).toEqual([]);
      expect(absent.instance.ageGroup).toBeUndefined();

      // A multipart form sends an empty string for an unselected option.
      const blank = await check(CreateStoryDto, { ...base, ageGroup: '  ' });
      expect(blank.invalid).toEqual([]);
      expect(blank.instance.ageGroup).toBeUndefined();
    });

    it('create and update: a value must be one of the four bands', async () => {
      expect((await check(CreateStoryDto, { ...base, ageGroup: 'SIX_TO_TEN' })).invalid).toEqual([]);
      expect((await check(CreateStoryDto, { ...base, ageGroup: 'ADULT' })).messages).toEqual([
        'Geçersiz yaş grubu.',
      ]);
      expect((await check(UpdateStoryDto, { ageGroup: 'ADULT' })).invalid).toEqual(['ageGroup']);
      expect((await check(UpdateStoryDto, { ageGroup: 'TEN_PLUS' })).invalid).toEqual([]);
    });

    it('the source of the age group is never accepted from a request body', async () => {
      expect((await check(UpdateStoryDto, { ageGroupSource: 'AI' })).invalid).toEqual(['ageGroupSource']);
      expect((await check(CreateStoryDto, { ...base, ageGroupNote: 'x' })).invalid).toEqual(['ageGroupNote']);
    });
  });
});
