import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { hashToken } from "@/lib/admin-crypto"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { seedTenant, truncateAll } from "./helpers"

// POST /api/integraciones/cupones/emitir (spec 2026-11-01-cupones-design.md, "Endpoint para el
// bot"). DB real; el rate limit se simula. Tokens y referencias inventados.

let permitido = true
vi.mock("next/headers", () => ({ cookies: async () => ({}), headers: async () => new Headers() }))
vi.mock("@/lib/rate-limit", async (orig) => ({
  ...(await orig<typeof import("@/lib/rate-limit")>()),
  permitirAsync: async () => permitido,
}))

const ruta = await import("@/app/api/integraciones/cupones/emitir/route")

const A = "tenant-a"
const B = "tenant-b"
const TOKEN_A = "a".repeat(64)
const TOKEN_B = "b".repeat(64)

const emitir = (body: unknown, token: string | null = TOKEN_A, host = `${A}.localhost`) =>
  ruta.POST(
    new Request(`http://${host}/api/integraciones/cupones/emitir`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { host, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    }),
  )
const json = async (res: Response) => (await res.json()) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function promo(
  tenant: string,
  token: string | null,
  o: { inicio?: string; fin?: string; activa?: boolean; limite?: number | null; dias?: number | null } = {},
): Promise<string> {
  const [r] = (await getDb().execute(sql`
    INSERT INTO cupon_promociones (tenant_id, nombre, tipo, pct, inicio, fin, prefijo, activa, limite_canjes,
                                   vence_dias_desde_emision, token_hash, creado_por)
    VALUES (${tenant}, 'Bot Instagram', 'unicos', 10,
            ${o.inicio ?? "2026-01-01T00:00:00-03:00"}, ${o.fin ?? "2030-01-01T00:00:00-03:00"}, 'LUZ',
            ${o.activa ?? true}, ${o.limite ?? null}, ${o.dias === undefined ? 7 : o.dias},
            ${token ? hashToken(token) : null}, 'test')
    RETURNING id`)) as unknown as { id: string }[]
  return r.id
}

beforeEach(async () => {
  permitido = true
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
  await getDb().execute(sql`UPDATE tenants SET shop_url = 'https://tienda.example/' WHERE id = ${A}`)
  invalidateTenantRegistry()
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  await truncateAll()
})

describe("POST /api/integraciones/cupones/emitir", () => {
  it("referencia nueva: 200 con código, link a la tienda y vencimiento", async () => {
    await promo(A, TOKEN_A)
    const res = await emitir({ referencia: "sub-123" })
    expect(res.status).toBe(200)
    const r = await json(res)
    expect(r.codigo).toMatch(/^LUZ-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/)
    expect(r.link).toBe(`https://tienda.example/?cupon=${r.codigo}`)
    expect(r.nuevo).toBe(true)
    const dias = (new Date(r.venceEn).getTime() - Date.now()) / 86_400_000
    expect(dias).toBeGreaterThan(6.9)
    expect(dias).toBeLessThan(7.1)
    const [c] = (await getDb().execute(
      sql`SELECT origen, referencia_externa FROM cupon_codigos WHERE codigo = ${r.codigo}`,
    )) as unknown as { origen: string; referencia_externa: string }[]
    expect(c).toEqual({ origen: "integracion", referencia_externa: "sub-123" })
  })

  it("misma referencia: mismo código y nuevo:false, aun con la promoción pausada", async () => {
    const id = await promo(A, TOKEN_A)
    const r1 = await json(await emitir({ referencia: "sub-123" }))
    const r2 = await json(await emitir({ referencia: "sub-123" }))
    expect(r2).toMatchObject({ codigo: r1.codigo, nuevo: false, venceEn: r1.venceEn })
    await getDb().execute(sql`UPDATE cupon_promociones SET activa = false WHERE id = ${id}`)
    const r3 = await emitir({ referencia: "sub-123" })
    expect(r3.status).toBe(200)
    expect((await json(r3)).codigo).toBe(r1.codigo)
  })

  it("sin header, token desconocido o revocado: 401", async () => {
    const id = await promo(A, TOKEN_A)
    for (const token of [null, "c".repeat(64), "corto"]) {
      const res = await emitir({ referencia: "sub-1" }, token)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: "No autorizado." })
    }
    await getDb().execute(sql`UPDATE cupon_promociones SET token_hash = NULL WHERE id = ${id}`)
    expect((await emitir({ referencia: "sub-1" })).status).toBe(401)
  })

  it("token de una promoción de otro tenant pedido desde el host del tenant A: 401", async () => {
    await promo(B, TOKEN_B)
    expect((await emitir({ referencia: "sub-1" }, TOKEN_B)).status).toBe(401)
  })

  it("promoción pausada, vencida o sin empezar: 409 promocion_inactiva", async () => {
    const casos = [
      { activa: false },
      { inicio: "2020-01-01T00:00:00-03:00", fin: "2020-02-01T00:00:00-03:00" },
      { inicio: "2029-01-01T00:00:00-03:00", fin: "2030-01-01T00:00:00-03:00" },
    ]
    for (const [i, o] of casos.entries()) {
      await getDb().execute(sql`DELETE FROM cupon_promociones`)
      await promo(A, TOKEN_A, o)
      const res = await emitir({ referencia: `sub-${i}` })
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ code: "promocion_inactiva" })
    }
  })

  it("tope de emisión: límite × 3 códigos del bot -> 409 limite_alcanzado", async () => {
    await promo(A, TOKEN_A, { limite: 2 })
    for (let i = 0; i < 6; i++) expect((await emitir({ referencia: `sub-${i}` })).status).toBe(200)
    const res = await emitir({ referencia: "sub-7" })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "limite_alcanzado" })
  })

  it("sin vencimiento por días: venceEn null", async () => {
    await promo(A, TOKEN_A, { dias: null })
    expect((await json(await emitir({ referencia: "sub-1" }))).venceEn).toBeNull()
  })

  it("body sin referencia o inválido: 400", async () => {
    await promo(A, TOKEN_A)
    for (const body of [{}, { referencia: "" }, { referencia: 42 }, { referencia: "x".repeat(129) }, "no json"]) {
      expect((await emitir(body)).status).toBe(400)
    }
  })

  it("rate limit: 429", async () => {
    await promo(A, TOKEN_A)
    permitido = false
    expect((await emitir({ referencia: "sub-1" })).status).toBe(429)
  })

  it("log de una línea sin la referencia", async () => {
    await promo(A, TOKEN_A)
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    await emitir({ referencia: "sub-secreta-987" })
    expect(info).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(info.mock.calls)).not.toContain("sub-secreta-987")
  })
})
