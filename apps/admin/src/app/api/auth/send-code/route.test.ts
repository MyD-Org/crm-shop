import { describe, it, expect, vi } from "vitest"
import type { Cliente } from "@/types"

// Unit del envío del código de acceso al portal. Sin Alegra, Resend ni base: se mockean
// `@/lib/erp` (resolución del identificador), `@/lib/email` (envío) y `@/lib/portal-otp`
// (la fila en `portal_otps`; su lógica real se prueba en test/integration/portal-otp). El rate
// limit es un Map en memoria del módulo, así que cada test recarga los módulos para arrancar
// con la cuota limpia y usa un identificador propio.

const state = vi.hoisted(() => ({
  cliente: null as Cliente | null,
  sent: [] as { to: string; subject: string; html: string; text?: string }[],
  sendError: null as Error | null,
  session: {} as Record<string, unknown>,
  saved: 0,
  busquedas: 0,
  emitidos: [] as { tenantId: string; identifier: string; codigocliente: string }[],
}))

vi.mock("next/headers", () => ({ cookies: async () => ({}) }))

vi.mock("iron-session", () => ({
  getIronSession: async () => {
    state.session.save = async () => {
      state.saved += 1
    }
    return state.session
  },
}))

vi.mock("@/lib/tenant-context", () => ({
  getTenantConfig: async () => ({ id: "t1", name: "Avantec", resendFrom: "portal@plataforma.example" }),
}))

vi.mock("@/lib/erp", () => ({
  getClienteByIdentifier: async () => {
    state.busquedas += 1
    return state.cliente
  },
}))

vi.mock("@/lib/portal-otp", () => ({
  emitirOtp: async (input: { tenantId: string; identifier: string; codigocliente: string }) => {
    state.emitidos.push(input)
    return { id: `otp-${state.emitidos.length}`, code: "482915", expiresAt: new Date(Date.now() + 600_000) }
  },
}))

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>()
  return {
    ...actual,
    sendEmail: async (_t: unknown, to: string, subject: string, html: string, text?: string) => {
      if (state.sendError) throw state.sendError
      state.sent.push({ to, subject, html, text })
      return true
    },
  }
})

const baseCliente: Cliente = {
  codigocliente: "42",
  razonsocial: "ACME SRL",
  cuit: "20-12345678-9",
  email: "compras@acme.com",
  tipoCuenta: "corriente",
  limitecredito: 0,
  deudatotal: 0,
  saldovencido: 0,
  saldoavencer: 0,
}

async function loadRoute() {
  vi.resetModules()
  state.cliente = { ...baseCliente }
  state.sent = []
  state.sendError = null
  state.session = {}
  state.saved = 0
  state.busquedas = 0
  state.emitidos = []
  const route = await import("./route")
  return route.POST
}

function req(identifier: string, ip = "203.0.113.1") {
  return new Request("http://avantec.plataforma.example/api/auth/send-code", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ identifier }),
  })
}

