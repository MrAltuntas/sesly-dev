-- An App Store subscription (original transaction id) belongs to exactly one
-- account. Before making the column unique, clear duplicates: keep the id on
-- the most recently updated row and null it on the others (ties broken by id).
UPDATE "subscriptions" AS s
SET "appleOriginalTransactionId" = NULL
FROM "subscriptions" AS newer
WHERE s."appleOriginalTransactionId" = newer."appleOriginalTransactionId"
  AND s."id" <> newer."id"
  AND (
    s."updatedAt" < newer."updatedAt"
    OR (s."updatedAt" = newer."updatedAt" AND s."id" < newer."id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_appleOriginalTransactionId_key" ON "subscriptions"("appleOriginalTransactionId");
