/** Persistencia del espejo del catálogo comercial. Drizzle detrás de `RepoCatalogo`. */
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { catalogOverlay, catalogoSyncState, shopCategories, shopTags } from "@/db/schema";
import type { ContratoOverlay, ContratoTaxonomia } from "./catalogo-contrato";
import type { Cursor, RepoCatalogo } from "./catalogo-sync-overlay";
import { shopTenantId } from "./tenant";

export function repoCatalogoDrizzle(): RepoCatalogo {
  const db = getDb();

  return {
    // El tenant se resuelve al entrar a cada método y no a nivel de módulo:
    // evaluarlo al importar rompería el build y cualquier test que toque este
    // archivo de rebote. Va ANTES de la primera escritura para que, sin
    // `SHOP_TENANT_ID`, no se borre ni se inserte nada. No hay valor por defecto:
    // un tenant inventado dejaría el cursor en una fila que nadie vuelve a leer.
    async reemplazarTaxonomia(t: ContratoTaxonomia, ahora: Date) {
      const tenant = shopTenantId();
      await db.transaction(async (tx) => {
        // DELETE + INSERT y no upsert: el contrato es un REEMPLAZO. Con upsert, una categoría
        // borrada en el CRM sobreviviría acá para siempre, porque no viene en el payload.
        await tx.delete(shopCategories);
        await tx.delete(shopTags);

        if (t.categorias.length > 0) {
          await tx.insert(shopCategories).values(
            t.categorias.map((c) => ({
              id: c.id,
              parentId: c.parentId,
              nombre: c.nombre,
              slug: c.slug,
              orden: c.orden,
              nivel: c.nivel,
              activa: c.activa,
              imagen: c.imagen,
            })),
          );
        }
        if (t.tags.length > 0) {
          await tx.insert(shopTags).values(t.tags.map((x) => ({ id: x.id, nombre: x.nombre, slug: x.slug })));
        }

        await tx
          .insert(catalogoSyncState)
          .values({ tenant, taxonomiaFetchedAt: ahora })
          .onConflictDoUpdate({ target: catalogoSyncState.tenant, set: { taxonomiaFetchedAt: ahora, lastError: null } });
      });
    },

    async aplicarPaginaOverlay(items: ContratoOverlay["items"], cursor: Cursor | null, ahora: Date) {
      const tenant = shopTenantId();
      await db.transaction(async (tx) => {
        if (items.length > 0) {
          await tx
            .insert(catalogOverlay)
            .values(
              items.map((i) => ({
                alegraId: i.alegraId,
                visible: i.visible,
                nombre: i.nombre,
                descripcion: i.descripcion,
                categoriaId: i.categoriaId,
                orden: i.orden,
                tagIds: i.tagIds,
                fotos: i.fotos,
                updatedAt: new Date(i.updatedAt),
              })),
            )
            .onConflictDoUpdate({
              target: catalogOverlay.alegraId,
              set: {
                visible: sql`excluded.visible`,
                nombre: sql`excluded.nombre`,
                descripcion: sql`excluded.descripcion`,
                categoriaId: sql`excluded.categoria_id`,
                orden: sql`excluded.orden`,
                tagIds: sql`excluded.tag_ids`,
                fotos: sql`excluded.fotos`,
                updatedAt: sql`excluded.updated_at`,
              },
            });
        }

        // El cursor va en la MISMA transacción que los items: separados, un corte en el medio
        // podría dejar el cursor adelantado y saltear una página para siempre.
        await tx
          .insert(catalogoSyncState)
          .values({
            tenant,
            cursorUpdatedAt: cursor?.desde ?? null,
            cursorAlegraId: cursor?.cursor ?? null,
            overlayFetchedAt: ahora,
          })
          .onConflictDoUpdate({
            target: catalogoSyncState.tenant,
            set: {
              cursorUpdatedAt: cursor?.desde ?? null,
              cursorAlegraId: cursor?.cursor ?? null,
              overlayFetchedAt: ahora,
              lastError: null,
            },
          });
      });
    },

    async leerCursor() {
      const [fila] = await db.select().from(catalogoSyncState);
      if (!fila?.cursorUpdatedAt || !fila.cursorAlegraId) return null;
      return { desde: fila.cursorUpdatedAt, cursor: fila.cursorAlegraId };
    },

    async registrarError(error: string, ahora: Date) {
      const tenant = shopTenantId();
      await db
        .insert(catalogoSyncState)
        .values({ tenant, lastError: error.slice(0, 500), lastAttemptAt: ahora })
        .onConflictDoUpdate({
          target: catalogoSyncState.tenant,
          set: { lastError: error.slice(0, 500), lastAttemptAt: ahora },
        });
    },

    async registrarIntento(ahora: Date) {
      const tenant = shopTenantId();
      await db
        .insert(catalogoSyncState)
        .values({ tenant, lastAttemptAt: ahora })
        .onConflictDoUpdate({ target: catalogoSyncState.tenant, set: { lastAttemptAt: ahora } });
    },
  };
}

/** Los GET al CRM. Separados del repo para poder inyectarlos en los tests. */
export function fetchersCRM() {
  const base = process.env.CRM_INTERNAL_URL?.replace(/\/+$/, "");
  const secret = process.env.SHOP_CRM_SECRET;
  const tenant = process.env.SHOP_TENANT_ID;

  async function pedir(path: string, params: Record<string, string>): Promise<unknown> {
    if (!base || !secret || !tenant) throw new Error("falta CRM_INTERNAL_URL, SHOP_CRM_SECRET o SHOP_TENANT_ID");
    const url = new URL(`${base}${path}`);
    url.searchParams.set("tenant", tenant);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await fetch(url.toString(), {
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`el CRM respondió ${res.status}`);

    // Se exige JSON explícitamente: un intermediario que conteste 200 con HTML —el gate de
    // "Próximamente", sin ir más lejos— se haría pasar por una respuesta válida.
    const tipo = res.headers.get("content-type") ?? "";
    if (!tipo.includes("application/json")) throw new Error(`el CRM respondió ${tipo || "sin content-type"}`);
    return res.json();
  }

  return {
    obtenerTaxonomia: () => pedir("/api/internal/shop/taxonomia", {}),
    obtenerOverlay: (cursor: Cursor | null) =>
      pedir("/api/internal/shop/catalogo-overlay", cursor ? { desde: cursor.desde, cursor: cursor.cursor } : {}),
  };
}
