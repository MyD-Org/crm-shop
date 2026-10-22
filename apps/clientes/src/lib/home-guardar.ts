import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { homeContent } from "@/db/schema";
import { shopTenantId } from "@/lib/tenant";

/**
 * Todas las funciones de este módulo (y `getContenidoHome`) acotan por
 * `shopTenantId()`: la tabla es de todas las tiendas que comparten la base.
 *
 * Upsert de una sección de home. Llaman las server actions de
 * `home-acciones.ts` (editor in-place de la home). `payload === null`
 * (navBadge apagado) se persiste como jsonb 'null': borrar la fila NO apaga
 * el badge, vuelve el default (que sí lo trae).
 */
export async function guardarSeccionHome(
  key: string,
  payload: unknown,
): Promise<{ updatedAt: Date }> {
  // La columna es jsonb NOT NULL: un `null` de JS iría como SQL NULL y
  // fallaría. `sql\`'null'::jsonb\`` es el jsonb "null" válido.
  const valor =
    payload === null
      ? sql`'null'::jsonb`
      : (payload as Record<string, unknown>);
  const tenantId = shopTenantId();
  const [fila] = await getDb()
    .insert(homeContent)
    .values({ tenantId, key, payload: valor as unknown as Record<string, unknown> })
    .onConflictDoUpdate({
      target: [homeContent.tenantId, homeContent.key],
      set: { payload: valor as unknown as Record<string, unknown>, updatedAt: new Date() },
    })
    .returning({ updatedAt: homeContent.updatedAt });
  return fila;
}

/** Elimina la fila de una sección (vuelve al default). */
export async function borrarSeccionHome(key: string): Promise<void> {
  await getDb()
    .delete(homeContent)
    .where(and(eq(homeContent.tenantId, shopTenantId()), eq(homeContent.key, key)));
}

/** Payload crudo de una sección, o `undefined` si no tiene fila. */
export async function leerSeccionHome(key: string): Promise<unknown> {
  const [fila] = await getDb()
    .select({ payload: homeContent.payload })
    .from(homeContent)
    .where(and(eq(homeContent.tenantId, shopTenantId()), eq(homeContent.key, key)));
  return fila?.payload;
}

/**
 * Payload crudo de varias secciones en una sola consulta (las que no tienen
 * fila no aparecen en el mapa). La usa el layout para el footer: datos
 * legales + contenido del footer sin pagar dos idas a la DB.
 */
export async function leerSeccionesHome(keys: readonly string[]): Promise<Map<string, unknown>> {
  const filas = await getDb()
    .select({ key: homeContent.key, payload: homeContent.payload })
    .from(homeContent)
    .where(and(eq(homeContent.tenantId, shopTenantId()), inArray(homeContent.key, [...keys])));
  return new Map(filas.map((f) => [f.key, f.payload]));
}

/**
 * Payload crudo de todas las filas cuya clave empieza con `prefijo` (por
 * ejemplo `pagina-marca:`). El prefijo se escapa para el `like` (`\`, `%` y
 * `_` son literales), así una clave no puede abrir la consulta a otras filas.
 */
export async function leerSeccionesHomePorPrefijo(prefijo: string): Promise<Map<string, unknown>> {
  const patron = `${prefijo.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const filas = await getDb()
    .select({ key: homeContent.key, payload: homeContent.payload })
    .from(homeContent)
    .where(and(eq(homeContent.tenantId, shopTenantId()), like(homeContent.key, patron)));
  return new Map(filas.map((f) => [f.key, f.payload]));
}
