-- OPI Central: chave da publicação automática por workspace (aditiva, sem perda de dados).
ALTER TABLE "Workspace" ADD COLUMN "opiPublicadorLigado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workspace" ADD COLUMN "opiPublicadorAlteradoEm" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN "opiPublicadorAlteradoPor" TEXT;
