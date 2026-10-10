/**
 * Favoritos de Mi cuenta. SOLO servidor (usa la base).
 *
 * Toda consulta pasa por `deEsteUsuario`: tenant del entorno + usuario de
 * Clerk, al leer, escribir y borrar (el espejo de `esDeSuDueno` de pedidos).
 * Precio y stock salen del espejo del catálogo, nunca de Alegra en vivo.
 */
import { and, count, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { favorites } from "@/db/schema";
import type { Product } from "@/data/products";
import { getProductosPorIds } from "./catalog";
import { planificarLote } from "./favoritos-lote";
import type { MediosPrecio } from "./medios-precio";
import { shopTenantId } from "./tenant";

/** Tope de favoritos por usuario. Lo aplica `agregarFavorito`. */
export const MAX_FAVORITOS = 200;

/** El usuario ya tiene `MAX_FAVORITOS`: la API lo traduce a 422. */
export class FavoritosLlenosError extends Error {
  constructor() {
    super(`Se alcanzó el máximo de ${MAX_FAVORITOS} favoritos.`);
    this.name = "FavoritosLlenosError";
  }
}

function deEsteUsuario(clerkUserId: string) {
  return and(eq(favorites.tenantId, shopTenantId()), eq(favorites.clerkUserId, clerkUserId));
}

/** Ids de Alegra guardados por el usuario, del más nuevo al más viejo. */
export async function idsFavoritos(clerkUserId: string, limite = MAX_FAVORITOS): Promise<string[]> {
  const filas = await getDb()
    .select({ alegraItemId: favorites.alegraItemId })
    .from(favorites)
    .where(deEsteUsuario(clerkUserId))
    .orderBy(desc(favorites.createdAt))
    .limit(limite);
  return filas.map((f) => f.alegraItemId);
}

/** Cuántas filas tiene el usuario (incluye ítems que ya no están en el espejo). */
export async function contarFavoritos(clerkUserId: string): Promise<number> {
  const [fila] = await getDb()
    .select({ n: count() })
    .from(favorites)
    .where(deEsteUsuario(clerkUserId));
  return Number(fila?.n ?? 0);
}

/**
 * Guarda un favorito. Idempotente: si ya estaba, no pasa nada (ni siquiera en
 * el tope). Un ítem nuevo con el usuario en `MAX_FAVORITOS` lanza
 * `FavoritosLlenosError` sin escribir.
 *
 * El conteo y el insert no van en una transacción: dos altas simultáneas con
 * 199 guardados pueden dejar 201. Es un techo contra el abuso, no un invariante.
 */
export async function agregarFavorito(clerkUserId: string, alegraItemId: string): Promise<void> {
  const db = getDb();
  // Una sola lectura: cuántos hay y si éste ya es uno de ellos.
  const [estado] = await db
    .select({
      n: count(),
      yaEsta: sql<boolean>`coalesce(bool_or(${favorites.alegraItemId} = ${alegraItemId}), false)`,
    })
    .from(favorites)
    .where(deEsteUsuario(clerkUserId));

  if (estado?.yaEsta) return;
  if (Number(estado?.n ?? 0) >= MAX_FAVORITOS) throw new FavoritosLlenosError();

  await db
    .insert(favorites)
    .values({ tenantId: shopTenantId(), clerkUserId, alegraItemId })
    .onConflictDoNothing({
      target: [favorites.tenantId, favorites.clerkUserId, favorites.alegraItemId],
    });
}

/**
 * Alta masiva (la lista compartida de otra persona). Idempotente y atómica:
 * una transacción con un lock por usuario serializa lotes y altas, así que el
 * tope de `MAX_FAVORITOS` es exacto. Los que ya estaban no consumen cupo; si no
 * entran todos, se guardan los primeros en el orden recibido y el resto es
 * `sinLugar` (no es un error). Devuelve además los ids resultantes, del más
 * nuevo al más viejo, para que el navegador se resincronice sin otro GET.
 *
 * El `created_at` se escalona de a 1 ms hacia atrás para que el orden de la
 * lista compartida se conserve en "del más nuevo al más viejo".
 */
export async function agregarFavoritosLote(
  clerkUserId: string,
  ids: readonly string[],
): Promise<{ agregados: string[]; yaEstaban: number; sinLugar: number; ids: string[] }> {
  const tenantId = shopTenantId();
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`favoritos:${tenantId}:${clerkUserId}`}))`);

    const existentes = (
      await tx
        .select({ alegraItemId: favorites.alegraItemId })
        .from(favorites)
        .where(deEsteUsuario(clerkUserId))
        .orderBy(desc(favorites.createdAt))
    ).map((f) => f.alegraItemId);

    const plan = planificarLote(existentes, ids, MAX_FAVORITOS);
    if (plan.aEscribir.length > 0) {
      const ahora = Date.now();
      await tx
        .insert(favorites)
        .values(
          plan.aEscribir.map((alegraItemId, i) => ({
            tenantId,
            clerkUserId,
            alegraItemId,
            createdAt: new Date(ahora - i),
          })),
        )
        .onConflictDoNothing({
          target: [favorites.tenantId, favorites.clerkUserId, favorites.alegraItemId],
        });
    }
    return {
      agregados: plan.aEscribir,
      yaEstaban: plan.yaEstaban,
      sinLugar: plan.sinLugar,
      ids: [...plan.aEscribir, ...existentes],
    };
  });
}

/** Quita un favorito. Idempotente: si no estaba, no pasa nada. */
export async function quitarFavorito(clerkUserId: string, alegraItemId: string): Promise<void> {
  await getDb()
    .delete(favorites)
    .where(and(deEsteUsuario(clerkUserId), eq(favorites.alegraItemId, alegraItemId)));
}

/**
 * Productos favoritos del usuario, del más nuevo al más viejo, con el precio
 * de su lista (`idPriceList`). Sin filtro de visibilidad: un favorito
 * despublicado se sigue viendo. Los ids que el espejo ya no tiene se omiten,
 * así que puede devolver menos que `contarFavoritos` (no es un error).
 */
export async function listarFavoritos(
  clerkUserId: string,
  opts?: { limite?: number; idPriceList?: string; mediosPrecio?: MediosPrecio },
): Promise<Product[]> {
  const ids = await idsFavoritos(clerkUserId, opts?.limite);
  if (ids.length === 0) return [];
  const productos = await getProductosPorIds(ids, { idPriceList: opts?.idPriceList, mediosPrecio: opts?.mediosPrecio });
  return ids.flatMap((id) => {
    const p = productos.get(id);
    return p ? [p] : [];
  });
}
