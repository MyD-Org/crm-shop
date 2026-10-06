/**
 * Hash del árbol de categorías y búsquedas frecuentes sobre las interpretaciones
 * guardadas (`shop.busqueda_interpretaciones`, migración 0026). SOLO servidor.
 *
 * Todo acceso va envuelto: si la tabla no existe (el código se desplegó antes
 * que la migración) o la base falla, las búsquedas frecuentes salen vacías.
 * Nunca rompe la búsqueda. En los errores no se loguea la consulta, sólo el
 * tipo de error.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, gt, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { busquedaInterpretaciones } from "@/db/schema";
import type { NodoArbol } from "./tipos";

/**
 * Hash del árbol de categorías activo: ids y nombres, ordenados. Si el tenant
 * renombra, agrega o desactiva una categoría, cambia el hash y las
 * interpretaciones viejas dejan de coincidir solas (sin invalidar nada).
 */
export function hashArbol(arbol: readonly NodoArbol[]): string {
  const partes = arbol.map((n) => `${n.id}:${n.parentId ?? ""}:${n.nombre}`).sort();
  return createHash("sha256").update(partes.join("\n")).digest("hex").slice(0, 32);
}

/**
 * Mientras la migración 0026 no esté aplicada, CADA lectura falla contra la
 * tabla: un `console.error` por búsqueda llenaba los logs (y el overlay de
 * errores de Next en dev). Se avisa UNA vez por proceso, como advertencia: la
 * búsqueda sigue igual sin caché.
 */
let avisado = false;

const registrarFallo = (que: string) => (err: unknown) => {
  if (!avisado) {
    avisado = true;
    console.warn(
      `[busqueda-ia] caché de interpretaciones no disponible (${que}: ${err instanceof Error ? err.name : "desconocido"}); se sigue sin caché. ¿Falta la migración 0026? (se avisa una vez por proceso)`,
    );
  }
  return null;
};

/** Días hacia atrás que cuentan para las búsquedas frecuentes. */
export const DIAS_FRECUENTES = 30;
/**
 * Usos mínimos para mostrar una búsqueda a todo el mundo: una consulta que
 * escribió una sola persona una vez no se exhibe.
 */
export const MIN_USOS_FRECUENTE = 3;

/**
 * Resultado no vacío: algo para aplicar o sugerir (fila de la fase 1) o, en un plan de la
 * búsqueda v2 (`version: 1`), algún filtro duro o alguna categoría o atributo blando.
 */
const largo = (ruta: SQL) => sql`jsonb_array_length(coalesce(${ruta}, '[]'::jsonb))`;
const r = busquedaInterpretaciones.resultado;
const conResultadoSql = sql`(case when ${r}->>'version' = '1' then (
  ${largo(sql`${r}->'duros'->'categorias'`)} + ${largo(sql`${r}->'duros'->'atributos'`)}
  + ${largo(sql`${r}->'blandos'->'categorias'`)} + ${largo(sql`${r}->'blandos'->'atributos'`)}
) else (
  ${largo(sql`${r}->'aplicar'->'categorias'`)} + ${largo(sql`${r}->'aplicar'->'atributos'`)}
  + ${largo(sql`${r}->'sugerir'->'categorias'`)} + ${largo(sql`${r}->'sugerir'->'atributos'`)}
) end) > 0`;

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
