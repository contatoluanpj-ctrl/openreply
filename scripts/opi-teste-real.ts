// OPI: publica de novo o carrossel de teste (já aprovado pelo Luan) e liga a campanha TESTE a ele,
// com o texto aprovado TESTE ativo (DM "Oi!"). O Luan edita/apaga pelo painel.
// Uso: npx tsx --env-file=C:/opi-work/openreply/.env scripts/opi-teste-real.ts
import { prisma } from "../lib/db/client";

const G = "https://graph.facebook.com/v23.0";
const LEGENDA = "Post de teste da automação da OPI. Comente TESTE para receber uma mensagem no direct.\n\nConteúdo educativo. Não é recomendação individual de investimento.";
const IMGS = ["https://opi-openreply.vercel.app/teste/1.jpg", "https://opi-openreply.vercel.app/teste/2.jpg"];

async function g(path: string, params: Record<string, string>, method = "POST") {
  const body = new URLSearchParams(params);
  const r = await fetch(`${G}/${path}${method === "GET" ? `?${body}` : ""}`, method === "GET" ? {} : { method, body });
  const j = await r.json();
  if (j.error) throw new Error(`${path}: ${j.error.message}`);
  return j;
}

async function main() {
  const ig = process.env.META_IG_USER_ID!;
  const page = await g(process.env.META_PAGE_ID!, { fields: "access_token", access_token: process.env.META_PAGE_ACCESS_TOKEN! }, "GET");
  const tok = page.access_token ?? process.env.META_PAGE_ACCESS_TOKEN!;
  const filhos: string[] = [];
  for (const url of IMGS) filhos.push((await g(`${ig}/media`, { image_url: url, is_carousel_item: "true", access_token: tok })).id);
  const cont = await g(`${ig}/media`, { media_type: "CAROUSEL", children: filhos.join(","), caption: LEGENDA, access_token: tok });
  for (let i = 0; i < 20; i++) {
    const s = await g(cont.id, { fields: "status_code", access_token: tok }, "GET");
    if (s.status_code === "FINISHED") break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const pub = await g(`${ig}/media_publish`, { creation_id: cont.id, access_token: tok });
  const info = await g(pub.id, { fields: "permalink", access_token: tok }, "GET");
  console.log("publicado:", pub.id, info.permalink);

  const conta = await prisma.instagramAccount.findFirstOrThrow({ where: { username: "opcoesparainvestidores" } });
  await prisma.textoAprovado.updateMany({ where: { workspaceId: conta.workspaceId, palavra: "TESTE" }, data: { ativo: true, dmMessage: "Oi!" } });
  const a = await prisma.automation.update({
    where: { id: "cmw77wgzp0000nshn1siaqtha" },
    data: { postId: pub.id, postUrl: info.permalink, isActive: true, dmMessage: "Oi!", keywords: ["TESTE"], publicReplyEnabled: true, publicReplyMessage: "Te mandei na DM! 📩" },
  });
  console.log("campanha", a.name, "ligada ao post novo e ativa");
}
main().finally(() => prisma.$disconnect());
