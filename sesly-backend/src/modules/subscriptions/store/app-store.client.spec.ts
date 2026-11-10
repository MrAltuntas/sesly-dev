import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const verifierInstances: any[] = [];
const apiInstances: any[] = [];
const mockStatuses = jest.fn();

jest.mock('@apple/app-store-server-library', () => {
  class VerificationException extends Error {
    constructor(public status: number) {
      super(`verification ${status}`);
    }
  }
  class APIException extends Error {
    constructor(public httpStatusCode: number) {
      super(`api ${httpStatusCode}`);
    }
  }
  return {
    Environment: { SANDBOX: 'Sandbox', PRODUCTION: 'Production' },
    VerificationStatus: {
      OK: 0,
      VERIFICATION_FAILURE: 1,
      RETRYABLE_VERIFICATION_FAILURE: 2,
      INVALID_APP_IDENTIFIER: 3,
      INVALID_ENVIRONMENT: 4,
    },
    VerificationException,
    APIException,
    SignedDataVerifier: jest.fn().mockImplementation((roots, online, environment, bundleId, appAppleId) => {
      const instance = {
        args: { roots, online, environment, bundleId, appAppleId },
        verifyAndDecodeTransaction: jest.fn(),
        verifyAndDecodeRenewalInfo: jest.fn(),
        verifyAndDecodeNotification: jest.fn(),
      };
      verifierInstances.push(instance);
      return instance;
    }),
    AppStoreServerAPIClient: jest.fn().mockImplementation((key, keyId, issuerId, bundleId, environment) => {
      const instance = {
        args: { key, keyId, issuerId, bundleId, environment },
        getAllSubscriptionStatuses: (...args: unknown[]) => mockStatuses(...args),
      };
      apiInstances.push(instance);
      return instance;
    }),
  };
});

import { APIException, VerificationException } from '@apple/app-store-server-library';
import { AppStoreClient } from './app-store.client';
import { StoreConfigError, StoreRejectedError, StoreTransientError } from './store-errors';

const FIXTURES = path.join(__dirname, '__fixtures__');

