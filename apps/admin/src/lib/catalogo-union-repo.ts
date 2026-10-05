import { sql } from "drizzle-orm"
import { getDb, type Db } from "@/db"
import { esVendibleSql } from "./catalogo-vendible"
import type { ListaPrincipal } from "./alegra-pareo"

// Piezas de base de datos del catálogo UNIÓN entre cuentas de Alegra (change
// `sucursales-igz-mdp`, rebanada D, design D2/D3/D14). Las comparten la sync de la principal
// (`alegra-sync.ts`) y la de cada cuenta secundaria (`alegra-sync-cuenta.ts`).
//
// Invariante que sostiene todo esto: para un mismo código hay UNA sola fila ACTIVA en
// `catalog_products` (la de la principal si está activa; si no, la solo-secundaria).

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
type Ejecutor = Db | Tx

/** El mismo criterio que `normalizarCodigo` (TS), en SQL. */
export const normCodigoSql = (col: string) => `lower(unaccent(regexp_replace(btrim(${col}), '\\s+', ' ', 'g')))`

const ACTIVA_PRINCIPAL = (alias: string) =>
  `${alias}.cuenta_id IS NULL AND ${alias}.status = 'active' AND (${alias}.alegra_status IS NULL OR ${alias}.alegra_status <> 'inactive')`

/**
 * El stock de la PRINCIPAL también queda en `catalog_stock_sucursal`, para cada sucursal cuya
 * cuenta es la principal (`item_id_cuenta` = `alegra_id`). Sale de `catalog_products.stock`, que ya
 * respeta la frescura por fila: un webhook más nuevo que la sync no se pisa. Un par forzado a mano
 * (`origen='manual'`) no se toca. Sin sucursales asignadas a la principal no hace nada.
 *
 * La sync la llama al final para todo el catálogo; el drenador de webhooks, con `alegraIds`
 * (los ítems que acaba de re-leer) y `origen: 'webhook'`, para que la sucursal no espere a la
 * próxima sync completa.
 */
export async function escribirStockPrincipal(
  tenantId: string,
  ej: Ejecutor = getDb(),
  opts: { alegraIds?: string[]; origen?: "sync" | "webhook" } = {},
): Promise<void> {
  const origen = opts.origen ?? "sync"
  if (opts.alegraIds && opts.alegraIds.length === 0) return
  const filtro = opts.alegraIds
    ? sql`AND p.alegra_id IN (${sql.join(opts.alegraIds.map((id) => sql`${id}`), sql`, `)})`
    : sql``
  await ej.execute(sql`
    INSERT INTO catalog_stock_sucursal AS css (tenant_id, sucursal, alegra_id, item_id_cuenta, stock, origen, leido_at, synced_at)
    SELECT p.tenant_id, s.slug, p.alegra_id, p.alegra_id, coalesce(p.stock, 0), ${origen}, p.alegra_leido_at, now()
    FROM catalog_products p
    JOIN alegra_cuentas c ON c.tenant_id = p.tenant_id AND c.principal
    JOIN sucursales s ON s.tenant_id = p.tenant_id AND s.cuenta_alegra_id = c.id
    WHERE p.tenant_id = ${tenantId} AND p.cuenta_id IS NULL ${filtro}
    ON CONFLICT (tenant_id, sucursal, alegra_id) DO UPDATE SET
      item_id_cuenta = excluded.item_id_cuenta,
      stock = excluded.stock,
      origen = excluded.origen,
      leido_at = excluded.leido_at,
      synced_at = excluded.synced_at
    WHERE css.origen <> 'manual'
      AND coalesce(css.leido_at, '-infinity'::timestamptz) <= coalesce(excluded.leido_at, '-infinity'::timestamptz)
  `)
}

/**
 * Copia el overlay de `desde` a `hacia` SOLO si `hacia` no tiene uno (con sus etiquetas). Nunca
 * pisa un overlay existente. `updated_at = now()` para que el delta hacia el Shop lo mande.
 * Devuelve si copió. (Cuando exista `oculto_en_sucursales`, rebanada B, debe sumarse a la lista.)
 */
