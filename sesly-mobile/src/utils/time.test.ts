import {
  formatClock,
  formatRemaining,
  getNarrationDurationLabel,
  narrationDurationMinutes,
  UNKNOWN_REMAINING_LABEL,
} from './time';

describe('formatClock', () => {
  it('formats whole seconds as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(59.9)).toBe('0:59');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(353)).toBe('5:53');
    expect(formatClock(4500)).toBe('75:00');
  });

  it('renders invalid input as 0:00', () => {
    expect(formatClock(-3)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('formatRemaining', () => {
  it('prefixes the remaining time with a hyphen-minus', () => {
    expect(formatRemaining(0, 353)).toBe('-5:53');
    expect(formatRemaining(53, 353)).toBe('-5:00');
    expect(formatRemaining(0, 353).charCodeAt(0)).toBe(0x2d);
  });

  it('keeps left + right equal to the whole-second total', () => {
    // 0.6 s in: left shows 0:00, so the right still shows the full 5:53.
    expect(formatClock(0.6)).toBe('0:00');
    expect(formatRemaining(0.6, 353.4)).toBe('-5:53');
    expect(formatClock(1.2)).toBe('0:01');
    expect(formatRemaining(1.2, 353.4)).toBe('-5:52');
  });

  it('clamps at -0:00 at or past the end', () => {
    expect(formatRemaining(353, 353)).toBe('-0:00');
    expect(formatRemaining(400, 353)).toBe('-0:00');
  });

  it('treats a negative / invalid position as 0', () => {
    expect(formatRemaining(-5, 60)).toBe('-1:00');
    expect(formatRemaining(Number.NaN, 60)).toBe('-1:00');
  });

  it('shows a placeholder while the duration is unknown', () => {
    expect(formatRemaining(0, 0)).toBe(UNKNOWN_REMAINING_LABEL);
    expect(formatRemaining(10, -1)).toBe(UNKNOWN_REMAINING_LABEL);
    expect(formatRemaining(10, Number.NaN)).toBe(UNKNOWN_REMAINING_LABEL);
    expect(UNKNOWN_REMAINING_LABEL).toBe('-:--');
  });
});

describe('narrationDurationMinutes', () => {
  it('rounds to the nearest minute with a minimum of 1', () => {
    expect(narrationDurationMinutes(353)).toBe(6); // 5:53
    expect(narrationDurationMinutes(312)).toBe(5); // 5:12
    expect(narrationDurationMinutes(330)).toBe(6); // 5:30 rounds up
    expect(narrationDurationMinutes(20)).toBe(1);
    expect(narrationDurationMinutes(0.5)).toBe(1);
  });

  it('returns null when the duration is unknown', () => {
    expect(narrationDurationMinutes(0)).toBeNull();
    expect(narrationDurationMinutes(-1)).toBeNull();
    expect(narrationDurationMinutes(null)).toBeNull();
    expect(narrationDurationMinutes(undefined)).toBeNull();
    expect(narrationDurationMinutes(Number.NaN)).toBeNull();
  });
});

describe('getNarrationDurationLabel', () => {
  it('prefers the real narration duration over the seed estimate', () => {
    expect(getNarrationDurationLabel(353, 4)).toBe('6 dakika');
  });

  it('uses the story label style for long narrations', () => {
    expect(getNarrationDurationLabel(3900, 10)).toBe('1 saat 5 dakika');
    expect(getNarrationDurationLabel(3600, 10)).toBe('1 saat');
  });

  it('falls back to estimatedDuration when the narration duration is unknown', () => {
    expect(getNarrationDurationLabel(0, 4)).toBe('4 dakika');
    expect(getNarrationDurationLabel(null, 7)).toBe('7 dakika');
  });

  it('returns an empty label when nothing is known', () => {
    expect(getNarrationDurationLabel(0, 0)).toBe('');
    expect(getNarrationDurationLabel(undefined, undefined)).toBe('');
    expect(getNarrationDurationLabel(null, null)).toBe('');
  });
});
