import { BadRequestException } from '@nestjs/common';
import {
  CC_BY_REQUIRED_FIELDS,
  RIGHTS_REQUIRED_ORIGINS,
  STORY_PUBLISH_REQUIREMENTS_CODE,
  assertStoryPublishable,
  missingPublishFields,
} from './story-publish.rules';

const fields = (story: Record<string, unknown>) => missingPublishFields(story).map((m) => m.field);

describe('story publish rule', () => {
  it('every story needs an origin and a text fidelity', () => {
    expect(fields({})).toEqual(['origin', 'textFidelity']);
    expect(fields({ origin: 'AI_GENERATED' })).toEqual(['textFidelity']);
    expect(fields({ textFidelity: 'RETOLD' })).toEqual(['origin']);
  });

  it.each(['AI_GENERATED', 'ORIGINAL_HUMAN'])(
    '%s needs nothing beyond origin and text fidelity',
    (origin) => {
      expect(fields({ origin, textFidelity: 'RETOLD' })).toEqual([]);
    },
  );

  it('the backfilled legacy rows (AI_GENERATED + RETOLD) are publishable', () => {
    expect(() => assertStoryPublishable({ origin: 'AI_GENERATED', textFidelity: 'RETOLD' })).not.toThrow();
  });

  it('rights data is required exactly for PUBLIC_DOMAIN, FOLK_ANONYMOUS and LICENSED', () => {
    expect([...RIGHTS_REQUIRED_ORIGINS]).toEqual(['PUBLIC_DOMAIN', 'FOLK_ANONYMOUS', 'LICENSED']);
  });

  it.each(['PUBLIC_DOMAIN', 'LICENSED'])(
    '%s needs a rights basis, a source and an author or collector',
    (origin) => {
      expect(fields({ origin, textFidelity: 'VERBATIM' })).toEqual(['rightsBasis', 'source', 'attribution']);
    },
  );

  it('FOLK_ANONYMOUS needs a rights basis and a source, but no name: the folk origin is the credit', () => {
    expect(fields({ origin: 'FOLK_ANONYMOUS', textFidelity: 'RETOLD' })).toEqual(['rightsBasis', 'source']);
    expect(
      fields({
        origin: 'FOLK_ANONYMOUS',
        textFidelity: 'RETOLD',
        rightsBasis: 'FOLK_NO_AUTHOR',
        sourceName: 'Anadolu masalları',
      }),
    ).toEqual([]);
  });

  it('the source is either a name or a link', () => {
    const base = { origin: 'PUBLIC_DOMAIN', textFidelity: 'VERBATIM', rightsBasis: 'AUTHOR_LIFE_PLUS_70', authorName: 'Ömer Seyfettin' };
    expect(fields({ ...base, sourceName: 'Bütün Eserleri' })).toEqual([]);
    expect(fields({ ...base, sourceUrl: 'https://example.org/eser' })).toEqual([]);
    expect(fields({ ...base, sourceName: '   ', sourceUrl: '' })).toEqual(['source']);
    expect(fields({ ...base, sourceName: null, sourceUrl: null })).toEqual(['source']);
  });

  it('the credit is either an author or a collector', () => {
    const base = { origin: 'LICENSED', textFidelity: 'VERBATIM', rightsBasis: 'LICENCE_GRANTED', sourceName: 'Yayınevi' };
    expect(fields({ ...base, authorName: 'Yazar' })).toEqual([]);
    expect(fields({ ...base, collectorName: 'Derleyen' })).toEqual([]);
    expect(fields({ ...base, authorName: ' ' })).toEqual(['attribution']);
  });

  it('assertStoryPublishable throws a coded 400 with a Turkish message that lists what is missing', () => {
    let error: any;
    try {
      assertStoryPublishable({ origin: 'PUBLIC_DOMAIN' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({
      code: STORY_PUBLISH_REQUIREMENTS_CODE,
      message:
        'Masal yayınlanamaz. Eksik alanlar: Metin sadakati, Hak dayanağı, Kaynak (kaynak adı ya da kaynak bağlantısı), Yazar ya da derleyen.',
      missing: ['textFidelity', 'rightsBasis', 'source', 'attribution'],
    });
    expect(STORY_PUBLISH_REQUIREMENTS_CODE).toBe('STORY_PUBLISH_REQUIREMENTS');
  });

  it('a draft with nothing filled in reports origin and text fidelity', () => {
    expect(() => assertStoryPublishable({})).toThrow('Masal yayınlanamaz. Eksik alanlar: Köken, Metin sadakati.');
  });

  describe('CC BY texts', () => {
    const ccBy = {
      origin: 'LICENSED',
      textFidelity: 'VERBATIM',
      rightsBasis: 'CC_BY',
      sourceUrl: 'https://www.africanstorybook.org/',
      authorName: 'Yazar',
    };

    it('need the attribution and the licence name', () => {
      expect([...CC_BY_REQUIRED_FIELDS]).toEqual(['attribution', 'licenseName']);
      expect(fields(ccBy)).toEqual(['ccAttribution', 'ccLicense']);
      expect(fields({ ...ccBy, attribution: 'Book Dash, CC BY 4.0' })).toEqual(['ccLicense']);
      expect(fields({ ...ccBy, licenseName: 'CC BY 4.0' })).toEqual(['ccAttribution']);
      expect(fields({ ...ccBy, attribution: '  ', licenseName: ' ' })).toEqual(['ccAttribution', 'ccLicense']);
      expect(fields({ ...ccBy, attribution: 'Book Dash', licenseName: 'CC BY 4.0' })).toEqual([]);
    });

    it('whatever the origin (a CC BY text marked AI_GENERATED is still refused)', () => {
      expect(fields({ origin: 'AI_GENERATED', textFidelity: 'RETOLD', rightsBasis: 'CC_BY' })).toEqual([
        'ccAttribution',
        'ccLicense',
      ]);
    });

    it('other rights bases do not need them', () => {
      expect(fields({ ...ccBy, rightsBasis: 'AUTHOR_LIFE_PLUS_70' })).toEqual([]);
    });

    it('the refusal names both fields in Turkish', () => {
      expect(() => assertStoryPublishable(ccBy)).toThrow(
        'Masal yayınlanamaz. Eksik alanlar: Atıf metni (CC BY lisansı için zorunlu), Lisans adı (CC BY lisansı için zorunlu).',
      );
    });
  });
});
