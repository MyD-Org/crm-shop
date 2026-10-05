import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TenantConfig } from "@/lib/tenants"

// Unit de la ruta cron de la sync de contactos. Sin base ni Alegra: se mockean el listado
// de tenants, su config y `syncContacts` (un tramo por tenant).

const state = vi.hoisted(() => ({
  ids: [] as string[],
  configs: {} as Record<string, Partial<TenantConfig> | null>,
  pendientes: new Set<string>(),
  llamadas: [] as { tenant: string; cuenta?: string; trigger: string; deadline?: number }[],
  fallaEn: null as string | null,
  /** Cuentas secundarias por tenant: { slug, activa, creds }. */
  secundarias: {} as Record<string, { slug: string; activa?: boolean; creds?: boolean }[]>,
  salteos: [] as { tenant: string; trigger: string; motivo: string; cuenta: string }[],
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
  syncContacts: async (cfg: TenantConfig, trigger: string, opts: { deadline?: number; cuenta?: string }) => {
    const cuenta = opts.cuenta ?? "principal"
    state.llamadas.push({ tenant: cfg.id, cuenta, trigger, deadline: opts.deadline })
    if (state.fallaEn === `${cfg.id}:${cuenta}` || (cuenta === "principal" && state.fallaEn === cfg.id)) throw new Error("se cayó la base")
    const done = !state.pendientes.has(`${cfg.id}:${cuenta}`) && !(cuenta === "principal" && state.pendientes.has(cfg.id))
    return { cuenta, ok: true, done, contactsSynced: 3, totalPasada: 3, markedInactive: 0, requests: 1 }
  },
}))

vi.mock("@/lib/alegra-contacts-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra-contacts-repo")>()),
  registrarSalteo: async (tenant: string, trigger: string, motivo: string, cuenta: string) => {
    state.salteos.push({ tenant, trigger, motivo, cuenta })
  },
}))

// Las cuentas secundarias salen de la base: acá se inyectan desde el estado.
vi.mock("@/lib/alegra-contacts-objetivos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/alegra-contacts-objetivos")>()
  return {
    ...real,
    objetivosDeTenant: (base: TenantConfig, solo: string | null) =>
      real.objetivosDeTenant(base, solo, {
        env: { NODE_ENV: "production" },
        leerCuentas: async (t: string) =>
          (state.secundarias[t] ?? [])
            .filter((c) => c.activa !== false)
            .map((c) => ({
              slug: c.slug,
              principal: false,
              alegraMock: false,
              alegraEmail: c.creds === false ? "" : `${c.slug}@plataforma.example`,
              alegraToken: c.creds === false ? "" : `tok-${c.slug}`,
            })),
      }),
  }
})

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
  state.secundarias = {}
  state.salteos = []
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
      { tenant: "tenant-b", cuenta: "principal", ok: true, done: true, contactsSynced: 3, totalPasada: 3, markedInactive: 0, requests: 1 },
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
    expect(porTenant["tenant-a"]).toMatchObject({ ok: false, done: true, error: "error_interno", cuenta: "principal" })
    expect(porTenant["tenant-b"]).toMatchObject({ ok: true })
    // El mensaje del error original no viaja en la respuesta.
    expect(JSON.stringify(body)).not.toContain("se cayó la base")
  })

  describe("por cuenta", () => {
    const porClave = (body: { tenants: { tenant: string; cuenta: string }[] }) =>
      body.tenants.map((t) => `${t.tenant}:${t.cuenta}`).sort()

    it("itera la principal y cada cuenta secundaria activa, con `cuenta` en cada item", async () => {
      state.secundarias = { "tenant-a": [{ slug: "mdp" }] }
      const body = await (await pedir()).json()
      expect(porClave(body)).toEqual(["tenant-a:mdp", "tenant-a:principal", "tenant-b:principal"])
      expect(state.llamadas.filter((l) => l.tenant === "tenant-a").map((l) => l.cuenta).sort()).toEqual(["mdp", "principal"])
    })

    it("cuenta activa sin credenciales: salteo 'sin_credenciales' registrado, sin cortar el resto", async () => {
      state.secundarias = { "tenant-a": [{ slug: "mdp", creds: false }] }
      const body = await (await pedir("?trigger=manual")).json()
      const mdp = body.tenants.find((t: { cuenta: string }) => t.cuenta === "mdp")
      expect(mdp).toMatchObject({
        tenant: "tenant-a",
        cuenta: "mdp",
        ok: true,
        skipped: true,
        done: true,
        error: "sin_credenciales",
        contactsSynced: 0,
        totalPasada: 0,
        markedInactive: 0,
        requests: 0,
      })
      expect(state.salteos).toEqual([{ tenant: "tenant-a", trigger: "manual", motivo: "sin_credenciales", cuenta: "mdp" }])
      expect(porClave(body)).toContain("tenant-a:principal")
      expect(state.llamadas.map((l) => `${l.tenant}:${l.cuenta}`)).not.toContain("tenant-a:mdp")
    })

    it("cuenta inactiva: no se la procesa", async () => {
      state.secundarias = { "tenant-a": [{ slug: "mdp", activa: false }] }
      const body = await (await pedir()).json()
      expect(porClave(body)).toEqual(["tenant-a:principal", "tenant-b:principal"])
    })

    it("?cuenta=mdp procesa solo MDP", async () => {
      state.secundarias = { "tenant-a": [{ slug: "mdp" }] }
      const body = await (await pedir("?tenant=tenant-a&cuenta=mdp&trigger=cron")).json()
      expect(porClave(body)).toEqual(["tenant-a:mdp"])
      expect(state.llamadas).toMatchObject([{ tenant: "tenant-a", cuenta: "mdp", trigger: "cron" }])
    })

    it("?cuenta= de una cuenta que no existe → 404", async () => {
      expect((await pedir("?tenant=tenant-a&cuenta=nada")).status).toBe(404)
      expect(state.llamadas).toEqual([])
    })

    it("pendiente y falla se informan por (tenant, cuenta): fallar 'mdp' no marca a 'principal'", async () => {
      state.secundarias = { "tenant-a": [{ slug: "mdp" }] }
      state.fallaEn = "tenant-a:mdp"
      state.pendientes = new Set(["tenant-b:principal"])
      const body = await (await pedir()).json()
      const por = Object.fromEntries(body.tenants.map((t: { tenant: string; cuenta: string }) => [`${t.tenant}:${t.cuenta}`, t]))
      expect(por["tenant-a:mdp"]).toMatchObject({ ok: false, done: true, error: "error_interno" })
      expect(por["tenant-a:principal"]).toMatchObject({ ok: true, done: true })
      expect(por["tenant-b:principal"]).toMatchObject({ ok: true, done: false })
    })
  })
})
