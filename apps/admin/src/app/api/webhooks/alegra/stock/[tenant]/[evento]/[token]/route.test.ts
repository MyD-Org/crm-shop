import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Unit de la ruta de avisos de stock: auth por token, el aviso se registra ANTES de responder
// y la re-lectura en Alegra va en `after`. Sin base ni Alegra: se mockean el tenant, el
// registro del aviso y el drenador.

const state = vi.hoisted(() => ({
  pendientes: [] as (() => Promise<void>)[],
  tenant: null as Record<string, unknown> | null,
  registrados: [] as { tenant: string; evento: string; payload: unknown }[],
  drenados: [] as { tenant: string; deadline: number }[],
  resultado: { accion: "encolado", docId: "10", items: 2, encolados: 2 } as Record<string, unknown>,
  falla: false,
}))

vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => {
    state.pendientes.push(fn)
  },
}))

vi.mock("@/lib/tenants", () => ({
  getTenantByIdFromDb: async (id: string) => (state.tenant && state.tenant.id === id ? state.tenant : null),
}))

vi.mock("@/lib/alegra-stock-webhook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra-stock-webhook")>()),
  registrarAviso: async (tenant: string, evento: string, payload: unknown) => {
    if (state.falla) throw Object.assign(new Error("conexión caída"), { code: "08006" })
    state.registrados.push({ tenant, evento, payload })
    return state.resultado
  },
}))

vi.mock("@/lib/alegra-stock-cola", () => ({
  drenarTenant: async (config: { id: string }, opts: { deadline: number }) => {
    state.drenados.push({ tenant: config.id, deadline: opts.deadline })
    return { leidos: 2, inactivos: 0, errores: 0, requests: 2, pendientes: 0, corte: "vacia" }
  },
}))

import { GET, POST } from "./route"
import { tokenWebhookStock } from "@/lib/alegra-stock-webhook"
import { tokenWebhookContactos } from "@/lib/alegra-contacts-webhook"

const SECRETO = "w".repeat(40)

function llamar(tenant: string, evento: string, token: string, body?: string) {
  const req = new Request(`https://tenant-a.plataforma.example/api/webhooks/alegra/stock/${tenant}/${evento}/${token}`, {
    method: "POST",
    body,
  })
  return POST(req, { params: Promise.resolve({ tenant, evento, token }) })
}

async function correrAfter() {
  vi.useFakeTimers()
  try {
    for (const fn of state.pendientes.splice(0)) {
      const p = fn()
      await vi.advanceTimersByTimeAsync(5_000)
      await p
    }
  } finally {
    vi.useRealTimers()
  }
}

const aviso = JSON.stringify({
  subject: "new-invoice",
  message: { invoice: { id: "10", status: "open", client: { name: "Cliente Ejemplo", email: "a@cliente.example" }, total: 98765.43, items: [{ id: 5 }, { id: 7 }] } },
})

