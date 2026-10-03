import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { getDb } from "@/db"
import { correoCasillaAccesos } from "@/db/schema"
import { casillasAccesibles, requireCasilla } from "@/lib/correo-acceso"
import {
  accesosDelTenant,
  actualizarCasilla,
  casillaDelTenant,
  reemplazarAccesos,
  upsertCasilla,
  usuariosParaAcceso,
} from "@/lib/correo-repo"
import { seedOperator, seedTenant, truncateAll } from "./helpers"

/**
 * Accesos y alta de casillas (change `correo-en-crm`, R3) contra la base real de test. Datos
 * inventados: dominios `.example`.
 */

const A = "tenant-a"
const B = "tenant-b"

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
})
afterAll(async () => {
  await truncateAll()
})

async function casilla(tenant: string, inbox: string, over: { nombre?: string; activa?: boolean } = {}) {
  const c = await upsertCasilla(tenant, { resendInboxId: inbox, email: `${inbox}@cliente.example`, ...over })
  return c!
}

describe("casillasAccesibles", () => {
  it("el operador solo ve las de su lista y activas; el admin y el superadmin ven todas las activas", async () => {
    const ventas = await casilla(A, "ventas", { nombre: "Ventas" })
    const soporte = await casilla(A, "soporte", { nombre: "Soporte" })
    const vieja = await casilla(A, "vieja", { activa: false })
    const ana = await seedOperator(A, { name: "Ana" })
    const admin = await seedOperator(A, { role: "admin" })
    const root = await seedOperator(A, { role: "superadmin" })
    await reemplazarAccesos(A, ventas.id, [ana])
    await reemplazarAccesos(A, vieja.id, [ana])

    const deAna = await casillasAccesibles(A, { id: ana, role: "operator" })
    expect(deAna.map((c) => c.id)).toEqual([ventas.id])
    for (const [id, role] of [
      [admin, "admin"],
      [root, "superadmin"],
    ] as const) {
      const todas = await casillasAccesibles(A, { id, role })
      expect(todas.map((c) => c.id).sort()).toEqual([ventas.id, soporte.id].sort())
    }
  })

  it("una casilla de otro tenant nunca es accesible, ni para un admin", async () => {
    const ajena = await casilla(B, "ajena")
    const admin = await seedOperator(A, { role: "admin" })
    expect(await casillasAccesibles(A, { id: admin, role: "admin" })).toEqual([])
    const r = await requireCasilla(A, { id: admin, role: "admin" }, ajena.id)
    expect(r.ok).toBe(false)
  })

  it("requireCasilla: sin acceso responde 404 idéntico al de una casilla inexistente", async () => {
    const ventas = await casilla(A, "ventas")
    const beto = await seedOperator(A, { name: "Beto" })
    const sinAcceso = await requireCasilla(A, { id: beto, role: "operator" }, ventas.id)
    const inexistente = await requireCasilla(A, { id: beto, role: "operator" }, "00000000-0000-4000-8000-000000000000")
    expect(sinAcceso.ok).toBe(false)
    expect(inexistente.ok).toBe(false)
    if (sinAcceso.ok || inexistente.ok) throw new Error("no debía autorizar")
    expect(sinAcceso.response.status).toBe(404)
    expect(await sinAcceso.response.text()).toBe(await inexistente.response.text())
  })

  it("revocar el acceso deja de autorizar al operador en el acto", async () => {
    const ventas = await casilla(A, "ventas")
    const ana = await seedOperator(A)
    await reemplazarAccesos(A, ventas.id, [ana])
    expect((await requireCasilla(A, { id: ana, role: "operator" }, ventas.id)).ok).toBe(true)
    await reemplazarAccesos(A, ventas.id, [])
    expect((await requireCasilla(A, { id: ana, role: "operator" }, ventas.id)).ok).toBe(false)
  })
})

describe("reemplazarAccesos", () => {
  it("reemplaza el conjunto completo y es idempotente", async () => {
    const ventas = await casilla(A, "ventas")
    const [ana, beto, carla] = [await seedOperator(A), await seedOperator(A), await seedOperator(A)]
    expect(await reemplazarAccesos(A, ventas.id, [ana, beto])).toEqual({ ok: true })
    expect(await reemplazarAccesos(A, ventas.id, [beto, carla, beto])).toEqual({ ok: true })
    const filas = await getDb().select().from(correoCasillaAccesos)
    expect(filas.map((f) => f.adminUserId).sort()).toEqual([beto, carla].sort())
  })

  it("rechaza ids de otro tenant o inexistentes y no modifica nada", async () => {
    const ventas = await casilla(A, "ventas")
    const ana = await seedOperator(A)
    const ajeno = await seedOperator(B)
    await reemplazarAccesos(A, ventas.id, [ana])
    const r = await reemplazarAccesos(A, ventas.id, [ajeno])
    expect(r).toEqual({ ok: false, invalidos: [ajeno] })
    expect((await accesosDelTenant(A)).map((f) => f.adminUserId)).toEqual([ana])
  })

  it("no escribe en una casilla de otro tenant", async () => {
    const ajena = await casilla(B, "ajena")
    const ana = await seedOperator(A)
    const r = await reemplazarAccesos(A, ajena.id, [ana])
    expect(r.ok).toBe(false)
    expect(await getDb().select().from(correoCasillaAccesos)).toHaveLength(0)
  })
})

describe("usuariosParaAcceso y actualizarCasilla", () => {
  it("lista solo operadores del tenant (admins ya ven todo)", async () => {
    await seedOperator(A, { name: "Ana" })
    await seedOperator(A, { name: "Admin", role: "admin" })
    await seedOperator(B, { name: "Ajeno" })
    const u = await usuariosParaAcceso(A)
    expect(u.map((x) => x.name)).toEqual(["Ana"])
  })

  it("actualiza nombre/activa del tenant y no toca otro tenant", async () => {
    const ventas = await casilla(A, "ventas")
    const ajena = await casilla(B, "ajena")
    const ok = await actualizarCasilla(A, ventas.id, { nombre: "Ventas", activa: false })
    expect(ok).toMatchObject({ nombre: "Ventas", activa: false })
    expect(await actualizarCasilla(A, ajena.id, { nombre: "x" })).toBeNull()
    expect((await casillaDelTenant(B, ajena.id))?.nombre).toBe("ajena@cliente.example")
  })
})
