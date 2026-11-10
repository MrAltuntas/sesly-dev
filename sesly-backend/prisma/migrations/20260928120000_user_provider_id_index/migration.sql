-- Firebase sign-in resolves users by uid (providerId) first; index it.
-- CreateIndex
CREATE INDEX "users_providerId_idx" ON "users"("providerId");
