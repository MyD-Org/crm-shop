import { and, asc, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { mediosPagoShop } from "@/db/schema"
import {
  MSG_SIN_ENTREGA,
  validarMedioPagoCambios,
  validarMedioPagoNuevo,
  type CambiosMedioPago,
} from "@/lib/medios-pago-shop-validacion"

// Acceso a datos de los medios de pago del checkout (change `sucursales-igz-mdp`, rebanada C).
// TODO filtra por `tenantId` (el del guard, nunca el del body). El slug es inmutable: lo guarda
// `shop.orders.pago_metodo` como texto sin FK, así que un medio usado por algún pedido se
// desactiva, no se borra. Los errores viajan en usted.

type Fila = typeof mediosPagoShop.$inferSelect
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]

export interface MedioPagoDto {
  slug: string
  nombre: string
  instrucciones: string
  activo: boolean
  aplicaRetiro: boolean
  aplicaEnvio: boolean
  cobroOnline: boolean
  orden: number
}

export const toMedioPagoDto = (r: Fila): MedioPagoDto => ({
  slug: r.slug,
  nombre: r.nombre,
  instrucciones: r.instrucciones,
  activo: r.activo,
  aplicaRetiro: r.aplicaRetiro,
  aplicaEnvio: r.aplicaEnvio,
  cobroOnline: r.cobroOnline,
  orden: r.orden,
})

export type ResultadoMedio =
  | { kind: "ok"; medio: MedioPagoDto }
  | { kind: "invalid"; campo: string; error: string }
  | { kind: "conflict"; campo: string; error: string }
  | { kind: "not_found" }

export type ResultadoBorradoMedio = { kind: "ok" } | { kind: "conflict"; error: string } | { kind: "not_found" }

function codigoPg(err: unknown): string | undefined {
  for (let e: unknown = err, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === "string") return code
  }
  return undefined
}

export async function listarMediosPago(tenantId: string): Promise<MedioPagoDto[]> {
  const filas = await getDb()
    .select()
    .from(mediosPagoShop)
    .where(eq(mediosPagoShop.tenantId, tenantId))
    .orderBy(asc(mediosPagoShop.orden), asc(mediosPagoShop.nombre))
  return filas.map(toMedioPagoDto)
}

/** `slug -> nombre` de los medios del tenant (activos o no), para mostrar el elegido en un pedido. */
export async function nombresMediosPago(tenantId: string): Promise<Record<string, string>> {
  const filas = await getDb()
    .select({ slug: mediosPagoShop.slug, nombre: mediosPagoShop.nombre })
    .from(mediosPagoShop)
    .where(eq(mediosPagoShop.tenantId, tenantId))
  return Object.fromEntries(filas.map((f) => [f.slug, f.nombre]))
}

export async function crearMedioPago(tenantId: string, body: unknown): Promise<ResultadoMedio> {
  const v = validarMedioPagoNuevo(body)
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  try {
    const [fila] = await getDb()
      .insert(mediosPagoShop)
      .values({ ...v.valor, tenantId })
      .returning()
    return { kind: "ok", medio: toMedioPagoDto(fila) }
  } catch (err) {
    if (codigoPg(err) === "23505") {
      return { kind: "conflict", campo: "slug", error: "Ya existe un medio de pago con ese identificador." }
    }
    throw err
  }
}

export async function actualizarMedioPago(tenantId: string, slug: string, body: unknown): Promise<ResultadoMedio> {
  const v = validarMedioPagoCambios(body)
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  const cambios: CambiosMedioPago = v.cambios

  return getDb().transaction(async (tx): Promise<ResultadoMedio> => {
    const [actual] = await tx
      .select()
      .from(mediosPagoShop)
      .where(and(eq(mediosPagoShop.tenantId, tenantId), eq(mediosPagoShop.slug, slug)))
      .for("update")
    if (!actual) return { kind: "not_found" }

    const retiro = cambios.aplicaRetiro ?? actual.aplicaRetiro
    const envio = cambios.aplicaEnvio ?? actual.aplicaEnvio
    if (!retiro && !envio) return { kind: "invalid", campo: "aplicaRetiro", error: MSG_SIN_ENTREGA }

    const [fila] = await tx
      .update(mediosPagoShop)
      .set({ ...cambios, updatedAt: new Date() })
      .where(and(eq(mediosPagoShop.tenantId, tenantId), eq(mediosPagoShop.slug, slug)))
      .returning()
    return { kind: "ok", medio: toMedioPagoDto(fila) }
  })
}

/**
 * ¿Algún pedido del Shop eligió este medio? Consulta cruzada a `shop.orders.pago_metodo`.
 * Si el esquema `shop` no existe todavía (entorno sin Shop), ningún pedido puede usarlo.
 */
async function pedidosUsanMedio(tx: Tx, tenantId: string, slug: string): Promise<boolean> {
  const cols = await tx.execute(sql`
    select 1 from information_schema.columns
    where table_schema = 'shop' and table_name = 'orders' and column_name = 'pago_metodo'
  `)
  if (cols.length === 0) return false
  const filas = await tx.execute(sql`
    select 1 from shop.orders where tenant_id = ${tenantId} and pago_metodo = ${slug} limit 1
  `)
  return filas.length > 0
}

export async function eliminarMedioPago(tenantId: string, slug: string): Promise<ResultadoBorradoMedio> {
  return getDb().transaction(async (tx): Promise<ResultadoBorradoMedio> => {
    const [actual] = await tx
      .select({ slug: mediosPagoShop.slug })
      .from(mediosPagoShop)
      .where(and(eq(mediosPagoShop.tenantId, tenantId), eq(mediosPagoShop.slug, slug)))
      .for("update")
    if (!actual) return { kind: "not_found" }
    if (await pedidosUsanMedio(tx, tenantId, slug)) {
      return { kind: "conflict", error: "Hay pedidos que eligieron este medio de pago. Desactívelo en lugar de eliminarlo." }
    }
    await tx.delete(mediosPagoShop).where(and(eq(mediosPagoShop.tenantId, tenantId), eq(mediosPagoShop.slug, slug)))
    return { kind: "ok" }
  })
}
