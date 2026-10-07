/**
 * La búsqueda v2 con las dependencias de verdad. SOLO servidor.
 *
 * - `planParaBuscar` (route handler `/buscar`): caché (memoria → base, sumando
 *   un uso) y, si no está, Entender con Jev (`JEV_API_KEY`, con el tope por IP
 *   y global de la fase 1). Guarda el plan salvo que Jev se necesitara y no
 *   respondiera (la próxima vez se reintenta).
 * - `planParaPagina` (`/catalogo?…&ia=1`): caché sin sumar uso y, si no está,
 *   Entender SIN Jev (determinista). Nunca llama a Jev ni escribe: una URL con
 *   `ia=1` inventado no puede gastar nada.
 *
 * Ninguna tira: sin árbol se entiende sin categorías; la caché y Jev degradan
 * solos; ante cualquier otro error, `null` (la búsqueda sigue clásica).
 */
import { getArbolCategorias } from "../catalog";
import { atributosEstructuradosDisponibles } from "../catalogo-atributos-disponibles";
import { busquedaMedidasHabilitada } from "../busqueda-medidas-flag";
import { shopTenantId } from "../tenant";
import { createHash } from "node:crypto";
import { hashArbol } from "../busqueda-inteligente/cache";
import { consultarJev } from "../busqueda-inteligente/jev";
import { dentroDelTope, jevConTope } from "../busqueda-inteligente/limite";
import { normalizarConsulta } from "../busqueda-inteligente/normalizar";
import type { NodoArbol } from "../busqueda-inteligente/tipos";
import { Lru, claveLru, guardarPlan, leerPlan, lru } from "./cache";
import { contador } from "./conteo";
import { entender, type ClienteJev } from "./entender/entender";
import { calcularMedidas, coberturaConContar } from "./entender/medidas-plan";
import type { PlanBusqueda } from "./plan";

/**
 * El plan es el MISMO para todos los visitantes: la decisión duro/blando cuenta sobre el catálogo
 * entero (con y sin stock, sin el contexto de sucursal), así no depende de quién busca y la caché
 * no necesita esas entradas en la clave. Lo único que cambia el conjunto contado es el flag global
 * `catalogo-solo-visibles`, que sí entra en la clave (`clavePlan`). Un filtro duro que con stock o
 * en una sucursal da 0 lo resuelve el "sin resultados" de la página (alternativas + asesor).
 */
export interface OpcionesPlan {
  soloVisibles: boolean;
  /**
   * Para correr la escritura de la caché DESPUÉS de responder (el route handler pasa `after` de
   * next/server): el 307 no espera un viaje más a la base. Sin él, se espera.
   */
  diferir?: (tarea: () => Promise<void>) => void;
}

export interface PlanObtenido {
  plan: PlanBusqueda;
  msJev: number | null;
}

/**
 * Versión de las reglas que deciden el plan (la categoría dura y los términos). Entra en la clave de
 * la caché: al cambiarlas se sube, y los planes viejos (que se guardan sin vencimiento en
 * `shop.busqueda_interpretaciones`) dejan de leerse en vez de seguir sirviendo una decisión que ya
 * no se toma. v2: la categoría dura no puede dejar afuera productos que se llaman como se pidió.
 * v3: sinónimos nuevos (tira, decorativa, ajustar, luz de mesa, celu).
 * v4: contexto de humedad (baño, ducha, lavadero), lugares exteriores nuevos y duro que deja 0 → blando.
 * v5: un lugar que es también un producto ("escalera chica") pesa como producto si no hay otra palabra de producto ni de luz.
 */
export const VERSION_REGLAS_PLAN = 5;

/** Clave del plan en la caché: el árbol activo, el flag `catalogo-solo-visibles` y la versión de las reglas (≤ 64 caracteres). */
export function clavePlan(arbol: readonly NodoArbol[], soloVisibles: boolean): string {
  return createHash("sha256").update(`${hashArbol(arbol)}:${soloVisibles ? 1 : 0}:v${VERSION_REGLAS_PLAN}`).digest("hex").slice(0, 32);
}

