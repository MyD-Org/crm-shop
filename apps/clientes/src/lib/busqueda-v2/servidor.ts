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
import { shopTenantId } from "../tenant";
import { createHash } from "node:crypto";
import { hashArbol } from "../busqueda-inteligente/cache";
import { consultarJev } from "../busqueda-inteligente/jev";
import { dentroDelTope, jevConTope } from "../busqueda-inteligente/limite";
import { normalizarConsulta } from "../busqueda-inteligente/normalizar";
import type { NodoArbol } from "../busqueda-inteligente/tipos";
import { claveLru, guardarPlan, leerPlan, lru } from "./cache";
import { contador } from "./conteo";
import { entender, type ClienteJev } from "./entender/entender";
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

/** Clave del plan en la caché: el árbol activo y el flag `catalogo-solo-visibles` (≤ 64 caracteres). */
export function clavePlan(arbol: readonly NodoArbol[], soloVisibles: boolean): string {
  return createHash("sha256").update(`${hashArbol(arbol)}:${soloVisibles ? 1 : 0}`).digest("hex").slice(0, 32);
}

async function arbolSeguro(): Promise<NodoArbol[]> {
  return getArbolCategorias().catch((err: unknown) => {
    console.error(`[busqueda-v2] no se pudo leer el árbol: ${err instanceof Error ? err.name : "desconocido"}`);
    return [];
  });
}

async function obtener(
  q: string,
  opciones: OpcionesPlan,
  modo: {
    jev: ClienteJev | null;
    sumarUso: boolean;
    guardar: boolean;
    /** Cupo para escribir en la base (la memoria no se topea). */
    puedeEscribir?: () => boolean;
  },
): Promise<PlanObtenido | null> {
  const tenant = shopTenantId();
  const [arbol, estructurados] = await Promise.all([arbolSeguro(), atributosEstructuradosDisponibles()]);
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
