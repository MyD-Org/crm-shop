/**
 * Del plan a la URL y a los filtros del catálogo (búsqueda v2). Módulo puro:
 * lo usan el route handler `/buscar`, la página del catálogo y el banco.
 *
 * La URL final de una búsqueda entendida es
 * `/catalogo?q=<consulta original>&categoria=<duras>&atr=<duros>&ia=1`: los
 * duros son filtros de siempre (se quitan con la ✕ del costado o de la
 * franja) y `ia=1` le dice a la página que lea el plan de esa consulta para lo
 * blando. Todo pasa por `lib/catalogo-url.ts`, que descarta lo inválido.
 */
import { atributosValidos } from "../catalogo-atributos";
import { IA_PLAN, hrefCatalogo, type EstadoCatalogo } from "../catalogo-url";
import type { CriterioPlan } from "./piezas";
import type { PlanBusqueda } from "./plan";

const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])];

/** Estado de destino: la consulta original como `q`, los duros sumados a los filtros vigentes e `ia=1`. */
export function estadoConPlan(base: EstadoCatalogo, plan: PlanBusqueda): EstadoCatalogo {
  return {
    ...base,
    query: plan.consulta,
    categorias: union(base.categorias, plan.duros.categorias),
    atributos: atributosValidos(union(base.atributos, plan.duros.atributos)),
    orden: "relevancia",
    pagina: 1,
    ia: IA_PLAN,
  };
}

export function hrefConPlan(base: EstadoCatalogo, plan: PlanBusqueda): string {
  return hrefCatalogo(estadoConPlan(base, plan));
}

/**
 * Lo blando del plan que usan Recuperar y Ordenar, sin lo que el estado ya
 * tiene como filtro duro: un "+ Afinar" aplicado (ahora en la URL) no suma
 * dos veces.
 */
export function criterioDe(plan: PlanBusqueda, estado: Pick<EstadoCatalogo, "categorias" | "atributos">): CriterioPlan {
  return {
    consulta: plan.consulta,
    blandos: {
      categorias: plan.blandos.categorias.filter((c) => !estado.categorias.includes(c.nombre)),
      atributos: plan.blandos.atributos.filter((a) => !estado.atributos.includes(a.id)),
      terminos: plan.blandos.terminos,
    },
  };
}