async function arbolSeguro(): Promise<NodoArbol[]> {
  return getArbolCategorias().catch((err: unknown) => {
    console.error(`[busqueda-v2] no se pudo leer el árbol: ${err instanceof Error ? err.name : "desconocido"}`);
    return [];
  });
}

/** Cómo se obtiene el plan (ver `planParaBuscar` y `planParaPagina`). */
interface ModoObtener {
  jev: ClienteJev | null;
  sumarUso: boolean;
  guardar: boolean;
  /** Cupo para escribir en la base (la memoria no se topea). */
  puedeEscribir?: () => boolean;
}

/**
 * Las medidas de la consulta (flag `busqueda-medidas`) se suman al plan YA resuelto, en un solo lugar
 * (`obtener`): lo que se guarda en la caché (memoria y base) sigue siendo el plan sin medidas.
 * Se leen del flag en cada request; un flag que no se puede evaluar cuenta como apagado.
 */
const MEDIDAS_LRU_MAXIMO = 500;
const MEDIDAS_LRU_TTL_MS = 60 * 60_000;

/** Lo que decidió `aplicarMedidas` (no el plan): los atributos duros y blandos con las medidas ya mergeadas. */
interface DecisionMedidas {
  duros: string[];
  blandos: { id: string; peso: number }[];
}

const gm = globalThis as unknown as { busquedaV2MedidasLru?: Lru<DecisionMedidas> };
/** En `globalThis`: el hot-reload de dev no la vacía en cada guardado (como la de planes). */
let medidasLru: Lru<DecisionMedidas> = (gm.busquedaV2MedidasLru ??= new Lru<DecisionMedidas>(MEDIDAS_LRU_MAXIMO, MEDIDAS_LRU_TTL_MS));

/** Solo tests. */
export function reiniciarMemoMedidas() {
  medidasLru = gm.busquedaV2MedidasLru = new Lru<DecisionMedidas>(MEDIDAS_LRU_MAXIMO, MEDIDAS_LRU_TTL_MS);
}

/** Huella corta de lo que el plan base decidió (intención, duros y blandos): dos planes distintos no comparten memo. */
const huellaPlan = (plan: PlanBusqueda) =>
  createHash("sha1").update(JSON.stringify([plan.intencion, plan.duros, plan.blandos])).digest("hex").slice(0, 16);

async function conMedidas(
  plan: PlanBusqueda,
  consultaCruda: string,
  c: { tenant: string; hash: string; soloVisibles: boolean; estructurados: boolean },
): Promise<PlanBusqueda> {
  const clave = [c.tenant, c.hash, consultaCruda.trim().toLowerCase(), c.estructurados ? 1 : 0, huellaPlan(plan)].join("\u0000");
  const decidido = medidasLru.get(clave);
  if (decidido) return { ...plan, duros: { ...plan.duros, atributos: decidido.duros }, blandos: { ...plan.blandos, atributos: decidido.blandos } };
  try {
    // El plan es el mismo para todos: la decisión cuenta sobre el catálogo entero (con y sin stock).
    const base = { soloVisibles: c.soloVisibles, soloStock: false, estructurados: c.estructurados };
    const contar = contador(base);
    const { plan: conMedidas } = await calcularMedidas(plan, consultaCruda, {
      activo: true,
      estructurados: c.estructurados,
      contar,
      contarPositivo: contador({ ...base, positivos: true }),
      cobertura: coberturaConContar(contar),
    });
    medidasLru.set(clave, { duros: conMedidas.duros.atributos, blandos: conMedidas.blandos.atributos });
    return conMedidas;
  } catch (err) {
    // Una falla de medidas nunca rompe la búsqueda: sale el plan sin ellas (y no se memoiza, se reintenta).
    console.error(`[busqueda-medidas] no se pudieron aplicar las medidas: ${err instanceof Error ? err.name : "desconocido"}`);
    return plan;
  }
}

