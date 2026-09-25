import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TenantConfig } from "@/lib/tenants"

// Unit de la ruta cron de la sync del catálogo. Sin base ni Alegra: se mockean el listado de
// tenants, su config y `syncCatalog`.

const state = vi.hoisted(() => ({
  ids: [] as string[],
  configs: {} as Record<string, Partial<TenantConfig> | null>,
  llamadas: [] as { tenant: string; trigger: string; aceptarBaja?: boolean }[],
  parcialEn: null as string | null,
}))

vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({ from: async () => state.ids.map((id) => ({ id })) }),
  }),
}))

vi.mock("@/lib/tenants", () => ({
  getTenantByIdFromDb: async (id: string) => {
    const c = state.configs[id]
    return c ? ({ id, alegraMock: false, alegraToken: "", ...c } as TenantConfig) : null
  },
}))

vi.mock("@/lib/alegra-sync", () => ({
  syncCatalog: async (cfg: TenantConfig, trigger: string, opts?: { aceptarBaja?: boolean }) => {
    state.llamadas.push({ tenant: cfg.id, trigger, aceptarBaja: opts?.aceptarBaja })
    return state.parcialEn === cfg.id
      ? { ok: true, parcial: true, motivo: "items 5 < base 100 (umbral 95 %)", itemsSynced: 5, categoriesSynced: 3 }
      : { ok: true, itemsSynced: 100, categoriesSynced: 3 }
  },
}))

const { GET, POST } = await import("./route")

const SECRETO = "secreto-de-prueba"
const pedir = (query = "", auth: string | null = `Bearer ${SECRETO}`) =>
  POST(
    new Request(`http://crm.plataforma.example/api/cron/alegra-sync${query}`, {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
    }),
  )

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRETO)
  vi.spyOn(console, "info").mockImplementation(() => {})
  state.ids = ["tenant-a", "tenant-b", "tenant-sin-alegra"]
  state.configs = {
    "tenant-a": { alegraToken: "x" },
    "tenant-b": { alegraMock: true },
    "tenant-sin-alegra": {},
  }
  state.llamadas = []
  state.parcialEn = null
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("/api/cron/alegra-sync", () => {
  it("sin secreto (o con uno equivocado) → 401 y no sincroniza nada", async () => {
    expect((await pedir("", null)).status).toBe(401)
    expect((await pedir("", "Bearer otro")).status).toBe(401)
    expect(state.llamadas).toEqual([])
  })

  it("sin query: todos los tenants con Alegra, sin aceptarBaja", async () => {
    const res = await pedir()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      tenants: [
        { tenant: "tenant-a", ok: true, itemsSynced: 100, categoriesSynced: 3 },
        { tenant: "tenant-b", ok: true, itemsSynced: 100, categoriesSynced: 3 },
      ],
    })
    expect(state.llamadas).toEqual([
      { tenant: "tenant-a", trigger: "cron", aceptarBaja: false },
      { tenant: "tenant-b", trigger: "cron", aceptarBaja: false },
    ])
  })

  it("una corrida parcial viaja con parcial y motivo", async () => {
    state.parcialEn = "tenant-b"
    const body = await (await pedir()).json()
    expect(body.tenants[1]).toEqual({
      tenant: "tenant-b",
      ok: true,
      parcial: true,
      motivo: "items 5 < base 100 (umbral 95 %)",
      itemsSynced: 5,
      categoriesSynced: 3,
    })
  })

  it("aceptar_baja sin tenant → 400 y no sincroniza", async () => {
    const res = await pedir("?aceptar_baja=1")
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "aceptar_baja requiere indicar el tenant." })
    expect(state.llamadas).toEqual([])
  })

  it.each(["tenant-x", "tenant-sin-alegra"])("tenant %s inexistente o sin Alegra → 404", async (t) => {
    const res = await pedir(`?tenant=${t}`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Tenant inexistente o sin Alegra configurado." })
    expect(state.llamadas).toEqual([])
  })

  it("?tenant= filtra la corrida a ese tenant", async () => {
    const body = await (await pedir("?tenant=tenant-b")).json()
    expect(body.tenants.map((t: { tenant: string }) => t.tenant)).toEqual(["tenant-b"])
    expect(state.llamadas).toEqual([{ tenant: "tenant-b", trigger: "cron", aceptarBaja: false }])
  })

  it("?tenant=&aceptar_baja=1 pasa aceptarBaja sólo a ese tenant", async () => {
    const res = await pedir("?tenant=tenant-a&aceptar_baja=1")
    expect(res.status).toBe(200)
    expect(state.llamadas).toEqual([{ tenant: "tenant-a", trigger: "cron", aceptarBaja: true }])
  })

  it("GET es la misma ruta (Vercel Cron)", () => {
    expect(GET).toBe(POST)
  })
})
