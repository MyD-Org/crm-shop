/**
 * Decisión de la page cuando una búsqueda con 0–3 resultados se interpretó
 * (spec catálogo asistido §4): redirigir a la URL interpretada o quedarse y
 * ofrecer la interpretación como sugerencias. Módulo puro: el conteo llega
 * como dependencia.
 *
 * Nunca se redirige a un estado vacío por haber tirado palabras que importan:
 * si la interpretación dejó texto residual ("pecera salada"), se cuenta ese
 * estado primero; con 0 resultados no se redirige y el "sin resultados"
 * ofrece los filtros interpretados como alternativas (más "Conversar").
 */
import { hrefCatalogo, type EstadoCatalogo } from "../catalogo-url";
import { hayQueAplicar, type Interpretacion } from "./tipos";
import { chipsSugeridos, estadoInterpretado, type ChipSugerido } from "./url";

export interface DecisionBusqueda {
  /** URL a la que redirigir, o ausente para quedarse. */
  redirigir?: string;
  /** Alternativas del "sin resultados" (quitan la búsqueda y aplican el filtro). */
  alternativas: ChipSugerido[];
  /** Chips de la franja cuando hay algún resultado (suman el filtro). */
  chipsFranja: ChipSugerido[];
}

export async function decidirBusqueda(
  estado: EstadoCatalogo,
  total: number,
  interpretacion: Interpretacion | null,
  contar: (estado: EstadoCatalogo) => Promise<number>,
): Promise<DecisionBusqueda> {
  if (interpretacion && hayQueAplicar(interpretacion)) {
    const destino = estadoInterpretado(estado, interpretacion);
    // Sin residual mandan los filtros; con residual, sólo si ese estado trae algo.
    if (!interpretacion.aplicar.q || (await contar(destino)) > 0) {
      return { redirigir: hrefCatalogo(destino), alternativas: [], chipsFranja: [] };
    }
  }
  const filtros = interpretacion ? [interpretacion.aplicar, interpretacion.sugerir] : [];
  return {
    alternativas: total === 0 ? chipsSugeridos(estado, filtros, "reemplazar") : [],
    chipsFranja: total > 0 ? chipsSugeridos(estado, filtros) : [],
  };
}
