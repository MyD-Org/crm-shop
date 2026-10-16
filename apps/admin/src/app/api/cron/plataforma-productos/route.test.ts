import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TenantConfig } from "@/lib/tenants"

// Unit de la ruta cron del espejo de productos. Sin base ni plataforma: se mockean los
// tenants y el pusher.

const state = vi.hoisted(() => ({
  ids: [] as string[],
  configs: {} as Record<string, Partial<TenantConfig>>,
  llamadas: [] as string[],
  fallaEn: null as string | null,
  cortaEn: null as string | null,
  reloj: 1_000_000,
  avanzaPorLote: 0,
}))

vi.mock("@/lib/tenants", () => ({
  getTenantRegistry: async () => ({ ids: new Set(state.ids), domains: new Map() }),
  getTenantByIdFromDb: async (id: string) => (state.configs[id] ? ({ id, ...state.configs[id] } as TenantConfig) : null),
  plataformaConfigurada: (t: TenantConfig) => !!(t.plataformaUrl && t.plataformaApiKey && t.plataformaWebhookSecret),
}))

vi.mock("@/lib/plataforma-productos", () => ({
  empujarProductos: async (t: TenantConfig) => {
    state.llamadas.push(t.id)
    state.reloj += state.avanzaPorLote
    if (state.fallaEn === t.id) throw new Error("se cayó la base")
    // Primer lote con datos, segundo vacío: la ruta corta.
    const n = state.llamadas.filter((x) => x === t.id).length
    return n === 1 ? { enviados: 2, fallidos: 1, cursor: { at: new Date(0), clave: "" }, cortado: state.cortaEn === t.id } : { enviados: 0, fallidos: 0, cursor: { at: new Date(0), clave: "" }, cortado: state.cortaEn === t.id }
  },
}))

const { POST, GET } = await import("./route")

const SECRETO = "secreto-de-prueba"
const CFG = { plataformaUrl: "https://plataforma.example", plataformaApiKey: "k", plataformaWebhookSecret: "s" }
const pedir = (query = "", auth: string | null = `Bearer ${SECRETO}`) =>
  POST(new Request(`http://crm.plataforma.example/api/cron/plataforma-productos${query}`, { method: "POST", headers: auth ? { authorization: auth } : {} }))

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRETO)
  state.ids = ["a", "b", "c"]
  state.configs = { a: CFG, b: { plataformaUrl: "", plataformaApiKey: "", plataformaWebhookSecret: "" }, c: CFG }
  state.llamadas = []
  state.fallaEn = null
  state.cortaEn = null
  state.reloj = 1_000_000
  state.avanzaPorLote = 0
  vi.spyOn(Date, "now").mockImplementation(() => state.reloj)
})

afterEach(() => { vi.restoreAllMocks() })

describe("cron/plataforma-productos", () => {
  it("401 sin el bearer correcto", async () => {
    expect((await pedir("", null)).status).toBe(401)
    expect((await pedir("", "Bearer otro")).status).toBe(401)
    expect(state.llamadas).toEqual([])
  })

  it("con ?tenant= corre sólo ese tenant", async () => {
    const res = await pedir("?tenant=c")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, tenants: [{ tenant: "c", ok: true, enviados: 2, fallidos: 1, lotes: 1 }] })
    expect(new Set(state.llamadas)).toEqual(new Set(["c"]))
  })

  it("sin ?tenant= recorre sólo los tenants con la plataforma configurada", async () => {
    const body = await (await pedir()).json()
    expect(body.ok).toBe(true)
    expect(body.tenants.map((x: { tenant: string }) => x.tenant)).toEqual(["a", "c"])
    expect(new Set(state.llamadas)).toEqual(new Set(["a", "c"]))
  })

  it("la falla de un tenant no frena a los demás y deja ok:false", async () => {
    state.fallaEn = "a"
    const body = await (await pedir()).json()
    expect(body.ok).toBe(false)
    expect(body.tenants).toEqual([
      expect.objectContaining({ tenant: "a", ok: false, error: expect.any(String) }),
      expect.objectContaining({ tenant: "c", ok: true, enviados: 2 }),
    ])
  })

  it("un corte por red/5xx del pusher marca al tenant ok:false", async () => {
    state.cortaEn = "c"
    const body = await (await pedir("?tenant=c")).json()
    expect(body.ok).toBe(false)
    expect(body.tenants[0]).toMatchObject({ tenant: "c", ok: false })
  })

  it("pasado el deadline no lanza más lotes: responde ok con corte:'deadline' y sin pasar a los tenants siguientes", async () => {
    state.avanzaPorLote = 250_000 // el primer lote de "a" ya agota los 240 s
    const res = await pedir()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, corte: "deadline" })
    expect(body.tenants).toEqual([{ tenant: "a", ok: true, enviados: 2, fallidos: 1, lotes: 1, corte: "deadline" }])
    expect(state.llamadas).toEqual(["a"]) // ni segundo lote de "a" ni tenant "c"
  })

  it("dentro del presupuesto no hay corte", async () => {
    const body = await (await pedir()).json()
    expect(body.corte).toBeUndefined()
  })

  it("GET equivale a POST", () => { expect(GET).toBe(POST) })
})
