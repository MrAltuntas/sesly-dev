/**
 * narrationConfirm: the words of the confirmation before a new narration
 * (the cost from GET /usage or the plan, the story and voice lines, the
 * language note), in both languages.
 */

import i18n from '../../i18n';
import { EMPTY_STORY_CREDIT, DEFAULT_STORY_EXTRAS } from '../../models/Story';
import type { UsageBucket, UsageSummary } from '../../models/Quota';
import { AgeGroup, StoryCategory } from '../../types/enums';
import { narrationConfirmModel, narrationCost, type ConfirmStory } from './narrationConfirm';

function bucket(limit: number | null, used: number, period: 'month' | 'lifetime' = 'month'): UsageBucket {
  return {
    limit,
    used,
    remaining: limit === null ? null : Math.max(0, limit - used),
    period,
    renewsAt: period === 'month' ? new Date(2026, 10, 1) : null,
  };
}

function usage(preset: UsageBucket, clone: UsageBucket): UsageSummary {
  return {
    planId: 'free',
    buckets: { presetNarrations: preset, cloneNarrations: clone, cloneCreations: bucket(1, 0, 'lifetime') },
    voiceSlots: { preset: { used: 0, limit: 3 }, clone: { used: 0, limit: 1 } },
    features: { backgroundPlayback: false, premiumStories: false },
  };
}

const STORY: ConfirmStory = {
  ...DEFAULT_STORY_EXTRAS,
  id: 's-1',
  title: 'Keloğlan',
  ageGroup: AgeGroup.THREE_TO_SIX,
  category: StoryCategory.TURKISH_CLASSICS,
  estimatedDuration: 8,
  coverImageUrl: null,
  credit: EMPTY_STORY_CREDIT,
};

afterEach(async () => {
  await i18n.changeLanguage('tr');
});

describe('narrationCost', () => {
  it('names the bucket it draws from, as used of the limit, monthly or in total', () => {
    expect(narrationCost('preset', usage(bucket(20, 4), bucket(1, 0, 'lifetime')), 'free')).toEqual({
      state: 'uses',
      line: 'Bu seslendirme hazır anlatıcı hakkından 1 kullanır (bu ay 4/20).',
    });
    expect(narrationCost('clone', usage(bucket(20, 4), bucket(1, 0, 'lifetime')), 'free')).toEqual({
      state: 'uses',
      line: 'Kendi sesinle masal hakkından 1 kullanır (toplam 0/1).',
    });
    expect(narrationCost('clone', usage(bucket(null, 0), bucket(20, 2)), 'premium')).toEqual({
      state: 'uses',
      line: 'Kendi sesinle masal hakkından 1 kullanır (bu ay 2/20).',
    });
  });

  it('says nothing for an unlimited bucket, from GET /usage or from the plan', () => {
    expect(narrationCost('preset', usage(bucket(null, 7), bucket(5, 0)), 'mini')).toEqual({ state: 'free' });
    expect(narrationCost('preset', null, 'mini')).toEqual({ state: 'free' });
    expect(narrationCost('preset', null, 'premium')).toEqual({ state: 'free' });
  });

  it('without GET /usage the plan names the bucket without counts', () => {
    expect(narrationCost('preset', null, 'free')).toEqual({
      state: 'uses',
      line: 'Bu seslendirme hazır anlatıcı hakkından 1 kullanır.',
    });
    expect(narrationCost('clone', null, 'mini')).toEqual({
      state: 'uses',
      line: 'Kendi sesinle masal hakkından 1 kullanır.',
    });
  });

  it('a used-up bucket is the block the backend would answer with', () => {
    const cost = narrationCost('preset', usage(bucket(20, 20), bucket(1, 0, 'lifetime')), 'free');
    expect(cost.state).toBe('usedUp');
    expect(cost.state === 'usedUp' && cost.block).toMatchObject({ code: 'QUOTA_PRESET_MONTHLY', limit: 20 });
    const clone = narrationCost('clone', usage(bucket(20, 0), bucket(1, 1, 'lifetime')), 'free');
    expect(clone.state === 'usedUp' && clone.block).toMatchObject({ code: 'QUOTA_CLONE_LIFETIME' });
  });

  it('is translated', async () => {
    await i18n.changeLanguage('en');
    expect(narrationCost('preset', usage(bucket(20, 4), bucket(1, 0, 'lifetime')), 'free')).toEqual({
      state: 'uses',
      line: 'This narration uses 1 of your ready-made narrator stories (this month 4/20).',
    });
  });
});

describe('narrationConfirmModel', () => {
  it('a voice the screen knows only by name reads as a ready-made narrator, with nothing to warn about', () => {
    const model = narrationConfirmModel({
      story: STORY,
      voice: { id: 'vp-1', name: 'Zeynep' },
      mode: 'new',
      usage: null,
      planId: 'mini',
    });
    expect(model).toMatchObject({
      title: 'Bu masal seslendirilsin mi?',
      replaceLine: null,
      storyTitle: 'Keloğlan',
      partLabel: null,
      storyLine: 'Türkçe, yaklaşık 8 dk, 3-6 yaş',
      warnings: [],
      machineTranslation: false,
      voiceName: 'Zeynep',
      ownVoice: false,
      voiceLine: 'Hazır anlatıcı',
      languageNote: null,
      cost: { state: 'free' },
    });
  });

  it('a regenerate of a part, with warnings and an AI translation', () => {
    const model = narrationConfirmModel({
      story: {
        ...STORY,
        language: 'en',
        contentWarnings: ['VIOLENCE', 'OLD_LANGUAGE'],
        part: { number: 1, total: 2 },
        translation: { isMachineTranslation: true, fromLanguage: 'tr', original: null },
      },
      voice: { id: 'vp-2', name: 'Annem', kind: 'CLONE', contentLanguage: 'tr' },
      mode: 'regenerate',
      usage: null,
      planId: 'free',
    });
    expect(model.title).toBe('Baştan hazırlansın mı?');
    expect(model.replaceLine).toBe('Yenisi eskisinin yerini alır.');
    expect(model.partLabel).toBe('Bölüm 1 / 2');
    expect(model.storyLine).toBe('English, yaklaşık 8 dk, 3-6 yaş');
    expect(model.warnings.map(w => w.label)).toEqual(['Şiddet', 'Eski dil / ağır anlatım']);
    expect(model.machineTranslation).toBe(true);
    expect(model.voiceLine).toBe('Kendi sesin, Türkçe');
    expect(model.languageNote).toEqual({
      tone: 'warning',
      title: 'Dil uyuşmuyor',
      text: 'Bu ses Türkçe, masal İngilizce. Aksan kaymaları olabilir ama dinlenebilir.',
    });
  });
});
