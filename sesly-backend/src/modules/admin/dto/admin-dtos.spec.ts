import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSegmentsDto } from './update-segments.dto';
import { GrantSubscriptionDto } from './grant-subscription.dto';
import { BroadcastDto } from './broadcast.dto';
import { RejectVoiceProfileDto } from './reject-voice-profile.dto';
import { CreateStoryDto } from './create-story.dto';
import { UpdateStoryDto } from './update-story.dto';
import { UserListQueryDto } from './user-list-query.dto';
import { UpdateSettingsDto } from './update-settings.dto';

/** Same options as the global ValidationPipe in main.ts. */
async function check<T extends object>(cls: new () => T, plain: Record<string, any>) {
  const instance = plainToInstance(cls, plain);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  const flat = (errs: any[], prefix = ''): string[] =>
    errs.flatMap((e) => [
      ...(e.constraints ? [`${prefix}${e.property}`] : []),
      ...flat(e.children ?? [], `${prefix}${e.property}.`),
    ]);
  return { instance, invalid: flat(errors) };
}

describe('Admin DTO validation (contract of the global ValidationPipe)', () => {
  describe('UpdateSegmentsDto (PATCH /admin/stories/:id/segments)', () => {
    it('accepts a valid list and coerces numeric strings', async () => {
      const { instance, invalid } = await check(UpdateSegmentsDto, {
        segments: [{ text: 'Bir varmis.', emotion: 'sad', speed: '0.8', volume: 1.5 }, { text: 'Bir yokmus.' }],
      });
      expect(invalid).toEqual([]);
      expect(instance.segments[0].speed).toBe(0.8);
    });

    it.each([
      ['empty list', { segments: [] }, 'segments'],
      ['missing list', {}, 'segments'],
      ['segment without text', { segments: [{ emotion: 'sad' }] }, 'segments.0.text'],
      ['unknown emotion', { segments: [{ text: 'a', emotion: 'furious-ish' }] }, 'segments.0.emotion'],
      ['speed too slow', { segments: [{ text: 'a', speed: 0.5 }] }, 'segments.0.speed'],
      ['speed too fast', { segments: [{ text: 'a', speed: 1.6 }] }, 'segments.0.speed'],
      ['volume too loud', { segments: [{ text: 'a', volume: 2.5 }] }, 'segments.0.volume'],
      ['volume too quiet', { segments: [{ text: 'a', volume: 0.4 }] }, 'segments.0.volume'],
      ['unknown segment field', { segments: [{ text: 'a', pitch: 2 }] }, 'segments.0.pitch'],
    ])('rejects %s', async (_l, plain, field) => {
      const { invalid } = await check(UpdateSegmentsDto, plain);
      expect(invalid).toContain(field);
    });
  });

  describe('GrantSubscriptionDto', () => {
    it('accepts PRO / CREATOR for 1..3650 days with a reason', async () => {
      expect((await check(GrantSubscriptionDto, { plan: 'PRO', durationDays: 1, reason: 'x' })).invalid).toEqual([]);
      expect((await check(GrantSubscriptionDto, { plan: 'CREATOR', durationDays: 3650, reason: 'x' })).invalid).toEqual(
        [],
      );
    });

    it.each([
      [{ plan: 'FREE', durationDays: 30, reason: 'x' }, 'plan'],
      [{ plan: 'PRO', durationDays: 0, reason: 'x' }, 'durationDays'],
      [{ plan: 'PRO', durationDays: 3651, reason: 'x' }, 'durationDays'],
      [{ plan: 'PRO', durationDays: 1.5, reason: 'x' }, 'durationDays'],
      [{ plan: 'PRO', durationDays: 30 }, 'reason'],
      [{ plan: 'PRO', durationDays: 30, reason: 'x', userId: 'other' }, 'userId'],
    ])('rejects %j', async (plain, field) => {
      expect((await check(GrantSubscriptionDto, plain)).invalid).toContain(field);
    });
  });

  describe('BroadcastDto', () => {
    it('accepts ALL / PREMIUM / FREE only', async () => {
      for (const segment of ['ALL', 'PREMIUM', 'FREE']) {
        expect((await check(BroadcastDto, { title: 't', body: 'b', segment })).invalid).toEqual([]);
      }
      expect((await check(BroadcastDto, { title: 't', body: 'b', segment: 'VIP' })).invalid).toContain('segment');
      expect((await check(BroadcastDto, { body: 'b', segment: 'ALL' })).invalid).toContain('title');
    });
  });

  describe('UpdateSettingsDto (PATCH /admin/settings)', () => {
    it('accepts a non-empty values map with arbitrary setting keys', async () => {
      const { instance, invalid } = await check(UpdateSettingsDto, {
        values: { 'llm.gemini.temperature': 0.3, 'tts.defaultProvider': 'google' },
      });
      expect(invalid).toEqual([]);
      expect(instance.values).toEqual({ 'llm.gemini.temperature': 0.3, 'tts.defaultProvider': 'google' });
    });

    it.each([[{}], [{ values: {} }], [{ values: 'x' }], [{ values: [1] }], [{ values: null }]])(
      'rejects %j',
      async (plain) => {
        expect((await check(UpdateSettingsDto, plain)).invalid).toContain('values');
      },
    );
  });

  describe('RejectVoiceProfileDto', () => {
    it('reason optional, max 500 chars', async () => {
      expect((await check(RejectVoiceProfileDto, {})).invalid).toEqual([]);
      expect((await check(RejectVoiceProfileDto, { reason: 'a'.repeat(500) })).invalid).toEqual([]);
      expect((await check(RejectVoiceProfileDto, { reason: 'a'.repeat(501) })).invalid).toContain('reason');
    });
  });

  describe('Create / Update story (multipart: everything arrives as strings)', () => {
    const base = { title: 'T', content: 'C', ageGroup: 'SIX_TO_TEN', category: 'BEDTIME' };

    it('coerces isPremium / estimatedDuration / defaultSpeed from strings', async () => {
      const { instance, invalid } = await check(CreateStoryDto, {
        ...base,
        isPremium: 'true',
        estimatedDuration: '12',
        defaultSpeed: '0.9',
      });
      expect(invalid).toEqual([]);
      expect(instance.isPremium).toBe(true);
      expect(instance.estimatedDuration).toBe(12);
      expect(instance.defaultSpeed).toBe(0.9);

      const off = await check(UpdateStoryDto, { isPremium: 'false' });
      expect(off.invalid).toEqual([]);
      expect(off.instance.isPremium).toBe(false);
    });

    it.each([
      [{ ...base, ageGroup: 'ADULT' }, 'ageGroup'],
      [{ ...base, category: 'HORROR' }, 'category'],
      [{ ...base, estimatedDuration: '0' }, 'estimatedDuration'],
      [{ ...base, isPremium: 'yes' }, 'isPremium'],
      [{ ...base, defaultSpeed: '2' }, 'defaultSpeed'],
      [{ ...base, defaultEmotion: 'furious-ish' }, 'defaultEmotion'],
      [{ ...base, title: '' }, 'title'],
      [{ ...base, content: '' }, 'content'],
    ])('create rejects %j', async (plain, field) => {
      expect((await check(CreateStoryDto, plain)).invalid).toContain(field);
    });

    it('update: every field optional, same bounds', async () => {
      expect((await check(UpdateStoryDto, {})).invalid).toEqual([]);
      expect((await check(UpdateStoryDto, { estimatedDuration: '0' })).invalid).toContain('estimatedDuration');
      expect((await check(UpdateStoryDto, { defaultSpeed: '0.1' })).invalid).toContain('defaultSpeed');
    });
  });

  describe('UserListQueryDto', () => {
    it('pagination bounds (limit <= 100) + optional search', async () => {
      expect((await check(UserListQueryDto, { page: '2', limit: '100', search: 'ali' })).invalid).toEqual([]);
      expect((await check(UserListQueryDto, { limit: '101' })).invalid).toContain('limit');
      expect((await check(UserListQueryDto, { page: '0' })).invalid).toContain('page');
    });
  });
});
