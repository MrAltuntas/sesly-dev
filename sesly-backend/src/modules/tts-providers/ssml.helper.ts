/**
 * SSML helper: wrap raw story text in storytelling-friendly SSML.
 *
 * Why: Google Cloud TTS runs paragraphs together when fed plain text. The
 * SSML envelope keeps the paragraph structure (`<p>`) and inserts a deliberate
 * pause between paragraphs (`<break time="500ms"/>`).
 *
 * Rate and pitch are NOT part of the envelope. They are applied exactly once,
 * through `audioConfig` of the synthesis request (runtime settings
 * tts.google.speakingRate / tts.google.pitch). An earlier version also wrapped
 * the text in `<prosody rate pitch>`, which applied both twice.
 *
 * Limitations:
 *   - Chirp / Chirp 3 HD voices do not take SSML input here: they get plain
 *     text (the caller decides via `voiceSupportsSsml`). They also reject the
 *     pitch parameter outright (`voiceSupportsPitch`).
 *   - Special XML characters in the user-supplied text must be escaped first
 *     or they break the SSML parser.
 */

import { TTSTextPart } from './interfaces/tts-provider.interface';

/** Pause inserted between paragraph blocks. */
export const STORYTELLING_PARAGRAPH_BREAK_MS = 500;

/** Bounds Google accepts for `audioConfig.speakingRate`. */
export const GOOGLE_SPEAKING_RATE_MIN = 0.25;
export const GOOGLE_SPEAKING_RATE_MAX = 2;

const escapeXml = (raw: string): string =>
  raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Chirp, Chirp HD and Chirp 3 HD voices ("tr-TR-Chirp3-HD-Achernar"). */
export const isChirpVoice = (voiceId: string): boolean =>
  !!voiceId && voiceId.includes('Chirp');

/**
 * Google voices that get the SSML envelope. The Chirp family gets plain text;
 * everything else (Standard, Wavenet, Studio, Neural2) supports SSML.
 */
export const voiceSupportsSsml = (voiceId: string): boolean => {
  if (!voiceId) return false;
  return !isChirpVoice(voiceId);
};

/**
 * Chirp voices answer INVALID_ARGUMENT ("This voice does not support pitch
 * parameters at this time") when `audioConfig.pitch` is present, even with
 * the value 0. The field must be left out of the request for them.
 */
export const voiceSupportsPitch = (voiceId: string): boolean => {
  if (!voiceId) return false;
  return !isChirpVoice(voiceId);
};

/**
 * Wrap raw story text in storytelling SSML. Splits on blank lines (`\n\n+`)
 * to detect paragraph boundaries, escapes XML and emits a single `<speak>`
 * envelope. No `<prosody>`: see the note at the top of the file.
 */
export const wrapStorytellingSSML = (
  text: string,
  paragraphBreakMs: number = STORYTELLING_PARAGRAPH_BREAK_MS,
): string => {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const breakTag = `<break time="${paragraphBreakMs}ms"/>`;
  const body = paragraphs
    .map(p => `<p>${escapeXml(p)}</p>`)
    .join(breakTag);

  return `<speak>${body}</speak>`;
};

export interface GoogleProsody {
  speakingRate: number;
  pitch: number;
}

export interface GoogleSynthesisRequest {
  input: { ssml: string } | { text: string } | { markup: string };
  voice: { languageCode: string; name: string };
  audioConfig: { audioEncoding: 'MP3'; speakingRate: number; pitch?: number };
}

const clampSpeakingRate = (rate: number): number =>
  Math.min(GOOGLE_SPEAKING_RATE_MAX, Math.max(GOOGLE_SPEAKING_RATE_MIN, rate));

/**
 * Chirp 3 HD pause tag for a pause length. Chirp only knows three relative
 * lengths; the model chooses the exact duration.
 */
export const chirpPauseTag = (ms: number): string => {
  if (ms < 400) return '[pause short]';
  if (ms < 1000) return '[pause]';
  return '[pause long]';
};

const joinPieces = (texts: string[]): string => {
  let out = '';
  for (const t of texts) {
    if (out && !/\s$/.test(out) && !/^\s/.test(t)) out += ' ';
    out += t;
  }
  return out;
};

/**
 * The input of a Google request, from plain text or grouped segments.
 * Without a pause the parts are joined into plain text (exactly what one
 * text request always was). With pauses: Chirp voices get the `markup`
 * field with pause tags (square brackets in the story become round ones
 * so they cannot be read as a tag); other voices get SSML with `<break>`
 * tags. Per-part speed and emotion cannot be expressed on Google and are
 * dropped.
 */
export const buildGoogleInput = (
  text: string,
  voiceId: string,
  parts?: TTSTextPart[],
): GoogleSynthesisRequest['input'] => {
  const pieces: TTSTextPart[] = parts?.length ? parts : [{ text }];
  const hasPause = pieces.some((p) => (p.pauseAfterMs ?? 0) > 0);
  const joined = parts?.length ? joinPieces(pieces.map((p) => p.text)) : text;

  if (!voiceSupportsSsml(voiceId)) {
    if (!hasPause) return { text: joined };
    const markup = joinPieces(
      pieces.map((p) => {
        const clean = p.text.replace(/\[/g, '(').replace(/\]/g, ')');
        return p.pauseAfterMs ? `${clean.trimEnd()} ${chirpPauseTag(p.pauseAfterMs)}` : clean;
      }),
    );
    return { markup };
  }

  if (!hasPause) return { ssml: wrapStorytellingSSML(joined) };
  const body = pieces
    .map((p) => {
      const inner = wrapStorytellingSSML(p.text).replace(/^<speak>/, '').replace(/<\/speak>$/, '');
      return p.pauseAfterMs ? `${inner}<break time="${Math.round(p.pauseAfterMs)}ms"/>` : inner;
    })
    .join('');
  return { ssml: `<speak>${body}</speak>` };
};

/**
 * The one place a Google synthesis request is built (narration segments and
 * previews both go through `GoogleTTSService.textToSpeech`).
 *
 *   - Chirp voice: plain text (markup when grouped segments carry pauses),
 *     `speakingRate` only. Never `pitch`.
 *   - Any other voice: SSML envelope (paragraphs and pauses), `speakingRate`
 *     and `pitch` in `audioConfig`, applied once.
 */
export const buildGoogleSynthesisRequest = (
  text: string,
  voiceId: string,
  prosody: GoogleProsody,
  parts?: TTSTextPart[],
): GoogleSynthesisRequest => {
  const idParts = voiceId.split('-');
  const languageCode = idParts.length >= 2 ? `${idParts[0]}-${idParts[1]}` : 'tr-TR';
  const audioConfig: GoogleSynthesisRequest['audioConfig'] = {
    audioEncoding: 'MP3',
    speakingRate: clampSpeakingRate(prosody.speakingRate),
  };
  if (voiceSupportsPitch(voiceId)) {
    audioConfig.pitch = prosody.pitch;
  }

  return {
    input: buildGoogleInput(text, voiceId, parts),
    voice: { languageCode, name: voiceId },
    audioConfig,
  };
};