beforeEach(() => {
  vi.stubEnv("ALEGRA_WEBHOOK_SECRET", SECRETO)
  state.pendientes = []
  state.registrados = []
  state.drenados = []
  state.falla = false
  state.resultado = { accion: "encolado", docId: "10", items: 2, encolados: 2 }
  state.tenant = { id: "tenant-a", alegraMock: false, alegraToken: "token-de-prueba" }
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("POST /api/webhooks/alegra/stock/[tenant]/[evento]/[token]", () => {
  it("registra el aviso, responde 200 y re-lee en Alegra recién después", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    const token = tokenWebhookStock("tenant-a")!
    const res = await llamar("tenant-a", "new-invoice", token, aviso)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(state.registrados).toEqual([{ tenant: "tenant-a", evento: "new-invoice", payload: JSON.parse(aviso) }])
    // La respuesta no esperó a Alegra.
    expect(state.drenados).toHaveLength(0)
    expect(state.pendientes).toHaveLength(1)

    const antes = Date.now()
    await correrAfter()
    expect(state.drenados).toHaveLength(1)
    expect(state.drenados[0].tenant).toBe("tenant-a")
    // Deadline ~45 s desde que llegó el aviso (dentro del maxDuration de 60 s).
    expect(state.drenados[0].deadline - antes).toBeLessThanOrEqual(45_000)
    expect(state.drenados[0].deadline - antes).toBeGreaterThan(40_000)
  })

  it("el log no tiene cuerpo, montos, cliente ni token", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const token = tokenWebhookStock("tenant-a")!
    await llamar("tenant-a", "new-invoice", token, aviso)
    await correrAfter()
    const todo = [...log.mock.calls, ...warn.mock.calls].flat().join(" ")
    expect(todo).toContain("[alegra-stock] tenant=tenant-a evento=new-invoice doc=10 accion=encolado items=2 encolados=2")
    for (const dato of ["Cliente Ejemplo", "a@cliente.example", "98765", token]) expect(todo).not.toContain(dato)
  })

  it("verificación `{}`: 200 y no se drena nada", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    state.resultado = { accion: "sin_id", items: 0, encolados: 0 }
    const token = tokenWebhookStock("tenant-a")!
    const res = await llamar("tenant-a", "new-invoice", token, "{}")
    expect(res.status).toBe(200)
    expect(state.pendientes).toHaveLength(0)
  })

  it("cuerpo ilegible: 200", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    state.resultado = { accion: "sin_id", items: 0, encolados: 0 }
    const token = tokenWebhookStock("tenant-a")!
    expect((await llamar("tenant-a", "edit-item", token, "\u0000\u0001 no es json")).status).toBe(200)
  })

  it("si la base falla al registrar: 500 (Alegra puede reintentar)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})
    state.falla = true
    const token = tokenWebhookStock("tenant-a")!
    const res = await llamar("tenant-a", "new-invoice", token, aviso)
    expect(res.status).toBe(500)
    expect(state.pendientes).toHaveLength(0)
    expect(error.mock.calls.flat().join(" ")).toContain("error=db_08006")
  })

  it("404 idéntico para token de otro tenant, token de contactos, evento ajeno o tenant inexistente", async () => {
    const tokA = tokenWebhookStock("tenant-a")!
    const tokB = tokenWebhookStock("tenant-b")!
    const casos: [string, string, string][] = [
      ["tenant-a", "new-invoice", "no-es-el-token"],
      ["tenant-a", "new-invoice", tokB],
      ["tenant-a", "new-invoice", tokenWebhookContactos("tenant-a")!],
      ["tenant-a", "new-client", tokA],
      ["tenant-b", "new-invoice", tokB], // tenant inexistente
    ]
    const cuerpos = new Set<string>()
    for (const [t, e, k] of casos) {
      const res = await llamar(t, e, k, aviso)
      expect(res.status).toBe(404)
      cuerpos.add(await res.text())
    }
    expect(cuerpos.size).toBe(1)
    state.tenant = { id: "tenant-a", alegraMock: false, alegraToken: "" }
    expect((await llamar("tenant-a", "new-invoice", tokA, aviso)).status).toBe(404)
    expect(state.registrados).toHaveLength(0)
    expect(state.pendientes).toHaveLength(0)
  })

  it("sin ALEGRA_WEBHOOK_SECRET rechaza todo", async () => {
    const token = tokenWebhookStock("tenant-a")!
    vi.stubEnv("ALEGRA_WEBHOOK_SECRET", "")
    expect((await llamar("tenant-a", "new-invoice", token, aviso)).status).toBe(404)
  })

  it("GET con token válido verifica la URL sin registrar nada", async () => {
    const token = tokenWebhookStock("tenant-a")!
    const params = (k: string) => ({ params: Promise.resolve({ tenant: "tenant-a", evento: "edit-item", token: k }) })
    expect((await GET(new Request("https://tenant-a.plataforma.example/x"), params(token))).status).toBe(200)
    expect((await GET(new Request("https://tenant-a.plataforma.example/x"), params("otro"))).status).toBe(404)
    expect(state.registrados).toHaveLength(0)
  })
})