export async function copiarOverlaySiFalta(tx: Ejecutor, tenantId: string, desde: string, hacia: string): Promise<boolean> {
  const nuevas = await tx.execute(sql`
    INSERT INTO catalog_overlay (tenant_id, alegra_id, visible, nombre, descripcion, categoria_id, orden, fotos, ficha_tecnica, mostrar_marca, updated_by, updated_at)
    SELECT o.tenant_id, ${hacia}, o.visible, o.nombre, o.descripcion, o.categoria_id, o.orden, o.fotos, o.ficha_tecnica, o.mostrar_marca, 'sistema:catalogo-union', now()
    FROM catalog_overlay o
    WHERE o.tenant_id = ${tenantId} AND o.alegra_id = ${desde}
    ON CONFLICT (tenant_id, alegra_id) DO NOTHING
    RETURNING id
  `)
  const nuevoId = (nuevas as unknown as { id: string }[])[0]?.id
  if (!nuevoId) return false
  await tx.execute(sql`
    INSERT INTO catalog_overlay_tags (overlay_id, tag_id)
    SELECT ${nuevoId}::uuid, t.tag_id
    FROM catalog_overlay_tags t
    JOIN catalog_overlay o ON o.id = t.overlay_id
    WHERE o.tenant_id = ${tenantId} AND o.alegra_id = ${desde}
    ON CONFLICT DO NOTHING
  `)
  return true
}

/**
 * Mueve las filas de stock por sucursal de `desde` a `hacia` (otro `alegra_id`). Si `hacia` ya
 * tiene fila en esa sucursal gana la más fresca (`leido_at`). Se borra y reinserta (no UPDATE de la
 * clave) para no chocar con el único parcial `(tenant, sucursal, item_id_cuenta)`.
 */
export async function moverStockSucursal(tx: Ejecutor, tenantId: string, desde: string, hacia: string): Promise<number> {
  const movidas = (await tx.execute(sql`
    DELETE FROM catalog_stock_sucursal
    WHERE tenant_id = ${tenantId} AND alegra_id = ${desde}
    RETURNING sucursal, item_id_cuenta, stock, origen, leido_at, synced_at
  `)) as unknown as {
    sucursal: string
    item_id_cuenta: string | null
    stock: string
    origen: string
    leido_at: string | null
    synced_at: string
  }[]
  for (const m of movidas) {
    await tx.execute(sql`
      INSERT INTO catalog_stock_sucursal AS css (tenant_id, sucursal, alegra_id, item_id_cuenta, stock, origen, leido_at, synced_at)
      VALUES (${tenantId}, ${m.sucursal}, ${hacia}, ${m.item_id_cuenta}, ${m.stock}, ${m.origen}, ${m.leido_at}, ${m.synced_at})
      ON CONFLICT (tenant_id, sucursal, alegra_id) DO UPDATE SET
        item_id_cuenta = excluded.item_id_cuenta,
        stock = excluded.stock,
        origen = excluded.origen,
        leido_at = excluded.leido_at,
        synced_at = excluded.synced_at
      WHERE coalesce(css.leido_at, '-infinity'::timestamptz) <= coalesce(excluded.leido_at, '-infinity'::timestamptz)
    `)
  }
  return movidas.length
}

export interface ResultadoAbsorcion {
  absorbidos: number
}

