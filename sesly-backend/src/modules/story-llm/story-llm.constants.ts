import { JobOptions } from 'bull';

/** Bull queue for background LLM work on stories (translation, level and age group assessment). */
export const STORY_LLM_QUEUE = 'story-llm';
export const STORY_LLM_JOB = 'run-task';

export interface StoryLlmJob {
  /** Id of the StoryLlmTask row; the row is the source of truth, the job only points at it. */
  taskId: string;
}

/** Transient provider failures (429, 5xx, timeout, network) are retried; rejected output never is. */
export const STORY_LLM_ATTEMPTS = 3;
export const STORY_LLM_BACKOFF_MS = 30_000;

/**
 * A RUNNING task that has not been touched for this long is considered dead
 * (worker crashed or was redeployed mid-call). It is failed the next time
 * tasks are listed or a new one is requested, so it never blocks a new task
 * forever. Longer than the largest llm.gemini.timeoutMs (10 minutes) times
 * the two calls a level assessment may make.
 */
export const STORY_LLM_STALE_RUNNING_MS = 30 * 60_000;

/**
 * A PENDING task older than this whose Bull job no longer exists (Redis was
 * flushed, the job was removed by hand) is considered lost.
 */
export const STORY_LLM_ORPHAN_PENDING_MS = 2 * 60_000;

/** Most stories one batch request may enqueue. */
export const STORY_LLM_BATCH_MAX = 500;

export function storyLlmJobOptions(taskId: string): JobOptions {
  return {
    // One job per task row, so a double enqueue of the same task is ignored.
    jobId: taskId,
    attempts: STORY_LLM_ATTEMPTS,
    backoff: { type: 'exponential', delay: STORY_LLM_BACKOFF_MS },
    removeOnComplete: true,
    removeOnFail: 100,
  };
}

export const STORY_LLM_STALE_MESSAGE =
  'Görev zaman aşımına uğradı: işlem yarıda kaldı (sunucu yeniden başlatılmış olabilir). Yeniden başlatılabilir.';
export const STORY_LLM_ORPHAN_MESSAGE =
  'Görev kuyrukta bulunamadı ve hiç çalışmadı. Yeniden başlatılabilir.';
export const STORY_LLM_QUEUE_FAILED_MESSAGE = 'Görev kuyruğa eklenemedi.';
export const AGE_GROUP_IS_MANUAL_MESSAGE =
  'Bu masalın yaş grubu elle belirlenmiş. Yapay zeka değerlendirmesi yalnızca zorla seçeneğiyle üzerine yazar.';
export const LEVEL_IS_MANUAL_MESSAGE =
  'Bu masalın dil seviyesi elle belirlenmiş. Yapay zeka değerlendirmesi yalnızca zorla seçeneğiyle üzerine yazar.';
