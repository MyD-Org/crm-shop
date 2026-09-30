/**
 * Caché de interpretaciones (`shop.busqueda_interpretaciones`, migración
 * 0025) y búsquedas frecuentes. SOLO servidor.
 *
 * Todo acceso va envuelto: si la tabla no existe (el código se desplegó antes
 * que la migración) o la base falla, la interpretación sigue sin caché y las
 * búsquedas frecuentes salen vacías. Nunca rompe la búsqueda. En los errores
 * no se loguea la consulta, sólo el tipo de error.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { busquedaInterpretaciones } from "@/db/schema";
import type { FiltrosInterpretados, Interpretacion, NodoArbol } from "./tipos";

/** Lo que se guarda: la interpretación sin la consulta original ni la fuente. */
export type ResultadoGuardado = Pick<Interpretacion, "aplicar" | "sugerir">;

export interface Guardado {
  resultado: ResultadoGuardado;
  fuente: Exclude<Interpretacion["fuente"], "cache">;
}

/**
 * Hash del árbol de categorías activo: ids y nombres, ordenados. Si el tenant
 * renombra, agrega o desactiva una categoría, cambia el hash y las
 * interpretaciones viejas dejan de coincidir solas (sin invalidar nada).
 */
export function hashArbol(arbol: readonly NodoArbol[]): string {
  const partes = arbol.map((n) => `${n.id}:${n.parentId ?? ""}:${n.nombre}`).sort();
  return createHash("sha256").update(partes.join("\n")).digest("hex").slice(0, 32);
}

const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const filtros = (v: unknown): FiltrosInterpretados => {
  const o = (v ?? {}) as Record<string, unknown>;
  return { categorias: lista(o.categorias), atributos: lista(o.atributos) };
};

/** Resultado guardado → forma segura (una fila vieja o rota no rompe nada). */
export function comoResultado(v: unknown): ResultadoGuardado {
  const o = (v ?? {}) as Record<string, unknown>;
  const aplicar = (o.aplicar ?? {}) as Record<string, unknown>;
  return {
    aplicar: { ...filtros(aplicar), ...(typeof aplicar.q === "string" && aplicar.q ? { q: aplicar.q } : {}) },
    sugerir: filtros(o.sugerir),
  };
}

/**
 * Mientras la migración 0025 no esté aplicada, CADA búsqueda falla contra la
 * caché: un `console.error` por búsqueda llenaba los logs (y el overlay de
 * errores de Next en dev). Se avisa UNA vez por proceso, como advertencia: la
 * búsqueda sigue igual sin caché.
 */
let avisado = false;

const registrarFallo = (que: string) => (err: unknown) => {
  if (!avisado) {
    avisado = true;
    console.warn(
      `[busqueda-ia] caché de interpretaciones no disponible (${que}: ${err instanceof Error ? err.name : "desconocido"}); se sigue sin caché. ¿Falta la migración 0025? (se avisa una vez por proceso)`,
    );
  }
  return null;
};

/** Solo tests: vuelve a avisar el próximo fallo. */
export function reiniciarAvisoCache() {
  avisado = false;
}

/**
 * Busca una interpretación y, si está y `sumarUso`, le suma un uso (una sola
 * consulta: `update … returning`). Sin `sumarUso` sólo lee: lo usa la página
 * ya interpretada (`?ia=`), que no es una búsqueda nueva. `null` si no está o
 * si la caché no responde.
 */
export async function leerInterpretacion(
  tenantId: string,
  consultaNorm: string,
  arbolHash: string,
  sumarUso = true,
): Promise<Guardado | null> {
  try {
    const clave = and(
      eq(busquedaInterpretaciones.tenantId, tenantId),
      eq(busquedaInterpretaciones.consultaNorm, consultaNorm),
      eq(busquedaInterpretaciones.arbolHash, arbolHash),
    );
    const columnas = { resultado: busquedaInterpretaciones.resultado, fuente: busquedaInterpretaciones.fuente };
    const [fila] = sumarUso
      ? await getDb()
          .update(busquedaInterpretaciones)
          .set({ hits: sql`${busquedaInterpretaciones.hits} + 1`, lastUsedAt: sql`now()` })
          .where(clave)
          .returning(columnas)
      : await getDb().select(columnas).from(busquedaInterpretaciones).where(clave).limit(1);
    if (!fila) return null;
    return {
      resultado: comoResultado(fila.resultado),
      fuente: fila.fuente === "jev" ? "jev" : "deterministico",
    };
  } catch (err) {
    return registrarFallo("lectura")(err);
  }
}

/** Guarda (o pisa) una interpretación. Silencioso si la caché no responde. */
export async function guardarInterpretacion(
  tenantId: string,
  consultaNorm: string,
  arbolHash: string,
  guardado: Guardado,
): Promise<void> {
  try {
    await getDb()
      .insert(busquedaInterpretaciones)
      .values({
        tenantId,
        consultaNorm,
        arbolHash,
        resultado: guardado.resultado as unknown as Record<string, unknown>,
        fuente: guardado.fuente,
      })
      .onConflictDoUpdate({
        target: [busquedaInterpretaciones.tenantId, busquedaInterpretaciones.consultaNorm, busquedaInterpretaciones.arbolHash],
        set: {
          resultado: guardado.resultado as unknown as Record<string, unknown>,
          fuente: guardado.fuente,
          lastUsedAt: sql`now()`,
        },
      });
  } catch (err) {
    registrarFallo("escritura")(err);
  }
}

/** Días hacia atrás que cuentan para las búsquedas frecuentes. */
export const DIAS_FRECUENTES = 30;
/**
 * Usos mínimos para mostrar una búsqueda a todo el mundo: una consulta que
 * escribió una sola persona una vez no se exhibe.
 */
export const MIN_USOS_FRECUENTE = 3;

/** Resultado no vacío: algo para aplicar o sugerir. */
const conResultadoSql = sql`(
  jsonb_array_length(coalesce(${busquedaInterpretaciones.resultado}->'aplicar'->'categorias', '[]'::jsonb))
  + jsonb_array_length(coalesce(${busquedaInterpretaciones.resultado}->'aplicar'->'atributos', '[]'::jsonb))
  + jsonb_array_length(coalesce(${busquedaInterpretaciones.resultado}->'sugerir'->'categorias', '[]'::jsonb))
  + jsonb_array_length(coalesce(${busquedaInterpretaciones.resultado}->'sugerir'->'atributos', '[]'::jsonb))
) > 0`;

/**
 * Consultas con más usos en los últimos 30 días y resultado no vacío (con al
 * menos `MIN_USOS_FRECUENTE` usos). Vacío si la caché no responde.
 */
export async function busquedasFrecuentes(tenantId: string, limite = 6): Promise<string[]> {
  try {
    const usos = sql<number>`sum(${busquedaInterpretaciones.hits})::int`;
    const filas = await getDb()
      .select({ consulta: busquedaInterpretaciones.consultaNorm, usos })
      .from(busquedaInterpretaciones)
      .where(
        and(
          eq(busquedaInterpretaciones.tenantId, tenantId),
          gt(busquedaInterpretaciones.lastUsedAt, sql`now() - make_interval(days => ${DIAS_FRECUENTES})`),
          conResultadoSql,
        ),
      )
      .groupBy(busquedaInterpretaciones.consultaNorm)
      .having(sql`${usos} >= ${MIN_USOS_FRECUENTE}`)
      .orderBy(desc(usos), busquedaInterpretaciones.consultaNorm)
      .limit(limite);
    return filas.map((f) => f.consulta);
  } catch (err) {
    registrarFallo("frecuentes")(err);
    return [];
  }
}
