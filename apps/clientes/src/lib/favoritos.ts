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
  opts?: { limite?: number; idPriceList?: string },
): Promise<Product[]> {
  const ids = await idsFavoritos(clerkUserId, opts?.limite);
  if (ids.length === 0) return [];
  const productos = await getProductosPorIds(ids, { idPriceList: opts?.idPriceList });
  return ids.flatMap((id) => {
    const p = productos.get(id);
    return p ? [p] : [];
  });
}
