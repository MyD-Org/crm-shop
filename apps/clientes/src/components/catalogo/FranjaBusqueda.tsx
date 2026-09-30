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
import { useHidratado } from "@/lib/hidratado";
import { ChispaIcon, ConversarIcon, MasIcon } from "./iconos";

/**
 * Franja de la búsqueda inteligente (flag `busqueda-ia`), arriba de la
 * grilla. Dos formas:
 *
 * - `FranjaInterpretada`: la URL vino de interpretar una búsqueda (`?ia=`).
 *   "Entendimos:" con los filtros aplicados como chips con ✕ (los mismos del
 *   panel) y "Ver resultados de «consulta» tal cual".
 * - `FranjaSugerencias`: la búsqueda trajo resultados y se interpretó por
 *   streaming. Los filtros propuestos son chips-link que se tocan para
 *   aplicarlos: nada se aplica solo, así la grilla no salta.
 *
 * Las dos llevan "Conversar" si hay chat (puente `useChatIa`) y, la primera
 * vez, la pista "Puede describir lo que necesita con sus palabras".
 *
 * Mismo lenguaje visual que el resto del catálogo: sólo tokens del DS (la
 * guarda sin-literales.test.ts mira esta carpeta). El borde y el fondo en el
 * tono de acento la separan de los filtros sin gritar.
 */
function FranjaMarco({
  titulo,
  children,
  acciones,
}: {
  titulo: string;
  children: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <section
      aria-label={TEXTOS_FRANJA.regionFranja}
      className="flex flex-col gap-3 rounded-lg border border-accent/20 bg-accent-soft/60 px-4 py-3 motion-safe:animate-aparecer"
    >
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
function BotonConversar({ consulta }: { consulta: string }) {
  const chat = useChatIa();
  if (!chat.disponible) return null;
  return (
    <Button variant="link" size="inline" onClick={() => chat.conversar(consulta)}>
      <ConversarIcon className="shrink-0" />
      {TEXTOS_SIN_RESULTADOS.conversar}
    </Button>
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

/** La URL vino de interpretar una búsqueda: lo que se entendió, removible, y la salida "tal cual". */
export function FranjaInterpretada({
  estado,
  ir,
}: {
  estado: EstadoCatalogo;
  ir: (cambios: Partial<EstadoCatalogo>) => void;
}) {
  const consulta = interpretacionVigente(estado);
  if (!consulta) return null;
  const filtros = chipsActivos(estado, null).filter((c) => /^(categoria|atributo):/.test(c.clave));
  return (
    <FranjaMarco
      titulo={TEXTOS_FRANJA.entendimos}
      acciones={
        <>
          <Link
            href={hrefTalCual(estado, consulta)}
            prefetch={false}
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            {TEXTOS_FRANJA.talCual(consulta)}
          </Link>
          <BotonConversar consulta={consulta} />
        </>
      }
    >
      {filtros.map((c) => (
        <Chip key={c.clave} variant="removable" removeLabel={c.removeLabel} onRemove={() => ir(c.cambios)}>
          {c.etiqueta}
        </Chip>
      ))}
      {estado.query && (
        <Chip
          variant="removable"
          removeLabel={TEXTOS_FRANJA.quitarTexto(estado.query)}
          // Conserva `ia`: sacar el texto residual no es una búsqueda nueva.
          onRemove={() => ir({ query: undefined, ia: estado.ia })}
        >
          {TEXTOS_FRANJA.texto(estado.query)}
        </Chip>
      )}
    </FranjaMarco>
  );
}

/** Filtros propuestos para una búsqueda con resultados: chips-link y, si hay varios, "Aplicar todo". */
export function FranjaSugerencias({
  consulta,
  chips,
  aplicarTodoHref,
}: {
  consulta: string;
  chips: ChipSugerido[];
  /** La interpretación completa aplicada (con `ia=`); sólo si propone más de un filtro. */
  aplicarTodoHref?: string;
}) {
  if (chips.length === 0) return null;
  return (
    <FranjaMarco
      titulo={TEXTOS_FRANJA.afinar}
      acciones={
        <>
          {aplicarTodoHref && (
            <Link
              href={aplicarTodoHref}
              prefetch={false}
              className="font-semibold text-accent underline-offset-4 hover:underline"
            >
              {TEXTOS_FRANJA.aplicarTodo}
            </Link>
          )}
          <BotonConversar consulta={consulta} />
        </>
      }
    >
      {chips.map((c) => (
        <ChipSumar key={c.clave} chip={c} />
      ))}
    </FranjaMarco>
  );
}

export { ChipSumar, BotonConversar };
