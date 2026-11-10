export interface AudioGenerationMetadata {
  userId: string;
  s3KeyPrefix: string; // e.g., "narrations/{narrationId}" or "covers/{coverId}"
  onProgress?: (completed: number, total: number) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}