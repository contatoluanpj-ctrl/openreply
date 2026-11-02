-- AlterEnum
ALTER TYPE "DmStatus" ADD VALUE 'HELD_FOR_REVIEW';

-- AlterTable
ALTER TABLE "DmLog" ADD COLUMN     "jevDecision" TEXT,
ADD COLUMN     "jevReason" TEXT,
ADD COLUMN     "jevScores" JSONB;

-- CreateTable
CREATE TABLE "JevLedger" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "pergunta" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "p" DOUBLE PRECISION,
    "erro" TEXT,
    "decisao" TEXT NOT NULL,
    "finalLuan" BOOLEAN,
    "resultadoReal" TEXT,
    "entradaHash" TEXT NOT NULL,

    CONSTRAINT "JevLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JevLedger_workspaceId_idx" ON "JevLedger"("workspaceId");

-- CreateIndex
CREATE INDEX "JevLedger_automationId_commentId_idx" ON "JevLedger"("automationId", "commentId");

-- CreateIndex
CREATE INDEX "JevLedger_createdAt_idx" ON "JevLedger"("createdAt");

