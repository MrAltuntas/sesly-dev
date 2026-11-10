import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { UserPreferencesService } from './user-preferences.service';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { UserPreferencesResponseDto } from './dto/user-preferences-response.dto';

/**
 * Per-user preferences. Both endpoints are authenticated (global JwtAuthGuard
 * is active — no `@Public()` here). There is intentionally no admin surface:
 * preferences are owned by the user and edited only by them.
 */
@ApiTags('User Preferences')
@ApiBearerAuth()
@Controller('users/me/preferences')
export class UserPreferencesController {
  constructor(private readonly svc: UserPreferencesService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the current user\'s preferences',
    description:
      'Returns the preferences row, creating it with schema defaults on first access (upsert-on-read).',
  })
  @ApiResponse({ status: 200, type: UserPreferencesResponseDto })
  async get(
    @CurrentUser('id') userId: string,
  ): Promise<UserPreferencesResponseDto> {
    return this.svc.getOrCreate(userId);
  }

  @Patch()
  @ApiOperation({
    summary: 'Partially update the current user\'s preferences',
    description:
      'All fields optional. Explicit booleans/ints pass through as-is; `settings` is shallow-merged at the top level into the existing bag. Pass null for `sleepTimerLastDuration` to clear it. Total `settings` payload capped at 4KB (400 returned if exceeded).',
  })
  @ApiResponse({ status: 200, type: UserPreferencesResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or settings payload exceeds 4KB',
  })
  async update(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateUserPreferencesDto,
  ): Promise<UserPreferencesResponseDto> {
    return this.svc.update(userId, dto);
  }
}
