/**
 * Cableado del motor de búsqueda (`motor.ts`) con las dependencias de verdad del Shop. SOLO
 * servidor. Es el único lugar que conoce cómo se lee una página (caché pública del catálogo o
 * lectura directa), y de dónde sale el plan.
 *
 * - El ÚNICO plan que ve el motor es `planParaPagina` (caché o Entender determinista, NUNCA Jev):
 *   `/buscar` decide con Jev en su propio flujo y no pasa por acá. Las medidas se aplican dentro de
 *   `servidor.obtener`, así que llegan a todas las superficies sin que este módulo las conozca.
 * - El motor corre siempre la cascada en las cuatro superficies. El kill switch es `busqueda-ia`
 *   (Vercel Flags): apagado, o si no se puede evaluar, no hay plan.
 * - Nunca se llama dentro de un scope `'use cache'`: lee flags y plan por request.
 */
import type { CampaniaActiva } from "../campanias/vigentes";
import { SIN_MEDIOS_PRECIO } from "../medios-precio";
import { contarCatalogo, getPaginaCatalogo } from "../catalog";
import { facetasPublicas, paginaCatalogoPublica } from "../catalogo-publico";
import { busquedaIaHabilitada } from "../busqueda-ia-flag";
import type { ContextoDisponibilidad } from "../disponibilidad-contexto";
import type { MedioCuotas } from "../cuotas-sin-interes";
import type { MedioPrecio } from "../medios-precio";
import { buscar, type DepsMotor, type FiltrosSinTexto, type PedidoBuscar, type ResultadoBuscar, type Superficie } from "./motor";
import { planParaPagina } from "./servidor";

export interface ContextoShop {
  superficie: Superficie;
  /** Flag `catalogo-solo-visibles`, ya evaluado por el llamador. */
  soloVisibles: boolean;
  /** Flag `variantes-selector` (`flagsPublicos().variantes`), ya evaluado por el llamador. Ausente = apagado. */
  agrupar?: boolean;
  disp?: ContextoDisponibilidad;
  /** Sólo la página: medio destacado de las cards (parte de la clave de la caché). */
  destacado?: MedioPrecio | null;
  /** Sólo la página: cuotas sin interés de las cards (flag `cuotas-cobro`; parte de la clave de la caché). */
  cuotas?: MedioCuotas[] | null;
  /** Campañas de precios activas (`campaniasVigentes()`): el precio de campaña en toda superficie. */
  campanias?: CampaniaActiva[] | null;
  /** Sólo la página: la URL trae `ia=1`, así que el plan de la consulta aporta lo blando. */
  conPlanDeUrl?: boolean;
  /** Sólo la página: leer las facetas de cada etapa junto con la página. */
  conFacetas?: boolean;
  /** Flag `busqueda-ia` ya evaluado por el llamador; si falta, se lee acá. */
  busquedaIa?: boolean;
}

async function leerBusquedaIa(c: ContextoShop): Promise<boolean> {
  if (c.busquedaIa !== undefined) return c.busquedaIa;
  // El selector del admin nunca usa plan: no hace falta leer el flag.
  if (c.superficie === "admin") return false;
  // Fail-safe: si no se puede leer el flag, se busca sin plan (la clásica).
  return busquedaIaHabilitada().catch(() => false);
}

function depsDe(c: ContextoShop): DepsMotor {
  const { superficie, soloVisibles, disp, destacado, cuotas, campanias } = c;
  const agrupado = c.agrupar ? { agrupar: true } : {};
  // Fuera de la página (autocompletar, chat): sin medios, pero con el precio de campaña.
  const conCampanias = campanias?.length ? { mediosPrecio: { ...SIN_MEDIOS_PRECIO, campanias } } : {};
  return {
    pagina: ({ filtros, orden, pagina, porPagina, sinConteo }) =>
      superficie === "catalogo"
        ? // La página del catálogo siempre cuenta y pagina de a PRODUCTOS_POR_PAGINA (su caché lo asume).
          paginaCatalogoPublica({ filtros, orden, pagina, soloVisibles, ...agrupado, disp, destacado, cuotas, campanias })
        : getPaginaCatalogo({ soloVisibles, ...agrupado, filtros, orden, pagina, porPagina, disp, sinConteo, ...conCampanias }),
    facetas: (f) => {
      // El rango de precio del slider con el precio vigente (campañas activas), como la página.
      const filtros = campanias?.length ? { ...f, precioCampanias: campanias.map((x) => x.id) } : f;
      return c.agrupar ? facetasPublicas(filtros, soloVisibles, disp, true) : facetasPublicas(filtros, soloVisibles, disp);
    },
    log: (mensaje) => console.error(mensaje),
  };
}

/**
 * Busca en el catálogo del Shop para una superficie. El llamador pasa la consulta CRUDA y los
 * filtros sin texto; el motor decide las etapas. Tira si una etapa que no degrada falla.
 */
export async function buscarEnShop(p: PedidoBuscar, c: ContextoShop): Promise<ResultadoBuscar> {
  const conPlan = await leerBusquedaIa(c);
  const planDe =
    c.superficie === "admin" || (c.superficie === "catalogo" && !c.conPlanDeUrl)
      ? undefined
      : (consulta: string) => planParaPagina(consulta, { soloVisibles: c.soloVisibles, ...(c.agrupar ? { agrupar: true } : {}) });
  const r = await buscar(p, { superficie: c.superficie, conPlan, planDe, conFacetas: c.conFacetas }, depsDe(c));
  // Para vigilar el motor (etapa que resuelve y latencia). Nunca lleva la consulta.
  console.info(`[busqueda] superficie=${c.superficie} etapa=${r.etapa} ms=${Math.round(r.ms)}${r.truncado ? " truncado=1" : ""}`);
  return r;
}

/**
 * Cuántos productos da la búsqueda clásica (AND de términos) de una consulta con estos filtros:
 * lo que `/buscar` compara con el plan para decidir si la clásica ya alcanza.
 */
export function contarConsulta(a: {
  consulta: string;
  filtros: FiltrosSinTexto;
  soloVisibles: boolean;
  /** Flag `variantes-selector`: cuenta un producto por modelo. Ausente = apagado. */
  agrupar?: boolean;
  disp?: ContextoDisponibilidad;
}): Promise<number> {
  return contarCatalogo({ soloVisibles: a.soloVisibles, ...(a.agrupar ? { agrupar: true } : {}), disp: a.disp, filtros: { ...a.filtros, texto: { q: a.consulta } } });
}
