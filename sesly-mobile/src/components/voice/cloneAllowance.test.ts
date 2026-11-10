import i18n from '../../i18n';
import {
  parseVoiceSlotInfoFromJSON,
  type CloneCreationInfo,
  type VoiceSlotInfo,
} from '../../models/VoiceProfile';
import { backendVoiceSlots } from '../../test-utils/contract-fixtures';
import type { UsageBucket, UsageSummary } from '../../models/Quota';
import {
  cloneDeleteMessage,
  creationsUsedUp,
  freeVoiceSlots,
  isFinalCloneDelete,
  newVoiceBlock,
  ownVoiceLimits,
} from './cloneAllowance';
import { buildCatalogueRows } from './narratorRows';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

function slots(clone: Partial<NonNullable<VoiceSlotInfo['clone']>> | null, canCreate = false): VoiceSlotInfo {
  return {
    used: 1,
    limit: 1,
    available: 0,
    plan: 'FREE',
    canCreate,
    message: null,
    preset: null,
    clone: clone
      ? {
          used: 1,
          limit: 1,
          canCreate: false,
          message: null,
          monthlyCreated: null,
          monthlyLimit: null,
          creations: null,
          ...clone,
        }
      : null,
  };
}

const creations = (value: Partial<CloneCreationInfo>): CloneCreationInfo => ({
  used: 0,
  limit: 1,
  period: 'lifetime',
  renewsAt: null,
  canCreate: true,
  ...value,
});

/** The free plan after its one own voice was recorded (backend buildVoiceSlotInfo). */
const FREE_USED = slots({
  used: 1,
  limit: 1,
  canCreate: false,
  monthlyCreated: 1,
  monthlyLimit: 1,
  creations: creations({ used: 1, limit: 1, canCreate: false }),
});

/** GET /usage with these own-voice numbers. */
function usage(
  plan: 'free' | 'mini' | 'premium',
  slotsHeld: number,
  slotLimit: number,
  bucket: Partial<UsageBucket>,
): UsageSummary {
  return {
    planId: plan,
    buckets: {
      presetNarrations: { limit: 20, used: 0, remaining: 20, period: 'month', renewsAt: null },
      cloneNarrations: { limit: 1, used: 0, remaining: 1, period: 'lifetime', renewsAt: null },
      cloneCreations: { limit: 1, used: 0, remaining: 1, period: 'lifetime', renewsAt: null, ...bucket },
    },
    voiceSlots: { preset: { used: 0, limit: 3 }, clone: { used: slotsHeld, limit: slotLimit } },
    features: { backgroundPlayback: plan !== 'free', premiumStories: plan !== 'free' },
  };
}

describe('ownVoiceLimits', () => {
  it('reads GET /usage first: the slots and the creations of the period', () => {
    const renews = new Date(2026, 10, 1);
    const limits = ownVoiceLimits({
      usage: usage('premium', 1, 3, { used: 2, limit: 5, period: 'month', renewsAt: renews }),
      slotInfo: FREE_USED,
      planId: 'premium',
      held: null,
    });
    expect(limits).toEqual({
      slots: { used: 1, limit: 3 },
      creations: { used: 2, limit: 5, period: 'month', renewsAt: renews },
    });
  });

  it('the voices on screen decide the slots in use once the list is loaded', () => {
    const limits = ownVoiceLimits({
      usage: usage('premium', 3, 3, { used: 3, limit: 5, period: 'month' }),
      slotInfo: null,
      planId: 'premium',
      held: 2,
    });
    expect(limits.slots).toEqual({ used: 2, limit: 3 });
    expect(freeVoiceSlots(limits)).toBe(1);
  });

  it('without GET /usage: the slots answer, then the plan constants (Free 1 / 1, Mini 1 / 2, Premium 3 / 5)', () => {
    const fromSlots = ownVoiceLimits({
      usage: null,
      slotInfo: slots({ used: 1, limit: 1, creations: creations({ used: 1, limit: 2, period: null }) }),
      planId: 'mini',
      held: null,
    });
    // A slots answer without a period takes the plan's.
    expect(fromSlots).toEqual({
      slots: { used: 1, limit: 1 },
      creations: { used: 1, limit: 2, period: 'month', renewsAt: null },
    });
    for (const [plan, slotLimit, amount, period] of [
      ['free', 1, 1, 'lifetime'],
      ['mini', 1, 2, 'month'],
      ['premium', 3, 5, 'month'],
    ] as const) {
      expect(ownVoiceLimits({ usage: null, slotInfo: null, planId: plan, held: 0 })).toEqual({
        slots: { used: 0, limit: slotLimit },
        creations: { used: null, limit: amount, period, renewsAt: null },
      });
    }
  });

  it('knows a used-up allowance only when both numbers are known', () => {
    expect(creationsUsedUp({ used: 2, limit: 2, period: 'month', renewsAt: null })).toBe(true);
    expect(creationsUsedUp({ used: 1, limit: 2, period: 'month', renewsAt: null })).toBe(false);
    expect(creationsUsedUp({ used: null, limit: 2, period: 'month', renewsAt: null })).toBe(false);
    expect(creationsUsedUp({ used: 9, limit: null, period: 'month', renewsAt: null })).toBe(false);
  });
});

