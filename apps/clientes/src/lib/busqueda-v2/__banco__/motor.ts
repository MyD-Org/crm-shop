/**
 * Tubería `motor` del banco: la búsqueda del Shop por la fachada `buscar()` (busqueda-v2/motor.ts),
 * con la política (`legado` | `cascada`) y la superficie (`catalogo` | `autocompletar` | `chat`) que
 * se quieran medir. SOLO scripts.
 *
 * - catálogo: lo que hace el sitio. `/buscar` (la función REAL, `destinoDeBusqueda`) decide entre
 *   la clásica y `ia=1` con los duros del plan; la página lee esa URL y llama al motor con
 *   `conPlanDeUrl`. Primera página, 24 productos, con conteo.
 * - autocompletar (8) y chat (10): el motor con el plan perezoso de la corrida, sin conteo, sin
 *   filtro de stock y sin duros del plan (como en producción).
 *
 * El plan sale de `obtenerPlan` (v2.ts), el MISMO punto que usan `ejecutarV2` y el oráculo legado.
 */
import { PRODUCTOS_POR_PAGINA, contarCatalogo, getPaginaCatalogo } from "@/lib/catalog";
import { IA_PLAN, filtrosDeEstado } from "@/lib/catalogo-url";
import { PESO_MINIMO_RECUPERAR, type PlanBusqueda } from "../plan";
import { buscar, sinTexto, type DepsMotor, type FiltrosSinTexto } from "../motor";
import type { ResultadoBanco } from "./banco";
import { SUPERFICIES_BANCO, type PoliticaBanco, type SuperficieBanco } from "./corrida";
import { estadoDeBusqueda } from "./destino-banco";
import { obtenerPlan, type ContextoV2 } from "./v2";
import { VISTA_ACTUAL, type VistaBanco } from "./vista";

export interface ContextoMotor extends ContextoV2 {
  politica: PoliticaBanco;
  superficie: SuperficieBanco;
}

export const depsDelBanco = (vista: VistaBanco): DepsMotor => ({
  pagina: ({ filtros, orden, pagina, porPagina, sinConteo }) =>
    getPaginaCatalogo({ soloVisibles: vista.soloVisibles, filtros, orden, pagina, porPagina, sinConteo }),
});

/** Cómo se informa lo entendido del plan (para las métricas de categoría/atributos). */
export function resumenDelPlan(plan: PlanBusqueda | null, conDuros: boolean) {
  return {
    intencion: plan?.intencion,
    categoriasDuras: conDuros && plan ? plan.duros.categorias : [],
    categoriasBlandas: plan ? plan.blandos.categorias.map((c) => c.nombre) : [],
    atributosDuros: conDuros && plan ? plan.duros.atributos : [],
    expansiones: plan ? plan.blandos.terminos.filter((t) => t.peso < 1 && t.peso >= PESO_MINIMO_RECUPERAR).map((t) => t.texto) : [],
  };
}

export async function ejecutarMotor(q: string, ctx: ContextoMotor): Promise<ResultadoBanco> {
  const inicio = Date.now();
  const vista = ctx.vista ?? VISTA_ACTUAL;
  const { k, conteo } = SUPERFICIES_BANCO[ctx.superficie];
  const estructurados: FiltrosSinTexto = ctx.estructurados ? { atributosEstructurados: true } : {};
  const deps = depsDelBanco(vista);

  if (ctx.superficie === "catalogo") {
    const { plan, sinPlanCacheado } = await obtenerPlan(q, ctx, vista);
    // La decisión de `/buscar` cuenta la clásica con el mismo armado de texto que el motor.
    const estado = await estadoDeBusqueda(q, vista, plan, (base) =>
      contarCatalogo({
        soloVisibles: vista.soloVisibles,
        filtros: { ...sinTexto(filtrosDeEstado(base)), texto: { q: base.query ?? "" } },
      }),
    );
    const conPlanDeUrl = estado.ia === IA_PLAN && !!plan;
    const r = await buscar(
      {
        consulta: estado.query,
        filtros: { ...sinTexto(filtrosDeEstado(estado)), ...estructurados },
        orden: estado.orden,
        pagina: 1,
        porPagina: PRODUCTOS_POR_PAGINA,
      },
      { superficie: "catalogo", politica: ctx.politica, conPlan: true, conteo, planDe: conPlanDeUrl ? async () => plan : undefined },
      deps,
    );
    return {
      ...resumenDelPlan(plan, conPlanDeUrl),
      productos: r.productos,
      total: r.total,
      ms: Date.now() - inicio,
      etapa: r.etapa,
      ids: r.productos.map((p) => p.id),
      ...(sinPlanCacheado ? { sinPlanCacheado: true } : {}),
    };
  }

  // Autocompletar y chat: el plan se pide sólo si la política lo usa (perezoso, una vez por caso).
  const memo: { plan?: Awaited<ReturnType<typeof obtenerPlan>> } = {};
  const planDe = async () => {
    memo.plan ??= await obtenerPlan(q, ctx, vista);
    return memo.plan.plan;
  };
  const r = await buscar(
    { consulta: q, filtros: estructurados, orden: "relevancia", pagina: 1, porPagina: k },
    { superficie: ctx.superficie, politica: ctx.politica, conPlan: true, conteo, planDe },
    deps,
  );
  return {
    ...resumenDelPlan(r.plan, false),
    productos: r.productos,
    total: r.total,
    ms: Date.now() - inicio,
    etapa: r.etapa,
    ids: r.productos.map((p) => p.id),
    ...(memo.plan?.sinPlanCacheado ? { sinPlanCacheado: true } : {}),
  };
}
