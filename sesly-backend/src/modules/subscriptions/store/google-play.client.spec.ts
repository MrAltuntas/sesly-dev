const mockRequest = jest.fn();
const mockGetClient = jest.fn();
const mockVerifyIdToken = jest.fn();
const mockGoogleAuth = jest.fn();

jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn().mockImplementation((opts: unknown) => {
    mockGoogleAuth(opts);
    return { getClient: mockGetClient };
  }),
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken })),
}));

import { ANDROID_PUBLISHER_SCOPE, GooglePlayClient } from './google-play.client';
import { StoreConfigError, StoreRejectedError, StoreTransientError } from './store-errors';

const PUSH_SA = 'play-push@sesly.iam.gserviceaccount.com';
const AUDIENCE = 'https://api.sesly.io/webhooks/google-play';

function client(config: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    'store.google.packageName': 'com.sesly',
    'store.google.serviceAccountPath': './certs/play.json',
    'store.google.pubsubAudience': AUDIENCE,
    'store.google.pubsubServiceAccount': PUSH_SA,
    ...config,
  };
  return new GooglePlayClient({ get: (key: string) => values[key] } as any);
}

describe('GooglePlayClient', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockGetClient.mockReset().mockResolvedValue({ request: mockRequest });
    mockVerifyIdToken.mockReset();
    mockGoogleAuth.mockReset();
  });

  it('subscriptionsv2.get with the service account and the androidpublisher scope, configured package only', async () => {
    mockRequest.mockResolvedValue({ data: { subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' } });
    const play = client();

    await expect(play.getSubscription('tok/en')).resolves.toEqual({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' });
    expect(mockGoogleAuth).toHaveBeenCalledWith({ keyFile: './certs/play.json', scopes: [ANDROID_PUBLISHER_SCOPE] });
    expect(mockRequest).toHaveBeenCalledWith({
      url: 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.sesly/purchases/subscriptionsv2/tokens/tok%2Fen',
      method: 'GET',
    });

    // The auth client is created once.
    mockRequest.mockResolvedValue({});
    await expect(play.getSubscription('t2')).resolves.toEqual({});
    expect(mockGetClient).toHaveBeenCalledTimes(1);
  });

  it('acknowledge posts to purchases.subscriptions:acknowledge', async () => {
    mockRequest.mockResolvedValue({ data: '' });
    await client().acknowledge('pro_monthly', 'tok');
    expect(mockRequest).toHaveBeenCalledWith({
      url: 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.sesly/purchases/subscriptions/pro_monthly/tokens/tok:acknowledge',
      method: 'POST',
      data: {},
    });
  });

  it('maps errors: 400/404/410 rejected, 401/403 config, anything else transient', async () => {
    const play = client();
    const cases: Array<[any, any]> = [
      [{ response: { status: 404 } }, StoreRejectedError],
      [{ response: { status: 410 } }, StoreRejectedError],
      [{ status: 400 }, StoreRejectedError],
      [{ response: { status: 401 } }, StoreConfigError],
      [{ code: 403 }, StoreConfigError],
      [{ response: { status: 503 } }, StoreTransientError],
      [{ code: 'ECONNRESET', message: 'socket hang up' }, StoreTransientError],
    ];
    for (const [error, type] of cases) {
      mockRequest.mockRejectedValueOnce(error);
      await expect(play.getSubscription('t')).rejects.toBeInstanceOf(type);
    }
    mockRequest.mockRejectedValueOnce({ response: { status: 500 } });
    await expect(play.acknowledge('p', 't')).rejects.toBeInstanceOf(StoreTransientError);
  });

  it('no service account path: StoreConfigError, nothing is called', async () => {
    const play = client({ 'store.google.serviceAccountPath': '' });
    expect(play.isConfigured()).toBe(false);
    await expect(play.getSubscription('t')).rejects.toBeInstanceOf(StoreConfigError);
    expect(mockGoogleAuth).not.toHaveBeenCalled();
  });

  it('an unusable key file is a StoreConfigError and is retried on the next call', async () => {
    mockGetClient.mockRejectedValueOnce(new Error('ENOENT'));
    const play = client();
    await expect(play.getSubscription('t')).rejects.toBeInstanceOf(StoreConfigError);
    mockRequest.mockResolvedValue({ data: { ok: true } });
    await expect(play.getSubscription('t')).resolves.toEqual({ ok: true });
  });

  it('defaults the package name to com.sesly', () => {
    expect(client({ 'store.google.packageName': undefined }).packageName).toBe('com.sesly');
  });

  describe('verifyPushToken (Pub/Sub push OIDC)', () => {
    const ticket = (payload: unknown) => ({ getPayload: () => payload });

    it('accepts a token for our audience from the configured, verified account', async () => {
      mockVerifyIdToken.mockResolvedValue(ticket({ email: PUSH_SA, email_verified: true }));
      await expect(client().verifyPushToken('Bearer abc.def.ghi')).resolves.toBeUndefined();
      expect(mockVerifyIdToken).toHaveBeenCalledWith({ idToken: 'abc.def.ghi', audience: AUDIENCE });
    });

    it('rejects a missing header, a bad signature / audience, another account and an unverified email', async () => {
      const play = client();
      await expect(play.verifyPushToken(undefined)).rejects.toBeInstanceOf(StoreRejectedError);
      await expect(play.verifyPushToken('Basic x')).rejects.toBeInstanceOf(StoreRejectedError);

      mockVerifyIdToken.mockRejectedValueOnce(new Error('Wrong recipient, payload audience != requiredAudience'));
      await expect(play.verifyPushToken('Bearer t')).rejects.toBeInstanceOf(StoreRejectedError);
      mockVerifyIdToken.mockRejectedValueOnce('string error');
      await expect(play.verifyPushToken('Bearer t')).rejects.toBeInstanceOf(StoreRejectedError);

      mockVerifyIdToken.mockResolvedValueOnce(ticket({ email: 'attacker@evil.iam.gserviceaccount.com', email_verified: true }));
      await expect(play.verifyPushToken('Bearer t')).rejects.toBeInstanceOf(StoreRejectedError);
      mockVerifyIdToken.mockResolvedValueOnce(ticket({ email: PUSH_SA, email_verified: false }));
      await expect(play.verifyPushToken('Bearer t')).rejects.toBeInstanceOf(StoreRejectedError);
      mockVerifyIdToken.mockResolvedValueOnce(ticket(undefined));
      await expect(play.verifyPushToken('Bearer t')).rejects.toBeInstanceOf(StoreRejectedError);
    });

    it('fails closed when the audience or the push account is not configured', async () => {
      await expect(client({ 'store.google.pubsubAudience': '' }).verifyPushToken('Bearer t')).rejects.toBeInstanceOf(StoreConfigError);
      await expect(client({ 'store.google.pubsubServiceAccount': '' }).verifyPushToken('Bearer t')).rejects.toBeInstanceOf(StoreConfigError);
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });
  });
});
