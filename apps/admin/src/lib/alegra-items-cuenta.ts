import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogProducts, catalogStockSucursal, sucursales } from "@/db/schema"
import {
  buscarItemsPorCodigo,
  createItem,
  listTaxes,
  type AlegraItemCreateInput,
  type AlegraProduct,
  type AlegraTax,
} from "./alegra"
import { normalizarCodigo } from "./alegra-pareo"
import { elegirImpuestoParaLinea } from "./factura-emitir"
import type { TenantConfig } from "./tenants"

// Ítems de una cuenta de Alegra al FACTURAR (change `sucursales-igz-mdp`, rebanada D, design D6).
//
// El `alegra_id` que viaja en `order_items.alegra_item_id` es el del catálogo: real en las filas de
// la principal y SINTÉTICO (`<slug>:<id>`) en las solo-secundaria. Nunca se le manda a Alegra tal
// cual: se resuelve el id REAL en la cuenta con la que se factura.
//
// Orden de resolución de cada línea (los pasos 1 y 2 no hablan con Alegra):
//  1. La fila del catálogo es de ESA cuenta (`cuenta_id` / `alegra_id_cuenta`, o principal sin
//     `cuenta_id`): su id real.
//  2. `catalog_stock_sucursal.item_id_cuenta` de alguna sucursal de la cuenta (el pareo).
//  3. El ítem no está en la cuenta: se lo busca por código en Alegra y, si tampoco está, se CREA
//     (mismo código y nombre, IVA del pedido, precio del pedido, sin stock). Se guarda el
//     `item_id_cuenta` para la próxima. Serializado por (tenant, cuenta, código) con un lock
//     advisory de transacción: dos emisiones simultáneas del mismo producto crean UN solo ítem.
//
// Lo que NO se hace: nunca se modifica un ítem existente ni la fila de `catalog_products`; un
// código duplicado en la cuenta destino aborta (mejor no facturar que elegir el ítem equivocado).

export interface CuentaDestino {
  id: string
  slug: string
  nombre: string
  principal: boolean
}

export interface LineaParaCuenta {
  /** `order_items.alegra_item_id`: id del catálogo (real o sintético). */
  alegraItemId: string
  nombre: string
  /** Precio unitario NETO del pedido (con el que se factura). */
  precioUnitario: number
  ivaPorcentaje: number
}

export interface DepsItemsCuenta {
  buscarPorCodigo: (config: TenantConfig, codigo: string) => Promise<AlegraProduct[]>
  crearItem: (config: TenantConfig, input: AlegraItemCreateInput) => Promise<AlegraProduct>
  listTaxes: (config: TenantConfig) => Promise<AlegraTax[]>
}

const DEPS_REALES: DepsItemsCuenta = { buscarPorCodigo: buscarItemsPorCodigo, crearItem: createItem, listTaxes }

export type ResultadoItemsCuenta =
  | {
      ok: true
      /** `alegraItemId` del catálogo -> id real en la cuenta. */
      ids: Map<string, string>
      /** ids del catálogo cuyo ítem se CREÓ en la cuenta en esta llamada. */
      creados: string[]
    }
  | { ok: false; error: string }

interface FilaCatalogo {
  alegraId: string
  cuentaId: string | null
  alegraIdCuenta: string | null
  code: string | null
  name: string
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]
type Ejecutor = ReturnType<typeof getDb> | Tx

async function slugsDeCuenta(tenantId: string, cuentaId: string, ej: Ejecutor = getDb()): Promise<string[]> {
  const filas = await ej
    .select({ slug: sucursales.slug })
    .from(sucursales)
    .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.cuentaAlegraId, cuentaId)))
  return filas.map((f) => f.slug)
}

async function filasCatalogo(tenantId: string, ids: string[], ej: Ejecutor = getDb()): Promise<Map<string, FilaCatalogo>> {
  if (ids.length === 0) return new Map()
  const filas = await ej
    .select({
      alegraId: catalogProducts.alegraId,
      cuentaId: catalogProducts.cuentaId,
      alegraIdCuenta: catalogProducts.alegraIdCuenta,
      code: catalogProducts.code,
      name: catalogProducts.name,
    })
    .from(catalogProducts)
    .where(and(eq(catalogProducts.tenantId, tenantId), inArray(catalogProducts.alegraId, ids)))
  return new Map(filas.map((f) => [f.alegraId, f]))
}

