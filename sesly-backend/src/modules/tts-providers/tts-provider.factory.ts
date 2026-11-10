import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import {
  TTSProvider as TTSProviderInterface,
  TTSProviderEnum,
  VoiceCloningCapableProvider,
} from './interfaces/tts-provider.interface';
import { GoogleTTSService } from './google/google-tts.service';
import { CartesiaTTSService } from './cartesia/cartesia-tts.service';

@Injectable()
export class TTSProviderFactory {
  private readonly logger = new Logger(TTSProviderFactory.name);

  constructor(
    private settings: SettingsService,
    private googleTTSService: GoogleTTSService,
    private cartesiaTTSService: CartesiaTTSService,
  ) {
    this.logger.log('TTS Provider Factory initialized');
  }

  getProvider(providerType?: TTSProviderEnum | string): TTSProviderInterface {
    const provider = providerType ? providerType.toUpperCase() : this.getDefaultProviderType();

    if (provider === TTSProviderEnum.CARTESIA) {
      return this.cartesiaTTSService;
    }

    if (provider !== TTSProviderEnum.GOOGLE) {
      this.logger.warn(`Requested provider ${provider} is not supported. Using Google.`);
    }
    return this.googleTTSService;
  }

  /**
   * Returns a provider capable of voice cloning.
   *
   * Google is intentionally NOT a cloning-capable provider — Sesly only uses
   * Google for ready-made voices on the free tier. As of Phase 3, Cartesia
   * Sonic 3 is the sole cloning provider; MiniMax/WaveSpeed has been removed.
   */
  getCloningProvider(providerType?: TTSProviderEnum | string): VoiceCloningCapableProvider {
    const provider = providerType
      ? providerType.toUpperCase()
      : TTSProviderEnum.CARTESIA;

    if (provider === TTSProviderEnum.GOOGLE) {
      throw new BadRequestException(
        'Voice cloning is not supported with Google provider. Use Cartesia.',
      );
    }

    if (provider !== TTSProviderEnum.CARTESIA) {
      throw new BadRequestException(
        `Voice cloning is not supported for provider "${provider}". Use Cartesia.`,
      );
    }

    return this.cartesiaTTSService;
  }

  getDefaultProviderType(): TTSProviderEnum {
    // Runtime setting tts.defaultProvider (panel, then TTS_PROVIDER, then
    // 'cartesia'), read on every call.
    return this.settings.get('tts.defaultProvider') === 'google'
      ? TTSProviderEnum.GOOGLE
      : TTSProviderEnum.CARTESIA;
  }

  getAllProviders(): TTSProviderInterface[] {
    return [this.googleTTSService, this.cartesiaTTSService];
  }
}
