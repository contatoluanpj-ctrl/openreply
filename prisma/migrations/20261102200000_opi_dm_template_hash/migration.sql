-- AlterTable
ALTER TABLE "DmLog" ADD COLUMN     "dmTemplateHash" TEXT;

-- CreateIndex
CREATE INDEX "OperationalEvent_message_createdAt_idx" ON "OperationalEvent"("message", "createdAt");
