import { and, asc, eq, inArray, ne, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { sucursales, zonas } from "@/db/schema"
import {
  validarSucursalCambios,
  validarSucursalNueva,
  validarZona,
  type CambiosSucursal,
} from "@/lib/sucursales-validacion"

// Acceso a datos de Sucursales y zonas (change `sucursales-igz-mdp`, rebanada A). TODO filtra por
// `tenantId` (el del guard, nunca el del body): un slug de otro tenant se comporta igual que uno
// inexistente (not_found). Los errores viajan en usted.
//
// Reglas:
//  - El slug es inmutable (lo guardan los pedidos como texto, sin FK): sólo se puede dar de baja
//    de forma lógica (`activa = false`); DELETE sólo si ningún pedido ni zona la usa.
//  - "Predeterminada" y "principal" (columna `maestra`) son únicas por tenant. Marcar otra
//    TRANSFIERE la marca dentro de una transacción: primero se baja la vieja y después se sube la
//    nueva (los índices únicos parciales no admiten dos a la vez). Un lock por tenant serializa
//    las escrituras de configuración.
//  - La predeterminada no se puede dar de baja ni desmarcar sin transferirla: las provincias sin
//    zona necesitan un destino.

type SucursalRow = typeof sucursales.$inferSelect
type ZonaRow = typeof zonas.$inferSelect
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]

export interface SucursalDto {
  slug: string
  nombre: string
  direccion: string
  ciudad: string
  provincia: string
  whatsapp: string
  emailPedidos: string | null
  aceptaRetiro: boolean
  aceptaEnvio: boolean
  envioCiudades: string[]
  orden: number
  activa: boolean
  predeterminada: boolean
  maestra: boolean
}

export interface ZonaDto {
  provinciaClave: string
  provincia: string
  sucursal: string
  facturaSucursal: string | null
}

export const toSucursalDto = (r: SucursalRow): SucursalDto => ({
  slug: r.slug,
  nombre: r.nombre,
  direccion: r.direccion,
  ciudad: r.ciudad,
  provincia: r.provincia,
  whatsapp: r.whatsapp,
  emailPedidos: r.emailPedidos,
  aceptaRetiro: r.aceptaRetiro,
  aceptaEnvio: r.aceptaEnvio,
  envioCiudades: r.envioCiudades,
  orden: r.orden,
  activa: r.activa,
  predeterminada: r.predeterminada,
  maestra: r.maestra,
})

export const toZonaDto = (r: ZonaRow): ZonaDto => ({
  provinciaClave: r.provinciaClave,
  provincia: r.provincia,
  sucursal: r.sucursal,
  facturaSucursal: r.facturaSucursal,
})

export type ResultadoSucursal =
  | { kind: "ok"; sucursal: SucursalDto }
  | { kind: "invalid"; campo: string; error: string }
  | { kind: "conflict"; campo: string; error: string }
  | { kind: "not_found" }

export type ResultadoZona =
  | { kind: "ok"; zona: ZonaDto }
  | { kind: "invalid"; campo: string; error: string }
  | { kind: "not_found" }

export type ResultadoBorrado =
  | { kind: "ok" }
  | { kind: "conflict"; error: string }
  | { kind: "not_found" }

const MSG_CONCURRENCIA = "Otro usuario modificó las sucursales al mismo tiempo. Inténtelo nuevamente."

function codigoPg(err: unknown): string | undefined {
  for (let e: unknown = err, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === "string") return code
  }
  return undefined
}

async function bloquearTenant(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sucursales:${tenantId}`}))`)
}

export async function listarSucursales(tenantId: string): Promise<SucursalRow[]> {
  return getDb()
    .select()
    .from(sucursales)
    .where(eq(sucursales.tenantId, tenantId))
    .orderBy(asc(sucursales.orden), asc(sucursales.nombre))
}

export async function listarZonas(tenantId: string): Promise<ZonaRow[]> {
  return getDb().select().from(zonas).where(eq(zonas.tenantId, tenantId)).orderBy(asc(zonas.provincia))
}

/**
 * ¿Todos estos slugs son sucursales de ESTE tenant (activas o dadas de baja)? Lo usa la API del
 * overlay del catálogo para validar "Visible en": un slug de otro tenant o inexistente no pasa.
 */
