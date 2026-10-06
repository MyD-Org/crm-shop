/**
 * Cableado del motor de búsqueda (`motor.ts`) con las dependencias de verdad del Shop. SOLO
 * servidor. Es el único lugar que conoce cómo se lee una página (caché pública del catálogo o
 * lectura directa), de dónde sale el plan y qué política corre.
 *
 * - El ÚNICO plan que ve el motor es `planParaPagina` (caché o Entender determinista, NUNCA Jev):
 *   `/buscar` decide con Jev en su propio flujo y no pasa por acá. Las medidas se aplican dentro de
 *   `servidor.obtener`, así que llegan a todas las superficies sin que este módulo las conozca.
 * - La política la decide el flag `busqueda-motor-unico` (Vercel Flags, apagado por defecto y, si no
 *   se puede evaluar, apagado): apagado = `legado` (la conducta de siempre); prendido = `cascada`
 *   en las superficies de `SUPERFICIES_EN_CASCADA`. `busqueda-ia` apagado sigue mandando: sin plan.
 * - Nunca se llama dentro de un scope `'use cache'`: lee flags y plan por request.
 */
import { contarCatalogo, getPaginaCatalogo } from "../catalog";
import { facetasPublicas, paginaCatalogoPublica } from "../catalogo-publico";
import { busquedaIaHabilitada } from "../busqueda-ia-flag";
import { busquedaMotorUnico } from "../busqueda-motor-flag";
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
  /** Flag `busqueda-motor-unico` ya evaluado por el llamador; si falta, se lee acá (sólo si la superficie lo usa). */
  motorUnico?: boolean;
}

/**
 * Superficies que corren la cascada cuando el flag `busqueda-motor-unico` está prendido: las cuatro,
 * con un solo interruptor (apagado, todas vuelven a `legado`). El chat del vendedor y el selector
 * del admin se sumaron después del catálogo y el autocompletar, una vez medidos con el banco.
 */
export const SUPERFICIES_EN_CASCADA: ReadonlySet<Superficie> = new Set<Superficie>(["catalogo", "autocompletar", "chat", "admin"]);

/** Flag apagado = `legado` en todas; prendido = `cascada` sólo en las superficies habilitadas. */
export const politicaDe = (superficie: Superficie, motorUnico: boolean): Politica =>
  motorUnico && SUPERFICIES_EN_CASCADA.has(superficie) ? "cascada" : "legado";

async function leerBusquedaIa(c: ContextoShop): Promise<boolean> {
  if (c.busquedaIa !== undefined) return c.busquedaIa;
  // El selector del admin nunca usa plan: no hace falta leer el flag. El chat sólo lo usa en cascada
  // (en `legado` el motor ignora `conPlan`), así que leerlo es inofensivo con el motor apagado.
  if (c.superficie === "admin") return false;
  // Fail-safe: si no se puede leer el flag, se busca sin plan (la clásica).
  return busquedaIaHabilitada().catch(() => false);
}

async function leerMotorUnico(c: ContextoShop): Promise<boolean> {
  if (c.motorUnico !== undefined) return c.motorUnico;
  // Las superficies que todavía no corren la cascada no necesitan leer el flag.
  if (!SUPERFICIES_EN_CASCADA.has(c.superficie)) return false;
  // Fail-safe: si no se puede evaluar, política legado.
  return busquedaMotorUnico().catch(() => false);
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
  const [conPlan, motorUnico] = await Promise.all([leerBusquedaIa(c), leerMotorUnico(c)]);
  const politica = politicaDe(c.superficie, motorUnico);
  const planDe =
    c.superficie === "admin" || (c.superficie === "catalogo" && !c.conPlanDeUrl)
      ? undefined
      : (consulta: string) => planParaPagina(consulta, { soloVisibles: c.soloVisibles });
  const r = await buscar(p, { superficie: c.superficie, politica, conPlan, planDe, conFacetas: c.conFacetas }, depsDe(c));
  // Para vigilar el flag (etapa que resuelve y latencia). Nunca lleva la consulta.
  if (politica === "cascada") {
    console.info(`[busqueda] superficie=${c.superficie} politica=${politica} etapa=${r.etapa} ms=${Math.round(r.ms)}${r.truncado ? " truncado=1" : ""}`);
  }
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
  disp?: ContextoDisponibilidad;
}): Promise<number> {
  return contarCatalogo({ soloVisibles: a.soloVisibles, disp: a.disp, filtros: { ...a.filtros, texto: { q: a.consulta } } });
}
