import { createDMWorker } from "@/lib/queue/dm-worker";
import { recordWorkerHeartbeat } from "@/lib/ops/worker-health";
import { reconcileComments } from "@/lib/polling/comment-reconciler";
import { reenviarAvisosPendentes } from "@/lib/opi/jev-worker";
import { attachPendingNextReels } from "@/lib/automation/attach-next-reel";
import { publicadorLigadoEnv, rodarPublicador } from "@/lib/opi/publicador";
import { coletarRedesDeTodos } from "@/lib/opi/redes-coleta";
import os from "node:os";

const worker = createDMWorker();
const startedAt = new Date().toISOString();
const HEARTBEAT_INTERVAL_MS = 30_000;
// Polling safety net for comments that webhooks miss. Runs in the worker because
// it must fire every few minutes and Vercel's free crons only run once a day.
const POLL_INTERVAL_MS = Number(
  process.env.COMMENT_POLL_INTERVAL_MS ?? 5 * 60_000
);

console.log("[DM Worker] Started");

async function heartbeat() {
  try {
    await recordWorkerHeartbeat({
      pid: process.pid,
      hostname: os.hostname(),
      startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Heartbeat failed:", message);
  }
}

void heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);

async function poll() {
  try {
    const attached = await attachPendingNextReels();
    if (attached.bound > 0 || attached.failedAccounts > 0) {
      console.log("[DM Worker] Next-reel attachment:", attached);
    }
    await reconcileComments();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Comment reconciliation failed:", message);
  }
  // OPI: avisos do Telegram que falharam ou foram suprimidos saem de novo aqui, até serem entregues.
  try {
    const r = await reenviarAvisosPendentes();
    if (r.reenviados > 0) console.log("[DM Worker] OPI: avisos reenviados:", r.reenviados);
  } catch (error) {
    console.error("[DM Worker] OPI: reenvio de avisos falhou:", error instanceof Error ? error.name : "erro");
  }
}

// Kick off one sweep shortly after boot, then on a fixed interval.
setTimeout(() => void poll(), 10_000);
const pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);

// OPI Central: publicador do calendário aprovado (D-0026). A rodada roda todo minuto, mas só publica
// com OPI_PUBLICADOR=on ou com a chave "Publicação automática" ligada no Calendário do painel; sem
// nenhuma das duas, a rodada é uma consulta à tabela Workspace e mais nada.
console.log(
  `[DM Worker] OPI: publicador ${publicadorLigadoEnv() ? "ligado pelo ambiente" : "segue a chave do painel"}`
);
const publicadorTimer = setInterval(() => {
  void rodarPublicador(new Date()).catch((error) => {
    console.error("[DM Worker] OPI: publicador falhou:", error instanceof Error ? error.name : "erro");
  });
}, 60_000);

// OPI Central: teste de conexão e números de cada rede (só leitura), 2 min depois de subir e a cada 6 h.
// É o que mantém "Conectado" verdadeiro na tela Redes sem ninguém apertar o botão.
const coletaRedes = () =>
  void coletarRedesDeTodos().catch((error) => {
    console.error("[DM Worker] OPI: coleta das redes falhou:", error instanceof Error ? error.name : "erro");
  });
const coletaRedesInicio = setTimeout(coletaRedes, 120_000);
const coletaRedesTimer = setInterval(coletaRedes, 6 * 60 * 60_000);

async function shutdown(signal: string) {
  console.log(`[DM Worker] ${signal} received, closing worker`);
  clearInterval(heartbeatTimer);
  clearInterval(pollTimer);
  clearInterval(publicadorTimer);
  clearTimeout(coletaRedesInicio);
  clearInterval(coletaRedesTimer);
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