describe("POST /api/auth/send-code", () => {
  it("manda el código al email del contacto de Alegra, no al identificador tipeado", async () => {
    const POST = await loadRoute()
    const res = await POST(req("20-12345678-9"))

    expect(res.status).toBe(200)
    expect(state.sent).toHaveLength(1)
    expect(state.sent[0].to).toBe("compras@acme.com")

    const body = await res.json()
    expect(body.sentTo).toBe("co*****@acme.com")
    // El código va en el mail, nunca en el cuerpo de la respuesta salvo devCode fuera de prod.
    expect(body.devCode).toBe("482915")
    expect(state.sent[0].html).toContain("482915")
  })

  it("manda el código en formato detectable por el celular", async () => {
    const POST = await loadRoute()
    const body = await (await POST(req("20-12345678-9"))).json()
    const code = body.devCode
    const { subject, text, html } = state.sent[0]

    // El asunto lleva el código: es lo único que el celular ve en la notificación.
    expect(subject).toContain(code)
    // Parte en texto plano presente (la que parsean los detectores) con la frase gatillo.
    expect(text).toContain(`Su código de verificación es ${code}`)
    // Los 6 dígitos van juntos: un separador o un espaciado que los parta rompe la detección.
    expect(text).not.toMatch(new RegExp(code.split("").join("[\\s-]")))
    expect(html).toContain(code)
  })

  it("guarda el código en el servidor y en la cookie deja SOLO el id", async () => {
    const POST = await loadRoute()
    const res = await POST(req("20-12345678-9"))
    expect(res.status).toBe(200)

    // Se emite normalizado a dígitos ("20-12345678-9" y "20123456789" son el mismo) y con el
    // id de Alegra del contacto, para que verify-code lo lea por id en vez de volver a buscarlo.
    expect(state.emitidos).toEqual([{ tenantId: "t1", identifier: "20123456789", codigocliente: "42" }])
    expect(state.saved).toBe(1)
    expect(state.session.otpId).toBe("otp-1")
    // Nada del código ni del contador viaja en la cookie: reenviarla no reinicia nada.
    expect(state.session).not.toHaveProperty("otp")
    expect(state.session).not.toHaveProperty("attempts")
    expect(state.session).not.toHaveProperty("otpExpiry")
  })

  it("404 sin emitir código si el identificador no existe en el ERP", async () => {
    const POST = await loadRoute()
    state.cliente = null

    const res = await POST(req("99-99999999-9"))

    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/Verifique el número o comuníquese con la sucursal/)
    expect(state.sent).toHaveLength(0)
    expect(state.emitidos).toHaveLength(0)
    expect(state.saved).toBe(0)
  })

  it("409 si la cuenta existe pero no tiene email cargado", async () => {
    const POST = await loadRoute()
    state.cliente = { ...baseCliente, email: undefined }

    const res = await POST(req("20-12345678-9"))

    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Comuníquese con la sucursal para que le den el alta/)
    expect(state.sent).toHaveLength(0)
    expect(state.emitidos).toHaveLength(0)
  })

  it("502 sin sellar la cookie si Resend rechaza el envío", async () => {
    const POST = await loadRoute()
    state.sendError = new Error("domain not verified")

    const res = await POST(req("20-12345678-9"))

    expect(res.status).toBe(502)
    // Sin cookie sellada: el usuario no queda esperando un código que nunca salió.
    expect(state.saved).toBe(0)
  })

  it("429 tras 5 envíos al mismo identificador dentro de la ventana", async () => {
    const POST = await loadRoute()

    for (let i = 0; i < 5; i++) {
      expect((await POST(req("20-11111111-1"))).status).toBe(200)
    }
    const res = await POST(req("20-11111111-1"))

    expect(res.status).toBe(429)
    expect(state.sent).toHaveLength(5)
  })

  /**
   * El límite por identificador se esquiva tipeando un CUIT distinto cada vez, y cada
   * búsqueda gasta cuota de Alegra: por eso también hay techo por IP.
   */
  it("429 tras 20 envíos desde la misma IP aunque cambie el identificador, sin buscar en Alegra", async () => {
    const POST = await loadRoute()
    for (let i = 0; i < 20; i++) {
      expect((await POST(req(`20-${String(i).padStart(8, "0")}-1`, "198.51.100.7"))).status).toBe(200)
    }
    const res = await POST(req("20-99999999-1", "198.51.100.7"))

    expect(res.status).toBe(429)
    expect(state.busquedas).toBe(20)
    // Otra IP no queda afectada.
    expect((await POST(req("20-99999999-1", "198.51.100.8"))).status).toBe(200)
  })

  it.each([
    ["muy corto", "ab"],
    ["un email", "compras@cliente.example"],
    ["un nombre de empresa", "ACME SRL"],
    ["pocos dígitos", "12345"],
  ])("400 sin buscar en Alegra si lo tipeado es %s", async (_caso, identifier) => {
    const POST = await loadRoute()
    const res = await POST(req(identifier))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Ingrese una identificación válida, solo con números.")
    expect(state.busquedas).toBe(0)
    expect(state.sent).toHaveLength(0)
  })

  it("el límite por identificador cuenta igual el CUIT con y sin guiones", async () => {
    const POST = await loadRoute()
    for (let i = 0; i < 5; i++) {
      expect((await POST(req(i % 2 ? "20-22222222-2" : "20222222222"))).status).toBe(200)
    }
    expect((await POST(req("20.222.222.222"))).status).toBe(429)
  })
})