/**
 * Absorción (design D14). Para cada fila solo-secundaria (activa, o "adoptada" por la secundaria
 * con la principal inactiva, o ya inactiva por stock 0) cuyo código —único— ahora existe en una
 * fila PRINCIPAL ACTIVA: manda la principal. Por producto y en una transacción:
 *  (a) el stock por sucursal pasa a la clave de la principal (gana el más fresco),
 *  (b) el overlay pasa a la principal SOLO si esta no tiene uno,
 *  (c) la vieja queda `inactive` con `reemplazado_por_alegra_id` (no se borra: los pedidos
 *      históricos apuntan a su id sintético).
 * Cubre también la REACTIVACIÓN (O8): la principal inactiva que vuelve a `active` recupera el
 * mando. Idempotente; no absorbe si el código está duplicado entre las principales activas.
 * Corre al final de la sync de la principal y al empezar la de cada secundaria.
 */
export async function absorberSoloSecundaria(tenantId: string): Promise<ResultadoAbsorcion> {
  const db = getDb()
  const candidatas = (await db.execute(sql`
    SELECT s.alegra_id AS sintetica, min(p.alegra_id) AS principal
    FROM catalog_products s
    JOIN catalog_products p
      ON p.tenant_id = s.tenant_id
     AND ${sql.raw(ACTIVA_PRINCIPAL("p"))}
     AND ${sql.raw(normCodigoSql("p.code"))} = ${sql.raw(normCodigoSql("s.code"))}
    WHERE s.tenant_id = ${tenantId}
      AND s.cuenta_id IS NOT NULL
      AND s.reemplazado_por_alegra_id IS NULL
      AND btrim(coalesce(s.code, '')) <> ''
    GROUP BY s.alegra_id
    HAVING count(*) = 1
  `)) as unknown as { sintetica: string; principal: string }[]

  for (const c of candidatas) {
    await db.transaction(async (tx) => {
      await moverStockSucursal(tx, tenantId, c.sintetica, c.principal)
      await copiarOverlaySiFalta(tx, tenantId, c.sintetica, c.principal)
      await tx.execute(sql`
        UPDATE catalog_products
        SET status = 'inactive', reemplazado_por_alegra_id = ${c.principal}
        WHERE tenant_id = ${tenantId} AND alegra_id = ${c.sintetica}
      `)
      // La vieja deja de publicarse: el overlay se mueve para que el Shop se entere.
      await tx.execute(sql`
        UPDATE catalog_overlay SET updated_at = now() WHERE tenant_id = ${tenantId} AND alegra_id = ${c.sintetica}
      `)
    })
  }
  return { absorbidos: candidatas.length }
}

/**
 * Los productos de una cuenta secundaria que dejaron de ser vendibles corren `updated_at` de su
 * overlay: el delta hacia el Shop se mueve por esa marca y, sin esto, uno que quedó `inactive`
 * seguiría publicado en la tienda. Misma idea que el empuje de la sync de la principal.
 */
export async function empujarNoVendiblesDeCuenta(tenantId: string, cuentaId: string): Promise<void> {
  await getDb().execute(sql`
    UPDATE catalog_overlay o
    SET updated_at = now()
    FROM catalog_products p
    WHERE o.tenant_id = ${tenantId}
      AND p.tenant_id = o.tenant_id
      AND p.alegra_id = o.alegra_id
      AND p.cuenta_id = ${cuentaId}::uuid
      AND o.visible = true
      AND NOT ${esVendibleSql("p")}
  `)
}

/** Listas de precio de la principal, tomadas de sus propios productos (id + nombre), sin otra llamada a Alegra. */
export async function listasDeLaPrincipal(tenantId: string): Promise<ListaPrincipal[]> {
  const filas = (await getDb().execute(sql`
    SELECT DISTINCT e->>'idPriceList' AS id, e->>'name' AS name
    FROM catalog_products p, jsonb_array_elements(p.prices) e
    WHERE p.tenant_id = ${tenantId}
      AND p.cuenta_id IS NULL
      AND jsonb_typeof(p.prices) = 'array'
      AND coalesce(e->>'idPriceList', '') <> ''
      AND coalesce(e->>'name', '') <> ''
    ORDER BY 1
  `)) as unknown as { id: string; name: string }[]
  return filas.map((f) => ({ idPriceList: f.id, name: f.name }))
}
