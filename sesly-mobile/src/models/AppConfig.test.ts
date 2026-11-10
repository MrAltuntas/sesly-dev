import {
  FALLBACK_ANDROID_STORE_URL,
  evaluateForceUpdate,
  parseAppConfigFromJSON,
} from './AppConfig';

// Shape of GET /app/config in sesly-backend.
const backendConfig = {
  minSupportedVersion: { android: '1.1.0', ios: '1.0.5' },
  latestVersion: { android: '1.2.0', ios: '1.2.0' },
  storeUrl: {
    android: 'https://play.google.com/store/apps/details?id=com.sesly',
    ios: 'https://apps.apple.com/app/id000000000',
  },
  updateMessage: 'Yeni sürüm hazır. Lütfen güncelle.',
};

describe('parseAppConfigFromJSON', () => {
  it('parses the backend shape', () => {
    expect(parseAppConfigFromJSON(backendConfig)).toEqual({
      minSupportedVersion: { android: '1.1.0', ios: '1.0.5' },
      latestVersion: { android: '1.2.0', ios: '1.2.0' },
      storeUrl: backendConfig.storeUrl,
      updateMessage: 'Yeni sürüm hazır. Lütfen güncelle.',
    });
  });

  it.each([[null], [undefined], ['oops'], [[1, 2]], [42]])(
    'turns %p into an all-null config',
    json => {
      expect(parseAppConfigFromJSON(json)).toEqual({
        minSupportedVersion: { android: null, ios: null },
        latestVersion: { android: null, ios: null },
        storeUrl: { android: null, ios: null },
        updateMessage: null,
      });
    },
  );

  it('drops invalid versions, non-store URLs and blank messages', () => {
    const parsed = parseAppConfigFromJSON({
      minSupportedVersion: { android: 'latest', ios: 7 },
      latestVersion: 'x',
      storeUrl: { android: 'javascript:alert(1)', ios: 'itms-apps://apps.apple.com/app/id1' },
      updateMessage: '   ',
    });

    expect(parsed.minSupportedVersion).toEqual({ android: null, ios: null });
    expect(parsed.latestVersion).toEqual({ android: null, ios: null });
    expect(parsed.storeUrl).toEqual({ android: null, ios: 'itms-apps://apps.apple.com/app/id1' });
    expect(parsed.updateMessage).toBeNull();
  });
});

describe('evaluateForceUpdate', () => {
  const config = parseAppConfigFromJSON(backendConfig);

  it('requires an update when the app is below the platform minimum', () => {
    expect(evaluateForceUpdate(config, 'android', '1.0.8')).toEqual({
      message: 'Yeni sürüm hazır. Lütfen güncelle.',
      storeUrl: backendConfig.storeUrl.android,
    });
  });

  it('uses the per-platform minimum', () => {
    // 1.0.8 >= iOS minimum 1.0.5.
    expect(evaluateForceUpdate(config, 'ios', '1.0.8')).toBeNull();
  });

  it('does not block at or above the minimum', () => {
    expect(evaluateForceUpdate(config, 'android', '1.1.0')).toBeNull();
    expect(evaluateForceUpdate(config, 'android', '1.3.0')).toBeNull();
  });

  it('never blocks without data', () => {
    expect(evaluateForceUpdate(null, 'android', '1.0.0')).toBeNull();
    expect(evaluateForceUpdate(config, 'web', '0.0.1')).toBeNull();
    expect(evaluateForceUpdate(config, 'android', null)).toBeNull();
    expect(evaluateForceUpdate(parseAppConfigFromJSON({}), 'android', '0.0.1')).toBeNull();
  });

  it('hides the store button for the backend default empty iOS store URL', () => {
    // Backend defaults: min 1.0.0, latest 1.0.8, ios storeUrl ''.
    const defaults = parseAppConfigFromJSON({
      minSupportedVersion: { android: '1.0.0', ios: '1.1.0' },
      latestVersion: { android: '1.0.8', ios: '1.1.0' },
      storeUrl: { android: 'https://play.google.com/store/apps/details?id=com.sesly', ios: '' },
      updateMessage: 'Güncelle.',
    });

    expect(defaults.storeUrl.ios).toBeNull();
    expect(evaluateForceUpdate(defaults, 'ios', '1.0.8')).toEqual({
      message: 'Güncelle.',
      storeUrl: null,
    });
    // Android 1.0.8 >= 1.0.0: no gate with the defaults.
    expect(evaluateForceUpdate(defaults, 'android', '1.0.8')).toBeNull();
  });

  it('leaves the message to the screen (UI language) and falls back to the Play Store listing', () => {
    const bare = parseAppConfigFromJSON({ minSupportedVersion: { android: '2.0.0', ios: '2.0.0' } });

    expect(evaluateForceUpdate(bare, 'android', '1.0.8')).toEqual({
      message: null,
      storeUrl: FALLBACK_ANDROID_STORE_URL,
    });
    // No known App Store link: the screen hides the button.
    expect(evaluateForceUpdate(bare, 'ios', '1.0.8')).toEqual({
      message: null,
      storeUrl: null,
    });
  });
});
