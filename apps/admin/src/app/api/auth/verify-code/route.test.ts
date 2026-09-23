import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Cliente } from "@/types"

// verify-code NO vuelve a buscar el contacto por email/CUIT: send-code ya lo resolvió y
// dejó su id en la sesión OTP. Una búsqueda de más es cuota de Alegra en un endpoint anónimo.

const cliente: Cliente = {
  codigocliente: "42",
  razonsocial: "ACME SRL",
  cuit: "20-12345678-9",
  email: "compras@cliente.example",
  tipoCuenta: "corriente",
  limitecredito: 0,
  deudatotal: 0,
  saldovencido: 0,
  saldoavencer: 0,
}

const state = vi.hoisted(() => ({
  otp: {} as Record<string, unknown>,
  sesion: {} as Record<string, unknown>,
  porId: [] as string[],
  porIdentificador: [] as string[],
}))

vi.mock("next/headers", () => ({ cookies: async () => ({}) }))

vi.mock("@/lib/session", () => ({
  otpSessionOptions: { cookieName: "otp" },
  sessionOptionsForHost: () => ({ cookieName: "sesion" }),
}))

vi.mock("iron-session", () => ({
  getIronSession: async (_c: unknown, opts: { cookieName: string }) => {
    const s = opts.cookieName === "otp" ? state.otp : state.sesion
    s.save = async () => {}
    s.destroy = () => {}
    return s
  },
}))

vi.mock("@/lib/tenant-context", () => ({ getTenantConfig: async () => ({ id: "t1" }) }))

vi.mock("@/lib/erp", () => ({
  getCliente: async (_t: unknown, id: string) => {
    state.porId.push(id)
    return cliente
  },
  getClienteByIdentifier: async (_t: unknown, identifier: string) => {
    state.porIdentificador.push(identifier)
    return cliente
  },
}))

import { POST } from "./route"

const req = () =>
  new Request("http://avantec.plataforma.example/api/auth/verify-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "123456" }),
  })

beforeEach(() => {
  state.otp = { identifier: "20-12345678-9", otp: "123456", otpExpiry: Date.now() + 60_000 }
  state.sesion = {}
  state.porId = []
  state.porIdentificador = []
})

describe("POST /api/auth/verify-code", () => {
  it("lee el contacto por el id que dejó send-code, sin volver a buscarlo", async () => {
    state.otp.codigocliente = "42"
    const res = await POST(req())

    expect(res.status).toBe(200)
    expect(state.porId).toEqual(["42"])
    expect(state.porIdentificador).toEqual([])
    expect(state.sesion.codigocliente).toBe("42")
    expect(state.sesion.isLoggedIn).toBe(true)
  })

  it("una sesión OTP de antes del cambio (sin id) cae a la búsqueda por identificador", async () => {
    const res = await POST(req())

    expect(res.status).toBe(200)
    expect(state.porIdentificador).toEqual(["20-12345678-9"])
  })
})