export async function sonSlugsDeSucursal(tenantId: string, slugs: string[]): Promise<boolean> {
  if (slugs.length === 0) return true
  const filas = await getDb()
    .select({ slug: sucursales.slug })
    .from(sucursales)
    .where(and(eq(sucursales.tenantId, tenantId), inArray(sucursales.slug, slugs)))
  return filas.length === new Set(slugs).size
}

/** Baja las marcas únicas que el alta/cambio va a subir (transferencia: primero la vieja). */
async function transferirMarcas(
  tx: Tx,
  tenantId: string,
  slug: string,
  marcas: { predeterminada?: boolean; maestra?: boolean },
): Promise<void> {
  if (marcas.predeterminada === true) {
    await tx
      .update(sucursales)
      .set({ predeterminada: false, updatedAt: new Date() })
      .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.predeterminada, true), ne(sucursales.slug, slug)))
  }
  if (marcas.maestra === true) {
    await tx
      .update(sucursales)
      .set({ maestra: false, updatedAt: new Date() })
      .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.maestra, true), ne(sucursales.slug, slug)))
  }
}

export async function crearSucursal(tenantId: string, body: unknown): Promise<ResultadoSucursal> {
  const v = validarSucursalNueva(body)
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  const datos = v.valor

  try {
    return await getDb().transaction(async (tx): Promise<ResultadoSucursal> => {
      await bloquearTenant(tx, tenantId)

      const [existente] = await tx
        .select({ slug: sucursales.slug })
        .from(sucursales)
        .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.slug, datos.slug)))
      if (existente) return { kind: "conflict", campo: "slug", error: "Ya existe una sucursal con ese identificador." }

      const [hayPredeterminada] = await tx
        .select({ slug: sucursales.slug })
        .from(sucursales)
        .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.predeterminada, true)))
      // La primera sucursal del tenant es la predeterminada: sin ella las provincias sin zona
      // no tendrían destino.
      const predeterminada = datos.predeterminada || !hayPredeterminada
      if (predeterminada && !datos.activa) {
        return { kind: "invalid", campo: "activa", error: "La sucursal predeterminada debe estar activa." }
      }

      await transferirMarcas(tx, tenantId, datos.slug, { predeterminada, maestra: datos.maestra })
      const [fila] = await tx
        .insert(sucursales)
        .values({ ...datos, predeterminada, tenantId })
        .returning()
      return { kind: "ok", sucursal: toSucursalDto(fila) }
    })
  } catch (err) {
    if (codigoPg(err) === "23505") return { kind: "conflict", campo: "slug", error: MSG_CONCURRENCIA }
    throw err
  }
}

export async function actualizarSucursal(tenantId: string, slug: string, body: unknown): Promise<ResultadoSucursal> {
  const v = validarSucursalCambios(body)
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  const cambios: CambiosSucursal = v.cambios

  try {
    return await getDb().transaction(async (tx): Promise<ResultadoSucursal> => {
      await bloquearTenant(tx, tenantId)

      const [actual] = await tx
        .select()
        .from(sucursales)
        .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.slug, slug)))
      if (!actual) return { kind: "not_found" }

      const seraPredeterminada = cambios.predeterminada ?? actual.predeterminada
      const seraActiva = cambios.activa ?? actual.activa
      if (actual.predeterminada && !seraPredeterminada) {
        return {
          kind: "invalid",
          campo: "predeterminada",
          error: "Debe haber una sucursal predeterminada. Marque otra como predeterminada para reemplazarla.",
        }
      }
      if (seraPredeterminada && !seraActiva) {
        return {
          kind: "invalid",
          campo: "activa",
          error: "La sucursal predeterminada no se puede desactivar. Marque otra como predeterminada primero.",
        }
      }

      await transferirMarcas(tx, tenantId, slug, {
        predeterminada: cambios.predeterminada,
        maestra: cambios.maestra,
      })
      const [fila] = await tx
        .update(sucursales)
        .set({ ...cambios, updatedAt: new Date() })
        .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.slug, slug)))
        .returning()
      return { kind: "ok", sucursal: toSucursalDto(fila) }
    })
  } catch (err) {
    if (codigoPg(err) === "23505") return { kind: "conflict", campo: "slug", error: MSG_CONCURRENCIA }
    throw err
  }
}

