import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  guarded: { ok: true, tenantId: "t1", user: { id: "u1", name: "N", email: "n@cliente.example", role: "operator", canalesPermitidos: null } } as Record<string, unknown>,
}))

vi.mock("@/lib/admin-session", () => ({
  getGuardedAdminSession: async () => state.guarded,
}))

import {
  configurarFlagCompras,
  requireAdminPlus,
  requireComprasAccess,
  requireOperatorPlus,
} from "./admin-route-guard"

function comoRol(role: string) {
  state.guarded = { ok: true, tenantId: "t1", user: { id: "u1", name: "N", email: "n@cliente.example", role, canalesPermitidos: null } }
}
const req = new Request("http://localhost/api/admin/compras")

describe("requireComprasAccess", () => {
  beforeEach(() => {
    configurarFlagCompras(async () => true)
  })

  it("compras y admin/superadmin pasan", async () => {
    for (const role of ["compras", "admin", "superadmin"]) {
      comoRol(role)
      const r = await requireComprasAccess(req)
      expect(r.ok, role).toBe(true)
    }
  })

  it("operator -> 404 uniforme; rol desconocido -> 404", async () => {
    for (const role of ["operator", "viewer", ""]) {
      comoRol(role)
      const r = await requireComprasAccess(req)
      expect(r.ok, role).toBe(false)
      if (!r.ok) {
        expect(r.response.status).toBe(404)
        expect(await r.response.json()).toEqual({ error: "No encontrado", code: "not_found" })
      }
    }
  })

  it("sin sesión -> 401", async () => {
    state.guarded = { ok: false, reason: "no-session" }
    const r = await requireComprasAccess(req)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(401)
  })

  it("flag apagado -> 404 incluso para admin", async () => {
    configurarFlagCompras(async () => false)
    comoRol("admin")
    const r = await requireComprasAccess(req)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(404)
  })
})

describe("el rol «compras» NO pasa los demás guards", () => {
  it("requireAdminPlus y requireOperatorPlus lo rechazan con 404", async () => {
    comoRol("compras")
    for (const guard of [requireAdminPlus, requireOperatorPlus]) {
      const r = await guard(req)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.response.status).toBe(404)
    }
  })
})
