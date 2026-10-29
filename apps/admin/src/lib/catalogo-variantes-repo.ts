import { sql, type SQL } from "drizzle-orm"
import { getDb, type Db } from "@/db"
import { recalcularCampanias } from "./campanias-recalculo"

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
//  - Grupo manual (rebanada S4, `catalog_variantes_manuales`): el operador suma a mano un producto
//    suelto a un modelo. El grupo efectivo es coalesce(manual, padre de Alegra) y, igual que con el
//    padre, sólo vale si el ANCLA existe (un padre de Alegra, o el producto base de un grupo manual,
//    que lleva su propia fila con `grupo_id = alegra_id`). Un padre nunca entra a un grupo.
//  - Etiqueta: la manual si hay; si no, las opciones de la variante unidas con " / ".
//  - Representante: UNO por grupo, el que da la cara del modelo en el listado. Orden: vendible
//    (activa, no dada de baja en Alegra, con precio online > 0) > con stock (null cuenta como
//    "sin dato", no como agotado) > menor precio online > orden manual > alegra_id (estable). Si todas están sin
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

  // 1) Grupo y etiqueta. El grupo manual manda sobre el del padre y, como éste, sólo vale con ancla.
  const g = (await ej.execute(sql`
    UPDATE catalog_products p
    SET grupo_id = n.grupo, etiqueta = n.etiqueta
    FROM (
      SELECT x.id, x.grupo,
             CASE
               WHEN x.grupo IS NOT NULL THEN coalesce(nullif(btrim(x.manual_etiqueta), ''), x.opciones)
               WHEN x.tipo = 'variante' THEN x.opciones
             END AS etiqueta
      FROM (
        SELECT c.id, c.tipo, m.etiqueta AS manual_etiqueta,
               CASE
                 WHEN c.tipo <> 'padre' AND m.grupo_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM catalog_products pa
                   WHERE pa.tenant_id = c.tenant_id AND pa.alegra_id = m.grupo_id
                     AND (pa.tipo = 'padre' OR EXISTS (
                       SELECT 1 FROM catalog_variantes_manuales ma
                       WHERE ma.tenant_id = pa.tenant_id AND ma.alegra_id = pa.alegra_id AND ma.grupo_id = pa.alegra_id
                     ))
                 ) THEN m.grupo_id
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
               END AS opciones
        FROM catalog_products c
        LEFT JOIN catalog_variantes_manuales m ON (m.tenant_id = c.tenant_id AND m.alegra_id = c.alegra_id)
        WHERE c.tenant_id = ${tenantId} AND ${alcanceSql}
      ) x
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
      LEFT JOIN catalog_variantes_manuales m ON (m.tenant_id = c.tenant_id AND m.alegra_id = c.alegra_id)
      LEFT JOIN catalog_overlay ov ON (ov.tenant_id = c.tenant_id AND ov.alegra_id = c.alegra_id)
      WHERE c.tenant_id = ${tenantId} AND c.grupo_id IS NOT NULL AND ${alcanceSql}
      ORDER BY c.tenant_id, c.grupo_id,
               coalesce(ov.oculta_en_tienda, false) ASC,
               ${sql.raw(VENDIBLE("c"))} DESC,
               (c.stock IS NULL OR c.stock > 0) DESC,
               ${sql.raw(precioOnlineMax("c"))} ASC NULLS LAST,
               m.orden ASC NULLS LAST,
               c.alegra_id ASC
    ) r
    WHERE p.tenant_id = r.tenant_id AND p.grupo_id = r.grupo_id
      AND p.es_representante IS DISTINCT FROM (p.alegra_id = r.rep)
    RETURNING 1
  `)) as unknown as unknown[]

  // 3) Los demás (sin grupo): el padre nunca es representante; simples y variantes huérfanas lo son de sí mismas.
  const o = (await ej.execute(sql`
    UPDATE catalog_products p
    SET es_representante = (p.tipo <> 'padre')
    FROM catalog_products c
    WHERE c.id = p.id
      AND p.tenant_id = ${tenantId}
      AND ${alcanceSql}
      AND p.grupo_id IS NULL
      AND p.es_representante IS DISTINCT FROM (p.tipo <> 'padre')
    RETURNING 1
  `)) as unknown as unknown[]

  const [{ n }] = (await ej.execute(sql`
    SELECT count(DISTINCT c.grupo_id)::int AS n
    FROM catalog_products c
    WHERE c.tenant_id = ${tenantId} AND c.grupo_id IS NOT NULL AND ${alcanceSql}
  `)) as unknown as { n: number }[]

  // Un producto que entra o sale de un modelo cambia de categoría efectiva (la del ancla): las
  // campañas por categoría o por producto del modelo se recalculan en el momento.
  if (g.length > 0) await recalcularCampanias(ej, tenantId, null)

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

