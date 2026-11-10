import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import {
  RegisterDeviceDto,
  RegisterDeviceResponseDto,
  UnregisterDeviceDto,
  UnregisterDeviceResponseDto,
} from './dto/register-device.dto';
import {
  NotificationListResponseDto,
  UnreadCountResponseDto,
  MarkReadResponseDto,
} from './dto/notification-response.dto';
import { CurrentUser } from '@common/decorators/current-user.decorator';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List the current user notifications (paginated, newest first)' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (1-indexed)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (max 100)' })
  @ApiResponse({ status: 200, type: NotificationListResponseDto })
  async listNotifications(
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page !== undefined ? parseInt(page, 10) : 1;
    const limitNum = limit !== undefined ? parseInt(limit, 10) : 20;
    return this.notificationsService.listNotifications(
      userId,
      Number.isFinite(pageNum) ? pageNum : 1,
      Number.isFinite(limitNum) ? limitNum : 20,
    );
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get the number of unread notifications for the current user' })
  @ApiResponse({ status: 200, type: UnreadCountResponseDto })
  async getUnreadCount(@CurrentUser('id') userId: string) {
    return this.notificationsService.getUnreadCount(userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a single notification as read' })
  @ApiResponse({ status: 200, type: MarkReadResponseDto })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async markAsRead(
    @CurrentUser('id') userId: string,
    @Param('id') notificationId: string,
  ) {
    return this.notificationsService.markAsRead(userId, notificationId);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all notifications as read for the current user' })
  @ApiResponse({ status: 200, type: MarkReadResponseDto })
  async markAllAsRead(@CurrentUser('id') userId: string) {
    return this.notificationsService.markAllAsRead(userId);
  }

  // Push toggles live on PATCH /users/me/preferences (voiceReadyNotifications,
  // narrationReadyNotifications, promoNotifications); there is no
  // notifications-specific preferences endpoint.

  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register (or refresh) this device FCM token for push',
    description:
      'Idempotent. Call after login, on every app start and on token refresh. A token held by another account is moved to the caller.',
  })
  @ApiResponse({ status: 200, type: RegisterDeviceResponseDto })
  async registerDevice(
    @CurrentUser('id') userId: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.notificationsService.registerDevice(userId, dto);
  }

  @Post('unregister')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stop push to this device (call on logout, before dropping the JWT)',
    description: 'Idempotent: an unknown token returns 200 with removed=0.',
  })
  @ApiResponse({ status: 200, type: UnregisterDeviceResponseDto })
  async unregisterDevice(
    @CurrentUser('id') userId: string,
    @Body() dto: UnregisterDeviceDto,
  ) {
    return this.notificationsService.unregisterDevice(userId, dto);
  }
}
