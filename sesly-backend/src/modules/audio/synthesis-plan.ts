/**
 * Turns a story's segments into TTS requests ("synthesis units").
 *
 * Per-segment mode (grouping off) is the original behaviour: one request
 * per segment. Grouped mode sends fewer, larger requests:
 *
 *   - Cartesia: consecutive segments with the same emotion and volume go
 *     into one request (Cartesia advises one emotion per generation; inline
 *     emotion tags are beta and English only). Speed changes inside the
 *     request become inline `<speed ratio="..."/>` tags and pauses become
 *     `<break time="...ms"/>` tags (both Sonic 3 SSML tags). At most
 *     CARTESIA_UNIT_MAX_CHARS characters per request.
 *   - Google: emotion and per-segment speed do not exist, so every segment
 *     can share a request up to GOOGLE_UNIT_MAX_BYTES (Google accepts 5000
 *     bytes per request). Pauses become markup pause tags.
 *
 * TTS is billed per character on both providers, so grouping does not
 * change the price; it cuts requests, queue jobs and merge seams.
 */
import { StorySegment, joinSegmentTexts, utf8Bytes } from '../story-segmentation/story-segments';
import { TTSTextPart } from '../tts-providers/interfaces/tts-provider.interface';

export type SynthesisPart = TTSTextPart;

export interface SynthesisUnit {
  /** Plain text of the request (no tags), stored on AudioSegment.content. */
  text: string;
  parts: SynthesisPart[];
  /** Request-level values (generation_config on Cartesia). */
  emotion?: string;
  speed?: number;
  volume?: number;
}

export type SynthesisProvider = 'google' | 'cartesia';

export interface SynthesisDefaults {
  emotion?: string | null;
  speed?: number | null;
  volume?: number | null;
}

export const CARTESIA_UNIT_MAX_CHARS = 1500;
export const GOOGLE_UNIT_MAX_BYTES = 4500;
/** Room counted for one pause tag when sizing a Google request. */
const PAUSE_TAG_BYTES = 16;

const orUndefined = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

function toPart(segment: StorySegment): SynthesisPart {
  return {
    text: segment.text,
    ...(segment.speed !== undefined ? { speed: segment.speed } : {}),
    ...(segment.pauseAfterMs ? { pauseAfterMs: segment.pauseAfterMs } : {}),
  };
}

function finish(parts: SynthesisPart[], meta: Omit<SynthesisUnit, 'text' | 'parts'>): SynthesisUnit {
  return { text: joinSegmentTexts(parts.map((p) => p.text)), parts, ...meta };
}

export function planSynthesisUnits(
  segments: StorySegment[],
  options: { provider: SynthesisProvider; grouping: boolean; defaults?: SynthesisDefaults },
): SynthesisUnit[] {
  const defaults = options.defaults ?? {};
  const emotionOf = (s: StorySegment) => s.emotion ?? orUndefined(defaults.emotion);
  const speedOf = (s: StorySegment) => s.speed ?? orUndefined(defaults.speed);
  const volumeOf = (s: StorySegment) => s.volume ?? orUndefined(defaults.volume);

  if (!options.grouping) {
    return segments.map((s) =>
      finish([toPart(s)], { emotion: emotionOf(s), speed: speedOf(s), volume: volumeOf(s) }),
    );
  }

  const units: SynthesisUnit[] = [];

  if (options.provider === 'google') {
    let parts: SynthesisPart[] = [];
    let bytes = 0;
    for (const s of segments) {
      const size = utf8Bytes(s.text) + 1 + (s.pauseAfterMs ? PAUSE_TAG_BYTES : 0);
      if (parts.length > 0 && bytes + size > GOOGLE_UNIT_MAX_BYTES) {
        units.push(finish(parts, {}));
        parts = [];
        bytes = 0;
      }
      parts.push(toPart(s));
      bytes += size;
    }
    if (parts.length > 0) units.push(finish(parts, {}));
    return units;
  }

  let parts: SynthesisPart[] = [];
  let chars = 0;
  let key: string | null = null;
  let meta: Omit<SynthesisUnit, 'text' | 'parts'> = {};
  for (const s of segments) {
    const segmentKey = `${emotionOf(s) ?? ''}|${volumeOf(s) ?? ''}`;
    const size = s.text.length;
    if (parts.length > 0 && (segmentKey !== key || chars + size > CARTESIA_UNIT_MAX_CHARS)) {
      units.push(finish(parts, meta));
      parts = [];
      chars = 0;
    }
    if (parts.length === 0) {
      key = segmentKey;
      meta = { emotion: emotionOf(s), speed: speedOf(s), volume: volumeOf(s) };
    }
    // A part without its own speed reads at the default, which may differ
    // from the speed the request started with: make it explicit.
    const part = toPart(s);
    const effectiveSpeed = speedOf(s);
    if (part.speed === undefined && effectiveSpeed !== undefined) part.speed = effectiveSpeed;
    parts.push(part);
    chars += size;
  }
  if (parts.length > 0) units.push(finish(parts, meta));
  return units;
}
