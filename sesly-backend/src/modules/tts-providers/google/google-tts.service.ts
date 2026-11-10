import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { SettingsService } from '../../settings/settings.service';
import { TTSProvider, TTSGenerationOptions, Voice, TTSProviderEnum } from '../interfaces/tts-provider.interface';
import { buildGoogleSynthesisRequest } from '../ssml.helper';
import { DEFAULT_CONTENT_LANGUAGE } from '../../../common/constants/content-languages';
import { listPresetVoices } from '../../../common/constants/google-preset-voices';

@Injectable()
export class GoogleTTSService implements TTSProvider {
    private readonly logger = new Logger(GoogleTTSService.name);
    private readonly client: TextToSpeechClient;
    private readonly projectId: string;

    constructor(
        private configService: ConfigService,
        private settings: SettingsService,
    ) {
        // GOOGLE_APPLICATION_CREDENTIALS env var is automatically used by Google libraries
        this.projectId = this.configService.get<string>('google.projectId') || '';
        if (!this.projectId) {
            throw new Error('Google Project ID is not configured. Ensure GOOGLE_CLOUD_PROJECT_ID is in your .env file.');
        }

        // Instantiate without credentials, it will use ADC
        // Force use of specific service account file and project ID
        const keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS || './certs/backend-service-account.json';

        this.client = new TextToSpeechClient({
            keyFilename: keyFilename,
            projectId: this.projectId,
        });
    }

    /**
     * Storytelling prosody (slightly slower, slightly warmer pitch by default).
     * Runtime settings tts.google.speakingRate / tts.google.pitch, read on
     * every call so a change in the admin panel applies to the next synthesis.
     * Pitch only reaches voices that accept it (never the Chirp family).
     */
    getProsody(): { speakingRate: number; pitch: number } {
        return {
            speakingRate: this.settings.get('tts.google.speakingRate'),
            pitch: this.settings.get('tts.google.pitch'),
        };
    }

    // Google TTS ignores emotion, speed, volume and pronunciationDictId of the
    // per-call `options` (Cartesia-only). Rate/pitch are governed globally via
    // the runtime settings to keep the storytelling prosody consistent across
    // this provider. Only `parts` is used: pauses between grouped segments.
    async textToSpeech(text: string, voiceId: string, options?: TTSGenerationOptions): Promise<Buffer> {
        try {
            // Chirp voices: plain text + speakingRate, never pitch (Google
            // rejects the whole request with INVALID_ARGUMENT). Other voices:
            // SSML envelope, rate and pitch applied once through audioConfig.
            const request = buildGoogleSynthesisRequest(text, voiceId, this.getProsody(), options?.parts);

            const [response] = await this.client.synthesizeSpeech(request);

            if (!response.audioContent) {
                throw new Error('No audio content in response from Google TTS');
            }

            this.logger.log(
                `Standard TTS completed for voice: ${voiceId} (input=${Object.keys(request.input)[0]}, ` +
                    `rate=${request.audioConfig.speakingRate}, pitch=${request.audioConfig.pitch ?? 'not sent'})`,
            );
            return Buffer.from(response.audioContent as Uint8Array);
        } catch (error: any) {
            this.logger.error(`Standard TTS failed for voice: ${voiceId}`, error.stack);
            throw error;
        }
    }

    /**
     * Ready-made voices of the given content languages (default: Turkish).
     * Served from the static Chirp 3 HD catalogue, never from a live
     * `listVoices` call: a Google outage cannot empty or change the list.
     */
    async getAvailableVoices(contentLanguages?: string[]): Promise<Voice[]> {
        const languages = contentLanguages?.length ? contentLanguages : [DEFAULT_CONTENT_LANGUAGE];
        return languages.flatMap((language) =>
            listPresetVoices(language).map((voice) => ({ ...voice, provider: TTSProviderEnum.GOOGLE })),
        );
    }

    getProviderName(): string {
        return 'google';
    }
}
