import { sql, type SQL } from "drizzle-orm"
import { getDb, type Db } from "@/db"

// Grupos de variantes (change `variantes-de-producto`, rebanada S2, design D3).
//
// `grupo_id`, `etiqueta` y `es_representante` de `catalog_products` son DERIVADAS: Alegra sólo manda
// tipo / padre / opción, y esta función las calcula. Es la ÚNICA que las escribe (el upsert del
// espejo no las toca) y es idempotente: dos corridas seguidas sin cambios en Alegra no modifican
// ninguna fila (todo UPDATE lleva `IS DISTINCT FROM`).
//
//  - Grupo: una variante pertenece al grupo de su padre (`grupo_id = padre_alegra_id`) SOLO si la
//    fila del padre existe en el espejo del tenant. Sin ancla, la variante queda huérfana
//    (`grupo_id` NULL) y se vende suelta.
//  - Etiqueta: las opciones de la variante unidas con " / ".
//  - Representante: UNO por grupo, el que da la cara del modelo en el listado. Orden: vendible
//    (activa, no dada de baja en Alegra, con precio online > 0) > con stock (null cuenta como
//    "sin dato", no como agotado) > menor precio online > alegra_id (estable). Si todas están sin
//    stock gana la más barata vendible (el modelo se muestra "sin stock", no desaparece). Padres:
//    false. Simples y huérfanas: true (representantes de sí mismos).
//
// El stock del criterio es `catalog_products.stock` (global), no el de cada sucursal: la ficha
// muestra el stock por variante real. Un cambio de precio online puede dejar el representante
// desfasado hasta la próxima corrida: aceptado.

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
export type Ejecutor = Db | Tx

export interface AlcanceGrupos {
  /** Ítems recién escritos: se recalculan sus grupos (y los de sus hermanos). */
  alegraIds?: string[]
  /** Grupos puntuales (id del ancla). */
  grupoIds?: string[]
}

export interface ResultadoGrupos {
  /** Grupos (modelos con al menos una variante agrupada) dentro del alcance. */
  grupos: number
  /** Filas cuyo grupo_id / etiqueta / es_representante cambió. */
  cambiados: number
}

const lista = (ids: string[]): SQL => sql`ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::text[]`

/** Precio online más alto del ítem (la vista del Shop emite `precios_online`, no los de Alegra). */
const precioOnlineMax = (alias: string): string => `(
    SELECT max((e->>'price')::numeric)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${alias}.precios_online) = 'array' THEN ${alias}.precios_online ELSE '[]'::jsonb END) e
  )`

const VENDIBLE = (alias: string): string =>
  `(${alias}.status = 'active' AND ${alias}.tipo <> 'padre' AND coalesce(${alias}.alegra_status, 'active') <> 'inactive' AND coalesce(${precioOnlineMax(alias)}, 0) > 0)`

/**
 * Recalcula grupo, etiqueta y representante. Sin `alcance` recorre TODO el tenant (cierre de sync,
 * script `variantes-recalcular`); con `alegraIds` / `grupoIds` sólo los grupos tocados.
 */