async function obtener(q: string, opciones: OpcionesPlan, modo: ModoObtener): Promise<PlanObtenido | null> {
  const [arbol, estructurados, medidas] = await Promise.all([
    arbolSeguro(),
    atributosEstructuradosDisponibles(),
    busquedaMedidasHabilitada().catch(() => false),
  ]);
  const obtenido = await obtenerBase(q, opciones, modo, arbol, estructurados);
  if (!obtenido || !medidas) return obtenido;
  const plan = await conMedidas(obtenido.plan, q, { tenant: shopTenantId(), hash: clavePlan(arbol, opciones.soloVisibles), soloVisibles: opciones.soloVisibles, estructurados });
  return { ...obtenido, plan };
}

async function obtenerBase(
  q: string,
  opciones: OpcionesPlan,
  modo: ModoObtener,
  arbol: NodoArbol[],
  estructurados: boolean,
): Promise<PlanObtenido | null> {
  const tenant = shopTenantId();
  const norm = normalizarConsulta(q);
  const hash = clavePlan(arbol, opciones.soloVisibles);
  const clave = norm ? claveLru(tenant, hash, norm) : null;
  if (norm && clave) {
    const enMemoria = lru.get(clave);
    if (enMemoria) return { plan: { ...enMemoria.plan, consulta: q.trim(), fuente: "cache" }, msJev: null };
    const enBase = await leerPlan(tenant, norm, hash, modo.sumarUso);
    if (enBase) {
      lru.set(clave, { plan: enBase });
      return { plan: { ...enBase, consulta: q.trim() }, msJev: null };
    }
  }
  const contar = contador({ soloVisibles: opciones.soloVisibles, soloStock: false, estructurados });
  const entendido = await entender(q, { arbol, jev: modo.jev, contar });
  if (!entendido) return null;
  if (modo.guardar && norm && clave && !entendido.jevFallo && entendido.plan.intencion !== "codigo") {
    lru.set(clave, { plan: entendido.plan, msJev: entendido.msJev });
    // Sin Jev (sin key) nada topea el armado del plan: las escrituras en la base tienen su cupo.
    if (modo.puedeEscribir && !modo.puedeEscribir()) return { plan: entendido.plan, msJev: entendido.msJev };
    const guardar = () => guardarPlan(tenant, norm, hash, entendido.plan);
    if (opciones.diferir) opciones.diferir(guardar);
    else await guardar();
  }
  return { plan: entendido.plan, msJev: entendido.msJev };
}

export async function planParaBuscar(q: string, opciones: OpcionesPlan & { ip: string }): Promise<PlanObtenido | null> {
  try {
    const conJev = !!process.env.JEV_API_KEY?.trim();
    const jev: ClienteJev | null = conJev
      ? jevConTope((consulta, preguntas, timeoutMs) => consultarJev(consulta, preguntas, { timeoutMs }), opciones.ip)
      : null;
    return await obtener(q, opciones, {
      jev,
      sumarUso: true,
      guardar: true,
      puedeEscribir: () => dentroDelTope("busqueda-v2-plan", opciones.ip),
    });
  } catch (err) {
    console.error(`[busqueda-v2] no se pudo entender la búsqueda: ${err instanceof Error ? err.name : "desconocido"}`);
    return null;
  }
}

export async function planParaPagina(q: string, opciones: OpcionesPlan): Promise<PlanBusqueda | null> {
  try {
    return (await obtener(q, opciones, { jev: null, sumarUso: false, guardar: false }))?.plan ?? null;
  } catch (err) {
    console.error(`[busqueda-v2] no se pudo leer el plan: ${err instanceof Error ? err.name : "desconocido"}`);
    return null;
  }
}
