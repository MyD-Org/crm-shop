import {
  exceptionsToNotes,
  normalizeExceptions,
  normalizeSchedule,
  type WeeklySchedule,
} from "@/lib/schedule"

// Armado puro del contrato de GET /api/internal/business-hours (change `horarios-por-sucursal`).
//
//   { notes, schedule, sucursales: [{ slug, nombre, ciudad, predeterminada, schedule, notes }] }
//
// Aditivo: `notes` y `schedule` (raíz) son el legado que ya consume la ai-api. Con sucursales
// activas salen de la predeterminada (o, si no hay, de la primera por orden); sin sucursales
// activas, de `tenants.*` (igual que antes). `sucursales` lista solo las activas. No se calcula
// "abierto ahora": lo resuelve la ai-api con su reloj.

export interface TenantHorarioFila {
  schedule: unknown
  scheduleExceptions: unknown
}

export interface SucursalHorarioFila {
  slug: string
  nombre: string
  ciudad: string
  predeterminada: boolean
  orden: number
  schedule: unknown
  scheduleExceptions: unknown
}

export interface SucursalBusinessHours {
  slug: string
  nombre: string
  ciudad: string
  predeterminada: boolean
  schedule: WeeklySchedule
  notes: string | null
}

export interface BusinessHours {
  notes: string | null
  schedule: WeeklySchedule
  sucursales: SucursalBusinessHours[]
}

/** `sucursalesActivas` ya viene filtrada por tenant y activa; acá se ordena por `orden` y nombre. */
export function armarBusinessHours(
  tenant: TenantHorarioFila | undefined,
  sucursalesActivas: SucursalHorarioFila[],
): BusinessHours {
  const ordenadas = [...sucursalesActivas].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
  const sucursales: SucursalBusinessHours[] = ordenadas.map((s) => ({
    slug: s.slug,
    nombre: s.nombre,
    ciudad: s.ciudad,
    predeterminada: s.predeterminada,
    schedule: normalizeSchedule(s.schedule),
    notes: exceptionsToNotes(normalizeExceptions(s.scheduleExceptions)),
  }))

  if (sucursales.length === 0) {
    return {
      notes: exceptionsToNotes(normalizeExceptions(tenant?.scheduleExceptions)),
      schedule: normalizeSchedule(tenant?.schedule),
      sucursales,
    }
  }
  const legado = sucursales.find((s) => s.predeterminada) ?? sucursales[0]
  return { notes: legado.notes, schedule: legado.schedule, sucursales }
}
