import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NotificationDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty({ description: 'Notification type (e.g. VOICE_READY, VOICE_FAILED, NARRATION_READY)' })
  type: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiPropertyOptional({ description: 'Arbitrary payload attached to the notification', nullable: true })
  data?: Record<string, any> | null;

  @ApiProperty()
  read: boolean;

  @ApiPropertyOptional({ nullable: true })
  readAt?: Date | null;

  @ApiProperty()
  createdAt: Date;
}

export class NotificationListResponseDto {
  @ApiProperty({ type: [NotificationDto] })
  items: NotificationDto[];

  @ApiProperty({ description: 'Total number of notifications matching the query' })
  total: number;

  @ApiProperty({ description: 'Current page (1-indexed)' })
  page: number;

  @ApiProperty({ description: 'Items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of unread notifications for the current user' })
  unreadCount: number;
}

export class UnreadCountResponseDto {
  @ApiProperty({ description: 'Number of unread notifications for the current user' })
  unreadCount: number;
}

export class MarkReadResponseDto {
  @ApiProperty({ description: 'Human-readable status message' })
  message: string;

  @ApiProperty({ description: 'Number of notifications affected' })
  updated: number;
}
