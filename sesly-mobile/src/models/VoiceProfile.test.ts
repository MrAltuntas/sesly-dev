import {
  canCreateCloneFromSlots,
  canCreatePresetFromSlots,
  bareVoiceName,
  isChirp3VoiceId,
  cloneCreationsLeft,
  cloneCreationsOf,
  isCloneCreationLimitReached,
  isCloneProfile,
  languageCodeOf,
  parseAvailableVoicesResponseFromJSON,
  parseVoiceProfileStatusResponseFromJSON,
  resolveVoiceContentLanguage,
  voiceMatchesLanguage,
  voiceProfileToJSON,
  parseVoiceProfileFromJSON,
  parseVoiceSlotInfoFromJSON,
} from './VoiceProfile';

describe('ready-made narrator catalogue (Chirp 3 HD only, free for everyone)', () => {
  it('reads the new backend shape: bare name, locale, content language, gender', () => {
    const parsed = parseAvailableVoicesResponseFromJSON([
      {
        provider: 'GOOGLE',
        voices: [
          {
            id: 'en-US-Chirp3-HD-Achernar',
            name: 'Achernar',
            language: 'English',
            languageCode: 'en-US',
            contentLanguage: 'en',
            gender: 'female',
            description: 'Kadın anlatıcı sesi',
          },
        ],
      },
    ]);
    expect(parsed.google).toEqual([
      {
        id: 'en-US-Chirp3-HD-Achernar',
        voiceId: 'en-US-Chirp3-HD-Achernar',
        name: 'Achernar',
        language: 'English',
        languageCode: 'en-US',
        contentLanguage: 'en',
        gender: 'female',
        description: 'Kadın anlatıcı sesi',
        provider: 'GOOGLE',
      },
    ]);
    // No premium flag, lock or tier on a ready-made voice.
    expect(parsed.google[0]).not.toHaveProperty('isPremium');
  });

  it("works against today's response: strips Chirp3 and (HD) and hides other voice families", () => {
    const parsed = parseAvailableVoicesResponseFromJSON({
      google: [
        { id: 'tr-TR-Standard-A', name: 'Standard A', isPremium: false },
        { id: 'tr-TR-Wavenet-B', name: 'Wavenet B', isPremium: true },
        { id: 'tr-TR-Chirp3-HD-Achernar', name: 'Chirp3 Achernar (HD)', isPremium: true, gender: 'FEMALE' },
        { id: 'tr-TR-Chirp3-HD-Puck', name: 'Chirp3-HD-Puck', languageCode: 'tr-TR' },
        { id: 'tr-TR-Neural2-C', name: 'Neural2 C' },
      ],
      cartesia: [{ id: 'c-1', name: 'Deniz', isPremium: true }],
    });
    expect(parsed.google.map(v => v.name)).toEqual(['Achernar', 'Puck']);
    expect(parsed.google.every(v => isChirp3VoiceId(v.voiceId))).toBe(true);
    // The locale and the content language come from the voice id when the
    // backend sends neither; the gender is lower-cased.
    expect(parsed.google[0]).toMatchObject({
      languageCode: 'tr-TR',
      contentLanguage: 'tr',
      gender: 'female',
    });
    expect(parsed.cartesia[0].isPremium).toBe(true);
  });

  it('bareVoiceName: the id wins, else the name is cleaned, and a typed name survives', () => {
    expect(bareVoiceName('anything', 'de-DE-Chirp3-HD-Zephyr')).toBe('Zephyr');
    expect(bareVoiceName('Chirp3 Achernar (HD)')).toBe('Achernar');
    expect(bareVoiceName('Achernar (HD)', 'unknown-id')).toBe('Achernar');
    expect(bareVoiceName('tr-TR-Chirp3-HD-Kore')).toBe('Kore');
    expect(bareVoiceName('Chirp 3 HD Leda')).toBe('Leda');
    expect(bareVoiceName('Achernar')).toBe('Achernar');
    // Nothing left after cleaning: the name as it was.
    expect(bareVoiceName('Chirp3 (HD)')).toBe('Chirp3 (HD)');
    expect(isChirp3VoiceId('tr-TR-chirp3-hd-Kore')).toBe(true);
    expect(isChirp3VoiceId('tr-TR-Wavenet-A')).toBe(false);
    expect(isChirp3VoiceId(null)).toBe(false);
  });
});

