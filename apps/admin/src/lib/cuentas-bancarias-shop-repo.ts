import { and, asc, eq, ne, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { cuentasBancariasShop } from "@/db/schema"
import { validarCuentaBancaria, type CuentaBancariaValida } from "@/lib/cuentas-bancarias-shop-validacion"
import { sonSlugsDeSucursal } from "@/lib/sucursales-repo"

// Acceso a datos de las cuentas bancarias del Shop (change `pago-transferencia-comprobante`,
// rebanada A). TODO filtra por `tenantId` (el del guard, nunca el del body). Los errores viajan en
// usted. La predeterminada es única por tenant: marcarla desmarca la anterior en la MISMA
// transacción (con un lock por tenant); el índice único parcial es la red de seguridad.

type Fila = typeof cuentasBancariasShop.$inferSelect

export interface CuentaBancariaDto {
  id: string
  alias: string
  cbu: string
  banco: string
  titular: string
  cuit: string
  todasLasSucursales: boolean
  sucursalSlugs: string[]
  montoMin: number | null
  montoMax: number | null
  activa: boolean
  predeterminada: boolean
  orden: number
}

const aNumero = (v: string | null): number | null => (v === null ? null : Number(v))
const aTexto = (v: number | null): string | null => (v === null ? null : v.toFixed(2))

export const toCuentaDto = (r: Fila): CuentaBancariaDto => ({
  id: r.id,
  alias: r.alias,
  cbu: r.cbu,
  banco: r.banco,
  titular: r.titular,
  cuit: r.cuit,
  todasLasSucursales: r.todasLasSucursales,
  sucursalSlugs: r.sucursalSlugs,
  montoMin: aNumero(r.montoMin),
  montoMax: aNumero(r.montoMax),
  activa: r.activa,
  predeterminada: r.predeterminada,
  orden: r.orden,
})

export type ResultadoCuenta =
  | { kind: "ok"; cuenta: CuentaBancariaDto }
  | { kind: "invalid"; campo: string; error: string }
  | { kind: "conflict"; campo: string; error: string }
  | { kind: "not_found" }

export type ResultadoBorradoCuenta = { kind: "ok" } | { kind: "not_found" }

const MSG_CBU_REPETIDO = "Ya existe una cuenta con ese CBU."
const MSG_SLUG_INEXISTENTE = "Alguna de las sucursales indicadas no existe. Recargue la página e inténtelo nuevamente."
const MSG_CONCURRENCIA = "Otro usuario modificó las cuentas al mismo tiempo. Inténtelo nuevamente."

function errorPg(err: unknown): { code?: string; constraint?: string } {
  for (let e: unknown = err, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === "string") {
      const c = (e as { constraint_name?: unknown; constraint?: unknown })
      const constraint = typeof c.constraint_name === "string" ? c.constraint_name : typeof c.constraint === "string" ? c.constraint : undefined
      return { code, constraint }
    }
  }
  return {}
}

function conflictoDe(err: unknown): ResultadoCuenta | null {
  const { code, constraint } = errorPg(err)
  if (code !== "23505") return null
  if (constraint === "cuentas_bancarias_shop_predeterminada_uniq") {
    return { kind: "conflict", campo: "predeterminada", error: MSG_CONCURRENCIA }
  }
  return { kind: "conflict", campo: "cbu", error: MSG_CBU_REPETIDO }
}

export async function listarCuentas(tenantId: string): Promise<CuentaBancariaDto[]> {
  const filas = await getDb()
    .select()
    .from(cuentasBancariasShop)
    .where(eq(cuentasBancariasShop.tenantId, tenantId))
    .orderBy(asc(cuentasBancariasShop.orden), asc(cuentasBancariasShop.alias))
  return filas.map(toCuentaDto)
}

const valores = (v: CuentaBancariaValida) => ({
  alias: v.alias,
  cbu: v.cbu,
  banco: v.banco,
  titular: v.titular,
  cuit: v.cuit,
  todasLasSucursales: v.todasLasSucursales,
  sucursalSlugs: v.sucursalSlugs,
  montoMin: aTexto(v.montoMin),
  montoMax: aTexto(v.montoMax),
  activa: v.activa,
  predeterminada: v.predeterminada,
  orden: v.orden,
})

