import {
  NotificationType,
  getNotificationTarget,
  parseNotificationFromJSON,
  parseNotificationType,
} from './Notification';

const row = (extra: Record<string, unknown>) => ({
  id: 'nt-1',
  userId: 'u-1',
  title: 'Masalın hazır',
  body: 'Dinlemeye hazır.',
  read: false,
  createdAt: '2026-09-27T10:00:00.000Z',
  ...extra,
});

describe('parseNotificationType', () => {
  it.each([
    ['VOICE_READY', NotificationType.VOICE_READY],
    ['VOICE_FAILED', NotificationType.VOICE_FAILED],
    ['NARRATION_READY', NotificationType.NARRATION_READY],
    ['NARRATION_FAILED', NotificationType.NARRATION_FAILED],
    ['SYSTEM', NotificationType.SYSTEM],
    ['INFO', NotificationType.SYSTEM],
    ['PROMO', NotificationType.SYSTEM],
    [undefined, NotificationType.SYSTEM],
  ])('%s -> %s', (raw, expected) => {
    expect(parseNotificationType(raw)).toBe(expected);
  });
});

describe('parseNotificationFromJSON', () => {
  it('maps backend types', () => {
    expect(parseNotificationFromJSON(row({ type: 'NARRATION_READY' })).type).toBe(
      NotificationType.NARRATION_READY,
    );
  });

  it('uses data.type when the row type is generic', () => {
    const n = parseNotificationFromJSON(
      row({ type: 'INFO', data: { type: 'VOICE_FAILED', voiceProfileId: 'v-1' } }),
    );
    expect(n.type).toBe(NotificationType.VOICE_FAILED);
  });
});

describe('getNotificationTarget', () => {
  it('NARRATION_READY opens the player for data.narrationId', () => {
    expect(
      getNotificationTarget({
        type: NotificationType.NARRATION_READY,
        data: { narrationId: 'n-1', storyId: 's-1' },
      }),
    ).toEqual({ kind: 'player', narrationId: 'n-1' });
  });

  it('NARRATION_READY without narrationId falls back to the story', () => {
    expect(
      getNotificationTarget({
        type: NotificationType.NARRATION_READY,
        data: { storyId: 's-1' },
      }),
    ).toEqual({ kind: 'story', storyId: 's-1' });
  });

  it('NARRATION_FAILED opens the story detail', () => {
    expect(
      getNotificationTarget({
        type: NotificationType.NARRATION_FAILED,
        data: { narrationId: 'n-1', storyId: 's-1' },
      }),
    ).toEqual({ kind: 'story', storyId: 's-1' });
  });

  it('VOICE_* opens voice profiles', () => {
    expect(
      getNotificationTarget({ type: NotificationType.VOICE_READY, data: null }),
    ).toEqual({ kind: 'voices' });
    expect(
      getNotificationTarget({
        type: NotificationType.VOICE_FAILED,
        data: { voiceProfileId: 'v-1' },
      }),
    ).toEqual({ kind: 'voices' });
  });

  it('SYSTEM goes nowhere', () => {
    expect(
      getNotificationTarget({ type: NotificationType.SYSTEM, data: null }),
    ).toEqual({ kind: 'none' });
  });
});