describe('AppStoreClient', () => {
  let tmp: string;

  beforeEach(() => {
    verifierInstances.length = 0;
    apiInstances.length = 0;
    mockStatuses.mockReset();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function client(config: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = {
      'store.apple.bundleId': 'com.sesly',
      'store.apple.appAppleId': '6400000000',
      'store.apple.environment': 'Production',
      'store.apple.allowSandbox': true,
      'store.apple.rootCertsDir': FIXTURES,
      ...config,
    };
    return new AppStoreClient({ get: (key: string) => values[key] } as any);
  }

  it('loads DER and PEM root certificates and builds Production then Sandbox verifiers with online checks', () => {
    const apple = client();
    expect(apple.loadRootCertificates()).toHaveLength(2);
    expect(apple.isConfigured()).toBe(true);
    expect(verifierInstances.map((v) => v.args.environment)).toEqual(['Production', 'Sandbox']);
    expect(verifierInstances[0].args).toMatchObject({ online: true, bundleId: 'com.sesly', appAppleId: 6400000000 });
    expect(apple.bundleId).toBe('com.sesly');
    // Cached.
    apple.isConfigured();
    expect(verifierInstances).toHaveLength(2);
  });

  it('no certificates (missing directory, unreadable file): not configured, StoreConfigError', async () => {
    fs.writeFileSync(path.join(tmp, 'broken.cer'), 'not a certificate');
    fs.writeFileSync(path.join(tmp, 'readme.txt'), 'ignored');
    const apple = client({ 'store.apple.rootCertsDir': tmp });
    expect(apple.isConfigured()).toBe(false);
    await expect(apple.verifyTransaction('x')).rejects.toBeInstanceOf(StoreConfigError);
    expect(client({ 'store.apple.rootCertsDir': path.join(tmp, 'missing') }).isConfigured()).toBe(false);
    expect(client({ 'store.apple.rootCertsDir': undefined }).loadRootCertificates()).toEqual(expect.any(Array));
  });

  it('Production without APPLE_APP_APPLE_ID only verifies Sandbox; Sandbox-only and no-sandbox setups', () => {
    client({ 'store.apple.appAppleId': '' }).isConfigured();
    expect(verifierInstances.map((v) => v.args.environment)).toEqual(['Sandbox']);
    verifierInstances.length = 0;
    client({ 'store.apple.environment': 'sandbox' }).isConfigured();
    expect(verifierInstances.map((v) => v.args.environment)).toEqual(['Sandbox']);
    verifierInstances.length = 0;
    client({ 'store.apple.allowSandbox': false }).isConfigured();
    expect(verifierInstances.map((v) => v.args.environment)).toEqual(['Production']);
    verifierInstances.length = 0;
    expect(client({ 'store.apple.allowSandbox': false, 'store.apple.appAppleId': undefined }).isConfigured()).toBe(false);
    expect(client({ 'store.apple.bundleId': undefined, 'store.apple.environment': undefined }).bundleId).toBe('com.sesly');
  });

  it('a wrong-environment failure moves on to the Sandbox verifier', async () => {
    const apple = client();
    apple.isConfigured();
    const [prod, sandbox] = verifierInstances;
    prod.verifyAndDecodeTransaction.mockRejectedValue(new (VerificationException as any)(4));
    sandbox.verifyAndDecodeTransaction.mockResolvedValue({ transactionId: '1' });
    await expect(apple.verifyTransaction('jws')).resolves.toEqual({ transactionId: '1' });

    prod.verifyAndDecodeRenewalInfo.mockResolvedValue({ autoRenewStatus: 1 });
    await expect(apple.verifyRenewalInfo('jws')).resolves.toEqual({ autoRenewStatus: 1 });
    prod.verifyAndDecodeNotification.mockResolvedValue({ notificationType: 'TEST' });
    await expect(apple.verifyNotification('jws')).resolves.toEqual({ notificationType: 'TEST' });
  });

  it('maps failures: retryable to transient, any other verification failure or garbage to rejected', async () => {
    const apple = client();
    apple.isConfigured();
    const [prod, sandbox] = verifierInstances;
    prod.verifyAndDecodeTransaction.mockRejectedValueOnce(new (VerificationException as any)(2));
    await expect(apple.verifyTransaction('jws')).rejects.toBeInstanceOf(StoreTransientError);
    prod.verifyAndDecodeTransaction.mockRejectedValueOnce(new (VerificationException as any)(3));
    await expect(apple.verifyTransaction('jws')).rejects.toBeInstanceOf(StoreRejectedError);
    prod.verifyAndDecodeTransaction.mockRejectedValueOnce(new Error('Malformed'));
    await expect(apple.verifyTransaction('jws')).rejects.toBeInstanceOf(StoreRejectedError);
    // Both environments wrong: rejected.
    prod.verifyAndDecodeTransaction.mockRejectedValueOnce(new (VerificationException as any)(4));
    sandbox.verifyAndDecodeTransaction.mockRejectedValueOnce(new (VerificationException as any)(4));
    await expect(apple.verifyTransaction('jws')).rejects.toBeInstanceOf(StoreRejectedError);
  });

  describe('App Store Server API', () => {
    const keyPath = () => {
      const file = path.join(tmp, 'key.p8');
      fs.writeFileSync(file, '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n');
      return file;
    };
    const apiConfig = () => ({
      'store.apple.keyId': 'KEY123',
      'store.apple.issuerId': 'issuer-uuid',
      'store.apple.privateKeyPath': keyPath(),
    });

    it('hasServerApi needs key id, issuer id and key path', () => {
      expect(client().hasServerApi()).toBe(false);
      expect(client(apiConfig()).hasServerApi()).toBe(true);
    });

    it('returns the last transaction of the requested subscription, one client per environment', async () => {
      const apple = client(apiConfig());
      const statuses = {
        data: [
          {
            lastTransactions: [
              { originalTransactionId: 'other', status: 1, signedTransactionInfo: 'x' },
              { originalTransactionId: '2000', status: 4, signedTransactionInfo: 'tx', signedRenewalInfo: 'ren' },
            ],
          },
        ],
      };
      mockStatuses.mockResolvedValue(statuses);
      await expect(apple.getLatestStatus('2000', 'Sandbox')).resolves.toEqual({ status: 4, signedTransactionInfo: 'tx', signedRenewalInfo: 'ren' });
      expect(mockStatuses).toHaveBeenCalledWith('2000');
      expect(apiInstances[0].args).toMatchObject({ keyId: 'KEY123', issuerId: 'issuer-uuid', bundleId: 'com.sesly', environment: 'Sandbox' });

      await apple.getLatestStatus('2000', 'Sandbox');
      expect(apiInstances).toHaveLength(1);

      apiInstances.length = 0;
      mockStatuses.mockResolvedValue({ data: [{}] });
      await expect(apple.getLatestStatus('missing', 'Production')).resolves.toBeNull();
      expect(apiInstances[0].args.environment).toBe('Production');
      mockStatuses.mockResolvedValue({});
      await expect(apple.getLatestStatus('missing', 'Production')).resolves.toBeNull();
      mockStatuses.mockResolvedValue({ data: [{ lastTransactions: [{ originalTransactionId: 'missing' }] }] });
      await expect(apple.getLatestStatus('missing', 'Production')).resolves.toEqual({
        status: null,
        signedTransactionInfo: null,
        signedRenewalInfo: null,
      });
    });

    it('maps API errors: 404 null, 401/403 config, other 4xx rejected, 429 / 5xx / network transient', async () => {
      const apple = client(apiConfig());
      const call = (error: unknown) => {
        mockStatuses.mockRejectedValueOnce(error);
        return apple.getLatestStatus('2000', 'Production');
      };
      await expect(call(new (APIException as any)(404))).resolves.toBeNull();
      await expect(call(new (APIException as any)(401))).rejects.toBeInstanceOf(StoreConfigError);
      await expect(call(new (APIException as any)(400))).rejects.toBeInstanceOf(StoreRejectedError);
      await expect(call(new (APIException as any)(429))).rejects.toBeInstanceOf(StoreTransientError);
      await expect(call(new (APIException as any)(500))).rejects.toBeInstanceOf(StoreTransientError);
      await expect(call(new Error('ECONNRESET'))).rejects.toBeInstanceOf(StoreTransientError);
    });

    it('an unreadable key file is a StoreConfigError', async () => {
      const apple = client({ ...apiConfig(), 'store.apple.privateKeyPath': path.join(tmp, 'nope.p8') });
      await expect(apple.getLatestStatus('2000', 'Production')).rejects.toBeInstanceOf(StoreConfigError);
    });
  });
});
