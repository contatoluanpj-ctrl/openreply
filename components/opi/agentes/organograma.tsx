"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { C_LEVELS, FUNDADOR, OPERACIONAIS, STATUS_LABEL, type MembroEquipe } from "@/lib/opi/agentes";
import { estadoDoMembro, iniciais, montarGrade, type EstadoNo, type ResumoAgente } from "@/lib/opi/agentes-dados";
import s from "./organograma.module.css";

const PONTO: Record<EstadoNo, string> = { ativo: s.pontoAtivo, "sob-demanda": s.pontoSob, futuro: s.pontoFuturo };
const ESTADO_CURTO: Record<EstadoNo, string> = { ativo: "Ativo", "sob-demanda": "Sob demanda", futuro: "Futuro" };

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

/** Linha de estado do cartão: ponto + texto (a cor nunca é a única pista). */
function Estado({ membro, resumo }: { membro: MembroEquipe; resumo?: ResumoAgente }) {
  const estado = estadoDoMembro(membro);
  return (
    <span className={s.estado}>
      <i aria-hidden className={`${s.ponto} ${PONTO[estado]}`} />
      {resumo?.ativo ? <b className={s.trabalhando}>Trabalhando agora</b> : ESTADO_CURTO[estado]}
      {resumo && resumo.abertos > 0 && <span className={s.abertos}>{plural(resumo.abertos, "pedido aberto", "pedidos abertos")}</span>}
    </span>
  );
}

interface OrganogramaProps {
  resumo: ResumoAgente[];
  /** Agente com o painel de pedido aberto (destaca o cartão). */
  selecionado: string | null;
  /** Abre o painel para mandar um pedido ao agente. */
  onSelecionar: (id: string) => void;
}

/**
 * Grade de cartões: o fundador no topo e os 12 diretores em 4 colunas (2 no celular).
 * Clicar num diretor abre a equipe dele logo abaixo da grade; nada rola para o lado.
 */
export function Organograma({ resumo, selecionado, onSelecionar }: OrganogramaProps) {
  const grade = useMemo(() => montarGrade(C_LEVELS, OPERACIONAIS), []);
  const resumoDe = (id: string) => resumo.find((r) => r.agente === id);
  const [aberto, setAberto] = useState<string | null>(null);
  const painelRef = useRef<HTMLElement>(null);
  const atual = grade.find((g) => g.chefe.id === aberto) ?? null;

  // No celular a equipe abre abaixo de seis fileiras: leva a tela até ela.
  useEffect(() => {
    if (!aberto) return;
    const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    painelRef.current?.scrollIntoView({ block: "nearest", behavior: reduzido ? "auto" : "smooth" });
  }, [aberto]);

  return (
    <div>
      <div className={s.topo}>
        <div className={`${s.cartao} ${s.fundador}`}>
          <span aria-hidden className={`${s.avatar} ${s.avatarFundador}`}>{iniciais(FUNDADOR.nome)}</span>
          <span className={s.texto}>
            <span className={s.nome}>{FUNDADOR.nome}</span>
            <span className={s.papel}>{FUNDADOR.papel}</span>
          </span>
        </div>
        <span aria-hidden className={s.haste} />
      </div>

      <ul className={s.grade} aria-label="Diretores">
        {grade.map(({ chefe, equipe }) => {
          const estado = estadoDoMembro(chefe);
          const expandido = aberto === chefe.id;
          const r = resumoDe(chefe.id);
          return (
            <li key={chefe.id} className={s.celula}>
              <button
                type="button"
                className={[s.cartao, s.diretor, estado === "futuro" && s.futuro, expandido && s.aberto, selecionado === chefe.id && s.selecionado]
                  .filter(Boolean)
                  .join(" ")}
                aria-expanded={expandido}
                aria-controls="equipe-do-diretor"
                data-no={chefe.id}
                onClick={() => setAberto(expandido ? null : chefe.id)}
              >
                <span className={s.cabeca}>
                  <span aria-hidden className={`${s.avatar} ${s.avatarChefe}`}>{iniciais(chefe.nome)}</span>
                  <span className={s.texto}>
                    <span className={s.nome}>{chefe.nome}</span>
                    <span className={s.papel}>{chefe.papel}</span>
                  </span>
                </span>
                <span className={s.rodape}>
                  <Estado membro={chefe} resumo={r} />
                  <span className={s.contagem}>
                    {equipe.length > 0 ? plural(equipe.length, "pessoa na equipe", "pessoas na equipe") : "Sem equipe"}
                    <svg viewBox="0 0 16 16" className={`${s.seta} ${expandido ? s.setaAberta : ""}`} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="m4 6 4 4 4-4" />
                    </svg>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <section
        id="equipe-do-diretor"
        ref={painelRef}
        className={s.painel}
        aria-live="polite"
        aria-label={atual ? `Equipe de ${atual.chefe.nome}` : "Equipe do diretor"}
        hidden={!atual}
      >
        {atual && (
          <>
            <header className={s.painelTopo}>
              <div className={s.painelTitulo}>
                <p className="opi-label">Equipe de {atual.chefe.nome}</p>
                <p className={s.painelSub}>
                  {atual.chefe.papel} · {atual.chefe.status ? STATUS_LABEL[atual.chefe.status] : ""}
                </p>
              </div>
              <button type="button" className={s.acao} onClick={() => onSelecionar(atual.chefe.id)}>
                Mandar pedido para {atual.chefe.nome}
              </button>
            </header>
            {atual.equipe.length === 0 ? (
              <p className={s.vazio}>Ninguém reporta a {atual.chefe.nome} no registro ainda.</p>
            ) : (
              <ul className={s.equipe}>
                {atual.equipe.map((m) => (
                  <li key={m.id} className={s.celula}>
                    <button
                      type="button"
                      className={[s.cartao, s.membro, estadoDoMembro(m) === "futuro" && s.futuro, selecionado === m.id && s.selecionado]
                        .filter(Boolean)
                        .join(" ")}
                      aria-label={`${m.nome}, ${m.papel}. ${m.status ? STATUS_LABEL[m.status] : ""}. Abrir para mandar um pedido.`}
                      data-no={m.id}
                      onClick={() => onSelecionar(m.id)}
                    >
                      <span className={s.cabeca}>
                        <span aria-hidden className={`${s.avatar} ${s.avatarEquipe}`}>{iniciais(m.nome)}</span>
                        <span className={s.texto}>
                          <span className={s.nome}>{m.nome.replace("/", "/​")}</span>
                          <span className={s.papel}>{m.papel}</span>
                        </span>
                      </span>
                      <span className={s.rodape}>
                        <Estado membro={m} resumo={resumoDe(m.id)} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <div className={s.legenda}>
        <span><i className={`${s.ponto} ${s.pontoAtivo}`} />Ativo</span>
        <span><i className={`${s.ponto} ${s.pontoSob}`} />Sob demanda</span>
        <span><i className={`${s.ponto} ${s.pontoFuturo}`} />Futuro</span>
        <span>Clique num diretor para ver a equipe. Dentro da equipe, clique em alguém para mandar um pedido.</span>
      </div>
    </div>
  );
}
