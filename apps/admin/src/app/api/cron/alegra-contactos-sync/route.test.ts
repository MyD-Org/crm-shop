import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TenantConfig } from "@/lib/tenants"

// Unit de la ruta cron de la sync de contactos. Sin base ni Alegra: se mockean el listado
// de tenants, su config y `syncContacts` (un tramo por tenant).

const state = vi.hoisted(() => ({
  ids: [] as string[],
  configs: {} as Record<string, Partial<TenantConfig> | null>,
  pendientes: new Set<string>(),
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

vi.mock("@/lib/alegra-contacts-sync", () => ({
  syncContacts: async (cfg: TenantConfig, trigger: string, opts: { deadline?: number }) => {
    state.llamadas.push({ tenant: cfg.id, trigger, deadline: opts.deadline })
    if (state.fallaEn === cfg.id) throw new Error("se cayó la base")
    const done = !state.pendientes.has(cfg.id)
    return { ok: true, done, contactsSynced: 3, totalPasada: 3, markedInactive: 0, requests: 1 }
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
  state.pendientes = new Set()
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

  it("sin ?tenant=: un tramo de cada tenant con Alegra, como cron, con un deadline corto compartido", async () => {
    const res = await pedir()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tenants.map((t: { tenant: string }) => t.tenant).sort()).toEqual(["tenant-a", "tenant-b"])
    expect(state.llamadas.every((l) => l.trigger === "cron")).toBe(true)
    const deadlines = new Set(state.llamadas.map((l) => l.deadline))
    expect(deadlines.size).toBe(1)
    const [deadline] = deadlines
    expect(deadline! - Date.now()).toBeLessThanOrEqual(45_000)
    expect(deadline! - Date.now()).toBeGreaterThan(35_000)
  })

  it("la respuesta dice por tenant si la pasada terminó (done) o quedan páginas", async () => {
    state.pendientes = new Set(["tenant-a"])
    const body = await (await pedir()).json()
    const porTenant = Object.fromEntries(body.tenants.map((t: { tenant: string; done: boolean }) => [t.tenant, t.done]))
    expect(porTenant).toEqual({ "tenant-a": false, "tenant-b": true })
  })

  it("con ?tenant=x: solo ese tenant y como disparo manual", async () => {
    const body = await (await pedir("?tenant=tenant-b")).json()
    expect(body.tenants).toEqual([
      { tenant: "tenant-b", ok: true, done: true, contactsSynced: 3, totalPasada: 3, markedInactive: 0, requests: 1 },
    ])
    expect(state.llamadas).toMatchObject([{ tenant: "tenant-b", trigger: "manual" }])
  })

  it("?tenant=x&trigger=cron (el workflow siguiendo un tenant pendiente) respeta el trigger", async () => {
    await pedir("?tenant=tenant-a&trigger=cron")
    expect(state.llamadas).toMatchObject([{ tenant: "tenant-a", trigger: "cron" }])
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
    expect(porTenant["tenant-a"]).toMatchObject({ ok: false, done: true, error: "error_interno" })
    expect(porTenant["tenant-b"]).toMatchObject({ ok: true })
    // El mensaje del error original no viaja en la respuesta.
    expect(JSON.stringify(body)).not.toContain("se cayó la base")
  })
})
