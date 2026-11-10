import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UsageService } from './usage.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Usage')
@ApiBearerAuth()
@Controller('usage')
export class UsageController {
  constructor(private usageService: UsageService) {}

  @Get()
  @ApiOperation({
    summary: 'Every allowance of the current plan, for the usage bars',
    description:
      'buckets.presetNarrations / cloneNarrations / cloneCreations: { limit (null = unlimited), used, remaining, period: month | lifetime, renewsAt (null for lifetime) }, plus plan, planName, voiceSlots and features.',
  })
  @ApiResponse({ status: 200 })
  async getUsage(@CurrentUser('id') userId: string) {
    return this.usageService.getUsageSummary(userId);
  }

  @Get('current')
  @ApiOperation({ summary: 'Legacy usage shape (-1 = unlimited); prefer GET /usage' })
  @ApiResponse({ status: 200 })
  async getCurrentUsage(@CurrentUser('id') userId: string) {
    return this.usageService.getCurrentUsage(userId);
  }

  @Get('limits')
  @ApiOperation({ summary: 'Legacy limits shape (-1 = unlimited); prefer GET /usage' })
  @ApiResponse({ status: 200 })
  async getLimits(@CurrentUser('id') userId: string) {
    return this.usageService.getLimits(userId);
  }
}