describe('newVoiceBlock', () => {
  beforeAll(() => i18n.changeLanguage('tr'));
  const open = { cloningOpen: true, canCreate: true, offersPlans: true };
  const limits = (slotsUsed: number, slotLimit: number, used: number | null, limit: number | null, period: 'month' | 'lifetime' = 'month', renewsAt: Date | null = null) => ({
    slots: { used: slotsUsed, limit: slotLimit },
    creations: { used, limit, period, renewsAt },
  });

  it('nothing in the way: null', () => {
    expect(newVoiceBlock(limits(1, 3, 2, 5), open, t)).toBeNull();
  });

  it('closed cloning comes first', () => {
    expect(newVoiceBlock(limits(0, 1, 0, 1), { ...open, cloningOpen: false }, t)).toEqual({
      reason: 'closed',
      message: 'Kendi sesinle masal kısa bir süre kullanılamıyor. Biraz sonra tekrar dene.',
    });
  });

  it('every slot taken: plans while a bigger plan helps, a delete when none does', () => {
    expect(newVoiceBlock(limits(1, 1, 1, 2), open, t)).toEqual({ reason: 'slots', message: 'Ses yuvaların dolu.' });
    expect(newVoiceBlock(limits(3, 3, 3, 5), { ...open, offersPlans: false }, t)).toEqual({
      reason: 'slots',
      message: 'Ses yuvaların dolu. Yeni bir ses için önce birini sil.',
    });
  });

  it('the new voices used up: the month with its renewal, the free plan for good', () => {
    expect(newVoiceBlock(limits(0, 1, 2, 2, 'month', new Date(2026, 10, 1)), open, t)?.message).toBe(
      "Bu ayki yeni ses hakkın bitti. 1 Kasım'da yenilenir.",
    );
    expect(newVoiceBlock(limits(0, 1, 2, 2, 'month'), open, t)?.message).toBe('Bu ayki yeni ses hakkın bitti.');
    expect(newVoiceBlock(limits(0, 1, 1, 1, 'lifetime'), open, t)).toEqual({
      reason: 'creations',
      message: 'Yeni ses hakkını kullandın, bu hak yenilenmez.',
    });
  });

  it('a refusal of the slots answer for another reason: the plain line', () => {
    expect(newVoiceBlock(limits(0, 1, null, 1), { ...open, canCreate: false }, t)).toEqual({
      reason: 'other',
      message: 'Şu an yeni bir kendi ses kaydedemezsin.',
    });
  });
});

