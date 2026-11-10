-- CreateEnum
CREATE TYPE "StoryLlmTaskType" AS ENUM ('TRANSLATE', 'ASSESS_LEVEL');

-- CreateEnum
CREATE TYPE "StoryLlmTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "story_llm_tasks" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "type" "StoryLlmTaskType" NOT NULL,
    "targetLanguage" TEXT,
    "status" "StoryLlmTaskStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "resultStoryId" TEXT,
    "result" JSONB,
    "createdByAdminId" TEXT,
    "force" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "story_llm_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "story_llm_tasks_storyId_type_status_idx" ON "story_llm_tasks"("storyId", "type", "status");

-- CreateIndex
CREATE INDEX "story_llm_tasks_status_updatedAt_idx" ON "story_llm_tasks"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "story_llm_tasks_createdAt_idx" ON "story_llm_tasks"("createdAt");

-- AddForeignKey
ALTER TABLE "story_llm_tasks" ADD CONSTRAINT "story_llm_tasks_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_llm_tasks" ADD CONSTRAINT "story_llm_tasks_resultStoryId_fkey" FOREIGN KEY ("resultStoryId") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
