import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { crearSucursal } from "@/lib/sucursales-repo"
import { seedTenant, truncateAll } from "./helpers"

// Ruta pública de avisos de stock de una cuenta secundaria (change `sucursales-igz-mdp`, D2):
// auth por token de la CUENTA, el aviso se registra antes de responder y el drenaje va en `after`.

const state = vi.hoisted(() => ({ pendientes: [] as (() => Promise<void>)[], drenados: [] as string[] }))
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void state.pendientes.push(fn) }))
vi.mock("@/lib/alegra-stock-cola", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra-stock-cola")>()),
  drenarTenant: async (config: { id: string }) => {
    state.drenados.push(config.id)
    return { leidos: 0, inactivos: 0, errores: 0, requests: 0, pendientes: 0, corte: "vacia" }
  },
}))

const { GET, POST } = await import("@/app/api/webhooks/alegra/stock-cuenta/[cuenta]/[evento]/[token]/route")
const { tokenWebhookStockCuenta, tokenWebhookStock } = await import("@/lib/alegra-stock-webhook")

const A = "tenant-a"
const SECRETO = "w".repeat(40)
const db = () => getDb()
const filas = async (q: ReturnType<typeof sql>) => [...(await db().execute(q))] as Record<string, unknown>[]

let cuentaMdp: string
let cuentaIgz: string

const llamar = (cuenta: string, evento: string, token: string, body?: unknown) =>
  POST(new Request(`https://crm.example/api/webhooks/alegra/stock-cuenta/${cuenta}/${evento}/${token}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }), {
    params: Promise.resolve({ cuenta, evento, token }),
  })

const aviso = { subject: "new-invoice", message: { invoice: { id: "10", status: "open", items: [{ id: 5 }, { id: 7 }] } } }

beforeEach(async () => {
  vi.stubEnv("ALEGRA_WEBHOOK_SECRET", SECRETO)
  state.pendientes = []
  state.drenados = []
  await truncateAll()
  await db().execute(sql`truncate table alegra_cuentas, alegra_item_refresh, alegra_documento_items, alegra_webhook_avisos restart identity cascade`)
  await seedTenant(A)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal) VALUES (${A}, 'principal', 'Iguazú', true)`)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, alegra_email, alegra_token) VALUES (${A}, 'mdp', 'Mar del Plata', 'm@cliente.example', 'tok-mdp')`)
  await crearSucursal(A, { slug: "mdp", nombre: "Mar del Plata" })
  ;[{ id: cuentaMdp }] = (await filas(sql`SELECT id FROM alegra_cuentas WHERE slug = 'mdp'`)) as { id: string }[]
  ;[{ id: cuentaIgz }] = (await filas(sql`SELECT id FROM alegra_cuentas WHERE principal`)) as { id: string }[]
})
afterEach(() => vi.unstubAllEnvs())
afterAll(async () => {
  await truncateAll()
})

describe("POST /api/webhooks/alegra/stock-cuenta/<cuenta>/<evento>/<token>", () => {
  it("token válido: registra el aviso con el prefijo de la cuenta y drena en `after`", async () => {
    const res = await llamar(cuentaMdp, "new-invoice", tokenWebhookStockCuenta(cuentaMdp)!, aviso)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const cola = await filas(sql`SELECT alegra_id FROM alegra_item_refresh WHERE tenant_id = ${A} ORDER BY alegra_id`)
    expect(cola.map((f) => f.alegra_id)).toEqual(["mdp:5", "mdp:7"])
    expect(state.pendientes).toHaveLength(1)
  })

  it("el token de otra cuenta, el de la principal o uno vacío dan 404 y no registran nada", async () => {
    for (const token of [tokenWebhookStockCuenta(cuentaIgz)!, tokenWebhookStock(A)!, tokenWebhookStock(cuentaMdp)!, "x".repeat(32), ""]) {
      const res = await llamar(cuentaMdp, "new-invoice", token, aviso)
      expect(res.status).toBe(404)
    }
    expect(await filas(sql`SELECT 1 FROM alegra_item_refresh`)).toHaveLength(0)
    expect(state.pendientes).toHaveLength(0)
  })

  it("la cuenta principal, una inactiva, un id que no es uuid o un evento desconocido dan 404", async () => {
    expect((await llamar(cuentaIgz, "new-invoice", tokenWebhookStockCuenta(cuentaIgz)!, aviso)).status).toBe(404)
    expect((await llamar(cuentaMdp, "otro-evento", tokenWebhookStockCuenta(cuentaMdp)!, aviso)).status).toBe(404)
    expect((await llamar("no-es-uuid", "new-invoice", "a".repeat(32), aviso)).status).toBe(404)
    await db().execute(sql`UPDATE alegra_cuentas SET activa = false WHERE slug = 'mdp'`)
    expect((await llamar(cuentaMdp, "new-invoice", tokenWebhookStockCuenta(cuentaMdp)!, aviso)).status).toBe(404)
  })

  it("sin secreto configurado falla cerrado (404)", async () => {
    const token = tokenWebhookStockCuenta(cuentaMdp)!
    vi.stubEnv("ALEGRA_WEBHOOK_SECRET", "")
    expect((await llamar(cuentaMdp, "new-invoice", token, aviso)).status).toBe(404)
  })

  it("el POST de verificación sin cuerpo responde 200 y no encola", async () => {
    const res = await llamar(cuentaMdp, "new-item", tokenWebhookStockCuenta(cuentaMdp)!)
    expect(res.status).toBe(200)
    expect(await filas(sql`SELECT 1 FROM alegra_item_refresh`)).toHaveLength(0)
    expect(state.pendientes).toHaveLength(0)
  })

  it("GET de prueba: 200 con token válido y 404 con uno inválido, sin tocar nada", async () => {
    const ok = await GET(new Request("https://crm.example/x"), { params: Promise.resolve({ cuenta: cuentaMdp, evento: "new-item", token: tokenWebhookStockCuenta(cuentaMdp)! }) })
    expect(ok.status).toBe(200)
    const mal = await GET(new Request("https://crm.example/x"), { params: Promise.resolve({ cuenta: cuentaMdp, evento: "new-item", token: "0".repeat(32) }) })
    expect(mal.status).toBe(404)
  })
})