/** Pasos 1 y 2: el id real en la cuenta si se puede saber SIN hablar con Alegra; si no, null. */
function idLocal(
  cuenta: CuentaDestino,
  fila: FilaCatalogo | undefined,
  alegraId: string,
  pareo: Map<string, string>,
): string | null {
  if (fila) {
    if (fila.cuentaId === cuenta.id) return fila.alegraIdCuenta ?? null
    if (cuenta.principal && fila.cuentaId == null) return fila.alegraIdCuenta ?? fila.alegraId
  } else if (cuenta.principal && !alegraId.includes(":")) {
    // Ítem que ya no está en el espejo (producto dado de baja): comportamiento de siempre.
    return alegraId
  }
  return pareo.get(alegraId) ?? null
}

async function pareoDeCuenta(tenantId: string, slugs: string[], ids: string[], ej: Ejecutor = getDb()): Promise<Map<string, string>> {
  if (slugs.length === 0 || ids.length === 0) return new Map()
  const filas = await ej
    .select({ alegraId: catalogStockSucursal.alegraId, item: catalogStockSucursal.itemIdCuenta })
    .from(catalogStockSucursal)
    .where(
      and(
        eq(catalogStockSucursal.tenantId, tenantId),
        inArray(catalogStockSucursal.sucursal, slugs),
        inArray(catalogStockSucursal.alegraId, ids),
        isNotNull(catalogStockSucursal.itemIdCuenta),
      ),
    )
  const mapa = new Map<string, string>()
  for (const f of filas) if (f.item && !mapa.has(f.alegraId)) mapa.set(f.alegraId, f.item)
  return mapa
}

/**
 * Sólo lectura de la base (vista previa): cuántos ítems del pedido HAY QUE dar de alta en la cuenta
 * porque no se conoce su id allí. Puede sobreestimar (un ítem que existe en Alegra pero nunca se
 * pareó se encuentra por código al emitir y no se crea): por eso el aviso dice "podrían".
 */
export async function itemsSinIdEnCuenta(
  tenantId: string,
  cuenta: CuentaDestino,
  lineas: LineaParaCuenta[],
): Promise<string[]> {
  const ids = [...new Set(lineas.map((l) => l.alegraItemId))]
  const [filas, slugs] = await Promise.all([filasCatalogo(tenantId, ids), slugsDeCuenta(tenantId, cuenta.id)])
  const pareo = await pareoDeCuenta(tenantId, slugs, ids)
  return lineas.filter((l) => idLocal(cuenta, filas.get(l.alegraItemId), l.alegraItemId, pareo) == null).map((l) => l.nombre)
}

/** Guarda el `item_id_cuenta` del ítem recién resuelto en cada sucursal de la cuenta. Nunca choca. */
async function guardarPareo(tx: Tx, tenantId: string, slugs: string[], alegraId: string, itemIdCuenta: string): Promise<void> {
  for (const sucursal of slugs) {
    await tx.execute(sql`
      UPDATE catalog_stock_sucursal AS css
      SET item_id_cuenta = ${itemIdCuenta}, synced_at = now()
      WHERE css.tenant_id = ${tenantId} AND css.sucursal = ${sucursal} AND css.alegra_id = ${alegraId}
        AND css.item_id_cuenta IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM catalog_stock_sucursal x
          WHERE x.tenant_id = ${tenantId} AND x.sucursal = ${sucursal} AND x.item_id_cuenta = ${itemIdCuenta}
        )
    `)
    await tx.execute(sql`
      INSERT INTO catalog_stock_sucursal (tenant_id, sucursal, alegra_id, item_id_cuenta, stock, origen, leido_at, synced_at)
      SELECT ${tenantId}, ${sucursal}, ${alegraId}, ${itemIdCuenta}, 0, 'factura', NULL, now()
      WHERE NOT EXISTS (
        SELECT 1 FROM catalog_stock_sucursal x
        WHERE x.tenant_id = ${tenantId} AND x.sucursal = ${sucursal}
          AND (x.alegra_id = ${alegraId} OR x.item_id_cuenta = ${itemIdCuenta})
      )
    `)
  }
}