describe('parseVoiceSlotInfoFromJSON', () => {
  it('uses backend canCreate as the authority', () => {
    const info = parseVoiceSlotInfoFromJSON({
      plan: 'FREE',
      totalSlots: 2,
      usedSlots: 1,
      availableSlots: 1,
      extraSlots: 0,
      canCreate: false,
    });
    expect(info.canCreate).toBe(false);
    expect(info.used).toBe(1);
    expect(info.limit).toBe(2);
    expect(info.message).toBeNull();
  });

  it('keeps an optional backend message', () => {
    const info = parseVoiceSlotInfoFromJSON({
      totalSlots: 2,
      usedSlots: 2,
      availableSlots: 0,
      canCreate: false,
      message: 'Ses hakkınız doldu.',
    });
    expect(info.message).toBe('Ses hakkınız doldu.');
  });
});

describe('parseVoiceSlotInfoFromJSON preset / clone split', () => {
  const split = {
    plan: 'FREE',
    totalSlots: 4,
    usedSlots: 2,
    availableSlots: 2,
    canCreate: true,
    preset: { used: 1, limit: 3, canCreate: true },
    clone: {
      used: 1,
      limit: 1,
      canCreate: false,
      monthlyCreated: 1,
      monthlyLimit: 2,
    },
  };

  it('parses per-kind slots', () => {
    const info = parseVoiceSlotInfoFromJSON(split);
    expect(info.preset).toEqual({ used: 1, limit: 3, canCreate: true, message: null });
    expect(info.clone).toEqual({
      used: 1,
      limit: 1,
      canCreate: false,
      message: null,
      monthlyCreated: 1,
      monthlyLimit: 2,
      creations: null,
    });
    expect(canCreateCloneFromSlots(info)).toBe(false);
    expect(canCreatePresetFromSlots(info)).toBe(true);
  });

  it('blocks clones when a legacy monthly cap is used up even if a slot is free', () => {
    const info = parseVoiceSlotInfoFromJSON({
      ...split,
      clone: { used: 0, limit: 3, canCreate: true, monthlyCreated: 2, monthlyLimit: 2 },
    });
    expect(isCloneCreationLimitReached(info.clone)).toBe(true);
    expect(cloneCreationsOf(info.clone)).toEqual({
      used: 2,
      limit: 2,
      period: 'month',
      renewsAt: null,
      canCreate: false,
    });
    expect(canCreateCloneFromSlots(info)).toBe(false);
  });

  it('ignores an unknown creation allowance', () => {
    const info = parseVoiceSlotInfoFromJSON({
      ...split,
      clone: { used: 0, limit: 3, canCreate: true },
    });
    expect(info.clone?.monthlyLimit).toBeNull();
    expect(info.clone?.creations).toBeNull();
    expect(cloneCreationsOf(info.clone)).toBeNull();
    expect(isCloneCreationLimitReached(info.clone)).toBe(false);
    expect(cloneCreationsLeft(info.clone)).toBeNull();
    expect(canCreateCloneFromSlots(info)).toBe(true);
  });

  describe('clone.creations (backend buildVoiceSlotInfo)', () => {
    /** The exact FREE output: one own voice for life, used. */
    const freeUsed = {
      ...split,
      clone: {
        used: 1,
        limit: 1,
        canCreate: false,
        monthlyCreated: 1,
        monthlyLimit: 1,
        creations: { used: 1, limit: 1, period: 'lifetime', renewsAt: null, canCreate: false },
      },
    };

    it('reads the lifetime allowance of the free plan', () => {
      const info = parseVoiceSlotInfoFromJSON(freeUsed);
      expect(info.clone?.creations).toEqual({
        used: 1,
        limit: 1,
        period: 'lifetime',
        renewsAt: null,
        canCreate: false,
      });
      expect(isCloneCreationLimitReached(info.clone)).toBe(true);
      expect(cloneCreationsLeft(info.clone)).toBe(0);
      expect(canCreateCloneFromSlots(info)).toBe(false);
    });

    it('reads a monthly allowance with its renewal date and wins over the legacy fields', () => {
      const info = parseVoiceSlotInfoFromJSON({
        ...split,
        plan: 'MINI',
        clone: {
          used: 0,
          limit: 1,
          canCreate: true,
          // Legacy numbers that disagree: `creations` is authoritative.
          monthlyCreated: 9,
          monthlyLimit: 9,
          creations: {
            used: 1,
            limit: 2,
            period: 'month',
            renewsAt: '2026-11-01T00:00:00.000Z',
            canCreate: true,
          },
        },
      });
      const creations = info.clone?.creations;
      expect(creations?.period).toBe('month');
      expect(creations?.renewsAt?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
      expect(isCloneCreationLimitReached(info.clone)).toBe(false);
      expect(cloneCreationsLeft(info.clone)).toBe(1);
      expect(canCreateCloneFromSlots(info)).toBe(true);
    });

    it('a -1 limit is unlimited (null) and never used up', () => {
      const info = parseVoiceSlotInfoFromJSON({
        ...split,
        clone: {
          used: 0,
          limit: 5,
          canCreate: true,
          creations: { used: 40, limit: -1, period: 'month', renewsAt: null, canCreate: true },
        },
      });
      expect(info.clone?.creations?.limit).toBeNull();
      expect(isCloneCreationLimitReached(info.clone)).toBe(false);
      expect(cloneCreationsLeft(info.clone)).toBeNull();
    });

    it('trusts canCreate false from the backend even below the limit', () => {
      const info = parseVoiceSlotInfoFromJSON({
        ...split,
        clone: {
          used: 0,
          limit: 1,
          canCreate: false,
          creations: { used: 0, limit: 1, period: 'month', renewsAt: null, canCreate: false },
        },
      });
      expect(isCloneCreationLimitReached(info.clone)).toBe(true);
    });

    it('derives canCreate when omitted and drops bad shapes', () => {
      const derived = parseVoiceSlotInfoFromJSON({
        ...split,
        clone: { ...freeUsed.clone, creations: { used: '2', limit: '2', period: 'MONTH' } },
      });
      expect(derived.clone?.creations).toEqual({
        used: 2,
        limit: 2,
        period: 'month',
        renewsAt: null,
        canCreate: false,
      });

      for (const creations of [null, 'lifetime', [], { limit: 1 }, { used: 'many', limit: 1 }]) {
        const info = parseVoiceSlotInfoFromJSON({ ...split, clone: { ...split.clone, creations } });
        expect(info.clone?.creations).toBeNull();
      }
      const oddPeriod = parseVoiceSlotInfoFromJSON({
        ...split,
        clone: { ...split.clone, creations: { used: 0, limit: 1, period: 'weekly', renewsAt: 'soon' } },
      });
      expect(oddPeriod.clone?.creations?.period).toBeNull();
      expect(oddPeriod.clone?.creations?.renewsAt).toBeNull();
    });
  });

  it('derives per-kind canCreate from used/limit when omitted', () => {
    const info = parseVoiceSlotInfoFromJSON({
      ...split,
      preset: { used: '3', limit: '3' },
    });
    expect(info.preset?.used).toBe(3);
    expect(info.preset?.canCreate).toBe(false);
  });

  it('falls back to the shared canCreate on older backends', () => {
    const legacy = parseVoiceSlotInfoFromJSON({
      totalSlots: 2,
      usedSlots: 2,
      availableSlots: 0,
      canCreate: false,
    });
    expect(legacy.preset).toBeNull();
    expect(legacy.clone).toBeNull();
    expect(canCreateCloneFromSlots(legacy)).toBe(false);
    expect(canCreatePresetFromSlots(legacy)).toBe(false);
    // Unknown slots let the attempt through; the backend still enforces.
    expect(canCreateCloneFromSlots(null)).toBe(true);
    expect(canCreatePresetFromSlots(null)).toBe(true);
  });
});

describe('voice profile kind', () => {
  const base = {
    id: 'p1',
    name: 'Annem',
    status: 'READY',
    provider: 'CARTESIA',
    voiceId: 'v1',
    language: 'tr-TR',
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.000Z',
  };

  it('parses kind and consentAt', () => {
    const profile = parseVoiceProfileFromJSON({
      ...base,
      kind: 'clone',
      consentAt: '2026-09-27T09:59:00.000Z',
    });
    expect(profile.kind).toBe('CLONE');
    expect(profile.consentAt?.toISOString()).toBe('2026-09-27T09:59:00.000Z');
    expect(isCloneProfile(profile)).toBe(true);
  });

  it('trusts kind over provider', () => {
    // A ready-made Cartesia voice is a PRESET, not the user's clone.
    const preset = parseVoiceProfileFromJSON({ ...base, kind: 'PRESET' });
    expect(isCloneProfile(preset)).toBe(false);
  });

  it('falls back to provider when kind is missing or unknown', () => {
    const legacyClone = parseVoiceProfileFromJSON({ ...base, consentAt: 'not a date' });
    expect(legacyClone.kind).toBeNull();
    expect(legacyClone.consentAt).toBeNull();
    expect(isCloneProfile(legacyClone)).toBe(true);

    const google = parseVoiceProfileFromJSON({ ...base, provider: 'GOOGLE', kind: 'OTHER' });
    expect(google.kind).toBeNull();
    expect(isCloneProfile(google)).toBe(false);
  });
});

describe('voice language (contentLanguage)', () => {
  const base = {
    id: 'p1',
    name: 'Annem',
    status: 'READY',
    provider: 'CARTESIA',
    kind: 'CLONE',
    voiceId: 'cartesia-voice-1',
    language: 'tr-TR',
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.000Z',
  };

  it('reads the content language the backend sends', () => {
    const profile = parseVoiceProfileFromJSON({ ...base, language: 'en-US', contentLanguage: 'EN' });
    expect(profile.contentLanguage).toBe('en');
    expect(voiceProfileToJSON(profile).contentLanguage).toBe('en');
    // A locale in the field is reduced to its language.
    expect(parseVoiceProfileFromJSON({ ...base, contentLanguage: 'en-US' }).contentLanguage).toBe('en');
  });

  it('treats a voice without a content language as Turkish and never throws', () => {
    expect(parseVoiceProfileFromJSON(base).contentLanguage).toBe('tr');
    expect(parseVoiceProfileFromJSON({ ...base, contentLanguage: null }).contentLanguage).toBe('tr');
    expect(parseVoiceProfileFromJSON({ ...base, contentLanguage: 42 }).contentLanguage).toBe('tr');
    expect(parseVoiceProfileFromJSON({ ...base, contentLanguage: '  ' }).contentLanguage).toBe('tr');
    // A clone of an older backend: its stored language says nothing reliable.
    expect(parseVoiceProfileFromJSON({ ...base, language: 'en-US' }).contentLanguage).toBe('tr');
    expect(resolveVoiceContentLanguage({})).toBe('tr');
  });

  it('reads the language of a ready-made voice from its voice id on an older backend', () => {
    const preset = { ...base, provider: 'GOOGLE', kind: 'PRESET' };
    expect(
      parseVoiceProfileFromJSON({ ...preset, voiceId: 'en-US-Chirp3-HD-Achernar', language: 'tr-TR' })
        .contentLanguage,
    ).toBe('en');
    // No locale in the id: the stored language, then Turkish.
    expect(parseVoiceProfileFromJSON({ ...preset, voiceId: 'Achernar', language: 'de-DE' }).contentLanguage).toBe('de');
    expect(parseVoiceProfileFromJSON({ ...preset, voiceId: 'Achernar', language: undefined }).contentLanguage).toBe('tr');
    // The served field still wins.
    expect(
      parseVoiceProfileFromJSON({ ...preset, voiceId: 'en-US-Chirp3-HD-Achernar', contentLanguage: 'tr' })
        .contentLanguage,
    ).toBe('tr');
  });

  it('compares a voice with the language of a story', () => {
    expect(voiceMatchesLanguage({ contentLanguage: 'tr' }, 'tr')).toBe(true);
    expect(voiceMatchesLanguage({ contentLanguage: 'tr' }, 'TR-tr')).toBe(true);
    expect(voiceMatchesLanguage({ contentLanguage: 'tr' }, 'en')).toBe(false);
    // An unknown story language rules nobody out; an unknown voice is Turkish.
    expect(voiceMatchesLanguage({ contentLanguage: 'en' }, null)).toBe(true);
    expect(voiceMatchesLanguage({}, 'tr')).toBe(true);
    expect(voiceMatchesLanguage({ contentLanguage: null }, 'en')).toBe(false);
  });

  it('reduces a locale to its language code', () => {
    expect(languageCodeOf('tr-TR')).toBe('tr');
    expect(languageCodeOf(' EN_us ')).toBe('en');
    expect(languageCodeOf('de')).toBe('de');
    expect(languageCodeOf('')).toBe('');
    expect(languageCodeOf('custom-cloning-pending')).toBe('');
    expect(languageCodeOf(null)).toBe('');
    expect(languageCodeOf(7)).toBe('');
  });

  it('reads the voice language of a status response, null when it is absent', () => {
    const status = { id: 'p1', status: 'PROCESSING' };
    expect(parseVoiceProfileStatusResponseFromJSON(status).contentLanguage).toBeNull();
    expect(
      parseVoiceProfileStatusResponseFromJSON({ ...status, contentLanguage: 'en' }).contentLanguage,
    ).toBe('en');
  });
});
