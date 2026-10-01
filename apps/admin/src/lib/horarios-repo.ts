import { and, asc, eq, inArray, ne, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { sucursales, tenants } from "@/db/schema"
import {
  normalizeExceptions,
  normalizeSchedule,
  type ScheduleException,
  type WeeklySchedule,
} from "@/lib/schedule"

// Acceso a datos de Horarios (change `horarios-por-sucursal`, rebanada A). El horario vive en
// `tenants` (empresa sin sucursales) o en `sucursales` (una fila por sucursal, 0051). TODO filtra
// por `tenantId` (el de la sesión, nunca el del body): un slug de otro tenant se comporta igual
// que uno inexistente (not_found). Los errores viajan en usted.
//
// Copiar: lee lo PERSISTIDO de la sucursal de origen y SOBRESCRIBE (no mezcla) en los destinos,
// todo en una transacción con el mismo lock por tenant que usa `sucursales-repo` (serializa las
// escrituras de configuración de sucursales).

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]

export interface HorarioDto {
  schedule: WeeklySchedule
  exceptions: ScheduleException[]
}

export interface SucursalHorarioItem {
  slug: string
  nombre: string
  ciudad: string
  predeterminada: boolean
}

export type QueCopiar = "excepciones" | "horario" | "todo"
export const QUE_COPIAR: readonly QueCopiar[] = ["excepciones", "horario", "todo"]

export type ResultadoHorario = ({ kind: "ok" } & HorarioDto) | { kind: "not_found" }

export type ResultadoCopia =
  | { kind: "ok"; destinos: string[] }
  | { kind: "invalid"; error: string }
  | { kind: "not_found" }

export const MSG_SUCURSAL_NO_EXISTE = "La sucursal indicada no existe."

async function bloquearTenant(tx: Tx, tenantId: string): Promise<void> {
  // Misma clave que sucursales-repo: serializa toda escritura de configuración de sucursales.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sucursales:${tenantId}`}))`)
}

/** Sucursales ACTIVAS del tenant para el selector, ordenadas por `orden` y nombre. */
export async function listarSucursalesActivas(tenantId: string): Promise<SucursalHorarioItem[]> {
  return getDb()
    .select({
      slug: sucursales.slug,
      nombre: sucursales.nombre,
      ciudad: sucursales.ciudad,
      predeterminada: sucursales.predeterminada,
    })
    .from(sucursales)
    .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.activa, true)))
    .orderBy(asc(sucursales.orden), asc(sucursales.nombre))
}

/** `slug` null = horario de la empresa (`tenants`). */
export async function leerHorario(tenantId: string, slug: string | null): Promise<ResultadoHorario> {
  const db = getDb()
  if (slug === null) {
    const [t] = await db
      .select({ schedule: tenants.schedule, scheduleExceptions: tenants.scheduleExceptions })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
    return {
      kind: "ok",
      schedule: normalizeSchedule(t?.schedule),
      exceptions: normalizeExceptions(t?.scheduleExceptions),
    }
  }
  const [s] = await db
    .select({ schedule: sucursales.schedule, scheduleExceptions: sucursales.scheduleExceptions })
    .from(sucursales)
    .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.slug, slug)))
  if (!s) return { kind: "not_found" }
  return {
    kind: "ok",
    schedule: normalizeSchedule(s.schedule),
    exceptions: normalizeExceptions(s.scheduleExceptions),
  }
}

/** Persiste lo YA validado (parseSchedule/parseExceptions). `slug` null = empresa. */
export async function guardarHorario(
  tenantId: string,
  slug: string | null,
  datos: HorarioDto,
): Promise<{ kind: "ok" } | { kind: "not_found" }> {
  const db = getDb()
  if (slug === null) {
    await db
      .update(tenants)
      .set({ schedule: datos.schedule, scheduleExceptions: datos.exceptions, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
    return { kind: "ok" }
  }
  const filas = await db
    .update(sucursales)
    .set({ schedule: datos.schedule, scheduleExceptions: datos.exceptions, updatedAt: new Date() })
    .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.slug, slug)))
    .returning({ id: sucursales.id })
  return filas.length > 0 ? { kind: "ok" } : { kind: "not_found" }
}

export async function copiarHorario(
  tenantId: string,
  entrada: { desde: string; hacia: string[] | "todas"; que: QueCopiar },
): Promise<ResultadoCopia> {
  return getDb().transaction(async (tx): Promise<ResultadoCopia> => {
    await bloquearTenant(tx, tenantId)

    const [origen] = await tx
      .select({ schedule: sucursales.schedule, scheduleExceptions: sucursales.scheduleExceptions })
      .from(sucursales)
      .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.slug, entrada.desde)))
    if (!origen) return { kind: "not_found" }

    let destinos: string[]
    if (entrada.hacia === "todas") {
      const filas = await tx
        .select({ slug: sucursales.slug })
        .from(sucursales)
        .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.activa, true), ne(sucursales.slug, entrada.desde)))
      destinos = filas.map((f) => f.slug)
      if (destinos.length === 0) return { kind: "invalid", error: "No hay otras sucursales activas para copiar." }
    } else {
      destinos = [...new Set(entrada.hacia)]
      if (destinos.length === 0) return { kind: "invalid", error: "Seleccione al menos una sucursal de destino." }
      if (destinos.includes(entrada.desde)) {
        return { kind: "invalid", error: "La sucursal de origen no puede ser también destino." }
      }
      const halladas = await tx
        .select({ slug: sucursales.slug })
        .from(sucursales)
        .where(and(eq(sucursales.tenantId, tenantId), inArray(sucursales.slug, destinos)))
      // Un destino ajeno o inexistente corta TODO: no se escribe nada.
      if (halladas.length !== destinos.length) return { kind: "not_found" }
    }

    const cambios: { schedule?: WeeklySchedule; scheduleExceptions?: ScheduleException[]; updatedAt: Date } = {
      updatedAt: new Date(),
    }
    if (entrada.que === "horario" || entrada.que === "todo") cambios.schedule = normalizeSchedule(origen.schedule)
    if (entrada.que === "excepciones" || entrada.que === "todo") {
      cambios.scheduleExceptions = normalizeExceptions(origen.scheduleExceptions)
    }

    await tx
      .update(sucursales)
      .set(cambios)
      .where(and(eq(sucursales.tenantId, tenantId), inArray(sucursales.slug, destinos)))
    return { kind: "ok", destinos }
  })
}
