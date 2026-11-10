// AppleStrategy / GoogleStrategy are not registered in AuthModule today (mobile
// signs in through Firebase). These are light tests so a future re-wire starts
// from known behavior. No network: apple-signin-auth is mocked and the Google
// strategy constructor performs no I/O.
jest.mock('apple-signin-auth', () => ({
  __esModule: true,
  default: { verifyIdToken: jest.fn() },
}));

import { AppleStrategy } from './apple.strategy';
import { GoogleStrategy } from './google.strategy';

const appleSignin = (jest.requireMock('apple-signin-auth') as any).default as { verifyIdToken: jest.Mock };

function config(map: Record<string, string | undefined>) {
  return { get: jest.fn((k: string) => map[k]) };
}

describe('AppleStrategy', () => {
  it('rejects a request without id_token', async () => {
    const strategy = new AppleStrategy(config({ APPLE_CLIENT_ID: 'io.sesly.app.test' }) as any);

    await expect(strategy.validate({ body: {} })).rejects.toThrow('No id_token provided');
    expect(appleSignin.verifyIdToken).not.toHaveBeenCalled();
  });

  it('verifies against the configured client id and maps the claims', async () => {
    const strategy = new AppleStrategy(config({ APPLE_CLIENT_ID: 'io.sesly.app.test' }) as any);
    appleSignin.verifyIdToken.mockResolvedValue({ sub: 'apple-sub-1', email: 'x@privaterelay.appleid.com', email_verified: 'true' });

    const user = await strategy.validate({ body: { id_token: 'apple-id-token' } });

    expect(appleSignin.verifyIdToken).toHaveBeenCalledWith(
      'apple-id-token',
      expect.objectContaining({ audience: 'io.sesly.app.test' }),
    );
    expect(user).toEqual({
      providerId: 'apple-sub-1',
      email: 'x@privaterelay.appleid.com',
      emailVerified: true,
      provider: 'APPLE',
    });
  });

  it('falls back to the default client id when APPLE_CLIENT_ID is not set', async () => {
    const strategy = new AppleStrategy(config({}) as any);
    appleSignin.verifyIdToken.mockResolvedValue({ sub: 's', email: 'e@x.com', email_verified: 'false' });

    const user = await strategy.validate({ body: { id_token: 't' } });

    expect(appleSignin.verifyIdToken).toHaveBeenCalledWith('t', expect.objectContaining({ audience: 'io.sesly.app' }));
    expect(user.emailVerified).toBe(false);
  });

  it('wraps verification failures', async () => {
    const strategy = new AppleStrategy(config({ APPLE_CLIENT_ID: 'io.sesly.app.test' }) as any);
    appleSignin.verifyIdToken.mockRejectedValue(new Error('jwt audience invalid'));

    await expect(strategy.validate({ body: { id_token: 't' } })).rejects.toThrow(/Apple Sign-In verification failed/);
  });

  // Fixed (was a latent BUG, the strategy is not registered in AuthModule):
  // only the string "true" was mapped to verified, never the boolean true.
  // (The hardcoded `nonce: 'nonce'` is left as is: the strategy is unused.)
  it('treats a boolean email_verified=true claim as verified', async () => {
    const strategy = new AppleStrategy(config({ APPLE_CLIENT_ID: 'io.sesly.app.test' }) as any);
    appleSignin.verifyIdToken.mockResolvedValue({ sub: 's', email: 'e@x.com', email_verified: true });

    const user = await strategy.validate({ body: { id_token: 't' } });

    expect(user.emailVerified).toBe(true);
  });
});

describe('GoogleStrategy', () => {
  it('constructs with dummy credentials when Google OAuth is not configured', () => {
    expect(() => new GoogleStrategy(config({}) as any)).not.toThrow();
  });

  it('prefers namespaced config keys', () => {
    const cfg = config({ 'google.clientId': 'cid', 'google.clientSecret': 'csecret', GOOGLE_CALLBACK_URL: 'https://api/cb' });
    const strategy: any = new GoogleStrategy(cfg as any);

    expect(strategy._oauth2._clientId).toBe('cid');
    expect(strategy._callbackURL).toBe('https://api/cb');
  });

  it('validate() maps the Google profile and hands it to done()', async () => {
    const strategy = new GoogleStrategy(config({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 's' }) as any);
    const done = jest.fn();

    await strategy.validate(
      'access',
      'refresh',
      { id: 'g-123', emails: [{ value: 'ayse@gmail.com' }], name: { givenName: 'Ayse', familyName: 'Yilmaz' } },
      done,
    );

    expect(done).toHaveBeenCalledWith(null, {
      providerId: 'g-123',
      email: 'ayse@gmail.com',
      firstName: 'Ayse',
      lastName: 'Yilmaz',
      provider: 'GOOGLE',
    });
  });
});
