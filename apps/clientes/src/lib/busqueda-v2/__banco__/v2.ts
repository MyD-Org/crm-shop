/**
 * Tubería de la búsqueda v2 para el banco en vivo: Entender (con Jev grabado o
 * en vivo), el destino de `/buscar` y la primera página del catálogo con el
 * plan, igual que `/catalogo?…&ia=1`. SOLO scripts.
 */
import { getPaginaCatalogo, type FiltrosCatalogo } from "@/lib/catalog";
import { filtrosDeEstado, type EstadoCatalogo } from "@/lib/catalogo-url";
import type { NodoArbol } from "@/lib/busqueda-inteligente/tipos";
import { contador } from "../conteo";
import { criterioDe, estadoConPlan } from "../destino";
import { entender, type ClienteJev } from "../entender/entender";
import { PESO_MINIMO_RECUPERAR, type PlanBusqueda } from "../plan";
import type { ResultadoBanco } from "./banco";
import { VISTA_ACTUAL, estadoBase, type VistaBanco } from "./vista";

export interface ContextoV2 {
  arbol: NodoArbol[];
  jev: ClienteJev | null;
  estructurados: boolean;
  /** Visibilidad y stock con que se mide. Por defecto `VISTA_ACTUAL` (la variante de siempre del banco). */
  vista?: VistaBanco;
  /**
   * `--jev=cache`: el plan que sirvió la caché de producción para esa consulta (lectura sin sumar uso).
   * `null` = no hay plan cacheado: se cae a Entender determinista (sin Jev) y se cuenta como `sinPlanCacheado`.
   */
  planDe?: (q: string) => Promise<PlanBusqueda | null>;
}

async function primera(estado: EstadoCatalogo, estructurados: boolean, vista: VistaBanco, plan?: PlanBusqueda) {
  const filtros: FiltrosCatalogo = {
    ...filtrosDeEstado(estado),
    ...(estructurados ? { atributosEstructurados: true } : {}),
    ...(plan ? { planBusqueda: criterioDe(plan, estado) } : {}),
  };
  return getPaginaCatalogo({ filtros, orden: estado.orden, pagina: 1, soloVisibles: vista.soloVisibles });
}

/**
 * El ÚNICO punto del banco que adquiere el plan de una consulta (caché de producción con `planDe`,
 * si no Entender con el Jev elegido). Lo usan `ejecutarV2`, el motor del banco y el oráculo
 * legado: así miden el MISMO plan. Cuando la búsqueda de medidas se aplique sobre el plan,
 * se agrega acá, una sola vez, y las tres tuberías la heredan.
 *
 * `plan: null` = Entender no pudo armar un plan (la búsqueda sigue clásica).
 */
export async function obtenerPlan(
  q: string,
  ctx: ContextoV2,
  vista: VistaBanco = ctx.vista ?? VISTA_ACTUAL,
): Promise<{ plan: PlanBusqueda | null; sinPlanCacheado: boolean }> {
  // Como `servidor.ts`: la decisión duro/blando cuenta sobre el catálogo entero (con y sin stock).
  const contar = contador({ soloVisibles: vista.soloVisibles, soloStock: false, estructurados: ctx.estructurados });
  const cacheado = ctx.planDe ? await ctx.planDe(q) : null;
  const entendido = cacheado ? { plan: cacheado } : await entender(q, { arbol: ctx.arbol, jev: ctx.jev, contar });
  return { plan: entendido?.plan ?? null, sinPlanCacheado: !!ctx.planDe && !cacheado };
}

export async function ejecutarV2(q: string, ctx: ContextoV2): Promise<ResultadoBanco> {
  const inicio = Date.now();
  const vista = ctx.vista ?? VISTA_ACTUAL;
  const base = estadoBase(q, vista);
  const { plan, sinPlanCacheado: sinPlan } = await obtenerPlan(q, ctx, vista);
  const sinPlanCacheado = sinPlan ? { sinPlanCacheado: true } : {};
  if (!plan || plan.intencion === "codigo") {
    const p = await primera(base, ctx.estructurados, vista);
    return {
      intencion: plan?.intencion,
      categoriasDuras: [],
      categoriasBlandas: [],
      atributosDuros: [],
      expansiones: [],
      productos: p.productos,
      total: p.total,
      ms: Date.now() - inicio,
      ...sinPlanCacheado,
    };
  }
  const p = await primera(estadoConPlan(base, plan), ctx.estructurados, vista, plan);
  return {
    intencion: plan.intencion,
    categoriasDuras: plan.duros.categorias,
    categoriasBlandas: plan.blandos.categorias.map((c) => c.nombre),
    atributosDuros: plan.duros.atributos,
    expansiones: plan.blandos.terminos.filter((t) => t.peso < 1 && t.peso >= PESO_MINIMO_RECUPERAR).map((t) => t.texto),
    productos: p.productos,
    total: p.total,
    ms: Date.now() - inicio,
    ...sinPlanCacheado,
  };
}