export async function recalcularGrupos(
  tenantId: string,
  alcance: AlcanceGrupos = {},
  ej: Ejecutor = getDb(),
): Promise<ResultadoGrupos> {
  const acotado = alcance.alegraIds !== undefined || alcance.grupoIds !== undefined
  const alegraIds = alcance.alegraIds ?? []
  const grupoIds = alcance.grupoIds ?? []
  if (acotado && alegraIds.length === 0 && grupoIds.length === 0) return { grupos: 0, cambiados: 0 }

  // Grupos tocados: los pedidos, el de cada ítem escrito (el guardado y el que le corresponde por
  // su padre) y, si el ítem es un padre, el suyo propio (su fila acaba de aparecer como ancla).
  let alcanceSql: SQL = sql`TRUE`
  if (acotado) {
    const tocados = (await ej.execute(sql`
      SELECT g FROM (
        SELECT unnest(${lista(grupoIds)}) AS g
        UNION SELECT coalesce(grupo_id, padre_alegra_id) FROM catalog_products
          WHERE tenant_id = ${tenantId} AND alegra_id = ANY(${lista(alegraIds)})
        UNION SELECT padre_alegra_id FROM catalog_products
          WHERE tenant_id = ${tenantId} AND alegra_id = ANY(${lista(alegraIds)})
        UNION SELECT alegra_id FROM catalog_products
          WHERE tenant_id = ${tenantId} AND alegra_id = ANY(${lista(alegraIds)}) AND tipo = 'padre'
      ) x WHERE g IS NOT NULL
    `)) as unknown as { g: string }[]
    const gs = tocados.map((t) => t.g)
    alcanceSql = sql`(c.alegra_id = ANY(${lista(alegraIds)}) OR c.grupo_id = ANY(${lista(gs)}) OR c.padre_alegra_id = ANY(${lista(gs)}))`
  }

  // 1) Grupo y etiqueta.
  const g = (await ej.execute(sql`
    UPDATE catalog_products p
    SET grupo_id = n.grupo, etiqueta = n.etiqueta
    FROM (
      SELECT c.id,
             CASE
               WHEN c.tipo = 'variante' AND EXISTS (
                 SELECT 1 FROM catalog_products pa
                 WHERE pa.tenant_id = c.tenant_id AND pa.alegra_id = c.padre_alegra_id AND pa.tipo = 'padre'
               ) THEN c.padre_alegra_id
             END AS grupo,
             CASE
               WHEN c.tipo = 'variante' THEN (
                 SELECT string_agg(btrim(o.e->>'opcion'), ' / ' ORDER BY o.ord)
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.variante) = 'array' THEN c.variante ELSE '[]'::jsonb END)
                      WITH ORDINALITY AS o(e, ord)
                 WHERE coalesce(btrim(o.e->>'opcion'), '') <> ''
               )
             END AS etiqueta
      FROM catalog_products c
      WHERE c.tenant_id = ${tenantId} AND ${alcanceSql}
    ) n
    WHERE p.id = n.id
      AND (p.grupo_id IS DISTINCT FROM n.grupo OR p.etiqueta IS DISTINCT FROM n.etiqueta)
    RETURNING 1
  `)) as unknown as unknown[]

  // 2) Representante de cada grupo con variantes.
  const r = (await ej.execute(sql`
    UPDATE catalog_products p
    SET es_representante = (p.alegra_id = r.rep)
    FROM (
      SELECT DISTINCT ON (c.tenant_id, c.grupo_id) c.tenant_id, c.grupo_id, c.alegra_id AS rep
      FROM catalog_products c
      WHERE c.tenant_id = ${tenantId} AND c.grupo_id IS NOT NULL AND c.tipo = 'variante' AND ${alcanceSql}
      ORDER BY c.tenant_id, c.grupo_id,
               ${sql.raw(VENDIBLE("c"))} DESC,
               (c.stock IS NULL OR c.stock > 0) DESC,
               ${sql.raw(precioOnlineMax("c"))} ASC NULLS LAST,
               c.alegra_id ASC
    ) r
    WHERE p.tenant_id = r.tenant_id AND p.grupo_id = r.grupo_id AND p.tipo = 'variante'
      AND p.es_representante IS DISTINCT FROM (p.alegra_id = r.rep)
    RETURNING 1
  `)) as unknown as unknown[]

  // 3) Los demás: el padre nunca es representante; simples y variantes huérfanas lo son de sí mismas.
  const o = (await ej.execute(sql`
    UPDATE catalog_products p
    SET es_representante = (p.tipo <> 'padre')
    FROM catalog_products c
    WHERE c.id = p.id
      AND p.tenant_id = ${tenantId}
      AND ${alcanceSql}
      AND (p.tipo <> 'variante' OR p.grupo_id IS NULL)
      AND p.es_representante IS DISTINCT FROM (p.tipo <> 'padre')
    RETURNING 1
  `)) as unknown as unknown[]

  const [{ n }] = (await ej.execute(sql`
    SELECT count(DISTINCT c.grupo_id)::int AS n
    FROM catalog_products c
    WHERE c.tenant_id = ${tenantId} AND c.grupo_id IS NOT NULL AND ${alcanceSql}
  `)) as unknown as { n: number }[]

  return { grupos: n, cambiados: g.length + r.length + o.length }
}

/**
 * Lo que llaman la sync, el webhook y los cierres de pasada: "best effort", igual que
 * `recalcularTrasSync` de los precios online. Un error se registra y NO tumba la sincronización
 * (el cierre de la próxima corrida lo recupera). Un fallo típico: la migración 0080 sin aplicar.
 */
export async function recalcularGruposTrasSync(
  tenantId: string,
  alcance: AlcanceGrupos | undefined,
  origen: string,
): Promise<void> {
  try {
    const r = await recalcularGrupos(tenantId, alcance)
    if (r.cambiados > 0) console.info(`[variantes] tenant=${tenantId} origen=${origen} grupos=${r.grupos} cambiados=${r.cambiados}`)
  } catch (err) {
    console.warn(`[variantes] tenant=${tenantId} origen=${origen} el recálculo falló: ${err instanceof Error ? err.message : "error"}`)
  }
}
