import appConfig from './app.config';
import cartesiaConfig from './cartesia.config';
import databaseConfig from './database.config';
import firebaseConfig from './firebase.config';
import geminiConfig from './gemini.config';
import googleStorageConfig from './google-storage.config';
import googleConfig from './google.config';
import jwtConfig from './jwt.config';
import redisConfig from './redis.config';
import storeConfig from './store.config';

/**
 * The registerAs() factories read process.env at call time. These tests run
 * each factory against a controlled environment (never the real .env) so a
 * renamed variable or a changed default is caught.
 */
const ORIGINAL_ENV = process.env;

function withEnv(env: Record<string, string | undefined>) {
  process.env = { ...env } as NodeJS.ProcessEnv;
}

describe('config factories', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('registers each factory under the namespace ConfigService.get() callers use', () => {
    expect((appConfig as any).KEY).toBe('CONFIGURATION(app)');
    expect((cartesiaConfig as any).KEY).toBe('CONFIGURATION(cartesia)');
    expect((jwtConfig as any).KEY).toBe('CONFIGURATION(jwt)');
    expect((googleStorageConfig as any).KEY).toBe('CONFIGURATION(googleStorage)');
    expect((geminiConfig as any).KEY).toBe('CONFIGURATION(gemini)');
  });

  describe('app', () => {
    it('defaults', () => {
      withEnv({});
      expect(appConfig()).toMatchObject({
        nodeEnv: 'development',
        port: 3000,
        frontendUrl: 'https://sesly.io',
        mobileDeepLink: 'sesly://',
      });
    });

    it('CORS: env origins first, fixed origins appended, duplicates removed', () => {
      withEnv({ CORS_ORIGINS: 'https://x.test,https://sesly.io', PORT: '8080' });
      const cfg = appConfig();
      expect(cfg.port).toBe(8080);
      expect(cfg.corsOrigins[0]).toBe('https://x.test');
      expect(cfg.corsOrigins.filter((o: string) => o === 'https://sesly.io')).toHaveLength(1);
      expect(cfg.corsOrigins).toEqual(
        expect.arrayContaining(['https://admin.sesly.io', 'https://api.sesly.io']),
      );
    });
  });

  describe('cartesia', () => {
    it('pins API version 2026-08-14 and sonic-3.6 by default', () => {
      withEnv({});
      expect(cartesiaConfig()).toEqual({
        apiKey: undefined,
        apiUrl: 'https://api.cartesia.ai',
        version: '2026-08-14',
      });
    });

    it('tunables are runtime settings, not config: CARTESIA_MODEL / CARTESIA_DEFAULT_* never appear here', () => {
      withEnv({ CARTESIA_MODEL: 'sonic-3.6-2026-08-27', CARTESIA_DEFAULT_SPEED: '1.1', CARTESIA_VERSION: '2026-09-01' });
      expect(Object.keys(cartesiaConfig()).sort()).toEqual(['apiKey', 'apiUrl', 'version']);
      expect(cartesiaConfig().version).toBe('2026-09-01');
    });
  });

  it('gemini config holds only the key and the host (tunables are runtime settings)', () => {
    withEnv({ GEMINI_MODEL: 'x', GEMINI_TEMPERATURE: '1' });
    expect(geminiConfig()).toEqual({
      apiKey: undefined,
      apiUrl: 'https://generativelanguage.googleapis.com',
    });
    withEnv({ GEMINI_API_KEY: 'k', GEMINI_API_URL: 'https://gemini.test' });
    expect(geminiConfig()).toEqual({ apiKey: 'k', apiUrl: 'https://gemini.test' });
  });

  it('firebase private key newlines are unescaped', () => {
    withEnv({ FIREBASE_PRIVATE_KEY: 'line1\\nline2' });
    expect(firebaseConfig().privateKey).toBe('line1\nline2');
    withEnv({});
    expect(firebaseConfig().privateKey).toBeUndefined();
  });

  it('redis / storage / database / google read their variables', () => {
    withEnv({
      REDIS_HOST: 'r',
      REDIS_PORT: '7000',
      GOOGLE_STORAGE_BUCKET: 'b',
      DATABASE_URL: 'postgres://x',
      GOOGLE_CLIENT_ID: 'cid',
    });
    expect(redisConfig()).toEqual({ host: 'r', port: 7000, password: undefined });
    expect(googleStorageConfig().bucket).toBe('b');
    expect(databaseConfig().url).toBe('postgres://x');
    expect(googleConfig().clientId).toBe('cid');

    withEnv({});
    expect(redisConfig()).toEqual({ host: 'localhost', port: 6379, password: undefined });
    expect(googleStorageConfig().bucket).toBe('sesly-storage');
  });

  it('store reads the in-app purchase variables, with safe defaults', () => {
    withEnv({
      GOOGLE_PACKAGE_NAME: 'com.other',
      GOOGLE_PLAY_SERVICE_ACCOUNT_PATH: './certs/play.json',
      GOOGLE_PLAY_PUBSUB_AUDIENCE: 'https://api.sesly.io/webhooks/google-play',
      GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT: 'push@p.iam.gserviceaccount.com',
      APPLE_BUNDLE_ID: 'com.x',
      APPLE_APP_APPLE_ID: '123',
      APPLE_ENVIRONMENT: 'Sandbox',
      APPLE_ALLOW_SANDBOX: 'FALSE',
      APPLE_ROOT_CERTS_DIR: './roots',
      APPLE_IAP_KEY_ID: 'K',
      APPLE_IAP_ISSUER_ID: 'I',
      APPLE_IAP_PRIVATE_KEY_PATH: './certs/k.p8',
    });
    expect(storeConfig()).toEqual({
      google: {
        packageName: 'com.other',
        serviceAccountPath: './certs/play.json',
        pubsubAudience: 'https://api.sesly.io/webhooks/google-play',
        pubsubServiceAccount: 'push@p.iam.gserviceaccount.com',
      },
      apple: {
        bundleId: 'com.x',
        appAppleId: '123',
        environment: 'Sandbox',
        allowSandbox: false,
        rootCertsDir: './roots',
        keyId: 'K',
        issuerId: 'I',
        privateKeyPath: './certs/k.p8',
      },
    });

    withEnv({});
    const defaults = storeConfig();
    expect(defaults.google.packageName).toBe('com.sesly');
    expect(defaults.google.serviceAccountPath).toBe('');
    expect(defaults.apple.bundleId).toBe('com.sesly');
    expect(defaults.apple.environment).toBe('Production');
    expect(defaults.apple.allowSandbox).toBe(true);
    expect(defaults.apple.rootCertsDir).toBe('./assets/apple-root-certs');
  });

  describe('jwt', () => {
    it('uses the environment secrets when present', () => {
      withEnv({
        JWT_SECRET: 's1',
        JWT_REFRESH_SECRET: 's2',
        JWT_ADMIN_SECRET: 's3',
        JWT_ADMIN_REFRESH_SECRET: 's4',
        JWT_EXPIRES_IN: '15m',
      });
      expect(jwtConfig()).toEqual({
        secret: 's1',
        refreshSecret: 's2',
        expiresIn: '15m',
        refreshExpiresIn: '7d',
        adminSecret: 's3',
        adminRefreshSecret: 's4',
      });
    });

    // Fixed: production fails at boot when any secret is missing. The first
    // version of this test expected `undefined` secrets for an empty env; the
    // agreed behaviour keeps dev-only fallbacks outside production (so local
    // dev needs no setup) and throws in production instead.
    it('never falls back to a hardcoded signing secret in production', () => {
      withEnv({ NODE_ENV: 'production' });
      expect(() => jwtConfig()).toThrow(
        /Missing JWT secret\(s\) in production: JWT_SECRET, JWT_REFRESH_SECRET, JWT_ADMIN_SECRET, JWT_ADMIN_REFRESH_SECRET/,
      );
    });

    it('production: a single missing or blank secret is enough to refuse booting', () => {
      withEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 's1',
        JWT_REFRESH_SECRET: 's2',
        JWT_ADMIN_SECRET: '   ',
      });
      expect(() => jwtConfig()).toThrow(/JWT_ADMIN_SECRET, JWT_ADMIN_REFRESH_SECRET/);
    });

    it('production: the .env.example placeholder TODO_SET_ME counts as missing', () => {
      withEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'TODO_SET_ME',
        JWT_REFRESH_SECRET: 's2',
        JWT_ADMIN_SECRET: 's3',
        JWT_ADMIN_REFRESH_SECRET: 's4',
      });
      expect(() => jwtConfig()).toThrow(/in production: JWT_SECRET\./);
    });

    it('production with every secret set boots and uses them verbatim', () => {
      withEnv({
        NODE_ENV: 'production',
        JWT_SECRET: ' s1',
        JWT_REFRESH_SECRET: 's2',
        JWT_ADMIN_SECRET: 's3',
        JWT_ADMIN_REFRESH_SECRET: 's4',
      });
      expect(jwtConfig()).toMatchObject({
        secret: ' s1',
        refreshSecret: 's2',
        adminSecret: 's3',
        adminRefreshSecret: 's4',
      });
    });

    it('outside production a missing secret uses a distinct dev-only fallback', () => {
      withEnv({ NODE_ENV: 'development', JWT_SECRET: 'from-env' });
      const cfg = jwtConfig();
      expect(cfg.secret).toBe('from-env');
      for (const value of [cfg.refreshSecret, cfg.adminSecret, cfg.adminRefreshSecret]) {
        expect(value).toMatch(/^dev-only-/);
      }
      expect(new Set([cfg.refreshSecret, cfg.adminSecret, cfg.adminRefreshSecret]).size).toBe(3);
    });
  });
});
