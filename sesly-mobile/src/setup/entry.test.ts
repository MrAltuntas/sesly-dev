/**
 * src/setup/entry.ts, the first import of index.ts: holds the native splash
 * with a short fade and enables screen freezing, and nothing else.
 */

describe('setup/entry', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('holds the splash once, sets the fade and enables freeze', () => {
    jest.isolateModules(() => {
      const SplashScreen = require('expo-splash-screen') as {
        preventAutoHideAsync: jest.Mock;
        setOptions: jest.Mock;
        hideAsync: jest.Mock;
      };
      const screens = require('react-native-screens') as typeof import('react-native-screens');
      expect(screens.freezeEnabled()).toBe(false);

      require('./entry');

      expect(SplashScreen.preventAutoHideAsync).toHaveBeenCalledTimes(1);
      expect(SplashScreen.setOptions).toHaveBeenCalledWith({ fade: true, duration: 200 });
      expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
      expect(screens.freezeEnabled()).toBe(true);
    });
  });

  it('only warns when the splash module fails', () => {
    jest.isolateModules(() => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const SplashScreen = require('expo-splash-screen') as {
        preventAutoHideAsync: jest.Mock;
        setOptions: jest.Mock;
      };
      SplashScreen.preventAutoHideAsync.mockImplementationOnce(() => {
        throw new Error('no native module');
      });
      SplashScreen.setOptions.mockImplementationOnce(() => {
        throw new Error('no native module');
      });

      expect(() => require('./entry')).not.toThrow();
      expect(warn).toHaveBeenCalledWith('[splash] preventAutoHideAsync failed:', expect.any(Error));
      expect(warn).toHaveBeenCalledWith('[splash] setOptions failed:', expect.any(Error));
    });
  });

  it('only warns when preventAutoHideAsync rejects', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.isolateModules(() => {
      const SplashScreen = require('expo-splash-screen') as { preventAutoHideAsync: jest.Mock };
      SplashScreen.preventAutoHideAsync.mockRejectedValueOnce(new Error('no activity'));
      require('./entry');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith('[splash] preventAutoHideAsync failed:', expect.any(Error));
  });

  it('starts no boot work (headless tasks evaluate index.ts)', () => {
    jest.isolateModules(() => {
      const AsyncStorage = require('@react-native-async-storage/async-storage') as {
        multiGet: jest.Mock;
        getItem: jest.Mock;
      };
      const EncryptedStorage = require('react-native-encrypted-storage') as { getItem: jest.Mock };
      require('./entry');
      expect(AsyncStorage.multiGet).not.toHaveBeenCalled();
      expect(AsyncStorage.getItem).not.toHaveBeenCalled();
      expect(EncryptedStorage.getItem).not.toHaveBeenCalled();
    });
  });
});
