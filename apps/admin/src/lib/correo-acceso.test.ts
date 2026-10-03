import { describe, expect, it, vi } from "vitest"

// Unit de la autorización por casilla con el repo stub (el SQL real lo cubre test/integration).

const repo = vi.hoisted(() => ({
  listarCasillas: vi.fn(),
  casillasDeUsuario: vi.fn(),
}))
vi.mock("@/lib/correo-repo", () => repo)

import { casillasAccesibles, requireCasilla } from "./correo-acceso"

const ID = "11111111-1111-4111-8111-111111111111"
const casilla = { id: ID, tenantId: "t", nombre: "Ventas", activa: true }

describe("casillasAccesibles", () => {
  it("admin y superadmin: todas las activas del tenant, sin mirar accesos", async () => {
    repo.listarCasillas.mockResolvedValue([casilla])
    for (const role of ["admin", "superadmin"]) {
      expect(await casillasAccesibles("t", { id: "u", role })).toEqual([casilla])
    }
    expect(repo.listarCasillas).toHaveBeenCalledWith("t", { soloActivas: true })
    expect(repo.casillasDeUsuario).not.toHaveBeenCalled()
  })

  it("operador y rol desconocido: solo las de su lista", async () => {
    repo.casillasDeUsuario.mockResolvedValue([casilla])
    expect(await casillasAccesibles("t", { id: "u", role: "operator" })).toEqual([casilla])
    expect(repo.casillasDeUsuario).toHaveBeenCalledWith("t", "u")
    repo.casillasDeUsuario.mockClear()
    await casillasAccesibles("t", { id: "u", role: "raro" })
    expect(repo.casillasDeUsuario).toHaveBeenCalled()
  })
})

describe("requireCasilla", () => {
  it("id con formato inválido: 404 sin consultar la base", async () => {
    repo.listarCasillas.mockClear()
    repo.casillasDeUsuario.mockClear()
    const r = await requireCasilla("t", { id: "u", role: "admin" }, "no-es-uuid")
    expect(r.ok).toBe(false)
    expect(repo.listarCasillas).not.toHaveBeenCalled()
  })

  it("autoriza si la casilla está entre las accesibles", async () => {
    repo.casillasDeUsuario.mockResolvedValue([casilla])
    const r = await requireCasilla("t", { id: "u", role: "operator" }, ID)
    expect(r).toEqual({ ok: true, casilla })
  })

  it("si no está entre las accesibles: 404 con el cuerpo de adminNotFoundResponse", async () => {
    repo.casillasDeUsuario.mockResolvedValue([])
    const r = await requireCasilla("t", { id: "u", role: "operator" }, ID)
    if (r.ok) throw new Error("no debía autorizar")
    expect(r.response.status).toBe(404)
    expect(await r.response.json()).toEqual({ error: "No encontrado", code: "not_found" })
  })
})
