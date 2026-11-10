import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { X509Certificate } from 'crypto';
import {
  APIException,
  AppStoreServerAPIClient,
  Environment,
  JWSRenewalInfoDecodedPayload,
  JWSTransactionDecodedPayload,
  ResponseBodyV2DecodedPayload,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
} from '@apple/app-store-server-library';
import { StoreConfigError, StoreRejectedError, StoreTransientError } from './store-errors';

export interface AppleLatestStatus {
  status: number | null;
  signedTransactionInfo: string | null;
  signedRenewalInfo: string | null;
}

/**
 * App Store signed data (JWS) verification with @apple/app-store-server-library
 * against the bundled Apple root certificates, plus the optional App Store
 * Server API client (latest subscription status). Nothing here writes to the
 * database.
 *
 * Environments: the configured one (APPLE_ENVIRONMENT, default Production) is
 * tried first; Sandbox data is accepted too unless APPLE_ALLOW_SANDBOX=false,
 * because App Review and TestFlight buy in the sandbox against the
 * production server. Production verification needs APPLE_APP_APPLE_ID.
 */
@Injectable()
export class AppStoreClient {
  private readonly logger = new Logger(AppStoreClient.name);
  private rootCerts: Buffer[] | null = null;
  private verifiers: SignedDataVerifier[] | null = null;
  private readonly apiClients = new Map<string, AppStoreServerAPIClient>();

  constructor(private config: ConfigService) {}

  get bundleId(): string {
    return this.config.get<string>('store.apple.bundleId') || 'com.sesly';
  }

