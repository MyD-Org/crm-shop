import { and, asc, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { modalidadesSinStock } from "@/db/schema"
import { esUuid } from "@/lib/catalogo-overlay-repo"
import {
  MSG_NOMBRE_DUPLICADO,
  validarModalidad,
  type FlujoSinStock,
  type ModalidadSinStock,
} from "@/lib/modalidades-sin-stock-validacion"

// Acceso a datos de las modalidades de venta sin stock. TODO filtra por `tenantId` (el del guard,
// nunca el del body).

type Fila = typeof modalidadesSinStock.$inferSelect

export type ResultadoModalidad =
  | { kind: "ok"; modalidad: ModalidadSinStock }
  | { kind: "invalid"; campo: string; error: string }
  | { kind: "not_found" }

const aDto = (r: Fila): ModalidadSinStock => ({
  id: r.id,
  nombre: r.nombre,
  texto: r.texto,
  plazoDias: r.plazoDias,
  flujo: r.flujo as FlujoSinStock,
  activa: r.activa,
})

const CONSTRAINT_NOMBRE = "modalidades_sin_stock_tenant_nombre_uniq"

/** drizzle envuelve el error del driver: el código y el constraint están en `.cause`. */
function esNombreDuplicado(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    const o = x as { code?: unknown; constraint_name?: unknown; constraint?: unknown }
    if (o.code === "23505") return (o.constraint_name ?? o.constraint) === CONSTRAINT_NOMBRE
  }
  return false
}

const duplicado = (): ResultadoModalidad => ({ kind: "invalid", campo: "nombre", error: MSG_NOMBRE_DUPLICADO })

export async function listarModalidades(tenantId: string): Promise<ModalidadSinStock[]> {
  const filas = await getDb()
    .select()
    .from(modalidadesSinStock)
    .where(eq(modalidadesSinStock.tenantId, tenantId))
    .orderBy(asc(modalidadesSinStock.nombre))
  return filas.map(aDto)
}

export async function crearModalidad(tenantId: string, body: unknown): Promise<ResultadoModalidad> {
  const v = validarModalidad(body)
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  try {
    const [fila] = await getDb().insert(modalidadesSinStock).values({ tenantId, ...v.modalidad }).returning()
    return { kind: "ok", modalidad: aDto(fila) }
  } catch (e) {
    if (esNombreDuplicado(e)) return duplicado()
    throw e
  }
}

export async function actualizarModalidad(tenantId: string, id: string, body: unknown): Promise<ResultadoModalidad> {
  if (!esUuid(id)) return { kind: "not_found" }
  const v = validarModalidad(body)
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  try {
    const [fila] = await getDb()
      .update(modalidadesSinStock)
      .set({ ...v.modalidad, updatedAt: new Date() })
      .where(and(eq(modalidadesSinStock.id, id), eq(modalidadesSinStock.tenantId, tenantId)))
      .returning()
    return fila ? { kind: "ok", modalidad: aDto(fila) } : { kind: "not_found" }
  } catch (e) {
    if (esNombreDuplicado(e)) return duplicado()
    throw e
  }
}

/** Borra la fila: el FK deja en NULL `catalog_overlay.modalidad_sin_stock_id`. */
export async function borrarModalidad(tenantId: string, id: string): Promise<{ kind: "ok" } | { kind: "not_found" }> {
  if (!esUuid(id)) return { kind: "not_found" }
  const filas = await getDb()
    .delete(modalidadesSinStock)
    .where(and(eq(modalidadesSinStock.id, id), eq(modalidadesSinStock.tenantId, tenantId)))
    .returning({ id: modalidadesSinStock.id })
  return filas.length ? { kind: "ok" } : { kind: "not_found" }
}

/** ¿La modalidad existe EN ESTE tenant? (la FK del overlay no mira el tenant; mismo rol que `categoriaPropia`). */
export async function modalidadPropia(tenantId: string, id: string): Promise<boolean> {
  if (!esUuid(id)) return false
  const [row] = await getDb()
    .select({ id: modalidadesSinStock.id })
    .from(modalidadesSinStock)
    .where(and(eq(modalidadesSinStock.id, id), eq(modalidadesSinStock.tenantId, tenantId)))
  return !!row
}
