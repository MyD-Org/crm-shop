import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import type { AlegraCategory, AlegraProduct } from "@/lib/alegra"
import { crearSucursal } from "@/lib/sucursales-repo"
import { seedTenant, truncateAll } from "./helpers"

// Runner de la sync programada (scripts/alegra-sync.ts → lib/alegra-sync-runner): principal y
// secundaria COMPLETAS en un solo proceso, sin presupuesto, contra Postgres
// real (crm_test) con Alegra mockeado: cada cuenta se distingue por su token y los ítems se leen
// en lotes chicos. Datos inventados: tenant-a, cuentas `principal` (igz) y `mdp`.

const items: Record<string, AlegraProduct[]> = { "tok-igz": [], "tok-mdp": [] }
let tamLote = 3
let demoraLoteMs = 0
const lotesLeidos: { token: string; start: number }[] = []

vi.mock("@/lib/alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra")>()),
  listAllCategories: async () => [] as AlegraCategory[],
  listAllItems: async (cfg: { alegraToken: string }) => {
    if (cfg.alegraToken === "tok-boom") throw new Error("Alegra 500 {detalle interno}")
    return items[cfg.alegraToken] ?? []
  },
  listItemsLote: async (cfg: { alegraToken: string }, start: number) => {
    if (cfg.alegraToken === "tok-boom") throw new Error("Alegra 500 {detalle interno}")
    lotesLeidos.push({ token: cfg.alegraToken, start })
    if (demoraLoteMs) await new Promise((r) => setTimeout(r, demoraLoteMs))
    const todos = items[cfg.alegraToken] ?? []
    return { items: todos.slice(start, start + tamLote), siguiente: start + tamLote, fin: start + tamLote >= todos.length }
  },
}))

const { avisarShopMock } = vi.hoisted(() => ({ avisarShopMock: vi.fn() }))
vi.mock("@/lib/aviso-shop", () => ({ avisarShop: avisarShopMock }))

const { correrSync } = await import("@/lib/alegra-sync-runner")
const { tenantsConAlegra } = await import("@/lib/alegra-sync-tenants")

const A = "tenant-a"
const cfg = { id: A, alegraEmail: "igz@cliente.example", alegraToken: "tok-igz", alegraMock: false } as Parameters<typeof correrSync>[0][number]

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
const productos = async () => filas(sql`SELECT alegra_id FROM catalog_products WHERE tenant_id = ${A} AND status = 'active'`)

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

describe("correrSync (runner del workflow)", () => {
  it("principal y secundaria completas en un solo proceso, sin continuar, exit 0", async () => {
    await conMdp()
    items["tok-igz"] = principal(10)
    items["tok-mdp"] = [it_("m1", "M1", 4), it_("m2", "P1", 2)]

    const { resumenes, exitCode } = await correrSync([cfg])

    expect(exitCode).toBe(0)
    expect(resumenes).toHaveLength(1)
    expect(resumenes[0]).toMatchObject({ tenant: A, ok: true, parcial: false, itemsSynced: 10 })
    expect(resumenes[0].cuentas).toHaveLength(1)
    expect(resumenes[0].cuentas?.[0]).toMatchObject({ cuenta: "mdp", ok: true })
    // La principal se leyó completa (4 lotes de 3) y no quedó cursor pendiente.
    expect(lotesLeidos.filter((l) => l.token === "tok-igz").map((l) => l.start)).toEqual([0, 3, 6, 9])
    expect(await cursores()).toHaveLength(0)
    expect((await logPrincipal()).status).toBe("ok")
    expect((await productos()).length).toBeGreaterThanOrEqual(10)
  })

  it("una cuenta que falla devuelve exit 1 sin filtrar el detalle de Alegra", async () => {
    await conMdp()
    await db().execute(sql`UPDATE alegra_cuentas SET alegra_token = 'tok-boom' WHERE tenant_id = ${A} AND slug = 'mdp'`)
    items["tok-igz"] = principal(4)

    const { resumenes, exitCode } = await correrSync([cfg])

    expect(exitCode).toBe(1)
    expect(resumenes[0].ok).toBe(false)
    expect(resumenes[0].cuentas?.[0]).toMatchObject({ cuenta: "mdp", ok: false })
    expect(JSON.stringify(resumenes)).not.toContain("detalle interno")
    expect(await cursores()).toHaveLength(0)
  })

  it("un tenant que falla no frena al siguiente y el resultado es exit 1", async () => {
    items["tok-igz"] = principal(3)
    const roto = { ...cfg, id: "tenant-roto", alegraToken: "tok-boom" }
    const { resumenes, exitCode } = await correrSync([roto, cfg])

    expect(exitCode).toBe(1)
    expect(resumenes.map((r) => [r.tenant, r.ok])).toEqual([
      ["tenant-roto", false],
      [A, true],
    ])
  })

  it("respeta la guarda de concurrencia: con un tramo en curso no corre y sale con exit 1", async () => {
    items["tok-igz"] = principal(3)
    await db().execute(sql`INSERT INTO catalog_sync_cursor (tenant_id, cursor, lock_hasta, actividad_at) VALUES (${A}, ${JSON.stringify({ v: 1, fase: "principal", principal: null, principalResult: null, pendientes: [], cuentas: [] })}::jsonb, now() + interval '5 minutes', now())`)

    const { resumenes, exitCode } = await correrSync([cfg])

    expect(exitCode).toBe(1)
    expect(resumenes[0].ok).toBe(false)
    expect(lotesLeidos).toHaveLength(0)
  })
})

describe("tenantsConAlegra", () => {
  it("con --tenant devuelve vacío si el tenant no existe", async () => {
    expect(await tenantsConAlegra("no-existe")).toEqual([])
  })
})
