"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button, Chip } from "@myd-org/ui";
import { useChatIa } from "@/hooks/useChatIa";
import { chipsActivos } from "@/lib/catalogo-vista";
import type { EstadoCatalogo } from "@/lib/catalogo-url";
import { interpretacionVigente } from "@/lib/catalogo-vista";
import { cerrarPista, pistaDeEstaCarga } from "@/lib/busqueda-inteligente/pista";
import { TEXTOS_FRANJA, TEXTOS_SIN_RESULTADOS } from "@/lib/busqueda-inteligente/textos";
import { hrefTalCual, type ChipSugerido } from "@/lib/busqueda-inteligente/url";
import type { Intencion } from "@/lib/busqueda-v2/plan";
import { track } from "@/lib/tracking/track";
import type { OrigenConversar } from "@/lib/tracking/eventos";
import { useHidratado } from "@/lib/hidratado";
import { ChispaIcon, ConversarIcon, MasIcon } from "./iconos";

/**
 * Franja de la búsqueda inteligente (flag `busqueda-ia`), arriba de la
 * grilla, cuando la URL vino de entender una búsqueda (`?ia=1`, búsqueda v2):
 *
 * - "Entendimos:" con los filtros DUROS como chips con ✕ (los mismos del
 *   panel) y los blandos principales como chips "+ Afinar" (links: aplicarlos
 *   los vuelve duros vía URL; nada se aplica solo, la grilla no salta).
 * - Intención "pregunta": "Esto parece una consulta para el asesor ·
 *   Conversar", destacado encima.
 * - "Ver resultados de «consulta» tal cual" (`ia=0`) y "Conversar" si hay chat
 *   (puente `useChatIa`); la primera vez, la pista "Puede describir lo que
 *   necesita con sus palabras".
 *
 * Mismo lenguaje visual que el resto del catálogo: sólo tokens del DS (la
 * guarda sin-literales.test.ts mira esta carpeta). El borde y el fondo en el
 * tono de acento la separan de los filtros sin gritar.
 */
function FranjaMarco({
  titulo,
  children,
  acciones,
  arriba,
}: {
  titulo: string;
  children: ReactNode;
  acciones?: ReactNode;
  /** Algo destacado encima (el aviso de "pregunta"). */
  arriba?: ReactNode;
}) {
  return (
    <section
      aria-label={TEXTOS_FRANJA.regionFranja}
      className="flex flex-col gap-3 rounded-lg border border-accent/20 bg-accent-soft/60 px-4 py-3 motion-safe:animate-aparecer"
    >
      {arriba}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
        <p className="flex shrink-0 items-center gap-2 text-sm font-semibold text-text">
          <ChispaIcon className="h-4 w-4 shrink-0 text-accent" />
          {titulo}
        </p>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
        {acciones && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:ml-auto">{acciones}</div>
        )}
      </div>
      <Pista />
    </section>
  );
}

/** Chip que SUMA un filtro: un link (se abre en otra pestaña, se comparte, vuelve con atrás). */
function ChipSumar({ chip }: { chip: ChipSugerido }) {
  return (
    <Link
      href={chip.href}
      prefetch={false}
      className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3 py-1 text-sm font-medium text-text transition-colors hover:border-primary hover:bg-elevated"
    >
      <MasIcon className="shrink-0 text-muted" />
      {chip.etiqueta}
    </Link>
  );
}

/** "Conversar": abre el chat con la consulta como primer mensaje. Sin chat, nada. */
function BotonConversar({ consulta, origen = "franja" }: { consulta: string; origen?: OrigenConversar }) {
  const chat = useChatIa();
  if (!chat.disponible) return null;
  return (
    <Button
      variant="link"
      size="inline"
      onClick={() => {
        track({ tipo: "busqueda_conversar", origen });
        chat.conversar(consulta);
      }}
    >
      <ConversarIcon className="shrink-0" />
      {TEXTOS_SIN_RESULTADOS.conversar}
    </Button>
  );
}

/** La búsqueda parece una pregunta: el asesor, destacado encima de la franja. Sin chat, nada. */
function AvisoPregunta({ consulta }: { consulta: string }) {
  const chat = useChatIa();
  if (!chat.disponible) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-accent/30 bg-surface px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
      <p className="text-sm font-medium text-text">{TEXTOS_FRANJA.pregunta}</p>
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          track({ tipo: "busqueda_conversar", origen: "pregunta" });
          chat.conversar(consulta);
        }}
      >
        <ConversarIcon className="shrink-0" />
        {TEXTOS_SIN_RESULTADOS.conversar}
      </Button>
    </div>
  );
}

/**
 * "Enseñar haciendo": la primera vez que aparece la franja (se recuerda en
 * localStorage; ver lib/busqueda-inteligente/pista.ts). Recién después de
 * hidratar: el servidor no sabe si ya la vio.
 */
function Pista() {
  const hidratado = useHidratado();
  const [cerrada, setCerrada] = useState(false);
  if (!hidratado || cerrada) return null;
  if (!pistaDeEstaCarga(() => (typeof window === "undefined" ? undefined : window.localStorage))) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      {TEXTOS_FRANJA.pista}
      <Button
        variant="link"
        size="inline"
        onClick={() => {
          cerrarPista();
          setCerrada(true);
        }}
      >
        {TEXTOS_FRANJA.cerrarPista}
      </Button>
    </p>
  );
}

/**
 * La URL vino de entender una búsqueda: lo que se entendió (duros, removibles), lo que se puede
 * sumar (blandos, "+ Afinar") y la salida "tal cual".
 */
export function FranjaInterpretada({
  estado,
  ir,
  sugerencias = [],
  intencion,
}: {
  estado: EstadoCatalogo;
  ir: (cambios: Partial<EstadoCatalogo>) => void;
  /** Blandos del plan como chips que suman el filtro. */
  sugerencias?: ChipSugerido[];
  intencion?: Intencion;
}) {
  const consulta = interpretacionVigente(estado);
  if (!consulta) return null;
  const filtros = chipsActivos(estado, null).filter((c) => /^(categoria|atributo):/.test(c.clave));
  const visibles = sugerencias.filter((c) => !estado.categorias.includes(c.valor) && !estado.atributos.includes(c.valor));
  return (
    <FranjaMarco
      titulo={filtros.length ? TEXTOS_FRANJA.entendimos : TEXTOS_FRANJA.afinar}
      arriba={intencion === "pregunta" ? <AvisoPregunta consulta={consulta} /> : undefined}
      acciones={
        <>
          <Link
            href={hrefTalCual(estado, consulta)}
            prefetch={false}
            onClick={() => track({ tipo: "busqueda_ver_tal_cual" })}
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            {TEXTOS_FRANJA.talCual(consulta)}
          </Link>
          {intencion !== "pregunta" && <BotonConversar consulta={consulta} />}
        </>
      }
    >
      {filtros.map((c) => (
        <Chip
          key={c.clave}
          variant="removable"
          removeLabel={c.removeLabel}
          onRemove={() => {
            const [tipo, ...valor] = c.clave.split(":");
            track({ tipo: "busqueda_chip_quitado", chip: tipo === "categoria" ? "categoria" : "atributo", valor: valor.join(":") });
            ir(c.cambios);
          }}
        >
          {c.etiqueta}
        </Chip>
      ))}
      {visibles.map((c) => (
        <ChipSumar key={c.clave} chip={c} />
      ))}
    </FranjaMarco>
  );
}

export { ChipSumar, BotonConversar };
