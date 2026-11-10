import { registerAs } from '@nestjs/config';

/**
 * In-app purchase connection data (paths, ids, audiences; never secrets
 * inline). See "In-app purchases" in CLAUDE.md and .env.example.
 */
export default registerAs('store', () => ({
  google: {
    // Package every Play purchase must belong to.
    packageName: process.env.GOOGLE_PACKAGE_NAME || 'com.sesly',
    // Service account JSON with access to the Play Developer API
    // (scope androidpublisher). Unset: Play validation answers 503.
    serviceAccountPath: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PATH || '',
    // Pub/Sub push authentication of POST /webhooks/google-play: the OIDC
    // token must carry this audience and this service account email.
    pubsubAudience: process.env.GOOGLE_PLAY_PUBSUB_AUDIENCE || '',
    pubsubServiceAccount: process.env.GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT || '',
  },
  apple: {
    bundleId: process.env.APPLE_BUNDLE_ID || 'com.sesly',
    // Numeric Apple ID of the app (App Store Connect, App Information).
    // Required to verify Production data.
    appAppleId: process.env.APPLE_APP_APPLE_ID || '',
    // Production | Sandbox: the environment tried first. Sandbox data is
    // also accepted when APPLE_ALLOW_SANDBOX is not "false" (App Review and
    // TestFlight purchase in the sandbox against the production server).
    environment: process.env.APPLE_ENVIRONMENT || 'Production',
    allowSandbox: (process.env.APPLE_ALLOW_SANDBOX || 'true').toLowerCase() !== 'false',
    // Directory with the Apple root certificates (.cer DER or .pem).
    rootCertsDir: process.env.APPLE_ROOT_CERTS_DIR || './assets/apple-root-certs',
    // App Store Server API key (In-App Purchase key). Optional: with it the
    // backend re-reads the latest subscription status from Apple.
    keyId: process.env.APPLE_IAP_KEY_ID || '',
    issuerId: process.env.APPLE_IAP_ISSUER_ID || '',
    privateKeyPath: process.env.APPLE_IAP_PRIVATE_KEY_PATH || '',
  },
}));
