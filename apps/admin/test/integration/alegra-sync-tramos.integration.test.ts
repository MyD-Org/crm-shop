import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import type { AlegraCategory, AlegraProduct } from "@/lib/alegra"
import { crearSucursal } from "@/lib/sucursales-repo"
import { seedTenant, truncateAll } from "./helpers"

// Sync reanudable por tramos (fix del 504 de la principal de un tenant grande) contra Postgres
// real (crm_test) con Alegra mockeado: cada cuenta se distingue por su token y los ítems se leen
// en lotes chicos. Datos inventados: tenant-a, cuentas `principal` (igz) y `mdp`.

const items: Record<string, AlegraProduct[]> = { "tok-igz": [], "tok-mdp": [] }
let tamLote = 3
let demoraLoteMs = 0
const lotesLeidos: { token: string; start: number }[] = []

vi.mock("@/lib/alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra")>()),
  listAllCategories: async () => [] as AlegraCategory[],
  listAllItems: async (cfg: { alegraToken: string }) => items[cfg.alegraToken] ?? [],
  listItemsLote: async (cfg: { alegraToken: string }, start: number) => {
    lotesLeidos.push({ token: cfg.alegraToken, start })
    if (demoraLoteMs) await new Promise((r) => setTimeout(r, demoraLoteMs))
    const todos = items[cfg.alegraToken] ?? []
    return { items: todos.slice(start, start + tamLote), siguiente: start + tamLote, fin: start + tamLote >= todos.length }
  },
}))

const { avisarShopMock } = vi.hoisted(() => ({ avisarShopMock: vi.fn() }))
vi.mock("@/lib/aviso-shop", () => ({ avisarShop: avisarShopMock }))

const { syncTenant } = await import("@/lib/alegra-sync-tenant")
const { abrirCorrida, MSG_CORRIDA_INTERRUMPIDA } = await import("@/lib/alegra-sync-guarda")

const A = "tenant-a"
const cfg = { id: A, alegraEmail: "igz@cliente.example", alegraToken: "tok-igz", alegraMock: false } as Parameters<typeof syncTenant>[0]
const VIEJO = "2026-01-01T00:00:00Z"

const it_ = (alegraId: string, code: string, stock = 1): AlegraProduct => ({
  alegraId,
  code,
  name: `Producto ${code}`,
  description: null,
  categoryAlegraId: null,
  prices: [{ idPriceList: "1", name: "General", price: 1000 }],
  stock,
  status: "active",
  images: [],
  brand: null,
  ivaPorcentaje: 21,
  raw: { id: alegraId },
})
const principal = (n: number) => Array.from({ length: n }, (_, i) => it_(String(i + 1), `P${i + 1}`))

const db = () => getDb()
type Fila = Record<string, unknown>
const filas = async (consulta: ReturnType<typeof sql>): Promise<Fila[]> => [...(await db().execute(consulta))] as Fila[]
const cursores = async () => filas(sql`SELECT * FROM catalog_sync_cursor WHERE tenant_id = ${A}`)
const logPrincipal = async () =>
  (await filas(sql`SELECT * FROM catalog_sync_log WHERE tenant_id = ${A} AND cuenta_id IS NULL ORDER BY started_at DESC LIMIT 1`))[0]
const estadoDe = async (alegraId: string) =>
  (await filas(sql`SELECT status FROM catalog_products WHERE tenant_id = ${A} AND alegra_id = ${alegraId}`))[0]?.status

/** Un producto viejo que la principal ya no devuelve: se da de baja solo al cerrar la pasada. */
async function sembrarViejo() {
  await db().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, name, prices, status, synced_at)
    VALUES (${A}, 'viejo', 'Viejo', '[{"price":1000}]'::jsonb, 'active', ${VIEJO})
  `)
}

beforeEach(async () => {
  await truncateAll()
  await db().execute(sql`truncate table catalog_products, catalog_categories, catalog_sync_log, catalog_overlay, catalog_stock_sucursal, alegra_cuentas restart identity cascade`)
  await seedTenant(A)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal) VALUES (${A}, 'principal', 'Iguazú', true)`)
  items["tok-igz"] = []
  items["tok-mdp"] = []
  tamLote = 3
  demoraLoteMs = 0
  lotesLeidos.length = 0
  avisarShopMock.mockReset()
  avisarShopMock.mockResolvedValue({ propagado: true })
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "info").mockImplementation(() => {})
})

