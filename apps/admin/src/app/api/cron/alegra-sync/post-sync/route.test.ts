import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ conAlegra: true, avisados: [] as string[], propagado: true }))

vi.mock("@/lib/alegra-sync-tenants", () => ({
  tenantsConAlegra: async (id: string) => (state.conAlegra ? [{ id }] : []),
}))
vi.mock("@/lib/aviso-shop", () => ({
  avisarShop: async (id: string) => {
    state.avisados.push(id)
    return { propagado: state.propagado }
  },
}))

const { POST } = await import("./route")

const SECRETO = "secreto-de-prueba"
const pedir = (query = "", auth: string | null = `Bearer ${SECRETO}`) =>
  POST(
    new Request(`http://crm.plataforma.example/api/cron/alegra-sync/post-sync${query}`, {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
    }),
  )

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRETO)
  state.conAlegra = true
  state.avisados = []
  state.propagado = true
})

describe("POST /api/cron/alegra-sync/post-sync", () => {
  it("rechaza sin el secreto o con uno incorrecto", async () => {
    expect((await pedir("?tenant=t", null)).status).toBe(401)
    expect((await pedir("?tenant=t", "Bearer otro")).status).toBe(401)
    expect(state.avisados).toEqual([])
  })
  it("exige un tenant válido", async () => {
    expect((await pedir("")).status).toBe(400)
    expect((await pedir("?tenant=a;b")).status).toBe(400)
  })
  it("404 si el tenant no existe o no tiene Alegra", async () => {
    state.conAlegra = false
    expect((await pedir("?tenant=t")).status).toBe(404)
    expect(state.avisados).toEqual([])
  })
  it("avisa al Shop del tenant y responde rápido", async () => {
    const res = await pedir("?tenant=tenant-a")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, tenant: "tenant-a", propagado: true })
    expect(state.avisados).toEqual(["tenant-a"])
  })
})