/**
 * ¿Algún pedido del Shop tiene esta sucursal? Consulta cruzada a `shop.orders.sucursal` (columna
 * que agrega la migración 0023 del Shop). Mientras esa migración no esté aplicada la columna no
 * existe y, por definición, ningún pedido puede usar el slug.
 */
async function pedidosUsanSucursal(tx: Tx, tenantId: string, slug: string): Promise<boolean> {
  const cols = await tx.execute(sql`
    select 1 from information_schema.columns
    where table_schema = 'shop' and table_name = 'orders' and column_name = 'sucursal'
  `)
  if (cols.length === 0) return false
  const filas = await tx.execute(sql`
    select 1 from shop.orders
    where tenant_id = ${tenantId} and (sucursal = ${slug})
    limit 1
  `)
  return filas.length > 0
}

export async function eliminarSucursal(tenantId: string, slug: string): Promise<ResultadoBorrado> {
  try {
    return await getDb().transaction(async (tx): Promise<ResultadoBorrado> => {
      await bloquearTenant(tx, tenantId)

      const [actual] = await tx
        .select()
        .from(sucursales)
        .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.slug, slug)))
      if (!actual) return { kind: "not_found" }
      if (actual.predeterminada) {
        return { kind: "conflict", error: "La sucursal predeterminada no se puede eliminar. Marque otra como predeterminada primero." }
      }

      const [zona] = await tx
        .select({ id: zonas.id })
        .from(zonas)
        .where(and(eq(zonas.tenantId, tenantId), sql`(${zonas.sucursal} = ${slug} or ${zonas.facturaSucursal} = ${slug})`))
        .limit(1)
      if (zona) {
        return { kind: "conflict", error: "Hay zonas que usan esta sucursal. Cámbielas antes de eliminarla." }
      }
      if (await pedidosUsanSucursal(tx, tenantId, slug)) {
        return { kind: "conflict", error: "Hay pedidos asignados a esta sucursal. Desactívela en lugar de eliminarla." }
      }

      await tx.delete(sucursales).where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.slug, slug)))
      return { kind: "ok" }
    })
  } catch (err) {
    // FK compuesta de zonas: una zona creada en paralelo la usa.
    if (codigoPg(err) === "23503") return { kind: "conflict", error: MSG_CONCURRENCIA }
    throw err
  }
}

/** Alta o cambio de la zona de una provincia (una fila por provincia y tenant). */
export async function guardarZona(tenantId: string, body: unknown): Promise<ResultadoZona> {
  const v = validarZona(body)
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  const datos = v.valor

  try {
    return await getDb().transaction(async (tx): Promise<ResultadoZona> => {
      await bloquearTenant(tx, tenantId)

      const slugs = [datos.sucursal, ...(datos.facturaSucursal ? [datos.facturaSucursal] : [])]
      const halladas = await tx
        .select({ slug: sucursales.slug })
        .from(sucursales)
        .where(and(eq(sucursales.tenantId, tenantId), inArray(sucursales.slug, slugs)))
      const existe = new Set(halladas.map((s) => s.slug))
      if (!existe.has(datos.sucursal)) return { kind: "invalid", campo: "sucursal", error: "Seleccione una sucursal." }
      if (datos.facturaSucursal && !existe.has(datos.facturaSucursal)) {
        return { kind: "invalid", campo: "facturaSucursal", error: "Seleccione una sucursal." }
      }

      const [fila] = await tx
        .insert(zonas)
        .values({ ...datos, tenantId })
        .onConflictDoUpdate({
          target: [zonas.tenantId, zonas.provinciaClave],
          set: {
            provincia: datos.provincia,
            sucursal: datos.sucursal,
            facturaSucursal: datos.facturaSucursal,
            updatedAt: new Date(),
          },
        })
        .returning()
      return { kind: "ok", zona: toZonaDto(fila) }
    })
  } catch (err) {
    if (codigoPg(err) === "23503") return { kind: "invalid", campo: "sucursal", error: "Seleccione una sucursal." }
    throw err
  }
}

export async function eliminarZona(tenantId: string, provinciaClave: string): Promise<ResultadoBorrado> {
  const borradas = await getDb()
    .delete(zonas)
    .where(and(eq(zonas.tenantId, tenantId), eq(zonas.provinciaClave, provinciaClave)))
    .returning({ id: zonas.id })
  return borradas.length > 0 ? { kind: "ok" } : { kind: "not_found" }
}