describe('cloneDeleteMessage: a delete never gives a new voice back', () => {
  beforeAll(() => i18n.changeLanguage('tr'));
  const BASE = 'Kaydın ve ondan oluşturulan ses kalıcı olarak silinir. Geri alınamaz.';
  const NO_REFUND = 'Silmek, kullandığın yeni ses hakkını geri vermez.';

  it('the only lifetime voice of the free plan: no refund and no way back', () => {
    expect(cloneDeleteMessage(FREE_USED, t)).toBe(
      `${BASE} ${NO_REFUND} Hiç yeni ses hakkın kalmadı, silersen yeniden kaydedemezsin.`,
    );
    expect(isFinalCloneDelete(FREE_USED)).toBe(true);
  });

  it('names what is left of a monthly allowance', () => {
    const mini = slots({ creations: creations({ used: 1, limit: 2, period: 'month' }) });
    expect(cloneDeleteMessage(mini, t)).toBe(`${BASE} ${NO_REFUND} Bu ay 1 yeni ses hakkın kaldı.`);
    expect(isFinalCloneDelete(mini)).toBe(false);
  });

  it('a monthly allowance used up is final until it renews, with its renewal day', () => {
    const used = slots({
      creations: creations({ used: 2, limit: 2, period: 'month', renewsAt: new Date(2026, 10, 1), canCreate: false }),
    });
    expect(cloneDeleteMessage(used, t)).toBe(
      `${BASE} ${NO_REFUND} Bu ayki hakkın bitti, silersen yeni ay başlayana kadar yeniden kaydedemezsin. 1 Kasım'da yenilenir.`,
    );
    expect(isFinalCloneDelete(used)).toBe(true);
  });

  it('GET /usage wins over the slots answer', () => {
    const renews = new Date(2026, 10, 1);
    const bucket = usage('premium', 1, 3, { used: 2, limit: 5, period: 'month', renewsAt: renews }).buckets.cloneCreations;
    expect(cloneDeleteMessage(FREE_USED, t, bucket)).toBe(`${BASE} ${NO_REFUND} Bu ay 3 yeni ses hakkın kaldı.`);
    const usedUp = { ...bucket, used: 5, remaining: 0 };
    expect(cloneDeleteMessage(null, t, usedUp)).toContain('Bu ayki hakkın bitti');
  });

  it('a lifetime allowance with more left says it does not renew', () => {
    expect(cloneDeleteMessage(slots({ creations: creations({ used: 1, limit: 2 }) }), t)).toBe(
      `${BASE} ${NO_REFUND} 1 yeni ses hakkın kaldı ve bu hak yenilenmez.`,
    );
  });

  it('unlimited or unknown allowances: the no-refund sentence alone, nothing about a month', () => {
    const unlimited = slots({ creations: creations({ limit: null, period: 'month' }) });
    expect(cloneDeleteMessage(unlimited, t)).toBe(`${BASE} ${NO_REFUND}`);
    expect(isFinalCloneDelete(unlimited)).toBe(false);
    expect(cloneDeleteMessage(null, t)).toBe(t('voices:dialogs.delete.messageNoRefund'));
    expect(cloneDeleteMessage(slots(null), t)).toBe(t('voices:dialogs.delete.messageNoRefund'));
    expect(cloneDeleteMessage(slots({}), t)).toBe(t('voices:dialogs.delete.messageNoRefund'));
    expect(cloneDeleteMessage(null, t)).not.toMatch(/ayki|yeni ay/);
    expect(isFinalCloneDelete(null)).toBe(false);
  });

  it('every clone delete message but the PENDING one says that a delete gives nothing back', () => {
    for (const key of [
      'messageNoRefund',
      'messageLeft',
      'messageLeftLifetime',
      'messageFinal',
      'messageFinalMonth',
    ]) {
      expect(t(`voices:dialogs.delete.${key}`, { left: 1 })).toContain(NO_REFUND);
    }
    expect(t('voices:dialogs.delete.messagePlain')).not.toContain(NO_REFUND);
  });

  it('English: the warnings are English and keep their period', async () => {
    await i18n.changeLanguage('en');
    try {
      expect(cloneDeleteMessage(FREE_USED, t)).toBe(
        'Your recording and the voice made from it are deleted for good. This cannot be undone. Deleting does not give back the new voice you used. You have no new voices left, so after a delete you cannot record again.',
      );
      const month = slots({
        creations: creations({ used: 2, limit: 2, period: 'month', renewsAt: new Date(2026, 10, 1) }),
      });
      expect(cloneDeleteMessage(month, t)).toContain('new month');
      expect(cloneDeleteMessage(month, t)).toContain('November');
    } finally {
      await i18n.changeLanguage('tr');
    }
  });
});

describe('buildCatalogueRows', () => {
  const voice = (name: string) => ({
    id: name,
    voiceId: `tr-TR-Chirp3-HD-${name}`,
    name,
    language: 'tr-TR',
    languageCode: 'tr-TR',
    contentLanguage: 'tr',
    gender: 'male',
    description: '',
    provider: 'GOOGLE',
  });
  const profile = (name: string, contentLanguage = 'tr') =>
    ({
      id: `vp-${name}`,
      name,
      kind: 'PRESET',
      voiceId: `tr-TR-Chirp3-HD-${name}`,
      contentLanguage,
      language: 'tr-TR',
    }) as never;

  it('keeps the catalogue order, marks added ones in place and appends the unlisted ones', () => {
    const rows = buildCatalogueRows([profile('Cem'), profile('Zeki'), profile('Emma', 'en')], [voice('Ada'), voice('Cem')], 'tr');
    expect(rows.map(row => [row.kind, row.key])).toEqual([
      ['catalogue', 'preset:tr-TR-Chirp3-HD-Ada'],
      ['added', 'vp-Cem'],
      ['added', 'vp-Zeki'],
    ]);
  });
});
