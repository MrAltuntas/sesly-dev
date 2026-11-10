import { SLUG_FALLBACK, SLUG_MAX_LENGTH, SLUG_PATTERN, findFreeSlug, slugify } from './slug';

describe('slugify', () => {
  it('is Turkish-aware: every Turkish letter maps to its ASCII base', () => {
    expect(slugify('Kırmızı Başlıklı Kız')).toBe('kirmizi-baslikli-kiz');
    expect(slugify('Çğıİöşü ÇĞIİÖŞÜ')).toBe('cgiiosu-cgiiosu');
    expect(slugify('IŞIK ve İNCİ')).toBe('isik-ve-inci');
    expect(slugify('Keloğlan ve Saç Saça Hokkabaz')).toBe('keloglan-ve-sac-saca-hokkabaz');
  });

  it('handles the other catalogue languages written in Latin script', () => {
    expect(slugify('Rotkäppchen und der böse Wolf')).toBe('rotkappchen-und-der-bose-wolf');
    expect(slugify('Die Straße')).toBe('die-strasse');
    expect(slugify('Le Petit Chaperon rouge: édition française')).toBe(
      'le-petit-chaperon-rouge-edition-francaise',
    );
    expect(slugify('El niño y el pingüino')).toBe('el-nino-y-el-pinguino');
    expect(slugify('Œuvre, Ærø, Łódź, Þór, Đorđe, Søren')).toBe('oeuvre-aero-lodz-thor-dorde-soren');
  });

  it('collapses punctuation and whitespace, trims dashes, lower-cases', () => {
    expect(slugify('  Ay Neden   Büyür, Küçülür?!  ')).toBe('ay-neden-buyur-kuculur');
    expect(slugify('--Üç--Elma--')).toBe('uc-elma');
    expect(slugify('1001 Gece Masalları')).toBe('1001-gece-masallari');
  });

  it('always returns a slug that matches SLUG_PATTERN', () => {
    for (const title of ['Kırmızı Başlıklı Kız', 'A', 'a--b', 'Çok   Uzun_Başlık.v2', '!!!x!!!']) {
      expect(slugify(title)).toMatch(SLUG_PATTERN);
    }
  });

  it('a title without any Latin letter or digit gets the fallback', () => {
    expect(slugify('الأميرة النائمة')).toBe(SLUG_FALLBACK);
    expect(slugify('Красная Шапочка')).toBe(SLUG_FALLBACK);
    expect(slugify('')).toBe(SLUG_FALLBACK);
    expect(slugify('???')).toBe(SLUG_FALLBACK);
    expect(slugify(undefined as any)).toBe(SLUG_FALLBACK);
  });

  it('caps the length without leaving a trailing dash', () => {
    const long = slugify('kelime '.repeat(40));
    expect(long.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(long).toMatch(SLUG_PATTERN);
    expect(slugify('abcd efgh', 5)).toBe('abcd');
  });
});

describe('findFreeSlug', () => {
  it('returns the base when it is free', async () => {
    const isTaken = jest.fn().mockResolvedValue(false);
    await expect(findFreeSlug('masal', isTaken)).resolves.toBe('masal');
    expect(isTaken).toHaveBeenCalledTimes(1);
  });

  it('appends -2, -3 until a free one is found', async () => {
    const taken = new Set(['masal', 'masal-2', 'masal-3']);
    const isTaken = jest.fn(async (candidate: string) => taken.has(candidate));
    await expect(findFreeSlug('masal', isTaken)).resolves.toBe('masal-4');
    expect(isTaken.mock.calls.map((c) => c[0])).toEqual(['masal', 'masal-2', 'masal-3', 'masal-4']);
  });
});
