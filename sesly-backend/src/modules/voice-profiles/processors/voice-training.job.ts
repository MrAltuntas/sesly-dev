import { JobOptions } from 'bull';

export const VOICE_TRAINING_QUEUE = 'voice-training';
export const VOICE_TRAINING_JOB = 'train-voice';

export interface VoiceTrainingJob {
  profileId: string;
  referenceS3Key: string;
  consentS3Key?: string;
  /** Client-detected speech onset (ms); drives the leading-silence trim. */
  speechStartMs?: number | null;
}

/** Transient failures (network, Cartesia 5xx) are retried; permanent ones never are. */
export const VOICE_TRAINING_ATTEMPTS = 3;
export const VOICE_TRAINING_BACKOFF_MS = 30_000;

export function voiceTrainingJobOptions(profileId: string): JobOptions {
  return {
    // One upload per profile (PENDING-only), so the profile id is a safe job id
    // and guards against a double enqueue.
    jobId: `train-${profileId}`,
    attempts: VOICE_TRAINING_ATTEMPTS,
    backoff: { type: 'exponential', delay: VOICE_TRAINING_BACKOFF_MS },
    removeOnComplete: true,
    removeOnFail: 100,
  };
}