const msgDuplicado = (codigo: string, cuenta: CuentaDestino) =>
  `El código "${codigo}" está repetido en la cuenta de Alegra de ${cuenta.nombre}. Corrija el duplicado en Alegra antes de facturar.`

const msgSinImpuesto = (nombre: string, iva: number, cuenta: CuentaDestino) =>
  `No se puede dar de alta "${nombre}" en la cuenta de ${cuenta.nombre}: no hay un impuesto activo con ${iva}% de IVA en esa cuenta.`

/**
 * Devuelve, para cada línea, el id real del ítem en la cuenta con la que se factura, creando en
 * Alegra los que no existan. Si algo no se puede resolver devuelve `{ ok: false, error }` (en
 * usted) SIN haber emitido nada; los errores de red de Alegra (429, 5xx) se propagan.
 */
export async function asegurarItemsEnCuenta(
  tenantId: string,
  config: TenantConfig,
  cuenta: CuentaDestino,
  lineas: LineaParaCuenta[],
  deps: DepsItemsCuenta = DEPS_REALES,
): Promise<ResultadoItemsCuenta> {
  const ids = [...new Set(lineas.map((l) => l.alegraItemId))]
  const db = getDb()
  const [filas, slugs] = await Promise.all([filasCatalogo(tenantId, ids), slugsDeCuenta(tenantId, cuenta.id)])
  const pareo = await pareoDeCuenta(tenantId, slugs, ids)

  const resueltos = new Map<string, string>()
  const creados: string[] = []
  let taxes: AlegraTax[] | null = null

  for (const linea of lineas) {
    if (resueltos.has(linea.alegraItemId)) continue
    const fila = filas.get(linea.alegraItemId)
    const local = idLocal(cuenta, fila, linea.alegraItemId, pareo)
    if (local) {
      resueltos.set(linea.alegraItemId, local)
      continue
    }
    if (!fila) {
      return { ok: false, error: `El producto "${linea.nombre}" ya no está en el catálogo: no se puede facturar por otra cuenta.` }
    }

    const codigo = fila.code?.trim() || null
    const clave = codigo ? normalizarCodigo(codigo) : linea.alegraItemId
    const nombre = fila.name || linea.nombre

    type Paso = { ok: true; id: string; creado: boolean } | { ok: false; error: string }
    const paso: Paso = await db.transaction(async (tx): Promise<Paso> => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`alegra-item:${tenantId}:${cuenta.id}:${clave}`}))`)

      // Otra emisión pudo resolverlo mientras esperábamos el lock.
      const yaPareado = (await pareoDeCuenta(tenantId, slugs, [linea.alegraItemId], tx)).get(linea.alegraItemId)
      if (yaPareado) return { ok: true, id: yaPareado, creado: false }

      if (codigo) {
        const existentes = await deps.buscarPorCodigo(config, codigo)
        if (existentes.length > 1) return { ok: false, error: msgDuplicado(codigo, cuenta) }
        if (existentes.length === 1) {
          await guardarPareo(tx, tenantId, slugs, linea.alegraItemId, existentes[0].alegraId)
          return { ok: true, id: existentes[0].alegraId, creado: false }
        }
      }

      taxes ??= await deps.listTaxes(config)
      const impuesto = elegirImpuestoParaLinea(taxes, linea.ivaPorcentaje)
      if (!impuesto && linea.ivaPorcentaje > 0) return { ok: false, error: msgSinImpuesto(nombre, linea.ivaPorcentaje, cuenta) }

      const creadoEnAlegra = await deps.crearItem(config, {
        name: nombre,
        code: codigo,
        price: linea.precioUnitario,
        taxId: impuesto?.alegraId ?? null,
      })
      await guardarPareo(tx, tenantId, slugs, linea.alegraItemId, creadoEnAlegra.alegraId)
      return { ok: true, id: creadoEnAlegra.alegraId, creado: true }
    })

    if (!paso.ok) return { ok: false, error: paso.error }
    resueltos.set(linea.alegraItemId, paso.id)
    if (paso.creado) creados.push(linea.alegraItemId)
  }
  return { ok: true, ids: resueltos, creados }
}