  /** DER buffers of every .cer / .der / .pem file in the root certificate directory. */
  loadRootCertificates(): Buffer[] {
    if (this.rootCerts) return this.rootCerts;
    const dir = path.resolve(this.config.get<string>('store.apple.rootCertsDir') || './assets/apple-root-certs');
    const certs: Buffer[] = [];
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      this.logger.warn(`Apple root certificate directory not found: ${dir}`);
    }
    for (const file of files.sort()) {
      if (!/\.(cer|der|pem|crt)$/i.test(file)) continue;
      try {
        const raw = fs.readFileSync(path.join(dir, file));
        certs.push(new X509Certificate(raw).raw);
      } catch (error: any) {
        this.logger.warn(`Apple root certificate ${file} unreadable: ${error?.message ?? error}`);
      }
    }
    this.rootCerts = certs;
    return certs;
  }

  isConfigured(): boolean {
    return this.verifierList().length > 0;
  }

  private environments(): Environment[] {
    const primary =
      (this.config.get<string>('store.apple.environment') || 'Production').toLowerCase() === 'sandbox'
        ? Environment.SANDBOX
        : Environment.PRODUCTION;
    const allowSandbox = this.config.get<boolean>('store.apple.allowSandbox') !== false;
    const list = [primary];
    if (primary === Environment.PRODUCTION && allowSandbox) list.push(Environment.SANDBOX);
    return list;
  }

  private appAppleId(): number | undefined {
    const raw = this.config.get<string>('store.apple.appAppleId');
    const id = raw ? Number(raw) : NaN;
    return Number.isFinite(id) && id > 0 ? id : undefined;
  }

  private verifierList(): SignedDataVerifier[] {
    if (this.verifiers) return this.verifiers;
    const roots = this.loadRootCertificates();
    if (roots.length === 0) {
      this.verifiers = [];
      return this.verifiers;
    }
    const appAppleId = this.appAppleId();
    const list: SignedDataVerifier[] = [];
    for (const environment of this.environments()) {
      if (environment === Environment.PRODUCTION && appAppleId === undefined) {
        this.logger.warn('APPLE_APP_APPLE_ID is not set: Production App Store data cannot be verified');
        continue;
      }
      list.push(new SignedDataVerifier(roots, true, environment, this.bundleId, appAppleId));
    }
    this.verifiers = list;
    return list;
  }

  /** Try each environment in order; only a wrong-environment failure moves on. */
  private async verify<T>(call: (verifier: SignedDataVerifier) => Promise<T>): Promise<T> {
    const verifiers = this.verifierList();
    if (verifiers.length === 0) {
      throw new StoreConfigError('No Apple root certificates or environment configured');
    }
    let lastError: unknown;
    for (const verifier of verifiers) {
      try {
        return await call(verifier);
      } catch (error) {
        lastError = error;
        if (error instanceof VerificationException && error.status === VerificationStatus.INVALID_ENVIRONMENT) {
          continue;
        }
        break;
      }
    }
    throw this.mapVerificationError(lastError);
  }

  private mapVerificationError(error: unknown): Error {
    if (error instanceof VerificationException) {
      if (error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE) {
        return new StoreTransientError('Apple verification could not complete (retryable)');
      }
      return new StoreRejectedError(`Apple signed data rejected (status ${error.status})`);
    }
    return new StoreRejectedError(`Apple signed data unreadable: ${(error as Error)?.message ?? error}`);
  }

  verifyTransaction(signedTransaction: string): Promise<JWSTransactionDecodedPayload> {
    return this.verify((v) => v.verifyAndDecodeTransaction(signedTransaction));
  }

  verifyRenewalInfo(signedRenewalInfo: string): Promise<JWSRenewalInfoDecodedPayload> {
    return this.verify((v) => v.verifyAndDecodeRenewalInfo(signedRenewalInfo));
  }

  verifyNotification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload> {
    return this.verify((v) => v.verifyAndDecodeNotification(signedPayload));
  }

  /** App Store Server API credentials present (key id, issuer id, .p8 path). */
  hasServerApi(): boolean {
    return !!(
      this.config.get<string>('store.apple.keyId') &&
      this.config.get<string>('store.apple.issuerId') &&
      this.config.get<string>('store.apple.privateKeyPath')
    );
  }

  private apiClient(environment: string): AppStoreServerAPIClient {
    const env = environment === Environment.SANDBOX ? Environment.SANDBOX : Environment.PRODUCTION;
    const cached = this.apiClients.get(env);
    if (cached) return cached;
    let key: string;
    try {
      key = fs.readFileSync(path.resolve(this.config.get<string>('store.apple.privateKeyPath') as string), 'utf8');
    } catch (error: any) {
      throw new StoreConfigError(`Apple In-App Purchase key unreadable: ${error?.message ?? error}`);
    }
    const client = new AppStoreServerAPIClient(
      key,
      this.config.get<string>('store.apple.keyId') as string,
      this.config.get<string>('store.apple.issuerId') as string,
      this.bundleId,
      env,
    );
    this.apiClients.set(env, client);
    return client;
  }

  /**
   * Latest signed transaction + renewal info of one subscription
   * (Get All Subscription Statuses). null when Apple does not know it.
   */
  async getLatestStatus(originalTransactionId: string, environment: string): Promise<AppleLatestStatus | null> {
    const client = this.apiClient(environment);
    try {
      const response = await client.getAllSubscriptionStatuses(originalTransactionId);
      for (const group of response.data ?? []) {
        for (const item of group.lastTransactions ?? []) {
          if (item.originalTransactionId === originalTransactionId) {
            return {
              status: typeof item.status === 'number' ? item.status : null,
              signedTransactionInfo: item.signedTransactionInfo ?? null,
              signedRenewalInfo: item.signedRenewalInfo ?? null,
            };
          }
        }
      }
      return null;
    } catch (error) {
      if (error instanceof APIException) {
        if (error.httpStatusCode === 404) return null;
        if (error.httpStatusCode === 401 || error.httpStatusCode === 403) {
          throw new StoreConfigError(`App Store Server API refused our key (${error.httpStatusCode})`);
        }
        if (error.httpStatusCode >= 400 && error.httpStatusCode < 500 && error.httpStatusCode !== 429) {
          throw new StoreRejectedError(`App Store Server API rejected the request (${error.httpStatusCode})`);
        }
      }
      throw new StoreTransientError('App Store Server API unavailable');
    }
  }
}
