import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { reglasVenta } from "@/db/schema"
import {
  REGLAS_VENTA_DEFAULT,
  validarReglasVenta,
  type Invalido,
  type ReglasVenta,
  type RetiroSinStock,
} from "@/lib/reglas-venta-validacion"
import {
  ENVIO_DEFAULT,
  validarEnvio,
  type AlcanceEnvio,
  type ConfigEnvio,
  type Invalido as InvalidoEnvio,
  type ModoMinimoEnvio,
} from "@/lib/envios-validacion"

// Acceso a datos de las reglas de venta (change `sucursales-igz-mdp`, rebanada B). Una fila por
// tenant; si falta (tenant nuevo) se devuelven los defaults y el primer guardado la crea. TODO
// filtra por `tenantId` (el del guard, nunca el del body).

type Fila = typeof reglasVenta.$inferSelect

export const toReglasDto = (r: Fila): ReglasVenta => ({
  respaldoEnvio: r.respaldoEnvio,
  retiroSinStock: r.retiroSinStock as RetiroSinStock,
  trasladoDias: r.trasladoDias,
  reservaDias: r.reservaDias,
  avisoSinContactarHoras: r.avisoSinContactarHoras,
  contactoHorasHabiles: r.contactoHorasHabiles,
  mensajeConfirmacion: r.mensajeConfirmacion,
})

export async function leerReglasVenta(tenantId: string): Promise<ReglasVenta> {
  const [fila] = await getDb().select().from(reglasVenta).where(eq(reglasVenta.tenantId, tenantId))
  return fila ? toReglasDto(fila) : { ...REGLAS_VENTA_DEFAULT }
}

export type ResultadoReglas = { kind: "ok"; reglas: ReglasVenta } | ({ kind: "invalid" } & Omit<Invalido, "ok">)

/** Upsert parcial: lo que no viene queda como estaba (o en el default si la fila no existía). */
export async function guardarReglasVenta(tenantId: string, body: unknown): Promise<ResultadoReglas> {
  const v = validarReglasVenta(body)
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  const [fila] = await getDb()
    .insert(reglasVenta)
    .values({ tenantId, ...v.cambios })
    .onConflictDoUpdate({ target: reglasVenta.tenantId, set: { ...v.cambios, updatedAt: new Date() } })
    .returning()
  return { kind: "ok", reglas: toReglasDto(fila) }
}

// Envío configurable (change `envio-gratis-configurable`, rebanada A). Vive en la MISMA fila que
// las reglas de venta pero con lectura y guardado propios: guardar el envío no toca las otras
// reglas y viceversa (el upsert parcial sólo nombra sus columnas).

export const toEnvioDto = (r: Fila): ConfigEnvio => ({
  domicilioActivo: r.envioDomicilioActivo,
  gratisActivo: r.envioGratisActivo,
  alcance: r.envioGratisAlcance as AlcanceEnvio | null,
  provincias: r.envioGratisProvincias,
  minimoModo: r.envioGratisMinimoModo as ModoMinimoEnvio | null,
  minimo: r.envioGratisMinimo === null ? null : Number(r.envioGratisMinimo),
})

export async function leerEnvio(tenantId: string): Promise<ConfigEnvio> {
  const [fila] = await getDb().select().from(reglasVenta).where(eq(reglasVenta.tenantId, tenantId))
  return fila ? toEnvioDto(fila) : { ...ENVIO_DEFAULT, provincias: [] }
}

export type ResultadoEnvio = { kind: "ok"; envio: ConfigEnvio } | ({ kind: "invalid" } & Omit<InvalidoEnvio, "ok">)

/** Upsert de la configuración de envío: no pisa las demás reglas de la fila. */
export async function guardarEnvio(tenantId: string, body: unknown): Promise<ResultadoEnvio> {
  const v = validarEnvio(body)
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  const e = v.envio
  const columnas = {
    envioDomicilioActivo: e.domicilioActivo,
    envioGratisActivo: e.gratisActivo,
    envioGratisAlcance: e.alcance,
    envioGratisProvincias: e.provincias,
    envioGratisMinimoModo: e.minimoModo,
    envioGratisMinimo: e.minimo === null ? null : e.minimo.toFixed(2),
  }
  const [fila] = await getDb()
    .insert(reglasVenta)
    .values({ tenantId, ...columnas })
    .onConflictDoUpdate({ target: reglasVenta.tenantId, set: { ...columnas, updatedAt: new Date() } })
    .returning()
  return { kind: "ok", envio: toEnvioDto(fila) }
}
