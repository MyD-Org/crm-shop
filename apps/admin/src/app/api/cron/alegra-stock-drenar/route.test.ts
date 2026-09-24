import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TenantConfig } from "@/lib/tenants"

// Unit de la ruta cron que barre la cola de re-lectura de stock. Sin base ni Alegra: se
// mockean los tenants a mirar, su config y el drenador.

const state = vi.hoisted(() => ({
  tenants: [] as { tenant: string; ultimoAvisoMin: number | null }[],
  configs: {} as Record<string, Partial<TenantConfig> | null>,
  llamadas: [] as { tenant: string; deadline: number }[],
  fallaEn: null as string | null,
  purgas: 0,
}))

vi.mock("@/lib/tenants", () => ({
  getTenantByIdFromDb: async (id: string) => {
    const c = state.configs[id]
    return c ? ({ id, alegraMock: false, alegraToken: "", ...c } as TenantConfig) : null
  },
}))

vi.mock("@/lib/alegra-stock-cola", () => ({
  tenantsParaDrenar: async () => state.tenants,
  drenarTenant: async (cfg: TenantConfig, opts: { deadline: number }) => {
    state.llamadas.push({ tenant: cfg.id, deadline: opts.deadline })
    if (state.fallaEn === cfg.id) throw Object.assign(new Error("se cayó la base"), { code: "08006" })
    return { leidos: 0, inactivos: 0, errores: 0, requests: 0, pendientes: 0, corte: "vacia" }
  },
  purgarCola: async () => {
    state.purgas++
    return { cola: 0, indice: 0 }
  },
}))

const { POST, GET } = await import("./route")

const SECRETO = "secreto-de-prueba"
const pedir = (query = "", auth: string | null = `Bearer ${SECRETO}`) =>
  POST(
    new Request(`http://crm.plataforma.example/api/cron/alegra-stock-drenar${query}`, {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
    }),
  )

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRETO)
  state.tenants = [
    { tenant: "tenant-a", ultimoAvisoMin: 3 },
    { tenant: "tenant-b", ultimoAvisoMin: null },
  ]
  state.configs = { "tenant-a": { alegraToken: "t" }, "tenant-b": { alegraToken: "t" } }
  state.llamadas = []
  state.fallaEn = null
  state.purgas = 0
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("/api/cron/alegra-stock-drenar", () => {
  it("sin Bearer o con uno equivocado: 401 y no drena", async () => {
    expect((await pedir("", null)).status).toBe(401)
    expect((await pedir("", "Bearer otro")).status).toBe(401)
    expect(state.llamadas).toHaveLength(0)
  })

  it("cola vacía: corte `vacia` por tenant, con los minutos desde el último aviso, y purga", async () => {
    const antes = Date.now()
    const res = await pedir()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tenants).toEqual([
      { tenant: "tenant-a", ok: true, leidos: 0, inactivos: 0, errores: 0, requests: 0, pendientes: 0, corte: "vacia", ultimoAvisoMin: 3 },
      { tenant: "tenant-b", ok: true, leidos: 0, inactivos: 0, errores: 0, requests: 0, pendientes: 0, corte: "vacia", ultimoAvisoMin: null },
    ])
    expect(state.purgas).toBe(1)
    expect(state.llamadas[0].deadline - antes).toBeGreaterThanOrEqual(270_000)
    expect(state.llamadas[0].deadline - antes).toBeLessThan(275_000)
  })

  it("un tenant que falla da ok:false sin cortar a los demás", async () => {
    state.fallaEn = "tenant-a"
    const body = await (await pedir()).json()
    expect(body.tenants.map((t: { tenant: string; ok: boolean }) => [t.tenant, t.ok])).toEqual([
      ["tenant-a", false],
      ["tenant-b", true],
    ])
    expect(body.tenants[0].error).toBe("db_08006")
  })

  it("?tenant= drena sólo ese, aunque no tenga avisos todavía", async () => {
    state.configs["tenant-c"] = { alegraToken: "t" }
    const body = await (await pedir("?tenant=tenant-c")).json()
    expect(body.tenants.map((t: { tenant: string }) => t.tenant)).toEqual(["tenant-c"])
  })

  it("tenant sin Alegra configurado: no se drena", async () => {
    state.configs["tenant-b"] = { alegraToken: "" }
    const body = await (await pedir()).json()
    expect(body.tenants.map((t: { tenant: string }) => t.tenant)).toEqual(["tenant-a"])
  })

  it("GET es el mismo handler", () => {
    expect(GET).toBe(POST)
  })
})
