"use client";

import { Button, EmptyState } from "@myd-org/ui";
import { TEXTOS_SIN_RESULTADOS } from "@/lib/busqueda-inteligente/textos";
import type { ChipSugerido } from "@/lib/busqueda-inteligente/url";
import { ChipSumar } from "./FranjaBusqueda";
import Link from "next/link";

/**
 * "Sin resultados" con salida (búsqueda inteligente, flag `busqueda-ia`):
 * nunca deja al visitante sin por dónde seguir.
 *
 * - Alternativas: lo que la interpretación sugirió, como chips-link (quitan la
 *   búsqueda y aplican ese filtro).
 * - Si hay filtros puestos (el 0 sale de combinarlos con la búsqueda, p. ej. una
 *   categoría tildada cuyo total no cuenta la búsqueda): "Buscar «consulta» sin
 *   filtros". La búsqueda se quita con su chip, arriba de la grilla.
 * - Si la búsqueda no pasó por `/buscar` (clásica), "Ver productos
 *   relacionados": la entiende la búsqueda v2.
 * - Con el filtro "Con stock en <local>" activo, el título lo dice y se ofrece
 *   "Ver en todos los locales" (quita sólo ese filtro).
 * - Si sólo hay coincidencias sin stock ("Solo con stock" es el default y la búsqueda no lo
 *   apaga sola): lo dice y ofrece verlas (apagarlo queda como elección de la persona).
 * - Siempre, "Ver todos los productos".
 */
export function CatalogoSinResultados({
  consulta,
  alternativas,
  relacionadosHref,
  sinFiltros,
  verTodos,
  local,
  sinStock,
}: {
  consulta: string;
  alternativas: ChipSugerido[];
  relacionadosHref?: string;
  /** Hay filtros puestos: quitarlos y quedarse con la búsqueda. */
  sinFiltros?: () => void;
  verTodos: () => void;
  /** Copy y salida cuando el filtro de local está activo (`sinResultadosPorLocal`). */
  local?: { titulo: string; descripcion: string; accion: string; quitar: () => void };
  /** Productos sin stock que coinciden (con "Solo con stock" puesto) y cómo verlos. */
  sinStock?: { total: number; ver: () => void };
}) {
  return (
    <EmptyState
      title={local?.titulo ?? TEXTOS_SIN_RESULTADOS.titulo(consulta)}
      description={
        local?.descripcion ??
        (sinStock
          ? TEXTOS_SIN_RESULTADOS.sinStock(sinStock.total)
          : sinFiltros
          ? TEXTOS_SIN_RESULTADOS.conFiltros
          : alternativas.length
            ? TEXTOS_SIN_RESULTADOS.conAlternativas
            : TEXTOS_SIN_RESULTADOS.sinAlternativas)
      }
      action={
        <div className="flex flex-col items-center gap-5">
          {local && (
            <Button variant="primary" onClick={local.quitar}>
              {local.accion}
            </Button>
          )}
          {!local && sinStock && (
            <Button variant="primary" onClick={sinStock.ver}>
              {TEXTOS_SIN_RESULTADOS.verSinStock}
            </Button>
          )}
          {!local && !sinStock && sinFiltros && (
            <Button variant="primary" onClick={sinFiltros}>
              {TEXTOS_SIN_RESULTADOS.sinFiltros(consulta)}
            </Button>
          )}
          {alternativas.length > 0 && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm font-medium text-muted">{TEXTOS_SIN_RESULTADOS.alternativas}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {alternativas.map((c) => (
                  <ChipSumar key={c.clave} chip={c} />
                ))}
              </div>
            </div>
          )}
          {relacionadosHref && (
            <Link href={relacionadosHref} prefetch={false} className="text-sm font-semibold text-accent underline-offset-4 hover:underline">
              {TEXTOS_SIN_RESULTADOS.relacionados}
            </Link>
          )}
          <Button variant="secondary" onClick={verTodos}>
            {TEXTOS_SIN_RESULTADOS.verTodos}
          </Button>
        </div>
      }
    />
  );
}
