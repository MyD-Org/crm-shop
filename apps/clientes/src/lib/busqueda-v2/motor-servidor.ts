/**
 * Cableado del motor de búsqueda (`motor.ts`) con las dependencias de verdad del Shop. SOLO
 * servidor. Es el único lugar que conoce cómo se lee una página (caché pública del catálogo o
 * lectura directa), de dónde sale el plan y qué política corre.
 *
 * - El ÚNICO plan que ve el motor es `planParaPagina` (caché o Entender determinista, NUNCA Jev):
 *   `/buscar` decide con Jev en su propio flujo y no pasa por acá. Las medidas se aplican dentro de
 *   `servidor.obtener`, así que llegan a todas las superficies sin que este módulo las conozca.
 * - Política fija `legado` (conducta de hoy); la cascada y su flag llegan en el cambio siguiente.
 * - Nunca se llama dentro de un scope `'use cache'`: lee flags y plan por request.
 */
import { contarCatalogo, getPaginaCatalogo } from "../catalog";
import { facetasPublicas, paginaCatalogoPublica } from "../catalogo-publico";
import { busquedaIaHabilitada } from "../busqueda-ia-flag";
import type { ContextoDisponibilidad } from "../disponibilidad-contexto";
import type { MedioPrecio } from "../medios-precio";
import { buscar, type DepsMotor, type FiltrosSinTexto, type PedidoBuscar, type Politica, type ResultadoBuscar, type Superficie } from "./motor";
import { planParaPagina } from "./servidor";

export interface ContextoShop {
  superficie: Superficie;
  /** Flag `catalogo-solo-visibles`, ya evaluado por el llamador. */
  soloVisibles: boolean;
  disp?: ContextoDisponibilidad;
  /** Sólo la página: medio destacado de las cards (parte de la clave de la caché). */
  destacado?: MedioPrecio | null;
  /** Sólo la página: la URL trae `ia=1`, así que el plan de la consulta aporta lo blando. */
  conPlanDeUrl?: boolean;
  /** Sólo la página: leer las facetas de cada etapa junto con la página. */
  conFacetas?: boolean;
  /** Flag `busqueda-ia` ya evaluado por el llamador; si falta, se lee acá. */
  busquedaIa?: boolean;
}

/**
 * Superficies que corren la cascada cuando el flag `busqueda-motor-unico` está prendido. Vacío en
 * este cambio: todas corren la política `legado`.
 */
export const SUPERFICIES_EN_CASCADA: ReadonlySet<Superficie> = new Set();

const politicaDe = (): Politica => "legado";

async function leerBusquedaIa(c: ContextoShop): Promise<boolean> {
  if (c.busquedaIa !== undefined) return c.busquedaIa;
  // Chat y selector del admin nunca usan plan: no hace falta leer el flag.
  if (c.superficie === "chat" || c.superficie === "admin") return false;
  // Fail-safe: si no se puede leer el flag, se busca sin plan (la clásica).
  return busquedaIaHabilitada().catch(() => false);
}

function depsDe(c: ContextoShop): DepsMotor {
  const { superficie, soloVisibles, disp, destacado } = c;
  return {
    pagina: ({ filtros, orden, pagina, porPagina, sinConteo }) =>
      superficie === "catalogo"
        ? // La página del catálogo siempre cuenta y pagina de a PRODUCTOS_POR_PAGINA (su caché lo asume).
          paginaCatalogoPublica({ filtros, orden, pagina, soloVisibles, disp, destacado })
        : getPaginaCatalogo({ soloVisibles, filtros, orden, pagina, porPagina, disp, sinConteo }),
    facetas: (filtros) => facetasPublicas(filtros, soloVisibles, disp),
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
      : (consulta: string) => planParaPagina(consulta, { soloVisibles: c.soloVisibles });
  return buscar(
    p,
    { superficie: c.superficie, politica: politicaDe(), conPlan, planDe, conFacetas: c.conFacetas },
    depsDe(c),
  );
}

/**
 * Cuántos productos da la búsqueda clásica (AND de términos) de una consulta con estos filtros:
 * lo que `/buscar` compara con el plan para decidir si la clásica ya alcanza.
 */
export function contarConsulta(a: {
  consulta: string;
  filtros: FiltrosSinTexto;
  soloVisibles: boolean;
  disp?: ContextoDisponibilidad;
}): Promise<number> {
  return contarCatalogo({ soloVisibles: a.soloVisibles, disp: a.disp, filtros: { ...a.filtros, texto: { q: a.consulta } } });
}
