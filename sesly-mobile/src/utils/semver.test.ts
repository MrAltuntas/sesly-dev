import { compareSemver, isVersionBelow, parseSemver } from './semver';

describe('parseSemver', () => {
  it.each([
    ['1.0.8', [1, 0, 8]],
    [' 1.0.8 ', [1, 0, 8]],
    ['v2.3.4', [2, 3, 4]],
    ['1.2', [1, 2, 0]],
    ['3', [3, 0, 0]],
    ['1.0.8-beta.1', [1, 0, 8]],
    ['1.0.8+42', [1, 0, 8]],
    ['10.20.30', [10, 20, 30]],
  ])('parses %p', (input, expected) => {
    expect(parseSemver(input)).toEqual(expected);
  });

  it.each([[''], ['abc'], ['1..2'], ['1.2.x'], ['-1.0.0'], [null], [undefined], [108], [{}]])(
    'rejects %p',
    input => {
      expect(parseSemver(input)).toBeNull();
    },
  );

  it('rejects numbers beyond the safe integer range', () => {
    expect(parseSemver('99999999999999999999.0.0')).toBeNull();
  });
});

describe('compareSemver', () => {
  it.each([
    ['1.0.8', '1.0.8', 0],
    ['1.0.8', '1.0.9', -1],
    ['1.0.10', '1.0.9', 1],
    ['1.1.0', '1.0.99', 1],
    ['2.0.0', '10.0.0', -1],
    ['1.2', '1.2.0', 0],
    ['1.0.8-rc.1', '1.0.8', 0],
  ])('%s vs %s -> %i', (a, b, expected) => {
    expect(compareSemver(a, b)).toBe(expected);
  });

  it('returns null when either side is invalid', () => {
    expect(compareSemver('1.0.0', 'x')).toBeNull();
    expect(compareSemver(null, '1.0.0')).toBeNull();
  });
});

describe('isVersionBelow', () => {
  it('is true only for a strictly older valid version', () => {
    expect(isVersionBelow('1.0.8', '1.1.0')).toBe(true);
    expect(isVersionBelow('1.1.0', '1.1.0')).toBe(false);
    expect(isVersionBelow('1.2.0', '1.1.0')).toBe(false);
  });

  it('never blocks on invalid or missing data', () => {
    expect(isVersionBelow(null, '9.9.9')).toBe(false);
    expect(isVersionBelow('1.0.8', undefined)).toBe(false);
    expect(isVersionBelow('garbage', '9.9.9')).toBe(false);
  });
});
