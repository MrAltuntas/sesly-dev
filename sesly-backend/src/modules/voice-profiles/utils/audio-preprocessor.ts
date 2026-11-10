import { Logger } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Configure ffmpeg binary path once at module load. Mirrors AudioService.onModuleInit
// so preprocessing works even if the processor imports this module before the
// audio module's OnModuleInit has fired.
let ffmpegConfigured = false;
function ensureFfmpegConfigured(logger: Logger): void {
  if (ffmpegConfigured) return;
  ffmpegConfigured = true;
  try {
    const binaryPath: string | null = ffmpegStatic ?? null;
    if (binaryPath && fs.existsSync(binaryPath)) {
      ffmpeg.setFfmpegPath(binaryPath);
      logger.log(`FFmpeg binary configured for audio preprocessor: ${binaryPath}`);
    } else {
      logger.warn(
        'ffmpeg-static binary not found for audio preprocessor; falling back to system PATH.',
      );
    }
  } catch (err: any) {
    logger.warn(`Failed to configure ffmpeg binary: ${err?.message ?? err}`);
  }
}

// Hard timeout for a single transcode. Clips are at most ~60 s of speech and
// the pipeline is a plain decode + resample, so this is very generous.
export const PREPROCESS_TIMEOUT_MS = 60 * 1000;

// =============================================================================
// Output format
// =============================================================================
//
// Cartesia does not accept m4a (clone formats: flac/mp3/ogg/wav/webm), so
// every upload is transcoded to 16-bit PCM WAV, 44.1 kHz, mono. 44.1 kHz
// matches the provider's own recommendation; mono because stereo adds nothing
// to a voice clone and doubles the size.
export const TARGET_SAMPLE_RATE = 44_100;
export const TARGET_CHANNELS = 1;
export const TARGET_CODEC = 'pcm_s16le';
export const TARGET_FORMAT = 'wav';
const BYTES_PER_SECOND = TARGET_SAMPLE_RATE * TARGET_CHANNELS * 2;

// Sonic 3.6+ learns from up to 60 s of reference audio; anything longer is
// wasted upload and storage.
export const DEFAULT_MAX_DURATION_SEC = 60;

// Keep a little lead-in before the client-detected speech onset so the first
// syllable's attack is not clipped.
export const SPEECH_START_PADDING_MS = 250;

// =============================================================================
// No filters, on purpose
// =============================================================================
//
// Cartesia's guidance is to send the clip as recorded: the clone picks up the
// mood and room of the source, and post-processing (highpass, loudnorm,
// silenceremove, denoise) only reduces similarity to the speaker. The only
// edits are container/sample-rate normalization, a leading-silence trim
// driven by the client's speech onset, and the 60 s cap.

export interface PreprocessOptions {
  /**
   * Client-detected speech onset in ms. The clip starts at
   * max(0, speechStartMs - SPEECH_START_PADDING_MS). Omit for no trim.
   */
  speechStartMs?: number | null;
  /**
   * Output duration cap in seconds. Defaults to 60; `null` disables the cap
   * (admin sandbox "skip preprocessing" mode: transcode only).
   */
  maxDurationSec?: number | null;
  /**
   * When set, clips shorter than this (after trimming) are rejected with
   * {@link AudioTooShortError}.
   */
  minDurationSec?: number;
}

export interface PreprocessArgs {
  /** Options placed before `-i` (input seeking). */
  inputOptions: string[];
  /** Options placed after `-i` (output encoding). */
  outputOptions: string[];
  /** Trim start actually applied, in ms (0 when not trimming). */
  startMs: number;
}

/**
 * Thrown when the transcoded clip is shorter than the configured minimum.
 * Permanent: retrying the same recording can never succeed.
 */
export class AudioTooShortError extends Error {
  constructor(
    public readonly durationSec: number,
    public readonly minDurationSec: number,
  ) {
    super(
      `Reference audio too short after trimming: ${durationSec.toFixed(2)}s < ${minDurationSec}s`,
    );
    this.name = 'AudioTooShortError';
  }
}

/**
 * Pure builder for the ffmpeg argument lists. Exported for unit tests.
 */
export function buildPreprocessArgs(options: PreprocessOptions = {}): PreprocessArgs {
  const inputOptions: string[] = [];
  let startMs = 0;

  const onset = options.speechStartMs;
  if (typeof onset === 'number' && Number.isFinite(onset) && onset > 0) {
    startMs = Math.max(0, Math.floor(onset) - SPEECH_START_PADDING_MS);
  }
  if (startMs > 0) {
    inputOptions.push('-ss', (startMs / 1000).toFixed(3));
  }

  const maxDuration =
    options.maxDurationSec === undefined ? DEFAULT_MAX_DURATION_SEC : options.maxDurationSec;

  const outputOptions: string[] = [
    '-vn', // drop cover art / video streams some recorders embed
    '-map_metadata', '-1',
    '-ac', String(TARGET_CHANNELS),
    '-ar', String(TARGET_SAMPLE_RATE),
    '-c:a', TARGET_CODEC,
    '-f', TARGET_FORMAT,
  ];
  if (maxDuration !== null && maxDuration > 0) {
    outputOptions.push('-t', String(maxDuration));
  }

  return { inputOptions, outputOptions, startMs };
}

