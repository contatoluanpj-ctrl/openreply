-- CreateTable
CREATE TABLE "TextoAprovado" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "palavra" TEXT NOT NULL,
    "dmMessage" TEXT NOT NULL,
    "respostaPublica" TEXT NOT NULL DEFAULT 'Te mandei na DM! 📩',
    "aprovadoPor" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TextoAprovado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TextoAprovado_workspaceId_palavra_key" ON "TextoAprovado"("workspaceId", "palavra");

-- CreateIndex
CREATE INDEX "TextoAprovado_workspaceId_ativo_idx" ON "TextoAprovado"("workspaceId", "ativo");
