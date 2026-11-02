import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  destinatarios: [] as { name: string; email: string }[],
  enviados: [] as { to: string; subject: string }[],
  falla: new Set<string>(),
  dbFalla: false,
}))

vi.mock("next/server", () => ({ after: () => { throw new Error("fuera de un request") } }))
vi.mock("@/db", () => ({
  getDb: () => {
    if (h.dbFalla) throw new Error("db caída")
    return {
      select: () => ({
        from: (t: { __t?: string }) => ({
          where: async () => (t.__t === "tenants" ? [] : h.destinatarios),
        }),
      }),
    }
  },
}))
vi.mock("@/db/schema", () => ({
  adminUsers: { name: "n", email: "e", tenantId: "t", role: "r", passwordHash: "p" },
  tenants: { __t: "tenants", id: "id" },
}))
vi.mock("@/lib/email", () => ({
  sendEmail: async (_t: unknown, to: string, subject: string) => {
    if (h.falla.has(to)) throw new Error("Resend rechazó el envío")
    h.enviados.push({ to, subject })
    return true
  },
}))

import { avisarCambioCuentaBancaria, programarAvisoCuentaBancaria } from "@/lib/cuentas-bancarias-shop-aviso"

const cuenta = {
  id: "c1", alias: "a", cbu: "0170099220000067797370", banco: "B", titular: "T", cuit: "30-1-2",
  todasLasSucursales: true, sucursalSlugs: [], montoMin: null, montoMax: null, activa: true, predeterminada: false, orden: 0,
}
const params = { tenantId: "t1", tipo: "alta" as const, actor: { name: "Ana", email: "ana@cliente.example" }, despues: cuenta }

beforeEach(() => {
  h.destinatarios = [
    { name: "Luis", email: "luis@cliente.example" },
    { name: "Eva", email: "eva@cliente.example" },
  ]
  h.enviados = []
  h.falla = new Set()
  h.dbFalla = false
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("avisarCambioCuentaBancaria", () => {
  it("manda un mail a cada admin/superadmin", async () => {
    await avisarCambioCuentaBancaria(params)
    expect(h.enviados.map((e) => e.to)).toEqual(["luis@cliente.example", "eva@cliente.example"])
  })

  it("si un envío falla, no lanza, sigue con los demás y no loguea el CBU", async () => {
    h.falla.add("luis@cliente.example")
    await expect(avisarCambioCuentaBancaria(params)).resolves.toBeUndefined()
    expect(h.enviados.map((e) => e.to)).toEqual(["eva@cliente.example"])
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(logs).toContain("Resend rechazó")
    expect(logs).not.toContain("7370")
  })

  it("si la base falla, no lanza", async () => {
    h.dbFalla = true
    await expect(avisarCambioCuentaBancaria(params)).resolves.toBeUndefined()
  })

  it("edición sin cambios no manda nada", async () => {
    await avisarCambioCuentaBancaria({ ...params, tipo: "edicion", antes: cuenta, despues: { ...cuenta } })
    expect(h.enviados).toHaveLength(0)
  })
})

describe("programarAvisoCuentaBancaria", () => {
  it("si after() no está disponible, cae a envío no bloqueante y no lanza", async () => {
    expect(() => programarAvisoCuentaBancaria(params)).not.toThrow()
    await new Promise((r) => setTimeout(r, 10))
    expect(h.enviados).toHaveLength(2)
  })
})
