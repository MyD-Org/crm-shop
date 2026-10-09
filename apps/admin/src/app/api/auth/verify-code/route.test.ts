import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Cliente } from "@/types"
import type { ResultadoOtp } from "@/lib/portal-otp"

// Unit de la verificación del código del portal. La lógica del código (hash, intentos
// atómicos, un solo uso) vive en src/lib/portal-otp.ts y se prueba contra la base en
// test/integration/portal-otp; acá se mockea y se prueba la ruta: qué responde ante cada
// motivo, que no vuelve a buscar el contacto por CUIT, el límite por IP y la sesión.

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
  resultado: { ok: true, identifier: "20123456789", codigocliente: "42" } as ResultadoOtp,
  intentos: [] as { id: string; tenantId: string; code: string }[],
  destruida: 0,
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
    s.destroy = () => {
      state.destruida += 1
    }
    return s
  },
}))

vi.mock("@/lib/tenant-context", () => ({ getTenantConfig: async () => ({ id: "t1" }) }))

vi.mock("@/lib/erp", () => ({
  getCliente: async (_t: unknown, id: string) => {
    state.porId.push(id)
    return cliente
  },
  getClienteByIdentifier: async () => {
    throw new Error("verify-code no debe buscar por identificador")
  },
}))

vi.mock("@/lib/portal-otp", () => ({
  intentarOtp: async (input: { id: string; tenantId: string; code: string }) => {
    state.intentos.push(input)
    return state.resultado
  },
}))

import { POST } from "./route"

const req = (code = "123456", ip = "203.0.113.1") =>
  new Request("http://avantec.plataforma.example/api/auth/verify-code", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ code }),
  })

beforeEach(() => {
  state.otp = { otpId: "11111111-1111-4111-8111-111111111111" }
  state.sesion = {}
  state.porId = []
  state.resultado = { ok: true, identifier: "20123456789", codigocliente: "42" }
  state.intentos = []
  state.destruida = 0
})

describe("POST /api/auth/verify-code", () => {
  it("con código válido lee el contacto por el id que dejó send-code y abre la sesión", async () => {
    const res = await POST(req())

    expect(res.status).toBe(200)
    expect(state.intentos).toEqual([{ id: "11111111-1111-4111-8111-111111111111", tenantId: "t1", code: "123456" }])
    expect(state.porId).toEqual(["42"])
    expect(state.sesion.codigocliente).toBe("42")
    // El email de la sesión es el del contacto, no lo tipeado (el CUIT).
    expect(state.sesion.email).toBe("compras@cliente.example")
    expect(state.sesion.isLoggedIn).toBe(true)
    // La cookie del OTP se descarta: ya se consumió en el servidor.
    expect(state.destruida).toBe(1)
  })

  it("400 'Código incorrecto' sin tocar Alegra ni destruir la cookie (quedan intentos)", async () => {
    state.resultado = { ok: false, motivo: "incorrecto", restantes: 3 }
    const res = await POST(req("000000"))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Código incorrecto")
    expect(state.porId).toEqual([])
    expect(state.destruida).toBe(0)
    expect(state.sesion.isLoggedIn).toBeUndefined()
  })

  it.each([
    ["agotado", 429, /Demasiados intentos fallidos/],
    ["vencido", 400, /El código expiró/],
    ["sin_otp", 400, /La verificación expiró/],
  ] as const)("motivo %s responde %s y descarta la cookie", async (motivo, status, mensaje) => {
    state.resultado = { ok: false, motivo }
    const res = await POST(req())

    expect(res.status).toBe(status)
    expect((await res.json()).error).toMatch(mensaje)
    expect(state.destruida).toBe(1)
    expect(state.sesion.isLoggedIn).toBeUndefined()
  })

  it("sin cookie de OTP responde 400 sin consultar la base", async () => {
    state.otp = {}
    const res = await POST(req())

    expect(res.status).toBe(400)
    expect(state.intentos).toEqual([])
  })

  it("rechaza códigos que no son 6 dígitos sin consultar la base", async () => {
    for (const code of ["12345", "1234567", "abcdef", ""]) {
      expect((await POST(req(code))).status).toBe(400)
    }
    expect(state.intentos).toEqual([])
  })

  it("429 tras 60 intentos desde la misma IP dentro de la ventana, aunque cambie la cookie", async () => {
    state.resultado = { ok: false, motivo: "incorrecto", restantes: 4 }
    for (let i = 0; i < 60; i++) {
      state.otp = { otpId: `22222222-2222-4222-8222-${String(i).padStart(12, "0")}` }
      expect((await POST(req("000000", "198.51.100.9"))).status).toBe(400)
    }
    const res = await POST(req("000000", "198.51.100.9"))
    expect(res.status).toBe(429)
    expect(state.intentos).toHaveLength(60)
    // Otra IP sigue pudiendo.
    expect((await POST(req("000000", "198.51.100.10"))).status).toBe(400)
  })
})
