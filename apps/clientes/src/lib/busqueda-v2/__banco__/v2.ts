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

export async function ejecutarV2(q: string, ctx: ContextoV2): Promise<ResultadoBanco> {
  const inicio = Date.now();
  const vista = ctx.vista ?? VISTA_ACTUAL;
  const base = estadoBase(q, vista);
  // Como `servidor.ts`: la decisión duro/blando cuenta sobre el catálogo entero (con y sin stock).
  const contar = contador({ soloVisibles: vista.soloVisibles, soloStock: false, estructurados: ctx.estructurados });
  const cacheado = ctx.planDe ? await ctx.planDe(q) : null;
  const entendido = cacheado ? { plan: cacheado } : await entender(q, { arbol: ctx.arbol, jev: ctx.jev, contar });
  const sinPlanCacheado = !!ctx.planDe && !cacheado ? { sinPlanCacheado: true } : {};
  if (!entendido || entendido.plan.intencion === "codigo") {
    const p = await primera(base, ctx.estructurados, vista);
    return {
      intencion: entendido?.plan.intencion,
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
  const { plan } = entendido;
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
