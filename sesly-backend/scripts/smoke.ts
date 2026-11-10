/* eslint-disable no-console */
/**
 * Read-only smoke test for the Sesly backend.
 *
 * Hits a running local backend and verifies a handful of GET endpoints
 * respond correctly. Destructive / create / delete endpoints are NEVER
 * exercised here — they belong in the manual Gate 1 E2E checklist.
 *
 * Usage (bash):
 *   npm run smoke
 *   SMOKE_JWT=<token> npm run smoke
 *
 * Usage (PowerShell):
 *   $env:SMOKE_JWT = '<token>'; npm run smoke
 *
 * Configuration (environment variables):
 *   BASE_URL   default: http://localhost:3000
 *   SMOKE_JWT  user-supplied JWT. If unset, auth-required checks are skipped.
 */
import 'reflect-metadata';
import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';

// ----- ANSI colors (safe no-op on terminals without color support) -----
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const CHECK = `${colors.green}✓${colors.reset}`;
const CROSS = `${colors.red}✗${colors.reset}`;
const SKIP = `${colors.yellow}○${colors.reset}`;
const INFO = `${colors.cyan}›${colors.reset}`;

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const JWT = process.env.SMOKE_JWT;

let passed = 0;
let failed = 0;
let skipped = 0;

function logStep(message: string): void {
  console.log(`${INFO} ${message}`);
}

function logPass(message: string): void {
  passed++;
  console.log(`  ${CHECK} ${message}`);
}

function logFail(message: string, error?: unknown): void {
  failed++;
  console.log(`  ${CROSS} ${message}`);
  if (error) {
    const detail = formatError(error);
    if (detail) {
      console.log(`    ${colors.red}${detail}${colors.reset}`);
    }
  }
}

function logSkip(message: string, reason: string): void {
  skipped++;
  console.log(`  ${SKIP} ${message} ${colors.gray}(${reason})${colors.reset}`);
}

