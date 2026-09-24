import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraItemRefresh, alegraStockDrenaje, catalogProducts } from "@/db/schema"
import type { AlegraProduct } from "@/lib/alegra"
import { drenarTenant, encolar, purgarCola } from "@/lib/alegra-stock-cola"
import { registrarAviso } from "@/lib/alegra-stock-webhook"
import { upsertProductos } from "@/lib/catalog-products-repo"
import type { TenantConfig } from "@/lib/tenants"
import { seedTenant, truncateAll } from "./helpers"

// Drenador de la cola de re-lectura de ítems contra Postgres real (crm_test) y Alegra
// MOCKEADO (fetch stubeado: nada sale a la red). El ritmo se prueba con un reloj falso: sólo
// se falsea `Date` y `dormir` lo adelanta. Datos inventados.

const A = "tenant-a"
const config = { id: A, alegraMock: false, alegraEmail: "api@plataforma.example", alegraToken: "token-de-prueba" } as unknown as TenantConfig

const fetchMock = vi.fn()
const pedidosDe = (id: string) =>
  fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith(`/items/${id}`)).length

/** Alegra responde GET /items/{id} con stock `stocks[id]`, o 404 si no está. */
function alegraTiene(stocks: Record<string, number>, antes?: (id: string) => Promise<void>) {
  fetchMock.mockImplementation(async (url: string) => {
    const id = new URL(url).pathname.split("/").pop() ?? ""
    if (antes) await antes(id)
    if (!(id in stocks)) return new Response('{"message":"no existe"}', { status: 404 })
    return new Response(JSON.stringify({ id, name: `Producto ${id}`, status: "active", inventory: { availableQuantity: stocks[id] }, price: [] }), {
      status: 200,
    })
  })
}

async function cola() {
  return getDb().select().from(alegraItemRefresh).where(eq(alegraItemRefresh.tenantId, A))
}

async function producto(alegraId: string) {
  const [row] = await getDb()
    .select()
    .from(catalogProducts)
    .where(and(eq(catalogProducts.tenantId, A), eq(catalogProducts.alegraId, alegraId)))
  return row
}

/** Reloj falso: sólo `Date`. `dormir` lo adelanta y registra la espera. */
function relojFalso() {
  vi.useFakeTimers({ toFake: ["Date"] })
  const esperas: number[] = []
  const dormir = async (ms: number) => {
    esperas.push(ms)
    vi.setSystemTime(Date.now() + ms)
  }
  return { esperas, dormir }
}

const encolarIds = (ids: string[]) => encolar(getDb(), A, ids, "edit-item")

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await truncateAll()
})