afterAll(async () => {
  vi.restoreAllMocks()
  await truncateAll()
})

async function conMdp() {
  await db().execute(sql`
    INSERT INTO alegra_cuentas (tenant_id, slug, nombre, alegra_email, alegra_token) VALUES (${A}, 'mdp', 'Mar del Plata', 'mdp@cliente.example', 'tok-mdp')
  `)
  await crearSucursal(A, { slug: "igz", nombre: "Iguazú" })
  await crearSucursal(A, { slug: "mdp", nombre: "Mar del Plata" })
  await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = (SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND principal) WHERE tenant_id = ${A} AND slug = 'igz'`)
  await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = (SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp') WHERE tenant_id = ${A} AND slug = 'mdp'`)
}

describe("principal por tramos", () => {
  it("presupuesto agotado a mitad de la principal: guarda el cursor, devuelve continuar y NO da de baja nada", async () => {
    items["tok-igz"] = principal(10)
    await sembrarViejo()

    const r = await syncTenant(cfg, "cron", { presupuestoMs: 0 })

    expect(r.ok).toBe(true)
    expect(r.continuar).toBe(true)
    expect(r.progreso).toMatchObject({ cuenta: "principal", leidos: 3 })
    expect(lotesLeidos).toHaveLength(1)
    expect(await cursores()).toHaveLength(1)
    expect((await logPrincipal()).status).toBe("running")
    // Pasada parcial: lo que no se vio todavía sigue activo.
    expect(await estadoDe("viejo")).toBe("active")
    expect(avisarShopMock).not.toHaveBeenCalled()
  })

  it("reanuda desde el offset guardado, cierra la pasada y recién ahí da de baja", async () => {
    items["tok-igz"] = principal(10)
    await sembrarViejo()

    let r = await syncTenant(cfg, "cron", { presupuestoMs: 0 })
    let tramos = 1
    while (r.continuar) {
      // Antes de terminar, la baja no corrió.
      expect(await estadoDe("viejo")).toBe("active")
      r = await syncTenant(cfg, "cron", { presupuestoMs: 0 })
      tramos++
      expect(tramos).toBeLessThan(10)
    }

    expect(tramos).toBe(4)
    expect(lotesLeidos.map((l) => l.start)).toEqual([0, 3, 6, 9])
    expect(r).toMatchObject({ ok: true, itemsSynced: 10 })
    expect(r.continuar).toBeUndefined()
    expect(await cursores()).toHaveLength(0)
    const log = await logPrincipal()
    expect(log.status).toBe("ok")
    expect(log.items_synced).toBe(10)
    expect(await estadoDe("viejo")).toBe("inactive")
    expect(await estadoDe("10")).toBe("active")
    expect(avisarShopMock).toHaveBeenCalledTimes(1)
  })

  it("un tramo en ejecución bloquea a otro (cursor con lock vigente)", async () => {
    items["tok-igz"] = principal(10)
    await syncTenant(cfg, "cron", { presupuestoMs: 0 })
    await db().execute(sql`UPDATE catalog_sync_cursor SET lock_hasta = now() + interval '5 minutes' WHERE tenant_id = ${A}`)

    const r = await syncTenant(cfg, "manual", { presupuestoMs: 0 })

    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/en curso/)
    expect(lotesLeidos).toHaveLength(1)
  })

  it("un cursor abandonado (sin actividad hace más de 15 min) se descarta y la corrida empieza de cero", async () => {
    items["tok-igz"] = principal(4)
    await syncTenant(cfg, "cron", { presupuestoMs: 0 })
    await db().execute(sql`UPDATE catalog_sync_cursor SET actividad_at = now() - interval '20 minutes', lock_hasta = NULL WHERE tenant_id = ${A}`)
    await db().execute(sql`UPDATE catalog_sync_log SET actividad_at = now() - interval '20 minutes' WHERE tenant_id = ${A}`)
    lotesLeidos.length = 0

    const r = await syncTenant(cfg, "cron")

    expect(r).toMatchObject({ ok: true, itemsSynced: 4 })
    expect(lotesLeidos[0].start).toBe(0)
    const logs = await filas(sql`SELECT status, error FROM catalog_sync_log WHERE tenant_id = ${A} ORDER BY started_at`)
    expect(logs.map((l) => l.status)).toEqual(["error", "ok"])
    expect(logs[0].error).toBe(MSG_CORRIDA_INTERRUMPIDA)
  })
})

