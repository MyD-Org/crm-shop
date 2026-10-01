import { describe, it, expect } from "vitest"
import { armarBusinessHours, type SucursalHorarioFila } from "./business-hours"
import { emptySchedule } from "./schedule"

// Horarios y nombres ficticios (el repo es público).
const semana = (open: string, close: string, dias: string[]) => {
  const s: Record<string, { open: string; close: string }[]> = { ...emptySchedule() }
  for (const d of dias) s[d] = [{ open, close }]
  return s
}

const TENANT = {
  schedule: semana("08:00", "20:00", ["monday", "tuesday"]),
  scheduleExceptions: [{ type: "closed", date: "2026-12-25", to: null, reason: "Navidad" }],
}

const norte: SucursalHorarioFila = {
  slug: "sede-norte",
  nombre: "Sede Norte",
  ciudad: "Ciudad Norte",
  predeterminada: true,
  orden: 0,
  schedule: semana("09:00", "18:00", ["monday", "tuesday", "wednesday", "thursday", "friday"]),
  scheduleExceptions: [],
}
const sur: SucursalHorarioFila = {
  slug: "sede-sur",
  nombre: "Sede Sur",
  ciudad: "Ciudad Sur",
  predeterminada: false,
  orden: 1,
  schedule: semana("10:00", "20:00", ["monday", "saturday"]),
  scheduleExceptions: [{ type: "closed", date: "2026-10-12", to: null, reason: "feriado" }],
}

describe("armarBusinessHours", () => {
  it("sin sucursales: legado = tenants.* y sucursales vacío", () => {
    const r = armarBusinessHours(TENANT, [])
    expect(r.sucursales).toEqual([])
    expect(r.schedule.monday).toEqual([{ open: "08:00", close: "20:00" }])
    expect(r.notes).toBe("Cerrado el 25/12/2026 (Navidad).")
  })

  it("tenant inexistente: respuesta vacía de hoy + sucursales []", () => {
    const r = armarBusinessHours(undefined, [])
    expect(r).toEqual({ notes: null, schedule: emptySchedule(), sucursales: [] })
  })

  it("dos sucursales: legado = la predeterminada y cada una con su schedule y notes", () => {
    const r = armarBusinessHours(TENANT, [sur, norte])
    expect(r.schedule.friday).toEqual([{ open: "09:00", close: "18:00" }])
    expect(r.schedule.saturday).toEqual([])
    expect(r.notes).toBeNull()
    expect(r.sucursales.map((s) => s.slug)).toEqual(["sede-norte", "sede-sur"])
    const [n, s] = r.sucursales
    expect(n).toMatchObject({ nombre: "Sede Norte", ciudad: "Ciudad Norte", predeterminada: true, notes: null })
    expect(s.schedule.saturday).toEqual([{ open: "10:00", close: "20:00" }])
    expect(s.notes).toBe("Cerrado el 12/10/2026 (feriado).")
  })

  it("predeterminada ausente: el legado sale de la primera por orden", () => {
    const r = armarBusinessHours(TENANT, [{ ...sur, orden: 1 }, { ...norte, predeterminada: false, orden: 0 }])
    expect(r.schedule.friday).toEqual([{ open: "09:00", close: "18:00" }])
  })

  it("no expone abierto_ahora y trae las 7 claves aunque el jsonb esté vacío", () => {
    const r = armarBusinessHours(TENANT, [{ ...norte, schedule: {}, scheduleExceptions: [] }])
    expect(JSON.stringify(r)).not.toContain("abierto_ahora")
    expect(Object.keys(r.sucursales[0].schedule)).toHaveLength(7)
    expect(r.sucursales[0].schedule.monday).toEqual([])
  })
})
