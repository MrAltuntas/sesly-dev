/**
 * Standard wrapper utilities for API responses
 */

/**
 * Error response wrapper.
 *
 * `extra` carries structured fields from the thrown exception body (e.g.
 * `code`, `existingNarrationId`, `status`) so clients can branch on them.
 * The base envelope fields always win over `extra` so a stray `message` or
 * `statusCode` inside the payload can never corrupt the envelope.
 */
export function errorWrapper(
  message: string,
  statusCode: number,
  path?: string,
  method?: string,
  extra?: Record<string, unknown>,
) {
  return {
    ...(extra ?? {}),
    success: false as const,
    message,
    statusCode,
    path,
    method,
    timestamp: new Date().toISOString(),
  };
}
