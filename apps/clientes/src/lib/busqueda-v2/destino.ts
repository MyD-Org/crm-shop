/**
 * Del plan a la URL y a los filtros del catálogo (búsqueda v2). Módulo puro:
 * lo usan el route handler `/buscar`, la página del catálogo y el banco.
 *
 * La búsqueda NO aplica filtros que la persona no eligió (estilo Mercado Libre): la URL final de una
 * búsqueda entendida es `/catalogo?q=<consulta original>&ia=1` más los filtros que la persona ya
 * tenía. Lo que el plan deduce como "duro" (categoría, atributo explícito, medida) no viaja como
 * filtro ni como chip: ORDENA, con el peso más alto de lo blando (`PESO_DEDUCIDO`); la categoría
 * deducida además acota los candidatos sin excluir lo que nombra todo lo escrito
 * (`acotarPorDeducidas`). `ia=1` le dice a la página que lea el plan de esa consulta.
 */
import { atributosValidos } from "../catalogo-atributos";
import { esMedidaId } from "../catalogo-atributos-medida";
import { IA_PLAN, hrefCatalogo, type EstadoCatalogo } from "../catalogo-url";
import type { CriterioPlan } from "./piezas";
import type { PlanBusqueda } from "./plan";

/**
 * Peso con que ordena lo que el plan deduce como duro (categoría, atributo o medida) y que ya no filtra:
 * el de un término original, el más alto de lo blando.
 */
export const PESO_DEDUCIDO = 1;

/**
 * Estado de destino: la consulta original como `q`, los filtros que la persona ya tenía (sin sumar
 * nada del plan), orden por relevancia e `ia=1`.
 */
export function estadoConPlan(base: EstadoCatalogo, plan: PlanBusqueda): EstadoCatalogo {
  return {
    ...base,
    query: plan.consulta,
    atributos: atributosValidos(base.atributos),
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
 * dos veces. Las medidas (`corriente_a:20`) quedan: su filtro duro es "sin
 * contradicción" y no puntúa, el blando sube a los que SÍ tienen el dato.
 *
 * Los duros del plan (lo deducido) entran como blandos de `PESO_DEDUCIDO`: ordenan, nunca filtran.
 * Las categorías deducidas viajan además como `deducidas`: acotan la recuperación sin dejar afuera
 * lo que tiene todas las palabras pedidas (`acotarPorDeducidas`). Si la persona ya eligió ese
 * filtro, manda el suyo.
 */
export function criterioDe(plan: PlanBusqueda, estado: Pick<EstadoCatalogo, "categorias" | "atributos">): CriterioPlan {
  const categorias = new Map<string, number>();
  for (const nombre of plan.duros.categorias) categorias.set(nombre, PESO_DEDUCIDO);
  for (const c of plan.blandos.categorias) categorias.set(c.nombre, Math.max(c.peso, categorias.get(c.nombre) ?? 0));
  const atributos = new Map<string, number>();
  for (const id of plan.duros.atributos) atributos.set(id, PESO_DEDUCIDO);
  for (const a of plan.blandos.atributos) atributos.set(a.id, Math.max(a.peso, atributos.get(a.id) ?? 0));
  return {
    consulta: plan.consulta,
    blandos: {
      categorias: [...categorias]
        .filter(([nombre]) => !estado.categorias.includes(nombre))
        .map(([nombre, peso]) => ({ nombre, peso })),
      atributos: [...atributos]
        .filter(([id]) => esMedidaId(id) || !estado.atributos.includes(id))
        .map(([id, peso]) => ({ id, peso })),
      terminos: plan.blandos.terminos,
    },
    ...(categoriasDelPlan(plan).length ? { categoriasDelPlan: categoriasDelPlan(plan) } : {}),
    ...(plan.duros.categorias.length ? { deducidas: [...plan.duros.categorias] } : {}),
  };
}

const categoriasDelPlan = (plan: PlanBusqueda) => [...new Set([...plan.duros.categorias, ...plan.blandos.categorias.map((c) => c.nombre)])];
