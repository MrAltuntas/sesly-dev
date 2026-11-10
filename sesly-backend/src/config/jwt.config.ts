import { registerAs } from '@nestjs/config';

/**
 * Signing secrets. Production MUST provide all four through the environment:
 * the app refuses to boot otherwise, so a missing variable can never make it
 * sign tokens with a key that is committed to the repository.
 *
 * Outside production (local dev, tests, e2e scripts) a missing secret falls
 * back to a fixed dev-only value so `npm run start:dev` works without setup.
 */
export const REQUIRED_JWT_SECRET_ENV = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_ADMIN_SECRET',
  'JWT_ADMIN_REFRESH_SECRET',
] as const;

type JwtSecretEnv = (typeof REQUIRED_JWT_SECRET_ENV)[number];

const DEV_FALLBACK_SECRETS: Record<JwtSecretEnv, string> = {
  JWT_SECRET: 'dev-only-jwt-secret-do-not-use-in-production',
  JWT_REFRESH_SECRET: 'dev-only-jwt-refresh-secret-do-not-use-in-production',
  JWT_ADMIN_SECRET: 'dev-only-jwt-admin-secret-do-not-use-in-production',
  JWT_ADMIN_REFRESH_SECRET: 'dev-only-jwt-admin-refresh-secret-do-not-use-in-production',
};

/** The value .env.example ships with; never a real secret. */
export const ENV_PLACEHOLDER = 'TODO_SET_ME';

function isUnset(value: string | undefined): boolean {
  const trimmed = value?.trim();
  return !trimmed || trimmed === ENV_PLACEHOLDER;
}

function resolveSecrets(): Record<JwtSecretEnv, string> {
  const isProduction = process.env.NODE_ENV === 'production';
  const missing = REQUIRED_JWT_SECRET_ENV.filter((name) => isUnset(process.env[name]));

  if (isProduction && missing.length > 0) {
    throw new Error(
      `Missing JWT secret(s) in production: ${missing.join(', ')}. ` +
        'Set every one of them to a long random value; the API refuses to start without them.',
    );
  }

  const out = {} as Record<JwtSecretEnv, string>;
  for (const name of REQUIRED_JWT_SECRET_ENV) {
    // The configured value is used verbatim (never trimmed) so existing
    // tokens stay valid; only a blank value counts as missing.
    out[name] = missing.includes(name) ? DEV_FALLBACK_SECRETS[name] : (process.env[name] as string);
  }
  return out;
}

export default registerAs('jwt', () => {
  const secrets = resolveSecrets();
  return {
    secret: secrets.JWT_SECRET,
    refreshSecret: secrets.JWT_REFRESH_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

    // Admin-specific JWT settings
    adminSecret: secrets.JWT_ADMIN_SECRET,
    adminRefreshSecret: secrets.JWT_ADMIN_REFRESH_SECRET,
  };
});