// ─── Adopción del overlay por el ancla (rebanada S4) ────────────────────────────────────
//
// Con el selector de la tienda prendido, el overlay de un modelo es el de su ANCLA (el padre, o la
// base de un grupo manual). Hoy ese overlay casi nunca existe: lo que el operador cargó (nombre,
// categoría, fotos, ficha, visibilidad, etiquetas) está en cada variante. Esto copia el overlay de la
// variante que da la cara del modelo (el representante) al ancla, SOLO si el ancla no tiene uno: nunca
// pisa nada. Los grupos en los que ningún miembro tiene overlay se informan, porque con el flag
// prendido saldrían invisibles (fail-closed) hasta que alguien los cargue.

export interface ResultadoAdopcion {
  /** Modelos (anclas con al menos una variante) del tenant. */
  grupos: number
  /** Ya tenían overlay propio: no se tocan. */
  conOverlay: number
  /** Overlays copiados del representante (o de otra variante con overlay) al ancla. */
  copiados: number
  /** Ningún miembro tiene overlay: saldrían invisibles. Ids de Alegra del ancla (hasta 200). */
  sinOverlay: string[]
  sinOverlayTotal: number
}

export async function adoptarOverlayEnAnclas(tenantId: string, ej: Ejecutor = getDb()): Promise<ResultadoAdopcion> {
  const anclas = (await ej.execute(sql`
    SELECT g.grupo_id,
           EXISTS (SELECT 1 FROM catalog_overlay o WHERE o.tenant_id = g.tenant_id AND o.alegra_id = g.grupo_id) AS tiene,
           (SELECT m.alegra_id FROM catalog_products m
            JOIN catalog_overlay mo ON (mo.tenant_id = m.tenant_id AND mo.alegra_id = m.alegra_id)
            WHERE m.tenant_id = g.tenant_id AND m.grupo_id = g.grupo_id AND m.alegra_id <> g.grupo_id
            ORDER BY m.es_representante DESC, m.alegra_id ASC
            LIMIT 1) AS fuente
    FROM (SELECT DISTINCT tenant_id, grupo_id FROM catalog_products WHERE tenant_id = ${tenantId} AND grupo_id IS NOT NULL) g
    ORDER BY g.grupo_id
  `)) as unknown as { grupo_id: string; tiene: boolean; fuente: string | null }[]

  const { copiarOverlaySiFalta } = await import("@/lib/catalogo-union-repo")
  const r: ResultadoAdopcion = { grupos: anclas.length, conOverlay: 0, copiados: 0, sinOverlay: [], sinOverlayTotal: 0 }
  for (const a of anclas) {
    if (a.tiene) {
      r.conOverlay++
      continue
    }
    if (!a.fuente) {
      r.sinOverlayTotal++
      if (r.sinOverlay.length < 200) r.sinOverlay.push(a.grupo_id)
      continue
    }
    if (await copiarOverlaySiFalta(ej, tenantId, a.fuente, a.grupo_id)) {
      // `copiarOverlaySiFalta` no copia en qué sucursales se oculta el producto (se escribió antes de
      // esa columna): el modelo hereda la del representante.
      await ej.execute(sql`
        UPDATE catalog_overlay dst
        SET oculto_en_sucursales = src.oculto_en_sucursales
        FROM catalog_overlay src
        WHERE dst.tenant_id = ${tenantId} AND dst.alegra_id = ${a.grupo_id}
          AND src.tenant_id = ${tenantId} AND src.alegra_id = ${a.fuente}
      `)
      r.copiados++
    }
  }
  return r
}

