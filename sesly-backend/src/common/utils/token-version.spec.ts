import {
  bumpTokenVersion,
  isTokenVersionCurrent,
  tokenVersionOf,
  withoutTokenVersion,
} from './token-version';

describe('token-version', () => {
  describe('tokenVersionOf', () => {
    it.each([
      ['an integer claim', { tv: 3 }, 3],
      ['a zero claim', { tv: 0 }, 0],
      ['a missing claim (token issued before revocation existed)', {}, 0],
      ['a string claim', { tv: '3' }, 0],
      ['a fractional claim', { tv: 1.5 }, 0],
      ['a null payload', null, 0],
      ['an undefined payload', undefined, 0],
    ])('%s -> %p', (_label, payload, expected) => {
      expect(tokenVersionOf(payload as any)).toBe(expected);
    });
  });

  describe('isTokenVersionCurrent', () => {
    it('matches the claim against the stored generation', () => {
      expect(isTokenVersionCurrent({ tv: 2 }, 2)).toBe(true);
      expect(isTokenVersionCurrent({ tv: 1 }, 2)).toBe(false);
      expect(isTokenVersionCurrent({ tv: 3 }, 2)).toBe(false);
    });

    it('a token without tv stays valid until the first bump, then never again', () => {
      expect(isTokenVersionCurrent({}, 0)).toBe(true);
      expect(isTokenVersionCurrent({}, 1)).toBe(false);
    });

    it('a missing stored value counts as generation 0', () => {
      expect(isTokenVersionCurrent({ tv: 0 }, undefined)).toBe(true);
      expect(isTokenVersionCurrent({ tv: 0 }, null)).toBe(true);
      expect(isTokenVersionCurrent({ tv: 1 }, undefined)).toBe(false);
    });
  });

  it('bumpTokenVersion returns a fresh increment-by-one update each call', () => {
    const a = bumpTokenVersion();
    const b = bumpTokenVersion();
    expect(a).toEqual({ tokenVersion: { increment: 1 } });
    expect(a).not.toBe(b);
  });

  it('withoutTokenVersion drops only the tokenVersion key and leaves the row untouched', () => {
    const row = { id: 'u-1', email: 'a@example.com', tokenVersion: 4 };

    expect(withoutTokenVersion(row)).toEqual({ id: 'u-1', email: 'a@example.com' });
    expect(row.tokenVersion).toBe(4);
    expect(withoutTokenVersion({ id: 'u-2' })).toEqual({ id: 'u-2' });
  });
});