describe("cuentas secundarias en tramo propio", () => {
  it("si la principal consumió el presupuesto, la secundaria va en el tramo siguiente", async () => {
    await conMdp()
    items["tok-igz"] = principal(6)
    items["tok-mdp"] = [it_("m1", "M1", 4)]
    demoraLoteMs = 40

    // Presupuesto 60 ms: la principal (2 lotes de 40 ms) lo agota y no arranca MDP.
    const t1 = await syncTenant(cfg, "cron", { presupuestoMs: 60 })
    expect(t1.continuar).toBe(true)
    // ...primero sigue la principal (el lote 1 agotó el presupuesto).
    let r = t1
    let guardia = 0
    while (r.continuar && r.progreso?.cuenta === "principal" && guardia++ < 10) {
      r = await syncTenant(cfg, "cron", { presupuestoMs: 60 })
    }
    // Cerrada la principal, MDP todavía no se leyó: quedó pendiente para su propio tramo.
    expect(r.continuar).toBe(true)
    expect(r.progreso?.cuenta).toBe("mdp")
    expect(lotesLeidos.some((l) => l.token === "tok-mdp")).toBe(false)
    expect((await logPrincipal()).status).toBe("ok")

    const fin = await syncTenant(cfg, "cron", { presupuestoMs: 60_000 })
    expect(fin.continuar).toBeUndefined()
    expect(fin.ok).toBe(true)
    expect(fin.cuentas).toHaveLength(1)
    expect(fin.cuentas?.[0]).toMatchObject({ ok: true, cuenta: "mdp" })
    expect(await cursores()).toHaveLength(0)
  })

  it("con presupuesto de sobra, principal y secundaria corren en el mismo tramo", async () => {
    await conMdp()
    items["tok-igz"] = principal(6)
    items["tok-mdp"] = [it_("m1", "M1", 4)]

    const r = await syncTenant(cfg, "cron", { presupuestoMs: 60_000 })

    expect(r.continuar).toBeUndefined()
    expect(r.ok).toBe(true)
    expect(r.cuentas?.[0]).toMatchObject({ ok: true, cuenta: "mdp" })
  })
})

describe("corridas colgadas", () => {
  it("una 'running' sin actividad hace más de 15 min no bloquea y se marca error", async () => {
    await db().execute(sql`
      INSERT INTO catalog_sync_log (tenant_id, trigger, status, started_at)
      VALUES (${A}, 'cron', 'running', now() - interval '20 minutes')
    `)

    const id = await abrirCorrida(A, null, "cron", new Date())

    expect(id).toBeTruthy()
    const logs = await filas(sql`SELECT status, error, finished_at FROM catalog_sync_log WHERE tenant_id = ${A} ORDER BY started_at`)
    expect(logs.map((l) => l.status)).toEqual(["error", "running"])
    expect(logs[0].error).toBe(MSG_CORRIDA_INTERRUMPIDA)
    expect(logs[0].finished_at).not.toBeNull()
  })

  it("una 'running' con actividad reciente sigue bloqueando (aunque haya empezado hace más de 15 min)", async () => {
    await db().execute(sql`
      INSERT INTO catalog_sync_log (tenant_id, trigger, status, started_at, actividad_at)
      VALUES (${A}, 'cron', 'running', now() - interval '20 minutes', now())
    `)

    expect(await abrirCorrida(A, null, "cron", new Date())).toBeNull()
  })
})
