import { sql, type SQL } from "drizzle-orm"
import { getDb } from "@/db"
import { esUuid, normalizarMarca } from "./precios-online-cambios"
import { idsSql } from "./precios-online-repo"

// Grilla de precios online del admin (change `listas-precio-online`, rebanada B): filtrado, orden,
// conteo y paginado en Postgres (el navegador recibe UNA página, nunca el catálogo). Para los ids
// de la página se pide a `calcular_precios_online` el coeficiente y su origen por lista, y se leen
// los precios de las listas de Alegra por cuenta SOLO como referencia informativa.

export const LIMITE_GRILLA_DEFAULT = 50
export const LIMITE_GRILLA_MAX = 100

export const ESTADOS_GRILLA = ["ok", "sin-costo", "sin-precio", "retenido", "nuevo"] as const
export type EstadoGrilla = (typeof ESTADOS_GRILLA)[number]
export const ORDENES_GRILLA = ["nombre", "precio", "costo"] as const
export type OrdenGrilla = (typeof ORDENES_GRILLA)[number]

export interface FiltrosGrilla {
  q?: string
  marca?: string
  /** uuid de categoría propia, o "sin" (sin categoría). */
  categoria?: string
  estado?: EstadoGrilla
  /** uuid de una lista online: con `orden=precio` se ordena por el precio de ESA lista. */
  lista?: string
}

export type ParseGrilla =
  | { ok: true; filtros: FiltrosGrilla; start: number; limit: number; orden: OrdenGrilla }
  | { ok: false; error: string }

const MSG = "Los filtros indicados no son válidos."

export function parsearQueryGrilla(url: URL): ParseGrilla {
  const p = url.searchParams
  const filtros: FiltrosGrilla = {}
  const q = p.get("q")?.trim()
  if (q) filtros.q = q.slice(0, 100)
  const marca = p.get("marca")?.trim()
  if (marca) filtros.marca = normalizarMarca(marca).slice(0, 80)
  const categoria = p.get("categoria")
  if (categoria) {
    if (categoria !== "sin" && !esUuid(categoria)) return { ok: false, error: MSG }
    filtros.categoria = categoria
  }
  const estado = p.get("estado")
  if (estado) {
    if (!(ESTADOS_GRILLA as readonly string[]).includes(estado)) return { ok: false, error: MSG }
    filtros.estado = estado as EstadoGrilla
  }
  const lista = p.get("lista")
  if (lista) {
    if (!esUuid(lista)) return { ok: false, error: MSG }
    filtros.lista = lista
  }
  const ordenRaw = p.get("orden") ?? "nombre"
  if (!(ORDENES_GRILLA as readonly string[]).includes(ordenRaw)) return { ok: false, error: MSG }
  const num = (v: string | null, def: number) => {
    if (v === null || v === "") return def
    const n = Number(v)
    return Number.isInteger(n) && n >= 0 ? n : Number.NaN
  }
  const start = num(p.get("start"), 0)
  const limitRaw = num(p.get("limit"), LIMITE_GRILLA_DEFAULT)
  if (Number.isNaN(start) || Number.isNaN(limitRaw) || limitRaw < 1) return { ok: false, error: MSG }
  return { ok: true, filtros, start, limit: Math.min(limitRaw, LIMITE_GRILLA_MAX), orden: ordenRaw as OrdenGrilla }
}

export interface OrigenCoeficiente {
  tipo: "general" | "marca" | "categoria"
  marca?: string
  categoriaId?: string
  categoriaNombre?: string | null
  /** El override viene de una categoría ANCESTRA de la del producto. */
  heredado?: boolean
}

export interface PrecioListaGrilla {
  listaId: string
  coeficiente: string
  origen: OrigenCoeficiente
  /** Neto sin IVA; null = no se calcula (sin costo). */
  precio: string | null
}

/** Precio de un producto en una lista de Alegra de UNA cuenta. Solo informativo. */
export interface ReferenciaAlegra {
  cuentaId: string | null
  cuenta: string
  principal: boolean
  listaId: string
  listaNombre: string
  precio: number
}

