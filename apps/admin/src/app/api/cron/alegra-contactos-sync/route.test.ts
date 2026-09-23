import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TenantConfig } from "@/lib/tenants"

// Unit de la ruta cron de la sync de contactos. Sin base ni Alegra: se mockean el listado
// de tenants, su config, la bitácora y `syncContacts`.

const state = vi.hoisted(() => ({
  ids: [] as string[],
  configs: {} as Record<string, Partial<TenantConfig> | null>,
  ultimas: new Map<string, Date>(),
  llamadas: [] as { tenant: string; trigger: string; deadline?: number }[],
  fallaEn: null as string | null,
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

vi.mock("@/lib/alegra-contacts-repo", () => ({
  ultimaOkPorTenant: async () => state.ultimas,
}))

vi.mock("@/lib/alegra-contacts-sync", () => ({
  syncContacts: async (cfg: TenantConfig, trigger: string, opts: { deadline?: number }) => {
    state.llamadas.push({ tenant: cfg.id, trigger, deadline: opts.deadline })
    if (state.fallaEn === cfg.id) throw new Error("se cayó la base")
    return { ok: true, contactsSynced: 3, markedInactive: 0, requests: 1 }
  },
}))

const { POST } = await import("./route")

const SECRETO = "secreto-de-prueba"
const pedir = (query = "", auth: string | null = `Bearer ${SECRETO}`) =>
  POST(
    new Request(`http://crm.plataforma.example/api/cron/alegra-contactos-sync${query}`, {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
    }),
  )

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRETO)
  state.ids = ["tenant-a", "tenant-b", "tenant-sin-alegra"]
  state.configs = {
    "tenant-a": { alegraToken: "x" },
    "tenant-b": { alegraMock: true },
    "tenant-sin-alegra": {},
  }
  state.ultimas = new Map()
  state.llamadas = []
  state.fallaEn = null
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("/api/cron/alegra-contactos-sync", () => {
  it("sin secreto (o con uno equivocado) → 401 y no sincroniza nada", async () => {
    expect((await pedir("", null)).status).toBe(401)
    expect((await pedir("", "Bearer otro")).status).toBe(401)
    expect(state.llamadas).toEqual([])
  })

  it("sin ?tenant=: todos los tenants con Alegra, como cron, con un deadline compartido", async () => {
    const res = await pedir()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tenants.map((t: { tenant: string }) => t.tenant).sort()).toEqual(["tenant-a", "tenant-b"])
    expect(state.llamadas.every((l) => l.trigger === "cron")).toBe(true)
    const deadlines = new Set(state.llamadas.map((l) => l.deadline))
    expect(deadlines.size).toBe(1)
    const [deadline] = deadlines
    expect(deadline! - Date.now()).toBeLessThanOrEqual(270_000)
    expect(deadline! - Date.now()).toBeGreaterThan(260_000)
  })

  it("ordena por la última corrida OK más vieja; nunca sincronizado va primero", async () => {
    state.ultimas = new Map([
      ["tenant-a", new Date("2026-09-20T00:00:00Z")],
      ["tenant-b", new Date("2026-09-23T00:00:00Z")],
    ])
    await pedir()
    expect(state.llamadas.map((l) => l.tenant)).toEqual(["tenant-a", "tenant-b"])

    state.llamadas = []
    state.ultimas = new Map([["tenant-a", new Date("2026-09-20T00:00:00Z")]])
    await pedir()
    expect(state.llamadas.map((l) => l.tenant)).toEqual(["tenant-b", "tenant-a"])
  })

  it("con ?tenant=x: solo ese tenant y como disparo manual", async () => {
    const body = await (await pedir("?tenant=tenant-b")).json()
    expect(body.tenants).toEqual([{ tenant: "tenant-b", ok: true, contactsSynced: 3, markedInactive: 0, requests: 1 }])
    expect(state.llamadas).toMatchObject([{ tenant: "tenant-b", trigger: "manual" }])
  })

  it("?trigger=manual (workflow_dispatch) marca la corrida como manual", async () => {
    await pedir("?trigger=manual")
    expect(state.llamadas.every((l) => l.trigger === "manual")).toBe(true)
  })

  it("?tenant= de un tenant sin Alegra → 404 sin sincronizar", async () => {
    expect((await pedir("?tenant=tenant-sin-alegra")).status).toBe(404)
    expect(state.llamadas).toEqual([])
  })

  it("best-effort: si un tenant falla, el otro sigue y el fallido queda ok:false", async () => {
    state.fallaEn = "tenant-a"
    const body = await (await pedir()).json()
    const porTenant = Object.fromEntries(body.tenants.map((t: { tenant: string; ok: boolean }) => [t.tenant, t]))
    expect(porTenant["tenant-a"]).toMatchObject({ ok: false, error: "error_interno" })
    expect(porTenant["tenant-b"]).toMatchObject({ ok: true })
    // El mensaje del error original no viaja en la respuesta.
    expect(JSON.stringify(body)).not.toContain("se cayó la base")
  })
})
