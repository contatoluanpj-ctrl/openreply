-- CreateEnum
CREATE TYPE "PedidoAgenteStatus" AS ENUM ('NOVO', 'EM_ANDAMENTO', 'FEITO', 'ERRO');

-- CreateEnum
CREATE TYPE "PostTipo" AS ENUM ('CARROSSEL', 'REEL', 'POST');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('RASCUNHO', 'APROVADO', 'PUBLICANDO', 'PUBLICADO', 'ERRO');

-- CreateEnum
CREATE TYPE "LancamentoTipo" AS ENUM ('RECEITA', 'DESPESA');

-- CreateEnum
CREATE TYPE "LancamentoStatus" AS ENUM ('PREVISTO', 'PAGO');

-- CreateTable
CREATE TABLE "RedeSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "rede" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "metricas" JSONB NOT NULL,
    "coletadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedeSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoAgente" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agente" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "status" "PedidoAgenteStatus" NOT NULL DEFAULT 'NOVO',
    "resposta" TEXT,
    "anexos" JSONB,
    "iniciadoEm" TIMESTAMP(3),
    "concluidoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PedidoAgente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostAgendado" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tipo" "PostTipo" NOT NULL,
    "midias" JSONB NOT NULL,
    "legenda" TEXT NOT NULL,
    "agendadoPara" TIMESTAMP(3) NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'RASCUNHO',
    "aprovadoEm" TIMESTAMP(3),
    "aprovadoPor" TEXT,
    "mediaId" TEXT,
    "permalink" TEXT,
    "erro" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostAgendado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lancamento" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "tipo" "LancamentoTipo" NOT NULL,
    "categoria" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "status" "LancamentoStatus" NOT NULL DEFAULT 'PREVISTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lancamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RedeSnapshot_workspaceId_idx" ON "RedeSnapshot"("workspaceId");

-- CreateIndex
CREATE INDEX "RedeSnapshot_workspaceId_rede_coletadoEm_idx" ON "RedeSnapshot"("workspaceId", "rede", "coletadoEm");

-- CreateIndex
CREATE INDEX "PedidoAgente_workspaceId_idx" ON "PedidoAgente"("workspaceId");

-- CreateIndex
CREATE INDEX "PedidoAgente_workspaceId_status_createdAt_idx" ON "PedidoAgente"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PedidoAgente_workspaceId_agente_createdAt_idx" ON "PedidoAgente"("workspaceId", "agente", "createdAt");

-- CreateIndex
CREATE INDEX "PostAgendado_workspaceId_idx" ON "PostAgendado"("workspaceId");

-- CreateIndex
CREATE INDEX "PostAgendado_workspaceId_status_agendadoPara_idx" ON "PostAgendado"("workspaceId", "status", "agendadoPara");

-- CreateIndex
CREATE INDEX "Lancamento_workspaceId_idx" ON "Lancamento"("workspaceId");

-- CreateIndex
CREATE INDEX "Lancamento_workspaceId_data_idx" ON "Lancamento"("workspaceId", "data");

-- AddForeignKey
ALTER TABLE "RedeSnapshot" ADD CONSTRAINT "RedeSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoAgente" ADD CONSTRAINT "PedidoAgente_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostAgendado" ADD CONSTRAINT "PostAgendado_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lancamento" ADD CONSTRAINT "Lancamento_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