// ─── Grupos armados a mano (rebanada S4) ────────────────────────────────────────────────
//
// El operador suma a un modelo un producto suelto (el "RGB" que en Alegra es otro ítem con otro
// precio) o lo quita. Las reglas que garantizan que nunca haya ciclos ni doble pertenencia:
//   - sólo se suma un producto de tipo `simple` (ni un padre, ni una variante de Alegra);
//   - un producto tiene a lo sumo UNA fila en `catalog_variantes_manuales` (clave primaria);
//   - el destino tiene que ser un ANCLA: un padre de Alegra, un producto que ya es base de un grupo
//     manual (tiene su fila propia, `grupo_id = alegra_id`), o un producto suelto sin grupo, que pasa
//     a ser la base del grupo nuevo (hay que indicar su etiqueta);
//   - un producto que ya está en un grupo (miembro o base) no puede ser destino ni sumarse a otro.
// Todo filtra por el tenant del guard: un id de otro tenant se comporta como inexistente.
// Tras cada cambio se llama a `recalcularGrupos` de los grupos tocados (el viejo y el nuevo).

export const MAX_ETIQUETA = 60
export const MAX_ORDEN = 9999

export type ResultadoGrupoManual =
  | { kind: "ok"; grupoId: string; alegraIds: string[] }
  | { kind: "not_found"; campo: string; error: string }
  | { kind: "invalid"; campo: string; error: string }

export interface PedidoSumarAGrupo {
  alegraId: string
  grupoId: string
  etiqueta: string
  orden?: number
  /** Sólo si el destino es un producto suelto que pasa a ser la base de un grupo nuevo. */
  etiquetaAncla?: string
}

const invalido = (campo: string, error: string): ResultadoGrupoManual => ({ kind: "invalid", campo, error })

interface FilaProducto {
  alegra_id: string
  tipo: string
  reemplazado: boolean
  grupo_manual: string | null
}

async function leerProducto(ej: Ejecutor, tenantId: string, alegraId: string): Promise<FilaProducto | null> {
  const filas = (await ej.execute(sql`
    SELECT p.alegra_id, p.tipo, (p.reemplazado_por_alegra_id IS NOT NULL) AS reemplazado, m.grupo_id AS grupo_manual
    FROM catalog_products p
    LEFT JOIN catalog_variantes_manuales m ON (m.tenant_id = p.tenant_id AND m.alegra_id = p.alegra_id)
    WHERE p.tenant_id = ${tenantId} AND p.alegra_id = ${alegraId}
    LIMIT 1
  `)) as unknown as FilaProducto[]
  return filas[0] ?? null
}

const normalizarEtiqueta = (v: unknown): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "")

/** ¿Ya hay en el grupo una opción con esa etiqueta (de Alegra o manual)? Se compara sin mayúsculas. */
async function etiquetaRepetida(ej: Ejecutor, tenantId: string, grupoId: string, etiqueta: string): Promise<boolean> {
  const filas = (await ej.execute(sql`
    SELECT 1 FROM (
      SELECT etiqueta FROM catalog_products WHERE tenant_id = ${tenantId} AND grupo_id = ${grupoId}
      UNION ALL
      SELECT etiqueta FROM catalog_variantes_manuales WHERE tenant_id = ${tenantId} AND grupo_id = ${grupoId}
    ) e WHERE lower(btrim(e.etiqueta)) = lower(${etiqueta}) LIMIT 1
  `)) as unknown as unknown[]
  return filas.length > 0
}

/**
 * Suma un producto suelto a un grupo. Valida todo antes de escribir; las filas (una o dos) se
 * insertan en una sola transacción y después se recalculan los grupos tocados.
 */
