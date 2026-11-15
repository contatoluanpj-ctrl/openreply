-- Post só de texto (LinkedIn e Threads). Valor novo no enum; nada existente muda.
ALTER TYPE "PostTipo" ADD VALUE IF NOT EXISTS 'TEXTO';
