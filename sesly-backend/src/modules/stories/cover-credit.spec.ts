import { BadRequestException } from '@nestjs/common';
import { COVER_CREDIT_INVALID, coverCreditLine, normalizeCoverCredit, readCoverCredit } from './cover-credit';

const thrown = (fn: () => unknown): any => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected a throw');
};

describe('cover credit', () => {
  it('nothing, a blank text or an empty object is no credit', () => {
    expect(normalizeCoverCredit(undefined)).toBeNull();
    expect(normalizeCoverCredit(null)).toBeNull();
    expect(normalizeCoverCredit('  ')).toBeNull();
    expect(normalizeCoverCredit({})).toBeNull();
    expect(normalizeCoverCredit({ illustrator: '  ', source: '' })).toBeNull();
  });

  it('takes a <slug>.credit.json as it is: licence names mapped, extra keys dropped, text trimmed', () => {
    const file = {
      illustrator: ' Vilhelm Pedersen ',
      illustratorDeathYear: 1874,
      source: 'https://commons.wikimedia.org/wiki/File:Example.jpeg',
      licence: 'Public domain',
      licenceUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
      attribution: 'Illüstrasyon: Vilhelm Pedersen. Kamu malı.',
      width: 2194,
      height: 1392,
    };
    expect(normalizeCoverCredit(JSON.stringify(file))).toEqual({
      illustrator: 'Vilhelm Pedersen',
      source: 'https://commons.wikimedia.org/wiki/File:Example.jpeg',
      licenseName: 'Public domain',
      licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
      attribution: 'Illüstrasyon: Vilhelm Pedersen. Kamu malı.',
    });
    expect(normalizeCoverCredit({ licenseName: 'CC BY 4.0', licence: 'ignored' })).toEqual({ licenseName: 'CC BY 4.0' });
  });

  it.each([
    ['{oops', 'geçerli bir JSON değil'],
    ['[1]', 'bir nesne olmalıdır'],
    [42, 'bir nesne olmalıdır'],
    [{ illustrator: 5 }, 'Kapak resminin çizeri metin olmalıdır.'],
    [{ licenseUrl: 'ftp://x' }, 'http ya da https'],
    [{ attribution: 'a'.repeat(2001) }, 'en fazla 2000 karakter'],
  ])('refuses %p with a coded Turkish 400', (input, message) => {
    const error = thrown(() => normalizeCoverCredit(input));
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse().code).toBe(COVER_CREDIT_INVALID);
    expect(error.getResponse().message).toContain(message);
  });

  it('a stored value that no longer validates reads as no credit', () => {
    expect(readCoverCredit({ illustrator: 7 })).toBeNull();
    expect(readCoverCredit({ illustrator: 'Ada' })).toEqual({ illustrator: 'Ada' });
  });

  it('the public line is the attribution, else illustrator, licence with its link and source', () => {
    expect(coverCreditLine(null)).toBeNull();
    expect(coverCreditLine({ attribution: 'Illustration by Greystroke, CC BY 4.0.', illustrator: 'Greystroke' })).toBe(
      'Illustration by Greystroke, CC BY 4.0.',
    );
    expect(
      coverCreditLine({
        illustrator: 'Greystroke',
        licenseName: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        source: 'StoryWeaver',
      }),
    ).toBe('Greystroke, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), StoryWeaver');
    expect(coverCreditLine({ licenseName: 'Kamu malı' })).toBe('Kamu malı');
    expect(coverCreditLine({ licenseUrl: 'https://example.org/l' })).toBe('https://example.org/l');
    expect(coverCreditLine({ bogus: 1 })).toBeNull();
  });
});