describe("drenarTenant", () => {
  it("ráfaga: 5 avisos del ítem 5 → 1 GET, stock absoluto de Alegra y cola vacía", async () => {
    for (let i = 0; i < 5; i++) await registrarAviso(A, "new-invoice", { message: { invoice: { id: `f${i}`, status: "open", items: [{ id: 5 }] } } })
    alegraTiene({ "5": 8 })
    const r = await drenarTenant(config, { deadline: Date.now() + 30_000, ritmoMs: 0 })
    expect(r).toMatchObject({ leidos: 1, inactivos: 0, errores: 0, requests: 1, pendientes: 0, corte: "vacia" })
    expect(pedidosDe("5")).toBe(1)
    const p = await producto("5")
    expect(p.stock).toBe("8")
    expect(p.leidoPor).toBe("webhook")
    expect(await cola()).toHaveLength(0)
  })

  it("ritmo: nunca más de 1 request por segundo, inicio a inicio", async () => {
    const { esperas, dormir } = relojFalso()
    await encolarIds(["1", "2", "3", "4"])
    alegraTiene({ "1": 1, "2": 2, "3": 3, "4": 4 })
    const r = await drenarTenant(config, { deadline: Date.now() + 60_000, dormir })
    expect(r.leidos).toBe(4)
    expect(esperas).toHaveLength(3)
    // Con el reloj congelado, cada espera es el segundo entero que faltaba.
    expect(esperas.every((ms) => ms === 1000)).toBe(true)
  })

  it("deadline: corta, lo no leído queda en la cola sin gastar intentos", async () => {
    const { dormir } = relojFalso()
    await encolarIds(["1", "2", "3", "4", "5"])
    alegraTiene({ "1": 1, "2": 2, "3": 3, "4": 4, "5": 5 })
    const r = await drenarTenant(config, { deadline: Date.now() + 2500, dormir })
    expect(r).toMatchObject({ leidos: 3, requests: 3, pendientes: 2, corte: "deadline" })
    const restantes = await cola()
    expect(restantes.map((f) => f.intentos)).toEqual([0, 0])
    expect(restantes.every((f) => f.tomadoHasta === null)).toBe(true)
  })

  it("429: corta sin borrar nada; la que chocó suma un intento", async () => {
    await encolarIds(["1", "2", "3"])
    fetchMock.mockImplementation(async () => new Response("", { status: 429, headers: { "retry-after": "1" } }))
    const r = await drenarTenant(config, { deadline: Date.now() + 30_000, ritmoMs: 0 })
    expect(r.corte).toBe("limite_429")
    expect(r.requests).toBe(2) // 1 + 1 reintento
    const filas = await cola()
    expect(filas).toHaveLength(3)
    const chocada = filas.find((f) => f.ultimoError === "alegra_429")
    expect(chocada?.intentos).toBe(1)
    expect(filas.filter((f) => f !== chocada).every((f) => f.intentos === 0 && f.tomadoHasta === null)).toBe(true)
  })

  it("404: el ítem queda inactive (la fila se conserva) y sale de la cola", async () => {
    await upsertProductos(A, [{ alegraId: "5", code: null, name: "Producto 5", description: null, categoryAlegraId: null, prices: [], stock: 3, status: "active", images: [], brand: null, ivaPorcentaje: null, raw: {} } satisfies AlegraProduct], {
      leidoAt: new Date(Date.now() - 60_000),
      leidoPor: "sync",
    })
    await encolarIds(["5"])
    alegraTiene({})
    const r = await drenarTenant(config, { deadline: Date.now() + 30_000, ritmoMs: 0 })
    expect(r).toMatchObject({ inactivos: 1, leidos: 0 })
    expect((await producto("5")).status).toBe("inactive")
    expect(await cola()).toHaveLength(0)
  })

  it("500: se anota el motivo corto y la fila queda para el próximo drenaje", async () => {
    await encolarIds(["5"])
    fetchMock.mockImplementation(async () => new Response("detalle de Alegra", { status: 500 }))
    const r = await drenarTenant(config, { deadline: Date.now() + 30_000, ritmoMs: 0 })
    expect(r).toMatchObject({ errores: 1, requests: 1, pendientes: 1, corte: "vacia" })
    const [f] = await cola()
    expect(f.ultimoError).toBe("alegra_http_500")
    expect(f.intentos).toBe(1)
    expect(f.tomadoHasta).not.toBeNull()
  })

  it("con 5 intentos fallidos se descarta sin consultar", async () => {
    await encolarIds(["5"])
    await getDb().execute(sql`UPDATE alegra_item_refresh SET intentos = 5`)
    alegraTiene({ "5": 1 })
    await drenarTenant(config, { deadline: Date.now() + 30_000, ritmoMs: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await cola()).toHaveLength(0)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("accion=descartado"))
  })

  it("un aviso que llega mientras se lee el ítem no se pierde: se vuelve a leer", async () => {
    await encolarIds(["5"])
    let primera = true
    alegraTiene({ "5": 8 }, async () => {
      if (!primera) return
      primera = false
      await new Promise((r) => setTimeout(r, 5))
      await encolarIds(["5"])
    })
    const r = await drenarTenant(config, { deadline: Date.now() + 30_000, ritmoMs: 0 })
    expect(pedidosDe("5")).toBe(2)
    expect(r.pendientes).toBe(0)
  })

  it("dos drenajes a la vez: uno queda `ocupado` y ningún ítem se consulta dos veces", async () => {
    await encolarIds(["1", "2", "3", "4", "5", "6"])
    alegraTiene({ "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6 })
    const [x, y] = await Promise.all([
      drenarTenant(config, { deadline: Date.now() + 30_000, ritmoMs: 5 }),
      drenarTenant(config, { deadline: Date.now() + 30_000, ritmoMs: 5 }),
    ])
    expect([x.corte, y.corte].sort()).toEqual(["ocupado", "vacia"])
    for (const id of ["1", "2", "3", "4", "5", "6"]) expect(pedidosDe(id)).toBe(1)
  })

  it("lease vencido se re-toma; lease vigente → ocupado", async () => {
    await encolarIds(["5"])
    alegraTiene({ "5": 1 })
    await getDb().insert(alegraStockDrenaje).values({ tenantId: A, ocupadoHasta: sql`now() + interval '1 minute'` })
    expect((await drenarTenant(config, { deadline: Date.now() + 30_000, ritmoMs: 0 })).corte).toBe("ocupado")
    await getDb().update(alegraStockDrenaje).set({ ocupadoHasta: sql`now() - interval '1 second'` })
    const r = await drenarTenant(config, { deadline: Date.now() + 30_000, ritmoMs: 0 })
    expect(r).toMatchObject({ corte: "vacia", leidos: 1 })
    const [lease] = await getDb().select().from(alegraStockDrenaje)
    expect(lease.ocupadoHasta).toBeNull()
    expect(lease.ultimoDrenajeAt).not.toBeNull()
  })

  it("factura de 200 líneas: el primer drenaje deja pendientes y el segundo los termina sin nuevo aviso", async () => {
    const { dormir } = relojFalso()
    const ids = Array.from({ length: 200 }, (_, i) => String(i + 1))
    await registrarAviso(A, "new-invoice", { message: { invoice: { id: "10", status: "open", items: ids.map((id) => ({ id })) } } })
    alegraTiene(Object.fromEntries(ids.map((id) => [id, 1])))
    const r1 = await drenarTenant(config, { deadline: Date.now() + 60_000, dormir })
    expect(r1.corte).toBe("deadline")
    expect(r1.leidos).toBe(60)
    expect(r1.pendientes).toBe(140)
    const r2 = await drenarTenant(config, { deadline: Date.now() + 1_000_000, dormir })
    expect(r2).toMatchObject({ leidos: 140, pendientes: 0, corte: "vacia" })
    for (const id of ids) expect(pedidosDe(id)).toBe(1)
  })
})

describe("purgarCola", () => {
  it("borra filas de cola de más de N horas e índice de más de N días", async () => {
    await encolarIds(["1", "2"])
    await getDb().execute(sql`UPDATE alegra_item_refresh SET pedido_at = now() - interval '49 hours' WHERE alegra_id = '1'`)
    await registrarAviso(A, "new-invoice", { message: { invoice: { id: "10", status: "open", items: [{ id: 3 }] } } })
    await registrarAviso(A, "new-invoice", { message: { invoice: { id: "11", status: "open", items: [{ id: 4 }] } } })
    await getDb().execute(sql`UPDATE alegra_documento_items SET actualizado_at = now() - interval '401 days' WHERE alegra_doc_id = '10'`)
    expect(await purgarCola({ colaHoras: 48, indiceDias: 400 })).toEqual({ cola: 1, indice: 1 })
    expect((await cola()).map((f) => f.alegraId).sort()).toEqual(["2", "3", "4"])
  })
})

describe("tenantsParaDrenar", () => {
  it("los que tienen cola y los que recibieron avisos, con los minutos desde el último", async () => {
    const { tenantsParaDrenar } = await import("@/lib/alegra-stock-cola")
    await seedTenant("tenant-b")
    await seedTenant("tenant-c")
    await encolarIds(["1"]) // A: cola, sin avisos
    await registrarAviso("tenant-b", "edit-item", { message: { item: { id: 5 } } })
    await getDb().delete(alegraItemRefresh).where(eq(alegraItemRefresh.tenantId, "tenant-b"))
    await getDb().execute(sql`UPDATE alegra_webhook_avisos SET ultimo_at = now() - interval '2 days'`)
    expect(await tenantsParaDrenar()).toEqual([
      { tenant: A, ultimoAvisoMin: null },
      { tenant: "tenant-b", ultimoAvisoMin: 2880 },
    ])
  })
})