function formatError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const ax = error as AxiosError;
    const status = ax.response?.status ?? 'no response';
    const body =
      typeof ax.response?.data === 'object'
        ? JSON.stringify(ax.response?.data)
        : String(ax.response?.data ?? '');
    const trimmedBody = body.length > 200 ? `${body.slice(0, 200)}…` : body;
    return `HTTP ${status} ${ax.message}${trimmedBody ? ` — ${trimmedBody}` : ''}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function createClient(withAuth: boolean): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    timeout: 15_000,
    validateStatus: () => true, // we handle status manually
    headers: withAuth && JWT ? { Authorization: `Bearer ${JWT}` } : undefined,
  });
}

function expect200(label: string, res: AxiosResponse): boolean {
  if (res.status === 200) {
    logPass(`${label} → 200`);
    return true;
  }
  logFail(
    `${label} → expected 200, got ${res.status}`,
    new Error(
      typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data ?? ''),
    ),
  );
  return false;
}

async function main(): Promise<void> {
  console.log(
    `${colors.bold}Sesly smoke test${colors.reset} ${colors.dim}(${BASE_URL})${colors.reset}`,
  );
  if (!JWT) {
    console.log(
      `${colors.gray}  SMOKE_JWT not set — auth-required checks will be skipped.${colors.reset}`,
    );
  }
  console.log('');

  const publicClient = createClient(false);
  const authClient = createClient(true);

  // 1. Health check
  logStep('Health');
  try {
    const res = await publicClient.get('/health');
    if (expect200('GET /health', res)) {
      if (res.data?.status === 'ok') {
        logPass('Response body reports status: "ok"');
      } else {
        logFail(
          'Response body missing `status: "ok"`',
          new Error(JSON.stringify(res.data)),
        );
      }
    }
  } catch (error) {
    logFail('GET /health failed', error);
  }

  // 2. OpenAPI sanity (Swagger is only served when NODE_ENV=development)
  logStep('OpenAPI');
  try {
    const res = await publicClient.get('/api/docs-json');
    if (res.status === 200) {
      const spec = res.data as { paths?: Record<string, unknown> };
      const pathCount = spec?.paths ? Object.keys(spec.paths).length : 0;
      if (pathCount >= 10) {
        logPass(`GET /api/docs-json → 200 (${pathCount} paths)`);
      } else {
        logFail(`GET /api/docs-json → 200 but only ${pathCount} paths (expected >= 10)`);
      }
    } else if (res.status === 404) {
      logSkip('GET /api/docs-json', 'Swagger disabled (NODE_ENV !== development)');
    } else {
      logFail(`GET /api/docs-json → unexpected status ${res.status}`);
    }
  } catch (error) {
    logFail('GET /api/docs-json failed', error);
  }

  // Auth-required checks --------------------------------------------------
  if (!JWT) {
    logStep('Auth echo (skipped — no JWT)');
    logSkip('GET /users/me', 'SMOKE_JWT not set');
    logStep('Voice profiles list (skipped — no JWT)');
    logSkip('GET /voice-profiles', 'SMOKE_JWT not set');
    logStep('Narrations list (skipped — no JWT)');
    logSkip('GET /narrations', 'SMOKE_JWT not set');
    logStep('Notifications list (skipped — no JWT)');
    logSkip('GET /notifications', 'SMOKE_JWT not set');
    return;
  }

  // 3. Auth echo (profile)
  logStep('Auth echo');
  try {
    const res = await authClient.get('/users/me');
    if (expect200('GET /users/me', res)) {
      if (res.data && typeof res.data === 'object' && 'id' in res.data) {
        logPass(`JWT valid — user id: ${(res.data as { id: string }).id}`);
      } else {
        logFail(
          'GET /users/me → response does not look like a user profile',
          new Error(JSON.stringify(res.data)),
        );
      }
    }
  } catch (error) {
    logFail('GET /users/me failed', error);
  }

  // 4. Voice profile list
  logStep('Voice profiles list');
  try {
    const res = await authClient.get('/voice-profiles');
    if (expect200('GET /voice-profiles', res)) {
      if (Array.isArray(res.data)) {
        logPass(`Response is an array (${res.data.length} items)`);
      } else if (
        res.data &&
        typeof res.data === 'object' &&
        Array.isArray((res.data as { data?: unknown[] }).data)
      ) {
        logPass(
          `Response is a paginated object (data length: ${
            (res.data as { data: unknown[] }).data.length
          })`,
        );
      } else {
        logFail(
          'GET /voice-profiles → response is not an array or paginated object',
          new Error(JSON.stringify(res.data)),
        );
      }
    }
  } catch (error) {
    logFail('GET /voice-profiles failed', error);
  }

  // 5. Narrations list
  logStep('Narrations list');
  try {
    const res = await authClient.get('/narrations');
    expect200('GET /narrations', res);
  } catch (error) {
    logFail('GET /narrations failed', error);
  }

  // 6. Notifications list (new endpoint from Agent 4)
  logStep('Notifications list');
  try {
    const res = await authClient.get('/notifications');
    if (expect200('GET /notifications', res)) {
      const body = res.data;
      const isShapeOk =
        body &&
        typeof body === 'object' &&
        Array.isArray((body as { items?: unknown[] }).items) &&
        typeof (body as { total?: unknown }).total === 'number' &&
        typeof (body as { unreadCount?: unknown }).unreadCount === 'number';
      if (isShapeOk) {
        logPass(
          `Response has items, total, unreadCount (items: ${
            (body as { items: unknown[] }).items.length
          }, unreadCount: ${(body as { unreadCount: number }).unreadCount})`,
        );
      } else {
        logFail(
          'GET /notifications → missing expected shape { items, total, unreadCount }',
          new Error(JSON.stringify(body)),
        );
      }
    }
  } catch (error) {
    logFail('GET /notifications failed', error);
  }
}

main()
  .then(() => {
    console.log('');
    console.log(
      `${colors.bold}Summary:${colors.reset} ${colors.green}${passed} passed${colors.reset}, ${colors.red}${failed} failed${colors.reset}, ${colors.yellow}${skipped} skipped${colors.reset}`,
    );
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error(`${CROSS} Smoke test crashed:`, error);
    process.exit(1);
  });
