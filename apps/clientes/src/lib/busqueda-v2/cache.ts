/**
 * Caché de planes de la búsqueda v2. SOLO servidor.
 *
 * - Base: la tabla existente `shop.busqueda_interpretaciones` (migración 0026),
 *   misma clave (tenant, consulta normalizada, hash del árbol). `resultado`
 *   guarda el `PlanBusqueda` (`version: 1`); las filas de la fase 1 (sin
 *   `version`) se ignoran al leer y se pisan al guardar.
 * - LRU en memoria del proceso (500 entradas, 1 h): respaldo y dev sin la
 *   migración. La página del catálogo suele leer de acá el plan que `/buscar`
 *   acaba de guardar.
 *
 * Todo acceso a la base va envuelto: si la tabla no existe o la base falla,
 * la búsqueda sigue sin caché (aviso UNA vez por proceso). En los errores no
 * se loguea la consulta, sólo el tipo de error.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { busquedaInterpretaciones } from "@/db/schema";
import { comoPlan, type PlanBusqueda } from "./plan";

export const LRU_MAXIMO = 500;
export const LRU_TTL_MS = 60 * 60_000;

export interface PlanGuardado {
  plan: PlanBusqueda;
  /** Milisegundos de Jev cuando se armó (sólo en memoria: para la telemetría). */
  msJev?: number | null;
}

/** LRU mínima sobre `Map` (el orden de inserción es el de uso). */
export class Lru<V> {
  private readonly datos = new Map<string, { valor: V; vence: number }>();
  constructor(
    private readonly maximo: number,
    private readonly ttlMs: number,
  ) {}

  get(clave: string, ahora = Date.now()): V | undefined {
    const e = this.datos.get(clave);
    if (!e) return undefined;
    this.datos.delete(clave);
    if (e.vence <= ahora) return undefined;
    this.datos.set(clave, e);
    return e.valor;
  }

  set(clave: string, valor: V, ahora = Date.now()): void {
    this.datos.delete(clave);
    this.datos.set(clave, { valor, vence: ahora + this.ttlMs });
    while (this.datos.size > this.maximo) {
      const vieja = this.datos.keys().next().value;
      if (vieja === undefined) break;
      this.datos.delete(vieja);
    }
  }

  get size() {
    return this.datos.size;
  }
}

const g = globalThis as unknown as { busquedaV2Lru?: Lru<PlanGuardado> };
/** En `globalThis`: el hot-reload de dev no la vacía en cada guardado. */
export const lru: Lru<PlanGuardado> = (g.busquedaV2Lru ??= new Lru<PlanGuardado>(LRU_MAXIMO, LRU_TTL_MS));

export const claveLru = (tenantId: string, arbolHash: string, consultaNorm: string) => `${tenantId}\u0000${arbolHash}\u0000${consultaNorm}`;

let avisado = false;
function registrarFallo(que: string, err: unknown) {
  if (avisado) return;
  avisado = true;
  console.warn(
    `[busqueda-v2] caché de planes no disponible en la base (${que}: ${err instanceof Error ? err.name : "desconocido"}); se sigue con la memoria. ¿Falta la migración 0026? (se avisa una vez por proceso)`,
  );
}

/**
 * Plan guardado en la base, o `null` (no está, es de la fase 1 o la base no
 * responde). `sumarUso`: una búsqueda nueva (`/buscar`) suma un uso a la fila
 * (búsquedas frecuentes); la página sólo lee.
 */
export async function leerPlan(
  tenantId: string,
  consultaNorm: string,
  arbolHash: string,
  sumarUso: boolean,
): Promise<PlanBusqueda | null> {
  try {
    const clave = and(
      eq(busquedaInterpretaciones.tenantId, tenantId),
      eq(busquedaInterpretaciones.consultaNorm, consultaNorm),
      eq(busquedaInterpretaciones.arbolHash, arbolHash),
    );
    const columnas = { resultado: busquedaInterpretaciones.resultado };
    const [fila] = sumarUso
      ? await getDb()
          .update(busquedaInterpretaciones)
          .set({ hits: sql`${busquedaInterpretaciones.hits} + 1`, lastUsedAt: sql`now()` })
          // Sólo filas v2: una de la fase 1 no cuenta como uso del plan (se pisa al guardar).
          .where(and(clave, sql`${busquedaInterpretaciones.resultado}->>'version' = '1'`))
          .returning(columnas)
      : await getDb().select(columnas).from(busquedaInterpretaciones).where(clave).limit(1);
    const plan = fila ? comoPlan(fila.resultado) : null;
    return plan ? { ...plan, fuente: "cache" } : null;
  } catch (err) {
    registrarFallo("lectura", err);
    return null;
  }
}

/** Guarda (o pisa) un plan. Silencioso si la base no responde. */
export async function guardarPlan(tenantId: string, consultaNorm: string, arbolHash: string, plan: PlanBusqueda): Promise<void> {
  const resultado = plan as unknown as Record<string, unknown>;
  const fuente = plan.fuente === "jev" ? "jev" : "deterministico";
  try {
    await getDb()
      .insert(busquedaInterpretaciones)
      .values({ tenantId, consultaNorm, arbolHash, resultado, fuente })
      .onConflictDoUpdate({
        target: [busquedaInterpretaciones.tenantId, busquedaInterpretaciones.consultaNorm, busquedaInterpretaciones.arbolHash],
        set: { resultado, fuente, lastUsedAt: sql`now()` },
      });
  } catch (err) {
    registrarFallo("escritura", err);
  }
}

/** Solo tests. */
export function reiniciarAvisoPlanes() {
  avisado = false;
}