export async function sumarAGrupo(
  tenantId: string,
  pedido: PedidoSumarAGrupo,
  actor: string | null,
): Promise<ResultadoGrupoManual> {
  const etiqueta = normalizarEtiqueta(pedido.etiqueta)
  if (!etiqueta) return invalido("etiqueta", "Indique cómo se llama esta opción en el modelo (por ejemplo, RGB).")
  if (etiqueta.length > MAX_ETIQUETA) return invalido("etiqueta", `La etiqueta no puede superar los ${MAX_ETIQUETA} caracteres.`)
  const orden = pedido.orden ?? 0
  if (!Number.isInteger(orden) || orden < 0 || orden > MAX_ORDEN) {
    return invalido("orden", `El orden debe ser un número entero entre 0 y ${MAX_ORDEN}.`)
  }
  if (typeof pedido.alegraId !== "string" || !pedido.alegraId) return invalido("alegraId", "Seleccione el producto que desea sumar.")
  if (typeof pedido.grupoId !== "string" || !pedido.grupoId) return invalido("grupoId", "Seleccione el modelo al que desea sumarlo.")
  if (pedido.alegraId === pedido.grupoId) return invalido("grupoId", "Un producto no se puede sumar a sí mismo.")

  const db = getDb()
  const producto = await leerProducto(db, tenantId, pedido.alegraId)
  if (!producto || producto.reemplazado) {
    return { kind: "not_found", campo: "alegraId", error: "No encontramos el producto que desea sumar." }
  }
  if (producto.tipo === "padre") return invalido("alegraId", "Un modelo con variantes no se puede sumar a otro grupo.")
  if (producto.tipo !== "simple") return invalido("alegraId", "Esa variante ya pertenece a un modelo de Alegra. Solo pueden sumarse productos sueltos.")
  if (producto.grupo_manual !== null) return invalido("alegraId", "Ese producto ya pertenece a un grupo. Quítelo primero para sumarlo a otro.")

  const destino = await leerProducto(db, tenantId, pedido.grupoId)
  if (!destino || destino.reemplazado) {
    return { kind: "not_found", campo: "grupoId", error: "No encontramos el modelo elegido." }
  }
  let crearBase = false
  if (destino.tipo === "padre") {
    // Un padre de Alegra es ancla por definición.
  } else if (destino.tipo !== "simple") {
    return invalido("grupoId", "Esa variante no puede ser la base de un grupo. Elija el modelo al que pertenece.")
  } else if (destino.grupo_manual === pedido.grupoId) {
    // Ya es la base de un grupo armado a mano.
  } else if (destino.grupo_manual !== null) {
    return invalido("grupoId", "Ese producto ya forma parte de otro grupo. Elija la base del grupo.")
  } else {
    crearBase = true
  }

  let etiquetaAncla = ""
  if (crearBase) {
    etiquetaAncla = normalizarEtiqueta(pedido.etiquetaAncla)
    if (!etiquetaAncla) {
      return invalido("etiquetaAncla", "Indique cómo se llama la opción del producto base del grupo (por ejemplo, Blanco).")
    }
    if (etiquetaAncla.length > MAX_ETIQUETA) return invalido("etiquetaAncla", `La etiqueta no puede superar los ${MAX_ETIQUETA} caracteres.`)
    if (etiquetaAncla.toLowerCase() === etiqueta.toLowerCase()) {
      return invalido("etiqueta", "Las dos opciones del grupo no pueden llamarse igual.")
    }
  } else if (await etiquetaRepetida(db, tenantId, pedido.grupoId, etiqueta)) {
    return invalido("etiqueta", "Ya hay una opción con ese nombre en el modelo. Use otra etiqueta.")
  }

  await db.transaction(async (tx) => {
    if (crearBase) {
      await tx.execute(sql`
        INSERT INTO catalog_variantes_manuales (tenant_id, alegra_id, grupo_id, etiqueta, orden, updated_by, updated_at)
        VALUES (${tenantId}, ${pedido.grupoId}, ${pedido.grupoId}, ${etiquetaAncla}, 0, ${actor}, now())
      `)
    }
    await tx.execute(sql`
      INSERT INTO catalog_variantes_manuales (tenant_id, alegra_id, grupo_id, etiqueta, orden, updated_by, updated_at)
      VALUES (${tenantId}, ${pedido.alegraId}, ${pedido.grupoId}, ${etiqueta}, ${orden}, ${actor}, now())
    `)
  })

  const alegraIds = [pedido.alegraId, pedido.grupoId]
  await recalcularGrupos(tenantId, { alegraIds, grupoIds: [pedido.grupoId] })
  return { kind: "ok", grupoId: pedido.grupoId, alegraIds }
}

/**
 * Quita un producto de su grupo manual. La base de un grupo con más miembros no se puede quitar
 * (primero los demás); si al quitar un miembro la base queda sola, el grupo se disuelve.
 */
