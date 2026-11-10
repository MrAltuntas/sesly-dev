/**
 * Splits a story text into StoryChunk rows (at most `maxChunkSize`
 * characters each, cut at a sentence end when one exists, else at a space).
 * Shared by the admin story editor and the machine-translation job, so a
 * translated story gets the same chunks an edited one would.
 */
export const STORY_CHUNK_MAX_CHARS = 5000;

export function splitStoryIntoChunks(
  content: string,
  maxChunkSize: number = STORY_CHUNK_MAX_CHARS,
): string[] {
  const chunks: string[] = [];
  let remainingContent = content.trim();

  while (remainingContent.length > 0) {
    if (remainingContent.length <= maxChunkSize) {
      chunks.push(remainingContent);
      break;
    }

    const chunkCandidate = remainingContent.substring(0, maxChunkSize);
    const lastDot = chunkCandidate.lastIndexOf('.');
    const lastQuestion = chunkCandidate.lastIndexOf('?');
    const lastExclamation = chunkCandidate.lastIndexOf('!');

    let splitIndex = Math.max(lastDot, lastQuestion, lastExclamation);

    if (splitIndex !== -1) {
      splitIndex += 1;
    } else {
      splitIndex = chunkCandidate.lastIndexOf(' ');
      if (splitIndex === -1) {
        splitIndex = maxChunkSize;
      }
    }

    const chunk = remainingContent.substring(0, splitIndex);
    chunks.push(chunk);
    remainingContent = remainingContent.substring(splitIndex).trimStart();
  }

  return chunks;
}
