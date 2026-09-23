import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Unit de la ruta de avisos de Alegra: auth por token, respuesta inmediata y trabajo en
// `after`. Sin base ni Alegra: se mockean el tenant y el procesamiento del aviso.

const state = vi.hoisted(() => ({
  pendientes: [] as (() => Promise<void>)[],
  tenant: null as Record<string, unknown> | null,
  procesados: [] as { tenant: string; evento: string; payload: unknown }[],
}))

vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => {
    state.pendientes.push(fn)
  },
}))

vi.mock("@/lib/tenants", () => ({
  getTenantByIdFromDb: async (id: string) => (state.tenant && state.tenant.id === id ? state.tenant : null),
}))

vi.mock("@/lib/alegra-contacts-webhook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra-contacts-webhook")>()),
  procesarAvisoContacto: async (config: { id: string }, evento: string, payload: unknown) => {
    state.procesados.push({ tenant: config.id, evento, payload })
    return { accion: "upsert_directo", id: "42", requests: 0 }
  },
}))

import { GET, POST } from "./route"
import { tokenWebhookContactos } from "@/lib/alegra-contacts-webhook"

const SECRETO = "w".repeat(40)

function llamar(tenant: string, evento: string, token: string, body?: string) {
  const req = new Request(`https://tenant-a.plataforma.example/api/webhooks/alegra/contactos/${tenant}/${evento}/${token}`, {
    method: "POST",
    body,
  })
  return POST(req, { params: Promise.resolve({ tenant, evento, token }) })
}

async function correrAfter() {
  for (const fn of state.pendientes.splice(0)) await fn()
}

beforeEach(() => {
  vi.stubEnv("ALEGRA_WEBHOOK_SECRET", SECRETO)
  state.pendientes = []
  state.procesados = []
  state.tenant = { id: "tenant-a", alegraMock: false, alegraToken: "token-de-prueba" }
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("POST /api/webhooks/alegra/contactos/[tenant]/[evento]/[token]", () => {
  it("token válido: 200 enseguida y el aviso se aplica después", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    const token = tokenWebhookContactos("tenant-a")!
    const body = JSON.stringify({ message: { client: { id: 42, name: "Cliente Ejemplo" } } })

    const res = await llamar("tenant-a", "edit-client", token, body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(state.procesados).toHaveLength(0)

    await correrAfter()
    expect(state.procesados).toEqual([{ tenant: "tenant-a", evento: "edit-client", payload: JSON.parse(body) }])
  })

  it("nunca loguea valores del cuerpo", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const token = tokenWebhookContactos("tenant-a")!
    await llamar("tenant-a", "new-client", token, JSON.stringify({ client: { id: 42, name: "Cliente Ejemplo", email: "a@cliente.example" } }))
    await correrAfter()
    const todo = log.mock.calls.flat().join(" ")
    expect(todo).toContain("tenant=tenant-a")
    expect(todo).not.toContain("Cliente Ejemplo")
    expect(todo).not.toContain("a@cliente.example")
  })

  it("cuerpo como formulario también se lee", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    const token = tokenWebhookContactos("tenant-a")!
    await llamar("tenant-a", "new-client", token, "id=42&event=new-client")
    await correrAfter()
    expect(state.procesados[0].payload).toEqual({ id: "42", event: "new-client" })
  })

  it("token inválido, de otro tenant, evento ajeno o tenant sin Alegra: 404 y nada se procesa", async () => {
    const tokA = tokenWebhookContactos("tenant-a")!
    const tokB = tokenWebhookContactos("tenant-b")!
    const casos: [string, string, string][] = [
      ["tenant-a", "edit-client", "no-es-el-token"],
      ["tenant-a", "edit-client", tokB],
      ["tenant-a", "new-invoice", tokA],
      ["tenant-b", "edit-client", tokB], // tenant inexistente
    ]
    for (const [t, e, k] of casos) {
      const res = await llamar(t, e, k, "{}")
      expect(res.status).toBe(404)
    }
    state.tenant = { id: "tenant-a", alegraMock: false, alegraToken: "" }
    expect((await llamar("tenant-a", "edit-client", tokA, "{}")).status).toBe(404)
    expect(state.pendientes).toHaveLength(0)
  })

  it("sin ALEGRA_WEBHOOK_SECRET rechaza todo", async () => {
    const token = tokenWebhookContactos("tenant-a")!
    vi.stubEnv("ALEGRA_WEBHOOK_SECRET", "")
    expect((await llamar("tenant-a", "edit-client", token, "{}")).status).toBe(404)
  })

  it("GET con token válido verifica la URL sin procesar nada", async () => {
    const token = tokenWebhookContactos("tenant-a")!
    const params = (k: string) => ({ params: Promise.resolve({ tenant: "tenant-a", evento: "edit-client", token: k }) })
    expect((await GET(new Request("https://tenant-a.plataforma.example/x"), params(token))).status).toBe(200)
    expect((await GET(new Request("https://tenant-a.plataforma.example/x"), params("otro"))).status).toBe(404)
    expect(state.pendientes).toHaveLength(0)
  })
})