export interface FilaGrilla {
  alegraId: string
  code: string | null
  nombre: string
  marca: string | null
  categoriaId: string | null
  categoriaNombre: string | null
  costo: string | null
  costoAplicado: string | null
  precioReferencia: string | null
  estado: EstadoGrilla
  retenido: boolean
  precios: PrecioListaGrilla[]
  referenciaAlegra: ReferenciaAlegra[]
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

function condiciones(tenantId: string, f: FiltrosGrilla): SQL {
  const partes: SQL[] = [
    sql`p.tenant_id = ${tenantId}`,
    sql`p.status = 'active'`,
    sql`p.reemplazado_por_alegra_id IS NULL`,
  ]
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`
    partes.push(sql`(p.code ILIKE ${like} OR p.name ILIKE ${like} OR o.nombre ILIKE ${like})`)
  }
  if (f.marca) partes.push(sql`nullif(lower(btrim(p.brand)), '') = ${f.marca}`)
  if (f.categoria === "sin") partes.push(sql`o.categoria_id IS NULL`)
  else if (f.categoria) partes.push(sql`o.categoria_id = ${f.categoria}::uuid`)
  const pendiente = sql`EXISTS (SELECT 1 FROM precios_online_retenciones r WHERE r.tenant_id = p.tenant_id AND r.alegra_id = p.alegra_id AND r.estado = 'pendiente')`
  switch (f.estado) {
    case "sin-costo":
      partes.push(sql`p.costo IS NULL`)
      break
    case "sin-precio":
      partes.push(sql`p.costo IS NOT NULL AND p.precios_online = '[]'::jsonb`)
      break
    case "retenido":
      partes.push(pendiente)
      break
    case "nuevo":
      partes.push(sql`o.id IS NULL`)
      break
    case "ok":
      partes.push(sql`p.costo IS NOT NULL AND p.precios_online <> '[]'::jsonb AND NOT ${pendiente}`)
      break
  }
  return sql.join(partes, sql` AND `)
}

interface FilaSql {
  alegraId: string
  code: string | null
  nombre: string
  marca: string | null
  categoriaId: string | null
  categoriaNombre: string | null
  costo: string | null
  costoAplicado: string | null
  precioReferencia: string | null
  retenido: boolean
  nuevo: boolean
}

function estadoDe(f: FilaSql, tienePrecios: boolean): EstadoGrilla {
  if (f.retenido) return "retenido"
  if (f.costo === null) return "sin-costo"
  if (!tienePrecios) return "sin-precio"
  if (f.nuevo) return "nuevo"
  return "ok"
}

function parsearOrigen(origen: string, categoriaProducto: string | null, nombres: Map<string, string>): OrigenCoeficiente {
  if (origen.startsWith("marca:")) return { tipo: "marca", marca: origen.slice(6) }
  if (origen.startsWith("categoria:")) {
    const id = origen.slice(10)
    return { tipo: "categoria", categoriaId: id, categoriaNombre: nombres.get(id) ?? null, heredado: id !== categoriaProducto }
  }
  return { tipo: "general" }
}

export async function listarGrilla(
  tenantId: string,
  filtros: FiltrosGrilla,
  pag: { start: number; limit: number; orden: OrdenGrilla },
): Promise<{ items: FilaGrilla[]; total: number }> {
  const db = getDb()
  const where = condiciones(tenantId, filtros)
  const desde = sql`FROM catalog_products p LEFT JOIN catalog_overlay o ON o.tenant_id = p.tenant_id AND o.alegra_id = p.alegra_id`

  const [{ total }] = (await db.execute(sql`SELECT count(*)::int AS total ${desde} WHERE ${where}`)) as unknown as { total: number }[]

  const precioLista = filtros.lista
    ? sql`(SELECT (e->>'price')::numeric FROM jsonb_array_elements(p.precios_online || p.precios_online_privados) e WHERE e->>'idPriceList' = ${filtros.lista} LIMIT 1)`
    : sql`p.precio_online_ref`
  const orden =
    pag.orden === "precio"
      ? sql`${precioLista} ASC NULLS LAST, lower(coalesce(o.nombre, p.name)), p.alegra_id`
      : pag.orden === "costo"
        ? sql`p.costo ASC NULLS LAST, lower(coalesce(o.nombre, p.name)), p.alegra_id`
        : sql`lower(coalesce(o.nombre, p.name)), p.alegra_id`

  const filas = (await db.execute(sql`
    SELECT p.alegra_id AS "alegraId", p.code, coalesce(o.nombre, p.name) AS nombre, p.brand AS marca,
           o.categoria_id::text AS "categoriaId", cat.nombre AS "categoriaNombre",
           p.costo::text AS costo, p.costo_aplicado::text AS "costoAplicado",
           p.precio_online_ref::text AS "precioReferencia",
           EXISTS (SELECT 1 FROM precios_online_retenciones r WHERE r.tenant_id = p.tenant_id AND r.alegra_id = p.alegra_id AND r.estado = 'pendiente') AS retenido,
           (o.id IS NULL) AS nuevo,
           (p.precios_online <> '[]'::jsonb) AS "tienePrecios"
    ${desde}
    LEFT JOIN shop_categories cat ON cat.id = o.categoria_id
    WHERE ${where}
    ORDER BY ${orden}
    LIMIT ${pag.limit} OFFSET ${pag.start}
  `)) as unknown as (FilaSql & { tienePrecios: boolean })[]

  if (filas.length === 0) return { items: [], total }
  const ids = filas.map((f) => f.alegraId)

  // Coeficiente y origen por lista: solo para los ids de ESTA página.
  const calc = (await db.execute(sql`
    SELECT alegra_id, lista_id::text AS lista_id, coef::text AS coef, origen, precio::text AS precio
    FROM calcular_precios_online(${tenantId}, ${idsSql(ids)})
  `)) as unknown as { alegra_id: string; lista_id: string; coef: string; origen: string; precio: string | null }[]

  const catIds = [...new Set(calc.filter((c) => c.origen.startsWith("categoria:")).map((c) => c.origen.slice(10)))]
  const nombres = new Map<string, string>()
  if (catIds.length) {
    const cats = (await db.execute(sql`
      SELECT id::text AS id, nombre FROM shop_categories
      WHERE tenant_id = ${tenantId} AND id = ANY (ARRAY[${sql.join(catIds.map((c) => sql`${c}`), sql`, `)}]::uuid[])
    `)) as unknown as { id: string; nombre: string }[]
    for (const c of cats) nombres.set(c.id, c.nombre)
  }

  // Referencia (solo informativa): los precios de las listas de Alegra de la fila del producto y de
  // la fila de SU PAR en otra cuenta (la que la principal absorbió: `reemplazado_por_alegra_id`),
  // cada una bajo el nombre de su cuenta.
  const refs = (await db.execute(sql`
    SELECT p.alegra_id AS "alegraId", r.cuenta_id::text AS "cuentaId",
           coalesce(c.nombre, 'Principal') AS cuenta, (r.cuenta_id IS NULL) AS principal, r.precios_alegra AS precios
    FROM catalog_products p
    JOIN catalog_products r ON r.tenant_id = p.tenant_id AND (r.alegra_id = p.alegra_id OR r.reemplazado_por_alegra_id = p.alegra_id)
    LEFT JOIN alegra_cuentas c ON c.id = coalesce(r.cuenta_id, (SELECT a.id FROM alegra_cuentas a WHERE a.tenant_id = p.tenant_id AND a.principal LIMIT 1))
    WHERE p.tenant_id = ${tenantId} AND p.alegra_id = ANY (${idsSql(ids)})
  `)) as unknown as { alegraId: string; cuentaId: string | null; cuenta: string; principal: boolean; precios: unknown }[]

  const referenciaPor = new Map<string, ReferenciaAlegra[]>()
  for (const r of refs) {
    if (!Array.isArray(r.precios)) continue
    for (const e of r.precios as { idPriceList?: unknown; name?: unknown; price?: unknown }[]) {
      const precio = typeof e.price === "string" ? Number(e.price) : e.price
      if (typeof precio !== "number" || !Number.isFinite(precio)) continue
      const lista = referenciaPor.get(r.alegraId) ?? []
      lista.push({
        cuentaId: r.cuentaId,
        cuenta: r.cuenta,
        principal: r.principal,
        listaId: String(e.idPriceList ?? ""),
        listaNombre: String(e.name ?? ""),
        precio,
      })
      referenciaPor.set(r.alegraId, lista)
    }
  }

  const items = filas.map((f): FilaGrilla => {
    const precios = calc
      .filter((c) => c.alegra_id === f.alegraId)
      .map((c) => ({ listaId: c.lista_id, coeficiente: c.coef, origen: parsearOrigen(c.origen, f.categoriaId, nombres), precio: c.precio }))
    const referenciaAlegra = (referenciaPor.get(f.alegraId) ?? []).sort(
      (a, b) => Number(b.principal) - Number(a.principal) || a.cuenta.localeCompare(b.cuenta) || a.listaNombre.localeCompare(b.listaNombre),
    )
    return {
      alegraId: f.alegraId,
      code: f.code,
      nombre: f.nombre,
      marca: f.marca,
      categoriaId: f.categoriaId,
      categoriaNombre: f.categoriaNombre,
      costo: f.costo,
      costoAplicado: f.costoAplicado,
      precioReferencia: f.precioReferencia,
      estado: estadoDe(f, f.tienePrecios),
      retenido: f.retenido,
      precios,
      referenciaAlegra,
    }
  })
  return { items, total }
}
