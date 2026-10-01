import { and, eq, isNotNull, sql } from "drizzle-orm"
import { getDb, type Db } from "@/db"
import { catalogOverlay, type FichaTecnicaOverlay } from "@/db/schema"

// Acceso a datos de las fichas técnicas con archivo POR CONTENIDO (ver `fichaContenidoKey`).
//
// Varios productos pueden apuntar al MISMO objeto de R2. Por eso borrar el objeto de un producto
// exige antes mirar si otro lo sigue usando: `borrarFichaSiHuerfana`. Toda escritura del overlay
// setea `updated_at = now()` de Postgres (regla de catalogo-overlay-repo: sin eso el cambio no
// viaja al Shop).

type Ejecutor = Db

/** Cuántos productos del tenant usan la key, como ficha o como respaldo (`origen`). */
export async function contarReferenciasFicha(
  tenantId: string,
  key: string,
  ejecutor: Ejecutor = getDb(),
): Promise<number> {
  const [fila] = await ejecutor
    .select({ n: sql<number>`count(*)::int` })
    .from(catalogOverlay)
    .where(
      and(
        eq(catalogOverlay.tenantId, tenantId),
        sql`(${catalogOverlay.fichaTecnica}->>'key' = ${key} OR ${catalogOverlay.fichaTecnica}->'origen'->>'key' = ${key})`,
      ),
    )
  return fila?.n ?? 0
}

/** Lo mínimo de R2 que hace falta para borrar. */
export interface R2Borrable {
  delete(key: string): Promise<void>
}

/**
 * Borra el objeto de R2 SOLO si ningún producto del tenant lo referencia. Llamar DESPUÉS de haber
 * guardado el overlay (así el producto que se acaba de soltar ya no cuenta). Un fallo del borrado
 * no se propaga: un huérfano en el bucket es inofensivo, un error al usuario no.
 */
export async function borrarFichaSiHuerfana(
  tenantId: string,
  key: string | null | undefined,
  r2: R2Borrable | null,
  ejecutor: Ejecutor = getDb(),
): Promise<boolean> {
  if (!key || !r2) return false
  if ((await contarReferenciasFicha(tenantId, key, ejecutor)) > 0) return false
  try {
    await r2.delete(key)
    return true
  } catch {
    return false
  }
}

/**
 * Cambia la ficha de un producto SOLO si la key vigente sigue siendo `keyVigente` (compare-and-swap):
 * si alguien la tocó mientras tanto, no pisa nada. true = se cambió.
 */
export async function cambiarFichaSiVigente(
  tenantId: string,
  alegraId: string,
  keyVigente: string,
  nueva: FichaTecnicaOverlay,
  updatedBy: string,
  ejecutor: Ejecutor = getDb(),
): Promise<boolean> {
  const filas = await ejecutor
    .update(catalogOverlay)
    .set({ fichaTecnica: nueva, updatedBy, updatedAt: sql`now()` })
    .where(
      and(
        eq(catalogOverlay.tenantId, tenantId),
        eq(catalogOverlay.alegraId, alegraId),
        sql`${catalogOverlay.fichaTecnica}->>'key' = ${keyVigente}`,
      ),
    )
    .returning({ id: catalogOverlay.id })
  return filas.length > 0
}

export async function leerFichaDeProducto(
  tenantId: string,
  alegraId: string,
  ejecutor: Ejecutor = getDb(),
): Promise<FichaTecnicaOverlay | null> {
  const [fila] = await ejecutor
    .select({ ficha: catalogOverlay.fichaTecnica })
    .from(catalogOverlay)
    .where(and(eq(catalogOverlay.tenantId, tenantId), eq(catalogOverlay.alegraId, alegraId)))
  return fila?.ficha ?? null
}

/** Todas las fichas del tenant (para `huerfanos`). */
export async function listarFichas(
  tenantId: string,
  ejecutor: Ejecutor = getDb(),
): Promise<{ alegraId: string; ficha: FichaTecnicaOverlay }[]> {
  const filas = await ejecutor
    .select({ alegraId: catalogOverlay.alegraId, ficha: catalogOverlay.fichaTecnica })
    .from(catalogOverlay)
    .where(and(eq(catalogOverlay.tenantId, tenantId), isNotNull(catalogOverlay.fichaTecnica)))
  return filas.flatMap((f) => (f.ficha ? [{ alegraId: f.alegraId, ficha: f.ficha }] : []))
}