/**
 * Duration of a PCM WAV buffer in seconds, read from its `data` chunk.
 * Falls back to a 44-byte header estimate when the chunk walk fails.
 */
export function wavDurationSeconds(
  buffer: Buffer,
  bytesPerSecond = BYTES_PER_SECOND,
): number {
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE'
  ) {
    let offset = 12;
    let rate = bytesPerSecond;
    while (offset + 8 <= buffer.length) {
      const id = buffer.toString('ascii', offset, offset + 4);
      const size = buffer.readUInt32LE(offset + 4);
      if (id === 'fmt ' && offset + 20 <= buffer.length) {
        const byteRate = buffer.readUInt32LE(offset + 16);
        if (byteRate > 0) rate = byteRate;
      }
      if (id === 'data') {
        // ffmpeg may leave a 0 / 0xFFFFFFFF placeholder when it cannot seek
        // back; clamp to the bytes actually present.
        const available = buffer.length - (offset + 8);
        const dataBytes = size > 0 && size <= available ? size : available;
        return dataBytes / rate;
      }
      offset += 8 + size + (size % 2);
    }
  }
  return Math.max(0, buffer.length - 44) / bytesPerSecond;
}

export interface TranscodedAudio {
  /** Local path to the converted wav file. Caller must unlink. */
  outputPath: string;
  /** Raw wav bytes for uploading. */
  buffer: Buffer;
  /** ffmpeg duration in ms (wall-clock). */
  durationMs: number;
  /** Audio length of the output clip in seconds. */
  audioSeconds: number;
  /** Leading trim applied, in ms. */
  trimStartMs: number;
  /** Temp directory to rm -rf when done. */
  tempDir: string;
}

/**
 * Transcode an uploaded clip (m4a/aac/mp4/wav/...) to 44.1 kHz mono 16-bit
 * PCM WAV for Cartesia voice cloning.
 *
 * Only three edits are made: optional leading-silence trim from the client's
 * speech onset, a duration cap (60 s by default), and the container /
 * sample-rate normalization. No audio filters (see the note above).
 *
 * Caller is responsible for cleaning up the returned `tempDir` (use
 * {@link cleanupTempDir}). Throws {@link AudioTooShortError} when
 * `minDurationSec` is set and the result is shorter (temp dir already cleaned).
 */
export async function transcodeToWav(
  input: Buffer,
  logger: Logger,
  jobId: string,
  options: PreprocessOptions = {},
): Promise<TranscodedAudio> {
  ensureFfmpegConfigured(logger);

  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `sesly-voice-${jobId}-`),
  );
  const inputPath = path.join(tempDir, 'input.bin');
  const outputPath = path.join(tempDir, 'output.wav');

  await fs.promises.writeFile(inputPath, input);

  const args = buildPreprocessArgs(options);
  const startedAt = Date.now();

  try {
    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg(inputPath);

      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        fn();
      };

      const timeoutHandle = setTimeout(() => {
        logger.error(
          `Audio preprocess for ${jobId} exceeded ${PREPROCESS_TIMEOUT_MS}ms, killing`,
        );
        try {
          command.kill('SIGKILL');
        } catch (killErr: any) {
          logger.warn(`Failed to kill ffmpeg process: ${killErr?.message ?? killErr}`);
        }
        settle(() =>
          reject(
            new Error(
              `Audio preprocess timed out after ${PREPROCESS_TIMEOUT_MS}ms for ${jobId}`,
            ),
          ),
        );
      }, PREPROCESS_TIMEOUT_MS);

      if (args.inputOptions.length > 0) {
        command.inputOptions(args.inputOptions);
      }

      command
        .outputOptions(args.outputOptions)
        .on('start', (cmdLine: string) => {
          logger.log(`FFmpeg preprocess started for ${jobId}: ${cmdLine}`);
        })
        .on('error', (err) => {
          logger.error(
            `FFmpeg preprocess error for ${jobId}: ${err?.message ?? err}`,
          );
          settle(() => reject(err));
        })
        .on('end', () => {
          settle(() => resolve());
        })
        .save(outputPath);
    });

    const buffer = await fs.promises.readFile(outputPath);
    const durationMs = Date.now() - startedAt;
    const audioSeconds = wavDurationSeconds(buffer);
    logger.log(
      `Audio preprocessing complete for ${jobId} in ${durationMs}ms: ${audioSeconds.toFixed(1)}s of audio, trimStart=${args.startMs}ms, ${buffer.length} bytes (${TARGET_SAMPLE_RATE}Hz mono PCM16)`,
    );

    if (options.minDurationSec !== undefined && audioSeconds < options.minDurationSec) {
      throw new AudioTooShortError(audioSeconds, options.minDurationSec);
    }

    return {
      outputPath,
      buffer,
      durationMs,
      audioSeconds,
      trimStartMs: args.startMs,
      tempDir,
    };
  } catch (err) {
    // On failure, best-effort cleanup before rethrowing so the caller
    // doesn't have to worry about the temp dir.
    await cleanupTempDir(tempDir, logger);
    throw err;
  }
}

/**
 * Remove a temp directory tree. Safe to call multiple times; errors are
 * swallowed with a warning.
 */
export async function cleanupTempDir(tempDir: string, logger: Logger): Promise<void> {
  try {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  } catch (err: any) {
    logger.warn(`Failed to clean up temp dir ${tempDir}: ${err?.message ?? err}`);
  }
}
