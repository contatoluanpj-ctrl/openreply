"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { C_LEVELS, FUNDADOR, OPERACIONAIS, STATUS_LABEL, type MembroEquipe } from "@/lib/opi/agentes";
import { estadoDoMembro, iniciais, montarOrganograma, type ResumoAgente } from "@/lib/opi/agentes-dados";
import s from "./organograma.module.css";

type Nivel = "fundador" | "chefe" | "equipe";

interface NoProps {
  membro: MembroEquipe;
  nivel: Nivel;
  resumo?: ResumoAgente;
  selecionado: boolean;
  onSelecionar?: (id: string) => void;
}

const AVATAR: Record<Nivel, string> = { fundador: s.avatarFundador, chefe: s.avatarChefe, equipe: s.avatarEquipe };
const PONTO = { ativo: s.pontoAtivo, "sob-demanda": s.pontoSob, futuro: s.pontoFuturo } as const;

function No({ membro, nivel, resumo, selecionado, onSelecionar }: NoProps) {
  const estado = estadoDoMembro(membro);
  const estadoTexto = membro.status ? STATUS_LABEL[membro.status] : "Fundador";
  const classes = [s.no, nivel === "fundador" && s.fundador, estado === "futuro" && s.futuro, selecionado && s.selecionado]
    .filter(Boolean)
    .join(" ");
  const corpo = (
    <>
      <span aria-hidden className={`${s.avatar} ${AVATAR[nivel]}`}>{iniciais(membro.nome)}</span>
      <span className={s.texto}>
        <span className={s.nome}>{membro.nome.replace("/", "/\u200b")}</span>
        <span className={s.papel}>{membro.papel}</span>
        {resumo?.ativo && <span className={s.trabalhando}>Trabalhando agora</span>}
      </span>
      {nivel !== "fundador" && <span aria-hidden title={estadoTexto} className={`${s.ponto} ${PONTO[estado]}`} />}
    </>
  );
  if (!onSelecionar) return <div className={classes}>{corpo}</div>;
  return (
    <button
      type="button"
      className={classes}
      aria-pressed={selecionado}
      aria-label={`${membro.nome}, ${membro.papel}. ${estadoTexto}${resumo?.ativo ? ", trabalhando agora" : ""}. Abrir para mandar um pedido.`}
      data-no={membro.id}
      onClick={() => onSelecionar(membro.id)}
    >
      {corpo}
    </button>
  );
}

interface OrganogramaProps {
  resumo: ResumoAgente[];
  selecionado: string | null;
  onSelecionar: (id: string) => void;
}

/** Luan no topo, todos os C-levels lado a lado, e a equipe de cada um logo abaixo. Arrasta para os lados. */
export function Organograma({ resumo, selecionado, onSelecionar }: OrganogramaProps) {
  const { colunas } = useMemo(() => montarOrganograma(C_LEVELS, OPERACIONAIS), []);
  const resumoDe = (id: string) => resumo.find((r) => r.agente === id);
  const panRef = useRef<HTMLDivElement>(null);
  const arraste = useRef<{ x: number; scroll: number; moveu: boolean } | null>(null);
  const [arrastando, setArrastando] = useState(false);

  // Começa centralizado no fundador (os C-levels com equipe ficam logo abaixo dele).
  useEffect(() => {
    const el = panRef.current;
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, []);

  // Arrastar com o mouse para os lados (no toque o navegador já faz o pan).
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse" || e.button !== 0 || !panRef.current) return;
    arraste.current = { x: e.clientX, scroll: panRef.current.scrollLeft, moveu: false };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const a = arraste.current;
    if (!a || !panRef.current) return;
    const dx = e.clientX - a.x;
    if (!a.moveu && Math.abs(dx) > 4) {
      a.moveu = true;
      setArrastando(true);
      panRef.current.setPointerCapture(e.pointerId);
    }
    if (a.moveu) panRef.current.scrollLeft = a.scroll - dx;
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const a = arraste.current;
    arraste.current = null;
    if (a?.moveu) {
      setArrastando(false);
      panRef.current?.releasePointerCapture(e.pointerId);
      // não deixa o fim do arraste virar clique num nó
      const bloquear = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener("click", bloquear, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", bloquear, { capture: true }), 0);
    }
  }

  return (
    <div>
      <div
        ref={panRef}
        className={`${s.pan} ${arrastando ? s.arrastando : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className={s.tree}>
          <div className={s.raiz}>
            <No membro={FUNDADOR} nivel="fundador" selecionado={false} />
          </div>
          <ul className={s.colunas} aria-label="C-levels e suas equipes">
            {colunas.map(({ chefe, equipe }) => (
              <li key={chefe.id} className={s.coluna}>
                <No
                  membro={chefe}
                  nivel="chefe"
                  resumo={resumoDe(chefe.id)}
                  selecionado={selecionado === chefe.id}
                  onSelecionar={onSelecionar}
                />
                {equipe.length > 0 && (
                  <ul className={s.equipe} aria-label={`Equipe de ${chefe.nome}`}>
                    {equipe.map((m) => (
                      <li key={m.id} className={s.item}>
                        <No
                          membro={m}
                          nivel="equipe"
                          resumo={resumoDe(m.id)}
                          selecionado={selecionado === m.id}
                          onSelecionar={onSelecionar}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className={s.legenda}>
        <span><i className={`${s.ponto} ${s.pontoAtivo}`} />Ativo</span>
        <span><i className={`${s.ponto} ${s.pontoSob}`} />Sob demanda</span>
        <span><i className={`${s.ponto} ${s.pontoFuturo}`} />Futuro</span>
        <span>Clique em qualquer cartão para mandar um pedido. Arraste para os lados para ver todos.</span>
      </div>
    </div>
  );
}
