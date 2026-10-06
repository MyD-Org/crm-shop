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
import { aplicarMedidasConIds, coberturaConContar } from "../entender/medidas-plan";
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
  /**
   * `--medidas=si`: aplica `aplicarMedidas` sobre el plan (cualquiera sea su origen: Entender, Jev grabado o
   * vivo, plan de la caché), como lo hace `servidor.obtener` con el flag `busqueda-medidas` prendido.
   * Ausente/false: la tubería de siempre.
   */
  medidas?: boolean;
}

async function primera(estado: EstadoCatalogo, estructurados: boolean, vista: VistaBanco, plan?: PlanBusqueda) {
  const criterio = plan ? criterioDe(plan, estado) : undefined;
  const filtros: FiltrosCatalogo = {
    ...filtrosDeEstado(estado),
    texto: { q: estado.query ?? "", ...(criterio ? { plan: criterio } : {}) },
    ...(estructurados ? { atributosEstructurados: true } : {}),
  };
  return getPaginaCatalogo({ filtros, orden: estado.orden, pagina: 1, soloVisibles: vista.soloVisibles });
}

/**
 * El ÚNICO punto del banco que adquiere el plan de una consulta (caché de producción con `planDe`,
 * si no Entender con el Jev elegido). Lo usan `ejecutarV2` y el motor del banco: así miden el MISMO
 * plan. Las medidas (`--medidas=si`) se aplican acá, una sola vez, y las dos tuberías las heredan.
 *
 * `plan: null` = Entender no pudo armar un plan (la búsqueda sigue clásica).
 */
export async function obtenerPlan(
  q: string,
  ctx: ContextoV2,
  vista: VistaBanco = ctx.vista ?? VISTA_ACTUAL,
): Promise<{ plan: PlanBusqueda | null; sinPlanCacheado: boolean; medidas?: string[] }> {
  // Como `servidor.ts`: la decisión duro/blando cuenta sobre el catálogo entero (con y sin stock).
  const contar = contador({ soloVisibles: vista.soloVisibles, soloStock: false, estructurados: ctx.estructurados });
  const cacheado = ctx.planDe ? await ctx.planDe(q) : null;
  const entendido = cacheado ? { plan: cacheado } : await entender(q, { arbol: ctx.arbol, jev: ctx.jev, contar });
  const plan = entendido?.plan ?? null;
  const sinPlanCacheado = !!ctx.planDe && !cacheado;
  if (!plan || !ctx.medidas) return { plan, sinPlanCacheado };
  // Mismos contadores que `servidor.conMedidas`: catálogo entero (con y sin stock), y el positivo aparte.
  const base = { soloVisibles: vista.soloVisibles, soloStock: false, estructurados: ctx.estructurados };
  const { plan: conMedidas, ids } = await aplicarMedidasConIds(plan, q, {
    activo: true,
    estructurados: ctx.estructurados,
    contar,
    contarPositivo: contador({ ...base, positivos: true }),
    cobertura: coberturaConContar(contar),
  });
  return { plan: conMedidas, sinPlanCacheado, medidas: ids };
}

export async function ejecutarV2(q: string, ctx: ContextoV2): Promise<ResultadoBanco> {
  const inicio = Date.now();
  const vista = ctx.vista ?? VISTA_ACTUAL;
  const base = estadoBase(q, vista);
  const { plan, sinPlanCacheado: sinPlan, medidas } = await obtenerPlan(q, ctx, vista);
  const sinPlanCacheado = sinPlan ? { sinPlanCacheado: true } : {};
  // Sólo si la tubería las produce (`--medidas=si`): ausente = el `hit` de medidas queda en null.
  const conMedidas = medidas ? { medidas } : {};
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
      ...conMedidas,
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
    ...conMedidas,
  };
}
