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
