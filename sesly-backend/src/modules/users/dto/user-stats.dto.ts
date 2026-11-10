import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shape for `GET /users/me/stats` — the three counters on the
 * Profile screen stats strip (masal / saat / ses).
 */
export class UserStatsDto {
  @ApiProperty({
    description:
      'Number of narrations this user has completed (StoryNarration.completedAt != null).',
  })
  storiesCompleted: number;

  @ApiProperty({
    description:
      'Approximate total hours of narrated audio this user owns. Rough proxy using Audio.duration for READY narrations — not real playback tracking.',
  })
  hoursListened: number;

  @ApiProperty({
    description:
      'Number of voice profiles successfully trained (VoiceProfile.status == READY).',
  })
  voicesTrained: number;
}
