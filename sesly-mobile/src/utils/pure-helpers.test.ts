import { normalizeRegistrationName, splitFullName } from './names';
import { shouldResumeFrom } from './playback';

describe('name helpers', () => {
  it('splitFullName: first token / rest', () => {
    expect(splitFullName('Ayşe Nur Yılmaz')).toEqual({
      firstName: 'Ayşe',
      lastName: 'Nur Yılmaz',
    });
    expect(splitFullName('  Ali  ')).toEqual({ firstName: 'Ali' });
    expect(splitFullName('')).toEqual({});
  });

  it('normalizeRegistrationName keeps explicit first/last names', () => {
    expect(normalizeRegistrationName('Ayşe Nur', 'Yılmaz')).toEqual({
      firstName: 'Ayşe Nur',
      lastName: 'Yılmaz',
    });
  });

  it('normalizeRegistrationName splits a full name given in one field', () => {
    expect(normalizeRegistrationName('Mehmet Can Demir', undefined)).toEqual({
      firstName: 'Mehmet',
      lastName: 'Can Demir',
    });
  });
});

describe('shouldResumeFrom', () => {
  it('resumes a mid-story position', () => {
    expect(shouldResumeFrom(60_000, 300)).toBe(true);
  });
  it('does not resume at the very end', () => {
    expect(shouldResumeFrom(299_000, 300)).toBe(false);
  });
  it('resumes when the total duration is unknown', () => {
    expect(shouldResumeFrom(60_000, 0)).toBe(true);
  });
  it('ignores empty positions', () => {
    expect(shouldResumeFrom(0, 300)).toBe(false);
    expect(shouldResumeFrom(NaN, 300)).toBe(false);
  });
});
