/**
 * Resolve the GCS object key from whatever we stored in the DB.
 *
 * The DB holds a mix of:
 *   - bare object keys           `voice-samples/<user>/<profile>.mp3`
 *   - gs:// URIs                 `gs://<bucket>/<key>`
 *   - public-style GCS URLs      `https://storage.googleapis.com/<bucket>/<key>`
 *   - virtual-host GCS URLs      `https://<bucket>.storage.googleapis.com/<key>`
 *   - third-party URLs           `https://lh3.googleusercontent.com/...` (Google
 *                                avatar), admin-pasted CDN links, etc.
 *
 * Returns the object key for the first four shapes and `null` for anything
 * that is not in our storage, so callers never try to presign or delete a
 * foreign URL (or, as the old `slice(3)` helper did, a key that still
 * contains the bucket name).
 *
 * When `bucket` is given, a gs:// URI or GCS URL of ANY OTHER bucket is
 * foreign too (null): presigning or deleting it would hit a same-named
 * object of ours. Bare keys are always ours. Without `bucket` the bucket
 * segment is not checked (callers that only ever see values we wrote).
 */
export function extractStorageKey(
  value: string | null | undefined,
  bucket?: string,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Bare object key (no scheme).
  if (!trimmed.includes('://')) {
    const key = trimmed.replace(/^\/+/, '');
    return key.length > 0 ? key : null;
  }

  if (trimmed.startsWith('gs://')) {
    const match = trimmed.match(/^gs:\/\/([^/]+)\/?(.*)$/);
    if (!match || !isOurBucket(match[1], bucket)) return null;
    return match[2].length > 0 ? match[2] : null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  let rawKey: string | null = null;

  if (host === 'storage.googleapis.com' || host === 'storage.cloud.google.com') {
    // pathname = /<bucket>/<key...>
    const match = url.pathname.match(/^\/([^/]+)\/(.+)$/);
    if (match && !isOurBucket(decodeSafe(match[1]), bucket)) return null;
    rawKey = match ? match[2] : null;
  } else if (host.endsWith('.storage.googleapis.com')) {
    const hostBucket = host.slice(0, -'.storage.googleapis.com'.length);
    if (!isOurBucket(hostBucket, bucket?.toLowerCase())) return null;
    rawKey = url.pathname.replace(/^\/+/, '') || null;
  }

  if (!rawKey) return null;

  return decodeSafe(rawKey);
}

function isOurBucket(candidate: string, bucket: string | undefined): boolean {
  return !bucket || candidate === bucket;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
