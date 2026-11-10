import { TTSTextPart } from '../interfaces/tts-provider.interface';
import { SONIC3_SPEED_MAX, SONIC3_SPEED_MIN } from './cartesia-emotions.constants';

/** Longest pause rendered as one break tag. */
export const CARTESIA_BREAK_MAX_MS = 3000;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const formatRatio = (v: number) => String(Math.round(clamp(v, SONIC3_SPEED_MIN, SONIC3_SPEED_MAX) * 100) / 100);

/**
 * Renders grouped segments as one Sonic 3 transcript. The request's own
 * speed (`baseSpeed`, sent in generation_config) applies until a part
 * reads at another speed: then an inline `<speed ratio="x"/>` tag switches
 * it. A pause after a part becomes `<break time="Nms"/>` (Cartesia counts
 * each break as one character). The text is passed through unchanged,
 * except that a literal "<" becomes the look-alike "‹" so story text can
 * never open a tag.
 */
export function renderCartesiaTranscript(parts: TTSTextPart[], baseSpeed: number): string {
  let out = '';
  let current = baseSpeed;
  const append = (piece: string) => {
    if (out && !/\s$/.test(out) && !/^\s/.test(piece) && !piece.startsWith('<')) out += ' ';
    out += piece;
  };
  parts.forEach((part, index) => {
    const speed = part.speed ?? baseSpeed;
    if (index > 0 && formatRatio(speed) !== formatRatio(current)) {
      if (out && !/\s$/.test(out)) out += ' ';
      out += `<speed ratio="${formatRatio(speed)}"/>`;
      current = speed;
    }
    append(part.text.replace(/</g, '‹'));
    if (part.pauseAfterMs && part.pauseAfterMs > 0) {
      out += `<break time="${Math.round(Math.min(part.pauseAfterMs, CARTESIA_BREAK_MAX_MS))}ms"/>`;
    }
  });
  return out;
}
