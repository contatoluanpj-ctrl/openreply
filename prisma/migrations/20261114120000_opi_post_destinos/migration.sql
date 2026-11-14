-- OPI Central: destinos de publicação por post (instagram, facebook, youtube, linkedin, x, tiktok).
-- Aditiva, sem perda de dados: cria o enum e a tabela e espelha o estado atual de cada PostAgendado
-- em um destino "instagram". PostAgendado.status/mediaId/permalink continuam como resumo.

-- CreateEnum
CREATE TYPE "DestinoStatus" AS ENUM ('PENDENTE', 'PUBLICANDO', 'PUBLICADO', 'ERRO', 'PULADO');

-- CreateTable
CREATE TABLE "PostDestino" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "rede" TEXT NOT NULL,
    "status" "DestinoStatus" NOT NULL DEFAULT 'PENDENTE',
    "externoId" TEXT,
    "permalink" TEXT,
    "erro" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "publicadoEm" TIMESTAMP(3),
    "titulo" TEXT,
    "descricao" TEXT,
    "aprovadoEm" TIMESTAMP(3),
    "aprovadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostDestino_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostDestino_postId_rede_key" ON "PostDestino"("postId", "rede");

-- CreateIndex
CREATE INDEX "PostDestino_status_rede_idx" ON "PostDestino"("status", "rede");

-- CreateIndex
CREATE INDEX "PostDestino_rede_status_publicadoEm_idx" ON "PostDestino"("rede", "status", "publicadoEm");

-- AddForeignKey
ALTER TABLE "PostDestino" ADD CONSTRAINT "PostDestino_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PostAgendado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Espelho: um destino "instagram" por PostAgendado existente.
-- PUBLICADO -> PUBLICADO (com mediaId e permalink), ERRO -> ERRO, demais (RASCUNHO, APROVADO, PUBLICANDO) -> PENDENTE.
-- O id é determinístico (md5 do post + rede) e o ON CONFLICT deixa o trecho seguro para rodar de novo.
-- publicadoEm usa agendadoPara: o publicador roda a cada minuto, e updatedAt pode ter sido tocado depois por script.
INSERT INTO "PostDestino" ("id", "postId", "rede", "status", "externoId", "permalink", "erro", "tentativas", "publicadoEm", "createdAt", "updatedAt")
SELECT
    'dst_' || md5(p."id" || ':instagram'),
    p."id",
    'instagram',
    CASE p."status"
        WHEN 'PUBLICADO' THEN 'PUBLICADO'::"DestinoStatus"
        WHEN 'ERRO' THEN 'ERRO'::"DestinoStatus"
        ELSE 'PENDENTE'::"DestinoStatus"
    END,
    CASE WHEN p."status" = 'PUBLICADO' THEN p."mediaId" END,
    CASE WHEN p."status" = 'PUBLICADO' THEN p."permalink" END,
    CASE WHEN p."status" = 'ERRO' THEN p."erro" END,
    CASE WHEN p."status" IN ('PUBLICADO', 'ERRO') THEN 1 ELSE 0 END,
    CASE WHEN p."status" = 'PUBLICADO' THEN p."agendadoPara" END,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "PostAgendado" p
ON CONFLICT ("postId", "rede") DO NOTHING;
