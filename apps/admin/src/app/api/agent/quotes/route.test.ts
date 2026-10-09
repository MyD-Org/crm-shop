import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mintAgentToken } from "@/lib/agent-token"

// /api/agent/quotes cotiza para un `contact_id` arbitrario, así que sólo acepta INTERNAL_SECRET.
// Acá se usa la auth REAL (lib/agent-auth.ts): un crm_token válido del cliente logueado, que
// llega a su navegador dentro del JWT del widget, tiene que dar 401 sin tocar Alegra.

const state = vi.hoisted(() => ({ llamadas: [] as string[] }))

vi.mock("@/lib/tenant-context", () => ({ getTenantConfig: async () => ({ id: "t1" }) }))
vi.mock("@/lib/alegra", () => ({
  createEstimate: async (_t: unknown, input: { contactAlegraId: string }) => {
    state.llamadas.push(`crear:${input.contactAlegraId}`)
    return cotizacion
  },
  listEstimatesByContact: async (_t: unknown, contactId: string) => {
    state.llamadas.push(`listar:${contactId}`)
    return [cotizacion]
  },
}))

import { GET, POST } from "./route"

const INTERNAL = "internal-secret-de-test-para-vitest-nada-real"
const cotizacion = {
  alegraId: "789",
  number: "42",
  date: "2026-10-09",
  dueDate: "2026-10-24",
  clientAlegraId: "123",
  clientName: "Iluminación Ejemplo SRL",
  status: "active",
  total: 3402,
  observations: "Válido por 15 días",
  items: [{ alegraId: "456", name: "Lámpara LED 12W", quantity: 2, price: 1890, discount: 10 }],
}
const BODY = JSON.stringify({ contact_id: "123", items: [{ id: "456", quantity: 2 }] })
const con = (auth: string, init: RequestInit = {}) =>
  new Request("https://t1.plataforma.example/api/agent/quotes?contact_id=123", {
    ...init,
    headers: { authorization: auth, ...(init.headers ?? {}) },
  })

beforeEach(() => {
  state.llamadas = []
  vi.stubEnv("INTERNAL_SECRET", INTERNAL)
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("/api/agent/quotes — auth server-to-server", () => {
  it("con INTERNAL_SECRET crea la cotización (201) y lista (200)", async () => {
    const post = await POST(con(`Bearer ${INTERNAL}`, { method: "POST", body: BODY }))
    expect(post.status).toBe(201)
    expect(await post.json()).toMatchObject({ id: "789", contact_id: "123", total: 3402 })
    const get = await GET(con(`Bearer ${INTERNAL}`))
    expect(get.status).toBe(200)
    expect(state.llamadas).toEqual(["crear:123", "listar:123"])
  })

  it("con un crm_token válido del mismo tenant responde 401 y no toca Alegra", async () => {
    const crmToken = mintAgentToken("CLI-1", "t1")
    const post = await POST(con(`Bearer ${crmToken}`, { method: "POST", body: BODY }))
    expect(post.status).toBe(401)
    expect(await post.json()).toEqual({ error: "unauthorized" })
    expect((await GET(con(`Bearer ${crmToken}`))).status).toBe(401)
    expect(state.llamadas).toEqual([])
  })

  it("sin Authorization responde 401", async () => {
    const res = await POST(new Request("https://t1.plataforma.example/api/agent/quotes", { method: "POST", body: BODY }))
    expect(res.status).toBe(401)
    expect(state.llamadas).toEqual([])
  })
})
