import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { GoogleTTSService } from './google/google-tts.service';
import { CartesiaTTSService } from './cartesia/cartesia-tts.service';
import { TTSProviderFactory } from './tts-provider.factory';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
  ],
  providers: [
    GoogleTTSService,
    CartesiaTTSService,
    TTSProviderFactory,
  ],
  exports: [
    GoogleTTSService,
    CartesiaTTSService,
    TTSProviderFactory,
  ],
})
export class TTSProvidersModule {}
