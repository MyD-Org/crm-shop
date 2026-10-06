/**
 * Oráculo `legado` del banco: lo que cada superficie hacía por su cuenta ANTES de la fachada,
 * escrito con las funciones viejas de la capa del catálogo (`getCatalogo`, `getPaginaCatalogo` con
 * `busqueda`/`planBusqueda`/`busquedaTolerante`). El banco corre el motor en política `legado` y
 * este oráculo sobre los mismos casos y compara ids (`--paridad`): si difieren, la fachada cambió
 * algo. Usa el MISMO `obtenerPlan` y el mismo `destinoDeBusqueda` real que el motor del banco.
 *
 * SE BORRA cuando se retiran los campos viejos de `FiltrosCatalogo` y la política `legado`
 * (cambio de limpieza); desde ahí la paridad es contra una corrida guardada (`--paridad-con`).
 * SOLO scripts.
 */
import { getCatalogo, getPaginaCatalogo, type FiltrosCatalogo } from "@/lib/catalog";
import { pareceCodigo } from "@/lib/busqueda-inteligente/gate";
import { IA_PLAN, filtrosDeEstado } from "@/lib/catalogo-url";
import { criterioDe } from "../destino";
import type { ResultadoBanco } from "./banco";
import { SUPERFICIES_BANCO, type SuperficieBanco } from "./corrida";
import { contarClasicaViejo, estadoDeBusqueda } from "./destino-banco";
import { resumenDelPlan } from "./motor";
import { obtenerPlan, type ContextoV2 } from "./v2";
import { VISTA_ACTUAL } from "./vista";

export interface ContextoLegado extends ContextoV2 {
  superficie: SuperficieBanco;
}

export async function ejecutarLegado(q: string, ctx: ContextoLegado): Promise<ResultadoBanco> {
  const inicio = Date.now();
  const vista = ctx.vista ?? VISTA_ACTUAL;
  const { k } = SUPERFICIES_BANCO[ctx.superficie];
  const { soloVisibles } = vista;
  const estructurados = ctx.estructurados ? { atributosEstructurados: true as const } : {};
  const ids = (productos: { id: string }[]) => productos.map((p) => p.id);

  if (ctx.superficie === "catalogo") {
    // Como la página del catálogo: plan si la URL trae `ia=1`; sin resultados y sin plan, la tolerante.
    const { plan, sinPlanCacheado } = await obtenerPlan(q, ctx, vista);
    const estado = await estadoDeBusqueda(q, vista, plan, contarClasicaViejo(vista));
    const conPlanDeUrl = estado.ia === IA_PLAN && !!plan;
    const filtros: FiltrosCatalogo = {
      ...filtrosDeEstado(estado),
      ...estructurados,
      ...(conPlanDeUrl && plan && plan.intencion !== "codigo" ? { planBusqueda: criterioDe(plan, estado) } : {}),
    };
    const leer = (f: FiltrosCatalogo) => getPaginaCatalogo({ filtros: f, orden: estado.orden, pagina: 1, soloVisibles });
    let pagina = await leer(filtros);
    if (pagina.total === 0 && filtros.busqueda?.trim() && !filtros.planBusqueda) {
      const segundo = await leer({ ...filtros, busquedaTolerante: true }).catch(() => null);
      if (segundo && segundo.total > 0) pagina = segundo;
    }
    return {
      ...resumenDelPlan(plan, conPlanDeUrl),
      productos: pagina.productos,
      total: pagina.total,
      ms: Date.now() - inicio,
      ids: ids(pagina.productos),
      ...(sinPlanCacheado ? { sinPlanCacheado: true } : {}),
    };
  }

  if (ctx.superficie === "autocompletar") {
    // Como `/api/shop/catalogo`: con plan (si no parece un código), después la exacta y la tolerante.
    const obtenido = !pareceCodigo(q) ? await obtenerPlan(q, ctx, vista) : null;
    const plan = obtenido?.plan ?? null;
    if (plan && plan.intencion !== "codigo") {
      const conPlan = await getPaginaCatalogo({
        filtros: { busqueda: q, planBusqueda: criterioDe(plan, { categorias: [], atributos: [] }), ...estructurados },
        orden: "relevancia",
        porPagina: k,
        soloVisibles,
      }).catch(() => null);
      if (conPlan?.productos.length) {
        return {
          ...resumenDelPlan(plan, false),
          productos: conPlan.productos,
          total: conPlan.total,
          ms: Date.now() - inicio,
          ids: ids(conPlan.productos),
          ...(obtenido?.sinPlanCacheado ? { sinPlanCacheado: true } : {}),
        };
      }
    }
    let productos = await getCatalogo({ busqueda: q, limit: k, soloVisibles });
    if (productos.length === 0) productos = await getCatalogo({ busqueda: q, limit: k, soloVisibles, tolerante: true }).catch(() => productos);
    return {
      ...resumenDelPlan(plan, false),
      productos,
      total: productos.length,
      ms: Date.now() - inicio,
      ids: ids(productos),
      ...(obtenido?.sinPlanCacheado ? { sinPlanCacheado: true } : {}),
    };
  }

  // chat: la exacta y, si no trae nada, la tolerante (sin plan, como el chat de hoy).
  let productos = await getCatalogo({ busqueda: q, limit: k, soloVisibles, ...estructurados });
  if (productos.length === 0) {
    productos = await getCatalogo({ busqueda: q, limit: k, soloVisibles, tolerante: true, ...estructurados }).catch(() => productos);
  }
  return {
    ...resumenDelPlan(null, false),
    productos,
    total: productos.length,
    ms: Date.now() - inicio,
    ids: ids(productos),
  };
}
