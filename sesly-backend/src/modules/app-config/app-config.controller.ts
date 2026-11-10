import { Controller, Get, Header, Headers } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AppConfigResponse, AppConfigService } from './app-config.service';
import { uiLanguageFromAcceptLanguage } from '../../common/i18n/ui-language';

/** Cache for 5 minutes: clients poll this on every launch / resume. */
export const APP_CONFIG_CACHE_CONTROL = 'public, max-age=300';

@ApiTags('App')
@Controller('app')
export class AppConfigController {
  constructor(private readonly appConfigService: AppConfigService) {}

  /**
   * Force-update gate for the mobile app. Public (no token needed, the app
   * checks it before login) and allowed during maintenance mode
   * (MaintenanceGuard allowlist) so an outdated app can still be told to
   * update.
   */
  @Public()
  @Get('config')
  @Header('Cache-Control', APP_CONFIG_CACHE_CONTROL)
  // updateMessage follows Accept-Language: caches must key on it.
  @Header('Vary', 'Accept-Language')
  @ApiOperation({ summary: 'Mobile app config: minimum / latest version, store links, update copy' })
  @ApiResponse({ status: 200, description: 'AppConfigResponse' })
  getConfig(@Headers('accept-language') acceptLanguage?: string): AppConfigResponse {
    return this.appConfigService.getConfig(uiLanguageFromAcceptLanguage(acceptLanguage));
  }
}
