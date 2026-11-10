// Keep the real Google SDK out of the test process entirely: the factory
// imports GoogleTTSService for DI metadata, which imports the SDK.
jest.mock('@google-cloud/text-to-speech', () => ({
  TextToSpeechClient: jest.fn(),
}));

import { BadRequestException } from '@nestjs/common';
import { TTSProviderFactory } from './tts-provider.factory';
import { TTSProviderEnum } from './interfaces/tts-provider.interface';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';

describe('TTSProviderFactory', () => {
  let settings: SettingsStub;
  let google: { getProviderName: jest.Mock };
  let cartesia: { getProviderName: jest.Mock; createVoiceClone: jest.Mock };

  const build = () =>
    new TTSProviderFactory(settings as any, google as any, cartesia as any);

  beforeEach(() => {
    settings = createSettingsStub();
    google = { getProviderName: jest.fn().mockReturnValue('google') };
    cartesia = {
      getProviderName: jest.fn().mockReturnValue('CARTESIA'),
      createVoiceClone: jest.fn(),
    };
  });

  describe('getProvider (voice profile provider)', () => {
    it.each([
      ['GOOGLE', 'google'],
      ['google', 'google'],
      ['CARTESIA', 'cartesia'],
      ['cartesia', 'cartesia'],
      ['Cartesia', 'cartesia'],
    ])('%s -> %s service', (provider, expected) => {
      const factory = build();
      const result = factory.getProvider(provider);
      expect(result).toBe(expected === 'google' ? google : cartesia);
    });

    it('accepts the enum values', () => {
      const factory = build();
      expect(factory.getProvider(TTSProviderEnum.GOOGLE)).toBe(google);
      expect(factory.getProvider(TTSProviderEnum.CARTESIA)).toBe(cartesia);
    });

    it('falls back to Google (does not throw) for an unknown / legacy provider such as MINIMAX', () => {
      const factory = build();
      expect(factory.getProvider('MINIMAX')).toBe(google);
      expect(factory.getProvider('elevenlabs')).toBe(google);
    });

    it('uses the configured default when no provider is given', () => {
      const factory = build();
      settings.values['tts.defaultProvider'] = 'google';
      expect(factory.getProvider()).toBe(google);

      // Same instance: the setting is read on every call, not at construction.
      settings.values['tts.defaultProvider'] = 'cartesia';
      expect(factory.getProvider()).toBe(cartesia);
    });

    it('treats an empty provider string like "not given" (default applies)', () => {
      settings.values['tts.defaultProvider'] = 'google';
      expect(build().getProvider('')).toBe(google);
    });

    it('an explicit provider wins over the default provider setting', () => {
      settings.values['tts.defaultProvider'] = 'google';
      expect(build().getProvider('CARTESIA')).toBe(cartesia);
    });
  });

  describe('getDefaultProviderType', () => {
    it('defaults to CARTESIA (code default of tts.defaultProvider)', () => {
      expect(build().getDefaultProviderType()).toBe(TTSProviderEnum.CARTESIA);
      expect(settings.get).toHaveBeenCalledWith('tts.defaultProvider');
    });

    it.each([
      ['google', TTSProviderEnum.GOOGLE],
      ['cartesia', TTSProviderEnum.CARTESIA],
    ] as const)('tts.defaultProvider=%p -> %s', (value, expected) => {
      settings.values['tts.defaultProvider'] = value;
      expect(build().getDefaultProviderType()).toBe(expected);
    });
  });

  describe('getCloningProvider', () => {
    it('defaults to Cartesia (the only cloning-capable provider)', () => {
      expect(build().getCloningProvider()).toBe(cartesia);
    });

    it.each(['CARTESIA', 'cartesia'])('%s -> Cartesia', (provider) => {
      expect(build().getCloningProvider(provider)).toBe(cartesia);
    });

    it('ignores tts.defaultProvider=google: cloning still resolves Cartesia', () => {
      settings.values['tts.defaultProvider'] = 'google';
      expect(build().getCloningProvider()).toBe(cartesia);
    });

    it('rejects Google with a 400', () => {
      const factory = build();
      expect(() => factory.getCloningProvider('GOOGLE')).toThrow(BadRequestException);
      expect(() => factory.getCloningProvider('google')).toThrow(
        'Voice cloning is not supported with Google provider. Use Cartesia.',
      );
    });

    it('rejects unknown providers with a 400 naming the provider', () => {
      const factory = build();
      expect(() => factory.getCloningProvider('minimax')).toThrow(BadRequestException);
      expect(() => factory.getCloningProvider('minimax')).toThrow('"MINIMAX"');
    });
  });

  it('getAllProviders returns Google and Cartesia', () => {
    expect(build().getAllProviders()).toEqual([google, cartesia]);
  });
});
