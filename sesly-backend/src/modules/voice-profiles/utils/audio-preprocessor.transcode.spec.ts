import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import {
  AudioTooShortError,
  PREPROCESS_TIMEOUT_MS,
  TARGET_SAMPLE_RATE,
  cleanupTempDir,
  transcodeToWav,
} from './audio-preprocessor';

/**
 * transcodeToWav orchestration with ffmpeg + the filesystem faked out:
 * success, ffmpeg error, timeout kill, too-short rejection, and the temp dir
 * cleanup guarantees. No process is spawned and nothing touches the disk.
 */

type Behavior = 'end' | 'error' | 'hang';
const mockFfmpeg: { behavior: Behavior; commands: any[] } = { behavior: 'end', commands: [] };

jest.mock('fluent-ffmpeg', () => {
  const factory: any = jest.fn((inputPath: string) => {
    const handlers: Record<string, (...a: any[]) => void> = {};
    const cmd: any = {
      inputPath,
      inputOptions: jest.fn(() => cmd),
      outputOptions: jest.fn(() => cmd),
      on: jest.fn((evt: string, h: any) => {
        handlers[evt] = h;
        return cmd;
      }),
      kill: jest.fn(),
      save: jest.fn((out: string) => {
        cmd.output = out;
        handlers.start?.('ffmpeg ...');
        if (mockFfmpeg.behavior === 'end') handlers.end?.();
        if (mockFfmpeg.behavior === 'error') handlers.error?.(new Error('Invalid data found when processing input'));
        return cmd;
      }),
    };
    mockFfmpeg.commands.push(cmd);
    return cmd;
  });
  factory.setFfmpegPath = jest.fn();
  return { __esModule: true, default: factory };
});
jest.mock('ffmpeg-static', () => ({ __esModule: true, default: '/fake/bin/ffmpeg' }));

/** PCM16 mono WAV of the given length (header + silent samples). */
function wav(seconds: number): Buffer {
  const dataBytes = Math.round(seconds * TARGET_SAMPLE_RATE * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(TARGET_SAMPLE_RATE, 24);
  header.writeUInt32LE(TARGET_SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.alloc(dataBytes)]);
}

describe('transcodeToWav', () => {
  const logger = new Logger('test');
  let spies: jest.SpyInstance[];
  let readFile: jest.SpyInstance;
  let rm: jest.SpyInstance;

  beforeEach(() => {
    mockFfmpeg.behavior = 'end';
    mockFfmpeg.commands = [];
    readFile = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(wav(30) as any);
    rm = jest.spyOn(fs.promises, 'rm').mockResolvedValue(undefined as any);
    spies = [
      jest.spyOn(fs.promises, 'mkdtemp').mockResolvedValue('/tmp/sesly-voice-job-1-abc' as any),
      jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined as any),
      readFile,
      rm,
      ...['log', 'warn', 'error'].map((m) =>
        jest.spyOn(Logger.prototype, m as 'log').mockImplementation(() => undefined),
      ),
    ];
  });

  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
    jest.useRealTimers();
  });

  it('success: returns the wav bytes, measured length and trim; temp dir is left for the caller', async () => {
    const result = await transcodeToWav(Buffer.from('m4a'), logger, 'job-1', {
      speechStartMs: 1250,
      minDurationSec: 10,
    });

    expect(result.audioSeconds).toBeCloseTo(30, 1);
    expect(result.trimStartMs).toBe(1000);
    expect(result.tempDir).toBe('/tmp/sesly-voice-job-1-abc');
    expect(result.buffer.length).toBe(wav(30).length);
    // Input seek for the trim is applied, output is saved to <tempDir>/output.wav.
    const cmd = mockFfmpeg.commands[0];
    expect(cmd.inputOptions).toHaveBeenCalled();
    expect(String(cmd.output).replace(/\\/g, '/')).toBe('/tmp/sesly-voice-job-1-abc/output.wav');
    expect(rm).not.toHaveBeenCalled();
  });

  it('no trim requested -> no input options', async () => {
    await transcodeToWav(Buffer.from('wav'), logger, 'job-1');
    expect(mockFfmpeg.commands[0].inputOptions).not.toHaveBeenCalled();
  });

  it('shorter than minDurationSec -> AudioTooShortError and the temp dir is removed', async () => {
    readFile.mockResolvedValue(wav(4) as any);

    const err = await transcodeToWav(Buffer.from('m4a'), logger, 'job-1', { minDurationSec: 10 }).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(AudioTooShortError);
    expect(rm).toHaveBeenCalledWith('/tmp/sesly-voice-job-1-abc', { recursive: true, force: true });
  });

  it('ffmpeg error -> rejects with it and cleans up', async () => {
    mockFfmpeg.behavior = 'error';
    await expect(transcodeToWav(Buffer.from('junk'), logger, 'job-1')).rejects.toThrow('Invalid data');
    expect(rm).toHaveBeenCalled();
  });

  it('hanging ffmpeg is killed after the timeout and the temp dir removed', async () => {
    jest.useFakeTimers();
    mockFfmpeg.behavior = 'hang';

    const pending = transcodeToWav(Buffer.from('m4a'), logger, 'job-1').catch((e) => e);
    await jest.advanceTimersByTimeAsync(PREPROCESS_TIMEOUT_MS);
    const err = await pending;

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('timed out');
    expect(mockFfmpeg.commands[0].kill).toHaveBeenCalledWith('SIGKILL');
    expect(rm).toHaveBeenCalled();
  });
});

describe('cleanupTempDir', () => {
  it('swallows rm errors', async () => {
    const rm = jest.spyOn(fs.promises, 'rm').mockRejectedValue(new Error('EBUSY'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(cleanupTempDir('/tmp/x', new Logger('t'))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    rm.mockRestore();
    warn.mockRestore();
  });
});