async function bloquearTenant(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], tenantId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cuentas-bancarias-shop:${tenantId}`}))`)
}

/** Slugs que no son sucursales de ESTE tenant (activas o dadas de baja): se rechazan al guardar. */
async function slugsValidos(tenantId: string, v: CuentaBancariaValida): Promise<boolean> {
  return v.todasLasSucursales || (await sonSlugsDeSucursal(tenantId, v.sucursalSlugs))
}

export async function crearCuenta(tenantId: string, body: unknown): Promise<ResultadoCuenta> {
  const v = validarCuentaBancaria(body)
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  if (!(await slugsValidos(tenantId, v.valor))) {
    return { kind: "invalid", campo: "sucursalSlugs", error: MSG_SLUG_INEXISTENTE }
  }
  try {
    return await getDb().transaction(async (tx): Promise<ResultadoCuenta> => {
      await bloquearTenant(tx, tenantId)
      if (v.valor.predeterminada) {
        await tx
          .update(cuentasBancariasShop)
          .set({ predeterminada: false, updatedAt: new Date() })
          .where(and(eq(cuentasBancariasShop.tenantId, tenantId), eq(cuentasBancariasShop.predeterminada, true)))
      }
      const [fila] = await tx
        .insert(cuentasBancariasShop)
        .values({ ...valores(v.valor), tenantId })
        .returning()
      return { kind: "ok", cuenta: toCuentaDto(fila) }
    })
  } catch (err) {
    const c = conflictoDe(err)
    if (c) return c
    throw err
  }
}

/** Cambios parciales: se fusionan con la cuenta actual y se valida la cuenta completa. */
export async function actualizarCuenta(tenantId: string, id: string, body: unknown): Promise<ResultadoCuenta> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { kind: "invalid", campo: "body", error: "Los datos indicados no son válidos." }
  }
  const cambios = body as Record<string, unknown>
  try {
    return await getDb().transaction(async (tx): Promise<ResultadoCuenta> => {
      await bloquearTenant(tx, tenantId)
      const [actual] = await tx
        .select()
        .from(cuentasBancariasShop)
        .where(and(eq(cuentasBancariasShop.tenantId, tenantId), eq(cuentasBancariasShop.id, id)))
        .for("update")
      if (!actual) return { kind: "not_found" }

      const v = validarCuentaBancaria({ ...toCuentaDto(actual), ...cambios })
      if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
      if (!(await slugsValidos(tenantId, v.valor))) {
        return { kind: "invalid", campo: "sucursalSlugs", error: MSG_SLUG_INEXISTENTE }
      }

      if (v.valor.predeterminada && !actual.predeterminada) {
        await tx
          .update(cuentasBancariasShop)
          .set({ predeterminada: false, updatedAt: new Date() })
          .where(
            and(
              eq(cuentasBancariasShop.tenantId, tenantId),
              eq(cuentasBancariasShop.predeterminada, true),
              ne(cuentasBancariasShop.id, id),
            ),
          )
      }
      const [fila] = await tx
        .update(cuentasBancariasShop)
        .set({ ...valores(v.valor), updatedAt: new Date() })
        .where(and(eq(cuentasBancariasShop.tenantId, tenantId), eq(cuentasBancariasShop.id, id)))
        .returning()
      return { kind: "ok", cuenta: toCuentaDto(fila) }
    })
  } catch (err) {
    const c = conflictoDe(err)
    if (c) return c
    throw err
  }
}

/** Los pedidos congelan una copia de la cuenta (snapshot), así que borrarla no rompe el historial. */
export async function eliminarCuenta(tenantId: string, id: string): Promise<ResultadoBorradoCuenta> {
  const borradas = await getDb()
    .delete(cuentasBancariasShop)
    .where(and(eq(cuentasBancariasShop.tenantId, tenantId), eq(cuentasBancariasShop.id, id)))
    .returning({ id: cuentasBancariasShop.id })
  return borradas.length > 0 ? { kind: "ok" } : { kind: "not_found" }
}
