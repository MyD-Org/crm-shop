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
  requireSeccion,
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

describe("requireSeccion (permisos-por-seccion)", () => {
  const NOT_FOUND = { error: "No encontrado", code: "not_found" }
  function como(role: string, seccionesPermitidas: string[] | null = null) {
    state.guarded = {
      ok: true,
      tenantId: "t1",
      user: { id: "u1", name: "N", email: "n@cliente.example", role, canalesPermitidos: null, seccionesPermitidas, verCostos: null },
    }
  }
  async function noEncontrado(r: Awaited<ReturnType<typeof requireSeccion>>) {
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(404)
      expect(await r.response.json()).toEqual(NOT_FOUND)
    }
  }
  beforeEach(() => configurarFlagCompras(async () => true))

  it("sin sesión (o revocada / 2FA pendiente) -> 401, sin el motivo en el cuerpo", async () => {
    for (const reason of ["no-session", "revoked", "mfa"]) {
      state.guarded = { ok: false, reason }
      const r = await requireSeccion(req, "pedidos")
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.response.status).toBe(401)
        expect(JSON.stringify(await r.response.json())).not.toContain(reason)
      }
    }
  })

  it("con columnas NULL decide igual que el rango de rol de antes", async () => {
    como("admin")
    expect((await requireSeccion(req, "pedidos")).ok).toBe(true)
    como("operator")
    expect((await requireSeccion(req, "inbox")).ok).toBe(true)
    await noEncontrado(await requireSeccion(req, "pedidos"))
    como("superadmin", ["inbox"])
    expect((await requireSeccion(req, "catalogo")).ok).toBe(true)
  })

  it("sin la sección -> 404 con el cuerpo idéntico al de un id inexistente; devuelve tenant y usuario al pasar", async () => {
    como("admin", ["catalogo"])
    await noEncontrado(await requireSeccion(req, "pedidos"))
    const r = await requireSeccion(req, "catalogo")
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.tenantId).toBe("t1")
      expect(r.user.seccionesPermitidas).toEqual(["catalogo"])
    }
  })

  it("operador con una sección extra en su lista pasa (el rango ya no bloquea)", async () => {
    como("operator", ["inbox", "pedidos"])
    expect((await requireSeccion(req, "pedidos")).ok).toBe(true)
  })

  it("arreglo = cualquiera de las secciones", async () => {
    como("admin", ["cuotas"])
    expect((await requireSeccion(req, ["catalogo", "cuotas"])).ok).toBe(true)
    await noEncontrado(await requireSeccion(req, ["catalogo", "envios"]))
  })

  it("rolMin: piso extra de rol sobre la sección", async () => {
    como("operator")
    await noEncontrado(await requireSeccion(req, "inbox", { rolMin: "admin" }))
    como("admin")
    expect((await requireSeccion(req, "inbox", { rolMin: "admin" })).ok).toBe(true)
    await noEncontrado(await requireSeccion(req, "inbox", { rolMin: "superadmin" }))
  })

  it("Compras con el flag apagado -> 404 (también para el rol compras)", async () => {
    configurarFlagCompras(async () => false)
    for (const role of ["compras", "admin"]) {
      como(role)
      await noEncontrado(await requireSeccion(req, "compras"))
    }
  })

  it("el rol «compras» sólo pasa a Compras; un rol desconocido a nada", async () => {
    como("compras", ["pedidos"])
    expect((await requireSeccion(req, "compras")).ok).toBe(true)
    await noEncontrado(await requireSeccion(req, "pedidos"))
    await noEncontrado(await requireSeccion(req, "seguridad"))
    como("viewer")
    await noEncontrado(await requireSeccion(req, "inbox"))
  })
})
