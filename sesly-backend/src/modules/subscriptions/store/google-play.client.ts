import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { StoreConfigError, StoreRejectedError, StoreTransientError } from './store-errors';

export const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';

/** The parts of purchases.subscriptionsv2 (SubscriptionPurchaseV2) we read. */
export interface GoogleSubscriptionV2 {
  subscriptionState?: string;
  acknowledgementState?: string;
  linkedPurchaseToken?: string;
  latestOrderId?: string;
  testPurchase?: Record<string, unknown>;
  startTime?: string;
  externalAccountIdentifiers?: {
    obfuscatedExternalAccountId?: string;
    obfuscatedExternalProfileId?: string;
  };
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
    latestSuccessfulOrderId?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
    prepaidPlan?: Record<string, unknown>;
  }>;
}

interface RequestClient {
  request(opts: { url: string; method: string; data?: unknown }): Promise<{ data: any }>;
}

/**
 * Google Play Developer API (purchases.subscriptionsv2.get, acknowledge)
 * with a service account, and the Pub/Sub push OIDC check for real-time
 * developer notifications. Every network failure is mapped to one of the
 * store error classes; nothing here writes to the database.
 */
@Injectable()
export class GooglePlayClient {
  private readonly logger = new Logger(GooglePlayClient.name);
  private authClient: Promise<RequestClient> | null = null;
  private readonly oidc = new OAuth2Client();

  constructor(private config: ConfigService) {}

  get packageName(): string {
    return this.config.get<string>('store.google.packageName') || 'com.sesly';
  }

  isConfigured(): boolean {
    return !!this.config.get<string>('store.google.serviceAccountPath');
  }

  private client(): Promise<RequestClient> {
    const keyFile = this.config.get<string>('store.google.serviceAccountPath');
    if (!keyFile) {
      return Promise.reject(new StoreConfigError('GOOGLE_PLAY_SERVICE_ACCOUNT_PATH is not set'));
    }
    if (!this.authClient) {
      const auth = new GoogleAuth({ keyFile, scopes: [ANDROID_PUBLISHER_SCOPE] });
      this.authClient = (auth.getClient() as Promise<unknown> as Promise<RequestClient>).catch((error) => {
        this.authClient = null;
        throw new StoreConfigError(`Play service account unusable: ${error?.message ?? error}`);
      });
    }
    return this.authClient;
  }

  async getSubscription(purchaseToken: string): Promise<GoogleSubscriptionV2> {
    const client = await this.client();
    const url = `${API_BASE}/${encodeURIComponent(this.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    try {
      const response = await client.request({ url, method: 'GET' });
      return (response?.data ?? {}) as GoogleSubscriptionV2;
    } catch (error) {
      throw this.mapError(error, 'subscriptionsv2.get');
    }
  }

  async acknowledge(productId: string, purchaseToken: string): Promise<void> {
    const client = await this.client();
    const url = `${API_BASE}/${encodeURIComponent(this.packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
    try {
      await client.request({ url, method: 'POST', data: {} });
    } catch (error) {
      throw this.mapError(error, 'subscriptions.acknowledge');
    }
  }

  private mapError(error: any, call: string): Error {
    const status = Number(error?.response?.status ?? error?.status ?? error?.code);
    this.logger.warn(`Play ${call} failed (status=${Number.isFinite(status) ? status : 'n/a'}): ${error?.message ?? error}`);
    if (status === 400 || status === 404 || status === 410) {
      return new StoreRejectedError(`Play ${call} rejected the token (${status})`);
    }
    if (status === 401 || status === 403) {
      return new StoreConfigError(`Play ${call} refused our credentials (${status})`);
    }
    return new StoreTransientError(`Play ${call} unavailable`);
  }

  /**
   * Pub/Sub push authentication: the request carries
   * `Authorization: Bearer <OIDC token>` signed by Google for the push
   * subscription's service account. Checks signature, expiry, issuer,
   * audience, email and email_verified. Throws StoreConfigError when the
   * expected audience / account are not configured (fail closed) and
   * StoreRejectedError for any bad token.
   */
  async verifyPushToken(authorization: string | undefined): Promise<void> {
    const audience = this.config.get<string>('store.google.pubsubAudience');
    const email = this.config.get<string>('store.google.pubsubServiceAccount');
    if (!audience || !email) {
      throw new StoreConfigError('GOOGLE_PLAY_PUBSUB_AUDIENCE / GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT not set');
    }
    const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
    if (!match) throw new StoreRejectedError('Missing bearer token');

    let payload: { email?: string; email_verified?: boolean } | undefined;
    try {
      const ticket = await this.oidc.verifyIdToken({ idToken: match[1].trim(), audience });
      payload = ticket.getPayload();
    } catch (error: any) {
      throw new StoreRejectedError(`Invalid push token: ${error?.message ?? error}`);
    }
    if (!payload || payload.email !== email || payload.email_verified !== true) {
      throw new StoreRejectedError('Push token of an unexpected account');
    }
  }
}