export async function quitarDelGrupo(tenantId: string, alegraId: string): Promise<ResultadoGrupoManual> {
  if (typeof alegraId !== "string" || !alegraId) return invalido("alegraId", "Seleccione el producto que desea quitar.")
  const db = getDb()
  const filas = (await db.execute(sql`
    SELECT grupo_id FROM catalog_variantes_manuales WHERE tenant_id = ${tenantId} AND alegra_id = ${alegraId}
  `)) as unknown as { grupo_id: string }[]
  const fila = filas[0]
  if (!fila) {
    return { kind: "not_found", campo: "alegraId", error: "Ese producto no está en un grupo armado a mano." }
  }
  const grupoId = fila.grupo_id
  const esBase = grupoId === alegraId

  const otros = (await db.execute(sql`
    SELECT count(*)::int AS n FROM catalog_variantes_manuales
    WHERE tenant_id = ${tenantId} AND grupo_id = ${grupoId} AND alegra_id <> ${grupoId} AND alegra_id <> ${alegraId}
  `)) as unknown as { n: number }[]
  if (esBase && otros[0].n > 0) {
    return invalido("alegraId", "Es el producto base del grupo. Quite primero los demás productos del grupo.")
  }

  const tocados = [alegraId]
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM catalog_variantes_manuales WHERE tenant_id = ${tenantId} AND alegra_id = ${alegraId}`)
    // La base sola no es un grupo: se disuelve con su último miembro.
    if (!esBase && otros[0].n === 0) {
      const borradas = (await tx.execute(sql`
        DELETE FROM catalog_variantes_manuales
        WHERE tenant_id = ${tenantId} AND alegra_id = ${grupoId} AND grupo_id = ${grupoId}
        RETURNING 1
      `)) as unknown as unknown[]
      if (borradas.length > 0) tocados.push(grupoId)
    }
  })

  await recalcularGrupos(tenantId, { alegraIds: tocados, grupoIds: [grupoId] })
  return { kind: "ok", grupoId, alegraIds: tocados }
}

// ─── Variantes ocultables en la tienda (change `variantes-ocultables`) ───────────────────

export type ResultadoOcultar =
  | { kind: "ok"; grupoId: string; ocultaEnTienda: boolean }
  | { kind: "not_found"; campo: string; error: string }
  | { kind: "invalid"; campo: string; error: string }

/**
 * Oculta (o vuelve a mostrar) una variante en la tienda. Sólo vale para una variante AGRUPADA (con
 * modelo y que no sea el ancla). Hace upsert del overlay PROPIO de la variante tocando únicamente
 * `oculta_en_tienda` (ni `visible` ni el resto de sus campos) y recalcula el grupo: si la variante
 * oculta era la representante, pasa a serlo otra visible y activa.
 */
export async function ocultarVariante(
  tenantId: string,
  alegraId: string,
  oculta: boolean,
  updatedBy: string | null,
  ej: Ejecutor = getDb(),
): Promise<ResultadoOcultar> {
  if (typeof alegraId !== "string" || !alegraId) {
    return { kind: "invalid", campo: "alegraId", error: "Seleccione la variante." }
  }
  if (typeof oculta !== "boolean") {
    return { kind: "invalid", campo: "ocultaEnTienda", error: "Indique si la variante se muestra o no en la tienda." }
  }
  const filas = (await ej.execute(sql`
    SELECT tipo, grupo_id FROM catalog_products WHERE tenant_id = ${tenantId} AND alegra_id = ${alegraId} LIMIT 1
  `)) as unknown as { tipo: string; grupo_id: string | null }[]
  const fila = filas[0]
  if (!fila) return { kind: "not_found", campo: "alegraId", error: "No encontramos el producto. Actualice el listado e inténtelo nuevamente." }
  if (fila.tipo === "padre" || !fila.grupo_id || fila.grupo_id === alegraId) {
    return { kind: "invalid", campo: "alegraId", error: "Solo se puede ocultar una variante de un modelo." }
  }
  await ej.execute(sql`
    INSERT INTO catalog_overlay (tenant_id, alegra_id, oculta_en_tienda, updated_by, updated_at)
    VALUES (${tenantId}, ${alegraId}, ${oculta}, ${updatedBy}, now())
    ON CONFLICT (tenant_id, alegra_id)
    DO UPDATE SET oculta_en_tienda = EXCLUDED.oculta_en_tienda, updated_by = EXCLUDED.updated_by, updated_at = now()
  `)
  await recalcularGrupos(tenantId, { alegraIds: [alegraId], grupoIds: [fila.grupo_id] }, ej)
  return { kind: "ok", grupoId: fila.grupo_id, ocultaEnTienda: oculta }
}
